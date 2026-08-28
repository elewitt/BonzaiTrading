/**
 * Kalshi's own candlesticks endpoint — chart history for one prediction
 * market, fetched on demand when a user opens a market's detail view.
 *
 * Deliberately NOT part of predictionMarkets.js's background crawl: that
 * snapshot already covers ~6,200 active markets on a 10-min cycle, and
 * pulling candle history for all of them on every cycle would be a huge,
 * mostly-wasted fetch (nobody's looking at the vast majority at any given
 * moment). This is called per-market, per-click instead, same "fetch what's
 * actually being viewed" shape as marketdata.js's Twelve Data chart.
 *
 * Confirmed live against the real API (2026-08-27): market-data reads
 * (markets/series/candlesticks) need no API key — only placing/managing
 * orders does — and marketTicker/seriesTicker from predictionMarkets.js's
 * DFlow snapshot ARE Kalshi's own tickers (DFlow tokenizes Kalshi's real
 * markets 1:1), so they can be used against Kalshi's API directly with no
 * DFlow involvement here.
 *
 * period_interval is minutes-per-candle and Kalshi only accepts EXACTLY
 * {1, 60, 1440} — any other value 400s with a validation error (confirmed).
 * Candle price fields come back as decimal-dollar strings (e.g. "0.9200"
 * for 92¢), and a candle with no trades that period has an empty `price`
 * object (still has yes_bid/yes_ask though) — confirmed both shapes live.
 */
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const CANDLES_TTL = 5 * 60_000; // 5 min — same "live-ish, not tick-by-tick" tier as marketdata.js's chart cache

const cache = new Map(); // key -> { data, expiresAt }
async function cached(key, ttlMs, fetchFn) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetchFn();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

// Mirrors AssetDetailPanel.jsx's Day/Week/Month/All periods so the same
// period keys/labels work for both an asset chart and a prediction-market
// chart. Interval widens with range for the same reason marketdata.js's
// RANGE_PARAMS does — a year of 1-minute candles is neither a real Kalshi
// option nor something a browser chart benefits from.
const RANGE_PARAMS = {
  perpDay:     { periodInterval: 1,    days: 1 },
  perpWeek:    { periodInterval: 60,   days: 7 },
  perpMonth:   { periodInterval: 60,   days: 30 },
  perpAllTime: { periodInterval: 1440, days: 365 },
};

/** Historical YES price series for a market's chart, for a given period. */
export async function getPredictionMarketCandles(seriesTicker, marketTicker, range) {
  const params = RANGE_PARAMS[range] || RANGE_PARAMS.perpWeek;
  const key = `candles:${seriesTicker}:${marketTicker}:${range}`;
  return cached(key, CANDLES_TTL, async () => {
    const end = Math.floor(Date.now() / 1000);
    const start = end - params.days * 86_400;
    const qs = new URLSearchParams({
      start_ts: String(start), end_ts: String(end), period_interval: String(params.periodInterval),
    });
    const url = `${KALSHI_BASE}/series/${seriesTicker}/markets/${marketTicker}/candlesticks?${qs}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Kalshi candlesticks HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const points = (data.candlesticks || [])
      .map((c) => {
        // Prefer the actual traded price for the period; a quiet period
        // (price:{}) falls back to the yes bid/ask midpoint so the line
        // stays continuous instead of gapping out whenever nobody traded.
        const traded = c.price?.close_dollars;
        const bid = c.yes_bid?.close_dollars;
        const ask = c.yes_ask?.close_dollars;
        let price = traded != null ? Number(traded) : null;
        if (price == null && bid != null && ask != null) price = (Number(bid) + Number(ask)) / 2;
        if (price == null || !Number.isFinite(price)) return null;
        return { ts: c.end_period_ts * 1000, price };
      })
      .filter(Boolean);
    return { seriesTicker, marketTicker, range, points };
  });
}
