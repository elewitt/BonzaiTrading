import { useEffect, useRef, useState } from "react";
import { MIN_WITHDRAW_USDC } from "./funding/withdraw.js";

const stepCopy = {
  INIT: "Preparing withdrawal",
  AWAITING_ARB_ARRIVAL: "Waiting on Hyperliquid — funds are on the way",
  READY_TO_BRIDGE: "Ready to bring funds back to Solana",
  AWAITING_SOL_CREDIT: "Bridging back to your Bonzai Trading balance",
  DONE: "Withdrawal complete",
  FAILED: "Withdrawal didn't complete",
};

export function WithdrawWizard({ orchestrator, user, withdrawable = 0, onWithdrawn }) {
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const amt = Number(amount);
  const valid = amt >= MIN_WITHDRAW_USDC && amt <= withdrawable;

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
        setQuote(await orchestrator.quote(amt, user));
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

  const begin = async () => {
    if (!quote) return;
    const id = `wd_${user.evm.slice(2, 10)}_${Date.now()}`;
    const s = await orchestrator.start(id, amt, user);
    setState(s);
  };

  const handleInitiate = async () => {
    setBusy(true);
    try {
      const next = await orchestrator.initiateWithdraw(state);
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
    return (
      <div className="lvp-card" role="status" aria-live="polite">
        <div className={`lvp-progress ${done ? "done" : failed ? "failed" : ""}`}>
          <span className="lvp-dot" aria-hidden="true" />
          <span className="lvp-progress-label">{stepCopy[state.step]}</span>
        </div>

        {failed && (
          <>
            <p className="lvp-muted">{state.error}</p>
            <button className="lvp-btn" onClick={() => setState(null)}>Start over</button>
          </>
        )}

        {state.step === "INIT" && (
          <>
            <p className="lvp-muted" style={{ marginTop: 10 }}>
              First step needs your signature — Hyperliquid will send ${state.amountUsdc} (minus its $1 fee) to your
              Arbitrum address. This can take a few minutes to land.
            </p>
            <button className="lvp-btn primary" disabled={busy} onClick={handleInitiate}>
              {busy ? "Waiting for your signature…" : "Withdraw from Hyperliquid"}
            </button>
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
              Your cash has landed on Arbitrum. This next step needs a second signature to bridge it back to Solana.
            </p>
            {state.legs?.bridgeError && <p className="lvp-error" style={{ marginTop: 6 }}>{state.legs.bridgeError}</p>}
            <button className="lvp-btn primary" disabled={busy} onClick={handleBridge}>
              {busy ? "Waiting for your signature…" : "Bridge to Solana"}
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
        <span>Available: ${withdrawable.toFixed(2)}</span>
        <div className="lvp-input-wrap">
          <input
            inputMode="decimal"
            value={amount}
            placeholder={String(MIN_WITHDRAW_USDC)}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== "" && !valid}
          />
          <button className="lvp-max" onClick={() => setAmount(withdrawable.toFixed(2))}>
            Max {withdrawable.toFixed(2)}
          </button>
        </div>
      </div>

      {amount !== "" && amt < MIN_WITHDRAW_USDC && (
        <p className="lvp-error">Minimum withdrawal is ${MIN_WITHDRAW_USDC}.</p>
      )}
      {amount !== "" && amt > withdrawable && (
        <p className="lvp-error">Exceeds your available balance of ${withdrawable.toFixed(2)}.</p>
      )}
      {error && <p className="lvp-error">{error}</p>}

      {quote && (
        <div className="lvp-order-summary">
          <div className="lvp-row"><span className="lvp-muted">You'll receive</span><span>≈ ${quote.usdcOut.toFixed(2)}</span></div>
          <div className="lvp-row"><span className="lvp-muted">Total fees</span><span>${(1 + quote.feeUsd).toFixed(2)} (incl. Hyperliquid's $1)</span></div>
          <div className="lvp-row"><span className="lvp-muted">Time</span><span>~5 min + {Math.round(quote.etaSeconds / 60) || "<1"} min</span></div>
        </div>
      )}

      <button className="lvp-btn primary" disabled={!quote} onClick={begin}>
        {quote ? `Withdraw $${amt}` : "Enter an amount"}
      </button>
      <p className="lvp-fine">
        Two signatures, a few minutes apart. Funds return to your own Solana wallet — Bonzai Trading is never the custodian.
      </p>
    </div>
  );
}
