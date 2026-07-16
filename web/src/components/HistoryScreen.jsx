import { useState, useMemo } from "react";
import { usd } from "../lib/api.js";

const SOLSCAN = (sig) => `https://solscan.io/tx/${sig}`;

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const diffDays = Math.floor((today.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return new Date(ts).toLocaleDateString("en-US", { weekday: "long" });
  return new Date(ts).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function groupByDay(items, getTs) {
  const map = new Map();
  for (const item of items) {
    const key = dayLabel(getTs(item));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()];
}

export default function HistoryScreen({ txHistory, onBack }) {
  const [tab, setTab] = useState("swaps");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const q = search.toLowerCase();

  const swapGroups = useMemo(() => {
    const swaps = txHistory.filter((t) => t.type === "swap");
    const filtered = q
      ? swaps.filter((t) => t.symbol?.toLowerCase().includes(q) || t.groupLabel?.toLowerCase().includes(q))
      : swaps;
    const groups = new Map();
    for (const s of filtered) {
      const gid = s.groupId || s.id;
      if (!groups.has(gid)) {
        groups.set(gid, { id: gid, label: s.groupLabel || "Rebalance", timestamp: s.timestamp, legs: [] });
      }
      const g = groups.get(gid);
      g.legs.push(s);
      if (s.timestamp > g.timestamp) g.timestamp = s.timestamp;
    }
    return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [txHistory, q]);

  const transfers = useMemo(() => {
    const all = txHistory.filter((t) => t.type === "withdrawal");
    const filtered = q
      ? all.filter((t) => t.symbol?.toLowerCase().includes(q) || t.to?.toLowerCase().includes(q))
      : all;
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }, [txHistory, q]);

  const toggle = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const swapDays  = useMemo(() => groupByDay(swapGroups, (g) => g.timestamp), [swapGroups]);
  const xferDays  = useMemo(() => groupByDay(transfers,  (t) => t.timestamp), [transfers]);

  return (
    <main className="stage hist-stage">
      {/* ——— Header ——— */}
      <div className="hist-header">
        <button className="btn ghost hist-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Portfolio
        </button>
        <div className="hist-title-block">
          <h1 className="hist-title serif">History</h1>
          <p className="tiny muted hist-subtitle">
            {txHistory.length === 0
              ? "No transactions yet"
              : `${txHistory.length} transaction${txHistory.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* ——— Tabs + Search ——— */}
      <div className="hist-controls">
        <div className="hist-tabs" role="tablist">
          <button
            role="tab" aria-selected={tab === "swaps"}
            className={`hist-tab ${tab === "swaps" ? "active" : ""}`}
            onClick={() => setTab("swaps")}
          >
            Swaps
            {swapGroups.length > 0 && <span className="hist-badge">{swapGroups.length}</span>}
          </button>
          <button
            role="tab" aria-selected={tab === "transfers"}
            className={`hist-tab ${tab === "transfers" ? "active" : ""}`}
            onClick={() => setTab("transfers")}
          >
            Transfers
            {transfers.length > 0 && <span className="hist-badge">{transfers.length}</span>}
          </button>
        </div>
        <div className="hist-search-wrap">
          <svg className="hist-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="hist-search"
            placeholder={tab === "swaps" ? "Search symbol or action…" : "Search symbol or address…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ——— Swaps tab ——— */}
      {tab === "swaps" && (
        <div className="hist-list">
          {swapGroups.length === 0 && (
            <div className="hist-empty">
              <div className="hist-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              </div>
              <p className="hist-empty-text">
                {q ? "No matching swaps." : "No swap history yet."}
              </p>
              {!q && <p className="tiny muted">Execute a rebalance to get started.</p>}
            </div>
          )}
          {swapDays.map(([day, groups]) => (
            <div key={day} className="hist-day-section">
              <div className="hist-day-label">{day}</div>
              {groups.map((group) => {
                const isOpen = !collapsed[group.id];
                const failed   = group.legs.filter((l) => l.status === "failed").length;
                const sellTotal = group.legs.filter((l) => l.side === "sell").reduce((s, l) => s + (l.usd || 0), 0);
                const buyTotal  = group.legs.filter((l) => l.side === "buy" ).reduce((s, l) => s + (l.usd || 0), 0);
                const allOk = failed === 0;
                return (
                  <div className={`hist-group card ${isOpen ? "open" : ""}`} key={group.id}>
                    <button className="hist-group-header" onClick={() => toggle(group.id)}>
                      <div className="hist-group-left">
                        <div className="hist-group-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                            <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                          </svg>
                        </div>
                        <div className="hist-group-meta">
                          <span className="hist-group-label serif">{group.label}</span>
                          <div className="hist-group-sub">
                            <span className="tiny muted">{group.legs.length} swap{group.legs.length !== 1 ? "s" : ""}</span>
                            {sellTotal > 0 && <span className="hist-chip sell">−${usd(sellTotal, 2)}</span>}
                            {buyTotal  > 0 && <span className="hist-chip buy">+${usd(buyTotal, 2)}</span>}
                            {failed    > 0 && <span className="hist-chip fail">{failed} failed</span>}
                          </div>
                        </div>
                      </div>
                      <div className="hist-group-right">
                        <span className="tiny muted hist-timestamp">{timeAgo(group.timestamp)}</span>
                        <span className={`hist-chevron ${isOpen ? "open" : ""}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="hist-legs">
                        {group.legs.map((leg, i) => (
                          <div className="hist-leg" key={i}>
                            <div className="hist-leg-left">
                              <span className={`hist-leg-dot ${leg.side} ${leg.status === "failed" ? "failed" : ""}`} />
                              <span className={`trade-chip mono tiny ${leg.side}`}>
                                {leg.side === "buy" ? "Buy" : "Sell"} ${usd(leg.usd, 2)} {leg.symbol}
                              </span>
                            </div>
                            <div className="hist-leg-right">
                              {leg.status === "failed" && <span className="tiny warn">failed</span>}
                              {leg.signature ? (
                                <a href={SOLSCAN(leg.signature)} target="_blank" rel="noreferrer" className="solscan-link">
                                  {leg.signature.slice(0, 6)}…{leg.signature.slice(-4)}
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3 }}>
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                </a>
                              ) : (
                                <span className="tiny muted">—</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ——— Transfers tab ——— */}
      {tab === "transfers" && (
        <div className="hist-list">
          {transfers.length === 0 && (
            <div className="hist-empty">
              <div className="hist-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </div>
              <p className="hist-empty-text">{q ? "No matching transfers." : "No transfer history yet."}</p>
            </div>
          )}
          {xferDays.map(([day, items]) => (
            <div key={day} className="hist-day-section">
              <div className="hist-day-label">{day}</div>
              {items.map((t) => (
                <div className="hist-item card" key={t.id}>
                  <div className="hist-item-row">
                    <div className="hist-item-left">
                      <div className="hist-item-icon">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                      </div>
                      <div>
                        <div className="hist-item-amount serif">
                          {t.usd ? `$${usd(t.usd, 2)}` : t.uiAmount} <span className="hist-item-symbol">{t.symbol}</span>
                        </div>
                        <div className="hist-item-to tiny muted">
                          To <span className="mono hist-item-addr">{t.to ? `${t.to.slice(0, 6)}…${t.to.slice(-4)}` : "—"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="hist-item-right">
                      <span className="tiny muted">{timeAgo(t.timestamp)}</span>
                      {t.signature && (
                        <a href={SOLSCAN(t.signature)} target="_blank" rel="noreferrer" className="solscan-link hist-solscan-btn">
                          View
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3 }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
