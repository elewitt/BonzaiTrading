import { getRegistry, JUP_BASE, jupHeaders, USDC } from "./tokens.js";
import { getXstocksReserves } from "./kamino.js";

/* ————— Market liquidity monitoring — ops-facing, background job —————
 * Nothing here is customer-facing or blocks a trade — that guardrail
 * already exists (priceImpactError/MAX_PRICE_IMPACT_PCT in index.js). This
 * just watches conditions over time and surfaces thin liquidity in the
 * admin tool before a customer runs into it. In-memory snapshot only (no
 * DB table) — matches this codebase's existing TTL-cache convention
 * (geo cache, Kamino reserve cache) since this is current-state
 * monitoring, not history.
 */
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const EQUITY_DEX = "xyz"; // kept in sync with web/src/perps/config.js

const BENCHMARK_USDC = Number(process.env.MARKET_HEALTH_BENCHMARK_USD || 1000);
const IMPACT_THRESHOLD_PCT = Number(process.env.MARKET_HEALTH_IMPACT_PCT || 3);
const SPREAD_THRESHOLD_PCT = Number(process.env.MARKET_HEALTH_SPREAD_PCT || 1);
const MIN_DEPTH_USD = Number(process.env.MARKET_HEALTH_MIN_DEPTH_USD || 500);
const DEPTH_RANGE_PCT = 2; // "depth within 2% of mid" on each side
const MAX_UTILIZATION_PCT = Number(process.env.MARKET_HEALTH_MAX_UTILIZATION_PCT || 90);
const INTERVAL_MS = Number(process.env.MARKET_HEALTH_INTERVAL_MS || 15 * 60 * 1000);
const BATCH_SIZE = 12; // concurrent requests per batch — spread load rather than firing everything at once

let snapshot = { generatedAt: null, brokerage: [], perps: [], borrow: [] };

export function getMarketHealthSnapshot() {
  return snapshot;
}

async function inBatches(items, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results.filter(Boolean);
}

/** One quote per xStock/crypto mint at a fixed benchmark size, against
 * USDC — the same classic Jupiter quote endpoint the AMM sell-fallback
 * path in buildOrder() already uses (no taker/wallet needed, so this has
 * zero side effects, unlike Ultra order-building). A missing route is
 * flagged too — "can't even quote $1000" is a worse signal than high
 * impact, not something to silently skip. */
async function checkBrokerage() {
  const { bySymbol } = await getRegistry();
  const amount = String(Math.round(BENCHMARK_USDC * 10 ** USDC.decimals));
  const entries = Object.entries(bySymbol).filter(([symbol, t]) => symbol !== "USDC" && t.mint);
  return inBatches(entries, async ([symbol, token]) => {
    try {
      const params = new URLSearchParams({ inputMint: USDC.mint, outputMint: token.mint, amount, slippageBps: "150" });
      const r = await fetch(`${JUP_BASE}/swap/v1/quote?${params}`, { headers: jupHeaders() });
      const data = await r.json();
      if (!r.ok || data.error || !data.priceImpactPct) {
        return { symbol, impactPct: null, flagged: true, reason: "no route at benchmark size" };
      }
      const impactPct = Number(data.priceImpactPct) * 100;
      return { symbol, impactPct, flagged: impactPct > IMPACT_THRESHOLD_PCT };
    } catch {
      return null; // network hiccup — skip this one, don't fail the whole cycle
    }
  });
}

async function hlInfo(body) {
  const r = await fetch(HL_INFO_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

/** Spread and USD depth near mid for every listed Hyperliquid asset, both
 * dexs. Public, unauthenticated l2Book endpoint — confirmed live via the
 * installed @nktkas/hyperliquid SDK's types, called here with plain fetch
 * (matches hyperliquid.js's style; no wallet/signing needed for a read). */
async function checkPerpsDex(dex) {
  const meta = await hlInfo(dex ? { type: "meta", dex } : { type: "meta" });
  const coins = (meta.universe || []).map((u) => u.name);
  return inBatches(coins, async (coin) => {
    try {
      const book = await hlInfo(dex ? { type: "l2Book", coin, dex } : { type: "l2Book", coin });
      const [bids, asks] = book?.levels || [[], []];
      if (!bids.length || !asks.length) return { symbol: coin, dex: dex || "crypto", flagged: true, reason: "no book" };
      const bestBid = Number(bids[0].px), bestAsk = Number(asks[0].px);
      const mid = (bestBid + bestAsk) / 2;
      const spreadPct = ((bestAsk - bestBid) / mid) * 100;
      const depthUsd = (side, mult) => side
        .filter((l) => Math.abs(Number(l.px) - mid) / mid * 100 <= DEPTH_RANGE_PCT)
        .reduce((s, l) => s + Number(l.sz) * Number(l.px), 0) * mult;
      const depthUsdTotal = depthUsd(bids, 1) + depthUsd(asks, 1);
      const flagged = spreadPct > SPREAD_THRESHOLD_PCT || depthUsdTotal < MIN_DEPTH_USD;
      return { symbol: coin, dex: dex || "crypto", spreadPct, depthUsd: depthUsdTotal, flagged };
    } catch {
      return null;
    }
  });
}

async function checkPerps() {
  const [crypto, equity] = await Promise.all([checkPerpsDex(undefined), checkPerpsDex(EQUITY_DEX)]);
  return [...crypto, ...equity];
}

/** Reserve utilization — how much of what's supplied is already borrowed.
 * High utilization means little room left to borrow more, and thinner
 * liquidity for depositors trying to withdraw. */
async function checkBorrow() {
  const reserves = await getXstocksReserves();
  return (reserves || []).map((r) => {
    const supply = Number(r.totalSupplyUsd), borrow = Number(r.totalBorrowUsd);
    const utilizationPct = supply > 0 ? (borrow / supply) * 100 : 0;
    return { symbol: r.liquidityToken, utilizationPct, flagged: utilizationPct > MAX_UTILIZATION_PCT };
  });
}

async function runCheck() {
  const [brokerage, perps, borrow] = await Promise.all([
    checkBrokerage().catch((e) => { console.error("[marketHealth] brokerage check failed:", e.message); return []; }),
    checkPerps().catch((e) => { console.error("[marketHealth] perps check failed:", e.message); return []; }),
    checkBorrow().catch((e) => { console.error("[marketHealth] borrow check failed:", e.message); return []; }),
  ]);
  snapshot = { generatedAt: new Date().toISOString(), brokerage, perps, borrow };
  const flaggedCount = [brokerage, perps, borrow].flat().filter((r) => r.flagged).length;
  console.log(`[marketHealth] snapshot updated — ${flaggedCount} flagged across ${brokerage.length + perps.length + borrow.length} markets checked`);
}

/** Starts the background job. Call once at boot — never awaited by any
 * request, purely a side background loop. */
export function startMarketHealthMonitor() {
  void runCheck();
  setInterval(() => void runCheck(), INTERVAL_MS);
}
