import { useMemo } from "react";
import { usd, displayTicker } from "../lib/api.js";
import TimeSeriesChart, { priceLabel } from "./TimeSeriesChart.jsx";

// Same green family as Donut.jsx's SEG_COLORS, kept as its own small copy
// here rather than importing that array — this only ever needs the first
// few steps for a top-N-plus-"Other" bar list, not Donut's full wedge set.
const BAR_COLORS = ["#1C4A38", "#2F6B50", "#4C8A69", "#71A987"];
const OTHER_COLOR = "#D8DED4";
const MAX_BARS = 4;

// Collapses a product's rows into "top N by value, rest folded into Other" —
// a 3-up card grid has room for a handful of bars each, not a full legend
// table the way the single-product Donut view does.
function topBars(rows, total) {
  const sorted = [...(rows || [])].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, MAX_BARS);
  const restValue = sorted.slice(MAX_BARS).reduce((s, r) => s + r.value, 0);
  const bars = shown.map((r, i) => ({
    key: r.symbol,
    label: displayTicker(r.symbol) || r.symbol,
    pct: total > 0 ? (r.value / total) * 100 : 0,
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));
  if (restValue > 0.01) {
    bars.push({ key: "__other", label: "Other", pct: total > 0 ? (restValue / total) * 100 : 0, color: OTHER_COLOR });
  }
  return bars;
}

function ProductCard({ title, value, meta, bars, emptyHint, onView }) {
  return (
    <div className="breakdown-card">
      <div className="breakdown-card-head">
        <p className="tiny label" style={{ margin: 0 }}>{title}</p>
        {onView && <button className="linkish" onClick={onView}>View →</button>}
      </div>
      <p className="breakdown-card-value mono">{value}</p>
      {meta && <p className="tiny muted" style={{ margin: "2px 0 12px" }}>{meta}</p>}
      {bars.length === 0 ? (
        <p className="tiny muted" style={{ marginTop: meta ? 0 : 12 }}>{emptyHint}</p>
      ) : (
        <div className="breakdown-bars">
          {bars.map((b) => (
            <div key={b.key} className="breakdown-bar-row">
              <span className="breakdown-bar-name">{b.label}</span>
              <span className="alloc-bar-track">
                <span className="alloc-bar-fill" style={{ width: `${Math.min(b.pct, 100)}%`, background: b.color }} />
              </span>
              <span className="mono tiny breakdown-bar-pct">{b.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Prompt-triggered ("give me a full portfolio breakdown", "how's my
 * portfolio doing", "net worth") cross-product summary — the dashboard
 * already has a net-worth hero number and per-product Donuts/stats, but
 * only one at a time, split across three separate tabs. This pulls all of
 * it into a single concise view: net-worth performance (reusing the exact
 * same statsPoints/TimeSeriesChart the Brokerage flip-card's back face
 * already tracks — that history is the whole account's value, not just
 * Brokerage's, see App.jsx's myPortfolioTotal), a few scannable stats, and
 * one compact card per product with its own top holdings.
 */
export default function PortfolioBreakdownModal({
  onClose, netWorth, statsPoints, statsPeriod, setStatsPeriod, periods,
  brokerage, perps, borrow, onViewProduct,
}) {
  const invested = Math.max(0, (brokerage.total || 0) - (brokerage.cash || 0));
  const cashPct = brokerage.total > 0 ? (brokerage.cash / brokerage.total) * 100 : 0;

  const topHolding = useMemo(() => {
    const sorted = [...(brokerage.rows || [])].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    if (!sorted.length || !brokerage.total) return null;
    return { symbol: sorted[0].symbol, pct: (sorted[0].value / brokerage.total) * 100 };
  }, [brokerage.rows, brokerage.total]);

  const perf = useMemo(() => {
    if (statsPoints.length < 2) return null;
    const first = statsPoints[0].v, last = statsPoints[statsPoints.length - 1].v;
    return { pct: first > 0 ? ((last - first) / first) * 100 : null };
  }, [statsPoints]);

  const positionCount = (brokerage.rows?.length || 0) + (perps.rows?.length || 0) + (borrow.rows?.length || 0);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card breakdown-modal">
        <div className="answer-header">
          <p className="tiny label" style={{ margin: 0 }}>Portfolio Breakdown</p>
          <button className="x" onClick={onClose} title="Dismiss">×</button>
        </div>

        <div className="lvp-pnl-header-row">
          <div>
            <p className="lvp-muted" style={{ marginBottom: 2 }}>Total Net Worth</p>
            <p className="lvp-pnl-focal">
              {priceLabel(netWorth)}
              {perf?.pct != null && (
                <span className={`lvp-pnl-focal-chip mono ${perf.pct >= 0 ? "gain" : "loss"}`}>
                  {perf.pct >= 0 ? "+" : ""}{perf.pct.toFixed(2)}%
                </span>
              )}
            </p>
          </div>
          <div className="lvp-pnl-periods">
            {periods.map((p) => (
              <button key={p.key} className={`lvp-pct-btn ${statsPeriod === p.key ? "sel" : ""}`}
                onClick={() => setStatsPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <TimeSeriesChart key={statsPeriod} points={statsPoints} period={statsPeriod} loading={false} mode="price"
          emptyText="History builds up over time — check back soon." />

        <div className="breakdown-stats">
          <div className="breakdown-stat">
            <span className="tiny muted">Invested</span>
            <span className="mono">${usd(invested, 0)}</span>
          </div>
          <div className="breakdown-stat">
            <span className="tiny muted">Cash</span>
            <span className="mono">{cashPct.toFixed(0)}%</span>
          </div>
          <div className="breakdown-stat">
            <span className="tiny muted">Positions</span>
            <span className="mono">{positionCount}</span>
          </div>
          {topHolding && (
            <div className="breakdown-stat">
              <span className="tiny muted">Top holding</span>
              <span className="mono">{displayTicker(topHolding.symbol)} · {topHolding.pct.toFixed(1)}%</span>
            </div>
          )}
        </div>

        <div className="breakdown-grid">
          <ProductCard title="Brokerage" value={`$${usd(brokerage.total, 0)}`}
            meta={brokerage.rows?.length ? `${brokerage.rows.length} holding${brokerage.rows.length === 1 ? "" : "s"} · ${cashPct.toFixed(0)}% cash` : null}
            bars={topBars(brokerage.rows, brokerage.total)}
            emptyHint="Deposit cash to start building your brokerage portfolio."
            onView={onViewProduct && (() => onViewProduct("brokerage"))} />
          <ProductCard title="Perps" value={`$${usd(perps.accountValue, 0)}`}
            meta={perps.rows?.length
              ? `${perps.rows.length} open position${perps.rows.length === 1 ? "" : "s"} · ${perps.pnl >= 0 ? "+" : "-"}$${usd(Math.abs(perps.pnl), 0)} unrealized`
              : null}
            bars={topBars(perps.rows, perps.total)}
            emptyHint="No open perps positions yet."
            onView={onViewProduct && (() => onViewProduct("perps"))} />
          <ProductCard title="Borrow / Lend" value={`$${usd(borrow.collateralTotal, 0)}`}
            meta={borrow.rows?.length ? `$${usd(borrow.debtTotal, 0)} borrowed · ${borrow.blendedLtv.toFixed(0)}% LTV` : null}
            bars={topBars(borrow.rows, borrow.collateralTotal)}
            emptyHint="No collateral posted yet."
            onView={onViewProduct && (() => onViewProduct("borrow"))} />
        </div>
      </div>
    </div>
  );
}
