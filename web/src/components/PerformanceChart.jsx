import { useState, useMemo } from "react";
import { usd } from "../lib/api.js";

const W = 560, H = 188;
const PAD = { top: 14, right: 14, bottom: 34, left: 58 };

const PERIODS = ["1D", "7D", "30D", "All"];
const PERIOD_MS = { "1D": 86400000, "7D": 7 * 86400000, "30D": 30 * 86400000, All: Infinity };

function xLabel(ts, period) {
  const d = new Date(ts);
  if (period === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (period === "7D") return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function yLabel(v) {
  if (v >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 1000)  return `$${(v / 1000).toFixed(2)}k`;
  return `$${v.toFixed(0)}`;
}

export default function PerformanceChart({ history }) {
  const [period, setPeriod] = useState("All");

  const pts = useMemo(() => {
    if (!history?.length) return [];
    const sorted = [...history].sort((a, b) => a.ts - b.ts);
    const cutoff = period === "All" ? 0 : Date.now() - PERIOD_MS[period];
    const inRange = sorted.filter(p => p.ts >= cutoff);
    return inRange.length >= 2 ? inRange : sorted;
  }, [history, period]);

  if (pts.length < 2) {
    return (
      <div className="chart-empty">
        <svg viewBox="0 0 560 120" className="perf-svg chart-placeholder">
          <line x1="58" y1="14" x2="58" y2="86" stroke="var(--line)" strokeWidth="1" />
          <line x1="58" y1="86" x2="546" y2="86" stroke="var(--line)" strokeWidth="1" />
          {[0.2, 0.5, 0.8].map((f, i) => (
            <line key={i} x1="58" y1={14 + f * 72} x2="546" y2={14 + f * 72}
              stroke="var(--line)" strokeWidth="1" strokeDasharray="4 4" />
          ))}
          <text x="302" y="56" textAnchor="middle" fontSize="12"
            fontFamily="Instrument Sans,sans-serif" fill="var(--moss)">
            History builds up over time — check back soon
          </text>
        </svg>
      </div>
    );
  }

  const first = pts[0].v;
  const last = pts[pts.length - 1].v;
  const isGain = last >= first;
  const pct = first > 0 ? (last - first) / first * 100 : 0;
  const delta = last - first;
  const color = isGain ? "var(--gain)" : "var(--loss)";
  const gradId = isGain ? "areaGainGrad" : "areaLossGrad";

  const vMin = Math.min(...pts.map(p => p.v));
  const vMax = Math.max(...pts.map(p => p.v));
  const vPad = (vMax - vMin) * 0.08 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;
  const tMin = pts[0].ts, tMax = pts[pts.length - 1].ts;
  const tRange = tMax - tMin || 1;
  const vRange = vHi - vLo;

  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = ts => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = v  => PAD.top  + inner.h - ((v - vLo) / vRange) * inner.h;

  const mapped = pts.map(p => [sx(p.ts), sy(p.v)]);
  const linePath = mapped.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const bottom = (PAD.top + inner.h + 1).toFixed(1);
  const areaPath = `${linePath} L${mapped[mapped.length - 1][0].toFixed(1)},${bottom} L${mapped[0][0].toFixed(1)},${bottom} Z`;

  const yTicks = [0, 0.33, 0.67, 1].map(f => vLo + f * vRange);
  const xTicks = (() => {
    const n = Math.min(5, pts.length);
    return n < 2 ? [] : Array.from({ length: n }, (_, i) => ({
      ts: tMin + (i / (n - 1)) * tRange,
      x: PAD.left + (i / (n - 1)) * inner.w,
    }));
  })();

  const [cx, cy] = mapped[mapped.length - 1];

  return (
    <div className="chart-wrap">
      <div className="chart-toprow">
        <div className="chart-pnl">
          <span className={`chart-pct-big ${isGain ? "gain" : "loss"}`}>
            {isGain ? "+" : ""}{pct.toFixed(2)}%
          </span>
          <span className={`chart-delta mono tiny ${isGain ? "gain" : "loss"}`}>
            {isGain ? "+" : "−"}${usd(Math.abs(delta))}
          </span>
          <span className="tiny muted chart-since">since inception</span>
        </div>
        <div className="period-pills">
          {PERIODS.map(p => (
            <button key={p}
              className={`period-pill ${period === p ? "active" : ""}`}
              onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="areaGainGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--gain)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="areaLossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--loss)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.01" />
          </linearGradient>
          <clipPath id="perfClip">
            <rect x={PAD.left} y={PAD.top - 6} width={inner.w + 1} height={inner.h + 7} />
          </clipPath>
        </defs>

        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={sy(v).toFixed(1)} x2={W - PAD.right} y2={sy(v).toFixed(1)}
              stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 7} y={sy(v) + 4} textAnchor="end"
              fontSize="10" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
              {yLabel(v)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#perfClip)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.2"
          strokeLinejoin="round" strokeLinecap="round" clipPath="url(#perfClip)" />

        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="5" fill={color}
          stroke="var(--card)" strokeWidth="2" />

        {xTicks.map(({ ts, x }, i) => (
          <text key={i} x={x.toFixed(1)} y={H - 4} fontSize="10"
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
            {xLabel(ts, period)}
          </text>
        ))}
      </svg>
    </div>
  );
}
