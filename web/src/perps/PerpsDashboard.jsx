import { useMemo, useState } from "react";
import { usePortfolioStats, useAssetCandles } from "./useHyperliquid.js";
import { PositionRow } from "./PerpsPanel.jsx";
import TimeSeriesChart, { priceLabel } from "../components/TimeSeriesChart.jsx";

const PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PERIOD_LOOKBACK_MS = {
  perpDay: 24 * 60 * 60 * 1000,
  perpWeek: 7 * 24 * 60 * 60 * 1000,
  perpMonth: 30 * 24 * 60 * 60 * 1000,
  perpAllTime: Infinity,
};

export default function PerpsDashboard({ hl, cfg, user, tradingWallet, positions, asset }) {
  const [period, setPeriod] = useState("perpDay");
  const [metric, setMetric] = useState("unrealized"); // "unrealized" | "realized" | "asset"
  const [view, setView] = useState("positions"); // "positions" | "history"
  const [search, setSearch] = useState("");
  const { pnlHistory, fills, volume, stats } = usePortfolioStats(hl, user);
  const { points: candlePoints, loading: candlesLoading } = useAssetCandles(hl, asset?.name, period);

  const unrealizedPnl = useMemo(
    () => (positions || []).reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0),
    [positions],
  );
  // pnlHistory starts as {} before the first poll resolves — distinct from
  // "polled fine, this period genuinely has under 2 points," which the
  // chart itself already messages differently (its own empty-state copy).
  const historyLoading = Object.keys(pnlHistory).length === 0;
  const unrealizedPoints = (pnlHistory[period] || []).map(([ts, v]) => ({ ts, v: Number(v) }));

  // Realized P&L has no ready-made per-period series from Hyperliquid the
  // way unrealized does — built here instead from the same fills already
  // being fetched for the trade-history tab below, scoped to the selected
  // period and cumulatively summed so it resets to 0 at the start of the
  // window, same convention as the unrealized chart's own period scoping.
  const realizedPoints = useMemo(() => {
    const lookback = PERIOD_LOOKBACK_MS[period] ?? Infinity;
    const cutoff = Number.isFinite(lookback) ? Date.now() - lookback : -Infinity;
    const scoped = fills
      .filter((f) => f.time >= cutoff && f.closedPnl !== 0)
      .sort((a, b) => a.time - b.time);
    let running = 0;
    return scoped.map((f) => { running += f.closedPnl; return { ts: f.time, v: running }; });
  }, [fills, period]);
  const realizedTotal = realizedPoints.length ? realizedPoints[realizedPoints.length - 1].v : 0;

  const assetPoints = candlePoints.map((p) => ({ ts: p.ts, v: p.price }));
  const assetLast = assetPoints.length ? assetPoints[assetPoints.length - 1].v : null;
  const assetFirst = assetPoints.length ? assetPoints[0].v : null;
  const assetPctChange = assetFirst ? ((assetLast - assetFirst) / assetFirst) * 100 : null;

  const isRealizedGain = stats.realizedPnl >= 0;
  const statTiles = [
    { label: "Total Volume", value: `$${volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
    { label: "Total Trades", value: stats.totalTrades.toLocaleString() },
    {
      label: "Realized P&L",
      value: `${isRealizedGain ? "+" : "−"}$${Math.abs(stats.realizedPnl).toFixed(2)}`,
      className: isRealizedGain ? "gain" : "loss",
    },
    { label: "Win Rate", value: stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—" },
    { label: "Open Positions", value: (positions || []).length },
  ];

  const q = search.trim().toLowerCase();
  const filteredFills = useMemo(() => {
    if (!q) return fills;
    return fills.filter((f) => f.coin.toLowerCase().includes(q) || f.dir.toLowerCase().includes(q));
  }, [fills, q]);
  const HISTORY_LIMIT = 100;
  const shownFills = filteredFills.slice(0, HISTORY_LIMIT);

  const METRICS = [
    { key: "unrealized", label: "Unrealized" },
    { key: "realized", label: "Realized" },
    { key: "asset", label: asset?.displayName || "Asset", disabled: !asset },
  ];

  return (
    <div className="lvp-dashboard">
      <div className="lvp-card lvp-pnl-card-full">
        <div className="lvp-pnl-header-row">
          {metric === "asset" ? (
            <div>
              <p className="lvp-muted" style={{ marginBottom: 2 }}>
                {asset ? `${asset.displayName} Price` : "Select an asset"}
              </p>
              {assetLast != null ? (
                <p className="lvp-pnl-focal">
                  {priceLabel(assetLast)}
                  {assetPctChange != null && (
                    <span className={`lvp-pnl-focal-chip mono ${assetPctChange >= 0 ? "gain" : "loss"}`}>
                      {assetPctChange >= 0 ? "+" : ""}{assetPctChange.toFixed(2)}%
                    </span>
                  )}
                </p>
              ) : (
                <p className="lvp-pnl-focal lvp-muted" style={{ fontSize: 28 }}>—</p>
              )}
            </div>
          ) : (
            <div>
              <p className="lvp-muted" style={{ marginBottom: 2 }}>
                {metric === "unrealized" ? "Unrealized P&L" : "Realized P&L"}
              </p>
              {(() => {
                const v = metric === "unrealized" ? unrealizedPnl : realizedTotal;
                const g = v >= 0;
                return (
                  <p className={`lvp-pnl-focal ${g ? "gain" : "loss"}`}>
                    {g ? "+" : "−"}${Math.abs(v).toFixed(2)}
                  </p>
                );
              })()}
            </div>
          )}
          <div className="lvp-pnl-periods">
            {PERIODS.map((p) => (
              <button key={p.key} className={`lvp-pct-btn ${period === p.key ? "sel" : ""}`} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lvp-metric-tabs">
          {METRICS.map((m) => (
            <button key={m.key} className={`lvp-metric-tab ${metric === m.key ? "sel" : ""}`}
              disabled={m.disabled} onClick={() => setMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        {metric === "unrealized" && (
          <TimeSeriesChart key={`u-${period}`} points={unrealizedPoints} period={period} loading={historyLoading} mode="pnl"
            emptyText="Not enough history yet — check back after your next trade." />
        )}
        {metric === "realized" && (
          <TimeSeriesChart key={`r-${period}`} points={realizedPoints} period={period} loading={historyLoading} mode="pnl"
            emptyText="No closed trades in this period yet." />
        )}
        {metric === "asset" && (
          <TimeSeriesChart key={`a-${period}-${asset?.name}`} points={assetPoints} period={period} loading={candlesLoading} mode="price"
            emptyText={asset ? "No price history available for this asset." : "Select an asset from the Trade tab to see its chart."} />
        )}
      </div>

      <div className="lvp-stats-row">
        {statTiles.map((s) => (
          <div key={s.label} className="lvp-card lvp-stat-box">
            <span className="tiny muted">{s.label}</span>
            <p className={`mono lvp-stat-value ${s.className || ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="lvp-card lvp-posthist-card">
        <div className="lvp-pnl-header-row">
          <h3 style={{ margin: 0 }}>{view === "positions" ? "Open Positions" : "Trade History"}</h3>
          <div className="lvp-view-toggle">
            <button className={`lvp-pct-btn ${view === "positions" ? "sel" : ""}`} onClick={() => setView("positions")}>Positions</button>
            <button className={`lvp-pct-btn ${view === "history" ? "sel" : ""}`} onClick={() => setView("history")}>History</button>
          </div>
        </div>

        {view === "positions" && (
          <div style={{ marginTop: 14 }}>
            {(positions || []).length === 0 && <p className="lvp-muted">No open positions.</p>}
            {(positions || []).map((p) => (
              <PositionRow key={p.coin} p={p} hl={hl} cfg={cfg} user={user} tradingWallet={tradingWallet} onClosed={() => {}} />
            ))}
          </div>
        )}

        {view === "history" && (
          <div style={{ marginTop: 14 }}>
            <input
              className="perps-asset-search"
              placeholder="Search by asset or side…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {shownFills.length === 0 && <p className="lvp-muted" style={{ marginTop: 8 }}>No trades found.</p>}
            {shownFills.map((f, i) => (
              <div key={i} className="lvp-fill-row">
                <div className="lvp-row">
                  <span>
                    <strong>{f.coin}</strong>{" "}
                    <span className={`trade-chip ${f.isBuy ? "buy" : "sell"} lvp-fill-chip`}>{f.dir}</span>
                  </span>
                  {f.closedPnl !== 0 && (
                    <span className={f.closedPnl >= 0 ? "lvp-pnl-up" : "lvp-pnl-down"}>
                      {f.closedPnl >= 0 ? "+" : ""}{f.closedPnl.toFixed(2)} Cash
                    </span>
                  )}
                </div>
                <p className="lvp-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                  {f.size} @ ${f.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} · {timeAgo(f.time)}
                </p>
              </div>
            ))}
            {filteredFills.length > HISTORY_LIMIT && (
              <p className="lvp-fine" style={{ marginTop: 10 }}>
                Showing most recent {HISTORY_LIMIT} of {filteredFills.length} matching trades.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
