import { useEffect, useMemo, useRef, useState } from "react";
import { api, usd, displayTicker, fmtBig } from "./lib/api.js";
import AssetDetailPanel from "./components/AssetDetailPanel.jsx";

function categoryOf(symbol, registry) {
  if (registry[symbol]?.category === "yield") return "Yield";
  if (symbol === "BTC") return "Crypto";
  if (symbol === "EURC") return "Currency";
  return registry[symbol]?.name?.includes("ETF") ? "ETF" : "Stock";
}

const CATEGORIES = ["All", "Stock", "ETF", "Crypto", "Currency", "Yield"];

// Assets you can't actually buy through the brokerage's USDC→token swap
// path — USDC itself (already excluded above) and USDY, which is acquired
// via yield-mode conversion, not a direct swap route. The 4 Etherfuse
// bonds are deliberately NOT in this set — unlike USDY they have real,
// confirmed Jupiter liquidity (verified directly against live quotes
// before adding them) and are meant to be bought like any other asset,
// not funneled through Yield Mode's automatic USDC<->cash conversion.
const NOT_DIRECTLY_BUYABLE = new Set(["USDY"]);

// The chart panel's height is the reference the list panel is capped to and
// scrolls within (same pattern as perps/PerpsApp.jsx's Trade tab) — a
// higher floor than perps' 480, since AssetDetailPanel carries more content
// (price header, period toggle, chart, stat grid, description) than a bare
// chart does.
const MIN_CHART_HEIGHT = 640;

const SORT_LABEL = { name: "Asset", price: "Price", change24h: "24h %", mcap: "Mkt Cap" };

function BuyPopup({ row, price, availableCash, flagged, onClose, onConfirm }) {
  const [mode, setMode] = useState("usd"); // "usd" | "shares"
  const [input, setInput] = useState("");

  const inputNum = Number(input) || 0;
  const usdAmount = mode === "usd" ? inputNum : inputNum * (price || 0);
  const overCash = usdAmount > availableCash + 0.005;
  const valid = usdAmount > 0 && !overCash;

  const setPct = (pct) => {
    const usdVal = availableCash * (pct / 100);
    setInput(mode === "usd" ? usdVal.toFixed(2) : price ? (usdVal / price).toFixed(6) : "");
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card" style={{ maxWidth: 380 }}>
        <div className="card-toprow">
          <p className="card-title">Buy {displayTicker(row.symbol)}</p>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <p className="tiny muted" style={{ margin: "0 0 4px" }}>{row.name}{price ? ` · $${usd(price)} current price` : ""}</p>
        <p className="tiny muted" style={{ margin: "0 0 10px" }}>${usd(availableCash)} available to invest</p>
        {flagged && (
          <p className="tiny gold" style={{ margin: "0 0 14px" }}>
            ⚠ Thin liquidity — this trade may see high slippage
          </p>
        )}

        {/* Simple two-way switch: $ amount or share count, not a full tab bar. */}
        <div className="lvp-pct-presets" style={{ marginBottom: 10 }}>
          <button type="button" className={`lvp-pct-btn ${mode === "usd" ? "sel" : ""}`}
            onClick={() => { setMode("usd"); setInput(""); }} style={{ flex: 1 }}>$</button>
          <button type="button" className={`lvp-pct-btn ${mode === "shares" ? "sel" : ""}`} disabled={!price}
            onClick={() => { setMode("shares"); setInput(""); }} style={{ flex: 1 }}>Shares</button>
        </div>

        <div className="borrow-field">
          <span className="tiny muted">{mode === "usd" ? "Amount (USD)" : `Amount (${displayTicker(row.symbol)})`}</span>
          <input className="field" inputMode="decimal" autoFocus placeholder={mode === "usd" ? "100" : "1.5"}
            value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        {mode === "shares" && price && inputNum > 0 && (
          <p className="tiny muted" style={{ margin: "-8px 0 12px" }}>≈ ${usd(usdAmount)}</p>
        )}

        <div className="lvp-pct-presets">
          {[25, 50, 75, 100].map((pct) => (
            <button key={pct} type="button" className="lvp-pct-btn" disabled={!availableCash} onClick={() => setPct(pct)}>
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>

        <button className="btn primary" style={{ width: "100%", marginTop: 4 }} disabled={!valid}
          onClick={() => onConfirm(usdAmount)}>
          Review buy →
        </button>
        {overCash && <p className="tiny warn" style={{ marginTop: 8 }}>Exceeds available cash (${usd(availableCash)}).</p>}
      </div>
    </div>
  );
}

export default function EquitiesMarketsApp({ onBack, onQuickBuy, availableCash = 0 }) {
  const [registry, setRegistry] = useState(null);
  const [priceDetails, setPriceDetails] = useState({}); // {mint: {price, change24h, mcap}}
  const [liquidityFlags, setLiquidityFlags] = useState({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [buyTarget, setBuyTarget] = useState(null); // the row currently being bought, or null
  const [selectedSymbol, setSelectedSymbol] = useState(null); // the row currently shown in the detail panel, or null (falls back to the first row)
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [chartHeight, setChartHeight] = useState(null);
  const chartColRef = useRef(null);

  useEffect(() => {
    api.tokens().then((d) => setRegistry(d.tokens)).catch(() => {});
    api.liquidityFlags().then(setLiquidityFlags).catch(() => {});
  }, []);

  useEffect(() => {
    if (!registry) return;
    const mints = Object.values(registry).filter((t) => t.symbol !== "USDC").map((t) => t.mint);
    api.priceDetails(mints).then(setPriceDetails).catch(() => {});
    const h = setInterval(() => api.priceDetails(mints).then(setPriceDetails).catch(() => {}), 15_000);
    return () => clearInterval(h);
  }, [registry]);

  const rows = useMemo(() => {
    if (!registry) return [];
    return Object.values(registry)
      .filter((t) => t.symbol !== "USDC") // cash, not a product
      .map((t) => ({ ...t, category: categoryOf(t.symbol, registry) }));
  }, [registry]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => category === "All" || r.category === category)
      .filter((r) => !q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, search, category]);

  const sortedFiltered = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const valueFor = (r) => {
      if (sortKey === "name") return r.name;
      if (sortKey === "price") return priceDetails[r.mint]?.price;
      if (sortKey === "change24h") return priceDetails[r.mint]?.change24h;
      return priceDetails[r.mint]?.mcap;
    };
    return [...filtered].sort((a, b) => {
      const av = valueFor(a), bv = valueFor(b);
      if (sortKey === "name") return dir * String(av).localeCompare(String(bv));
      // Missing data always sorts last, in either direction — a null 24h
      // change/market cap isn't "zero", it's unknown, and burying it at the
      // top under a descending sort would read as a fake, misleading value.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [filtered, sortKey, sortDir, priceDetails]);

  // Always shows something in the detail panel — falls back to the first
  // filtered row when nothing's been explicitly clicked yet, same pattern
  // perps/PerpsApp.jsx's Trade tab uses for its own asset selection.
  // Searches the full `rows` (not `filtered`) first so a selection made
  // before a search/filter is applied doesn't get dropped just because the
  // filter no longer matches it.
  const detailRow = rows.find((r) => r.symbol === selectedSymbol) ?? sortedFiltered[0] ?? null;

  // Top gainers/losers by 24h change — entirely client-side, computed from
  // data the page already has to fetch anyway (see server/src/index.js's
  // getPriceDetailsForMints, which piggybacks Jupiter's existing batched
  // price call rather than costing a single extra request). Rows with no
  // change24h are skipped outright rather than treated as flat/0% — most
  // of the ~167 tokenized-stock mints are thin/illiquid on Jupiter and
  // simply have no 24h figure at all.
  const movers = useMemo(() => {
    return rows
      .map((r) => ({ ...r, change24h: priceDetails[r.mint]?.change24h }))
      .filter((r) => r.change24h != null)
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 8);
  }, [rows, priceDetails]);

  const handleSort = (key) => {
    if (sortKey === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return; }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc"); // price/chg/mcap: biggest first by default
  };
  const sortArrow = (key) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  // The list panel's height is capped to match the chart panel's own
  // natural height (never the reverse — the chart's SVG has a fixed aspect
  // ratio, so constraining IT would crop the axis) so the two panels end
  // flush, same as perps/PerpsApp.jsx:416-422.
  useEffect(() => {
    const el = chartColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setChartHeight(Math.max(entry.contentRect.height, MIN_CHART_HEIGHT)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [detailRow?.symbol]);

  return (
    <div className="stage dash-wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="markets-page-header">
        <h2 className="display sm markets-page-title">Equities Markets</h2>
      </div>

      {movers.length > 0 && (
        <div className="movers-section">
          <p className="tiny label movers-label">Top Movers · 24h</p>
          <div className="movers-strip">
            {movers.map((m) => (
              <button key={m.symbol} className={`movers-chip ${m.change24h >= 0 ? "gain" : "loss"} ${detailRow?.symbol === m.symbol ? "active" : ""}`}
                onClick={() => setSelectedSymbol(m.symbol)}>
                <span className="mono movers-chip-ticker">{displayTicker(m.symbol)}</span>
                <span className="mono tiny movers-chip-pct">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" className="movers-chip-arrow">
                    <path d={m.change24h >= 0 ? "M5 1 L9 8 L1 8 Z" : "M5 9 L1 2 L9 2 Z"} />
                  </svg>
                  {m.change24h >= 0 ? "+" : ""}{m.change24h.toFixed(2)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!registry ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="equities-layout">
          <div className="card perps-asset-panel equities-list-panel" style={chartHeight ? { height: chartHeight } : undefined}>
            <h3>Markets</h3>
            <div className="perps-category-toggle" style={{ flexWrap: "wrap" }}>
              {CATEGORIES.map((c) => (
                <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
            <input className="perps-asset-search" placeholder="Search by name or ticker…" value={search}
              onChange={(e) => setSearch(e.target.value)} />

            <div className="trow trow-equities thead tiny label">
              {["name", "price", "change24h", "mcap"].map((key) => (
                <span key={key} className="equities-sort-th" onClick={() => handleSort(key)}>
                  {SORT_LABEL[key]}{sortArrow(key)}
                </span>
              ))}
              <span></span>
            </div>

            <div className="perps-asset-list">
              {sortedFiltered.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>No matches.</p>}
              {sortedFiltered.map((r) => {
                const detail = priceDetails[r.mint] || {};
                const { price, change24h, mcap } = detail;
                const buyable = onQuickBuy && !NOT_DIRECTLY_BUYABLE.has(r.symbol);
                const buyBtn = buyable && (
                  <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={(e) => { e.stopPropagation(); setBuyTarget(r); }}>
                    Buy
                  </button>
                );
                return (
                  <div key={r.symbol}
                    className={`trow trow-equities asset-row-clickable ${detailRow?.symbol === r.symbol ? "active" : ""}`}
                    onClick={() => setSelectedSymbol(r.symbol)}>
                    <span className="asset">
                      <span className="serif">{r.name}</span>
                      <span className="mono tiny muted">
                        {displayTicker(r.symbol)} · {r.category}
                        {liquidityFlags[r.symbol] && <span className="gold" title="Thin liquidity" style={{ marginLeft: 4 }}>⚠</span>}
                      </span>
                    </span>
                    <span className="mono">{price ? `$${usd(price)}` : "—"}</span>
                    <span className={`mono tiny ${change24h == null ? "muted" : change24h >= 0 ? "gain" : "loss"}`}>
                      {change24h == null ? "—" : `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`}
                    </span>
                    <span className="mono tiny muted">{mcap != null ? fmtBig(mcap) : "—"}</span>
                    <span onClick={(e) => e.stopPropagation()}>{buyBtn}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div ref={chartColRef} className="card equities-detail-card">
            {detailRow ? (
              <AssetDetailPanel symbol={detailRow.symbol} name={detailRow.name} category={detailRow.category} />
            ) : (
              <p className="muted">Select a market to see its chart.</p>
            )}
          </div>
        </div>
      )}

      {buyTarget && (
        <BuyPopup
          row={buyTarget}
          price={priceDetails[buyTarget.mint]?.price}
          availableCash={availableCash}
          flagged={!!liquidityFlags[buyTarget.symbol]}
          onClose={() => setBuyTarget(null)}
          onConfirm={(usdAmount) => {
            onQuickBuy(buyTarget, usdAmount);
            setBuyTarget(null);
          }}
        />
      )}
    </div>
  );
}
