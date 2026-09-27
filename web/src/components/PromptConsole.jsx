import { useState } from "react";
import { displayTicker, usd } from "../lib/api.js";

/**
 * An experimental alternate front door to the app: no dashboard, no tabs —
 * just a prompt bar. Ask for a thing, that thing materializes. This is a
 * genuinely working prototype, not a mockup — every number rendered here
 * comes from the same live state (portfolio/perpsPositions/kaminoLoans)
 * the real dashboard and PerpsApp/BorrowApp already compute; this
 * component only decides WHICH of them to show and how, never fetches or
 * fabricates anything of its own.
 *
 * Intent matching is a small client-side keyword table, deliberately not
 * a server round-trip to Claude (App.jsx already has several of those for
 * real trade parsing) — the whole point being tested here is that asking
 * feels instant. If this direction sticks, swap resolveIntent() for a real
 * classifier without touching anything else; the render side doesn't care
 * how `intentKey` was decided.
 */
const INTENTS = [
  { key: "portfolio", label: "Portfolio", test: /portfolio|holdings|net worth|stocks|equit|brokerage|own/i },
  { key: "perps",     label: "Perpetual positions", test: /perp|leverage|long|short|liquidat/i },
  { key: "borrow",    label: "Loans", test: /loan|borrow|debt|collateral|lend/i },
];

const EXAMPLES = ["Show me my portfolio", "What are my perp positions?", "Show my loans"];

function resolveIntent(text) {
  return INTENTS.find((i) => i.test.test(text)) ?? null;
}

export default function PromptConsole({
  portfolio, perpsPositions = [], perpsAccountValue = 0, perpsPnl = 0,
  kaminoCollateralDeposits = [], kaminoDebtBorrows = [],
  onBack, onNavigate,
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | materializing | shown | unknown
  const [resultKey, setResultKey] = useState(null);
  const [askedFor, setAskedFor] = useState("");

  const submit = (text) => {
    const q = (text ?? query).trim();
    if (!q || phase === "materializing") return;
    setQuery(q);
    setAskedFor(q);
    setPhase("materializing");
    const match = resolveIntent(q);
    // A beat of "thinking" before the reveal — answering in literally 0ms
    // reads as the bar doing nothing, not as it understanding you. Short
    // enough that it still feels instant relative to a real network round
    // trip, long enough to register as a deliberate materialize, not a glitch.
    setTimeout(() => {
      setResultKey(match?.key ?? null);
      setPhase(match ? "shown" : "unknown");
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
          <PortfolioResult portfolio={portfolio} onNavigate={onNavigate} />
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

function ResultShell({ title, headValue, headSub, onNavigate, navLabel, navTarget, children }) {
  return (
    <div className="pc-result pc-visible">
      <div className="pc-result-head">
        <div>
          <p className="table-card-title" style={{ margin: 0 }}>{title}</p>
          {headSub && <p className="tiny muted" style={{ marginTop: 2 }}>{headSub}</p>}
        </div>
        {headValue && <p className="serif pc-result-value">{headValue}</p>}
      </div>
      {children}
      {onNavigate && (
        <button className="btn ghost pc-open-btn" onClick={() => onNavigate(navTarget)}>{navLabel} →</button>
      )}
    </div>
  );
}

function PortfolioResult({ portfolio, onNavigate }) {
  const rows = portfolio?.rows ?? [];
  if (!rows.length) {
    return (
      <ResultShell title="Your Portfolio" headSub="Brokerage account">
        <p className="muted" style={{ padding: "12px 0" }}>No holdings yet — your portfolio is all cash.</p>
      </ResultShell>
    );
  }
  return (
    <ResultShell
      title="Your Portfolio"
      headSub={`${rows.length} position${rows.length === 1 ? "" : "s"} · $${usd(portfolio.cashUsdc)} cash`}
      headValue={`$${usd(portfolio.total)}`}
      onNavigate={onNavigate} navLabel="Open Brokerage" navTarget="dash"
    >
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
