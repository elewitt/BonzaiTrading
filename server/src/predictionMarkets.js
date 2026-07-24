import { USDC } from "./tokens.js";

/* ————— Prediction markets (Kalshi via DFlow) — background crawler —————
 * DFlow tokenizes Kalshi's CFTC-regulated prediction markets as real SPL
 * tokens on Solana (see https://dflow.net/blog/prediction-markets-api).
 * Scoped to a curated category allowlist per product decision — Bonzai
 * Trading's prediction markets product covers financial/political/business/
 * economic/tech markets only, not sports/entertainment/weather/etc.
 *
 * The category taxonomy has no direct "give me active events in category X"
 * endpoint — /api/v1/events ignores a `category` param entirely (confirmed
 * against the real API), and filtering by `seriesTickers` is capped at 25
 * tickers per request while a single category can have 500-2000+ series
 * (Politics alone: ~2058). Crawling every series individually to check for
 * an active event would be 200+ batched requests. Instead: paginate ALL
 * active events platform-wide without nested data (~31 requests at 200/page,
 * confirmed ~6,200 total active events server-side), filter that list down
 * to series belonging to the allowed categories, THEN batch-fetch full
 * nested market/mint data only for that much smaller filtered set.
 *
 * In-memory snapshot only, refreshed on a background interval — this is
 * "what can I currently trade" browsing data, not something that needs
 * sub-minute freshness, same philosophy as marketHealth.js.
 */
const META_BASE = "https://d.prediction-markets-api.dflow.net";
const API_KEY = process.env.DFLOW_API_KEY || "";
const INTERVAL_MS = Number(process.env.PREDICTION_MARKETS_INTERVAL_MS || 10 * 60 * 1000);
const EVENTS_PAGE_LIMIT = 200;
const SERIES_BATCH_SIZE = 25; // DFlow's own hard cap: "seriesTickers must contain at most 25 tickers"
const MAX_EVENT_PAGES = 60; // safety cap — real crawl currently needs ~31

export const ALLOWED_CATEGORIES = [
  "Financials", "Politics", "Elections", "Companies", "Economics", "Science and Technology",
];

let snapshot = { generatedAt: null, markets: [] };

export function getPredictionMarketsSnapshot() {
  return snapshot;
}

function headers() {
  return API_KEY ? { "x-api-key": API_KEY } : {};
}

async function dflowGet(path, params) {
  const url = `${META_BASE}${path}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`DFlow ${path} HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

/** ticker -> category, for every series in the allowed categories. One
 * request per category (small, fixed count — unlike the events crawl). */
async function buildAllowedSeriesMap() {
  const map = new Map();
  await Promise.all(ALLOWED_CATEGORIES.map(async (category) => {
    const { series } = await dflowGet("/api/v1/series", { category });
    for (const s of series || []) map.set(s.ticker, category);
  }));
  return map;
}

/** Paginate every currently-active event platform-wide, WITHOUT nested
 * market data (cheap — a few hundred KB/page vs several MB with nested
 * data) — just enough to know which series currently have something live. */
async function fetchAllActiveEventTickersLight() {
  const events = [];
  let cursor;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const params = { status: "active", withNestedMarkets: "false", limit: String(EVENTS_PAGE_LIMIT) };
    if (cursor != null) params.cursor = String(cursor);
    const data = await dflowGet("/api/v1/events", params);
    const batch = data.events || [];
    events.push(...batch);
    if (!data.cursor || batch.length === 0) break;
    cursor = data.cursor;
  }
  return events;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Full nested event+market data (prices, mints) for a specific set of
 * series tickers, respecting DFlow's 25-tickers-per-request cap. */
async function fetchNestedEventsForSeries(seriesTickers) {
  const batches = chunk(seriesTickers, SERIES_BATCH_SIZE);
  const results = await Promise.all(batches.map((batch) =>
    dflowGet("/api/v1/events", {
      seriesTickers: batch.join(","), status: "active", withNestedMarkets: "true", limit: String(EVENTS_PAGE_LIMIT),
    }).catch((e) => {
      console.error("[predictionMarkets] nested batch failed:", e.message);
      return { events: [] };
    })
  ));
  return results.flatMap((r) => r.events || []);
}

/** Flattens event+nested-markets into one row per market, with just the
 * fields the UI needs — prefers USDC-settled accounts (this app's native
 * currency) over other settlement currencies (e.g. Kalshi's own "CASH"). */
function flattenMarkets(events, seriesCategoryMap) {
  const rows = [];
  for (const ev of events) {
    const category = seriesCategoryMap.get(ev.seriesTicker);
    if (!category) continue; // shouldn't happen (we only fetched allowed series), but don't trust it blindly
    for (const m of ev.markets || []) {
      if (m.status !== "active") continue;
      const accounts = m.accounts || {};
      const usdcAccount = accounts[USDC.mint];
      const anyAccount = usdcAccount || Object.values(accounts)[0];
      if (!anyAccount) continue;
      rows.push({
        category,
        eventTicker: ev.ticker,
        eventTitle: ev.title,
        seriesTicker: ev.seriesTicker,
        marketTicker: m.ticker,
        title: m.title || ev.title,
        yesSubTitle: m.yesSubTitle,
        noSubTitle: m.noSubTitle,
        yesBid: m.yesBid, yesAsk: m.yesAsk, noBid: m.noBid, noAsk: m.noAsk,
        volume: m.volume, volume24h: m.volume24h,
        closeTime: m.closeTime,
        yesMint: anyAccount.yesMint,
        noMint: anyAccount.noMint,
        settledInUsdc: !!usdcAccount,
      });
    }
  }
  return rows;
}

async function runCrawl() {
  if (!API_KEY) {
    console.warn("[predictionMarkets] DFLOW_API_KEY not set — prediction markets unavailable.");
    return;
  }
  const seriesCategoryMap = await buildAllowedSeriesMap();
  const lightEvents = await fetchAllActiveEventTickersLight();
  const relevantSeriesTickers = [...new Set(
    lightEvents.filter((e) => seriesCategoryMap.has(e.seriesTicker)).map((e) => e.seriesTicker)
  )];
  const nestedEvents = await fetchNestedEventsForSeries(relevantSeriesTickers);
  const markets = flattenMarkets(nestedEvents, seriesCategoryMap);
  snapshot = { generatedAt: new Date().toISOString(), markets };
  console.log(`[predictionMarkets] snapshot updated — ${markets.length} active markets across ${relevantSeriesTickers.length} series`);
}

/** Starts the background job. Call once at boot — never awaited by any
 * request, purely a side background loop. */
export function startPredictionMarketsMonitor() {
  void runCrawl().catch((e) => console.error("[predictionMarkets] initial crawl failed:", e.message));
  setInterval(() => void runCrawl().catch((e) => console.error("[predictionMarkets] crawl failed:", e.message)), INTERVAL_MS);
}
