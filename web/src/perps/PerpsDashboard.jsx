import { useMemo, useRef, useState } from "react";
import { usePortfolioStats } from "./useHyperliquid.js";
import { PositionRow } from "./PerpsPanel.jsx";

// Hand-rolled SVG chart, matching the pattern already used in
// components/PerformanceChart.jsx and AssetInfoModal.jsx — no charting
// library in this app. Gradient/clip ids are namespaced ("perpsPnl...")
// since multiple such charts can be mounted on the page at once.
const W = 600, H = 280;
const PAD = { top: 10, right: 16, bottom: 28, left: 62 };

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

// Full precision for the tooltip readout — the axis can round to "nice"
// numbers, but the value someone is actively pointing at should never be.
function yLabelExact(v) {
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
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

// Period-aware axis label — "Day" wants a clock, "All" wants a date, and
// showing a bare weekday for a multi-month range (or a full date for a
// single day) is the kind of mismatch that makes a chart feel unfinished.
function xAxisLabel(ts, period) {
  const d = new Date(ts);
  if (period === "perpDay") return d.toLocaleTimeString(undefined, { hour: "numeric" });
  if (period === "perpWeek") return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Fuller version for the tooltip, where there's room to be unambiguous.
function tooltipTimeLabel(ts, period) {
  const d = new Date(ts);
  if (period === "perpDay") return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Classic Heckbert "nice numbers for graph labels" — picks a tick step
// from {1,2,5}×10^n so the axis lands on round values ($0.25, $0.50 — not
// $0.2368, $0.4735) regardless of what the raw data range happens to be.
function niceNumber(range, round) {
  if (range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / 10 ** exp;
  let nice;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function niceTicks(min, max, targetCount = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceNumber(niceNumber(max - min, false) / (targetCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v * 1e8) / 1e8);
  return { ticks, niceMin, niceMax };
}

// Splits the mapped [x,y] polyline into runs that share a sign, inserting
// an exact interpolated point at every zero-crossing — this is what lets
// the line/fill read as green-above/red-below-breakeven instead of one
// color for the whole chart picked off whatever the LAST point happens to
// be (the old behavior: a month spent mostly in profit that dipped
// negative on the final tick rendered entirely red, which misrepresents
// the period it's supposed to summarize).
function splitAtZero(mapped, values, zeroY) {
  const runs = [];
  let current = null;
  for (let i = 0; i < mapped.length; i++) {
    const sign = values[i] >= 0 ? 1 : -1;
    if (!current || current.sign !== sign) {
      if (current) {
        const [x0] = mapped[i - 1], [x1] = mapped[i];
        const t = values[i - 1] / (values[i - 1] - values[i]);
        const xi = x0 + (x1 - x0) * t;
        current.points.push([xi, zeroY]);
        current = { sign, points: [[xi, zeroY]] };
      } else {
        current = { sign, points: [] };
      }
      runs.push(current);
    }
    current.points.push(mapped[i]);
  }
  return runs;
}

function pathFor(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function areaFor(points, zeroY) {
  const line = pathFor(points);
  const [lastX] = points[points.length - 1];
  const [firstX] = points[0];
  return `${line} L${lastX.toFixed(1)},${zeroY.toFixed(1)} L${firstX.toFixed(1)},${zeroY.toFixed(1)} Z`;
}

// Converts a client (viewport) pointer position into the SVG's own
// user-space coordinates via the element's screen CTM — the textbook-
// correct way to do this regardless of how the SVG is actually scaled/
// letterboxed by preserveAspectRatio, unlike hand-computing a ratio off
// getBoundingClientRect (which quietly breaks the moment the container's
// aspect ratio doesn't exactly match the viewBox).
function clientToSvgPoint(svgEl, clientX, clientY) {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function svgToClientPoint(svgEl, x, y) {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = x; pt.y = y;
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

function PnlChart({ points, period, loading }) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // { idx, tipX, tipY, side }

  if (loading) {
    return <div className="lvp-pnl-skeleton" aria-hidden="true" />;
  }
  if (!points || points.length < 2) {
    return <p className="lvp-muted lvp-pnl-chart-empty">Not enough history yet — check back after your next trade.</p>;
  }

  // Always include 0 in range — PnL can be negative, and the zero line is
  // the meaningful reference point (unlike a pure equity chart where 0 is
  // never in range anyway).
  const vMin = Math.min(0, ...points.map((p) => p.v));
  const vMax = Math.max(0, ...points.map((p) => p.v));
  const vPad = (vMax - vMin) * 0.12 || 1;
  const { ticks: yTicks, niceMin, niceMax } = niceTicks(vMin - vPad, vMax + vPad, 5);
  const vLo = niceMin, vHi = niceMax;
  const tMin = points[0].ts, tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;
  const vRange = vHi - vLo || 1;

  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = (ts) => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = (v) => PAD.top + inner.h - ((v - vLo) / vRange) * inner.h;

  const last = points[points.length - 1].v;
  const isGain = last >= 0;

  const mapped = points.map((p) => [sx(p.ts), sy(p.v)]);
  const values = points.map((p) => p.v);
  const zeroY = sy(0);
  const runs = splitAtZero(mapped, values, zeroY);
  const [cx, cy] = mapped[mapped.length - 1];

  const high = Math.max(...points.map((p) => p.v));
  const low = Math.min(...points.map((p) => p.v));

  // 4-5 x-axis labels, evenly spaced by index (not by time) so they stay
  // readable even when points are unevenly sampled.
  const X_TICK_COUNT = 5;
  const xTickIdxs = Array.from({ length: X_TICK_COUNT }, (_, i) =>
    Math.round((i / (X_TICK_COUNT - 1)) * (points.length - 1)),
  ).filter((v, i, arr) => arr.indexOf(v) === i);

  const updateHover = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return;
    const p = clientToSvgPoint(svg, clientX, clientY);
    if (!p) return;
    const clampedX = Math.max(PAD.left, Math.min(W - PAD.right, p.x));
    // Nearest point by x — datasets here are small (well under a thousand
    // points even for "All"), so a linear scan is plenty fast and much
    // simpler than maintaining a sorted index for binary search.
    let idx = 0, best = Infinity;
    for (let i = 0; i < mapped.length; i++) {
      const d = Math.abs(mapped[i][0] - clampedX);
      if (d < best) { best = d; idx = i; }
    }
    const [px, py] = mapped[idx];
    const screen = svgToClientPoint(svg, px, py);
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (!screen || !wrapRect) return;
    const relX = screen.x - wrapRect.left;
    const relY = screen.y - wrapRect.top;
    // Flip the tooltip to the other side once the point is past the
    // midline, so it never runs off the edge of the card.
    const side = relX > wrapRect.width / 2 ? "left" : "right";
    setHover({ idx, tipX: relX, tipY: relY, side });
  };

  const clearHover = () => setHover(null);
  const hoverPoint = hover ? points[hover.idx] : null;

  return (
    <div
      ref={wrapRef}
      className="lvp-pnl-wrap"
      onPointerMove={(e) => updateHover(e.clientX, e.clientY)}
      onPointerDown={(e) => updateHover(e.clientX, e.clientY)}
      onPointerLeave={clearHover}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const cur = hover?.idx ?? mapped.length - 1;
        const next = Math.max(0, Math.min(mapped.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
        const [px, py] = mapped[next];
        const svg = svgRef.current;
        const screen = svg && svgToClientPoint(svg, px, py);
        const wrapRect = wrapRef.current?.getBoundingClientRect();
        if (!screen || !wrapRect) return;
        const relX = screen.x - wrapRect.left;
        setHover({ idx: next, tipX: relX, tipY: screen.y - wrapRect.top, side: relX > wrapRect.width / 2 ? "left" : "right" });
      }}
      tabIndex={0}
      role="img"
      aria-label={`Unrealized P&L over the selected period, currently ${yLabelExact(last)}, ranging from ${yLabelExact(low)} to ${yLabelExact(high)}. Use arrow keys to inspect individual points.`}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="lvp-pnl-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="perpsPnlGainGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gain)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="perpsPnlLossGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--loss)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.02" />
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

        <g clipPath="url(#perpsPnlClip)">
          {runs.map((run, i) => (
            <path key={`area-${i}`} d={areaFor(run.points, zeroY)}
              fill={`url(#${run.sign > 0 ? "perpsPnlGainGrad" : "perpsPnlLossGrad"})`} />
          ))}
          {runs.map((run, i) => (
            <path key={`line-${i}`} d={pathFor(run.points)} fill="none"
              stroke={run.sign > 0 ? "var(--gain)" : "var(--loss)"}
              strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </g>

        {/* Live end-of-line marker — a soft pulsing halo behind a solid
            dot signals "this is the current value," same language as a
            live ticker. Respects prefers-reduced-motion via the CSS rule. */}
        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="9" fill={isGain ? "var(--gain)" : "var(--loss)"}
          opacity="0.18" className="lvp-pnl-live-pulse" />
        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="4.5" fill={isGain ? "var(--gain)" : "var(--loss)"}
          stroke="var(--card)" strokeWidth="2" />

        {xTickIdxs.map((idx) => (
          <text key={idx} x={mapped[idx][0]} y={H - 8} textAnchor="middle"
            fontSize="10" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {xAxisLabel(points[idx].ts, period)}
          </text>
        ))}
        {yTicks.map((v, i) => (
          <text key={i} x={PAD.left - 10} y={sy(v) + 3} textAnchor="end"
            fontSize="11" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {yLabel(v)}
          </text>
        ))}

        {/* Crosshair + snapped point, only while actively hovering/focused. */}
        {hover && (
          <g pointerEvents="none">
            <line x1={mapped[hover.idx][0]} y1={PAD.top} x2={mapped[hover.idx][0]} y2={PAD.top + inner.h}
              stroke="var(--moss)" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
            <circle cx={mapped[hover.idx][0]} cy={mapped[hover.idx][1]} r="5"
              fill={values[hover.idx] >= 0 ? "var(--gain)" : "var(--loss)"} stroke="var(--card)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hoverPoint && (
        <div className={`lvp-pnl-tooltip ${hover.side}`} style={{ left: hover.tipX, top: hover.tipY }}>
          <span className={`mono lvp-pnl-tooltip-value ${hoverPoint.v >= 0 ? "gain" : "loss"}`}>
            {yLabelExact(hoverPoint.v)}
          </span>
          <span className="tiny muted">{tooltipTimeLabel(hoverPoint.ts, period)}</span>
        </div>
      )}

      <div className="lvp-pnl-hilo">
        <span className="lvp-muted">High <strong className="mono">{yLabel(high)}</strong></span>
        <span className="lvp-muted">Low <strong className="mono">{yLabel(low)}</strong></span>
      </div>
    </div>
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
  // pnlHistory starts as {} before the first poll resolves — distinct from
  // "polled fine, this period genuinely has under 2 points," which the
  // chart itself already messages differently (its own empty-state copy).
  const historyLoading = Object.keys(pnlHistory).length === 0;
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
        <PnlChart key={period} points={points} period={period} loading={historyLoading} />
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
