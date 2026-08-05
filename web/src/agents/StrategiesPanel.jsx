import { useCallback, useEffect, useMemo, useState } from "react";
import { api, executeStrategyProposal } from "../lib/api.js";

const INTERVAL_PRESETS = [
  { days: 1, label: "Daily" },
  { days: 7, label: "Weekly" },
  { days: 14, label: "Every 2 weeks" },
  { days: 30, label: "Monthly" },
];

function fmtUsd(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Strategy Agents (Phase A — DCA only). A user defines a persistent, named
 * strategy once; a server-side evaluator checks it on a schedule and, when
 * it's due, writes a pending proposal here for the user to review and
 * confirm with their own wallet — never signed or executed automatically.
 * Owns its own fetch/refresh/modal state, same shape as MarketsExplorer.jsx —
 * TradingAgentApp.jsx (the page shell) just provides the surrounding chrome.
 */
export default function StrategiesPanel({ registry, address, signWithWallet }) {
  const [strategies, setStrategies] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [symbol, setSymbol] = useState("");
  const [usdPerInterval, setUsdPerInterval] = useState("");
  const [intervalDays, setIntervalDays] = useState(7);
  const [creating, setCreating] = useState(false);

  const [busyStrategyId, setBusyStrategyId] = useState(null);
  const [confirmProposal, setConfirmProposal] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(null);

  const assetOptions = useMemo(
    () => Object.values(registry || {}).filter((t) => t.symbol !== "USDC").sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [registry],
  );

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

  const createStrategy = async (e) => {
    e.preventDefault();
    if (!address || creating) return;
    setError("");
    const usd = Number(usdPerInterval);
    if (!symbol.trim()) return setError("Pick an asset to DCA into.");
    if (!Number.isFinite(usd) || usd <= 0) return setError("Enter a valid dollar amount.");
    setCreating(true);
    try {
      await api.createStrategy({
        walletAddress: address,
        type: "dca",
        params: { symbol: symbol.trim(), usdPerInterval: usd, intervalDays: Number(intervalDays) },
      });
      setSymbol(""); setUsdPerInterval("");
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
        proposalId: confirmProposal.id, taker: address, signWithWallet,
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

      <div className="agents-layout">
        <div className="lvp-card">
          <p className="table-card-title" style={{ marginBottom: 12 }}>New DCA Strategy</p>
          <p className="lvp-muted" style={{ marginTop: -6, marginBottom: 14 }}>
            Buy a fixed dollar amount of an asset on a recurring schedule. You'll review and confirm every buy yourself — nothing executes automatically.
          </p>
          <form onSubmit={createStrategy}>
            <div className="borrow-field">
              <span className="tiny muted">Asset</span>
              <input className="perps-asset-search" list="strategy-asset-options" placeholder="e.g. AAPLx, BTC, SPYx"
                value={symbol} onChange={(e) => setSymbol(e.target.value)} />
              <datalist id="strategy-asset-options">
                {assetOptions.map((t) => <option key={t.symbol} value={t.symbol}>{t.name}</option>)}
              </datalist>
            </div>
            <div className="borrow-field">
              <span className="tiny muted">Amount per buy</span>
              <input className="perps-asset-search" type="number" min="1" step="any" placeholder="$50"
                value={usdPerInterval} onChange={(e) => setUsdPerInterval(e.target.value)} />
            </div>
            <div className="borrow-field">
              <span className="tiny muted">Frequency</span>
              <div className="strategy-freq-picker">
                {INTERVAL_PRESETS.map((p) => (
                  <button type="button" key={p.days} className={`lvp-pct-btn ${intervalDays === p.days ? "sel" : ""}`}
                    onClick={() => setIntervalDays(p.days)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="wfoot" style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create strategy"}
              </button>
            </div>
          </form>
        </div>

        <div className="lvp-card agents-strategies-card">
          <p className="table-card-title" style={{ marginBottom: 12 }}>Your Strategies</p>
          {loading ? (
            <p className="lvp-muted agents-empty-state">Loading…</p>
          ) : strategies.length === 0 ? (
            <p className="lvp-muted agents-empty-state">No strategies yet — create your first one to the left.</p>
          ) : (
            strategies.map((s) => (
              <div key={s.id} className="strategy-row">
                <div>
                  <p style={{ margin: 0 }}>
                    DCA · {fmtUsd(s.params.usdPerInterval)} of {s.params.symbol} every{" "}
                    {INTERVAL_PRESETS.find((p) => p.days === s.params.intervalDays)?.label.toLowerCase() ?? `${s.params.intervalDays}d`}
                  </p>
                  <p className="lvp-muted" style={{ margin: 0 }}>
                    <span className={`strategy-status strategy-status-${s.status}`}>{s.status}</span>
                    {s.state?.lastExecutedAt && ` · last executed ${new Date(s.state.lastExecutedAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="strategy-row-actions">
                  {s.status === "active" && (
                    <button className="btn ghost" disabled={busyStrategyId === s.id} onClick={() => transition(s.id, "pause")}>Pause</button>
                  )}
                  {s.status === "paused" && (
                    <button className="btn ghost" disabled={busyStrategyId === s.id} onClick={() => transition(s.id, "resume")}>Resume</button>
                  )}
                  {(s.status === "active" || s.status === "paused") && (
                    <button className="btn ghost" disabled={busyStrategyId === s.id} onClick={() => transition(s.id, "cancel")}>Cancel</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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
