import { useState, useEffect } from "react";
import { api, displayTicker, fmtBig } from "../lib/api.js";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

// Same Day/Week/Month/All periods (and Twelve Data range mapping) as
// components/MarketsExplorer.jsx's chart, so an asset opened from anywhere
// else in the app (Equities Markets, the dashboard's portfolio/positions
// rows) gets the exact same chart, not just a visually-similar one.
const PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];
const TD_RANGE = { perpDay: "1D", perpWeek: "1W", perpMonth: "1M", perpAllTime: "1Y" };

/**
 * The presentational guts shared by AssetInfoModal (modal chrome, popup
 * context) and EquitiesMarketsApp's master-detail panel (card chrome,
 * always-mounted context) — extracted so both stay in lockstep instead of
 * drifting as two copies of the same fetch/render logic.
 */
export default function AssetDetailPanel({ symbol, name, category, onClose }) {
  const [period, setPeriod] = useState("perpDay");
  const [info, setInfo] = useState(null);
  const [infoErr, setInfoErr] = useState(null);
  const [points, setPoints] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setInfoErr(null);
    api.marketInfo(symbol)
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch((e) => { if (!cancelled) setInfoErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    api.marketChart(symbol, TD_RANGE[period] || "1M")
      .then((d) => { if (!cancelled) { setPoints((d.points || []).map((p) => ({ ts: p.ts, v: p.price }))); setChartLoading(false); } })
      .catch(() => { if (!cancelled) { setPoints([]); setChartLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol, period]);

  const quote = info?.quote;
  const profile = info?.profile;
  const stats = info?.statistics?.statistics;
  const price = quote ? Number(quote.close) : null;
  const change = quote ? Number(quote.percent_change) : null;

  const statRows = [
    quote && ["Day range", `$${Number(quote.low).toFixed(2)} – $${Number(quote.high).toFixed(2)}`],
    quote?.fifty_two_week && ["52-week range", `$${Number(quote.fifty_two_week.low).toFixed(2)} – $${Number(quote.fifty_two_week.high).toFixed(2)}`],
    stats?.valuations_metrics?.market_capitalization && ["Market cap", fmtBig(stats.valuations_metrics.market_capitalization)],
    stats?.valuations_metrics?.trailing_pe && ["P/E ratio", stats.valuations_metrics.trailing_pe.toFixed(2)],
    profile?.sector && ["Sector", profile.sector],
    profile?.industry && ["Industry", profile.industry],
  ].filter(Boolean);

  return (
    <>
      <div className="answer-header">
        <div>
          <p className="tiny label" style={{ margin: 0 }}>{info?.ticker || displayTicker(symbol)}</p>
          <h3 className="card-title" style={{ margin: "2px 0 0" }}>{profile?.name || name}</h3>
        </div>
        {onClose && <button className="x" onClick={onClose}>×</button>}
      </div>

      {infoErr && <p className="tiny warn">{infoErr}</p>}

      {price != null && (
        <div className="chart-pnl" style={{ marginBottom: 14 }}>
          <span className="chart-pct-big">${price.toFixed(2)}</span>
          {change != null && (
            <span className={`chart-delta mono tiny ${change >= 0 ? "gain" : "loss"}`}>
              {change >= 0 ? "+" : ""}{change.toFixed(2)}%
            </span>
          )}
          <span className="tiny muted chart-since">{category}</span>
        </div>
      )}

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

      <TimeSeriesChart points={points} period={period} loading={chartLoading} mode="price"
        emptyText="No chart data available for this asset yet." />

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

      {profile?.description && (
        <p className="tiny muted asset-description">{profile.description}</p>
      )}
    </>
  );
}
