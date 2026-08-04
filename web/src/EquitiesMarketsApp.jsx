import { useEffect, useMemo, useState } from "react";
import { api, usd } from "./lib/api.js";
import { COINGECKO_SLUGS } from "./perps/coingeckoSlugs.js";

// Same split as PerpsApp.jsx's asset list (Yahoo for equities, CoinGecko for
// crypto) — duplicated here rather than imported since these are a couple
// of pure one-liners, not worth coupling two independent product pages over.
function yahooFinanceUrl(ticker) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}
function coingeckoUrl(ticker) {
  const slug = COINGECKO_SLUGS[ticker];
  if (slug) return `https://www.coingecko.com/en/coins/${slug}`;
  return `https://www.coingecko.com/en/search?query=${encodeURIComponent(ticker)}`;
}

// xStocks tickers are always the real ticker + a trailing lowercase "x"
// (AAPLx, SPYx, BRK.Bx, ...) — Yahoo Finance addresses the underlying
// security directly by the ticker without that suffix.
function underlyingTicker(symbol) {
  return symbol.replace(/x$/, "");
}

// Etherfuse's Stablebond product-page slugs — confirmed live (app.etherfuse.
// com/bonds/{slug} returns 200) for each of the 4 sovereign bonds, not
// guessed. USDY has no equivalent listed-instrument page of its own.
const ETHERFUSE_BOND_SLUGS = { KTB: "ktb", CETES: "cetes", TESOURO: "tesouro", GILTS: "gilts" };

function categoryOf(symbol, registry) {
  if (registry[symbol]?.category === "yield") return "Yield";
  if (symbol === "BTC") return "Crypto";
  if (symbol === "EURC") return "Currency";
  return registry[symbol]?.name?.includes("ETF") ? "ETF" : "Stock";
}

// Where "clicking the tile" should send someone — a real per-asset quote
// page where one exists, never a guessed/invented URL. USDY has no
// external security to point at (an on-chain yield token, not a listed
// instrument), so it's shown but not clickable. The 4 Etherfuse bonds DO
// have a real product page each (see ETHERFUSE_BOND_SLUGS above).
function externalUrl(symbol, category) {
  if (symbol === "USDY") return null;
  if (ETHERFUSE_BOND_SLUGS[symbol]) return `https://app.etherfuse.com/bonds/${ETHERFUSE_BOND_SLUGS[symbol]}`;
  if (symbol === "BTC") return coingeckoUrl("BTC");
  if (symbol === "EURC") return "https://finance.yahoo.com/quote/EURUSD=X";
  return yahooFinanceUrl(underlyingTicker(symbol));
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
          <p className="card-title">Buy {row.symbol}</p>
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
          <span className="tiny muted">{mode === "usd" ? "Amount (USD)" : `Amount (${row.symbol})`}</span>
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
  const [prices, setPrices] = useState({});
  const [liquidityFlags, setLiquidityFlags] = useState({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [buyTarget, setBuyTarget] = useState(null); // the row currently being bought, or null

  useEffect(() => {
    api.tokens().then((d) => setRegistry(d.tokens)).catch(() => {});
    api.liquidityFlags().then(setLiquidityFlags).catch(() => {});
  }, []);

  useEffect(() => {
    if (!registry) return;
    const mints = Object.values(registry).filter((t) => t.symbol !== "USDC").map((t) => t.mint);
    api.prices(mints).then(setPrices).catch(() => {});
    const h = setInterval(() => api.prices(mints).then(setPrices).catch(() => {}), 15_000);
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
      .filter((r) => !q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, category]);

  return (
    <div className="stage wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="card" style={{ marginTop: 16, marginBottom: 20 }}>
        <div className="card-toprow">
          <p className="table-card-title">Equities Markets</p>
          <span className="tiny muted">{filtered.length} of {rows.length}</span>
        </div>
        <p className="lede sm">
          Every product tradeable on Bonzai Trading's brokerage — stocks, ETFs, and commodities via xStocks,
          plus USDY, EURC, and Bitcoin. Click any row to open its market page, or buy directly.
        </p>

        <div className="perps-category-toggle" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <input className="perps-asset-search" placeholder="Search by name or ticker…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
      </div>

      {!registry ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card table-card">
          <div className="trow thead tiny label" style={{ gridTemplateColumns: "3fr 1fr 1fr .5fr auto" }}>
            <span>Asset</span>
            <span>Category</span>
            <span>Price</span>
            <span></span>
            <span></span>
          </div>
          {filtered.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>No matches.</p>}
          {filtered.map((r) => {
            const price = prices[r.mint];
            const url = externalUrl(r.symbol, r.category);
            const buyable = onQuickBuy && !NOT_DIRECTLY_BUYABLE.has(r.symbol);
            const rowStyle = { gridTemplateColumns: "3fr 1fr 1fr .5fr auto" };
            const buyBtn = buyable && (
              <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 12 }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBuyTarget(r); }}>
                Buy
              </button>
            );
            const content = (
              <>
                <span className="asset">
                  <span className="serif">{r.name}</span>
                  <span className="mono tiny muted">{r.symbol}</span>
                </span>
                <span className="tiny muted">{r.category}</span>
                <span className="mono">{price ? `$${usd(price)}` : "—"}</span>
                <span className="tiny muted">{url ? "↗" : ""}</span>
                <span onClick={(e) => e.stopPropagation()}>{buyBtn}</span>
              </>
            );
            return url ? (
              <a key={r.symbol} className="trow asset-row-clickable equities-row" style={rowStyle} href={url} target="_blank" rel="noopener noreferrer">
                {content}
              </a>
            ) : (
              <div key={r.symbol} className="trow equities-row" style={rowStyle}>{content}</div>
            );
          })}
        </div>
      )}

      {buyTarget && (
        <BuyPopup
          row={buyTarget}
          price={prices[buyTarget.mint]}
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
