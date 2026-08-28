import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "./lib/api.js";
import PredictionMarketDetailModal from "./components/PredictionMarketDetailModal.jsx";

// Mirrors the allowlist in server/src/predictionMarkets.js — kept in sync
// manually since one is a curated product decision (client tabs) and the
// other drives what the background crawler actually fetches from DFlow;
// duplicating a short constant is simpler than coupling the two.
const CATEGORIES = ["All", "Financials", "Politics", "Elections", "Companies", "Economics", "Science and Technology"];

const PAGE_SIZE = 60;

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

function MarketRow({ m, onClick }) {
  const yes = centsPrice(m.yesAsk ?? m.yesBid);
  const no = centsPrice(m.noAsk ?? m.noBid);
  return (
    <div className="trow trow-predictions pm-row" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <span className="asset">
        <span className="serif">{m.title}</span>
        <span className="tiny muted">{m.category}{m.eventTitle && m.eventTitle !== m.title ? ` · ${m.eventTitle}` : ""}</span>
      </span>
      <span className="pm-outcome pm-yes">{yes != null ? `${yes}¢` : "—"}</span>
      <span className="pm-outcome pm-no">{no != null ? `${no}¢` : "—"}</span>
      <span className="mono tiny muted">{m.volume ? `$${Math.round(m.volume).toLocaleString()}` : "—"}</span>
      <span className="tiny muted">{formatCloseTime(m.closeTime)}</span>
    </div>
  );
}

export default function PredictionMarketsApp({ onBack }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [data, setData] = useState(null); // { generatedAt, total, categoryCounts, markets }
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMarket, setSelectedMarket] = useState(null);

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
    }, 350);
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

  return (
    <div className="stage wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="markets-page-header">
        <h2 className="display sm markets-page-title">Prediction Markets</h2>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="perps-category-toggle" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>
              {c}{c !== "All" && categoryCounts[c] ? ` (${categoryCounts[c].toLocaleString()})` : ""}
            </button>
          ))}
        </div>
        <input className="perps-asset-search" placeholder="Search markets…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
      </div>

      {error && <p className="err" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="card table-card">
        <div className="trow trow-predictions thead tiny label">
          <span>Market</span>
          <span>Yes</span>
          <span>No</span>
          <span>Volume</span>
          <span>Closes</span>
        </div>
        {!data && loading && <p className="muted" style={{ padding: "16px 0" }}>Loading…</p>}
        {data && markets.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>No matches.</p>}
        {markets.map((m) => <MarketRow key={m.marketTicker} m={m} onClick={() => setSelectedMarket(m)} />)}
      </div>

      {hasMore && (
        <button className="btn ghost" style={{ width: "100%", marginTop: 14 }} disabled={loading} onClick={loadMore}>
          {loading ? "Loading…" : `Show more (${markets.length} of ${total.toLocaleString()})`}
        </button>
      )}

      {selectedMarket && (
        <PredictionMarketDetailModal market={selectedMarket} onClose={() => setSelectedMarket(null)} />
      )}
    </div>
  );
}
