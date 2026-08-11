import { useEffect, useMemo, useRef, useState } from "react";
import { useLongviewHl, useAssets, useAssetCandles } from "../perps/useHyperliquid.js";
import { DEFAULT_CONFIG } from "../perps/config.js";
import { api } from "../lib/api.js";
import TimeSeriesChart, { priceLabel } from "./TimeSeriesChart.jsx";

const PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];
// Twelve Data (registry assets) uses a different range vocabulary than
// Hyperliquid (perps assets) — mapped to the SAME Day/Week/Month/All
// selector so the two data sources feel like one consistent control,
// even though the underlying API calls are completely different shapes.
const TD_RANGE = { perpDay: "1D", perpWeek: "1W", perpMonth: "1M", perpAllTime: "1Y" };

const AUTOCOMPLETE_LIMIT = 8;

// Synchronous default so the chart is never blank on first render, before
// Hyperliquid's own asset list has loaded — upgraded to the Hyperliquid
// "NVDA" perp (tighter, more "live" data, same preference the BTC dedup
// below uses) the moment that list arrives, as long as the user hasn't
// picked something else in the meantime.
const DEFAULT_SELECTION = { symbol: "NVDAx", name: "NVIDIA", source: "registry" };

/**
 * Search across EVERY product this app lists — the full brokerage
 * registry (167 xStocks + BTC + EURC + USDY + the 4 Etherfuse bonds) and
 * everything tradeable on Hyperliquid (crypto + equity perps, fetched
 * lazily only once this panel is actually opened, not on every dashboard
 * load) — and chart whichever one is selected with the exact same
 * interactive chart used on the Perps page.
 *
 * Autocomplete, not a browsable list — with ~270 combined products, a
 * always-visible list either overwhelms the screen (all of them) or is an
 * arbitrary, meaningless slice (the first 24 alphabetically, as it was
 * before this rewrite — "0G", "2Z", "AAPL"... first only because of their
 * names, never what anyone actually wants to see by default). A dropdown
 * that appears while typing and disappears on selection keeps the chart
 * as the visually dominant element, with the search as a quick way to
 * jump to something specific rather than a persistent inventory browser.
 *
 * Two genuinely different chart data sources depending on what's picked:
 * Hyperliquid assets get live candles via candleSnapshot (useAssetCandles,
 * already built for the perps dashboard); registry-only assets (the
 * xStocks, EURC, the 4 bonds) go through the same Twelve Data path
 * AssetInfoModal.jsx already uses. EURC and the 4 bonds have no Twelve
 * Data coverage at all — they'd still show up in search (this app really
 * does list them), just land on the chart's own "no data" empty state
 * rather than being silently hidden from results.
 */
export default function MarketsExplorer({ registry, autoFocusSearch = true }) {
  const hl = useLongviewHl(DEFAULT_CONFIG);
  const { assets: hlAssets } = useAssets(hl);

  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0); // keyboard-highlighted row in the dropdown
  const [selected, setSelected] = useState(DEFAULT_SELECTION);
  const [userPicked, setUserPicked] = useState(false); // false while still on the synchronous default
  const [period, setPeriod] = useState("perpDay");
  const blurTimer = useRef(null);
  const inputRef = useRef(null);

  // Unified, deduped-by-symbol list. Hyperliquid wins a collision (e.g.
  // BTC is both a registry spot asset and a Hyperliquid perp) — its candle
  // data is tighter/more "live," a better fit for this chart's polish.
  const allMarkets = useMemo(() => {
    const bySymbol = new Map();
    for (const t of Object.values(registry || {})) {
      if (t.symbol === "USDC") continue; // settlement currency, not a chartable "product"
      bySymbol.set(t.symbol, { symbol: t.symbol, name: t.name, source: "registry" });
    }
    for (const a of hlAssets) {
      bySymbol.set(a.displayName, {
        symbol: a.displayName, name: a.displayName, source: "hyperliquid",
        coin: a.name, category: a.category,
      });
    }
    return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [registry, hlAssets]);

  // Upgrade the default selection to Hyperliquid's NVDA once its asset
  // list loads — never after the user has actively picked something.
  useEffect(() => {
    if (userPicked) return;
    const hlNvda = allMarkets.find((m) => m.source === "hyperliquid" && m.symbol === "NVDA");
    if (hlNvda) setSelected(hlNvda);
  }, [allMarkets, userPicked]);

  const q = query.trim().toLowerCase();
  const suggestions = q
    ? allMarkets.filter((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, AUTOCOMPLETE_LIMIT)
    : [];

  const pick = (m) => {
    setSelected(m);
    setUserPicked(true);
    setQuery("");
    setDropdownOpen(false);
    // The dropdown row's onMouseDown below calls e.preventDefault() so the
    // input doesn't lose focus mid-click (needed for the click to register
    // before the input's own onBlur fires) — but that also means the
    // keyboard/zoomed-in view never dismisses on its own afterward. Blur
    // it explicitly once the pick is done instead.
    inputRef.current?.blur();
  };

  // Hyperliquid candles — only actually requested when a Hyperliquid asset
  // is selected (useAssetCandles no-ops on a null coin).
  const { points: hlCandles, loading: hlLoading } = useAssetCandles(
    hl, selected?.source === "hyperliquid" ? selected.coin : null, period,
  );

  // Twelve Data chart — only for a registry-sourced selection.
  const [tdPoints, setTdPoints] = useState([]);
  const [tdLoading, setTdLoading] = useState(false);
  useEffect(() => {
    if (!selected || selected.source !== "registry") { setTdPoints([]); return; }
    let cancelled = false;
    setTdLoading(true);
    api.marketChart(selected.symbol, TD_RANGE[period] || "1M")
      .then((d) => { if (!cancelled) setTdPoints((d.points || []).map((p) => ({ ts: p.ts, v: p.price }))); })
      .catch(() => { if (!cancelled) setTdPoints([]); })
      .finally(() => { if (!cancelled) setTdLoading(false); });
    return () => { cancelled = true; };
  }, [selected, period]);

  const points = selected?.source === "hyperliquid"
    ? hlCandles.map((p) => ({ ts: p.ts, v: p.price }))
    : tdPoints;
  const loading = selected?.source === "hyperliquid" ? hlLoading : tdLoading;

  const first = points.length ? points[0].v : null;
  const last = points.length ? points[points.length - 1].v : null;
  const pctChange = first ? ((last - first) / first) * 100 : null;

  return (
    <div className="lvp-dashboard">
      <div className="lvp-card markets-search-card">
        <p className="table-card-title" style={{ marginBottom: 12 }}>Markets</p>
        <div className="markets-search-wrap">
          <input
            ref={inputRef}
            className="perps-asset-search"
            placeholder="Search any product — e.g. AAPL, BTC, TESOURO…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); setActiveIdx(0); }}
            onFocus={() => query && setDropdownOpen(true)}
            onBlur={() => { blurTimer.current = setTimeout(() => setDropdownOpen(false), 120); }}
            onKeyDown={(e) => {
              if (!dropdownOpen || suggestions.length === 0) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(suggestions[activeIdx]); }
              else if (e.key === "Escape") { setDropdownOpen(false); }
            }}
            autoFocus={autoFocusSearch}
          />
          {dropdownOpen && q && (
            <div className="markets-autocomplete">
              {suggestions.length === 0 && <p className="lvp-muted markets-autocomplete-empty">No matching products.</p>}
              {suggestions.map((m, i) => (
                <div key={`${m.source}-${m.symbol}`}
                  // mousedown (not click) fires before the input's onBlur,
                  // so the selection registers before the dropdown closes.
                  onMouseDown={(e) => { e.preventDefault(); clearTimeout(blurTimer.current); pick(m); }}
                  className={`perps-asset-row ${i === activeIdx ? "active" : ""}`}>
                  <span className="perps-asset-name mono">
                    {m.symbol}
                    <span className="tiny muted" style={{ marginLeft: 8, fontFamily: "inherit" }}>{m.name}</span>
                  </span>
                  <span className="markets-list-source tiny muted">
                    {m.source === "hyperliquid" ? (m.category === "equity" ? "Equity Perp" : "Crypto Perp") : "Spot"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lvp-card lvp-pnl-card-full">
        <div className="lvp-pnl-header-row">
          <div>
            <p className="lvp-muted" style={{ marginBottom: 2 }}>{selected.name}</p>
            {last != null ? (
              <p className="lvp-pnl-focal">
                {priceLabel(last)}
                {pctChange != null && (
                  <span className={`lvp-pnl-focal-chip mono ${pctChange >= 0 ? "gain" : "loss"}`}>
                    {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%
                  </span>
                )}
              </p>
            ) : (
              <p className="lvp-pnl-focal lvp-muted" style={{ fontSize: 28 }}>—</p>
            )}
          </div>
          <div className="lvp-pnl-periods">
            {PERIODS.map((p) => (
              <button key={p.key} className={`lvp-pct-btn ${period === p.key ? "sel" : ""}`} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <TimeSeriesChart key={`${selected.source}-${selected.symbol}-${period}`} points={points} period={period} loading={loading} mode="price"
          emptyText="No chart data available for this product yet." />
      </div>
    </div>
  );
}
