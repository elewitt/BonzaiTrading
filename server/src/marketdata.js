/**
 * Real-world market data (quotes, company profile/fundamentals, historical
 * price charts) for the asset info popup — powers the "click a position to
 * see its chart" feature. Backed by Twelve Data's free tier (~800 req/day),
 * plain fetch() calls to match this codebase's existing style (no SDK).
 *
 * xStock symbols on this platform are the real ticker + "x" suffix (e.g.
 * VOOx → VOO, WMTx → WMT — confirmed against the full list in tokens.js), so
 * the underlying ticker is recovered by stripping that suffix. BTC is the
 * one non-xStock, non-cash asset in the registry that has a real chart —
 * routed to Twelve Data's crypto symbol format (BTC/USD) instead.
 */

const TD_KEY = process.env.TWELVE_DATA_API_KEY || "";
const TD_BASE = "https://api.twelvedata.com";

if (!TD_KEY) {
  console.warn("[marketdata] TWELVE_DATA_API_KEY not set — asset info popup will be unavailable.");
}

// Simple in-memory TTL cache, same pattern as the token registry cache in
// tokens.js — stretches the free tier's 800 req/day budget under real
// traffic (repeat views of the same symbol don't cost another request).
const cache = new Map(); // key -> { data, expiresAt }

async function cached(key, ttlMs, fetchFn) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetchFn();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

function resolveTicker(symbol) {
  if (symbol === "BTC") return { ticker: "BTC/USD", isCrypto: true };
  return { ticker: symbol.replace(/x$/, ""), isCrypto: false };
}

async function tdFetch(path, params) {
  if (!TD_KEY) throw new Error("TWELVE_DATA_API_KEY not set on server");
  const qs = new URLSearchParams({ ...params, apikey: TD_KEY });
  const r = await fetch(`${TD_BASE}${path}?${qs}`);
  const data = await r.json();
  if (data.status === "error" || data.code) throw new Error(data.message || `Twelve Data ${path} failed`);
  return data;
}

const QUOTE_TTL = 5 * 60_000; // 5 min — prices move
const PROFILE_TTL = 24 * 60 * 60_000; // 24h — company info rarely changes
const CHART_TTL = 15 * 60_000; // 15 min

const RANGE_PARAMS = {
  "1D": { interval: "5min", outputsize: 80 },
  "1W": { interval: "30min", outputsize: 80 },
  "1M": { interval: "1day", outputsize: 30 },
  "3M": { interval: "1day", outputsize: 90 },
  "1Y": { interval: "1week", outputsize: 52 },
};

/** Quote + company profile/fundamentals for the asset info popup header. */
export async function getMarketInfo(symbol) {
  const { ticker, isCrypto } = resolveTicker(symbol);
  const quote = await cached(`quote:${ticker}`, QUOTE_TTL, () => tdFetch("/quote", { symbol: ticker }));

  // Company fundamentals don't apply to crypto, and are non-essential — a
  // failure here (e.g. rate limit) shouldn't break the whole popup, so
  // these degrade to null independently of the quote and of each other.
  // Only successful fetches get cached, so a transient failure retries on
  // the next request instead of being stuck for 24h.
  let profile = null, statistics = null;
  if (!isCrypto) {
    [profile, statistics] = await Promise.all([
      cached(`profile:${ticker}`, PROFILE_TTL, () => tdFetch("/profile", { symbol: ticker })).catch(() => null),
      cached(`stats:${ticker}`, PROFILE_TTL, () => tdFetch("/statistics", { symbol: ticker })).catch(() => null),
    ]);
  }

  return { ticker, isCrypto, quote, profile, statistics };
}

// "1D" asks Twelve Data for a fixed count of recent 5-minute bars — there's
// no "since today's session open" mode. Early in a trading session (or
// pre-market), 80 bars back reaches past today's open into yesterday's
// close, so the response silently stitches two disjoint sessions together
// with a multi-hour gap between them, which renders as a fake-looking
// straight-line-then-cliff shape and starves the axis of real spacing to
// work with. Trim to just the most recent session by finding the last gap
// far bigger than a normal (or even one-dropped-bar) 5-minute step.
function trimToLastSession(points, intervalMs) {
  const gapThreshold = Math.max(intervalMs * 6, 30 * 60_000);
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].ts - points[i - 1].ts > gapThreshold) start = i;
  }
  return points.slice(start);
}

/** Historical close-price series for the chart, for a given timeframe. */
export async function getMarketChart(symbol, range) {
  const { ticker } = resolveTicker(symbol);
  const params = RANGE_PARAMS[range] || RANGE_PARAMS["1M"];
  const data = await cached(`chart:${ticker}:${range}`, CHART_TTL, () =>
    tdFetch("/time_series", { symbol: ticker, interval: params.interval, outputsize: params.outputsize })
  );
  let points = (data.values || [])
    .map((v) => ({ ts: new Date(v.datetime).getTime(), price: Number(v.close) }))
    .filter((p) => Number.isFinite(p.price))
    .sort((a, b) => a.ts - b.ts);
  if (range === "1D") points = trimToLastSession(points, 5 * 60_000);
  return { ticker, range, points };
}
