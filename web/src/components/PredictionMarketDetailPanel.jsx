import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api.js";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

// Same Day/Week/Month/All periods as AssetDetailPanel.jsx's chart — see
// kalshiCandles.js's RANGE_PARAMS for how each maps to a Kalshi
// period_interval/lookback window server-side.
const PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

// Same one-liner as PredictionMarketsApp.jsx's own centsPrice — duplicated
// rather than shared for the same reason that file gives for its CATEGORIES
// constant: simpler than coupling two small, independent files over one
// three-line function.
function centsPrice(v) {
  return v == null ? null : Math.round(v * 100);
}

/**
 * The presentational guts shared by PredictionMarketDetailModal (modal
 * chrome, popup context) and PredictionMarketsApp's master-detail panel
 * (card chrome, always-mounted context) — the exact parallel of
 * AssetDetailPanel / AssetInfoModal on the equities side.
 */
export default function PredictionMarketDetailPanel({ market, onClose }) {
  const [period, setPeriod] = useState("perpWeek");
  const [points, setPoints] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartErr, setChartErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartErr(null);
    fetch(`${API_BASE}/api/predictions/${market.seriesTicker}/${market.marketTicker}/candles?range=${period}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        setPoints((d.points || []).map((p) => ({ ts: p.ts, v: centsPrice(p.price) })));
        setChartLoading(false);
      })
      .catch((e) => { if (!cancelled) { setChartErr(e.message); setChartLoading(false); } });
    return () => { cancelled = true; };
  }, [market.seriesTicker, market.marketTicker, period]);

  const yes = centsPrice(market.yesAsk ?? market.yesBid);
  const no = centsPrice(market.noAsk ?? market.noBid);

  const closeLabel = (() => {
    if (!market.closeTime) return null;
    const d = new Date(market.closeTime * 1000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  })();

  const statRows = [
    yes != null && ["Yes", `${yes}¢`],
    no != null && ["No", `${no}¢`],
    market.volume != null && ["Volume", `$${Math.round(market.volume).toLocaleString()}`],
    closeLabel && ["Closes", closeLabel],
  ].filter(Boolean);

  return (
    <>
      <div className="answer-header">
        <div>
          <p className="tiny label" style={{ margin: 0 }}>
            {market.category}{market.eventTitle && market.eventTitle !== market.title ? ` · ${market.eventTitle}` : ""}
          </p>
          <h3 className="card-title" style={{ margin: "2px 0 0" }}>{market.title}</h3>
        </div>
        {onClose && <button className="x" onClick={onClose}>×</button>}
      </div>

      <div className="chart-pnl" style={{ marginBottom: 14 }}>
        <span className="chart-pct-big gain">{yes != null ? `${yes}¢` : "—"}</span>
        <span className="tiny muted">Yes</span>
        <span className="chart-since">{no != null ? `${no}¢ No` : ""}</span>
      </div>

      <div className="chart-toprow" style={{ marginBottom: 6, justifyContent: "flex-end" }}>
        <div className="lvp-pnl-periods">
          {PERIODS.map((p) => (
            <button key={p.key} className={`lvp-pct-btn ${period === p.key ? "sel" : ""}`}
              onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {chartErr ? (
        <p className="tiny warn">{chartErr}</p>
      ) : (
        <TimeSeriesChart points={points} period={period} loading={chartLoading} mode="probability"
          emptyText="No trade history yet for this market." />
      )}

      {statRows.length > 0 && (
        <div className="asset-stats-grid">
          {statRows.map(([label, value]) => (
            <div key={label}>
              <span className="tiny muted">{label}</span>
              <p className="mono">{value}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
