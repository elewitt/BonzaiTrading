import { VersionedTransaction } from "@solana/web3.js";
import { getQaBypassHeaders } from "./qaBypass.js";

// In dev, Vite proxies /api → localhost:8787.
// In production, VITE_API_URL points to the deployed server (e.g. https://longview-server.up.railway.app).
export const API_BASE = import.meta.env.VITE_API_URL || "";

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Wired up from App.jsx (usePrivy().getAccessToken) once Privy is ready, so
// the server can verify requests instead of trusting whatever address the
// client sends. Safe to leave unset — the server just runs unauthenticated
// until PRIVY_APP_SECRET is configured there too.
let getAccessToken = async () => null;
export function setAuthTokenProvider(fn) { getAccessToken = fn; }

async function authHeaders() {
  try {
    const token = await getAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const get  = async (path) => fetch(`${API_BASE}${path}`, { headers: { ...(await authHeaders()), ...getQaBypassHeaders() } }).then(json);
const post = async (path, body) => fetch(`${API_BASE}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(await authHeaders()), ...getQaBypassHeaders() },
  body: JSON.stringify(body),
}).then(json);

export const api = {
  tokens:   ()                   => get("/api/tokens"),
  prices:   (mints)              => get(`/api/prices?ids=${encodeURIComponent(mints.join(","))}`),
  holdings: (address)            => get(`/api/holdings/${address}`),
  parse:    (prompt, current, total) => post("/api/parse", { prompt, current, total }),
  parsePerp: (prompt)             => post("/api/parse-perp", { prompt }),
  parseBorrow: (prompt)           => post("/api/parse-borrow", { prompt }),
  myReferralCode: ()              => get("/api/referrals/me"),
  attributeReferral: (body)       => post("/api/referrals/attribute", body),
  referralsDashboard: ()          => get("/api/referrals/dashboard"),
  order:    (q)                  => get(`/api/order?${new URLSearchParams(q)}`),
  quotePreview: (q)              => get(`/api/quote-preview?${new URLSearchParams(q)}`),
  liquidityFlags: ()             => get("/api/liquidity-flags"),
  execute:  (body)               => post("/api/execute", body),
  withdraw: (body)               => post("/api/withdraw", body),
  ask:      (prompt)             => post("/api/ask", { prompt }),
  telegramLinkCode: (address)    => post("/api/telegram/link-code", { address }),
  setDiscoverable: (enabled)     => post("/api/users/discoverable", { enabled }),
  lookupUserByEmail: (email)     => get(`/api/users/lookup?email=${encodeURIComponent(email)}`),
  marketInfo:  (symbol)          => get(`/api/market/${symbol}`),
  marketChart: (symbol, range)   => get(`/api/market/${symbol}/chart?range=${range}`),
  kaminoReserves:    ()                => get("/api/kamino/reserves"),
  kaminoObligations: (address)         => get(`/api/kamino/obligations/${address}`),
  kaminoLoan:        (obligationPubkey) => get(`/api/kamino/loan/${obligationPubkey}`),
  kaminoDeposit:     (body)            => post("/api/kamino/deposit", body),
  kaminoBorrow:      (body)            => post("/api/kamino/borrow", body),
  kaminoRepay:       (body)            => post("/api/kamino/repay", body),
  kaminoWithdraw:    (body)            => post("/api/kamino/withdraw", body),
  kaminoDepositFee:  (body)            => post("/api/kamino/deposit-fee", body),
};

/** Send any SPL token directly to a Solana address (no swap involved). */
export async function executeWithdraw({ from, to, amount, mint, decimals, signWithWallet, onStatus }) {
  onStatus?.("routing");
  const { transaction } = await api.withdraw({ from, to, amount, mint, decimals });
  if (!transaction) throw new Error("could not build transfer transaction");

  onStatus?.("signing");
  const tx = VersionedTransaction.deserialize(
    Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0))
  );
  const signed = await signWithWallet(tx);
  const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

  onStatus?.("executing");
  const result = await api.execute({
    signedTransaction: signedB64, swapV1: true,
    // For the admin activity log only — never trusted for authorization.
    // Built here (not at every call site) since this function already has
    // everything needed in scope; symbol/usd enrichment can layer on later
    // via the JSONB details column without a schema change.
    logMeta: { walletAddress: from, kind: "withdraw", details: { to, amount, mint, decimals } },
  });
  if (result.status && result.status !== "Success")
    throw new Error(result.error || `transfer failed (${result.status})`);
  onStatus?.("confirmed");
  return result;
}

const KAMINO_BUILDERS = {
  deposit: api.kaminoDeposit, borrow: api.kaminoBorrow,
  repay: api.kaminoRepay, withdraw: api.kaminoWithdraw,
};

// Platform fee on Kamino collateral deposits — Kamino's own hosted
// transaction-building API has no fee-passthrough param (confirmed
// directly against its live OpenAPI spec: deposit/borrow/repay/withdraw
// accept only {wallet,market,reserve,amount}), so this is taken as a
// separate transfer to our own wallet, deposit-only per product decision.
export const KAMINO_DEPOSIT_FEE_BPS = 10; // 0.10%

async function signAndSubmit(transaction, signWithWallet) {
  const tx = VersionedTransaction.deserialize(
    Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0))
  );
  const signed = await signWithWallet(tx);
  return btoa(String.fromCharCode(...signed.serialize()));
}

/**
 * One Kamino xStocks-market action (deposit collateral / borrow / repay /
 * withdraw collateral) — identical shape to executeWithdraw above: the
 * server builds an unsigned tx, we sign it with the user's wallet, then
 * submit via the SAME /api/execute (swapV1:true) path everything else in
 * this app already uses to broadcast a signed transaction. No Kamino-
 * specific submit endpoint needed.
 *
 * For deposits, `mint`/`decimals` (of the collateral being deposited) let
 * this take the 0.10% platform fee FIRST, as its own signed transfer, then
 * deposit the reduced (net) amount as collateral — one shared place so
 * both callers (the manual Borrow ticket and the borrow-via-prompt flow)
 * stay consistent automatically, same reasoning as applyReferralFee()
 * being one shared function on the Jupiter side (server/src/index.js).
 * Fails closed: if the fee transfer doesn't go through, the deposit never
 * happens either — never silently skip taking the fee.
 */
export async function executeKaminoAction(action, { wallet, reserve, amount, signWithWallet, onStatus, mint, decimals, usdValue }) {
  const build = KAMINO_BUILDERS[action];
  if (!build) throw new Error(`unknown kamino action: ${action}`);

  let depositAmount = amount;
  if (action === "deposit" && mint) {
    const feeAmount = (Number(amount) * KAMINO_DEPOSIT_FEE_BPS) / 10000;
    const feeAtoms = Math.floor(feeAmount * 10 ** (decimals ?? 8));
    if (feeAtoms > 0) {
      onStatus?.("fee");
      const { transaction: feeTx } = await api.kaminoDepositFee({ from: wallet, mint, decimals, amount: feeAtoms });
      if (!feeTx) throw new Error("could not build deposit fee transaction");
      const signedFeeB64 = await signAndSubmit(feeTx, signWithWallet);
      const feeResult = await api.execute({
        signedTransaction: signedFeeB64, swapV1: true,
        logMeta: {
          walletAddress: wallet, kind: "kamino_deposit_fee",
          usdValue: usdValue != null ? (usdValue * KAMINO_DEPOSIT_FEE_BPS) / 10000 : null,
          details: { mint, feeAtoms },
        },
      });
      if (feeResult.status && feeResult.status !== "Success")
        throw new Error(feeResult.error || `deposit fee transfer failed (${feeResult.status})`);
      depositAmount = String(Number(amount) - feeAmount);
    }
  }

  onStatus?.("building");
  const { transaction } = await build({ wallet, reserve, amount: depositAmount });
  if (!transaction) throw new Error(`could not build ${action} transaction`);

  onStatus?.("signing");
  const signedB64 = await signAndSubmit(transaction, signWithWallet);

  onStatus?.("executing");
  const result = await api.execute({
    signedTransaction: signedB64, swapV1: true,
    logMeta: { walletAddress: wallet, kind: `kamino_${action}`, usdValue: usdValue ?? null, details: { reserve, amount: depositAmount } },
  });
  if (result.status && result.status !== "Success")
    throw new Error(result.error || `${action} failed (${result.status})`);
  onStatus?.("confirmed");
  return result;
}

/**
 * Execute one swap leg end to end:
 * Ultra order → sign with the Privy embedded wallet → Ultra execute.
 * `signWithWallet` receives a VersionedTransaction and must return it signed.
 */
export async function executeSwap({ inputMint, outputMint, amount, taker, signWithWallet, onStatus, usdValue }) {
  onStatus?.("routing");
  const order = await api.order({ inputMint, outputMint, amount: String(amount), taker });
  if (!order.transaction) throw new Error("no route available for this pair right now");

  onStatus?.("signing");
  const tx = VersionedTransaction.deserialize(
    Uint8Array.from(atob(order.transaction), (c) => c.charCodeAt(0))
  );
  const signed = await signWithWallet(tx);
  const signedB64 = btoa(String.fromCharCode(...signed.serialize()));

  onStatus?.("executing");
  const result = await api.execute({
    signedTransaction: signedB64,
    requestId: order.requestId,
    sponsored: order._sponsored,
    swapV1: order._swapV1,
    isSell: order._isSell,
    logMeta: {
      walletAddress: taker, kind: "swap", side: order._isSell ? "sell" : "buy",
      usdValue: usdValue ?? null,
      // feeBps is present on order (Jupiter's raw Ultra response, passed
      // through as-is by the server) only when a referral fee was actually
      // charged — absent on the no-fee AMM sell-fallback path. Recording it
      // per-trade is what lets the referral dashboard compute real fee
      // revenue instead of assuming every swap paid the nominal rate.
      details: { inputMint, outputMint, amount, feeBps: order.feeBps ?? null },
    },
  });
  if (result.status && result.status !== "Success")
    throw new Error(result.error || `swap failed (${result.status})`);
  onStatus?.("confirmed");
  return result; // includes .signature
}

const DUST_USD = 0.01; // positions worth less than $0.01 are treated as dust (always hidden)

/** Given holdings + prices, compute the invested rows and totals. */
export function derivePortfolio(holdings, prices, registry, { yieldMode = false } = {}) {
  const usdcMint = registry.USDC.mint;
  const usdyMint = registry.USDY?.mint;
  let cashUsdc = 0, cashUsdy = 0, usdyAmount = 0;
  const rows = [];
  const dustRows = [];
  for (const t of holdings?.tokens || []) {
    if (t.mint === usdcMint) { cashUsdc = t.uiAmount || 0; continue; }
    if (yieldMode && t.mint === usdyMint) {
      usdyAmount = t.uiAmount || 0;
      cashUsdy = usdyAmount * (prices[usdyMint] || 1);
      continue;
    }
    if (!t.symbol) continue;
    // A missing price (mint absent from the prices map entirely, not just
    // priced at $0) means the upstream feed couldn't quote this mint just
    // now — a real, transient gap, confirmed against a real case: Jupiter's
    // price API silently omits a mint it can't currently price, no error,
    // just absence. Treating that as "worth $0" indistinguishably from
    // genuine dust made real holdings disappear from the dashboard on any
    // reload that raced a gap like this. Keep it in `rows` (not `dustRows`)
    // with priceUnavailable set instead, so the UI can show it honestly
    // rather than hiding a real position.
    const priceUnavailable = prices[t.mint] == null;
    if (priceUnavailable) { rows.push({ ...t, price: null, value: null, priceUnavailable: true }); continue; }
    const price = prices[t.mint];
    const value = (t.uiAmount || 0) * price;
    if (value < DUST_USD) { dustRows.push({ ...t, price, value }); continue; }
    rows.push({ ...t, price, value });
  }
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const invested = rows.reduce((a, r) => a + (r.value || 0), 0);
  const cash = cashUsdc + cashUsdy;
  const total = invested + cash;
  // weight = share of TOTAL portfolio (incl. cash) — consistent with the donut chart
  rows.forEach((r) => (r.weight = total && r.value != null ? (r.value / total) * 100 : 0));
  return { rows, dustRows, cash, cashUsdc, cashUsdy, usdyAmount, invested, total };
}

/**
 * Strip dust deposits/borrows from Kamino loans — a repay or withdraw
 * almost never lands at exactly zero (interest accrues between quoting the
 * amount and the transaction settling), leaving a fractional-cent remainder
 * behind in the obligation. Without this, that remainder keeps counting as
 * "still borrowed" or an "open position" everywhere Kamino data is shown,
 * even once a user has functionally closed it out. Once every deposit and
 * borrow on a loan is dust, the loan itself is dropped.
 */
export function stripKaminoDust(loans, dustUsd = DUST_USD) {
  return loans
    .map((loan) => {
      const info = loan.loanInfo ?? loan;
      const deposits = (info.collateral?.deposits ?? []).filter((d) => Number(d.tokenValue ?? 0) >= dustUsd);
      const borrows = (info.debt?.borrows ?? []).filter((d) => Number(d.tokenValue ?? 0) >= dustUsd);
      return { ...loan, loanInfo: { ...info, collateral: { ...info.collateral, deposits }, debt: { ...info.debt, borrows } } };
    })
    .filter((loan) => loan.loanInfo.collateral.deposits.length > 0 || loan.loanInfo.debt.borrows.length > 0);
}

/**
 * Merge Kamino-deposited collateral back into portfolio rows for display.
 * Depositing collateral moves it out of the wallet's SPL balance, so without
 * this the dashboard makes it look like that value vanished (and skews every
 * other row's allocation %) once a user borrows against a position. Purely
 * additive to `value`/`weight` for display — never touches `uiAmount`, since
 * rebalance/trade planning must keep using wallet-only (freely sellable)
 * balances.
 */
export function mergePortfolioCollateral(portfolio, collateralDeposits) {
  if (!portfolio || !collateralDeposits?.length) return portfolio;
  const byMint = new Map(); // mint -> { usd, tokenName, tokenPrice }
  for (const d of collateralDeposits) {
    const usd = Number(d.tokenValue) || 0;
    if (usd <= 0) continue;
    const prev = byMint.get(d.tokenMint);
    if (prev) prev.usd += usd;
    else byMint.set(d.tokenMint, { usd, tokenName: d.tokenName, tokenPrice: Number(d.tokenPrice) || 0 });
  }
  if (byMint.size === 0) return portfolio;

  const rows = portfolio.rows.map((r) => {
    const c = byMint.get(r.mint);
    if (!c) return r;
    byMint.delete(r.mint);
    return { ...r, value: r.value + c.usd, collateralValue: c.usd };
  });
  for (const [mint, c] of byMint) {
    rows.push({
      mint, symbol: c.tokenName, name: c.tokenName,
      uiAmount: 0, price: c.tokenPrice, value: c.usd, collateralValue: c.usd,
    });
  }
  rows.sort((a, b) => b.value - a.value);
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const total = invested + portfolio.cash;
  rows.forEach((r) => (r.weight = total ? (r.value / total) * 100 : 0));
  return { ...portfolio, rows, invested, total };
}

/** Turn target weights into concrete buy/sell legs (sells first). */
export function planTrades({ allocations, portfolio, prices, registry }) {
  const total = portfolio.total;
  const targetVal = {};
  // Weights are % of total portfolio. Divide by 100 — never renormalize.
  // A partial sell returns weights < 100; the difference stays as cash.
  for (const a of allocations) targetVal[a.symbol] = ((+a.weight || 0) / 100) * total;
  const curVal = {};
  for (const r of portfolio.rows) curVal[r.symbol] = r.value;

  const MIN_TRADE_USD = 0.25;
  const symbols = new Set([...Object.keys(targetVal), ...Object.keys(curVal)]);
  const trades = [];
  let maxSkippedDelta = 0; // largest delta that was skipped as dust
  for (const s of symbols) {
    const delta = (targetVal[s] || 0) - (curVal[s] || 0);
    if (Math.abs(delta) < 0.01) continue; // truly negligible — portfolio already matches
    const tok = registry[s];
    if (!tok) continue;
    if (Math.abs(delta) < MIN_TRADE_USD) {
      maxSkippedDelta = Math.max(maxSkippedDelta, Math.abs(delta));
      continue;
    }
    if (delta < 0) {
      const row = portfolio.rows.find((r) => r.symbol === s);
      const shares = Math.min(Math.abs(delta) / (prices[tok.mint] || 1), row?.uiAmount || 0);
      // Cap at exact on-chain atomic balance — uiAmount can exceed amount due to Token-2022 fee imprecision
      const atoms = Math.min(Math.floor(shares * 10 ** tok.decimals), Number(row?.amount || 0));
      trades.push({
        symbol: s, side: "sell", usd: Math.abs(delta),
        inputMint: tok.mint, outputMint: registry.USDC.mint,
        amount: atoms,
      });
    } else {
      trades.push({
        symbol: s, side: "buy", usd: delta,
        inputMint: registry.USDC.mint, outputMint: tok.mint,
        amount: Math.floor(delta * 10 ** registry.USDC.decimals),
      });
    }
  }
  trades.sort((a) => (a.side === "sell" ? -1 : 1)); // sells free up USDC first
  return { trades: trades.filter((t) => t.amount > 0), maxSkippedDelta };
}

export const usd = (v, d = 2) =>
  (v ?? 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
