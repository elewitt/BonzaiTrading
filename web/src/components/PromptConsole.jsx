import { useState } from "react";
import { displayTicker, usd } from "../lib/api.js";
import { usePortfolioStats } from "../perps/useHyperliquid.js";
import Donut from "./Donut.jsx";
import TimeSeriesChart from "./TimeSeriesChart.jsx";

/**
 * An experimental alternate front door to the app: no dashboard, no tabs —
 * just a prompt bar. Ask for a thing, that thing materializes. This is a
 * genuinely working prototype, not a mockup — every number rendered here
 * comes from the same live state (portfolio/perpsPositions/kaminoLoans) the
 * real dashboard and PerpsApp/BorrowApp already compute, and every chart is
 * the app's own real chart component (Donut, TimeSeriesChart) — not a
 * redrawn stand-in — so "make it crisp" means it already inherited the
 * same crisp the rest of the app did.
 *
 * Intent matching is a small client-side keyword table, deliberately not a
 * server round-trip to Claude — the whole point being tested here is that
 * asking feels instant. If this direction sticks, swap resolveIntent() for
 * a real classifier without touching anything else; the render side
 * doesn't care how `intentKey` was decided.
 *
 * "Manipulate on the fly" has two paths that land on the same state, by
 * design — a typed follow-up ("show me in pie chart form") and a clicked
 * toggle pill do the exact same setDisplayMode/setPnlPeriod call. Neither
 * is the "real" way to do it; a person should be able to use whichever
 * they reach for first.
 */
const INTENTS = [
  { key: "pnl",       label: "P&L",                 test: /p&l|pnl|profit|\bloss(es)?\b|performance/i },
  // \bown\b (not a bare "own" substring) so this doesn't fire on any word
  // that merely contains "own" (shown, brown, downturn, ...) — a real bug
  // in the first version of this list, caught while extending it.
  { key: "portfolio", label: "Portfolio",            test: /portfolio|holdings|net worth|stocks|equit|brokerage|\bown\b/i },
  { key: "perps",     label: "Perpetual positions",  test: /perp|leverage|\blong\b|\bshort\b|liquidat/i },
  { key: "borrow",    label: "Loans",                test: /loan|borrow|debt|collateral|lend/i },
];

const EXAMPLES = [
  "Show me my portfolio",
  "Show my portfolio as a pie chart",
  "My P&L from the past month",
  "What are my perp positions?",
];

const PNL_PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

function resolveIntent(text) {
  return INTENTS.find((i) => i.test.test(text)) ?? null;
}

/** A time-scope word in the same sentence as a P&L request — "the past
 * month", "this week", "today". Falls back to a month view when a P&L
 * request names no period at all (a bare "show me my P&L" has to default
 * to something, and a month is the most useful first answer). */
function parsePeriodFromText(text) {
  if (/all[- ]?time|since (i started|the beginning)|\bever\b/i.test(text)) return "perpAllTime";
  if (/\bmonth\b/i.test(text)) return "perpMonth";
  if (/\bweek\b/i.test(text)) return "perpWeek";
  if (/\btoday\b|\bday\b|\b24\s?h(ours?)?\b/i.test(text)) return "perpDay";
  return null;
}

/** A chart-format word — "pie chart", "as a table" — independent of
 * whatever subject it's paired (or not paired) with. */
function parseDisplayMode(text) {
  if (/\bpie\b|\bdonut\b/i.test(text)) return "pie";
  if (/\btable\b|\blist\b/i.test(text)) return "table";
  return null;
}

export default function PromptConsole({
  portfolio, perpsPositions = [], perpsAccountValue = 0, perpsPnl = 0,
  kaminoCollateralDeposits = [], kaminoDebtBorrows = [],
  hl, evmAddress,
  onBack, onNavigate,
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | materializing | shown | unknown
  const [resultKey, setResultKey] = useState(null);
  const [askedFor, setAskedFor] = useState("");
  const [portfolioMode, setPortfolioMode] = useState("table"); // table | pie
  const [pnlPeriod, setPnlPeriod] = useState("perpMonth");

  // Only fetched while this screen is mounted — same real hook
  // PerpsPerformancePanel uses for the account's own P&L history.
  const { pnlHistory, stats: pnlStats } = usePortfolioStats(hl, evmAddress);
  const pnlLoading = Object.keys(pnlHistory).length === 0;

  const submit = (text) => {
    const q = (text ?? query).trim();
    if (!q || phase === "materializing") return;
    setQuery(q); setAskedFor(q);

    const topicMatch = resolveIntent(q);
    const formatMatch = parseDisplayMode(q);

    // A bare reformat with no new subject named ("show me in pie chart
    // form") re-styles whatever's already on screen rather than failing —
    // "on the fly" means it applies to what you're already looking at, the
    // same way clicking a toggle pill would.
    if (!topicMatch && formatMatch && resultKey === "portfolio") {
      setPhase("materializing");
      setTimeout(() => { setPortfolioMode(formatMatch); setPhase("shown"); }, 260);
      return;
    }

    setPhase("materializing");
    setTimeout(() => {
      if (!topicMatch) { setResultKey(null); setPhase("unknown"); return; }
      setResultKey(topicMatch.key);
      if (topicMatch.key === "portfolio" && formatMatch) setPortfolioMode(formatMatch);
      if (topicMatch.key === "pnl") setPnlPeriod(parsePeriodFromText(q) ?? "perpMonth");
      setPhase("shown");
    }, 420);
  };

  const reset = () => {
    setQuery(""); setAskedFor(""); setResultKey(null); setPhase("idle");
  };

  const docked = phase !== "idle";

  return (
    <div className="pc-shell">
      <div className="pc-top">
        <button className="pc-back" onClick={onBack}>← Back to classic view</button>
      </div>

      <div className={`pc-center ${docked ? "pc-docked" : ""}`}>
        {!docked && (
          <p className="serif pc-headline">What would you like to see?</p>
        )}

        <form
          className={`pc-bar ${docked ? "pc-bar-docked" : ""}`}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <SparkleIcon />
          <input
            className="pc-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask for anything — “show me my portfolio”"
            autoFocus
          />
          {docked ? (
            <button type="button" className="pc-new-btn" onClick={reset}>New question</button>
          ) : (
            <button type="submit" className="btn primary pc-go-btn">Go</button>
          )}
        </form>

        {!docked && (
          <div className="pc-examples">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip pc-example-chip" onClick={() => submit(e)}>{e}</button>
            ))}
          </div>
        )}

        {phase === "materializing" && (
          <div className="pc-materializing">
            <span className="pc-dot" /><span className="pc-dot" /><span className="pc-dot" />
          </div>
        )}

        {phase === "unknown" && (
          <div className="pc-result pc-visible">
            <p className="muted">
              I don't have a view for &ldquo;{askedFor}&rdquo; yet in this prototype — try one of these:
            </p>
            <div className="pc-examples" style={{ marginTop: 12 }}>
              {EXAMPLES.map((e) => (
                <button key={e} className="chip pc-example-chip" onClick={() => submit(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}

        {phase === "shown" && resultKey === "portfolio" && (
          <PortfolioResult portfolio={portfolio} mode={portfolioMode} onModeChange={setPortfolioMode} onNavigate={onNavigate} />
        )}
        {phase === "shown" && resultKey === "pnl" && (
          <PnlResult pnlHistory={pnlHistory} stats={pnlStats} loading={pnlLoading}
            period={pnlPeriod} onPeriodChange={setPnlPeriod} onNavigate={onNavigate} />
        )}
        {phase === "shown" && resultKey === "perps" && (
          <PerpsResult positions={perpsPositions} accountValue={perpsAccountValue} pnl={perpsPnl} onNavigate={onNavigate} />
        )}
        {phase === "shown" && resultKey === "borrow" && (
          <BorrowResult deposits={kaminoCollateralDeposits} borrows={kaminoDebtBorrows} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--pine)" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="pc-sparkle">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Same pill-toggle look every period/category switch in the app already
 * uses (.lvp-pct-btn/.sel) — a display-mode switch is the same kind of
 * control as a chart-period switch, so it should look like one. */
function PillToggle({ options, value, onChange }) {
  return (
    <div className="pc-toggle">
      {options.map((o) => (
        <button key={o.key} type="button" className={`lvp-pct-btn ${value === o.key ? "sel" : ""}`}
          onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ResultShell({ title, headValue, valueClass, headSub, toggle, onNavigate, navLabel, navTarget, children }) {
  return (
    <div className="pc-result pc-visible">
      <div className="pc-result-head">
        <div>
          <p className="table-card-title" style={{ margin: 0 }}>{title}</p>
          {headSub && <p className="tiny muted" style={{ marginTop: 2 }}>{headSub}</p>}
        </div>
        <div className="pc-result-head-right">
          {toggle}
          {headValue && <p className={`serif pc-result-value ${valueClass || ""}`}>{headValue}</p>}
        </div>
      </div>
      {children}
      {onNavigate && (
        <button className="btn ghost pc-open-btn" onClick={() => onNavigate(navTarget)}>{navLabel} →</button>
      )}
    </div>
  );
}

function PortfolioResult({ portfolio, mode, onModeChange, onNavigate }) {
  const rows = portfolio?.rows ?? [];
  if (!rows.length) {
    return (
      <ResultShell title="Your Portfolio" headSub="Brokerage account">
        <p className="muted" style={{ padding: "12px 0" }}>No holdings yet — your portfolio is all cash.</p>
      </ResultShell>
    );
  }
  const toggle = (
    <PillToggle options={[{ key: "table", label: "Table" }, { key: "pie", label: "Pie" }]} value={mode} onChange={onModeChange} />
  );
  return (
    <ResultShell
      title="Your Portfolio"
      headSub={`${rows.length} position${rows.length === 1 ? "" : "s"} · $${usd(portfolio.cashUsdc)} cash`}
      headValue={`$${usd(portfolio.total)}`}
      toggle={toggle}
      onNavigate={onNavigate} navLabel="Open Brokerage" navTarget="dash"
    >
      {mode === "pie" ? (
        <div className="pc-donut-wrap">
          {/* The real donut — same gradient-shaded wedges, legend, and
              click-to-highlight behavior as the main dashboard's own chart. */}
          <Donut rows={rows} cash={portfolio.cashUsdc} total={portfolio.total} cashUsdy={portfolio.cashUsdy ?? 0} />
        </div>
      ) : (
        <div className="pc-rows">
          {rows.map((r, i) => (
            <div key={r.mint ?? r.symbol} className="pc-row" style={{ animationDelay: `${i * 45}ms` }}>
              <span className="lg-identity">
                <span className="serif lg-name">{r.name || displayTicker(r.symbol)}</span>
                <span className="mono tiny muted">{displayTicker(r.symbol)}</span>
              </span>
              <span className="mono tiny muted">{r.uiAmount}</span>
              <span className="lg-alloc">
                <span className="alloc-bar-track">
                  <span className="alloc-bar-fill" style={{ width: `${r.weight}%`, background: "#1A4433" }} />
                </span>
                <span className="mono tiny lg-pct">{r.weight.toFixed(1)}%</span>
              </span>
              <span className="mono pc-row-value">{r.value != null ? `$${usd(r.value)}` : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </ResultShell>
  );
}

function PnlResult({ pnlHistory, stats, loading, period, onPeriodChange, onNavigate }) {
  const points = (pnlHistory[period] || []).map(([ts, v]) => ({ ts, v: Number(v) }));
  const total = points.length ? points[points.length - 1].v : 0;
  const periodPhrase = period === "perpAllTime" ? "All time" : `Past ${(PNL_PERIODS.find((p) => p.key === period)?.label ?? "Month").toLowerCase()}`;
  return (
    <ResultShell
      title="Perpetual P&L"
      headSub={`${periodPhrase} · ${stats?.totalTrades ?? 0} trades all-time · Hyperliquid`}
      headValue={`${total >= 0 ? "+" : "−"}$${usd(Math.abs(total))}`}
      valueClass={total >= 0 ? "gain" : "warn"}
      toggle={<PillToggle options={PNL_PERIODS} value={period} onChange={onPeriodChange} />}
      onNavigate={onNavigate} navLabel="Open Perps" navTarget="perps"
    >
      <div className="pc-chart-wrap">
        <TimeSeriesChart points={points} period={period} loading={loading} mode="pnl"
          emptyText="Not enough history yet for this period." />
      </div>
    </ResultShell>
  );
}

function PerpsResult({ positions, accountValue, pnl, onNavigate }) {
  if (!positions.length) {
    return (
      <ResultShell title="Perpetual Positions" headSub="Hyperliquid">
        <p className="muted" style={{ padding: "12px 0" }}>No open perp positions right now.</p>
      </ResultShell>
    );
  }
  return (
    <ResultShell
      title="Perpetual Positions"
      headSub={`${positions.length} open · account $${usd(accountValue)}`}
      headValue={`${pnl >= 0 ? "+" : ""}$${usd(pnl)}`}
      valueClass={pnl >= 0 ? "gain" : "warn"}
      onNavigate={onNavigate} navLabel="Open Perps" navTarget="perps"
    >
      <div className="pc-rows">
        {positions.map((p, i) => (
          <div key={`${p.dex}-${p.coin}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(p.coin)}</span>
              <span className={`pos-side-badge ${p.side}`} style={{ alignSelf: "flex-start" }}>
                {p.side === "long" ? "Long" : "Short"}
              </span>
            </span>
            <span className="mono tiny muted">${usd(p.markPx)} mark</span>
            <span className="pos-leverage-chip">{p.leverage}x</span>
            <span className={`mono pc-row-value ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>
              {p.unrealizedPnl >= 0 ? "+" : ""}${usd(p.unrealizedPnl)}
            </span>
          </div>
        ))}
      </div>
    </ResultShell>
  );
}

function BorrowResult({ deposits, borrows, onNavigate }) {
  if (!deposits.length && !borrows.length) {
    return (
      <ResultShell title="Loans" headSub="Kamino tokenized-stocks market">
        <p className="muted" style={{ padding: "12px 0" }}>No open loans — nothing posted as collateral.</p>
      </ResultShell>
    );
  }
  const totalDebt = borrows.reduce((s, b) => s + Number(b.tokenValue ?? b.marketValueUsd ?? 0), 0);
  return (
    <ResultShell
      title="Loans"
      headSub="Kamino tokenized-stocks market"
      headValue={`$${usd(totalDebt)} owed`}
      onNavigate={onNavigate} navLabel="Open Borrow / Lend" navTarget="borrow"
    >
      <div className="pc-rows">
        {deposits.map((d, i) => (
          <div key={`c-${i}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(d.tokenName)}</span>
              <span className="tiny muted">Collateral</span>
            </span>
            <span className="mono tiny muted">{d.tokenAmount}</span>
            <span />
            <span className="mono pc-row-value">${usd(d.tokenValue ?? d.marketValueUsd ?? 0)}</span>
          </div>
        ))}
        {borrows.map((b, i) => (
          <div key={`b-${i}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${(deposits.length + i) * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(b.tokenName || "USDC")}</span>
              <span className="tiny muted">Borrowed</span>
            </span>
            <span className="mono tiny muted">{b.tokenAmount}</span>
            <span />
            <span className="mono pc-row-value warn">${usd(b.tokenValue ?? b.marketValueUsd ?? 0)}</span>
          </div>
        ))}
      </div>
    </ResultShell>
  );
}
