import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { executeStrategyProposal } from "./executeProposal.js";
import { DEFAULT_LEVERAGE, DEFAULT_REBALANCE_THRESHOLD_PCT, DEFAULT_UNFAVORABLE_EXIT_HOURS } from "./deltaNeutralDefaults.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_PREVIEW_COUNT = 5;

function fmtUsd(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "every N days" in the phrasing a user would actually say — mirrors the
 * mapping /api/parse-strategy's own system prompt uses, so a strategy
 * created by typing "monthly" reads back as "monthly," not "every 30
 * days." Falls back to the literal day count for anything else an LLM-
 * parsed prompt could produce (e.g. "every 10 days"). */
function formatInterval(days) {
  const label = { 1: "day", 7: "week", 14: "2 weeks", 30: "month" }[days];
  return label ? `every ${label}` : `every ${days} days`;
}

/** Projected future due dates — pure client-side math, same "anchor +
 * N × intervalDays" rule strategyAgents/dca.js's evaluate() uses
 * server-side, just run forward multiple times instead of checked once
 * against now(). Framed as a projection (each date assumes the previous
 * one executed on schedule) rather than a guarantee — a real buy still
 * only happens once the evaluator proposes it AND the user confirms.
 * DCA-only — delta-neutral has no fixed schedule to project. */
function projectSchedule(strategy, count = SCHEDULE_PREVIEW_COUNT) {
  const { params, state, created_at } = strategy;
  const anchor = state?.lastExecutedAt ? new Date(state.lastExecutedAt) : new Date(created_at);
  const intervalMs = params.intervalDays * DAY_MS;
  const dates = [];
  for (let i = 1; i <= count; i++) dates.push(new Date(anchor.getTime() + i * intervalMs));
  return dates;
}

const HISTORY_STATUS_LABEL = { confirmed: "Executed", rejected: "Rejected", expired: "Expired" };

/** Self-fetching — each strategy card loads its own history independently
 * rather than the parent panel fetching N strategies' histories eagerly
 * up front, so opening the Trading Agent page with several strategies
 * doesn't fire a burst of requests before anything is even visible. */
function StrategyHistory({ strategyId, address }) {
  const [history, setHistory] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    api.strategyHistory(strategyId, address)
      .then((d) => { if (!cancelled) setHistory((d.proposals || []).filter((p) => p.status !== "pending")); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [strategyId, address]);

  if (history === null) return <p className="lvp-muted tiny">Loading history…</p>;
  if (history.length === 0) return <p className="lvp-muted tiny">No activity yet.</p>;

  return (
    <div className="agents-history-list">
      {history.map((p) => (
        <div key={p.id} className="agents-history-row">
          <span className={`agents-history-status agents-history-status-${p.status}`}>
            {HISTORY_STATUS_LABEL[p.status] || p.status}
          </span>
          <span className="tiny">{p.summary}</span>
          <span className="tiny muted">{new Date(p.resolved_at || p.created_at).toLocaleDateString()}</span>
          {p.status === "confirmed" && p.executed_signatures?.find((s) => typeof s === "string" && !s.startsWith("hl-")) && (
            <a className="tiny" href={`https://solscan.io/tx/${p.executed_signatures.find((s) => !s.startsWith("hl-"))}`} target="_blank" rel="noopener noreferrer">
              View →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function StrategyCard({ strategy: s, address, busy, onTransition }) {
  const isDeltaNeutral = s.type === "delta_neutral";
  const schedule = !isDeltaNeutral && s.status === "active" ? projectSchedule(s) : null;

  return (
    <div className="lvp-card agents-strategy-card" style={{ marginBottom: 16 }}>
      <div className="card-toprow">
        <div>
          {isDeltaNeutral ? (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {fmtUsd(s.params.notionalUsd)} delta-neutral {s.params.symbol} at {s.params.leverage}x
            </p>
          ) : (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {fmtUsd(s.params.usdPerInterval)} of {s.params.symbol} {formatInterval(s.params.intervalDays)}
            </p>
          )}
          <p className="lvp-muted tiny" style={{ margin: "2px 0 0" }}>
            <span className={`strategy-status strategy-status-${s.status}`}>{s.status}</span>
            {!isDeltaNeutral && s.state?.lastExecutedAt && ` · last bought ${new Date(s.state.lastExecutedAt).toLocaleDateString()}`}
            {isDeltaNeutral && (s.state?.openedAt ? ` · opened ${new Date(s.state.openedAt).toLocaleDateString()}` : " · not yet opened")}
          </p>
        </div>
        <div className="strategy-row-actions">
          {s.status === "active" && (
            <button className="btn ghost" disabled={busy} onClick={() => onTransition(s.id, "pause")}>Pause</button>
          )}
          {s.status === "paused" && (
            <button className="btn ghost" disabled={busy} onClick={() => onTransition(s.id, "resume")}>Resume</button>
          )}
          {(s.status === "active" || s.status === "paused") && (
            <button className="btn ghost" disabled={busy} onClick={() => onTransition(s.id, "cancel")}>Cancel</button>
          )}
        </div>
      </div>

      {isDeltaNeutral && (
        <p className="lvp-muted tiny" style={{ margin: 0 }}>
          Rebalances past {s.params.rebalanceThresholdPct}% drift · exits after {s.params.unfavorableFundingExitHours}h of unfavorable funding
        </p>
      )}

      {schedule && (
        <div className="agents-schedule-row">
          <span className="tiny muted">Next buys (projected)</span>
          <div className="agents-schedule-dates">
            {schedule.map((d, i) => <span key={i} className="agents-schedule-chip">{fmtDate(d)}</span>)}
          </div>
        </div>
      )}

      <div className="agents-history-section">
        <span className="tiny muted">History</span>
        <StrategyHistory strategyId={s.id} address={address} />
      </div>
    </div>
  );
}

const LEVERAGE_OPTIONS = [1, 2, 3];

/** Explicit-parameter form, not the LLM prompt bar DCA uses — leverage,
 * notional, and the two risk-sensitivity settings are risk parameters
 * worth setting deliberately, not inferring from a sentence. */
function DeltaNeutralForm({ address, evmAddress, onCreated }) {
  const [assets, setAssets] = useState([]);
  const [symbol, setSymbol] = useState("");
  const [notionalUsd, setNotionalUsd] = useState("");
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [rebalanceThresholdPct, setRebalanceThresholdPct] = useState(DEFAULT_REBALANCE_THRESHOLD_PCT);
  const [unfavorableFundingExitHours, setUnfavorableFundingExitHours] = useState(DEFAULT_UNFAVORABLE_EXIT_HOURS);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.deltaNeutralEligibleAssets().then((d) => setAssets(d.assets || [])).catch(() => setAssets([]));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!address || creating) return;
    setError("");
    const trimmed = symbol.trim();
    if (!assets.some((a) => a.symbol === trimmed)) return setError("Pick an asset from the list — it needs to be tradeable as both a spot asset and a Hyperliquid perp.");
    const notional = Number(notionalUsd);
    if (!Number.isFinite(notional) || notional <= 0) return setError("Enter a valid notional amount.");
    if (!evmAddress) return setError("Connect a Hyperliquid-linked wallet first (open the Perps tab once to set it up).");

    setCreating(true);
    try {
      await api.createStrategy({
        walletAddress: address, evmAddress, type: "delta_neutral",
        params: { symbol: trimmed, notionalUsd: notional, leverage, rebalanceThresholdPct, unfavorableFundingExitHours },
      });
      setSymbol(""); setNotionalUsd("");
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <p className="err tiny" style={{ marginBottom: 10 }}>{error}</p>}
      <p className="lvp-muted" style={{ marginTop: -6, marginBottom: 14 }}>
        Long the spot asset and short an equal notional on its Hyperliquid perp to collect funding — market-neutral, not a directional bet.
        Leverage is capped at 3x on purpose: it doesn't add expected return here, only liquidation risk if the two legs drift out of sync.
      </p>
      <div className="borrow-field">
        <span className="tiny muted">Asset</span>
        <input className="perps-asset-search" list="delta-neutral-asset-options" placeholder="e.g. AAPLx, BTC, TSLAx"
          value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <datalist id="delta-neutral-asset-options">
          {assets.map((a) => <option key={a.symbol} value={a.symbol} />)}
        </datalist>
      </div>
      <div className="borrow-field">
        <span className="tiny muted">Notional (per leg)</span>
        <input className="perps-asset-search" type="number" min="50" step="any" placeholder="$1,000"
          value={notionalUsd} onChange={(e) => setNotionalUsd(e.target.value)} />
      </div>
      <div className="borrow-field">
        <span className="tiny muted">Leverage</span>
        <div className="strategy-freq-picker">
          {LEVERAGE_OPTIONS.map((lv) => (
            <button type="button" key={lv} className={`lvp-pct-btn ${leverage === lv ? "sel" : ""}`} onClick={() => setLeverage(lv)}>
              {lv}x
            </button>
          ))}
        </div>
      </div>
      <div className="borrow-field">
        <span className="tiny muted">Rebalance if spot/perp drift past</span>
        <input className="perps-asset-search" type="number" min="2" max="25" step="1"
          value={rebalanceThresholdPct} onChange={(e) => setRebalanceThresholdPct(Number(e.target.value))} />
      </div>
      <div className="borrow-field">
        <span className="tiny muted">Exit after unfavorable funding for (hours)</span>
        <input className="perps-asset-search" type="number" min="4" max="168" step="1"
          value={unfavorableFundingExitHours} onChange={(e) => setUnfavorableFundingExitHours(Number(e.target.value))} />
      </div>
      <div className="wfoot" style={{ marginTop: 12 }}>
        <button className="btn primary" type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create strategy"}
        </button>
      </div>
    </form>
  );
}

/**
 * Strategy Agents. DCA is created via a plain-English prompt bar
 * (/api/parse-strategy maps it onto the curated DCA mechanism — never
 * freeform LLM-authored trade logic, see that endpoint's own comment).
 * Delta-neutral (funding-rate harvesting via a hedged spot+perp position)
 * is created via an explicit form instead — leverage and drift/exit
 * sensitivity are risk parameters worth setting deliberately, not
 * inferred from a sentence. A server-side evaluator checks each active
 * strategy on a schedule and, when due, writes a pending proposal here
 * for the user to review and confirm with their own wallet — never
 * signed or executed automatically, for either type. Owns its own fetch/
 * refresh state, same shape as MarketsExplorer.jsx — TradingAgentApp.jsx
 * (the page shell) just provides the surrounding chrome.
 */
export default function StrategiesPanel({ address, signWithWallet, evmAddress, hlCtx }) {
  const [strategies, setStrategies] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mode, setMode] = useState("dca"); // "dca" | "delta_neutral"

  const [prompt, setPrompt] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { plans: [{symbol,name,usdPerInterval,intervalDays}], summary } | null
  const [creating, setCreating] = useState(false);

  const [busyStrategyId, setBusyStrategyId] = useState(null);
  const [confirmProposal, setConfirmProposal] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const [s, p] = await Promise.all([api.listStrategies(address), api.listStrategyProposals(address)]);
      setStrategies(s.strategies || []);
      setProposals(p.proposals || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);

  const runParse = async () => {
    if (!prompt.trim() || parsing) return;
    setError(""); setParsed(null);
    setParsing(true);
    try {
      const result = await api.parseStrategy(prompt.trim());
      setParsed(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  // Sequential, not Promise.all — the server enforces MAX_ACTIVE_STRATEGIES_PER_WALLET
  // by counting existing active strategies at request time, so creating a
  // batch in parallel could race that check (several requests all seeing
  // the same "count so far" and all succeeding past the real cap).
  // Sequential keeps each check accurate as the previous create lands.
  const confirmCreate = async () => {
    if (!parsed || !address || creating) return;
    setCreating(true);
    setError("");
    const failures = [];
    for (const plan of parsed.plans) {
      try {
        await api.createStrategy({
          walletAddress: address,
          type: "dca",
          params: { symbol: plan.symbol, usdPerInterval: plan.usdPerInterval, intervalDays: plan.intervalDays },
        });
      } catch (e) {
        failures.push(`${plan.symbol}: ${e.message}`);
      }
    }
    setParsed(null); setPrompt("");
    await refresh();
    if (failures.length > 0) {
      setError(`Created ${parsed.plans.length - failures.length} of ${parsed.plans.length}. ${failures.join("; ")}`);
    }
    setCreating(false);
  };

  const transition = async (id, action) => {
    setBusyStrategyId(id);
    setError("");
    try {
      const fn = { pause: api.pauseStrategy, resume: api.resumeStrategy, cancel: api.cancelStrategy }[action];
      await fn(id, address);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyStrategyId(null);
    }
  };

  const rejectProposal = async (id) => {
    setError("");
    try {
      await api.rejectStrategyProposal(id, address);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const runConfirm = async () => {
    if (!confirmProposal) return;
    setConfirmBusy(true);
    try {
      await executeStrategyProposal({
        proposalId: confirmProposal.id, taker: address, signWithWallet, hlCtx,
        onStatus: setConfirmStatus,
      });
      setConfirmProposal(null); setConfirmStatus(null);
      await refresh();
    } catch (e) {
      setError(e.message);
      setConfirmProposal(null); setConfirmStatus(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <>
      {error && <p className="err tiny" style={{ marginBottom: 12 }}>{error}</p>}

      {proposals.length > 0 && (
        <div className="lvp-card agents-proposals-card" style={{ marginBottom: 24 }}>
          <p className="table-card-title" style={{ marginBottom: 12 }}>Pending Proposals</p>
          {proposals.map((p) => (
            <div key={p.id} className="strategy-row">
              <div>
                <p style={{ margin: 0 }}>{p.summary}</p>
                <p className="lvp-muted" style={{ margin: 0 }}>Expires {new Date(p.expires_at).toLocaleString()}</p>
              </div>
              <div className="strategy-row-actions">
                <button className="btn ghost" onClick={() => rejectProposal(p.id)}>Reject</button>
                <button className="btn primary" onClick={() => setConfirmProposal(p)}>Review →</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="lvp-card" style={{ marginBottom: 24 }}>
        <div className="card-toprow" style={{ marginBottom: 12 }}>
          <p className="table-card-title" style={{ margin: 0 }}>New Strategy</p>
          <div className="lvp-metric-tabs" style={{ marginBottom: 0 }}>
            <button className={`lvp-metric-tab ${mode === "dca" ? "sel" : ""}`} onClick={() => setMode("dca")}>DCA</button>
            <button className={`lvp-metric-tab ${mode === "delta_neutral" ? "sel" : ""}`} onClick={() => setMode("delta_neutral")}>Delta-Neutral</button>
          </div>
        </div>

        {mode === "dca" ? (
          <>
            <div className="prompt-wrap row">
              <input className="prompt-box oneline" placeholder={'"DCA $50 into bitcoin every week" · "buy $200 of the S&P 500 monthly"'}
                value={prompt} onChange={(e) => { setPrompt(e.target.value); setParsed(null); }}
                onKeyDown={(e) => e.key === "Enter" && runParse()} />
              <button className="btn primary" disabled={!prompt.trim() || parsing} onClick={runParse}>
                {parsing ? "Thinking…" : "Go"}
              </button>
            </div>

            {parsed && (
              <div className="agents-parsed-preview">
                <p style={{ margin: 0 }}>
                  {parsed.plans.length === 1
                    ? `${fmtUsd(parsed.plans[0].usdPerInterval)} of ${parsed.plans[0].name} (${parsed.plans[0].symbol}) ${formatInterval(parsed.plans[0].intervalDays)}`
                    : parsed.summary}
                </p>
                {parsed.plans.length > 1 && (
                  <div className="agents-schedule-dates" style={{ marginTop: 8 }}>
                    {parsed.plans.map((p) => <span key={p.symbol} className="agents-schedule-chip">{p.symbol}</span>)}
                  </div>
                )}
                <div className="wfoot" style={{ marginTop: 10 }}>
                  <button className="btn ghost" disabled={creating} onClick={() => setParsed(null)}>Never mind</button>
                  <button className="btn primary" disabled={creating} onClick={confirmCreate}>
                    {creating ? "Creating…" : parsed.plans.length > 1 ? `Looks good, create ${parsed.plans.length} strategies` : "Looks good, create it"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <DeltaNeutralForm address={address} evmAddress={evmAddress} onCreated={refresh} />
        )}
      </div>

      {loading ? (
        <p className="lvp-muted">Loading…</p>
      ) : strategies.length === 0 ? (
        <p className="lvp-muted">No strategies yet — create one above to get started.</p>
      ) : (
        strategies.map((s) => (
          <StrategyCard key={s.id} strategy={s} address={address} busy={busyStrategyId === s.id} onTransition={transition} />
        ))
      )}

      {confirmProposal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !confirmBusy && setConfirmProposal(null)}>
          <div className="modal-box card" style={{ maxWidth: 380 }}>
            <p className="tiny label">Confirm strategy proposal</p>
            <p className="lede sm">{confirmProposal.summary}</p>
            <div className="wfoot" style={{ marginTop: 12 }}>
              <button className="btn ghost" disabled={confirmBusy} onClick={() => setConfirmProposal(null)}>Discard</button>
              <button className="btn primary" disabled={confirmBusy} onClick={runConfirm}>
                {confirmBusy ? (confirmStatus ? `${confirmStatus}…` : "Waiting for signature…") : "Confirm →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
