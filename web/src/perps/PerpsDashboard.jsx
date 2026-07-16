import { useMemo, useState } from "react";
import { usePortfolioStats } from "./useHyperliquid.js";
import { PositionRow } from "./PerpsPanel.jsx";

// Hand-rolled SVG chart, matching the pattern already used in
// components/PerformanceChart.jsx and AssetInfoModal.jsx — no charting
// library in this app. Gradient/clip ids are namespaced ("perpsPnl...")
// since multiple such charts can be mounted on the page at once.
const W = 600, H = 280;
const PAD = { top: 10, right: 16, bottom: 16, left: 62 };

const PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

function yLabel(v) {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 10) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function PnlChart({ points }) {
  if (!points || points.length < 2) {
    return <p className="lvp-muted lvp-pnl-chart-empty">Not enough history yet — check back after your next trade.</p>;
  }

  // Always include 0 in range — PnL can be negative, and the zero line is
  // the meaningful reference point (unlike a pure equity chart where 0 is
  // never in range anyway).
  const vMin = Math.min(0, ...points.map((p) => p.v));
  const vMax = Math.max(0, ...points.map((p) => p.v));
  const vPad = (vMax - vMin) * 0.12 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;
  const tMin = points[0].ts, tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;
  const vRange = vHi - vLo;

  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = (ts) => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = (v) => PAD.top + inner.h - ((v - vLo) / vRange) * inner.h;

  const last = points[points.length - 1].v;
  const isGain = last >= 0;
  const color = isGain ? "var(--gain)" : "var(--loss)";
  const gradId = isGain ? "perpsPnlGainGrad" : "perpsPnlLossGrad";

  const mapped = points.map((p) => [sx(p.ts), sy(p.v)]);
  const linePath = mapped.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const bottom = (PAD.top + inner.h + 1).toFixed(1);
  const areaPath = `${linePath} L${mapped[mapped.length - 1][0].toFixed(1)},${bottom} L${mapped[0][0].toFixed(1)},${bottom} Z`;
  const zeroY = sy(0);
  const [cx, cy] = mapped[mapped.length - 1];

  const TICK_COUNT = 5;
  const yTicks = Array.from({ length: TICK_COUNT }, (_, i) => vLo + (vRange * i) / (TICK_COUNT - 1));

  const high = Math.max(...points.map((p) => p.v));
  const low = Math.min(...points.map((p) => p.v));

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="lvp-pnl-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="perpsPnlGainGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gain)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="perpsPnlLossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--loss)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.01" />
          </linearGradient>
          <clipPath id="perpsPnlClip">
            <rect x={PAD.left} y={PAD.top - 4} width={inner.w + 1} height={inner.h + 5} />
          </clipPath>
        </defs>

        {yTicks.map((v, i) => (
          <line key={i} x1={PAD.left} y1={sy(v).toFixed(1)} x2={W - PAD.right} y2={sy(v).toFixed(1)}
            stroke="var(--line)" strokeWidth="1" opacity="0.6" />
        ))}
        <line x1={PAD.left} y1={zeroY.toFixed(1)} x2={W - PAD.right} y2={zeroY.toFixed(1)}
          stroke="var(--moss)" strokeWidth="1" strokeDasharray="3 3" />

        <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#perpsPnlClip)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" clipPath="url(#perpsPnlClip)" />
        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="4.5" fill={color} stroke="var(--card)" strokeWidth="2" />

        {yTicks.map((v, i) => (
          <text key={i} x={PAD.left - 10} y={sy(v) + 3} textAnchor="end"
            fontSize="11" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {yLabel(v)}
          </text>
        ))}
      </svg>
      <div className="lvp-pnl-hilo">
        <span className="lvp-muted">High <strong className="mono">{yLabel(high)}</strong></span>
        <span className="lvp-muted">Low <strong className="mono">{yLabel(low)}</strong></span>
      </div>
    </>
  );
}

export default function PerpsDashboard({ hl, cfg, user, tradingWallet, positions }) {
  const [period, setPeriod] = useState("perpDay");
  const [view, setView] = useState("positions"); // "positions" | "history"
  const [search, setSearch] = useState("");
  const { pnlHistory, fills, volume, stats } = usePortfolioStats(hl, user);

  const unrealizedPnl = useMemo(
    () => (positions || []).reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0),
    [positions],
  );
  const isGain = unrealizedPnl >= 0;
  const points = (pnlHistory[period] || []).map(([ts, v]) => ({ ts, v: Number(v) }));

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

  return (
    <div className="lvp-dashboard">
      <div className="lvp-card lvp-pnl-card-full">
        <div className="lvp-pnl-header-row">
          <div>
            <p className="lvp-muted" style={{ marginBottom: 2 }}>Unrealized P&L</p>
            <p className={`lvp-pnl-focal ${isGain ? "gain" : "loss"}`}>
              {isGain ? "+" : "−"}${Math.abs(unrealizedPnl).toFixed(2)}
            </p>
          </div>
          <div className="lvp-pnl-periods">
            {PERIODS.map((p) => (
              <button key={p.key} className={`lvp-pct-btn ${period === p.key ? "sel" : ""}`} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <PnlChart points={points} />
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
