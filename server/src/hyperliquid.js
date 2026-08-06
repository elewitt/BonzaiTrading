/* ————— Hyperliquid — read-only, server-side, admin lookups only —————
 * The server has no other Hyperliquid integration; all perps trading is
 * client-side (see web/src/perps/). This is just enough to show a
 * customer's positions in the admin tool: two plain, unauthenticated,
 * public POSTs to Hyperliquid's info endpoint (main crypto dex + the "xyz"
 * equities/commodities builder dex, same pair of calls
 * web/src/perps/useHyperliquid.js already makes client-side). No SDK
 * dependency needed for two read calls — matches kamino.js's plain-fetch
 * style rather than adding @nktkas/hyperliquid to the server too.
 */
import { getRegistry } from "./tokens.js";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const EQUITY_DEX = "xyz"; // kept in sync with web/src/perps/config.js

async function info(body) {
  const r = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Hyperliquid info request failed (${r.status})`);
  return r.json();
}

async function clearinghouseState(user, dex) {
  return info(dex ? { type: "clearinghouseState", user, dex } : { type: "clearinghouseState", user });
}

function mapPositions(state, dexLabel) {
  return (state?.assetPositions || []).map(({ position: p }) => {
    const szi = Number(p.szi);
    const side = szi >= 0 ? "long" : "short";
    const markPx = Number(p.positionValue) / Math.abs(szi || 1);
    return {
      dex: dexLabel,
      coin: p.coin,
      side,
      size: Math.abs(szi),
      entryPx: Number(p.entryPx),
      markPx,
      unrealizedPnl: Number(p.unrealizedPnl),
      leverage: p.leverage?.value ?? null,
    };
  });
}

/** A customer's Perps picture across both dexs, keyed by their EVM address
 * (Privy's embedded Ethereum wallet — Perps never touches Solana). Fails
 * soft (empty positions, zero values) on lookup error so one broken
 * upstream call doesn't take down the whole admin customer view. */
export async function getPerpsPositions(evmAddress) {
  if (!evmAddress) return { positions: [], cryptoAccountValue: 0, equityAccountValue: 0 };
  try {
    const [crypto, equity] = await Promise.all([
      clearinghouseState(evmAddress),
      clearinghouseState(evmAddress, EQUITY_DEX),
    ]);
    return {
      positions: [...mapPositions(crypto, "crypto"), ...mapPositions(equity, "equity")],
      cryptoAccountValue: Number(crypto?.marginSummary?.accountValue ?? 0),
      equityAccountValue: Number(equity?.marginSummary?.accountValue ?? 0),
    };
  } catch (e) {
    console.error(`[hyperliquid] lookup failed for ${evmAddress} (non-fatal): ${e.message}`);
    return { positions: [], cryptoAccountValue: 0, equityAccountValue: 0 };
  }
}

/** Current funding rate + mark price for every asset on one dex — same
 * metaAndAssetCtxs call the client already uses for mark prices. `coin` on
 * each row is the exact raw Hyperliquid identifier (plain "BTC" on the
 * main dex, dex-prefixed "xyz:AAPL" on the equity dex — meta(dex)'s own
 * universe entries already carry that prefix, confirmed live), matching
 * what strategyAgents/deltaNeutral.js stores as a strategy's `hlCoin`. */
export async function getFundingSnapshot(dex) {
  const [meta, ctxs] = await info(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" });
  return meta.universe.map((u, i) => ({
    coin: u.name,
    funding: Number(ctxs[i]?.funding ?? 0),
    markPx: Number(ctxs[i]?.markPx ?? 0),
  }));
}

/** Hourly funding prints for one coin — `coin` must already carry its dex
 * prefix if it has one (same "xyz:AAPL" form as candleSnapshot/getFundingSnapshot),
 * confirmed live: passing a bare equity ticker plus a separate `dex` field
 * returns nothing, but the dex-prefixed coin alone works with no `dex`
 * field at all. Positive fundingRate means longs pay shorts (favorable for
 * a short position); negative means shorts pay longs. */
export async function getFundingHistory({ coin, startTime, endTime }) {
  const body = { type: "fundingHistory", coin, startTime };
  if (endTime) body.endTime = endTime;
  return info(body);
}

/** Every asset delta-neutral can target: listed as a spot xStock/crypto in
 * OUR registry AND tradeable as a Hyperliquid perp on either dex. Crypto
 * matches directly (registry "BTC" <-> HL coin "BTC"); equities match via
 * the same "AAPLx" <-> "xyz:AAPL" convention EquitiesMarketsApp.jsx's
 * underlyingTicker() already uses (xStock ticker = real ticker + trailing
 * "x"; HL equity coin = "xyz:" + real ticker) — reimplemented here rather
 * than imported since that's frontend-only code. */
export async function getDeltaNeutralEligibleAssets() {
  const { bySymbol } = await getRegistry();
  const [cryptoMeta, equityMeta] = await Promise.all([
    info({ type: "meta" }),
    info({ type: "meta", dex: EQUITY_DEX }),
  ]);

  const out = [];
  for (const u of cryptoMeta.universe) {
    if (u.isDelisted) continue;
    const token = bySymbol[u.name];
    if (token) out.push({ symbol: token.symbol, mint: token.mint, hlCoin: u.name, hlDex: null, maxLeverage: u.maxLeverage });
  }
  for (const u of equityMeta.universe) {
    if (u.isDelisted) continue;
    const underlying = u.name.split(":")[1] ?? u.name;
    const token = bySymbol[`${underlying}x`];
    if (token) out.push({ symbol: token.symbol, mint: token.mint, hlCoin: u.name, hlDex: EQUITY_DEX, maxLeverage: u.maxLeverage });
  }
  return out;
}
