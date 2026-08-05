import crypto from "crypto";
import express from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PrivyClient } from "@privy-io/server-auth";
import {
  Connection, PublicKey, Keypair, VersionedTransaction,
  SystemProgram, Transaction, TransactionInstruction, TransactionMessage,
} from "@solana/web3.js";
import { getRegistry, USDC, USDY, JUP_BASE, jupHeaders, NON_XSTOCK_SYMBOLS } from "./tokens.js";
import { generateLinkCode, mountTelegramRoutes } from "./telegram.js";
import { mountStrategyRoutes } from "./strategyRoutes.js";
import { startStrategyEvaluator } from "./strategyAgents/evaluator.js";
import { getMarketInfo, getMarketChart } from "./marketdata.js";
import { ensureArbitrumGas, depositToHyperliquid, getArbitrumSponsorStatus } from "./arbitrumSponsor.js";
import { checkAndRelayCctpDeposit, checkAndRelayCctpWithdraw } from "./cctp.js";
import { parseEther } from "viem";
import { KaminoError, getXstocksReserves, getObligations, getLoanDetail, buildKlendTx } from "./kamino.js";
import {
  initSchema, logActivity, getActivityForWallet,
  getCustomerStatus, getCustomerStatusDetail, setCustomerStatus,
  getOrCreateReferralCode, findReferralCodeOwner, attributeReferral,
  getReferralsFor, getEquitiesStatsForWallet, getKaminoFeeStatsForWallet, getKaminoFeeTotals,
  createKaminoFeeObligation, getUnpaidKaminoFeeObligation, markKaminoFeeObligationPaid,
  createStrategy, listStrategiesForWallet, countActiveStrategiesForWallet,
  setStrategyStatus, touchStrategyEvaluated,
  listPendingProposalsForWallet, getProposal,
  markProposalRejected, markProposalConfirmed, expireProposalsForStrategy,
  getTelegramLinksForWallet,
} from "./db.js";
import { getPerpsPositions } from "./hyperliquid.js";
import { sendEmail } from "./email.js";
import {
  ensureReferralAccount, ensureTokenAccount, claimAllFees,
  referralAccountPubkey, referralAccountExists, getPendingBalance,
} from "./referral.js";
import { getBuilderFeeStatus, claimBuilderRewards, withdrawFromSponsor, getUserPerpsStats, getUserPerpsFills } from "./hlBuilder.js";
import { getMarketHealthSnapshot, startMarketHealthMonitor } from "./marketHealth.js";
import { searchOfac, getOfacListStatus } from "./ofacScreening.js";
import { getPredictionMarketsSnapshot, startPredictionMarketsMonitor } from "./predictionMarkets.js";

// A real stuck deposit had 0.00002 ETH and failed to cover the
// approve+deposit gas needed for the Hyperliquid Bridge2 step — this
// threshold gives real margin above that observed failure point.
const MIN_ARB_ETH = parseEther("0.0001");

const PORT = process.env.PORT || 8787;
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// Optional gas sponsor. If set, this wallet is passed to Jupiter Ultra as the
// integrator fee payer and co-signs every swap, so users never need SOL.
// Fund it with a little SOL and keep the key ONLY on the server.
const sponsor = process.env.SPONSOR_PRIVATE_KEY
  ? Keypair.fromSecretKey(bs58.decode(process.env.SPONSOR_PRIVATE_KEY))
  : null;

// Platform fee on brokerage swaps, via Jupiter Ultra's referral program —
// see server/src/referral.js for the account/claim mechanics. Off by
// default: turning this on before the referral account + a USDC token
// account under it exist (POST /api/admin/jupiter-fees/setup) would just
// mean Jupiter silently drops the fee param, so gate explicitly rather than
// attempt it unconditionally. 50bps is Jupiter's enforced floor for this
// mechanism (below that isn't possible — see the plan file for why).
const JUP_FEES_ENABLED = process.env.JUP_FEES_ENABLED === "true";
const JUP_REFERRAL_FEE_BPS = process.env.JUP_REFERRAL_FEE_BPS || "50";
function applyReferralFee(params) {
  if (!JUP_FEES_ENABLED || !sponsor) return;
  params.set("referralAccount", referralAccountPubkey());
  params.set("referralFee", JUP_REFERRAL_FEE_BPS);
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const connection = new Connection(RPC_URL, "confirmed");
const app = express();
// Trust one hop (Railway/Vercel-style single reverse proxy) so req.ip reflects
// the real client IP instead of the proxy's — required for rate limiting and
// geo-gating below to key off the actual caller.
app.set("trust proxy", 1);

// In production set ALLOWED_ORIGINS=https://yourdomain.com (comma-separated if multiple)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:5174"];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => { console.log(`[req] ${req.method} ${req.path}`); next(); });

// Rate limits key off the authenticated Privy user when auth is configured
// (req.privyUserId, set by requireAuth below), falling back to IP otherwise.
// /api/order and /api/execute gate sponsor SOL spend; /api/parse and /api/ask
// spend paid Anthropic (+ Brave) API calls.
const rateKey = (req) => req.privyUserId || ipKeyGenerator(req.ip);
// Verified QA-bypass requests (see requireAllowedGeo below, which sets this
// flag) skip rate limiting entirely — they're tied to a real signature from
// an allowlisted address, not anonymous traffic, so the anti-abuse limit
// doesn't apply the same way. Everyone else still gets the normal limit.
const skipForQaBypass = (req) => req.qaBypassVerified === true;
const orderLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_ORDER || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateKey,
  skip: skipForQaBypass,
});
const parseLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_PARSE || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateKey,
  skip: skipForQaBypass,
});
const kaminoLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_KAMINO || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateKey,
  skip: skipForQaBypass,
});
// Tighter than the other limiters above — a legitimate user needs this once
// per deposit, not repeatedly, and it directly spends sponsor SOL (see
// /api/perps/bridge/tx's own comment for the fuller story on why this
// route in particular needed both auth and a limiter it didn't have before).
const bridgeGasLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_BRIDGE_GAS || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateKey,
  skip: skipForQaBypass,
});
const strategyLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_STRATEGY || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateKey,
  skip: skipForQaBypass,
});

/* ————— auth: verify Privy access tokens on state-changing / paid routes —————
 * Requires PRIVY_APP_ID + PRIVY_APP_SECRET (dashboard.privy.io → your app →
 * Settings → Basics — the secret is separate from the public VITE_PRIVY_APP_ID
 * the frontend already uses). Until both are set, requireAuth logs a warning
 * once and passes every request through unauthenticated (today's behavior) —
 * it does not fail closed, so it won't break the app before you configure it. */
const PRIVY_APP_ID = process.env.PRIVY_APP_ID || "";
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || "";
// Separate from PRIVY_APP_SECRET — this is the app's Wallet Infrastructure
// "authorization key" (dashboard: Wallet infrastructure → Authorization keys).
// Required for any walletApi RPC call (e.g. signTransaction for the Telegram
// bot's delegated-wallet signing) once an authorization key is registered for
// the app; without it those calls fail with "Missing privy-authorization-signature".
const PRIVY_AUTHORIZATION_PRIVATE_KEY = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || "";
const privyClient = PRIVY_APP_ID && PRIVY_APP_SECRET
  ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY
      ? { walletApi: { authorizationPrivateKey: PRIVY_AUTHORIZATION_PRIVATE_KEY } }
      : undefined)
  : null;
if (!privyClient) {
  console.warn("[auth] PRIVY_APP_ID / PRIVY_APP_SECRET not set — /api/order, /api/execute, " +
    "/api/withdraw, /api/parse, /api/ask are UNAUTHENTICATED. Set both in server/.env before going live.");
}

async function requireAuth(req, res, next) {
  if (!privyClient) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "authentication required" });
  try {
    const claims = await privyClient.verifyAuthToken(token);
    req.privyUserId = claims.userId;
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired session" });
  }
}

/* ————— geo-gating: block restricted jurisdictions on trade/withdraw routes —————
 * Keep this list in sync with web/src/perps/compliance/geoGate.js (perps flow).
 * Looks up the caller's IP via a free, keyless geo-IP service and blocks trades
 * from restricted countries. Fails OPEN on lookup errors/timeouts (a flaky
 * third-party API shouldn't take down trading) and skips local/private IPs
 * entirely so dev/testing isn't blocked — this is best-effort compliance
 * support, not a substitute for a real KYC/geo-fencing review (see README). */
const RESTRICTED_COUNTRIES = new Set(["US", "CU", "IR", "SY", "KP", "RU"]);
const geoCache = new Map(); // ip -> { country, ts }
const GEO_CACHE_TTL_MS = 10 * 60 * 1000;

function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/, "");
  return v === "::1" || v === "127.0.0.1" || v.startsWith("10.") || v.startsWith("192.168.") || v.startsWith("172.16.");
}

async function lookupCountry(ip) {
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < GEO_CACHE_TTL_MS) return cached.country;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    const d = await r.json();
    const country = d.success !== false ? (d.country_code || null) : null;
    geoCache.set(ip, { country, ts: Date.now() });
    return country;
  } catch (e) {
    console.warn(`[geo] lookup failed for ${ip}: ${e.message} — failing open`);
    return null;
  }
}

/* ————— QA geo-bypass allowlist (shared: perps client-gate + xStocks server-gate) —————
 * Lets specific, pre-approved Solana wallet addresses skip geo-gating for
 * internal testing, without reopening a client-visible flag any real user
 * in a restricted country could copy. Requires a live ed25519 signature
 * proving control of an allowlisted address — the signature can't be reused
 * by someone who doesn't hold that address's private key.
 */
const QA_ALLOWLIST = new Set(
  (process.env.PERPS_QA_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean)
);

function verifyQaSignature(address, message, signature) {
  try {
    if (!address || !message || !signature) return false;
    if (!QA_ALLOWLIST.has(address)) return false;
    // Message must be fresh (today, UTC) and bound to this address — blocks
    // replaying an old captured signature beyond the day it was made for.
    // Plain ASCII only (no em-dash) — this travels as an HTTP header value
    // for xStocks routes, and non-ASCII bytes get corrupted in transit there
    // (confirmed: "—" became "â" over the wire during testing).
    const today = new Date().toISOString().slice(0, 10);
    const expected = `Bonzai Trading QA bypass - ${address} - ${today}`;
    if (message !== expected) return false;
    const pubkey = bs58.decode(address);
    const sig = Buffer.from(signature, "base64");
    const msgBytes = Buffer.from(message, "utf8");
    return ed25519.verify(sig, msgBytes, pubkey);
  } catch {
    return false;
  }
}

async function requireAllowedGeo(req, res, next) {
  // ⚠️ GEO-GATING INTENTIONALLY DISABLED SITE-WIDE (2026-07-16, explicit
  // user request, made with informed awareness of the compliance
  // implications). Kamino's and Hyperliquid's own terms of service still
  // restrict US persons and OFAC-sanctioned jurisdictions (Cuba, Iran,
  // Syria, North Korea, Russia), and tokenized-equity products like
  // xStocks generally aren't offered to US persons under securities law —
  // none of that changed, only this technical enforcement did. The
  // lookup/QA-bypass logic below is left intact in case this needs to be
  // reinstated before any real compliance review.
  return next();
}

/* ————— Account status — pause/reject enforcement —————
 * Keyed on req.privyUserId, set by requireAuth from a *verified* Privy
 * access token — never a client-supplied wallet address, so a paused user
 * can't route around this by naming a different wallet in the request body.
 * If requireAuth itself is running unauthenticated (no PRIVY_APP_SECRET set,
 * dev/local only — see the fail-open comment above requireAuth), there's no
 * verified identity to check against, so this fails open too, matching
 * requireAuth's own existing dev-mode behavior. */
async function requireActiveAccount(req, res, next) {
  if (!req.privyUserId) return next();
  try {
    const status = await getCustomerStatus(req.privyUserId);
    if (status === "paused") return res.status(403).json({ error: "This account is paused. Contact support." });
    if (status === "rejected") return res.status(403).json({ error: "This account does not have trading access." });
    next();
  } catch (e) {
    console.error(`[account-status] lookup failed (non-fatal, failing open): ${e.message}`);
    next();
  }
}

/* ————— Admin auth — single shared password, not per-person accounts —————
 * Internal ops tool (customer lookup), one operator today. Compares against
 * ADMIN_PASSWORD with a constant-time check so response timing can't leak
 * how many characters matched. No sessions/JWTs — the admin frontend holds
 * the password in sessionStorage and resends it as a header on every
 * request; upgrade to real per-person accounts if/when a team is added. */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: "admin tool not configured" });
  const given = req.headers["x-admin-password"] || "";
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) return res.status(401).json({ error: "invalid admin password" });
  next();
}

// Sponsor gas budget: caps total SOL given away via top-ups per UTC day,
// as a backstop in case the balance check below is ever bypassed.
// In-memory only — resets on restart, not shared across instances.
const SPONSOR_DAILY_CAP_LAMPORTS = Number(process.env.SPONSOR_DAILY_SOL_CAP || 1) * 1e9;
let sponsorSpendDay = null;
let sponsorSpendLamports = 0;
function sponsorBudgetOk(lamports) {
  const today = new Date().toISOString().slice(0, 10);
  if (sponsorSpendDay !== today) { sponsorSpendDay = today; sponsorSpendLamports = 0; }
  return sponsorSpendLamports + lamports <= SPONSOR_DAILY_CAP_LAMPORTS;
}
function trackSponsorSpend(lamports) {
  const today = new Date().toISOString().slice(0, 10);
  if (sponsorSpendDay !== today) { sponsorSpendDay = today; sponsorSpendLamports = 0; }
  sponsorSpendLamports += lamports;
}

// Real, on-chain balance of `mint` held by `owner` — used to refuse sponsoring
// SOL for a "sell" unless the taker actually holds what they claim to sell.
// Without this, /api/order's SOL top-up (below) can be drained by scripting
// requests with freshly generated, unfunded keypairs as `taker`.
async function getTokenBalance(ownerStr, mintStr) {
  const owner = new PublicKey(ownerStr);
  const mint = new PublicKey(mintStr);
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  return value.reduce(
    (sum, { account }) => sum + BigInt(account.data.parsed?.info?.tokenAmount?.amount || 0),
    0n
  );
}

// Price-impact guardrail for /api/order. Jupiter reports priceImpactPct as a
// 0–1 fraction on both Ultra orders and /swap/v1/quote responses; not every
// RFQ quote includes it (market makers quote a fixed price, not a curve), so
// a missing value fails open — we can't enforce a number we don't have.
const MAX_PRICE_IMPACT_PCT = Number(process.env.MAX_PRICE_IMPACT_PCT || 5); // percent
function priceImpactError(rawPct) {
  if (rawPct == null) return null;
  const pct = Number(rawPct) * 100;
  if (Number.isNaN(pct)) return null;
  if (pct > MAX_PRICE_IMPACT_PCT) {
    return `Price impact too high (${pct.toFixed(2)}% > ${MAX_PRICE_IMPACT_PCT}% max) — try a smaller amount`;
  }
  return null;
}

/* ————— tokens ————— */
app.get("/api/tokens", async (_req, res) => {
  try {
    const { bySymbol } = await getRegistry();
    res.json({ tokens: bySymbol, sponsored: !!sponsor });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— prices (Jupiter Price API v3 proxy) ————— */
/** Extracted so the Telegram bot can fetch prices without an HTTP round-trip. */
async function getPricesForMints(allMints) {
  if (!allMints.length) return {};
  // Batch into 100-mint chunks — Jupiter drops mints when the URL exceeds ~4KB
  const BATCH = 50;
  const batches = [];
  for (let i = 0; i < allMints.length; i += BATCH) batches.push(allMints.slice(i, i + BATCH));

  const results = await Promise.all(batches.map(async (chunk) => {
    const r = await fetch(`${JUP_BASE}/price/v3?ids=${encodeURIComponent(chunk.join(","))}`, {
      headers: jupHeaders(),
    });
    if (!r.ok) return {};
    const data = await r.json();
    const raw = data.data || data;
    const out = {};
    for (const [mint, v] of Object.entries(raw)) {
      const p = typeof v === "object" ? (v.usdPrice ?? v.price) : v;
      if (p != null) out[mint] = Number(p);
    }
    return out;
  }));

  return Object.assign({}, ...results);
}

app.get("/api/prices", async (req, res) => {
  try {
    const ids = String(req.query.ids || "").trim();
    if (!ids) return res.json({});
    res.json(await getPricesForMints(ids.split(",").filter(Boolean)));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Slippage preview — public, read-only, no side effects —————
 * Deliberately NOT reusing buildOrder()/Jupiter Ultra: that path has a real
 * side effect on sells (tops up the wallet's SOL for gas before it even
 * returns a quote), which is wrong for a pure "would this trade be risky"
 * preview a user might trigger just by opening a confirm screen. This is
 * the same side-effect-free classic Jupiter quote marketHealth.js already
 * uses for its benchmark check — no taker/wallet needed at all. */
app.get("/api/quote-preview", async (req, res) => {
  try {
    const { inputMint, outputMint, amount } = req.query;
    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({ error: "inputMint, outputMint, amount required" });
    }
    const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: "150" });
    const r = await fetch(`${JUP_BASE}/swap/v1/quote?${params}`, { headers: jupHeaders() });
    // Jupiter can reply with a plain-text body (e.g. rate limiting) instead
    // of JSON — .json() throwing on that shouldn't leak a raw parse-error
    // string to the client, just "no quote available" like any other miss.
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || data.error) return res.json({ error: data?.error || "no route available" });
    res.json({ priceImpactPct: Number(data.priceImpactPct) * 100 });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Liquidity flags — public, trimmed view of the ops market-health
 * snapshot (marketHealth.js). No new computation — the background job
 * already runs this check every 15 minutes for /admin; this just exposes
 * the customer-safe slice (symbol + flagged, nothing else) of the same
 * data so the UI can show a "thin liquidity" indicator before someone
 * even starts building a trade. ————— */
app.get("/api/liquidity-flags", (req, res) => {
  const { brokerage } = getMarketHealthSnapshot();
  res.json(Object.fromEntries(brokerage.map((r) => [r.symbol, r.flagged])));
});

/* ————— Prediction markets (Kalshi via DFlow) — public, browse-only —————
 * See predictionMarkets.js — background-crawled snapshot, fast in-memory
 * read here. Browse-only for now: trading requires Kalshi's mandated
 * identity verification (DFlow's "Proof" KYC partner), not yet wired up —
 * no order/quote endpoints exist here until that's in place.
 *
 * The full snapshot is ~18,500 markets / ~10MB — confirmed via a real test
 * crawl, nowhere near reasonable to ship on a page load. Filter/sort/cap
 * server-side instead of handing the client the whole thing to slice
 * itself, the way EquitiesMarketsApp.jsx can for its ~170 static assets. */
const PREDICTIONS_DEFAULT_LIMIT = 60;
const PREDICTIONS_MAX_LIMIT = 200;
app.get("/api/predictions/markets", (req, res) => {
  const { markets, generatedAt } = getPredictionMarketsSnapshot();
  const category = req.query.category;
  const q = (req.query.q || "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || PREDICTIONS_DEFAULT_LIMIT, PREDICTIONS_MAX_LIMIT);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const categoryCounts = {};
  for (const m of markets) categoryCounts[m.category] = (categoryCounts[m.category] || 0) + 1;

  let filtered = markets;
  if (category) filtered = filtered.filter((m) => m.category === category);
  if (q) filtered = filtered.filter((m) => m.title?.toLowerCase().includes(q) || m.eventTitle?.toLowerCase().includes(q));
  filtered = filtered.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0));

  res.json({
    generatedAt,
    total: filtered.length,
    categoryCounts,
    markets: filtered.slice(offset, offset + limit),
  });
});

/* ————— holdings (RPC, both token programs — xStocks are Token-2022) ————— */
/** Extracted so the Telegram bot can fetch holdings without an HTTP round-trip. */
async function getHoldingsForAddress(address) {
  const owner = new PublicKey(address);
  const { byMint } = await getRegistry();
  const [classic, t22, lamports] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM }),
    connection.getBalance(owner),
  ]);
  const tokens = [];
  for (const { account } of [...classic.value, ...t22.value]) {
    const info = account.data.parsed?.info;
    if (!info) continue;
    const mint = info.mint;
    const amt = info.tokenAmount;
    if (!amt || Number(amt.amount) === 0) continue;
    const known = byMint[mint];
    tokens.push({
      mint,
      symbol: known?.symbol || null,
      name: known?.name || null,
      decimals: amt.decimals,
      amount: amt.amount, // atomic, string
      uiAmount: amt.uiAmount,
    });
  }
  return { sol: lamports / 1e9, tokens };
}

app.get("/api/holdings/:address", async (req, res) => {
  try {
    res.json(await getHoldingsForAddress(req.params.address));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Claude: prompt → target allocations ————— */
/**
 * Prompt → target allocations, extracted from the /api/parse handler so the
 * Telegram bot can reuse the exact same parsing logic (including the
 * existing "sell X for cash" partial-sell rule below) without an HTTP
 * round-trip to itself.
 */
async function parsePromptToAllocations({ prompt, current, total }) {
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set on server");
    if (!prompt) throw new Error("prompt required");
    const { bySymbol } = await getRegistry();
    const xStocks = Object.values(bySymbol)
      .filter((t) => !NON_XSTOCK_SYMBOLS.includes(t.symbol))
      .map((t) => `${t.symbol} — ${t.name}`)
      .join("\n");
    const minPct = total > 0 ? Math.ceil((0.25 / total) * 100 * 2) : 2; // minimum % that produces >$0.25 trade (2× buffer)
    const currentBlock = current?.length
      ? `\nCURRENT PORTFOLIO (treat the instruction as a modification; return the complete new target):\n` +
        current.map((c) => `${c.symbol}: ${c.weight.toFixed(1)}%`).join("\n")
      : "";
    const system = `You convert plain-English portfolio instructions into JSON allocations for a tokenized-equity platform on Solana. The settlement currency is USDC (cash) — it is NOT a holdable position in allocations.

Equities / ETFs (symbol — name):
${xStocks}

Yield / Cash-equivalent (USD-denominated — no currency risk):
USDY — US Dollar Yield (Ondo Finance · tokenized T-bills · ~5% APY)

Foreign Sovereign Bonds (yield-bearing, but priced in and exposed to the named foreign currency — NOT cash-equivalent, only use when the user names that country/currency specifically):
KTB — Korean Treasury Bond (Etherfuse · KRW exposure · ~2.5% APY)
CETES — Mexican CETES (Etherfuse · MXN exposure · ~5.5% APY)
TESOURO — Brazilian Tesouro (Etherfuse · BRL exposure · ~12.8% APY)
GILTS — UK Gilts (Etherfuse · GBP exposure · ~3.2% APY)

Crypto:
BTC — Bitcoin (Coinbase Wrapped BTC on Solana)

Currency:
EURC — Euro (Circle, euro-pegged stablecoin)

Rules:
- Respond with ONLY a JSON object. No markdown, no backticks, no prose.
- Shape: {"allocations":[{"symbol":"AAPLx","weight":25}],"summary":"one short plain sentence"}
- Weights are direct percentages of the TOTAL PORTFOLIO (stocks + cash combined). The remainder automatically stays as USDC cash.
- For a full rebalance (e.g. "go 50/50 AAPL and Tesla"), weights should sum to 100.
- PARTIAL SELL: When the user says "sell X", "sell X for cash", "trim X", or "remove X" without specifying where to redeploy, keep ALL other positions at their EXACT current weights from CURRENT PORTFOLIO. Do NOT renormalize them. The weights will sum to less than 100 — that is intentional and correct; the difference stays as USDC cash.
- "Sell everything", "go to cash", "liquidate" → return {"allocations":[],"summary":"..."}.
- NEVER include USDC in allocations. If the user asks to hold cash/USDC, return empty allocations.
- Honor explicit weights the user gives; otherwise equal-weight the requested positions.
- Map company/index names to symbols (Apple→AAPLx, S&P 500→SPYx, Nasdaq→QQQx, etc). Use only listed symbols.
- Map generic yield/treasury/T-bill/cash-yield requests (no country named) to USDY — it's the safe, USD-denominated default. Only map to a Foreign Sovereign Bond (KTB/CETES/TESOURO/GILTS) when the user names that specific country or currency (e.g. "Korean bonds"→KTB, "Mexican treasuries"→CETES, "Brazilian debt"→TESOURO, "UK gilts"→GILTS) — these carry real FX exposure the user should be explicitly opting into, not a substitute for a generic yield request.
- Map bitcoin/BTC requests to BTC.
- Map euro/EUR/EURC requests to EURC.
- If something requested isn't available, leave it out and say so in "summary".
- MINIMUM TRADE SIZE: Each individual allocation change must be at least $0.25 in dollar terms. Portfolio total is ~$${total ? Number(total).toFixed(2) : "unknown"}. The minimum meaningful weight change is ${minPct}%. If the user requests a smaller shift, round up to at least ${minPct}% so the trade can actually execute. Mention the rounding in your summary.${currentBlock}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    const raw_text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const jsonMatch = raw_text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude returned no JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    const raw = parsed.allocations || [];
    // Filter to known, non-USDC symbols
    const allocations = raw.filter((a) => bySymbol[a.symbol] && a.symbol !== "USDC");
    // If Claude returned symbols but NONE matched, that's a real error (e.g. unsupported asset)
    if (raw.length > 0 && allocations.length === 0)
      throw new Error("none of the requested assets are available on this platform");
    // Empty allocations is valid — means "sell everything, go to cash"
    if (allocations.length > 0) {
      const sum = allocations.reduce((a, x) => a + Number(x.weight || 0), 0);
      // Only normalize if weights exceed 100 (user gave numbers that don't add up).
      // If sum < 100, the remainder is intentional cash — do NOT renormalize.
      if (sum > 101) {
        allocations.forEach((a) => (a.weight = +((a.weight / sum) * 100).toFixed(2)));
      }
    }
    return { allocations, summary: parsed.summary || "" };
}

app.post("/api/parse", requireAuth, parseLimiter, async (req, res) => {
  try {
    const { prompt, current, total } = req.body || {};
    const result = await parsePromptToAllocations({ prompt, current, total });
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: String(e.message || e) });
  }
});

/**
 * Prompt → structured perps-order intent (asset/side/leverage/size), for the
 * dashboard's "buy SOL perp at 5x with all my cash"-style prompts. Kept
 * completely separate from parsePromptToAllocations() above — perps orders
 * are a single discrete action (asset + side + leverage + size), not a
 * portfolio-weight target, so the allocation-sum schema doesn't fit.
 *
 * Deliberately does NOT compute any real dollar figures — Claude only
 * extracts the linguistic intent (a ticker guess, long/short, a leverage
 * number, and a size INTENT like "all"/a percent/a dollar amount/an asset
 * quantity). The client resolves that intent against live account data
 * (real markPrice, real withdrawable margin, the real tradable-asset list)
 * before ever showing a number a user could sign against — same safety
 * split as parsePromptToAllocations relying on planTrades() for real math.
 */
async function parsePerpPrompt({ prompt }) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set on server");
  if (!prompt) throw new Error("prompt required");

  const system = `You extract structured perpetual-futures order intent from a plain-English trading command, for a Hyperliquid-powered leveraged trading product.

Respond with ONLY a JSON object. No markdown, no backticks, no prose.
Shape: {"action":"open","asset":"SOL","side":"long","leverage":5,"sizeType":"all","sizeValue":null,"summary":"one short plain sentence"}

Fields:
- "action": "close" if the user wants to close/exit an EXISTING position (e.g. "close my SOL position", "exit my BTC long", "get out of my AAPL perp"). Otherwise "open" (they want to open/increase a new position — buy/long/sell/short).
- "asset": your best-guess TICKER SYMBOL for the crypto coin or company/ETF the user named (e.g. "Solana"→"SOL", "Bitcoin"→"BTC", "Apple"→"AAPL", "Tesla"→"TSLA"). Uppercase, no suffix. If you cannot identify a specific asset, use null.
- "side": "long" or "short". Map "buy"/"go long"/"long" → "long". Map "sell"/"go short"/"short" → "short". If genuinely ambiguous, or action is "close" and no side was stated, use null — the close target's real side will be looked up separately.
- "leverage": the leverage multiplier as a plain integer (e.g. "5x leverage" → 5). null if not mentioned. Not needed when action is "close".
- "sizeType": one of "all" (user said something like "all my cash/margin/available balance"), "percent" (user gave a percentage of their account), "usd" (user gave a specific dollar amount they want exposed), "asset_amount" (user gave a specific quantity of the asset itself, e.g. "10 SOL"), or "unspecified" (no sizing info given at all). Not needed when action is "close" — use "unspecified".
- "sizeValue": the number that goes with sizeType — the percent (0-100) for "percent", the dollar amount for "usd", the asset quantity for "asset_amount". null for "all" or "unspecified".
- "summary": one short plain sentence restating what you understood, for the user to double check.

Rules:
- NEVER compute or guess a real dollar amount yourself — only extract what the user actually said.
- If leverage isn't mentioned, "leverage" must be null — do not default to 1x or any other number.
- If no asset is identifiable, "asset" must be null.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  const raw_text = (data.content || [])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const jsonMatch = raw_text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON");
  const parsed = JSON.parse(jsonMatch[0]);

  const action = parsed.action === "close" ? "close" : "open";
  if (!parsed.asset) throw new Error("Couldn't identify which asset you mean — try naming it directly, e.g. \"SOL\".");

  if (action === "open") {
    if (parsed.side !== "long" && parsed.side !== "short") throw new Error("Couldn't tell if that's a long or short — try saying \"buy\"/\"long\" or \"sell\"/\"short\".");
    if (parsed.leverage != null && (!(parsed.leverage > 0) || parsed.leverage > 100))
      throw new Error("That leverage amount doesn't look right.");
    const validSizeTypes = ["all", "percent", "usd", "asset_amount", "unspecified"];
    if (!validSizeTypes.includes(parsed.sizeType)) parsed.sizeType = "unspecified";
    if (parsed.sizeType === "percent" && !(parsed.sizeValue > 0 && parsed.sizeValue <= 100))
      throw new Error("That percentage doesn't look right.");
    if ((parsed.sizeType === "usd" || parsed.sizeType === "asset_amount") && !(parsed.sizeValue > 0))
      throw new Error("Couldn't find a valid amount in that.");
  }

  return {
    action,
    asset: String(parsed.asset).toUpperCase(),
    side: parsed.side === "long" || parsed.side === "short" ? parsed.side : null,
    leverage: parsed.leverage ?? null,
    sizeType: parsed.sizeType || "unspecified",
    sizeValue: parsed.sizeValue ?? null,
    summary: parsed.summary || "",
  };
}

app.post("/api/parse-perp", requireAuth, parseLimiter, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    const result = await parsePerpPrompt({ prompt });
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: String(e.message || e) });
  }
});

/**
 * Prompt → structured Kamino borrow/lend intent, for prompts like "deposit
 * my AAPL as collateral and borrow $500 USDC against it". Same split as
 * parsePerpPrompt above — Claude only extracts what was said (which xStock,
 * a deposit size INTENT, a borrow size INTENT); the client resolves those
 * against real held balances, real reserve maxLTVs, and real existing
 * obligation room before ever building a signable transaction.
 */
async function parseBorrowPrompt({ prompt }) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set on server");
  if (!prompt) throw new Error("prompt required");

  const system = `You extract structured Kamino borrow/lend intent from a plain-English command, for a product where a user deposits an already-held tokenized stock ("xStock") as collateral, borrows USDC against it, and can later repay that debt and/or withdraw the collateral back.

Respond with ONLY a JSON object. No markdown, no backticks, no prose.
Shape: {"action":"deposit_and_borrow","asset":"AAPL","depositSizeType":"all","depositSizeValue":null,"borrowSizeType":"usd","borrowSizeValue":500,"repaySizeType":"unspecified","repaySizeValue":null,"withdrawSizeType":"unspecified","withdrawSizeValue":null,"summary":"one short plain sentence"}

Fields:
- "action": one of
  - "deposit" — only post collateral, don't borrow.
  - "borrow" — only borrow, against collateral already deposited, no new deposit.
  - "deposit_and_borrow" — post collateral AND borrow against it in the same command.
  - "repay" — only pay down USDC debt, e.g. "pay back my loan", "repay $200".
  - "withdraw" — only withdraw collateral back to the wallet, e.g. "withdraw my TSLA", "take out my AAPL collateral".
  - "repay_and_withdraw" — pay down debt AND withdraw collateral in the same command, e.g. "pay back my loan and withdraw my TSLA".
- "asset": the TICKER of the stock/ETF, WITHOUT any trailing "x" suffix (e.g. "Apple"→"AAPL"). Needed for deposit/deposit_and_borrow (what to post as collateral) and withdraw/repay_and_withdraw (what collateral to withdraw). null for borrow/repay (no specific asset needed — debt is always USDC).
- "depositSizeType": one of "all", "percent", "units" (a specific share count), "usd" (a specific dollar value), or "unspecified". Only relevant for deposit/deposit_and_borrow.
- "depositSizeValue": the number paired with depositSizeType. null for "all"/"unspecified".
- "borrowSizeType": one of "all", "percent", "usd", or "unspecified". Only relevant for borrow/deposit_and_borrow.
- "borrowSizeValue": the number paired with borrowSizeType. null for "all"/"unspecified".
- "repaySizeType": one of "all" (pay off the full loan — map "pay back my loan"/"repay everything" here), "percent", "usd", or "unspecified". Only relevant for repay/repay_and_withdraw.
- "repaySizeValue": the number paired with repaySizeType. null for "all"/"unspecified".
- "withdrawSizeType": one of "all", "percent", "units", "usd", or "unspecified". Only relevant for withdraw/repay_and_withdraw. Map "withdraw my TSLA" (no amount given) to "all".
- "withdrawSizeValue": the number paired with withdrawSizeType. null for "all"/"unspecified".
- "summary": one short plain sentence restating what you understood.

Rules:
- NEVER compute or guess a real dollar amount yourself — only extract what the user actually said.
- Only fill in the size fields relevant to the chosen action — leave the rest "unspecified"/null.
- "Pay back my loan and withdraw my TSLA" → action "repay_and_withdraw", asset "TSLA", repaySizeType "all", withdrawSizeType "all".`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  const raw_text = (data.content || [])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const jsonMatch = raw_text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON");
  const parsed = JSON.parse(jsonMatch[0]);

  const validActions = ["deposit", "borrow", "deposit_and_borrow", "repay", "withdraw", "repay_and_withdraw"];
  const action = validActions.includes(parsed.action) ? parsed.action : null;
  if (!action) throw new Error("Couldn't tell what to do — try \"deposit\", \"borrow\", \"repay\", or \"withdraw\".");

  const needsAsset = ["deposit", "deposit_and_borrow", "withdraw", "repay_and_withdraw"].includes(action);
  const needsDepositSize = ["deposit", "deposit_and_borrow"].includes(action);
  const needsBorrowSize = ["borrow", "deposit_and_borrow"].includes(action);
  const needsRepaySize = ["repay", "repay_and_withdraw"].includes(action);
  const needsWithdrawSize = ["withdraw", "repay_and_withdraw"].includes(action);

  if (needsAsset && !parsed.asset)
    throw new Error("Couldn't identify which stock you mean — try naming it directly, e.g. \"AAPL\".");

  const validDepositSizeTypes = ["all", "percent", "units", "usd", "unspecified"];
  if (!validDepositSizeTypes.includes(parsed.depositSizeType)) parsed.depositSizeType = "unspecified";
  if (needsDepositSize) {
    if (parsed.depositSizeType === "unspecified") throw new Error('Say how much to deposit, e.g. "all my AAPL" or "10 shares".');
    if (parsed.depositSizeType === "percent" && !(parsed.depositSizeValue > 0 && parsed.depositSizeValue <= 100))
      throw new Error("That percentage doesn't look right.");
    if ((parsed.depositSizeType === "units" || parsed.depositSizeType === "usd") && !(parsed.depositSizeValue > 0))
      throw new Error("Couldn't find a valid deposit amount in that.");
  }

  const validBorrowSizeTypes = ["all", "percent", "usd", "unspecified"];
  if (!validBorrowSizeTypes.includes(parsed.borrowSizeType)) parsed.borrowSizeType = "unspecified";
  if (needsBorrowSize) {
    if (parsed.borrowSizeType === "unspecified") throw new Error('Say how much to borrow, e.g. "$500 USDC" or "all of it".');
    if (parsed.borrowSizeType === "percent" && !(parsed.borrowSizeValue > 0 && parsed.borrowSizeValue <= 100))
      throw new Error("That percentage doesn't look right.");
    if (parsed.borrowSizeType === "usd" && !(parsed.borrowSizeValue > 0))
      throw new Error("Couldn't find a valid borrow amount in that.");
  }

  const validRepaySizeTypes = ["all", "percent", "usd", "unspecified"];
  if (!validRepaySizeTypes.includes(parsed.repaySizeType)) parsed.repaySizeType = "unspecified";
  if (needsRepaySize) {
    if (parsed.repaySizeType === "unspecified") throw new Error('Say how much to repay, e.g. "pay off my loan" or "$200".');
    if (parsed.repaySizeType === "percent" && !(parsed.repaySizeValue > 0 && parsed.repaySizeValue <= 100))
      throw new Error("That percentage doesn't look right.");
    if (parsed.repaySizeType === "usd" && !(parsed.repaySizeValue > 0))
      throw new Error("Couldn't find a valid repay amount in that.");
  }

  const validWithdrawSizeTypes = ["all", "percent", "units", "usd", "unspecified"];
  if (!validWithdrawSizeTypes.includes(parsed.withdrawSizeType)) parsed.withdrawSizeType = "unspecified";
  if (needsWithdrawSize) {
    if (parsed.withdrawSizeType === "unspecified") throw new Error('Say how much to withdraw, e.g. "all my TSLA" or "5 shares".');
    if (parsed.withdrawSizeType === "percent" && !(parsed.withdrawSizeValue > 0 && parsed.withdrawSizeValue <= 100))
      throw new Error("That percentage doesn't look right.");
    if ((parsed.withdrawSizeType === "units" || parsed.withdrawSizeType === "usd") && !(parsed.withdrawSizeValue > 0))
      throw new Error("Couldn't find a valid withdraw amount in that.");
  }

  return {
    action,
    asset: parsed.asset ? String(parsed.asset).toUpperCase() : null,
    depositSizeType: parsed.depositSizeType,
    depositSizeValue: parsed.depositSizeValue ?? null,
    borrowSizeType: parsed.borrowSizeType,
    borrowSizeValue: parsed.borrowSizeValue ?? null,
    repaySizeType: parsed.repaySizeType,
    repaySizeValue: parsed.repaySizeValue ?? null,
    withdrawSizeType: parsed.withdrawSizeType,
    withdrawSizeValue: parsed.withdrawSizeValue ?? null,
    summary: parsed.summary || "",
  };
}

app.post("/api/parse-borrow", requireAuth, parseLimiter, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    const result = await parseBorrowPrompt({ prompt });
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: String(e.message || e) });
  }
});

/* ————— Jupiter Ultra: order ————— */
// Thrown by buildOrder with an explicit HTTP status the caller should use —
// lets both the HTTP handler and internal callers (e.g. the Telegram bot,
// which has no res object) get the same precise error semantics.
class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Core Jupiter order-building logic, extracted so it can be called both from
 * the HTTP handler below and internally (e.g. by the Telegram bot flow,
 * which signs via PrivyClient.walletApi instead of returning to a browser).
 * Throws OrderError with the right status on any failure.
 */
async function buildOrder({ inputMint, outputMint, amount, taker }) {
  if (!inputMint || !outputMint || !amount || !taker)
    throw new OrderError(400, "inputMint, outputMint, amount, taker required");

  // Sells (xStock → USDC) use Jupiter Ultra RFQ — the only reliable liquidity
  // for xStock sells. RFQ orders expire in ~52s, so we must top up SOL FIRST
  // (before fetching the order) so the TTL doesn't run out during the top-up wait.
  const isSell = inputMint !== USDC.mint;
  if (isSell) {
    // Refuse to sponsor gas unless the taker actually holds what they claim to
    // sell — otherwise this endpoint is a free SOL faucet for any freshly
    // generated, unfunded keypair (see /api/order rate limiter + daily cap too).
    if (sponsor) {
      const held = await getTokenBalance(taker, inputMint);
      if (held < BigInt(amount)) {
        throw new OrderError(400, "insufficient token balance for this sell");
      }
    }

    // 1. Ensure taker has SOL for rent fees before the order clock starts.
    if (sponsor) {
      const MIN_SOL = 5_000_000; // 0.005 SOL — covers rent + fee buffer
      const balance = await connection.getBalance(new PublicKey(taker));
      if (balance < MIN_SOL) {
        const topup = MIN_SOL - balance;
        if (!sponsorBudgetOk(topup)) {
          throw new OrderError(503, "Sponsor gas budget exhausted for today — please fund your wallet with a small amount of SOL");
        }
        console.log(`[order/sell] topping up ${taker.slice(0,8)} with ${topup} lamports`);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey });
        fundTx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: new PublicKey(taker), lamports: topup }));
        fundTx.sign(sponsor);
        const sig = await connection.sendRawTransaction(fundTx.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        trackSponsorSpend(topup);
        console.log(`[order/sell] top-up confirmed: ${sig}`);
      }
    }

    // 2. Fetch a fresh RFQ order NOW — taker already has SOL, so TTL won't expire
    //    before the client signs and submits.
    const params = new URLSearchParams({ inputMint, outputMint, amount, taker });
    applyReferralFee(params);
    const r = await fetch(`${JUP_BASE}/ultra/v1/order?${params}`, { headers: jupHeaders() });
    const data = await r.json();

    if (!r.ok || data.error) {
      const rfqError = data.error || `order HTTP ${r.status}`;
      console.log(`[order/sell] RFQ failed: "${rfqError}" — trying AMM fallback`);

      // RFQ market makers often reject small amounts. Fall back to Jupiter AMM swap.
      try {
        // AMM uses the taker as fee payer (no sponsor payer param), so needs more SOL
        // than the RFQ top-up: covers priority fees + up to 3 ATA creations.
        if (sponsor) {
          const AMM_MIN_SOL = 20_000_000; // 0.02 SOL
          const ammBalance = await connection.getBalance(new PublicKey(taker));
          if (ammBalance < AMM_MIN_SOL) {
            const topup = AMM_MIN_SOL - ammBalance;
            if (!sponsorBudgetOk(topup)) {
              throw new OrderError(503, "Sponsor gas budget exhausted for today — please fund your wallet with a small amount of SOL");
            }
            console.log(`[order/sell/amm] topping up ${taker.slice(0,8)} with ${topup} lamports`);
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey });
            fundTx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: new PublicKey(taker), lamports: topup }));
            fundTx.sign(sponsor);
            const sig = await connection.sendRawTransaction(fundTx.serialize());
            await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
            trackSponsorSpend(topup);
            console.log(`[order/sell/amm] top-up confirmed: ${sig}`);
          }
        }

        const quoteParams = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: "150" });
        const qr = await fetch(`${JUP_BASE}/swap/v1/quote?${quoteParams}`, { headers: jupHeaders() });
        const quote = await qr.json();
        if (!qr.ok || quote.error) throw new Error(quote.error || "no AMM quote available");

        const ammImpactErr = priceImpactError(quote.priceImpactPct);
        if (ammImpactErr) {
          console.log(`[order/sell/amm] blocked: ${ammImpactErr}`);
          throw new OrderError(400, ammImpactErr);
        }

        const swapR = await fetch(`${JUP_BASE}/swap/v1/swap`, {
          method: "POST",
          headers: { "content-type": "application/json", ...jupHeaders() },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: taker,
            wrapAndUnwrapSol: false,
            prioritizationFeeLamports: 500_000, // cap at 0.0005 SOL to keep cost predictable
          }),
        });
        const swapData = await swapR.json();
        if (!swapR.ok || swapData.error) throw new Error(swapData.error || "AMM swap build failed");
        if (!swapData.swapTransaction) throw new Error("AMM swap: no transaction returned");

        console.log(`[order/sell] AMM fallback success for ${inputMint.slice(0,8)}→${outputMint.slice(0,8)}`);
        return { transaction: swapData.swapTransaction, _swapV1: true, _isSell: true, _sponsored: false };
      } catch (ammErr) {
        if (ammErr instanceof OrderError) throw ammErr; // explicit status — don't overwrite below
        console.log(`[order/sell] AMM fallback also failed: ${ammErr.message}`);
        throw new OrderError(502, rfqError.toLowerCase().includes("market maker")
          ? "Trade amount too small for available liquidity — try selling a larger quantity"
          : rfqError);
      }
    }

    const rfqImpactErr = priceImpactError(data.priceImpactPct);
    if (rfqImpactErr) {
      console.log(`[order/sell] blocked: ${rfqImpactErr}`);
      throw new OrderError(400, rfqImpactErr);
    }

    console.log(`[order/sell] ${inputMint.slice(0,8)}→${outputMint.slice(0,8)} amount=${amount} swapType=${data.swapType} ttl=${data.expireAt - Math.floor(Date.now()/1000)}s feeBps=${data.feeBps ?? "none"} feeMint=${data.feeMint ?? "none"}`);
    data._sponsored = false;
    data._swapV1 = false;
    data._isSell = true;
    return data;
  }

  // Buy path: use Jupiter Ultra (handles sponsorship via payer param).
  const params = new URLSearchParams({ inputMint, outputMint, amount, taker });
  if (sponsor) params.set("payer", sponsor.publicKey.toBase58());
  applyReferralFee(params);
  let r = await fetch(`${JUP_BASE}/ultra/v1/order?${params}`, { headers: jupHeaders() });
  let data = await r.json();
  if ((!r.ok || data.error) && sponsor) {
    params.delete("payer");
    r = await fetch(`${JUP_BASE}/ultra/v1/order?${params}`, { headers: jupHeaders() });
    data = await r.json();
    data._sponsored = false;
  } else {
    data._sponsored = !!sponsor;
  }
  if (!r.ok || data.error) throw new OrderError(502, data.error || `order HTTP ${r.status}`);

  const buyImpactErr = priceImpactError(data.priceImpactPct);
  if (buyImpactErr) {
    console.log(`[order/buy] blocked: ${buyImpactErr}`);
    throw new OrderError(400, buyImpactErr);
  }

  console.log(`[order/buy] ${inputMint.slice(0,8)}→${outputMint.slice(0,8)} amount=${amount} sponsored=${data._sponsored} feeBps=${data.feeBps ?? "none"} feeMint=${data.feeMint ?? "none"}`);
  return data;
}

app.get("/api/order", requireAuth, requireAllowedGeo, requireActiveAccount, orderLimiter, async (req, res) => {
  try {
    const data = await buildOrder(req.query);
    res.json(data);
  } catch (e) {
    const status = e instanceof OrderError ? e.status : 502;
    res.status(status).json({ error: String(e.message || e) });
  }
});

/* ————— Jupiter Ultra: execute (co-sign with sponsor if configured) ————— */
/**
 * Sign-confirmation → execution logic, extracted from the /api/execute
 * handler so the Telegram bot (which signs via PrivyClient.walletApi
 * instead of a browser) can reuse the exact same sponsor co-signing /
 * Jupiter execute / direct-RPC-fallback logic. Returns Jupiter's response
 * data as-is on a 200-level outcome (caller must still check
 * `data.status !== "Success"` the same way the web client does — Jupiter
 * can return 200 with a Failed status); throws OrderError only for hard
 * failures (bad input, non-ok HTTP).
 */
async function executeSignedOrder({ signedTransaction, requestId, sponsored, swapV1, isSell }) {
  if (!signedTransaction) throw new OrderError(400, "signedTransaction required");

  // Legacy AMM sell path — submit directly to Solana RPC. Also reused as a
  // generic "broadcast this signed tx" path by Kamino deposit/borrow/repay/
  // withdraw (see comment above /api/kamino/reserves) — isSell distinguishes
  // the two below, since it's only ever set on the xStock AMM-fallback sell.
  if (swapV1) {
    const tx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, "base64"));
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    try {
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`[execute/sell-amm] confirmed: ${sig}`);
      return { status: "Success", signature: sig };
    } catch (e) {
      // Solana's SendTransactionError dumps raw simulation logs and program
      // error codes — confirmed as a real bug against a real customer-facing
      // failure: this went straight to the UI unfiltered ("Simulation
      // failed. Message: ... custom program error: 0x1"), no translation at
      // all. For xStock AMM-fallback sells (isSell), the known cause is
      // almost always the trade being too small for this pool's liquidity
      // right now — the same reason Jupiter's RFQ already rejected it before
      // this fallback ever ran — so surface that instead of the raw dump.
      // Other swapV1 callers (Kamino) keep a less presumptive message, since
      // this path is shared and the real cause there could be anything.
      console.error(`[execute/swapV1] failed:`, e.message);
      if (isSell) {
        throw new OrderError(400, "Trade amount too small for available liquidity — try selling a larger quantity");
      }
      throw new OrderError(502, "Transaction failed on-chain — please try again.");
    }
  }

  // Buy (and RFQ sell) path: Jupiter Ultra execute.
  if (!requestId) throw new OrderError(400, "requestId required");
  let tx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, "base64"));
  const sigCount = tx.signatures.filter((s) => s.some(Boolean)).length;
  console.log(`[execute] isSell=${!!isSell} sigCount=${sigCount} requestId=${requestId?.slice(0,12)}`);
  const feePayer = tx.message.staticAccountKeys[0].toBase58();
  if (sponsor && sponsored) {
    if (feePayer !== sponsor.publicKey.toBase58())
      throw new OrderError(502, "refusing to co-sign: fee payer mismatch");
    tx.sign([sponsor]);
    signedTransaction = Buffer.from(tx.serialize()).toString("base64");
  }
  const r = await fetch(`${JUP_BASE}/ultra/v1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", ...jupHeaders() },
    body: JSON.stringify({ signedTransaction, requestId }),
  });
  const data = await r.json();
  const jupFailed = !r.ok || data.error || (data.status && data.status !== "Success");
  if (jupFailed) console.error("[execute] Jupiter error:", JSON.stringify(data));

  // RFQ sell fallback: if Jupiter execute fails with Internal error, the market maker
  // may have already pre-signed the tx at order time — try submitting directly to Solana.
  if (jupFailed && isSell) {
    console.log("[execute/sell] Jupiter RFQ failed — trying direct Solana RPC submission");
    try {
      const rawTx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, "base64"));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const sig = await connection.sendRawTransaction(rawTx.serialize(), {
        skipPreflight: true, // surface on-chain errors in logs instead of simulation errors
        maxRetries: 3,
      });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`[execute/sell] direct RPC confirmed: ${sig}`);
      return { status: "Success", signature: sig };
    } catch (rpcErr) {
      console.error("[execute/sell] direct RPC also failed:", rpcErr.message);
      // Fall through — return the original Jupiter error
    }
  }

  if (!r.ok) throw new OrderError(502, data.error || "execute failed");
  return data;
}

app.post("/api/execute", requireAuth, requireAllowedGeo, requireActiveAccount, orderLimiter, async (req, res) => {
  try {
    const { logMeta, ...orderBody } = req.body || {};
    const result = await executeSignedOrder(orderBody);
    // Descriptive-only — logMeta is never trusted for authorization, only
    // for what the ops view shows. The client already knows what it's
    // doing (symbol/side/kind/wallet) at the moment it calls execute;
    // reconstructing that from raw tx bytes here would be far less
    // reliable. Missing wallet means nothing useful to key the row on, so
    // skip logging rather than guess.
    if (logMeta?.walletAddress) {
      logActivity({
        walletAddress: logMeta.walletAddress,
        privyUserId: req.privyUserId,
        kind: logMeta.kind || "swap",
        symbol: logMeta.symbol,
        side: logMeta.side,
        usdValue: logMeta.usdValue,
        signature: result?.signature,
        details: logMeta.details,
      });
      // Reached only after executeSignedOrder has already confirmed
      // success above (a throw would've hit the catch block instead) —
      // never speculative. This is what clears the borrow-blocking check
      // in the /api/kamino/borrow loop above.
      if (logMeta.kind === "kamino_borrow_fee" && logMeta.details?.obligationId) {
        markKaminoFeeObligationPaid(logMeta.details.obligationId, result?.signature);
      }
    }
    res.json(result);
  } catch (e) {
    const status = e instanceof OrderError ? e.status : 502;
    res.status(status).json({ error: String(e.message || e) });
  }
});

/* ————— SPL transfer builder — shared by withdrawals and the Kamino ————— *
 * deposit fee below. Token-2022 vs. plain-SPL detection, idempotent
 * destination-ATA creation, TransferChecked vs. Transfer encoding — one
 * tested implementation, not duplicated per caller. */
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function deriveAta(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

async function buildTransferTx({ from, to, amount, mint: mintStr, decimals: decimalsNum }) {
  if (!from || !to || !amount) throw new OrderError(400, "from, to, amount required");

  const fromPubkey = new PublicKey(from);
  const toPubkey   = new PublicKey(to);
  const mintPubkey = new PublicKey(mintStr || USDC.mint);

  // Determine which token program owns this mint by inspecting on-chain
  const mintInfo = await connection.getAccountInfo(mintPubkey);
  if (!mintInfo) throw new OrderError(400, "mint not found on-chain");
  const tokenProgramId = mintInfo.owner;
  const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM);

  const fromAta = deriveAta(fromPubkey, mintPubkey, tokenProgramId);
  const toAta   = deriveAta(toPubkey,   mintPubkey, tokenProgramId);

  const instructions = [];

  // Create destination ATA if it doesn't exist (idempotent)
  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    instructions.push(new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: fromPubkey,              isSigner: true,  isWritable: true  },
        { pubkey: toAta,                   isSigner: false, isWritable: true  },
        { pubkey: toPubkey,                isSigner: false, isWritable: false },
        { pubkey: mintPubkey,              isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgramId,          isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // 1 = CreateIdempotent
    }));
  }

  let transferData;
  let transferKeys;
  if (isToken2022) {
    // TransferChecked (instruction 12) — required for Token-2022 extensions
    const decimals = decimalsNum ?? 8;
    transferData = Buffer.alloc(10);
    transferData[0] = 12;
    transferData.writeBigUInt64LE(BigInt(amount), 1);
    transferData[9] = decimals;
    transferKeys = [
      { pubkey: fromAta,    isSigner: false, isWritable: true  },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: toAta,      isSigner: false, isWritable: true  },
      { pubkey: fromPubkey, isSigner: true,  isWritable: false },
    ];
  } else {
    // Transfer (instruction 3) — standard Token program
    transferData = Buffer.alloc(9);
    transferData[0] = 3;
    transferData.writeBigUInt64LE(BigInt(amount), 1);
    transferKeys = [
      { pubkey: fromAta,    isSigner: false, isWritable: true  },
      { pubkey: toAta,      isSigner: false, isWritable: true  },
      { pubkey: fromPubkey, isSigner: true,  isWritable: false },
    ];
  }

  instructions.push(new TransactionInstruction({
    programId: tokenProgramId,
    keys: transferKeys,
    data: transferData,
  }));

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const transaction = Buffer.from(tx.serialize()).toString("base64");
  console.log(`[transfer] ${short(from)}→${short(to)} mint=${mintStr || USDC.mint} amount=${amount} token2022=${isToken2022}`);
  return { transaction };
}

app.post("/api/withdraw", requireAuth, requireAllowedGeo, requireActiveAccount, orderLimiter, async (req, res) => {
  try {
    const { transaction } = await buildTransferTx(req.body || {});
    res.json({ transaction });
  } catch (e) {
    const status = e instanceof OrderError ? e.status : 400;
    res.status(status).json({ error: String(e.message || e) });
  }
});

/**
 * Kamino borrow fee (0.10%) — builds a transfer of the fee amount straight
 * to our own wallet, entirely separate from Kamino's own protocol/referrer
 * mechanics (their hosted transaction-building API has no fee-passthrough
 * param — confirmed against its live OpenAPI spec). `to` is hardcoded to
 * our own sponsor wallet, never taken from the client, same reasoning as
 * buildOrder() always hardcoding referralAccountPubkey() rather than
 * trusting a client-supplied fee destination.
 *
 * `amount`/`mint` are NOT taken from the client (a prior version trusted
 * them directly — a real, live fee-bypass: a client could call this with
 * amount:1 and pay essentially nothing regardless of what was actually
 * borrowed, since nothing tied this call to a specific borrow at all).
 * The only thing trusted here is `from` — the fee amount always comes from
 * the wallet's own pending obligation row, written server-side at borrow
 * time in the SAME amount used to build that borrow's transaction (see the
 * kamino action loop below), so it can't be under-reported.
 */
app.post("/api/kamino/fee", requireAuth, requireAllowedGeo, requireActiveAccount, orderLimiter, async (req, res) => {
  try {
    if (!sponsor) return res.status(503).json({ error: "fee collection not configured" });
    const { from } = req.body || {};
    if (!from) return res.status(400).json({ error: "from required" });
    const obligation = await getUnpaidKaminoFeeObligation(from);
    if (!obligation) return res.status(400).json({ error: "no outstanding platform fee for this wallet" });
    const { transaction } = await buildTransferTx({
      from, to: sponsor.publicKey.toBase58(),
      amount: obligation.fee_atoms, mint: USDC.mint, decimals: USDC.decimals,
    });
    res.json({ transaction, obligationId: obligation.id, feeAtoms: Number(obligation.fee_atoms), amountUsd: Number(obligation.amount_usd) });
  } catch (e) {
    const status = e instanceof OrderError ? e.status : 400;
    res.status(status).json({ error: String(e.message || e) });
  }
});

function short(a) { return a ? `${a.slice(0, 8)}…` : ""; }

/* ————— Kamino xStocks Market: borrow USDC against xStocks holdings —————
 * Real, live lending market confirmed directly against Kamino's own API
 * before building this (see kamino.js header comment for the verification
 * trail) — not speculative. Read-only market/position data stays ungated,
 * same as the perps/deBridge quote endpoints; the four tx-building actions
 * are state-changing (they don't move funds themselves, but they're the
 * precursor to a signed on-chain deposit/borrow/repay/withdraw) so they get
 * the same requireAuth + requireAllowedGeo + rate-limit treatment as the
 * xStocks Jupiter routes above. Signing + submission reuses the EXISTING
 * /api/execute route with swapV1:true (see executeSignedOrder above) —
 * that path already just broadcasts whatever signed transaction it's given
 * directly to Solana RPC, no Kamino-specific execute endpoint needed.
 */
app.get("/api/kamino/reserves", async (_req, res) => {
  try {
    res.json(await getXstocksReserves());
  } catch (e) {
    res.status(e instanceof KaminoError ? e.status : 502).json({ error: String(e.message || e) });
  }
});

app.get("/api/kamino/obligations/:address", async (req, res) => {
  try {
    res.json(await getObligations(req.params.address));
  } catch (e) {
    res.status(e instanceof KaminoError ? e.status : 502).json({ error: String(e.message || e) });
  }
});

app.get("/api/kamino/loan/:obligationPubkey", async (req, res) => {
  try {
    res.json(await getLoanDetail(req.params.obligationPubkey));
  } catch (e) {
    res.status(e instanceof KaminoError ? e.status : 502).json({ error: String(e.message || e) });
  }
});

// Kamino creates a new on-chain "Obligation" account on a wallet's first
// deposit into this market — the InitObligation step alone needs 24,165,120
// lamports (≈0.0242 SOL) rent, confirmed via a real failed transaction. But
// a real sponsored deposit still failed after topping a wallet up to
// exactly that (26,000,000 lamports): checking the confirmed top-up tx
// on-chain showed the DEPOSIT transaction has other instructions BEFORE
// InitObligation (almost certainly creating a token account for the
// collateral mint) that consumed ~9,359,240 lamports first, leaving too
// little for the InitObligation step by the time it ran. Real total ≈
// 33,624,360 lamports (~0.0336 SOL) — 42,000,000 (0.042 SOL) gives ~25%
// margin over that observed total, not just the isolated InitObligation
// figure. borrow/repay/withdraw run against an already-existing
// obligation (no new accounts to create), so they only need ordinary
// tx-fee SOL.
const KAMINO_DEPOSIT_MIN_SOL = 42_000_000;   // 0.042 SOL
const KAMINO_OTHER_MIN_SOL   = 5_000_000;    // 0.005 SOL — ordinary fee buffer, same as the xStocks sell-order sponsor

/**
 * Tops up SOL for a Kamino action, same anti-abuse shape as the xStocks
 * sell-order sponsor above: never an open faucet, only ever tops up a
 * wallet that's provably about to do the real thing it claims.
 *   - deposit: wallet must actually hold the collateral mint being deposited.
 *   - borrow/repay/withdraw: wallet must already have a real obligation in
 *     this market (proof they went through a real deposit first).
 * Swallows top-up failures (budget exhausted, RPC error) rather than
 * throwing — the actual deposit/borrow tx will fail with its own clear
 * error if gas genuinely wasn't available, same as the unsponsored path.
 */
async function ensureKaminoGas(action, wallet, reserve) {
  if (!sponsor || !wallet) return;
  try {
    let qualifies = false;
    if (action === "deposit") {
      if (!reserve) return;
      const reserveMeta = (await getXstocksReserves()).find((r) => r.reserve === reserve);
      if (!reserveMeta) return;
      const held = await getTokenBalance(wallet, reserveMeta.liquidityTokenMint);
      qualifies = held > 0n;
    } else {
      const obligations = await getObligations(wallet).catch(() => []);
      qualifies = Array.isArray(obligations) && obligations.length > 0;
    }
    if (!qualifies) return;

    const minSol = action === "deposit" ? KAMINO_DEPOSIT_MIN_SOL : KAMINO_OTHER_MIN_SOL;
    const balance = await connection.getBalance(new PublicKey(wallet));
    if (balance >= minSol) return;

    const topup = minSol - balance;
    if (!sponsorBudgetOk(topup)) return;

    console.log(`[kamino/${action}] topping up ${short(wallet)} with ${topup} lamports`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey });
    fundTx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: new PublicKey(wallet), lamports: topup }));
    fundTx.sign(sponsor);
    const sig = await connection.sendRawTransaction(fundTx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    trackSponsorSpend(topup);
    console.log(`[kamino/${action}] top-up confirmed: ${sig}`);
  } catch (e) {
    console.error(`[kamino/${action}] gas top-up failed (non-fatal):`, e.message);
  }
}

// Deposits are free; only borrows carry a platform fee (see
// /api/kamino/fee's own comment for why it's a separate transfer rather
// than bundled into the same tx). This is the authoritative copy — the
// one in web/src/lib/api.js is display-only (a live "$X fee" preview
// before a user submits anything) and isn't what any actual fee transfer
// is computed from anymore. Also used below by /api/referrals/dashboard
// to back out an approximate "borrow volume" figure from realized fees.
const KAMINO_FEE_BPS = 10; // 0.10%

for (const action of ["deposit", "borrow", "repay", "withdraw"]) {
  app.post(`/api/kamino/${action}`, requireAuth, requireAllowedGeo, requireActiveAccount, kaminoLimiter, async (req, res) => {
    try {
      const { wallet, reserve, amount } = req.body || {};

      // A wallet with any unpaid borrow-fee obligation can't borrow again
      // until it's settled — closes the fee-bypass this loop used to have
      // (nothing previously stopped a borrow from happening without the
      // separate /api/kamino/fee call that was supposed to follow it; see
      // /api/kamino/fee's comment for the full story). One free-and-clear
      // borrow can still complete before its own fee is paid (the fee is
      // necessarily charged AFTER — see executeKaminoAction's comment on
      // why proceeds don't exist until the borrow itself lands), but a
      // SECOND borrow is blocked until the first one's fee obligation is
      // settled, so this can't be repeated for free.
      if (action === "borrow") {
        const pending = await getUnpaidKaminoFeeObligation(wallet);
        if (pending) {
          return res.status(402).json({
            error: `Settle the outstanding $${(Number(pending.fee_atoms) / 10 ** USDC.decimals).toFixed(2)} platform fee on your last borrow before borrowing again.`,
            obligationId: pending.id,
          });
        }
      }

      await ensureKaminoGas(action, wallet, reserve);
      const built = await buildKlendTx(action, { wallet, reserve, amount });

      if (action === "borrow") {
        const feeAtoms = Math.floor(Number(amount) * (KAMINO_FEE_BPS / 10000) * 10 ** USDC.decimals);
        if (feeAtoms > 0) {
          await createKaminoFeeObligation({ walletAddress: wallet, amountUsd: amount, feeAtoms });
          built.feeAtoms = feeAtoms;
          built.amountUsd = Number(amount);
        }
      }

      res.json(built);
    } catch (e) {
      res.status(e instanceof KaminoError ? e.status : 502).json({ error: String(e.message || e) });
    }
  });
}

/* ————— News feed: Brave News + StockTwits ————— */
app.get("/api/news", async (req, res) => {
  try {
    const rawSymbols = String(req.query.symbols || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!rawSymbols.length) return res.json({ items: [] });

    const { bySymbol } = await getRegistry();
    // Map xStock symbols to underlying tickers (TSLAx → TSLA)
    const pairs = rawSymbols.map((sym) => ({
      xSym: sym,
      ticker: sym.replace(/x$/i, "").toUpperCase(),
      name: bySymbol[sym]?.name || sym,
    }));

    const items = [];

    // Brave News (if key configured)
    const braveNewsResults = BRAVE_KEY
      ? await Promise.all(pairs.map(async ({ ticker, name, xSym }) => {
          try {
            const q = encodeURIComponent((xSym === "BTC" || xSym === "EURC") ? `${ticker} ${name} price news` : `${ticker} ${name} stock earnings`);
            const r = await fetch(
              `https://api.search.brave.com/res/v1/news/search?q=${q}&count=3&freshness=pw`,
              { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } }
            );
            if (!r.ok) return [];
            const data = await r.json();
            return (data.results || []).slice(0, 3).map((a) => ({
              type: "article",
              ticker,
              xSym,
              title: a.title,
              source: a.meta_url?.hostname || "",
              url: a.url,
              published: a.page_age || a.page_fetched || null,
            }));
          } catch { return []; }
        }))
      : [];
    braveNewsResults.flat().forEach((item) => items.push(item));

    // StockTwits (free public API, finance-specific cashtags)
    const stResults = await Promise.all(pairs.map(async ({ ticker, xSym }) => {
      try {
        const r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${ticker}.json`);
        if (!r.ok) return [];
        const data = await r.json();
        return (data.messages || []).slice(0, 4).map((m) => ({
          type: "social",
          ticker,
          xSym,
          handle: m.user?.username || "anon",
          text: m.body,
          url: `https://stocktwits.com/${m.user?.username}/message/${m.id}`,
          published: m.created_at || null,
        }));
      } catch { return []; }
    }));
    stResults.flat().forEach((item) => items.push(item));

    // Sort newest first, deduplicate by url
    const seen = new Set();
    const deduped = items.filter((it) => {
      if (seen.has(it.url)) return false;
      seen.add(it.url);
      return true;
    });
    deduped.sort((a, b) => {
      const ta = a.published ? new Date(a.published).getTime() : 0;
      const tb = b.published ? new Date(b.published).getTime() : 0;
      return tb - ta;
    });

    res.json({ items: deduped.slice(0, 40) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ————— Web search helper (Brave Search API) ————— */
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || "";

async function executeWebSearch(query) {
  if (!BRAVE_KEY) return { text: `Search unavailable. Answer from training data: "${query}"`, sources: [] };
  try {
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } }
    );
    if (!r.ok) return { text: "Search failed.", sources: [] };
    const data = await r.json();
    const results = (data.web?.results || []).slice(0, 5);
    const sources = results.map(({ title, url }) => ({ title, url }));
    const text = results.map((r) => `${r.title}\n${r.url}\n${r.description || ""}`).join("\n\n") || "No results found.";
    return { text, sources };
  } catch {
    return { text: "Search error.", sources: [] };
  }
}

// Structured-results sibling of executeWebSearch — used by the admin
// adverse-media search, which needs individual title/url/description
// entries to render as a list, not a single summarized text blob.
async function braveSearchRaw(query, count = 8) {
  if (!BRAVE_KEY) return { results: [], error: "Brave Search API not configured" };
  try {
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } }
    );
    if (!r.ok) return { results: [], error: `Brave search failed (HTTP ${r.status})` };
    const data = await r.json();
    const results = (data.web?.results || []).map(({ title, url, description }) => ({ title, url, description: description || "" }));
    return { results };
  } catch (e) {
    return { results: [], error: e.message };
  }
}

/* ————— Claude: financial Q&A with web search ————— */
app.post("/api/ask", requireAuth, parseLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const { bySymbol } = await getRegistry();
    const symbolList = Object.values(bySymbol)
      .filter((t) => t.symbol !== "USDC" && t.category !== "yield")
      .map((t) => `${t.symbol} (${t.name})`)
      .join(", ");

    const system = `You are a financial research assistant for a tokenized equity portfolio app.
Answer questions about stocks, ETFs, earnings, and markets accurately and concisely using web search for current data.
Cite sources inline when you have them. Keep answers focused and under 300 words.
Available tradeable symbols in this app: ${symbolList}.
If relevant, mention specific available symbols the user could trade — but always clarify this is not personalized investment advice.`;

    const tools = [{
      name: "web_search",
      description: "Search the web for current financial news, earnings reports, and market data.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "The search query" } },
        required: ["query"],
      },
    }];

    const messages = [{ role: "user", content: prompt }];
    let finalText = "";
    const allSources = [];

    for (let turn = 0; turn < 6; turn++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system, tools, messages }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);

      if (data.stop_reason === "end_turn") {
        finalText = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        break;
      }

      if (data.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: data.content });
        const toolResults = [];
        for (const block of (data.content || [])) {
          if (block.type !== "tool_use") continue;
          const { text: searchText, sources } = await executeWebSearch(block.input?.query || "");
          allSources.push(...sources);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: searchText });
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // max_tokens or other — extract whatever text we got
      finalText = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      break;
    }

    if (!finalText) throw new Error("no response from Claude");

    // Extract any xStock symbols mentioned in the answer
    const xSymbols = Object.keys(bySymbol).filter((s) => s !== "USDC" && bySymbol[s].category !== "yield");
    const mentionedSymbols = xSymbols.filter((sym) => new RegExp(`\\b${sym}\\b`).test(finalText));

    // Deduplicate sources
    const sources = [...new Map(allSources.map((s) => [s.url, s])).values()].slice(0, 5);
    res.json({ answer: finalText, sources, mentionedSymbols });
  } catch (e) {
    res.status(422).json({ error: String(e.message || e) });
  }
});

/* ————— Perps: deBridge DLN proxy (avoids browser CORS) ————— */
const DEBRIDGE_BASE = "https://api.dln.trade/v1.0";
const ARBITRUM_USDC    = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// Source assets the deposit flow can bridge FROM (Solana side). "sol" was the
// only option originally; "usdc" lets users skip the SOL swap leg entirely
// when they already hold USDC (which most do, from xStocks trading).
const SRC_ASSETS = {
  sol:  { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  usdc: { mint: USDC.mint, decimals: USDC.decimals },
};

function debridgeParams(amount, evmRecipient, srcAsset = "sol", solanaSender) {
  const asset = SRC_ASSETS[srcAsset] || SRC_ASSETS.sol;
  const params = new URLSearchParams({
    srcChainId: "7565164",
    srcChainTokenIn: asset.mint,
    srcChainTokenInAmount: String(Math.floor(parseFloat(amount) * 10 ** asset.decimals)),
    dstChainId: "42161",
    dstChainTokenOut: ARBITRUM_USDC,
    dstChainTokenOutRecipient: evmRecipient,
    prependOperatingExpenses: "true",
  });
  // Required for /dln/order/create-tx (NOT for /dln/order/quote, which
  // ignores them) — without both, deBridge silently returns a quote-shaped
  // response with no `tx`/`orderId` field at all, no error either. Confirmed
  // by direct testing against their API.
  if (solanaSender) {
    params.set("srcChainOrderAuthorityAddress", solanaSender);
    params.set("dstChainOrderAuthorityAddress", evmRecipient);
  }
  return params;
}

app.get("/api/perps/bridge/quote", async (req, res) => {
  try {
    const { solAmount, evmRecipient, srcAsset } = req.query;
    if (!solAmount || !evmRecipient) return res.status(400).json({ error: "solAmount and evmRecipient required" });
    const r = await fetch(`${DEBRIDGE_BASE}/dln/order/quote?${debridgeParams(solAmount, evmRecipient, srcAsset)}`);
    if (!r.ok) throw new Error(`deBridge HTTP ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const usdcOut = Number(d.estimation?.dstChainTokenOut?.recommendedAmount ?? d.estimation?.dstChainTokenOut?.amount ?? 0) / 1e6;
    const etaSeconds = d.order?.approximateFulfillmentDelay ?? 60;
    // Sum all cost details for fee estimate
    const feeUsd = (d.estimation?.costsDetails ?? []).reduce((s, c) => s + Number(c.payload?.feeUsd ?? 0), 0);
    res.json({ usdcOut, feeUsd, etaSeconds });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Unlike every other sponsor-touching route in this file (ensureKaminoGas,
// arbitrum-gas, solana-gas — see their own comments), this one had NO proof
// requirement at all before topping an address up: no auth, no rate limit,
// no check that solanaSender held anything or had done anything real. A
// script generating free throwaway keypairs could drain the whole daily
// sponsor SOL budget in seconds AND deny it to every real user for the
// rest of the day. There's no on-chain "already did something real" signal
// available here the way there is for the other routes (a bridge is the
// FIRST action for this address, nothing to check yet) — requiring
// solanaSender to be the authenticated caller's own linked wallet is the
// equivalent-strength substitute: an attacker now needs a distinct real
// Privy session per address, not just an unlimited supply of free keypairs.
app.get("/api/perps/bridge/tx", requireAuth, requireAllowedGeo, requireActiveAccount, bridgeGasLimiter, async (req, res) => {
  try {
    const { solAmount, evmRecipient, srcAsset, solanaSender } = req.query;
    if (!solAmount || !evmRecipient || !solanaSender)
      return res.status(400).json({ error: "solAmount, evmRecipient, and solanaSender required" });

    // deBridge's bridge transaction creates multiple new accounts as part
    // of its own order-creation instruction (confirmed by simulating a real
    // transaction and resolving every account it touches) — not just one
    // ATA as originally assumed. A wallet with 20,000,000 lamports (0.02
    // SOL) was still short by ~172,360 lamports on the LAST account
    // creation, meaning the real cumulative cost for this flow (multiple
    // rent-exempt accounts + fees) is closer to ~0.0202 SOL, not the
    // ~0.002 SOL a single ATA would need. Reserve 0.025 SOL for margin.
    // Top up the same way /api/order does for xStock sells, reusing the
    // same sponsor budget.
    if (sponsor && privyClient) {
      const user = await privyClient.getUserById(req.privyUserId).catch(() => null);
      const ownSolanaAddress = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana")?.address;
      if (!ownSolanaAddress || ownSolanaAddress !== solanaSender) {
        return res.status(403).json({ error: "solanaSender must be your own wallet" });
      }
    }
    if (sponsor) {
      const PERPS_MIN_SOL = 25_000_000; // 0.025 SOL — covers multiple account creations + fees, with margin
      const senderPubkey = new PublicKey(solanaSender);
      const balance = await connection.getBalance(senderPubkey);
      if (balance < PERPS_MIN_SOL) {
        const topup = PERPS_MIN_SOL - balance;
        if (!sponsorBudgetOk(topup)) {
          return res.status(503).json({ error: "Sponsor gas budget exhausted for today — please fund your wallet with a small amount of SOL" });
        }
        console.log(`[perps/bridge] topping up ${solanaSender.slice(0, 8)} with ${topup} lamports`);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey });
        fundTx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: senderPubkey, lamports: topup }));
        fundTx.sign(sponsor);
        const sig = await connection.sendRawTransaction(fundTx.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        trackSponsorSpend(topup);
        console.log(`[perps/bridge] top-up confirmed: ${sig}`);
      }
    }

    const r = await fetch(`${DEBRIDGE_BASE}/dln/order/create-tx?${debridgeParams(solAmount, evmRecipient, srcAsset, solanaSender)}`);
    if (!r.ok) throw new Error(`deBridge HTTP ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const orderId = d.orderId?.stringValue ?? d.orderId ?? null;
    const txData  = d.tx?.data ?? null;
    if (!txData || !orderId) throw new Error("deBridge response missing tx.data or orderId");
    res.json({ txData, orderId });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Confirmed against a real stuck deposit: deBridge orders keep progressing
// through states AFTER the recipient's funds have already arrived
// (Fulfilled → SentUnlock → ClaimedUnlock — the later two are the market
// maker's own source-chain settlement, unrelated to whether the user
// received their funds). Checking only the literal "Fulfilled" string meant
// a real, successfully-delivered deposit was permanently treated as
// "not fulfilled yet" the moment deBridge's own status moved past it —
// deBridge's own docs confirm all three are valid completed states for
// application logic.
const ORDER_FULFILLED_STATES = new Set(["Fulfilled", "SentUnlock", "ClaimedUnlock"]);
app.get("/api/perps/bridge/status/:orderId", async (req, res) => {
  try {
    const r = await fetch(`${DEBRIDGE_BASE}/dln/order/${encodeURIComponent(req.params.orderId)}/status`);
    if (!r.ok) throw new Error(`deBridge status HTTP ${r.status}`);
    const d = await r.json();
    res.json({ fulfilled: ORDER_FULFILLED_STATES.has(d.status), status: d.status });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Perps: CCTP deposit relay (Solana burn → Circle attestation → —————
 * sponsor-relayed Arbitrum mint). No request body needed beyond the burn
 * tx's own signature — receiveMessage() is permissionless and the mint
 * recipient is embedded in the attested message itself, not supplied here. */
app.get("/api/perps/cctp/deposit-status/:solanaTxHash", async (req, res) => {
  try {
    const result = await checkAndRelayCctpDeposit(req.params.solanaTxHash);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Perps: CCTP withdraw relay (Arbitrum burn → Circle attestation → —————
 * sponsor-relayed Solana mint). solanaRecipient is required — unlike the
 * deposit direction, the mint destination here is the user's own USDC
 * associated token account, derived from their wallet address rather than
 * parsed out of the attested message. */
app.get("/api/perps/cctp/withdraw-status/:arbTxHash", async (req, res) => {
  try {
    const { solanaRecipient } = req.query;
    if (!solanaRecipient) return res.status(400).json({ error: "solanaRecipient required" });
    const result = await checkAndRelayCctpWithdraw(req.params.arbTxHash, solanaRecipient);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Perps: withdraw bridge (Arbitrum USDC → Solana USDC) —————
 * Reverse direction of the deposit bridge above — same deBridge DLN API,
 * source/destination chains swapped. Used after a Hyperliquid withdraw3
 * lands USDC on the user's own Arbitrum address, to bring it back to
 * their Solana/Bonzai Trading balance. Status polling reuses
 * /api/perps/bridge/status/:orderId above (it's already generic to any
 * deBridge orderId, direction doesn't matter to it).
 */
function withdrawBridgeParams(usdcAmount, solanaRecipient, evmSender) {
  const params = new URLSearchParams({
    srcChainId: "42161",
    srcChainTokenIn: ARBITRUM_USDC,
    srcChainTokenInAmount: String(Math.floor(parseFloat(usdcAmount) * 1e6)),
    dstChainId: "7565164",
    dstChainTokenOut: USDC.mint,
    dstChainTokenOutRecipient: solanaRecipient,
    prependOperatingExpenses: "true",
  });
  // Same requirement as the deposit direction's debridgeParams() — omitting
  // these makes create-tx silently return a quote-shaped response with no
  // tx/orderId, no error either.
  if (evmSender) {
    params.set("srcChainOrderAuthorityAddress", evmSender);
    params.set("dstChainOrderAuthorityAddress", solanaRecipient);
  }
  return params;
}

app.get("/api/perps/withdraw-bridge/quote", async (req, res) => {
  try {
    const { usdcAmount, solanaRecipient, evmSender } = req.query;
    if (!usdcAmount || !solanaRecipient) return res.status(400).json({ error: "usdcAmount and solanaRecipient required" });
    const r = await fetch(`${DEBRIDGE_BASE}/dln/order/quote?${withdrawBridgeParams(usdcAmount, solanaRecipient, evmSender)}`);
    if (!r.ok) throw new Error(`deBridge HTTP ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const usdcOut = Number(d.estimation?.dstChainTokenOut?.recommendedAmount ?? d.estimation?.dstChainTokenOut?.amount ?? 0) / 1e6;
    const etaSeconds = d.order?.approximateFulfillmentDelay ?? 60;
    const feeUsd = (d.estimation?.costsDetails ?? []).reduce((s, c) => s + Number(c.payload?.feeUsd ?? 0), 0);
    res.json({ usdcOut, feeUsd, etaSeconds });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/perps/withdraw-bridge/tx", async (req, res) => {
  try {
    const { usdcAmount, solanaRecipient, evmSender } = req.query;
    if (!usdcAmount || !solanaRecipient || !evmSender)
      return res.status(400).json({ error: "usdcAmount, solanaRecipient, and evmSender required" });

    // deBridge inflates whatever srcChainTokenInAmount is requested by a
    // roughly-fixed "operating expense" markup (its own destination-side
    // fees, prepended onto the source pull) — confirmed via direct testing:
    // requesting exactly 4.0 USDC resulted in an actual on-chain pull of
    // ~4.74 USDC. Callers here pass their FULL wallet balance (this is a
    // withdrawal — there's no "leave some behind" amount to choose), so a
    // literal request always overshoots it, and the order-creation tx
    // reverts on-chain with "ERC20: transfer amount exceeds balance" —
    // confirmed against a real failed withdrawal. Probe once to learn the
    // real markup for this route, then re-request for less by that amount
    // (plus a small dust buffer, since the markup isn't perfectly
    // reproducible between calls — confirmed a naive one-shot adjustment
    // still overshot the wallet balance by 45 micro-USDC on a real test)
    // so the actual pull stays within the real balance.
    const maxAtoms = Math.floor(parseFloat(usdcAmount) * 1e6);
    const probeR = await fetch(`${DEBRIDGE_BASE}/dln/order/create-tx?${withdrawBridgeParams(usdcAmount, solanaRecipient, evmSender)}`);
    if (!probeR.ok) throw new Error(`deBridge HTTP ${probeR.status}: ${await probeR.text()}`);
    const probe = await probeR.json();
    const probeActual = Number(probe.estimation?.srcChainTokenIn?.amount ?? maxAtoms);
    const markup = Math.max(0, probeActual - maxAtoms);

    let d = probe;
    if (markup > 0) {
      const DUST_BUFFER_ATOMS = 10_000; // $0.01 — margin beyond the probed markup, confirmed necessary above
      const adjustedAtoms = maxAtoms - markup - DUST_BUFFER_ATOMS;
      if (adjustedAtoms <= 0) throw new Error("Balance too small to cover the bridge's fees.");
      const adjustedR = await fetch(`${DEBRIDGE_BASE}/dln/order/create-tx?${withdrawBridgeParams((adjustedAtoms / 1e6).toString(), solanaRecipient, evmSender)}`);
      if (!adjustedR.ok) throw new Error(`deBridge HTTP ${adjustedR.status}: ${await adjustedR.text()}`);
      d = await adjustedR.json();
    }

    const orderId = d.orderId?.stringValue ?? d.orderId ?? null;
    if (!d.tx?.data || !d.tx?.to || !orderId) throw new Error("deBridge response missing tx fields or orderId");
    res.json({
      // EVM source chain needs an ERC20 approve before the order tx (unlike
      // the deposit direction's Solana source, which doesn't need one) —
      // allowanceTarget is deBridge's own DLN contract (same address as
      // tx.to), allowanceValue is the exact input amount their own
      // estimation computed (includes their fees), confirmed by comparing
      // this endpoint's tx.to against the separate /quote endpoint's
      // tx.allowanceTarget for the same order — identical.
      allowanceTarget: d.tx.to,
      allowanceValue: d.estimation?.srcChainTokenIn?.amount,
      orderTo: d.tx.to,
      orderData: d.tx.data,
      orderValue: d.tx.value ?? "0",
      orderId,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Tops up a user's EVM wallet with a small amount of ETH on Arbitrum if it's
// below MIN_ARB_ETH — the final Hyperliquid Bridge2 deposit step needs gas
// there, and nothing else in this flow ensures it exists. Public/
// unauthenticated like the other bridge endpoints, but NOT an open
// free-ETH faucet: ensureArbitrumGas itself requires the target address to
// already hold real USDC on Arbitrum (the actual "stuck deposit" signature)
// before sending anything, and this is additionally rate-limited as
// defense in depth.
const arbGasLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
// The withdraw-bridge step needs more ETH than a plain deposit transfer:
// deBridge charges a fixed 0.001 ETH protocol fee (paid as tx value, not
// just gas) on top of the approve+order transactions' own gas — confirmed
// against a real create-tx response for this exact route. Callers can
// request a higher target than MIN_ARB_ETH via minWei, capped here so this
// can't be used to drain the sponsor wallet faster than intended.
const MAX_ARB_GAS_TOPUP = parseEther("0.002");
app.post("/api/perps/arbitrum-gas", arbGasLimiter, async (req, res) => {
  try {
    const { address, minWei } = req.body || {};
    if (!address) return res.status(400).json({ error: "address required" });
    let target = MIN_ARB_ETH;
    if (minWei) {
      try {
        const requested = BigInt(minWei);
        if (requested > target && requested <= MAX_ARB_GAS_TOPUP) target = requested;
        else if (requested > MAX_ARB_GAS_TOPUP) target = MAX_ARB_GAS_TOPUP;
      } catch {}
    }
    const result = await ensureArbitrumGas(address, target);
    res.json(result);
  } catch (e) {
    // Don't leak raw viem errors (e.g. address-checksum validation detail)
    // to API responses — log full detail server-side, return a plain reason.
    console.error("[arbitrum-gas] error:", e.message);
    res.status(502).json({ error: "couldn't check/top up Arbitrum gas" });
  }
});

// Solana-side mirror of the Arbitrum-gas endpoint above — the CCTP deposit
// burn creates a new "message sent event" account, which (like any Solana
// account creation) needs a small amount of native SOL for rent + the tx
// fee, separate from the USDC amount being deposited. Confirmed as a real
// customer-facing block: a wallet holding real USDC to deposit was refused
// with "you need at least 0.003 SOL", with nothing in the flow to fix that
// for them — same class of gap ensureArbitrumGas already closed on the
// Arbitrum side. Same anti-abuse posture: only tops up addresses that
// already hold real USDC on Solana (the actual "about to deposit" signal),
// reuses the existing Solana sponsor + its daily budget, same rate limit.
// 0.005 SOL — matches DepositWizard.jsx's SOL_RESERVE. Real requirement
// confirmed via a failed deposit at the old 0.003 threshold: CCTP's
// SendMessage account creation needed exactly 3,869,760 lamports.
const MIN_SOL_DEPOSIT_LAMPORTS = 5_000_000;
const MAX_SOL_GAS_TOPUP_LAMPORTS = 10_000_000; // 0.01 SOL cap, defense in depth
const MIN_USDC_TO_QUALIFY_FOR_SOL_GAS = 1_000_000n; // $1
app.post("/api/perps/solana-gas", arbGasLimiter, async (req, res) => {
  try {
    const { address, minLamports } = req.body || {};
    if (!address) return res.status(400).json({ error: "address required" });
    if (!sponsor) return res.json({ topped: false, reason: "sponsor not configured" });

    const held = await getTokenBalance(address, USDC.mint);
    if (held < MIN_USDC_TO_QUALIFY_FOR_SOL_GAS) {
      return res.json({ topped: false, reason: "no qualifying USDC balance on Solana for this address" });
    }

    let target = MIN_SOL_DEPOSIT_LAMPORTS;
    const requested = Number(minLamports);
    if (requested > target) target = Math.min(requested, MAX_SOL_GAS_TOPUP_LAMPORTS);

    const balance = await connection.getBalance(new PublicKey(address));
    if (balance >= target) return res.json({ topped: false, balance });

    const topup = target - balance;
    if (!sponsorBudgetOk(topup)) {
      return res.json({ topped: false, reason: "sponsor daily budget exhausted", balance });
    }

    console.log(`[solana-gas] topping up ${address.slice(0, 8)} with ${topup} lamports`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const fundTx = new Transaction({ recentBlockhash: blockhash, feePayer: sponsor.publicKey });
    fundTx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: new PublicKey(address), lamports: topup }));
    fundTx.sign(sponsor);
    const sig = await connection.sendRawTransaction(fundTx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    trackSponsorSpend(topup);
    console.log(`[solana-gas] top-up confirmed: ${sig}`);
    res.json({ topped: true, hash: sig, balance: balance + topup });
  } catch (e) {
    console.error("[solana-gas] error:", e.message);
    res.status(502).json({ error: "couldn't check/top up Solana gas" });
  }
});

// Used by the perps client flow to check signed QA-bypass credentials before
// showing the UI at all. xStocks routes check the same credentials directly
// via requireAllowedGeo (see above) since those are plain API calls, not a
// full page the client renders around.
const qaBypassLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

app.post("/api/perps/qa-bypass", qaBypassLimiter, (req, res) => {
  try {
    const { address, message, signature } = req.body || {};
    res.json({ allowed: verifyQaSignature(address, message, signature) });
  } catch {
    res.json({ allowed: false });
  }
});

/* ————— portfolio discoverability (view-other-portfolios feature) ————— */
// Opt-in flag stored in Privy's per-user customMetadata — no new database.
// NOTE: setCustomMetadata REPLACES the whole customMetadata object rather
// than merging. Harmless today (nothing else uses it), but if a future
// feature adds other custom metadata, this call needs to merge with the
// user's existing customMetadata first instead of overwriting it wholesale.
app.post("/api/users/discoverable", requireAuth, async (req, res) => {
  try {
    if (!privyClient) return res.status(503).json({ error: "not configured" });
    const enabled = !!req.body?.enabled;
    await privyClient.setCustomMetadata(req.privyUserId, { portfolioDiscoverable: enabled });
    res.json({ enabled });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Exact-email lookup, limited to users who opted in above. Returns the SAME
// { found: false } response whether the email doesn't exist at all or
// exists but hasn't opted in — a distinguishable response for "exists but
// not discoverable" would itself leak account existence, defeating the
// point of the opt-in gate.
app.get("/api/users/lookup", requireAuth, async (req, res) => {
  try {
    if (!privyClient) return res.status(503).json({ error: "not configured" });
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email required" });
    const user = await privyClient.getUserByEmail(email);
    if (!user || user.customMetadata?.portfolioDiscoverable !== true) {
      return res.json({ found: false });
    }
    const solanaWallet = user.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana");
    if (!solanaWallet) return res.json({ found: false });
    res.json({ found: true, address: solanaWallet.address, label: email.split("@")[0] });
  } catch (e) {
    res.json({ found: false });
  }
});

/* ————— Referral system — 50% fee-share flywheel —————
 * Accrual/stats only for v1 — this computes and displays what each
 * referrer has earned; it never moves money automatically. See
 * server/src/db.js for the schema/query helpers and hlBuilder.js's
 * getUserPerpsStats for the perps-side data source. */

app.get("/api/referrals/me", requireAuth, async (req, res) => {
  try {
    const code = await getOrCreateReferralCode(req.privyUserId);
    res.json({ code });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post("/api/referrals/attribute", requireAuth, async (req, res) => {
  try {
    const { code, walletAddress, evmAddress } = req.body || {};
    if (!code || !walletAddress) return res.status(400).json({ error: "code and walletAddress required" });
    const result = await attributeReferral({
      referredPrivyUserId: req.privyUserId,
      referredWalletAddress: walletAddress,
      referredEvmAddress: evmAddress || null,
      code: String(code).toUpperCase(),
    });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/referrals/dashboard", requireAuth, async (req, res) => {
  try {
    const code = await getOrCreateReferralCode(req.privyUserId);
    const referred = await getReferralsFor(req.privyUserId);

    const rows = await Promise.all(referred.map(async (r) => {
      const sinceIso = r.created_at;
      const sinceMs = new Date(r.created_at).getTime();
      const [equities, perps, kamino] = await Promise.all([
        getEquitiesStatsForWallet(r.referred_wallet_address, sinceIso),
        r.referred_evm_address
          ? getUserPerpsStats(r.referred_evm_address, sinceMs).catch(() => ({ volume: 0, fees: 0 }))
          : Promise.resolve({ volume: 0, fees: 0 }),
        getKaminoFeeStatsForWallet(r.referred_wallet_address, sinceIso, KAMINO_FEE_BPS),
      ]);
      return {
        walletAddress: r.referred_wallet_address,
        joinedAt: r.created_at,
        equitiesVolume: equities.volume,
        equitiesFees: equities.fees,
        perpsVolume: perps.volume,
        perpsFees: perps.fees,
        kaminoVolume: kamino.volume,
        kaminoFees: kamino.fees,
      };
    }));

    const totals = rows.reduce((acc, r) => ({
      volume: acc.volume + r.equitiesVolume + r.perpsVolume + r.kaminoVolume,
      equitiesFees: acc.equitiesFees + r.equitiesFees,
      perpsFees: acc.perpsFees + r.perpsFees,
      kaminoFees: acc.kaminoFees + r.kaminoFees,
    }), { volume: 0, equitiesFees: 0, perpsFees: 0, kaminoFees: 0 });

    res.json({
      code,
      signupCount: rows.length,
      totals: { ...totals, totalEarned: 0.5 * (totals.equitiesFees + totals.perpsFees + totals.kaminoFees) },
      referrals: rows,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: customer lookup (phase 1 of an internal ops tool) —————
 * Gated by requireAdmin (shared password), never by requireAuth/Privy —
 * this is an operator tool, not a customer-facing route. */
app.post("/api/admin/login", requireAdmin, (req, res) => res.json({ ok: true }));

// Resolves an email or either wallet address to the full customer picture.
// Always tries Privy first (getUserByEmail / getUserByWalletAddress) so
// searching by just one address still surfaces the OTHER linked wallet —
// Perps lives on the Ethereum embedded wallet, everything else on Solana,
// and a support lookup by one address should still show both. Falls back
// to treating the raw query as whichever address type it looks like if
// there's no Privy match, so on-chain/Hyperliquid lookups still work for a
// wallet that exists on-chain but isn't (or is no longer) linked in Privy.
async function resolveCustomer(query) {
  const q = String(query || "").trim();
  let user = null;
  if (privyClient) {
    try {
      user = q.includes("@")
        ? await privyClient.getUserByEmail(q.toLowerCase())
        : await privyClient.getUserByWalletAddress(q);
    } catch { /* best-effort */ }
  }
  if (user) {
    const solanaAddress = user.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana")?.address ?? null;
    const evmAddress = user.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "ethereum")?.address ?? null;
    const email = user.linkedAccounts.find((a) => a.type === "email")?.address ?? null;
    return { solanaAddress, evmAddress, email, privyUserId: user.id };
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return { solanaAddress: null, evmAddress: q, email: null, privyUserId: null };
  if (!q.includes("@")) return { solanaAddress: q, evmAddress: null, email: null, privyUserId: null };
  return { solanaAddress: null, evmAddress: null, email: q, privyUserId: null };
}

app.get("/api/admin/customer/:query", requireAdmin, async (req, res) => {
  try {
    const { solanaAddress, evmAddress, email, privyUserId } = await resolveCustomer(req.params.query);
    if (!solanaAddress && !evmAddress) {
      return res.status(404).json({ error: "No matching customer found" });
    }

    const [holdings, kaminoLoans, perps, activity, status] = await Promise.all([
      solanaAddress ? getHoldingsForAddress(solanaAddress).catch(() => null) : Promise.resolve(null),
      solanaAddress
        ? getObligations(solanaAddress)
            .then((obs) => Promise.all((obs || []).map((o) => getLoanDetail(o.obligationAddress).catch(() => null))))
            .then((loans) => loans.filter(Boolean))
            .catch(() => [])
        : Promise.resolve([]),
      evmAddress ? getPerpsPositions(evmAddress) : Promise.resolve({ positions: [], cryptoAccountValue: 0, equityAccountValue: 0 }),
      solanaAddress ? getActivityForWallet(solanaAddress) : Promise.resolve([]),
      privyUserId ? getCustomerStatusDetail(privyUserId) : Promise.resolve({ status: "active", reason: null, updatedAt: null }),
    ]);

    res.json({ identity: { email, privyUserId, solanaAddress, evmAddress }, holdings, kaminoLoans, perps, activity, status });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: customer trading history (Compliance tab) —————
 * Separate from /api/admin/customer/:query above (identity + current
 * snapshot) — this pulls in a Hyperliquid fills fetch plus mint/reserve
 * symbol resolution, which not every Compliance lookup needs, so it's its
 * own on-demand call rather than bundled into every customer lookup.
 * Merges brokerage swaps + Kamino borrow/lend activity (activity_log, same
 * source ActivitySection/the referral dashboard already read from) with
 * live Hyperliquid perps fills into one chronological list — the same
 * merge shape as the (removed) community feed used to build, just scoped
 * to a single customer instead of a follow list, and with no opt-in
 * gating since this is an internal admin tool already behind requireAdmin. */
app.get("/api/admin/customer/:query/trading-history", requireAdmin, async (req, res) => {
  try {
    const { solanaAddress, evmAddress } = await resolveCustomer(req.params.query);
    if (!solanaAddress && !evmAddress) return res.status(404).json({ error: "No matching customer found" });

    const [activityRows, fills] = await Promise.all([
      solanaAddress ? getActivityForWallet(solanaAddress, 500) : Promise.resolve([]),
      evmAddress ? getUserPerpsFills(evmAddress, { limit: 500 }).catch(() => []) : Promise.resolve([]),
    ]);

    // Neither swap rows (only raw input/output mints in `details`) nor
    // kamino_* rows (only the reserve pubkey) get a `symbol` written at log
    // time — resolve both here via the token registry / reserve list,
    // rather than changing what every other caller already logs.
    const [{ byMint }, reserves] = await Promise.all([getRegistry(), getXstocksReserves().catch(() => [])]);
    const symbolByReserve = new Map(reserves.map((r) => [r.reserve, r.liquidityToken]));

    // activity_log also carries non-trade rows (plain "withdraw"/"deposit"
    // cash transfers, "admin_*" account-status/email actions) — this is a
    // trading-history view, so only actual trade/position kinds belong
    // here, not the full audit trail ActivitySection (Customer Service tab)
    // already shows.
    const TRADE_KINDS = new Set([
      "swap", "kamino_deposit", "kamino_borrow", "kamino_repay", "kamino_withdraw",
    ]);
    const trades = activityRows.filter((r) => TRADE_KINDS.has(r.kind)).map((r) => {
      let symbol = r.symbol;
      if (!symbol && r.kind === "swap" && r.details) {
        const mint = r.side === "sell" ? r.details.inputMint : r.details.outputMint;
        symbol = byMint[mint]?.symbol ?? null;
      } else if (!symbol && r.kind.startsWith("kamino_") && r.details?.reserve) {
        symbol = symbolByReserve.get(r.details.reserve) ?? null;
      }
      return {
        time: new Date(r.created_at).getTime(), kind: r.kind, symbol, side: r.side,
        usdValue: r.usd_value != null ? Number(r.usd_value) : null,
        status: r.status, signature: r.signature,
      };
    });

    for (const f of fills) {
      trades.push({
        time: f.time, kind: "perp_fill", symbol: f.coin, side: f.dir,
        usdValue: f.notionalUsd, closedPnl: f.closedPnl, status: "confirmed", signature: null,
      });
    }

    trades.sort((a, b) => b.time - a.time);
    res.json({ trades });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

const ACCOUNT_STATUSES = new Set(["active", "paused", "rejected"]);

// Pause/reject/reactivate a customer. Keyed on privyUserId (not a wallet
// address) to match how requireActiveAccount enforces it. Also writes to
// activity_log so this shows up in the same Recent Activity list the admin
// UI already renders — the audit trail for admin actions, not just trades.
app.post("/api/admin/customer/:privyUserId/status", requireAdmin, async (req, res) => {
  try {
    const { privyUserId } = req.params;
    const { status, reason } = req.body || {};
    if (!ACCOUNT_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...ACCOUNT_STATUSES].join(", ")}` });
    }
    await setCustomerStatus(privyUserId, status, reason);
    // Log under the customer's own Solana address (not the Privy ID) so this
    // shows up in the same getActivityForWallet list their trades do.
    const user = privyClient ? await privyClient.getUserById(privyUserId).catch(() => null) : null;
    const solanaAddress = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana")?.address;
    if (solanaAddress) {
      logActivity({
        walletAddress: solanaAddress, privyUserId, kind: `admin_${status === "active" ? "reactivate" : status}`,
        details: { reason: reason ?? null },
      });
    }
    res.json({ ok: true, status, reason: reason ?? null });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Sends a one-off email to a customer. Looks up the live email address via
// Privy directly (never trusts a client-cached value) so this can't be used
// to send mail to an address the admin UI happened to have stale in memory.
app.post("/api/admin/customer/:privyUserId/email", requireAdmin, async (req, res) => {
  try {
    if (!privyClient) return res.status(503).json({ error: "Privy not configured" });
    const { privyUserId } = req.params;
    const { subject, body } = req.body || {};
    if (!subject || !body) return res.status(400).json({ error: "subject and body required" });

    const user = await privyClient.getUserById(privyUserId).catch(() => null);
    const email = user?.linkedAccounts.find((a) => a.type === "email")?.address;
    if (!email) return res.status(400).json({ error: "This customer has no email on file" });

    await sendEmail({ to: email, subject, text: body });

    const solanaAddress = user.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana")?.address;
    if (solanaAddress) {
      logActivity({ walletAddress: solanaAddress, privyUserId, kind: "admin_email", details: { subject } });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: Jupiter Ultra referral fee (brokerage swaps) —————
 * See server/src/referral.js for the underlying mechanics. All three
 * mutating routes below spend real sponsor SOL (rent + tx fees) and are
 * meant to be triggered deliberately by an operator, not automatically. */
app.get("/api/admin/jupiter-fees/status", requireAdmin, async (req, res) => {
  try {
    if (!sponsor) return res.status(503).json({ error: "sponsor wallet not configured" });
    const configured = await referralAccountExists();
    const pendingUsdc = configured ? await getPendingBalance(USDC.mint) : null;
    const sponsorUsdcRaw = await getTokenBalance(sponsor.publicKey.toBase58(), USDC.mint);
    res.json({
      enabled: JUP_FEES_ENABLED,
      feeBps: JUP_REFERRAL_FEE_BPS,
      referralAccount: referralAccountPubkey(),
      configured,
      pendingUsdc,
      sponsorUsdcBalance: Number(sponsorUsdcRaw) / 1e6,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/jupiter-fees/setup", requireAdmin, async (req, res) => {
  try {
    if (!sponsor) return res.status(503).json({ error: "sponsor wallet not configured" });
    const account = await ensureReferralAccount(sponsor);
    const usdcAccount = await ensureTokenAccount(sponsor, USDC.mint);
    res.json({
      referralAccount: account.referralAccountPubKey.toBase58(),
      referralAccountCreated: account.created,
      usdcTokenAccountCreated: usdcAccount.created,
      note: JUP_FEES_ENABLED
        ? "JUP_FEES_ENABLED is already on — new swaps will start carrying the fee immediately."
        : "Set JUP_FEES_ENABLED=true on Railway and redeploy to start charging the fee.",
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/jupiter-fees/add-mint", requireAdmin, async (req, res) => {
  try {
    if (!sponsor) return res.status(503).json({ error: "sponsor wallet not configured" });
    const { mint } = req.body || {};
    if (!mint) return res.status(400).json({ error: "mint required" });
    const result = await ensureTokenAccount(sponsor, mint);
    res.json({ mint, tokenAccount: result.tokenAccount.toBase58(), created: result.created });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/jupiter-fees/claim", requireAdmin, async (req, res) => {
  try {
    if (!sponsor) return res.status(503).json({ error: "sponsor wallet not configured" });
    const signatures = await claimAllFees(sponsor);
    res.json({ signatures, count: signatures.length });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: gas sponsor wallet balances (SOL + Arbitrum ETH) —————
 * Read-only — live balances for the two wallets that pay gas on customers'
 * behalf (xStock sell top-ups + CCTP relays on Solana, Bridge2 deposit gas +
 * CCTP relays on Arbitrum). Both silently stop sponsoring once they run dry,
 * with no other signal that's happened — this exists so ops can see it
 * coming instead of finding out from a stuck customer flow. */
app.get("/api/admin/sponsor-status", requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const solana = sponsor
      ? {
          configured: true,
          address: sponsor.publicKey.toBase58(),
          balanceSol: (await connection.getBalance(sponsor.publicKey)) / 1e9,
          dailyCapSol: SPONSOR_DAILY_CAP_LAMPORTS / 1e9,
          spentTodaySol: (sponsorSpendDay === today ? sponsorSpendLamports : 0) / 1e9,
        }
      : { configured: false };
    const arbitrum = await getArbitrumSponsorStatus();
    res.json({ solana, arbitrum });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: Hyperliquid builder-fee codes (perps) —————
 * See server/src/hlBuilder.js — reuses the Arbitrum sponsor wallet as the
 * builder address. No "setup" route: eligibility (>=100 USDC perps account
 * value) is a real deposit the operator makes directly, not something
 * server code can create. */
app.get("/api/admin/hl-builder/status", requireAdmin, async (req, res) => {
  try {
    res.json(await getBuilderFeeStatus());
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// One-time (or occasional) funding step: moves the sponsor wallet's own
// USDC on Arbitrum into its own Hyperliquid account, to clear the >=100
// USDC builder-fee eligibility bar. Self-transfer only — see
// arbitrumSponsor.js's depositToHyperliquid for the actual mechanism.
app.post("/api/admin/hl-builder/bridge-deposit", requireAdmin, async (req, res) => {
  try {
    const amountUsdc = Number(req.body?.amountUsdc);
    if (!amountUsdc || amountUsdc <= 0) return res.status(400).json({ error: "amountUsdc required" });
    const result = await depositToHyperliquid(amountUsdc);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/hl-builder/claim", requireAdmin, async (req, res) => {
  try {
    const result = await claimBuilderRewards();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Manual correction tool — withdraws USDC from the sponsor's own Hyperliquid
// account directly to an arbitrary Arbitrum address. See hlBuilder.js's
// withdrawFromSponsor() for why this is safe to send to a non-sponsor
// destination. No default destination/amount — both must be supplied
// explicitly every time, deliberately, so this can't be misfired.
app.post("/api/admin/hl-builder/withdraw", requireAdmin, async (req, res) => {
  try {
    const { destination, amountUsdc } = req.body || {};
    if (!destination || !amountUsdc) return res.status(400).json({ error: "destination and amountUsdc required" });
    const result = await withdrawFromSponsor(destination, amountUsdc);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: Kamino deposit fee (borrow/lend) —————
 * Unlike the Jupiter/Hyperliquid fee mechanisms, there's no separate
 * "claim" step here — the fee is a plain transfer straight to the sponsor
 * wallet's own token account the moment it's charged (see
 * executeKaminoAction() in web/src/lib/api.js), so it's already fully
 * liquid the instant it lands. Collected in whatever collateral token was
 * deposited (AAPLx, TSLAx, ...), not a single pooled currency, so this
 * breaks totals down per mint and resolves each to a symbol via the
 * token registry for readability. */
app.get("/api/admin/kamino-fees/status", requireAdmin, async (req, res) => {
  try {
    const totals = await getKaminoFeeTotals();
    const { byMint } = await getRegistry();
    const byAsset = totals.byMint.map((m) => ({
      ...m,
      symbol: byMint[m.mint]?.symbol ?? null,
    }));
    res.json({
      configured: !!sponsor,
      sponsorAddress: sponsor?.publicKey.toBase58() ?? null,
      feeBps: 10,
      totalUsd: totals.totalUsd,
      count: totals.count,
      byAsset,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ————— Admin / ops: compliance screening —————
 * See server/src/ofacScreening.js for the OFAC/Treasury sanctions-list
 * matching (fuzzy name match against a background-refreshed cache of the
 * U.S. Commerce Dept's Consolidated Screening List). No customer name is
 * stored anywhere in this app — the admin types in whatever name they're
 * screening at search time, so this is deliberately a plain query param,
 * not looked up from any stored customer record. */
app.get("/api/admin/compliance/ofac", requireAdmin, (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const status = getOfacListStatus();
  const matches = searchOfac(name).map((m) => ({
    name: m.name, matchedName: m.matchedName, score: m.score, type: m.type,
    programs: m.programs, remarks: m.remarks, source: m.source, sourceInformationUrl: m.sourceInformationUrl,
  }));
  res.json({
    query: name, matches,
    dataUpdatedAt: status.dataUpdatedAt, sourcesUsed: status.sourcesUsed,
    entryCount: status.entryCount, listError: status.error,
  });
});

// Lightweight substitute for a real licensed adverse-media provider
// (ComplyAdvantage / LexisNexis / Refinitiv World-Check / Dow Jones, etc.)
// — a general web search for the name plus risk-related keywords, meant
// for manual review only. Explicitly NOT a compliance-grade adverse-media
// screen; the admin UI labels it as such.
app.get("/api/admin/compliance/adverse-media", requireAdmin, async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const query = `"${name}" (fraud OR sanctions OR indictment OR lawsuit OR "money laundering" OR SEC OR investigation OR arrested OR charged OR conviction)`;
  const { results, error } = await braveSearchRaw(query, 8);
  res.json({ query: name, results, error: error || null });
});

/* ————— asset info popup: quote/profile + price chart ————— */
// Public, unauthenticated — same tier as /api/prices: read-only public
// market data, nothing user-specific.
app.get("/api/market/:symbol", async (req, res) => {
  try {
    res.json(await getMarketInfo(req.params.symbol));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/market/:symbol/chart", async (req, res) => {
  try {
    const range = String(req.query.range || "1M");
    res.json(await getMarketChart(req.params.symbol, range));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Never echo RPC_URL directly — it may carry a provider API key (Helius/QuickNode/etc.)
// as a query param, and this endpoint is public and unauthenticated.
const RPC_HOST = (() => { try { return new URL(RPC_URL).hostname; } catch { return "unknown"; } })();
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, sponsored: !!sponsor, rpcHost: RPC_HOST })
);

/* ————— Telegram trading bot ————— */
// Authenticated: generates a short-lived code the user sends to the bot as
// "/link 123456" to tie their Telegram chat to this wallet address. Same
// trust model as /api/order's `taker` param — requireAuth proves this is a
// genuine logged-in Privy session; we don't separately re-verify on-chain
// ownership of `address` beyond that.
app.post("/api/telegram/link-code", requireAuth, (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: "address required" });
  res.json(generateLinkCode(address));
});

/** Whether this wallet has at least one linked Telegram chat — lets the UI
 * show a real "Connected" state instead of just "a code was generated at
 * some point in this browser session" (telegramCode's own state doesn't
 * know whether the user actually finished sending /link to the bot). */
app.get("/api/telegram/status", requireAuth, async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "");
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const chatIds = await getTelegramLinksForWallet(wallet);
    res.json({ linked: chatIds.length > 0 });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

mountTelegramRoutes(app, {
  getRegistry,
  getHoldingsForAddress,
  getPricesForMints,
  parsePromptToAllocations,
  buildOrder,
  executeSignedOrder,
  privyClient,
  // Strategy Agents proposal confirm/reject via "YES <id>"/"NO <id>" —
  // same DB effects as the web /report-execution route.
  getProposal, markProposalConfirmed, markProposalRejected, touchStrategyEvaluated, logActivity,
});

mountStrategyRoutes(app, {
  requireAuth, requireAllowedGeo, requireActiveAccount, strategyLimiter,
  getRegistry, buildOrder, logActivity,
  createStrategy, listStrategiesForWallet, countActiveStrategiesForWallet,
  setStrategyStatus, touchStrategyEvaluated,
  listPendingProposalsForWallet, getProposal,
  markProposalRejected, markProposalConfirmed, expireProposalsForStrategy,
});

app.listen(PORT, () => {
  console.log(`Longview server on http://localhost:${PORT}`);
  console.log(`Gas sponsorship: ${sponsor ? "ON — " + sponsor.publicKey.toBase58() : "off (users pay SOL fees)"}`);
  getRegistry().catch((e) => console.warn("[tokens] preload failed:", e.message));
  startMarketHealthMonitor();
  startPredictionMarketsMonitor();
  // The evaluator's first tick queries strategies/strategy_proposals directly —
  // it must not fire until those tables actually exist, so it's chained after
  // initSchema resolves rather than started in parallel with it (a real race
  // caught by testing against a fresh database: the very first tick could
  // hit "relation does not exist" before CREATE TABLE had finished).
  initSchema()
    .then(() => startStrategyEvaluator({ getHoldingsForAddress, getPricesForMints, privyClient }))
    .catch((e) => console.error("[db] schema init failed:", e.message));
});
