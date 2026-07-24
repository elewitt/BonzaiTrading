import { useState, useMemo } from "react";
import { usd } from "../lib/api.js";

const SEG_COLORS = ["#1C4A38", "#2F6B50", "#4C8A69", "#71A987", "#9AC4A8", "#C6DCCC", "#173B2D", "#3E7A5C", "#5E9578", "#86B497"];
const ETFS = new Set(["SPYx", "QQQx", "GLDx"]);
const category = (sym) =>
  sym === "USDY" ? "Yield" : sym === "BTC" ? "Crypto" : sym === "EURC" ? "Currency" : ETFS.has(sym) ? "ETF" : "Stock";

function fmtPrice(p) {
  if (!p) return "—";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (p >= 100)  return `$${p.toFixed(2)}`;
  if (p >= 1)    return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

// Blend a hex color toward white (positive percent) or black (negative) —
// powers the per-segment gradient that gives each wedge a rounded, lit-from
// one-side look instead of a flat fill.
function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const amt = Math.round(2.55 * percent);
  const r = clamp((num >> 16) + amt), g = clamp(((num >> 8) & 0xff) + amt), b = clamp((num & 0xff) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export default function Donut({ rows, cash, total, cashUsdy = 0 }) {
  const [active, setActive] = useState(null);

  const segs = useMemo(() => {
    const items = rows.map((r, i) => ({
      key: r.symbol, label: r.name || r.symbol, sub: r.symbol,
      value: r.value, price: r.price || 0, priceUnavailable: !!r.priceUnavailable,
      color: SEG_COLORS[i % SEG_COLORS.length],
      cat: category(r.symbol),
      collateralValue: r.collateralValue || 0,
    }));
    // Once cash has been swapped into USDY it's still shown under the same
    // "Cash" line (it's still spendable, just earning yield in the
    // meantime) — but the badge should say so instead of reading as a
    // plain, non-earning stablecoin.
    const isYieldActive = cashUsdy > 0.005;
    if (cash > 0.005) items.push({
      key: "USDC", label: "Cash", sub: isYieldActive ? "USDY" : "USDC",
      value: cash, price: 1, color: "#B98A2F", cat: isYieldActive ? "Yield Activated" : "Stablecoin",
    });
    let a = -Math.PI / 2;
    return items.map((it) => {
      const frac = it.value / (total || 1);
      const a0 = a, a1 = a + Math.min(frac * 2 * Math.PI, 2 * Math.PI - 1e-4);
      a = a1;
      return { ...it, frac, a0, a1 };
    });
  }, [rows, cash, total, cashUsdy]);

  const S = 220, cx = S / 2, cy = S / 2, R = 100, r = 62;
  const pol = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  const pad = segs.length > 1 ? 0.018 : 0;
  const arcPath = (a0, a1) => {
    const [x0, y0] = pol(R, a0 + pad), [x1, y1] = pol(R, a1 - pad);
    const [x2, y2] = pol(r, a1 - pad), [x3, y3] = pol(r, a0 + pad);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`;
  };

  const sel = segs.find((s) => s.key === active);
  const nPos = rows.length + (cash > 0.005 ? 1 : 0);

  return (
    <div className="alloc-row">
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img"
        aria-label="Portfolio allocation" onMouseLeave={() => setActive(null)}>
        <defs>
          <filter id="donutShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#0A1812" floodOpacity="0.30" />
          </filter>
          <radialGradient id="donutHole" cx="42%" cy="38%" r="70%">
            <stop offset="55%" stopColor="#0A1812" stopOpacity="0" />
            <stop offset="100%" stopColor="#0A1812" stopOpacity="0.14" />
          </radialGradient>
          {segs.map((s) => (
            <linearGradient key={`grad-${s.key}`} id={`grad-${s.key}`}
              gradientUnits="userSpaceOnUse"
              x1={cx - R} y1={cy - R} x2={cx + R} y2={cy + R}>
              <stop offset="0%" stopColor={shade(s.color, 20)} />
              <stop offset="50%" stopColor={s.color} />
              <stop offset="100%" stopColor={shade(s.color, -18)} />
            </linearGradient>
          ))}
        </defs>

        <circle cx={cx} cy={cy} r={r + 1} fill="url(#donutHole)" />

        <g filter="url(#donutShadow)">
          {segs.map((s) => {
            const mid = (s.a0 + s.a1) / 2;
            const on = active === s.key;
            return (
              <path key={s.key} d={arcPath(s.a0, s.a1)} fill={`url(#grad-${s.key})`}
                stroke="rgba(255,255,255,.35)" strokeWidth="1"
                opacity={active && !on ? 0.3 : 1}
                style={{
                  cursor: "pointer",
                  transition: "transform .18s ease, opacity .18s ease",
                  transform: on ? `translate(${Math.cos(mid) * 6}px,${Math.sin(mid) * 6}px)` : "none",
                }}
                onMouseEnter={() => setActive(s.key)}
                onClick={() => setActive(on ? null : s.key)}
              />
            );
          })}
        </g>
        {sel ? (
          <>
            <text x={cx} y={cy - 22} textAnchor="middle" className="donut-label">{sel.label}</text>
            <text x={cx} y={cy + 4}  textAnchor="middle" className="donut-value">${usd(sel.value)}</text>
            <text x={cx} y={cy + 22} textAnchor="middle" className="donut-sub">
              {(sel.frac * 100).toFixed(1)}% · {sel.sub}
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 14} textAnchor="middle" className="donut-label">Portfolio</text>
            <text x={cx} y={cy + 10} textAnchor="middle" className="donut-value">${usd(total)}</text>
            <text x={cx} y={cy + 26} textAnchor="middle" className="donut-sub">
              {nPos} {nPos === 1 ? "asset" : "assets"}
            </text>
          </>
        )}
      </svg>

      <div className="alloc-legend">
        <div className="legend-header tiny label">
          <span />
          <span>Asset</span>
          <span className="lg-price">Price / token</span>
          <span className="lg-val">Value</span>
          <span className="lg-alloc">Allocation</span>
        </div>
        {segs.map((s) => (
          <button key={s.key}
            className={`legend-row ${active === s.key ? "on" : ""}`}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive(active === s.key ? null : s.key)}>
            <span className="dot" style={{ background: s.color }} />
            <span className="lg-identity">
              <span className="lg-name serif">{s.label}</span>
              <span className="lg-meta mono tiny muted">
                {s.sub}
                <span className={`cat-badge ${s.cat === "Yield Activated" ? "yield" : ""}`}>{s.cat}</span>
                {s.collateralValue > 0 && (
                  <span className="cat-badge collateral" title={`$${usd(s.collateralValue)} posted as Kamino collateral`}>
                    Collateral
                  </span>
                )}
              </span>
            </span>
            <span className="mono lg-price">{s.priceUnavailable ? "—" : fmtPrice(s.price)}</span>
            <span className="mono lg-val">{s.priceUnavailable ? <span className="tiny muted">Price unavailable</span> : `$${usd(s.value)}`}</span>
            <span className="lg-alloc">
              <span className="alloc-bar-track">
                <span className="alloc-bar-fill" style={{ width: `${Math.min(s.frac * 100, 100)}%`, background: s.color }} />
              </span>
              <span className="mono tiny lg-pct">{s.priceUnavailable ? "—" : `${(s.frac * 100).toFixed(1)}%`}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
