import { useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getArbUsdcBalanceAtoms } from "./funding/arbitrumHlDeposit.js";
import { API_BASE } from "../lib/api.js";

// The deposit burn transaction needs a small amount of SOL beyond the
// deposit amount for account-creation rent + the tx fee — this applies even
// though the deposit itself is priced in Cash (USDC), since Solana fees are
// always paid in SOL. The exact requirement is rail-specific (each creates
// a differently-sized account): deBridge's was confirmed at ≈0.00204 SOL
// ("Transfer: insufficient lamports 1866920, need 2039280"); CCTP's
// SendMessage account is bigger and needs more — confirmed via a real
// failed deposit at exactly this 0.003 threshold: "Transfer: insufficient
// lamports 2990000, need 3869760" (≈0.00387 SOL). 0.005 gives real margin
// above CCTP's actual number, the rail this always uses now.
const SOL_RESERVE = 0.005;

// CCTP only — Circle's native burn-and-mint has no solver margin the way
// deBridge's DLN does, so it's always equal-or-cheaper. deBridge's
// DeBridgeProvider/RealDeBridgeIo are still registered in PerpsApp.jsx's
// orchestrator (not deleted — a working, tested fallback worth keeping
// available), just no longer offered as a user-facing choice here.
const RAIL = "cctp_usdc";

const stepCopy = {
  QUOTING: "Moving your funds",
  BRIDGING: "Moving your funds",
  AWAITING_HL_CREDIT: "Moving your funds",
  DONE: "Funds ready to trade",
  FAILED: "Deposit didn't complete",
};

export function DepositWizard({ orchestrator, user, walletSolBalance, walletUsdcBalance = 0, rpcUrl, onFunded }) {
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const amt = Number(amount);
  // Prefer a freshly-fetched balance over the walletSolBalance prop once
  // available — that prop comes from the parent's own balance polling,
  // which can be several seconds behind a sponsor top-up just triggered
  // below and would otherwise show "not enough SOL" for a while after it's
  // no longer true. Falls back to the prop before the first check resolves.
  const [freshSolBalance, setFreshSolBalance] = useState(null);
  const effectiveSolBalance = freshSolBalance ?? walletSolBalance;
  const hasGasReserve = effectiveSolBalance >= SOL_RESERVE;
  const valid = amt > 0 && amt <= walletUsdcBalance && hasGasReserve;

  // Proactively top up the small amount of SOL the CCTP burn tx's account
  // creation needs — confirmed as a real customer-facing block: a wallet
  // holding real USDC to deposit was refused with "you need at least 0.003
  // SOL" with no way to fix it from inside the flow. Mirrors checkHlReady's
  // pattern for the Arbitrum side (ask the sponsor first, then check the
  // real balance) rather than just surfacing the raw shortfall.
  useEffect(() => {
    if (!user?.solana || !rpcUrl) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch(`${API_BASE}/api/perps/solana-gas`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: user.solana }),
        }).catch(() => {});
        const connection = new Connection(rpcUrl, "confirmed");
        const lamports = await connection.getBalance(new PublicKey(user.solana));
        if (!cancelled) setFreshSolBalance(lamports / 1e9);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.solana, rpcUrl]);

  // Restore any pending (not DONE/FAILED) deposit for this user from
  // localStorage on mount — without this, a page reload during
  // AWAITING_HL_CREDIT silently orphans the in-progress deposit: the wizard
  // just shows a blank "enter amount" form again with no indication a
  // previous deposit is still pending and nothing actively resuming it,
  // even though the actual funds/state are still sitting there recoverable.
  //
  // Rank by pipeline progress, NOT recency — confirmed against a real case
  // where a fresh, repeatedly-failing "BRIDGING" attempt (never got far
  // enough to create a real order, kept retrying and updating its
  // timestamp) was being restored over an older AWAITING_HL_CREDIT entry
  // that had already bridged real funds and just needed the final step.
  // A real bridge order (legs.bridgeTxId set) means funds may genuinely be
  // in flight or delivered — that always outranks an attempt that never
  // got that far, regardless of which one was touched more recently.
  useEffect(() => {
    if (!user?.evm || state) return;
    const prefix = `lv_dep_dep_${user.evm.slice(2, 10)}_`;
    const STEP_RANK = { QUOTING: 0, BRIDGING: 1, AWAITING_HL_CREDIT: 2 };
    let latest = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const s = JSON.parse(localStorage.getItem(key));
        if (!s || s.step === "DONE" || s.step === "FAILED") continue;
        const hasRealOrder = !!s.legs?.bridgeTxId;
        const rank = (hasRealOrder ? 100 : 0) + (STEP_RANK[s.step] ?? 0);
        const latestHasRealOrder = !!latest?.legs?.bridgeTxId;
        const latestRank = latest ? (latestHasRealOrder ? 100 : 0) + (STEP_RANK[latest.step] ?? 0) : -1;
        if (rank > latestRank || (rank === latestRank && s.updatedAt > latest.updatedAt)) latest = s;
      } catch {}
    }
    if (latest) setState(latest);
  }, [user, state]);

  // Separate from the restore effect above — that one only recovers a
  // deposit the WIZARD itself has a localStorage record of. Real USDC can
  // land on a wallet's Arbitrum address through a path this wizard never
  // tracked at all (confirmed against a real case: an admin-triggered
  // Hyperliquid withdrawal delivered funds straight to a customer's
  // Arbitrum address with no bridge state ever created for it) — those
  // funds are stuck invisibly with no prompt to finish moving them into
  // the trading account, since completeHlDeposit() only ever gets called
  // from a click inside an active wizard state. Checking the real on-chain
  // balance directly here, independent of any tracked state, catches that.
  const [orphanedUsd, setOrphanedUsd] = useState(null);
  useEffect(() => {
    if (!user?.evm || state) return;
    let cancelled = false;
    getArbUsdcBalanceAtoms(user.evm)
      .then((atoms) => {
        if (cancelled) return;
        const usd = Number(atoms) / 1e6;
        setOrphanedUsd(usd >= 1 ? usd : null); // ignore dust below $1
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user, state]);

  const [sweeping, setSweeping] = useState(false);
  const handleSweep = async () => {
    setSweeping(true);
    try {
      const synthetic = {
        id: `sweep_${user.evm.slice(2, 10)}_${Date.now()}`,
        rail: RAIL, user, legs: { readyForHlDeposit: true }, step: "AWAITING_HL_CREDIT", updatedAt: Date.now(),
      };
      const next = await orchestrator.completeDeposit(synthetic);
      if (next.step === "DONE") {
        setOrphanedUsd(null);
        onFunded?.();
      } else {
        setState(next); // surfaces any hlDepositError (e.g. needs gas) via the normal in-progress view
      }
    } finally {
      setSweeping(false);
    }
  };

  useEffect(() => {
    if (!valid) { setQuote(null); return; }
    const t = setTimeout(async () => {
      try {
        const quotes = await orchestrator.quote(amt, user, RAIL);
        setQuote(quotes[0]);
        setError(null);
      } catch (e) {
        setQuote(null);
        setError(e instanceof Error ? e.message : "Couldn't price this deposit");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [amt, valid, orchestrator, user]);

  // Refs, not direct closure vars, for the interval body — the same class
  // of bug confirmed against a real stuck withdrawal in WithdrawWizard.jsx:
  // `orchestrator` can get a new identity on every parent re-render (Privy
  // hook values feeding its useMemo aren't guaranteed referentially
  // stable), which tore this interval down and recreated it before it ever
  // completed a full cycle. Reading through refs survives that churn.
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onFundedRef = useRef(onFunded);
  onFundedRef.current = onFunded;

  useEffect(() => {
    if (!state || state.step === "DONE" || state.step === "FAILED") return;
    const h = setInterval(async () => {
      const next = await orchestratorRef.current.resume(stateRef.current);
      setState(next);
      if (next.step === "DONE") onFundedRef.current?.();
    }, 3000);
    return () => clearInterval(h);
  }, [state?.step, state?.id]);

  const [completing, setCompleting] = useState(false);

  const begin = async () => {
    if (!quote) return;
    const id = `dep_${user.evm.slice(2, 10)}_${Date.now()}`;
    const s = await orchestrator.start(id, RAIL, amt, user);
    setState(s);
    if (s.step === "DONE") onFunded?.();
  };

  // Must be triggered by a real click, not a background poll — Privy's
  // embedded-wallet signing is unreliable when not invoked from a genuine
  // user gesture (confirmed against a real deposit that had gas ready but
  // never completed while this was attempted from a setInterval poll).
  const handleComplete = async () => {
    setCompleting(true);
    try {
      const next = await orchestrator.completeDeposit(state);
      setState(next);
      if (next.step === "DONE") onFunded?.();
    } finally {
      setCompleting(false);
    }
  };

  if (state) {
    const done = state.step === "DONE";
    const failed = state.step === "FAILED";
    const readyForHlDeposit = !done && !failed && state.legs?.readyForHlDeposit;
    // Two real signatures total: this bridge tx, then the final HL credit.
    // Framed as a fixed, finite count rather than an open-ended status line
    // so a wait reads as "almost done", not "how much longer is this".
    const stepNum = readyForHlDeposit || done ? 2 : 1;
    return (
      <div className="lvp-card" role="status" aria-live="polite">
        <div className={`lvp-progress ${done ? "done" : failed ? "failed" : ""}`}>
          <span className="lvp-dot" aria-hidden="true" />
          <span className="lvp-progress-label">
            {!failed && <span className="lvp-step-count">Step {stepNum} of 2 · </span>}
            {readyForHlDeposit ? "Ready to finish" : stepCopy[state.step]}
          </span>
        </div>
        {failed && (
          <>
            <p className="lvp-muted">{state.error}</p>
            <button className="lvp-btn" onClick={() => setState(null)}>Start over</button>
          </>
        )}
        {!done && !failed && state.legs?.hlDepositError && (
          <p className={state.legs.needsArbGas ? "lvp-error" : "lvp-muted"} style={{ marginTop: 10 }}>
            {state.legs.hlDepositError}
          </p>
        )}
        {readyForHlDeposit && (
          <>
            <p className="lvp-muted" style={{ marginTop: 10 }}>
              Your funds have arrived. This last step needs your confirmation.
            </p>
            <button className="lvp-btn primary" disabled={completing} onClick={handleComplete}>
              {completing ? "Confirming…" : "Complete Deposit"}
            </button>
          </>
        )}
        {done && (
          <p className="lvp-muted" style={{ marginTop: 10 }}>
            Your cash collateral is live. Use the trade panel to open a position.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="lvp-card">
      {orphanedUsd != null && (
        <div className="lvp-order-summary" style={{ marginBottom: 14 }}>
          <p className="lvp-muted" style={{ marginTop: 0 }}>
            ${orphanedUsd.toFixed(2)} is sitting on Arbitrum but hasn't been moved into your trading account yet.
          </p>
          <button className="lvp-btn primary" disabled={sweeping} onClick={handleSweep}>
            {sweeping ? "Confirming…" : `Finish depositing $${orphanedUsd.toFixed(2)}`}
          </button>
        </div>
      )}
      <h3>Add trading funds</h3>

      <div className="lvp-field">
        <span>Available: ${walletUsdcBalance.toFixed(2)}</span>
        <div className="lvp-input-wrap">
          <input
            inputMode="decimal"
            value={amount}
            placeholder="5"
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== "" && !valid}
          />
          <button className="lvp-max" onClick={() => setAmount(String(walletUsdcBalance))}>
            Max {walletUsdcBalance.toFixed(2)}
          </button>
        </div>
      </div>

      {!hasGasReserve && (
        <p className="lvp-error">
          You need at least {SOL_RESERVE} SOL in your wallet to cover the bridge transaction's network fees.
        </p>
      )}

      {error && <p className="lvp-error">{error}</p>}

      {quote && (
        <div className="lvp-order-summary">
          <div className="lvp-row"><span className="lvp-muted">You'll receive</span><span>≈ ${quote.estimatedUsdcOut.toFixed(2)} Cash</span></div>
          <div className="lvp-row"><span className="lvp-muted">Time</span><span>~{Math.round(quote.estimatedSeconds / 60) || "<1"} min</span></div>
        </div>
      )}

      <button className="lvp-btn primary" disabled={!quote} onClick={begin}>
        {quote ? `Deposit $${amt} Cash` : "Enter an amount"}
      </button>
      <p className="lvp-fine">
        Two confirmations, a minute or two apart. Funds settle as cash collateral in your self-custody trading account.
      </p>
    </div>
  );
}
