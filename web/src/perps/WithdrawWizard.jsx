import { useEffect, useRef, useState } from "react";
import { MIN_WITHDRAW_USDC } from "./funding/withdraw.js";

// CCTP only — see DepositWizard.jsx's identical note. deBridge's return-leg
// code is still registered in withdraw.js (not deleted, a working tested
// fallback), just no longer offered as a user-facing choice.
const RAIL = "cctp";

const stepCopy = {
  AWAITING_ARB_ARRIVAL: "Withdrawing from Hyperliquid",
  READY_TO_BRIDGE: "Withdrawing from Hyperliquid",
  AWAITING_SOL_CREDIT: "Bridging to your wallet",
  DONE: "Withdrawal complete",
  FAILED: "Withdrawal didn't complete",
};

export function WithdrawWizard({ orchestrator, user, withdrawable = 0, onWithdrawn, initialAmount }) {
  const [amount, setAmount] = useState(() => (initialAmount != null ? String(initialAmount) : ""));
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const amt = Number(amount);
  // Floor (not round) to cents for anything shown/settable in the UI —
  // withdrawable is a raw float (e.g. 5.5361), and .toFixed(2) rounding it
  // up to "5.54" for display + the Max button meant clicking Max produced
  // an amount that failed its own "exceeds available balance" check against
  // the un-rounded value. Flooring guarantees the displayed number is never
  // more than what's actually there.
  const withdrawableDisplay = Math.floor(withdrawable * 100) / 100;
  const valid = amt >= MIN_WITHDRAW_USDC && amt <= withdrawableDisplay;

  // Restore any pending (not DONE/FAILED) withdrawal for this user on mount
  // — same reasoning as DepositWizard's restore effect: a reload mid-flow
  // shouldn't orphan a withdrawal that's already signed and in transit.
  useEffect(() => {
    if (!user?.evm || state) return;
    const prefix = `lv_wd_wd_${user.evm.slice(2, 10)}_`;
    const STEP_RANK = { INIT: 0, AWAITING_ARB_ARRIVAL: 1, READY_TO_BRIDGE: 2, AWAITING_SOL_CREDIT: 3 };
    let latest = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const s = JSON.parse(localStorage.getItem(key));
        if (!s || s.step === "DONE" || s.step === "FAILED") continue;
        const rank = STEP_RANK[s.step] ?? 0;
        const latestRank = latest ? (STEP_RANK[latest.step] ?? 0) : -1;
        if (rank > latestRank || (rank === latestRank && s.updatedAt > latest.updatedAt)) latest = s;
      } catch {}
    }
    if (latest) setState(latest);
  }, [user, state]);

  useEffect(() => {
    if (!valid) { setQuote(null); return; }
    const t = setTimeout(async () => {
      try {
        const quotes = await orchestrator.quote(amt, user, RAIL);
        setQuote(quotes[0]);
        setError(null);
      } catch (e) {
        setQuote(null);
        setError(e instanceof Error ? e.message : "Couldn't price this withdrawal");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [amt, valid, orchestrator, user]);

  // Polling only ever checks readiness (Arbitrum arrival, bridge order
  // fulfillment) — it never signs anything itself. Both real signatures
  // (initiateWithdraw, completeBridgeToSolana) only ever fire from a direct
  // click below, same rule established for deposits.
  //
  // Refs, not direct closure vars, for the interval body — confirmed as a
  // real bug against a real stuck withdrawal: `orchestrator` (built in
  // PerpsApp.jsx from Privy hook values that aren't guaranteed referentially
  // stable) can get a new identity on every parent re-render, which happens
  // every ~4s from the balance-polling hooks upstream. Depending on it here
  // meant the interval was torn down and recreated before it ever completed
  // a full 5s cycle — it looked like polling was happening but never
  // actually fired once. Reading through refs means the interval survives
  // identity churn while still always seeing the latest orchestrator/state.
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onWithdrawnRef = useRef(onWithdrawn);
  onWithdrawnRef.current = onWithdrawn;

  useEffect(() => {
    if (!state || state.step === "DONE" || state.step === "FAILED") return;
    if (state.step !== "AWAITING_ARB_ARRIVAL" && state.step !== "AWAITING_SOL_CREDIT") return;
    const h = setInterval(async () => {
      const next = await orchestratorRef.current.advance(stateRef.current);
      setState(next);
      if (next.step === "DONE") onWithdrawnRef.current?.();
    }, 5000);
    return () => clearInterval(h);
  }, [state?.step, state?.id]);

  // Combines what used to be two separate screens/clicks into one: start()
  // only sets up local state (no real action), so there's no reason to make
  // the user click once for that and again to actually sign the withdrawal.
  const handleWithdraw = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const id = `wd_${user.evm.slice(2, 10)}_${Date.now()}`;
      const s = await orchestrator.start(id, amt, user, RAIL);
      const next = await orchestrator.initiateWithdraw(s);
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  const handleBridge = async () => {
    setBusy(true);
    try {
      const next = await orchestrator.completeBridgeToSolana(state);
      setState(next);
    } finally {
      setBusy(false);
    }
  };

  if (state) {
    const done = state.step === "DONE";
    const failed = state.step === "FAILED";
    // Two real signatures total: withdraw from Hyperliquid, then bridge
    // back to Solana. Framed as a fixed, finite count rather than an
    // open-ended status line — same reasoning as DepositWizard.jsx.
    const stepNum = state.step === "AWAITING_SOL_CREDIT" || done ? 2 : 1;
    return (
      <div className="lvp-card" role="status" aria-live="polite">
        <div className={`lvp-progress ${done ? "done" : failed ? "failed" : ""}`}>
          <span className="lvp-dot" aria-hidden="true" />
          <span className="lvp-progress-label">
            {!failed && <span className="lvp-step-count">Step {stepNum} of 2 · </span>}
            {stepCopy[state.step]}
          </span>
        </div>

        {failed && (
          <>
            <p className="lvp-muted">{state.error}</p>
            <button className="lvp-btn" onClick={() => setState(null)}>Start over</button>
          </>
        )}

        {state.step === "AWAITING_ARB_ARRIVAL" && (
          <p className="lvp-muted" style={{ marginTop: 10 }}>
            Usually takes about 5 minutes. This page checks automatically — feel free to leave and come back.
          </p>
        )}

        {state.step === "READY_TO_BRIDGE" && (
          <>
            <p className="lvp-muted" style={{ marginTop: 10 }}>
              Your cash has landed on Arbitrum. This next step needs one more confirmation to bridge it back to Solana.
            </p>
            {state.legs?.bridgeError && <p className="lvp-error" style={{ marginTop: 6 }}>{state.legs.bridgeError}</p>}
            <button className="lvp-btn primary" disabled={busy} onClick={handleBridge}>
              {busy ? "Confirming…" : "Bridge to Solana"}
            </button>
          </>
        )}

        {state.step === "AWAITING_SOL_CREDIT" && (
          <p className="lvp-muted" style={{ marginTop: 10 }}>
            Almost there — waiting for the bridge to deliver funds to your Solana wallet.
          </p>
        )}

        {done && (
          <p className="lvp-muted" style={{ marginTop: 10 }}>
            Your funds are back in your Bonzai Trading balance.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="lvp-card">
      <h3>Withdraw to your brokerage account</h3>

      <div className="lvp-field">
        <span>Available: ${withdrawableDisplay.toFixed(2)}</span>
        <div className="lvp-input-wrap">
          <input
            inputMode="decimal"
            value={amount}
            placeholder={String(MIN_WITHDRAW_USDC)}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== "" && !valid}
          />
          <button className="lvp-max" onClick={() => setAmount(withdrawableDisplay.toFixed(2))}>
            Max {withdrawableDisplay.toFixed(2)}
          </button>
        </div>
      </div>

      {amount !== "" && amt < MIN_WITHDRAW_USDC && (
        <p className="lvp-error">Minimum withdrawal is ${MIN_WITHDRAW_USDC}.</p>
      )}
      {amount !== "" && amt > withdrawableDisplay && (
        <p className="lvp-error">Exceeds your available balance of ${withdrawableDisplay.toFixed(2)}.</p>
      )}
      {error && <p className="lvp-error">{error}</p>}

      {quote && (
        <div className="lvp-order-summary">
          <div className="lvp-row"><span className="lvp-muted">You'll receive</span><span>≈ ${quote.usdcOut.toFixed(2)}</span></div>
          <div className="lvp-row"><span className="lvp-muted">Total fees</span><span>${(1 + quote.feeUsd).toFixed(2)} (incl. Hyperliquid's $1)</span></div>
          <div className="lvp-row"><span className="lvp-muted">Time</span><span>~5 min + {Math.round(quote.etaSeconds / 60) || "<1"} min</span></div>
        </div>
      )}

      <button className="lvp-btn primary" disabled={!quote || busy} onClick={handleWithdraw}>
        {busy ? "Confirming…" : quote ? `Withdraw $${amt}` : "Enter an amount"}
      </button>
      <p className="lvp-fine">
        Two confirmations, a few minutes apart. Funds return to your own Solana wallet — Bonzai Trading is never the custodian.
      </p>
    </div>
  );
}
