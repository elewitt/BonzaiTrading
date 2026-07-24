import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../lib/api.js";

function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function cleanHost(hostname = "") {
  return hostname.replace(/^www\./, "").replace(/\.(com|net|org|io|co).*/, "");
}

const SOURCE_COLORS = {
  cnbc: "#0070CC", bloomberg: "#1B1B1B", reuters: "#FF8000",
  wsj: "#004B87", ft: "#FFF1E5", seekingalpha: "#2CA58D",
};

function SourceBadge({ source }) {
  const key = Object.keys(SOURCE_COLORS).find((k) => source?.toLowerCase().includes(k));
  const bg = key ? SOURCE_COLORS[key] : "#5A6C62";
  return (
    <span className="news-badge" style={{ background: bg }}>
      {(source || "news").slice(0, 2).toUpperCase()}
    </span>
  );
}

export default function NewsPanel({ symbols }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // A search replaces the portfolio-driven symbol list entirely with
  // whatever ticker was typed — /api/news already accepts any symbol, not
  // just ones the user holds (it just falls back to the raw string as the
  // ticker/name when the registry doesn't recognize it), so no server
  // change is needed to look up an arbitrary ticker.
  const [searchInput, setSearchInput] = useState("");
  const [searchSymbol, setSearchSymbol] = useState(null);
  const symbolKey = searchSymbol ? searchSymbol : (symbols || []).join(",");
  const timerRef = useRef(null);

  useEffect(() => {
    if (!symbolKey) { setLoading(false); return; }

    const load = () => {
      // Must go through API_BASE, not a bare relative path — the Vite dev
      // proxy makes a relative /api/news work locally, but in production the
      // frontend (Vercel) and backend (Railway) are different domains, so a
      // relative fetch just hits Vercel's own SPA rewrite and gets back
      // index.html instead of JSON.
      fetch(`${API_BASE}/api/news?symbols=${encodeURIComponent(symbolKey)}`)
        .then((r) => r.json())
        .then((d) => { setItems(d.items || []); setLoading(false); })
        .catch(() => setLoading(false));
    };

    setLoading(true);
    load();
    timerRef.current = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [symbolKey]);

  const runSearch = (e) => {
    e.preventDefault();
    const cleaned = searchInput.trim().replace(/^\$/, "").toUpperCase();
    if (cleaned) setSearchSymbol(cleaned);
  };
  const clearSearch = () => {
    setSearchInput("");
    setSearchSymbol(null);
  };

  return (
    <aside className="news-panel card">
      <form className="news-search-row" onSubmit={runSearch}>
        <input
          className="perps-asset-search news-search-input"
          placeholder="Search news — e.g. $TSLA"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchSymbol && (
          <button type="button" className="btn ghost news-search-clear" onClick={clearSearch}>Clear</button>
        )}
      </form>

      <p className="table-card-title" style={{ marginBottom: 14 }}>
        {searchSymbol ? `News for $${searchSymbol}` : "News Feed"}
      </p>

      {loading && !items.length && (
        <div className="loading-dots" style={{ marginTop: 8 }}><span /><span /><span /></div>
      )}

      {!loading && !items.length && (
        <p className="tiny muted">
          {searchSymbol ? `No news found for $${searchSymbol}.` : "No news found for your positions."}
        </p>
      )}

      <div className="news-feed">
        {items.map((item, i) =>
          item.type === "article" ? (
            <a key={i} className="news-item" href={item.url} target="_blank" rel="noreferrer">
              <div className="news-row">
                <SourceBadge source={item.source} />
                <div className="news-content">
                  <div className="news-meta">
                    <span className="news-source tiny">{cleanHost(item.source)}</span>
                    <span className="news-sep">·</span>
                    <span className="news-time tiny muted">{timeAgo(item.published)}</span>
                    <span className="news-ticker mono tiny">${item.ticker}</span>
                  </div>
                  <p className="news-title">{decodeEntities(item.title)}</p>
                </div>
              </div>
            </a>
          ) : (
            <a key={i} className="news-item social" href={item.url} target="_blank" rel="noreferrer">
              <div className="news-row">
                <span className="st-badge">ST</span>
                <div className="news-content">
                  <div className="news-meta">
                    <span className="news-source tiny">@{item.handle}</span>
                    <span className="news-sep">·</span>
                    <span className="news-time tiny muted">{timeAgo(item.published)}</span>
                    <span className="news-ticker mono tiny">${item.ticker}</span>
                  </div>
                  <p className="news-body">{decodeEntities(item.text)}</p>
                </div>
              </div>
            </a>
          )
        )}
      </div>

      {items.length > 0 && (
        <p className="tiny muted news-foot">
          Articles via Brave · Social via StockTwits
        </p>
      )}
    </aside>
  );
}
