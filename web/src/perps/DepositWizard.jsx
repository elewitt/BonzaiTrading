import { useEffect, useRef, useState } from "react";

const railLabel = { debridge_usdc: "Fast route" };

// deBridge's bridge transaction itself needs a small amount of SOL beyond
// the deposit amount — confirmed via a real failed transaction: "Transfer:
// insufficient lamports 1866920, need 2039280" (≈0.00204 SOL), almost
// certainly rent for an account the bridge tx creates. This applies even
// though the deposit itself is priced in Cash (USDC) — the transaction fee
// + that rent are always paid in SOL. 0.003 gives a small safety margin
// over the observed exact requirement.
const SOL_RESERVE = 0.003;

const stepCopy = {
  QUOTING: "Pricing your deposit",
  BRIDGING: "Moving funds to your trading account",
  AWAITING_HL_CREDIT: "Waiting for confirmation",
  DONE: "Funds ready to trade",
  FAILED: "Deposit didn't complete",
};

export function DepositWizard({ orchestrator, user, walletSolBalance, walletUsdcBalance = 0, onFunded }) {
  const [amount, setAmount] = useState("");
  const [quotes, setQuotes] = useState(null);
  const [selected, setSelected] = useState(0);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const rail = "debridge_usdc";
  const amt = Number(amount);
  const hasGasReserve = walletSolBalance >= SOL_RESERVE;
  const valid = amt > 0 && amt <= walletUsdcBalance && hasGasReserve;

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

  useEffect(() => {
    if (!valid) { setQuotes(null); return; }
    const t = setTimeout(async () => {
      try {
        setQuotes(await orchestrator.quote(amt, user, rail));
        setSelected(0);
        setError(null);
      } catch (e) {
        setQuotes(null);
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
    if (!quotes) return;
    const id = `dep_${user.evm.slice(2, 10)}_${Date.now()}`;
    const s = await orchestrator.start(id, rail, amt, user);
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
    return (
      <div className="lvp-card" role="status" aria-live="polite">
        <div className={`lvp-progress ${done ? "done" : failed ? "failed" : ""}`}>
          <span className="lvp-dot" aria-hidden="true" />
          <span className="lvp-progress-label">{readyForHlDeposit ? "Ready to finish — one more signature" : stepCopy[state.step]}</span>
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
              Your funds have arrived and gas is ready. This last step needs your signature — it won't happen automatically.
            </p>
            <button className="lvp-btn primary" disabled={completing} onClick={handleComplete}>
              {completing ? "Waiting for your signature…" : "Complete Deposit"}
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

      {quotes && (
        <div className="lvp-quotes" role="radiogroup" aria-label="Deposit route">
          {quotes.map((q, i) => (
            <button
              key={q.rail}
              role="radio"
              aria-checked={i === selected}
              className={`lvp-quote ${i === selected ? "sel" : ""}`}
              onClick={() => setSelected(i)}
            >
              <span className="lvp-quote-name">{railLabel[q.rail] ?? q.rail}</span>
              <span className="lvp-quote-out">≈ ${q.estimatedUsdcOut.toFixed(2)} Cash</span>
              <span className="lvp-muted">
                ~{Math.round(q.estimatedSeconds / 60) || "<1"} min · ${q.feeUsd.toFixed(2)} fee
              </span>
            </button>
          ))}
        </div>
      )}

      <button className="lvp-btn primary" disabled={!quotes} onClick={begin}>
        {quotes ? `Deposit $${amt} Cash` : "Enter an amount"}
      </button>
      <p className="lvp-fine">
        One signature. Funds settle as cash collateral in your self-custody trading account.
      </p>
    </div>
  );
}
