import { useEffect, useMemo, useState } from "react";
import { api, displayTicker } from "./lib/api.js";

// Same ramp Donut.jsx already uses for the dashboard's real portfolio
// breakdown — reused here (not a new palette) so a basket's weight bar and
// an actual holdings chart read as the same visual language.
const SEG_COLORS = ["#1C4A38", "#2F6B50", "#4C8A69", "#71A987", "#9AC4A8", "#C6DCCC", "#173B2D", "#3E7A5C", "#5E9578", "#86B497"];

const MAX_CHIPS = 8;

function WeightBar({ allocations }) {
  if (allocations.length < 2) return null;
  return (
    <div className="portfolio-weightbar">
      {allocations.map((a, i) => (
        <div key={a.symbol} className="portfolio-weightbar-seg"
          style={{ flex: a.weight, background: SEG_COLORS[i % SEG_COLORS.length] }}
          title={`${displayTicker(a.symbol)} · ${a.weight}%`} />
      ))}
    </div>
  );
}

function PortfolioCard({ p, onAssemble }) {
  const shown = p.allocations.slice(0, MAX_CHIPS);
  const extra = p.allocations.length - shown.length;
  return (
    <div className="card portfolio-card">
      <p className="tiny label" style={{ margin: "0 0 4px" }}>{p.category}</p>
      <p className="card-title" style={{ margin: "0 0 4px" }}>{p.name}</p>
      <p className="tiny muted" style={{ margin: "0 0 12px" }}>{p.tagline}</p>

      <WeightBar allocations={p.allocations} />

      <div className="uni-grid" style={{ marginTop: p.allocations.length > 1 ? 10 : 0 }}>
        {shown.map((a) => (
          <span key={a.symbol} className="uni-chip">
            <span className="mono">{displayTicker(a.symbol)}</span>
          </span>
        ))}
        {extra > 0 && <span className="uni-chip">+{extra} more</span>}
      </div>

      <button className="btn primary" style={{ width: "100%", marginTop: 16 }}
        onClick={() => onAssemble(p.allocations, p.tagline)}>
        Build this portfolio →
      </button>
    </div>
  );
}

export default function PortfoliosApp({ onBack, onAssemble }) {
  const [registry, setRegistry] = useState(null);
  const [baskets, setBaskets] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    api.tokens().then((d) => setRegistry(d.tokens)).catch(() => {});
    api.portfolios().then((d) => setBaskets(d.baskets)).catch(() => setBaskets([]));
  }, []);

  // The app's real broad ETFs (S&P 500 ETF, Nasdaq-100 ETF, etc.) are
  // already ordinary registry entries — surfaced here as single-asset
  // "portfolios" via the same name-based heuristic EquitiesMarketsApp.jsx's
  // categoryOf() uses to spot them, rather than duplicating them into the
  // curated catalog, so they stay in sync as the registry changes.
  const etfPortfolios = useMemo(() => {
    if (!registry) return [];
    return Object.values(registry)
      .filter((t) => t.name.includes("ETF"))
      .map((t) => ({
        id: t.symbol, name: t.name, category: "Broad ETFs",
        tagline: `Broad-market ETF · ${displayTicker(t.symbol)}`,
        allocations: [{ symbol: t.symbol, weight: 100 }],
      }));
  }, [registry]);

  const allPortfolios = useMemo(() => [...(baskets || []), ...etfPortfolios], [baskets, etfPortfolios]);

  const categories = useMemo(() => {
    const cats = new Set(allPortfolios.map((p) => p.category));
    return ["All", ...Array.from(cats).sort()];
  }, [allPortfolios]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPortfolios
      .filter((p) => category === "All" || p.category === category)
      .filter((p) => !q
        || p.name.toLowerCase().includes(q)
        || p.tagline.toLowerCase().includes(q)
        || p.allocations.some((a) => displayTicker(a.symbol).toLowerCase().includes(q)));
  }, [allPortfolios, search, category]);

  const loading = !registry || baskets === null;

  return (
    <div className="stage dash-wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="card-toprow" style={{ marginTop: 16, marginBottom: 4 }}>
        <p className="table-card-title">Portfolios</p>
        <span className="tiny muted">{filtered.length} of {allPortfolios.length}</span>
      </div>
      <p className="lede sm" style={{ marginBottom: 18 }}>
        Curated baskets of well-known names, and Bonzai Trading's broad ETFs — pick one and
        adjust the weights and invest amount before you buy.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="perps-category-toggle" style={{ flexWrap: "wrap", marginBottom: 10 }}>
          {categories.map((c) => (
            <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <input className="perps-asset-search" placeholder="Search by name, theme, or ticker…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360, marginBottom: 0 }} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No matches.</p>
      ) : (
        <div className="portfolio-grid">
          {filtered.map((p) => (
            <PortfolioCard key={p.id} p={p} onAssemble={onAssemble} />
          ))}
        </div>
      )}
    </div>
  );
}
