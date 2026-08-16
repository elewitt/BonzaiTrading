import { useCallback, useEffect, useState } from "react";
import { api, displayTicker } from "../lib/api.js";
import { executeStrategyProposal } from "./executeProposal.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_PREVIEW_COUNT = 5;
const SLICE_INTERVAL_MINUTES = 30; // mirrors server/src/strategyAgents/sliceExecution.js
function sliceCount(durationHours) {
  return Math.max(2, Math.min(48, Math.round((durationHours * 60) / SLICE_INTERVAL_MINUTES)));
}

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

/** USD-weighted average of a TWAP/VWAP strategy's recorded fills — each
 * fill is a real slice's actual execution price (see strategyLegs.js's
 * computeFillPrice), not the quoted/target price, so this reflects what
 * actually happened, not what was supposed to. */
function avgFillPrice(fills) {
  if (!fills?.length) return null;
  const totalUsd = fills.reduce((sum, f) => sum + f.usd, 0);
  const totalQty = fills.reduce((sum, f) => sum + f.usd / f.price, 0);
  return totalQty > 0 ? totalUsd / totalQty : null;
}

function triggerDescription(params) {
  const verb = params.side === "buy" ? "Buy" : "Sell";
  const amount = params.side === "sell" && params.sellAll ? "entire position" : fmtUsd(params.usd);
  const move = params.direction === "below" ? "drops" : "rises";
  const level = params.thresholdType === "price" ? `to $${params.thresholdValue.toLocaleString()}` : `${params.thresholdValue}%`;
  return `${verb} ${amount} of ${displayTicker(params.symbol)} if price ${move} ${level}`;
}

function StrategyCard({ strategy: s, address, busy, onTransition }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const isDeltaNeutral = s.type === "delta_neutral";
  const isSliceExec = s.type === "twap" || s.type === "vwap";
  const isTrigger = s.type === "trigger";
  const schedule = !isDeltaNeutral && !isSliceExec && !isTrigger && s.status === "active" ? projectSchedule(s) : null;
  const totalSlices = isSliceExec ? sliceCount(s.params.durationHours) : null;
  const filledSlices = isSliceExec ? (s.state?.filledSlices || 0) : null;
  const fills = isSliceExec ? (s.state?.fills || []) : [];
  const avgFill = avgFillPrice(fills);
  const startPrice = s.params.startPrice;
  const pctVsLumpSum = avgFill != null && startPrice ? ((startPrice - avgFill) / startPrice) * 100 : null;

  return (
    <div className="lvp-card agents-strategy-card" style={{ marginBottom: 16 }}>
      <div className="card-toprow">
        <div>
          {isDeltaNeutral ? (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {fmtUsd(s.params.notionalUsd)} delta-neutral {displayTicker(s.params.symbol)} at {s.params.leverage}x
            </p>
          ) : isSliceExec ? (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {fmtUsd(s.params.totalUsd)} {s.type.toUpperCase()} into {displayTicker(s.params.symbol)} over {s.params.durationHours}h
            </p>
          ) : isTrigger ? (
            <p style={{ margin: 0, fontWeight: 600 }}>{triggerDescription(s.params)}</p>
          ) : (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {fmtUsd(s.params.usdPerInterval)} of {displayTicker(s.params.symbol)} {formatInterval(s.params.intervalDays)}
            </p>
          )}
          <p className="lvp-muted tiny" style={{ margin: "2px 0 0" }}>
            <span className={`strategy-status strategy-status-${s.status}`}>{s.status}</span>
            {!isDeltaNeutral && !isSliceExec && !isTrigger && s.state?.lastExecutedAt && ` · last bought ${new Date(s.state.lastExecutedAt).toLocaleDateString()}`}
            {isDeltaNeutral && (s.state?.openedAt ? ` · opened ${new Date(s.state.openedAt).toLocaleDateString()}` : " · not yet opened")}
            {isSliceExec && ` · ${filledSlices}/${totalSlices} slices filled`}
            {isTrigger && s.status === "active" && " · watching live price"}
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

      {isSliceExec && avgFill != null && (
        <div className="agents-schedule-row">
          <span className="tiny muted">Execution quality</span>
          <p className="tiny" style={{ margin: 0 }}>
            Avg fill <strong className="mono">${avgFill.toFixed(2)}</strong>
            {startPrice != null && pctVsLumpSum != null && (
              <>
                {" "}vs <strong className="mono">${startPrice.toFixed(2)}</strong> lump-sum reference (
                <span className={pctVsLumpSum >= 0 ? "gain" : "loss"}>{pctVsLumpSum >= 0 ? "+" : ""}{pctVsLumpSum.toFixed(2)}%</span>)
              </>
            )}
          </p>
        </div>
      )}

      <div className="agents-history-section">
        <button type="button" className="agents-history-toggle" onClick={() => setHistoryOpen((o) => !o)}>
          <span className="tiny muted">History</span>
          <svg className={`hist-chevron ${historyOpen ? "open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {historyOpen && <StrategyHistory strategyId={s.id} address={address} />}
      </div>
    </div>
  );
}

/**
 * Strategy Agents. Every strategy type — DCA, delta-neutral, TWAP, VWAP —
 * is created through the same plain-English prompt bar; /api/parse-strategy
 * identifies which one a request describes and extracts its params (never
 * freeform LLM-authored trade logic — every type's real bounds are
 * re-validated server-side afterward via STRATEGY_TYPES[type].validateParams,
 * the same check the direct API path uses). A server-side evaluator checks
 * each active strategy on a schedule and, when due, writes a pending
 * proposal here for the user to review and confirm with their own wallet —
 * never signed or executed automatically, for any type. Owns its own fetch/
 * refresh state, same shape as MarketsExplorer.jsx — TradingAgentApp.jsx
 * (the page shell) just provides the surrounding chrome.
 */
export default function StrategiesPanel({ address, signWithWallet, evmAddress, hlCtx }) {
  const [strategies, setStrategies] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  // DCA's multi-plan case is sequential, not Promise.all — the server
  // enforces MAX_ACTIVE_STRATEGIES_PER_WALLET by counting existing active
  // strategies at request time, so creating a batch in parallel could race
  // that check (several requests all seeing the same "count so far" and
  // all succeeding past the real cap). Sequential keeps each check
  // accurate as the previous create lands. The other three types are
  // always a single strategy, so there's nothing to sequence.
  const confirmCreate = async () => {
    if (!parsed || !address || creating) return;
    setCreating(true);
    setError("");
    try {
      if (parsed.type === "dca") {
        const failures = [];
        for (const plan of parsed.plans) {
          try {
            await api.createStrategy({
              walletAddress: address,
              type: "dca",
              params: { symbol: plan.symbol, usdPerInterval: plan.usdPerInterval, intervalDays: plan.intervalDays },
            });
          } catch (e) {
            failures.push(`${displayTicker(plan.symbol)}: ${e.message}`);
          }
        }
        if (failures.length > 0) {
          setError(`Created ${parsed.plans.length - failures.length} of ${parsed.plans.length}. ${failures.join("; ")}`);
        }
      } else if (parsed.type === "delta_neutral") {
        if (!evmAddress) throw new Error("Connect a Hyperliquid-linked wallet first (open the Perps tab once to set it up).");
        await api.createStrategy({
          walletAddress: address, evmAddress, type: "delta_neutral",
          params: {
            symbol: parsed.symbol, notionalUsd: parsed.notionalUsd, leverage: parsed.leverage,
            rebalanceThresholdPct: parsed.rebalanceThresholdPct, unfavorableFundingExitHours: parsed.unfavorableFundingExitHours,
          },
        });
      } else if (parsed.type === "twap" || parsed.type === "vwap") {
        await api.createStrategy({
          walletAddress: address, type: parsed.type,
          params: { symbol: parsed.symbol, totalUsd: parsed.totalUsd, durationHours: parsed.durationHours },
        });
      } else if (parsed.type === "trigger") {
        await api.createStrategy({
          walletAddress: address, type: "trigger",
          params: {
            symbol: parsed.symbol, side: parsed.side, direction: parsed.direction,
            thresholdType: parsed.thresholdType, thresholdValue: parsed.thresholdValue,
            sellAll: parsed.sellAll, usd: parsed.usd,
          },
        });
      }
      setParsed(null); setPrompt("");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
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
        <p className="table-card-title" style={{ marginBottom: 12 }}>New Strategy</p>
        <p className="lvp-muted" style={{ marginTop: -6, marginBottom: 14 }}>
          Describe what you want — a recurring buy (DCA), a market-neutral funding harvest (delta-neutral),
          a large order split over time to reduce market impact (TWAP/VWAP), or a conditional order that
          fires when price crosses a level (stop-loss, take-profit, buy the dip).
        </p>
        <div className="prompt-wrap row">
          <input className="prompt-box oneline"
            placeholder={'"DCA $50 into bitcoin every week" · "TWAP $10,000 into AAPL over 4 hours" · "sell my BTC if it drops below $80,000"'}
            value={prompt} onChange={(e) => { setPrompt(e.target.value); setParsed(null); }}
            onKeyDown={(e) => e.key === "Enter" && runParse()} />
          <button className="btn primary" disabled={!prompt.trim() || parsing} onClick={runParse}>
            {parsing ? "Thinking…" : "Go"}
          </button>
        </div>

        {parsed && (
          <div className="agents-parsed-preview">
            <p style={{ margin: 0 }}>
              {parsed.type === "dca" && parsed.plans.length === 1
                ? `${fmtUsd(parsed.plans[0].usdPerInterval)} of ${parsed.plans[0].name} (${displayTicker(parsed.plans[0].symbol)}) ${formatInterval(parsed.plans[0].intervalDays)}`
                : parsed.summary}
            </p>
            {parsed.type === "dca" && parsed.plans.length > 1 && (
              <div className="agents-schedule-dates" style={{ marginTop: 8 }}>
                {parsed.plans.map((p) => <span key={p.symbol} className="agents-schedule-chip">{displayTicker(p.symbol)}</span>)}
              </div>
            )}
            <div className="wfoot" style={{ marginTop: 10 }}>
              <button className="btn ghost" disabled={creating} onClick={() => setParsed(null)}>Never mind</button>
              <button className="btn primary" disabled={creating} onClick={confirmCreate}>
                {creating
                  ? "Creating…"
                  : parsed.type === "dca" && parsed.plans.length > 1
                    ? `Looks good, create ${parsed.plans.length} strategies`
                    : "Looks good, create it"}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <p className="lvp-muted">Loading…</p>
      ) : strategies.filter((s) => s.status !== "cancelled").length === 0 ? (
        <p className="lvp-muted">No strategies yet — create one above to get started.</p>
      ) : (
        strategies
          .filter((s) => s.status !== "cancelled")
          .map((s) => (
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
