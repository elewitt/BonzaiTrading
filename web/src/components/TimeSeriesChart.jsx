import { useRef, useState } from "react";

// Hand-rolled SVG chart — no charting library in this app (see also
// components/AssetInfoModal.jsx's own smaller variant, which predates this
// one). Shared across the perps dashboard, the brokerage "Portfolio Stats"
// panel, and the Markets explorer, so it needed to be pulled out of
// perps/PerpsDashboard.jsx (where it originated) rather than copy-pasted a
// third time. Gradient/clip ids are namespaced ("tsChart...") since more
// than one instance can be mounted on the page at once.
const W = 600, H = 280;
const PAD = { top: 10, right: 16, bottom: 28, left: 62 };

// P&L is a signed delta from a meaningful zero (breakeven) — always show
// the sign, round to whole $ once the number gets big enough that cents
// stop being the interesting digit.
export function deltaLabel(v) {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 10) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}
export function deltaLabelExact(v) {
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

// Price/value is just a number, never a signed delta — and needs more
// precision at the low end (a sub-$1 token) than a $60k+ BTC print does.
export function priceLabel(v) {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

// A prediction-market YES price IS a probability (0-100¢) — same shape as
// priceLabel's non-negative, no-forced-zero handling, but cents rather than
// dollars, and matches the "92¢" convention PredictionMarketsApp.jsx's own
// MarketRow already uses for the same numbers.
export function probabilityLabel(v) {
  return `${Math.round(v)}¢`;
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
// a PnL line/fill read as green-above/red-below-breakeven instead of one
// color for the whole chart picked off whatever the LAST point happens to
// be. Only meaningful when zero is an actual reference point (PnL mode) —
// a price series has no "sign" to split on, so it stays a single run.
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

// Some feeds behind this chart (the dashboard's local portfolio-value log
// in particular) snapshot on every value change, not on a fixed interval —
// over a long "All time" window that's routinely 500-2000+ points, many of
// them mere seconds apart. Rendered as straight connected segments, that
// density reads as a jagged, chaotic sawtooth rather than a legible trend,
// even though each individual point is real. Bucketing down to a bounded
// number of points for the LINE (not the high/low stats, which still read
// off the true full-resolution data) is the standard fix real charting
// tools use for the same "way more raw samples than pixels" situation —
// picking the last value in each time bucket (like a per-bucket "close")
// rather than averaging, so the line still only ever shows real recorded
// values, never an invented blend between them.
const MAX_RENDER_POINTS = 150;
function downsample(points, target) {
  if (points.length <= target) return points;
  const bucketSize = points.length / target;
  const out = [];
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    out.push(points[Math.min(end, points.length) - 1]);
  }
  out[0] = points[0]; // always start on the true earliest point…
  out[out.length - 1] = points[points.length - 1]; // …and end on the true latest one
  return out;
}

// Quadratic-through-midpoints smoothing — the standard, low-risk way to
// round off a polyline's sharp corners: each interior point becomes a
// curve CONTROL point (not necessarily touched exactly), with the curve
// running between the midpoints of its neighboring segments. Always starts
// and ends exactly on the real first/last point. Deliberately not a full
// spline through every point — a curve that's bounded to the local
// neighborhood of 3 points at a time can't overshoot past what the data
// actually did the way a naive Catmull-Rom fit can, which matters for a
// financial chart (the hover/tooltip still snaps to and reads out the
// exact real value at each point regardless of how the curve looks).
function pathFor(points) {
  if (points.length < 3) {
    return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  }
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const mx = (cx + nx) / 2, my = (cy + ny) / 2;
    d += ` Q${cx.toFixed(1)},${cy.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const [lx, ly] = points[points.length - 1];
  d += ` L${lx.toFixed(1)},${ly.toFixed(1)}`;
  return d;
}

function areaFor(points, baseY) {
  const line = pathFor(points);
  const [lastX] = points[points.length - 1];
  const [firstX] = points[0];
  return `${line} L${lastX.toFixed(1)},${baseY.toFixed(1)} L${firstX.toFixed(1)},${baseY.toFixed(1)} Z`;
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

/**
 * One shared chart for two genuinely different jobs:
 *   - mode="pnl" (Unrealized / Realized P&L): a signed delta from a
 *     meaningful zero — forces zero into the y-range, draws a dashed
 *     breakeven line, and splits the line/fill color at every zero
 *     crossing so a mostly-green period that dipped red at the very end
 *     doesn't render as if the whole thing were a loss.
 *   - mode="price" (asset price, portfolio value): a plain value with no
 *     meaningful zero — no forced zero, no breakeven line, one color for
 *     the whole line based on whether it's up or down over the shown
 *     window, fill anchored to the chart floor instead of zero.
 *   - mode="probability" (prediction-market YES price): same geometry as
 *     "price" (no forced zero, no breakeven line) but bounded at the OTHER
 *     end too — a market can't trade above 100¢, so the axis ceiling
 *     clamps at 100 the same way price's floor clamps at 0 — plus cents
 *     labels instead of dollars.
 * Everything else (nice-number ticks, the crosshair/tooltip hover layer,
 * x-axis time labels, the live-value pulse, loading/empty states) is
 * identical between all three.
 */
export default function TimeSeriesChart({ points, period, loading, mode = "pnl", emptyText }) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // { idx, tipX, tipY, side }
  const isPnl = mode === "pnl";
  const isProbability = mode === "probability";
  const label = isPnl ? deltaLabel : isProbability ? probabilityLabel : priceLabel;
  const labelExact = isPnl ? deltaLabelExact : isProbability ? probabilityLabel : priceLabel;

  if (loading) {
    return <div className="ts-chart-skeleton" aria-hidden="true" />;
  }
  if (!points || points.length < 2) {
    return <p className="lvp-muted ts-chart-empty">{emptyText || "Not enough history yet."}</p>;
  }

  // The LINE renders from a bounded, downsampled set (see downsample()
  // above) — the range/stats below still read off the full-resolution
  // `points`, so "High"/"Low" and the axis stay accurate even when the
  // rendered line itself is bucketed down for legibility.
  const renderPoints = downsample(points, MAX_RENDER_POINTS);

  // PnL always includes 0 (the meaningful breakeven reference); price
  // never forces it in — a sub-cent-precision chart of a token that never
  // goes near $0 shouldn't get padded down to a huge, mostly-empty range.
  const vMin = isPnl ? Math.min(0, ...points.map((p) => p.v)) : Math.min(...points.map((p) => p.v));
  const vMax = isPnl ? Math.max(0, ...points.map((p) => p.v)) : Math.max(...points.map((p) => p.v));
  const vPad = (vMax - vMin) * 0.12 || Math.max(Math.abs(vMax), 1) * 0.05;
  // A price/value axis should never dip below $0 — a portfolio or asset
  // can't be worth a negative amount, so unlike PnL (where a negative
  // floor is the whole point) the padded-down floor gets clamped at zero
  // instead of occasionally landing on an ugly, meaningless "-$5" tick.
  const axisFloor = isPnl ? vMin - vPad : Math.max(0, vMin - vPad);
  // Probability has a ceiling too — a market can't trade above 100¢, so a
  // near-certain market (98¢) shouldn't pad its axis past 100 the same way
  // the floor above won't pad price below 0.
  const axisCeil = isProbability ? Math.min(100, vMax + vPad) : vMax + vPad;
  const { ticks: yTicks, niceMin, niceMax } = niceTicks(axisFloor, axisCeil, 5);
  const vLo = niceMin, vHi = niceMax;
  const tMin = points[0].ts, tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;
  const vRange = vHi - vLo || 1;

  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = (ts) => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = (v) => PAD.top + inner.h - ((v - vLo) / vRange) * inner.h;

  const first = points[0].v;
  const last = points[points.length - 1].v;
  const isGain = isPnl ? last >= 0 : last >= first;

  const mapped = renderPoints.map((p) => [sx(p.ts), sy(p.v)]);
  const values = renderPoints.map((p) => p.v);
  const zeroY = sy(0);
  const baseY = isPnl ? zeroY : PAD.top + inner.h; // price fill anchors to the chart floor, not a meaningless "zero"
  const runs = isPnl ? splitAtZero(mapped, values, zeroY) : [{ sign: isGain ? 1 : -1, points: mapped }];
  const [cx, cy] = mapped[mapped.length - 1];

  const high = Math.max(...points.map((p) => p.v));
  const low = Math.min(...points.map((p) => p.v));

  // 4-5 x-axis labels, evenly spaced by TIME. Real feeds are frequently
  // unevenly sampled (e.g. a "Day" range whose points thin out overnight
  // and bunch up during market hours) — spacing by index instead of time
  // put almost every label in the dense stretch and left long empty gaps
  // unlabeled, which read as broken rather than just imprecise.
  //
  // Snapping each target time to the nearest real point isn't enough on
  // its own, though: when a stretch of the series is extremely sparse
  // (the same overnight-gap shape above), two adjacent target times can
  // snap to two DIFFERENT points that are still only minutes apart —
  // different indices, so the by-index dedupe below doesn't catch it, but
  // close enough in x/time that their labels render on top of each other
  // (e.g. two "11 AM"s). The second filter drops any tick that lands too
  // close to the one already kept, by actual rendered x-position.
  const MIN_TICK_GAP = 56; // viewBox units — enough for a "12 PM"-width label plus breathing room
  const X_TICK_COUNT = 5;
  const xTickIdxs = Array.from({ length: X_TICK_COUNT }, (_, i) => {
    const targetT = tMin + (i / (X_TICK_COUNT - 1)) * tRange;
    let best = 0, bestDiff = Infinity;
    for (let j = 0; j < renderPoints.length; j++) {
      const diff = Math.abs(renderPoints[j].ts - targetT);
      if (diff < bestDiff) { bestDiff = diff; best = j; }
    }
    return best;
  }).filter((v, i, arr) => arr.indexOf(v) === i)
    .reduce((kept, idx) => {
      const x = sx(renderPoints[idx].ts);
      const lastX = kept.length ? sx(renderPoints[kept[kept.length - 1]].ts) : -Infinity;
      if (x - lastX >= MIN_TICK_GAP) kept.push(idx);
      return kept;
    }, []);

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
  const hoverPoint = hover ? renderPoints[hover.idx] : null;
  const colorFor = (v) => (isPnl ? (v >= 0 ? "var(--gain)" : "var(--loss)") : (isGain ? "var(--gain)" : "var(--loss)"));

  // Axis ticks only need as much precision as the step between them
  // actually carries — "$105.00 / $106.00 / $107.00" repeats a ".00" that
  // says nothing, since niceTicks already only ever lands on round values.
  // The header/tooltip (priceLabel/deltaLabel) keep their own full
  // precision; this only trims the small print running down the y-axis.
  const tickStep = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const yTickLabel = (v) => {
    if (isPnl || isProbability) return label(v);
    if (Math.abs(v) >= 1000) return `$${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: tickStep >= 1000 ? 0 : 1 })}k`;
    if (tickStep >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(tickStep >= 0.1 ? 2 : 4)}`;
  };

  return (
    <div
      ref={wrapRef}
      className="ts-chart-wrap"
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
      aria-label={`${isPnl ? "P&L" : isProbability ? "Probability" : "Price"} over the selected period, currently ${labelExact(last)}, ranging from ${labelExact(low)} to ${labelExact(high)}. Use arrow keys to inspect individual points.`}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="ts-chart-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="tsChartGainGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gain)" stopOpacity="0.13" />
            <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="tsChartLossGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--loss)" stopOpacity="0.11" />
            <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.01" />
          </linearGradient>
          <clipPath id="tsChartClip">
            <rect x={PAD.left} y={PAD.top - 4} width={inner.w + 1} height={inner.h + 5} />
          </clipPath>
        </defs>

        {yTicks.map((v, i) => (
          <line key={i} x1={PAD.left} y1={sy(v).toFixed(1)} x2={W - PAD.right} y2={sy(v).toFixed(1)}
            stroke="var(--line)" strokeWidth="1" opacity="0.45" />
        ))}
        {isPnl && (
          <line x1={PAD.left} y1={zeroY.toFixed(1)} x2={W - PAD.right} y2={zeroY.toFixed(1)}
            stroke="var(--moss)" strokeWidth="1" strokeDasharray="3 3" />
        )}

        <g clipPath="url(#tsChartClip)">
          {runs.map((run, i) => (
            <path key={`area-${i}`} d={areaFor(run.points, baseY)}
              fill={`url(#${run.sign > 0 ? "tsChartGainGrad" : "tsChartLossGrad"})`} />
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
          opacity="0.18" className="ts-chart-live-pulse" />
        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="4.5" fill={isGain ? "var(--gain)" : "var(--loss)"}
          stroke="var(--card)" strokeWidth="2" />

        {xTickIdxs.map((idx) => (
          <text key={idx} x={mapped[idx][0]} y={H - 8} textAnchor="middle"
            fontSize="10" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {xAxisLabel(renderPoints[idx].ts, period)}
          </text>
        ))}
        {yTicks.map((v, i) => (
          <text key={i} x={PAD.left - 10} y={sy(v) + 3} textAnchor="end"
            fontSize="11" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {yTickLabel(v)}
          </text>
        ))}

        {/* Crosshair + snapped point, only while actively hovering/focused. */}
        {hover && (
          <g pointerEvents="none">
            <line x1={mapped[hover.idx][0]} y1={PAD.top} x2={mapped[hover.idx][0]} y2={PAD.top + inner.h}
              stroke="var(--moss)" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
            <circle cx={mapped[hover.idx][0]} cy={mapped[hover.idx][1]} r="5"
              fill={colorFor(values[hover.idx])} stroke="var(--card)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hoverPoint && (
        <div className={`ts-chart-tooltip ${hover.side}`} style={{ left: hover.tipX, top: hover.tipY }}>
          <span className={`mono ts-chart-tooltip-value ${isPnl ? (hoverPoint.v >= 0 ? "gain" : "loss") : (isGain ? "gain" : "loss")}`}>
            {labelExact(hoverPoint.v)}
          </span>
          <span className="tiny muted">{tooltipTimeLabel(hoverPoint.ts, period)}</span>
        </div>
      )}

      <div className="ts-chart-hilo">
        <span className="lvp-muted">High <strong className="mono">{label(high)}</strong></span>
        <span className="lvp-muted">Low <strong className="mono">{label(low)}</strong></span>
      </div>
    </div>
  );
}
