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

function ChipRow({ allocations }) {
  const shown = allocations.slice(0, MAX_CHIPS);
  const extra = allocations.length - shown.length;
  return (
    <div className="uni-grid" style={{ marginTop: allocations.length > 1 ? 10 : 0 }}>
      {shown.map((a) => (
        <span key={a.symbol} className="uni-chip">
          <span className="mono">{displayTicker(a.symbol)}</span>
        </span>
      ))}
      {extra > 0 && <span className="uni-chip">+{extra} more</span>}
    </div>
  );
}

function PortfolioCard({ p, onAssemble }) {
  return (
    <div className="card portfolio-card">
      <p className="tiny label" style={{ margin: "0 0 4px" }}>{p.category}</p>
      <p className="card-title" style={{ margin: "0 0 4px" }}>{p.name}</p>
      <p className="tiny muted" style={{ margin: "0 0 12px" }}>{p.tagline}</p>
      <WeightBar allocations={p.allocations} />
      <ChipRow allocations={p.allocations} />
      <button className="btn primary" style={{ width: "100%", marginTop: 16 }}
        onClick={() => onAssemble(p.allocations, p.tagline)}>
        Build this portfolio →
      </button>
    </div>
  );
}

// Grounded in real, public 13F disclosures (see server/src/investorPortfolios.js
// for exact sourcing) rather than Bonzai's own editorial themes — shown with
// its fund/investor name up top and an "as of" line instead of a category tag,
// so it visually reads as sourced content, not a Bonzai-authored basket.
function InvestorCard({ p, onAssemble }) {
  return (
    <div className="card portfolio-card investor-card">
      <p className="tiny label" style={{ margin: "0 0 4px" }}>{p.fund}</p>
      <p className="card-title" style={{ margin: "0 0 2px" }}>{p.investor}</p>
      <p className="tiny muted" style={{ margin: "0 0 4px" }}>{p.tagline}</p>
      <p className="tiny muted investor-asof">Based on public {p.asOf}</p>
      <WeightBar allocations={p.allocations} />
      <ChipRow allocations={p.allocations} />
      <button className="btn primary" style={{ width: "100%", marginTop: 16 }}
        onClick={() => onAssemble(p.allocations, `${p.investor} — ${p.tagline}`)}>
        Build this portfolio →
      </button>
    </div>
  );
}

export default function PortfoliosApp({ onBack, onAssemble }) {
  const [registry, setRegistry] = useState(null);
  const [baskets, setBaskets] = useState(null);
  const [investorPortfolios, setInvestorPortfolios] = useState(null);
  const [tab, setTab] = useState("themes"); // "themes" | "investors"
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    api.tokens().then((d) => setRegistry(d.tokens)).catch(() => {});
    api.portfolios()
      .then((d) => { setBaskets(d.baskets); setInvestorPortfolios(d.investorPortfolios || []); })
      .catch(() => { setBaskets([]); setInvestorPortfolios([]); });
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

  const themePortfolios = useMemo(() => [...(baskets || []), ...etfPortfolios], [baskets, etfPortfolios]);

  const categories = useMemo(() => {
    const cats = new Set(themePortfolios.map((p) => p.category));
    return ["All", ...Array.from(cats).sort()];
  }, [themePortfolios]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (p, nameField) => !q
    || p[nameField].toLowerCase().includes(q)
    || p.tagline.toLowerCase().includes(q)
    || p.allocations.some((a) => displayTicker(a.symbol).toLowerCase().includes(q));

  const filteredThemes = useMemo(() => themePortfolios
    .filter((p) => category === "All" || p.category === category)
    .filter((p) => matchesSearch(p, "name")), [themePortfolios, search, category]);

  const filteredInvestors = useMemo(() =>
    (investorPortfolios || []).filter((p) => matchesSearch(p, "investor")),
  [investorPortfolios, search]);

  const loading = !registry || baskets === null || investorPortfolios === null;
  const onThemes = tab === "themes";
  const shownCount = onThemes ? filteredThemes.length : filteredInvestors.length;

  return (
    <div className="stage dash-wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="markets-page-header">
        <h2 className="display sm markets-page-title">Portfolios</h2>
      </div>

      <div className="perps-tabs card" style={{ marginBottom: 20, borderRadius: 12, padding: "0 8px" }}>
        <button className={`perps-tab ${onThemes ? "active" : ""}`} onClick={() => setTab("themes")}>Themes &amp; ETFs</button>
        <button className={`perps-tab ${!onThemes ? "active" : ""}`} onClick={() => setTab("investors")}>Legendary Investors</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        {onThemes && (
          <div className="perps-category-toggle" style={{ flexWrap: "wrap", marginBottom: 10 }}>
            {categories.map((c) => (
              <button key={c} className={`lvp-pct-btn ${category === c ? "sel" : ""}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
        )}
        <input className="perps-asset-search"
          placeholder={onThemes ? "Search by name, theme, or ticker…" : "Search by investor, fund, or ticker…"}
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360, marginBottom: 0 }} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : shownCount === 0 ? (
        <p className="muted">No matches.</p>
      ) : onThemes ? (
        <div className="portfolio-grid">
          {filteredThemes.map((p) => <PortfolioCard key={p.id} p={p} onAssemble={onAssemble} />)}
        </div>
      ) : (
        <div>
          <p className="tiny muted portfolio-disclaimer">
            Inspired by real, public SEC 13F disclosures (ARK: its own published holdings; Nancy
            Pelosi: a STOCK Act congressional disclosure, not a managed fund) — limited to
            holdings also tradeable here, so each is a partial reflection of the real portfolio,
            not a full replica. Not affiliated with, endorsed by, or reviewed by these investors,
            funds, or public officials.
          </p>
          <div className="portfolio-grid">
            {filteredInvestors.map((p) => <InvestorCard key={p.id} p={p} onAssemble={onAssemble} />)}
          </div>
        </div>
      )}
    </div>
  );
}
