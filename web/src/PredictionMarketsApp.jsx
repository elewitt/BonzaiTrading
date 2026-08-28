import { useEffect, useRef, useState } from "react";
import { API_BASE, fmtBig } from "./lib/api.js";
import PredictionMarketDetailPanel from "./components/PredictionMarketDetailPanel.jsx";

// Mirrors the allowlist in server/src/predictionMarkets.js — kept in sync
// manually since one is a curated product decision (client tabs) and the
// other drives what the background crawler actually fetches from DFlow;
// duplicating a short constant is simpler than coupling the two.
const CATEGORIES = ["All", "Financials", "Politics", "Elections", "Companies", "Economics", "Science and Technology"];

const PAGE_SIZE = 60;
const SUGGESTION_LIMIT = 8;

// The detail card's natural height is the reference the list panel is
// capped to and scrolls within — same master-detail pattern as
// EquitiesMarketsApp.jsx (see its MIN_CHART_HEIGHT / ResizeObserver).
const MIN_CHART_HEIGHT = 560;

function centsPrice(v) {
  return v == null ? null : Math.round(v * 100);
}

function formatCloseTime(unixSeconds) {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const now = Date.now();
  const diffDays = (d.getTime() - now) / 86_400_000;
  if (diffDays < 0) return "Closed";
  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Tomorrow";
  if (diffDays < 30) return `${Math.round(diffDays)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: diffDays > 300 ? "numeric" : undefined });
}

async function fetchMarkets({ category, q, offset }) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (category && category !== "All") params.set("category", category);
  if (q) params.set("q", q);
  const r = await fetch(`${API_BASE}/api/predictions/markets?${params}`);
  if (!r.ok) throw new Error(`prediction markets HTTP ${r.status}`);
  return r.json();
}

function MarketRow({ m, active, onClick }) {
  const yes = centsPrice(m.yesAsk ?? m.yesBid);
  const no = centsPrice(m.noAsk ?? m.noBid);
  const meta = [
    m.category,
    m.volume ? `${fmtBig(m.volume)} Vol` : null,
    m.closeTime ? `Closes ${formatCloseTime(m.closeTime)}` : null,
  ].filter(Boolean).join("  ·  ");

  return (
    <div className={`pm-row ${active ? "active" : ""}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <span className="pm-row-main">
        <span className="serif pm-row-title">{m.title}</span>
        <span className="tiny muted pm-row-meta">{meta}</span>
      </span>
      <span className="pm-outcome pm-yes">{yes != null ? `${yes}¢` : "—"}</span>
      <span className="pm-outcome pm-no">{no != null ? `${no}¢` : "—"}</span>
    </div>
  );
}

export default function PredictionMarketsApp({ onBack }) {
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [category, setCategory] = useState("All");
  const [data, setData] = useState(null); // { generatedAt, total, categoryCounts, markets }
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTicker, setSelectedTicker] = useState(null); // marketTicker shown in the detail panel, or null (falls back to first row)
  const [chartHeight, setChartHeight] = useState(null);
  const chartColRef = useRef(null);

  // Debounced — every keystroke would otherwise fire a new server request
  // (this can't filter client-side like EquitiesMarketsApp does; the full
  // dataset is ~18,500 markets / ~10MB, confirmed too large to ship whole).
  useEffect(() => {
    setOffset(0);
    setLoading(true);
    const t = setTimeout(() => {
      fetchMarkets({ category, q: search, offset: 0 })
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [category, search]);

  const loadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoading(true);
    fetchMarkets({ category, q: search, offset: nextOffset })
      .then((d) => {
        setData((prev) => ({ ...d, markets: [...(prev?.markets || []), ...d.markets] }));
        setOffset(nextOffset);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const markets = data?.markets ?? [];
  const total = data?.total ?? 0;
  const categoryCounts = data?.categoryCounts ?? {};
  const hasMore = markets.length < total;

  // Autocomplete: the debounced list fetch above already returns exactly
  // the markets matching `search`, so the suggestion list is just the top
  // slice of it — no separate request.
  const suggestions = search.trim() && searchFocused ? markets.slice(0, SUGGESTION_LIMIT) : [];

  const pickSuggestion = (m) => {
    setSelectedTicker(m.marketTicker);
    setSearchFocused(false);
  };

  // Always shows something in the detail panel — falls back to the first
  // row when the selection isn't in the current result set, same pattern
  // as EquitiesMarketsApp.jsx's detailRow.
  const detailMarket = markets.find((m) => m.marketTicker === selectedTicker) ?? markets[0] ?? null;

  // Cap the list panel to the detail card's natural height so the two end
  // flush — same as EquitiesMarketsApp.jsx:191-197.
  useEffect(() => {
    const el = chartColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setChartHeight(Math.max(entry.contentRect.height, MIN_CHART_HEIGHT)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [detailMarket?.marketTicker]);

  return (
    <div className="stage dash-wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="markets-page-header">
        <h2 className="display sm markets-page-title">Prediction Markets</h2>
      </div>

      {error && <p className="err" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="pm-search-hero">
        <svg className="pm-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="6" />
          <line x1="14" y1="14" x2="18" y2="18" strokeLinecap="round" />
        </svg>
        <input
          className="pm-search-input"
          placeholder="Search all prediction markets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
        />
        {search && (
          <button className="pm-search-clear" aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()} onClick={() => setSearch("")}>
            ×
          </button>
        )}
        {suggestions.length > 0 && (
          <div className="pm-search-dropdown">
            {suggestions.map((m) => {
              const yes = centsPrice(m.yesAsk ?? m.yesBid);
              return (
                <button key={m.marketTicker} className="pm-search-suggestion"
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(m)}>
                  <span className="serif pm-suggestion-title">{m.title}</span>
                  <span className="tiny muted pm-suggestion-meta">
                    {m.category}{yes != null ? `  ·  ${yes}¢ Yes` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="equities-layout pm-layout">
        <div className="card perps-asset-panel equities-list-panel pm-list-panel"
          style={chartHeight ? { height: chartHeight } : undefined}>
          <h3>Markets</h3>
          <div className="perps-category-toggle pm-category-toggle">
            {CATEGORIES.map((c) => {
              const count = c !== "All" ? categoryCounts[c] : null;
              return (
                <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>
                  {c}{count ? <span className="pm-cat-count">{count.toLocaleString()}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="pm-list-head">
            <span>Market</span>
            <span>Yes</span>
            <span>No</span>
          </div>

          <div className="perps-asset-list">
            {!data && loading && <p className="muted" style={{ padding: "16px 0" }}>Loading…</p>}
            {data && markets.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>No matches.</p>}
            {markets.map((m) => (
              <MarketRow key={m.marketTicker} m={m}
                active={detailMarket?.marketTicker === m.marketTicker}
                onClick={() => setSelectedTicker(m.marketTicker)} />
            ))}
            {hasMore && (
              <button className="btn ghost pm-load-more" disabled={loading} onClick={loadMore}>
                {loading ? "Loading…" : `Show more (${markets.length} of ${total.toLocaleString()})`}
              </button>
            )}
          </div>
        </div>

        <div ref={chartColRef} className="card equities-detail-card">
          {detailMarket ? (
            <PredictionMarketDetailPanel market={detailMarket} />
          ) : (
            <p className="muted">Select a market to see its chart.</p>
          )}
        </div>
      </div>
    </div>
  );
}
