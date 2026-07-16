import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

const W = 560, H = 188;
const PAD = { top: 14, right: 14, bottom: 34, left: 58 };
const RANGES = ["1D", "1W", "1M", "3M", "1Y"];

function xLabel(ts, range) {
  const d = new Date(ts);
  if (range === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (range === "1W") return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function yLabel(v) {
  if (v >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 1000)  return `$${(v / 1000).toFixed(2)}k`;
  return `$${v.toFixed(2)}`;
}

function fmtBig(n) {
  if (n == null) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

// Adapted from PerformanceChart.jsx's hand-rolled SVG line chart (no
// charting library in this app) — different data shape ({ts, price} here
// vs {ts, v} there) and gradient/clipPath ids are namespaced ("asset...")
// since this modal can render on top of the dashboard while a
// PerformanceChart is also mounted underneath, and duplicate SVG ids would
// collide.
function AssetChart({ points, range }) {
  if (!points || points.length < 2) {
    return (
      <div className="chart-empty">
        <svg viewBox="0 0 560 120" className="perf-svg chart-placeholder">
          <text x="280" y="60" textAnchor="middle" fontSize="12"
            fontFamily="Instrument Sans,sans-serif" fill="var(--moss)">
            No chart data available
          </text>
        </svg>
      </div>
    );
  }

  const first = points[0].price;
  const last = points[points.length - 1].price;
  const isGain = last >= first;
  const color = isGain ? "var(--gain)" : "var(--loss)";
  const gradId = isGain ? "assetAreaGainGrad" : "assetAreaLossGrad";

  const vMin = Math.min(...points.map((p) => p.price));
  const vMax = Math.max(...points.map((p) => p.price));
  const vPad = (vMax - vMin) * 0.08 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;
  const tMin = points[0].ts, tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;
  const vRange = vHi - vLo;

  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = (ts) => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = (v) => PAD.top + inner.h - ((v - vLo) / vRange) * inner.h;

  const mapped = points.map((p) => [sx(p.ts), sy(p.price)]);
  const linePath = mapped.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const bottom = (PAD.top + inner.h + 1).toFixed(1);
  const areaPath = `${linePath} L${mapped[mapped.length - 1][0].toFixed(1)},${bottom} L${mapped[0][0].toFixed(1)},${bottom} Z`;

  const yTicks = [0, 0.33, 0.67, 1].map((f) => vLo + f * vRange);
  const xTicks = (() => {
    const n = Math.min(5, points.length);
    return n < 2 ? [] : Array.from({ length: n }, (_, i) => ({
      ts: tMin + (i / (n - 1)) * tRange,
      x: PAD.left + (i / (n - 1)) * inner.w,
    }));
  })();

  const [cx, cy] = mapped[mapped.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="assetAreaGainGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gain)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="assetAreaLossGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--loss)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.01" />
        </linearGradient>
        <clipPath id="assetPerfClip">
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

      <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#assetPerfClip)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.2"
        strokeLinejoin="round" strokeLinecap="round" clipPath="url(#assetPerfClip)" />

      <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="5" fill={color}
        stroke="var(--card)" strokeWidth="2" />

      {xTicks.map(({ ts, x }, i) => (
        <text key={i} x={x.toFixed(1)} y={H - 4} fontSize="10"
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
          {xLabel(ts, range)}
        </text>
      ))}
    </svg>
  );
}

export default function AssetInfoModal({ symbol, name, category, onClose }) {
  const [range, setRange] = useState("1M");
  const [info, setInfo] = useState(null);
  const [infoErr, setInfoErr] = useState(null);
  const [chart, setChart] = useState(null);
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
    api.marketChart(symbol, range)
      .then((d) => { if (!cancelled) { setChart(d); setChartLoading(false); } })
      .catch(() => { if (!cancelled) setChartLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  const quote = info?.quote;
  const profile = info?.profile;
  const stats = info?.statistics?.statistics;
  const price = quote ? Number(quote.close) : null;
  const change = quote ? Number(quote.percent_change) : null;

  // Prefer the real company site (Twelve Data's profile.website), when
  // available. But /profile turns out to be paid-tier-gated for an
  // unpredictable subset of individual stocks too, not just ETFs (e.g. COIN
  // 403s the same way SPY does) — so every stock/ETF needs a fallback link,
  // not just ETFs, or it silently shows nothing for whichever tickers
  // happen to be gated. ETFs fall back to ETFDB (predictable /etf/{ticker}
  // URLs); stocks fall back to Yahoo Finance's quote page (predictable
  // /quote/{ticker} URLs, works for virtually any US-listed stock). Crypto
  // (BTC) has no "company" to link to.
  const ticker = info?.ticker || symbol;
  const fallbackLink = category === "ETF"
    ? `https://etfdb.com/etf/${ticker}/`
    : `https://finance.yahoo.com/quote/${ticker}`;
  const link = category === "Crypto" ? null : (profile?.website || fallbackLink);
  let linkLabel = category === "ETF" ? "View fund details on ETFDB" : "View on Yahoo Finance";
  if (profile?.website) {
    try { linkLabel = `Visit ${new URL(profile.website).hostname.replace(/^www\./, "")}`; } catch {}
  }

  const statRows = [
    quote && ["Day range", `$${Number(quote.low).toFixed(2)} – $${Number(quote.high).toFixed(2)}`],
    quote?.fifty_two_week && ["52-week range", `$${Number(quote.fifty_two_week.low).toFixed(2)} – $${Number(quote.fifty_two_week.high).toFixed(2)}`],
    stats?.valuations_metrics?.market_capitalization && ["Market cap", fmtBig(stats.valuations_metrics.market_capitalization)],
    stats?.valuations_metrics?.trailing_pe && ["P/E ratio", stats.valuations_metrics.trailing_pe.toFixed(2)],
    profile?.sector && ["Sector", profile.sector],
    profile?.industry && ["Industry", profile.industry],
  ].filter(Boolean);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card asset-info-modal">
        <div className="answer-header">
          <div>
            <p className="tiny label" style={{ margin: 0 }}>{info?.ticker || symbol}</p>
            <h3 className="card-title" style={{ margin: "2px 0 0" }}>{profile?.name || name}</h3>
          </div>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {link && (
          <a className="tiny linkish asset-link" href={link} target="_blank" rel="noreferrer">
            {linkLabel} ↗
          </a>
        )}

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
          <div className="period-pills">
            {RANGES.map((r) => (
              <button key={r} className={`period-pill ${range === r ? "active" : ""}`}
                onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {chartLoading ? (
          <div className="loading-dots" style={{ margin: "24px 0" }}><span /><span /><span /></div>
        ) : (
          <AssetChart points={chart?.points} range={range} />
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

        {profile?.description && (
          <p className="tiny muted asset-description">{profile.description}</p>
        )}
      </div>
    </div>
  );
}
