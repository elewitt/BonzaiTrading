import { useEffect, useMemo, useState } from "react";
import { useKaminoAction } from "./useKamino.js";
import { KAMINO_FEE_BPS } from "../lib/api.js";

// Kamino creates a new on-chain "Obligation" account the first time a wallet
// deposits into this market, PLUS a token account for the collateral mint —
// the real total requirement (confirmed via a real sponsored deposit's
// on-chain transaction) is ~0.0336 SOL, not just the ~0.0242 SOL the
// InitObligation step needs in isolation. Kept in sync with
// KAMINO_DEPOSIT_MIN_SOL in server/src/index.js. The server now
// auto-sponsors this (see ensureKaminoGas) for any wallet that genuinely
// holds the collateral it's depositing, so this is shown as a heads-up
// only, never a hard client-side block — whether sponsorship actually
// applies (budget, anti-abuse check) can only be known server-side.
const KAMINO_SOL_RESERVE = 0.042;

/**
 * Deposit one already-held xStock as collateral, then borrow USDC against
 * it — two separate signatures (Kamino's deposit and borrow are distinct
 * on-chain actions), same "two sequential signatures" shape already used
 * elsewhere in this app (e.g. the Bridge2 deposit flow). Scoped to one
 * collateral asset per position for now — Kamino's cross-margin behavior
 * for multiple different xStocks in one obligation isn't confirmed for
 * this specific market, so keep the liquidation math simple and verifiable.
 *
 * Also handles the "I already deposited, I just want to borrow" case
 * data-first: `positions` (the user's real, on-chain Kamino obligations)
 * decide the starting step, not local component state — so switching tabs,
 * leaving and coming back, or depositing without immediately borrowing
 * never strands the user back at a "deposit" screen when they already have
 * open, unused borrowing room.
 */
export default function BorrowTicket({ eligibleRows, reserves, wallet, signWithWallet, solBalance = 0, positions = [], positionsLoading = false, onDone }) {
  // Its own action instance — deposit/borrow here must never share busy/error
  // state with an unrelated repay/withdraw click elsewhere on the page (a
  // stuck signature here used to silently disable every other button too).
  const action = useKaminoAction(wallet, signWithWallet);
  const [selectedMint, setSelectedMint] = useState(eligibleRows[0]?.mint ?? null);
  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [quickBorrowAmount, setQuickBorrowAmount] = useState("");
  const [step, setStep] = useState("deposit"); // "deposit" | "borrow" | "quick-borrow" | "done"
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  // Unused borrowing room on whatever the user already has deposited in
  // this market, straight from Kamino's own obligation data — the
  // obligation-level maxLtv is already blended across every collateral
  // type in it, so this is correct even for a multi-asset position.
  const existingRoom = useMemo(() => {
    let loan = null, collateralValue = 0, debtValue = 0, maxLtv = 0;
    for (const l of positions) {
      const info = l.loanInfo ?? l;
      const cv = (info.collateral?.deposits ?? []).reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);
      const dv = (info.debt?.borrows ?? []).reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);
      const ltv = Number(info.maxLtv ?? 0);
      const room = Math.max(0, cv * ltv - dv);
      if (room > 0.01 && !loan) { loan = l; collateralValue = cv; debtValue = dv; maxLtv = ltv; }
    }
    return { loan, collateralValue, debtValue, maxLtv, roomUsd: Math.max(0, collateralValue * maxLtv - debtValue) };
  }, [positions]);

  // Decide the starting step exactly once, as soon as real position data
  // has loaded — never re-runs after that, so it doesn't fight with the
  // user's own navigation (e.g. right after they finish a deposit+borrow
  // in this same session).
  useEffect(() => {
    if (hasAutoSelected || positionsLoading) return;
    setHasAutoSelected(true);
    if (existingRoom.roomUsd > 0.01) setStep("quick-borrow");
  }, [positionsLoading, existingRoom, hasAutoSelected]);

  const row = eligibleRows.find((r) => r.mint === selectedMint) ?? null;
  const reserve = reserves.find((r) => r.liquidityTokenMint === selectedMint) ?? null;
  const usdcReserve = reserves.find((r) => r.liquidityToken === "USDC") ?? null;

  const hasGasReserve = solBalance >= KAMINO_SOL_RESERVE;
  const depositAmt = Number(depositAmount);
  const validDeposit = row && depositAmt > 0 && depositAmt <= row.uiAmount;

  // Some xStocks mints carry Token-2022's ScaledUiAmount extension (used to
  // represent a stock split) — row.uiAmount is a *display* value (raw
  // atoms × a multiplier) that Kamino's own backend doesn't account for
  // when it converts the decimal string we send into raw atoms (it just
  // does amount × 10**decimals). Sending row.uiAmount straight through can
  // therefore ask Kamino to pull more raw atoms than the wallet actually
  // holds. Scale by the true unscaled ratio (row.amount / 10**decimals)
  // instead so what we send always resolves to ≤ the real on-chain balance.
  const trueUnscaledMax = row?.amount != null ? Number(row.amount) / 10 ** (row.decimals ?? 8) : row?.uiAmount ?? 0;
  const kaminoDepositAmount = row && row.uiAmount > 0
    ? (depositAmt >= row.uiAmount ? trueUnscaledMax : (depositAmt / row.uiAmount) * trueUnscaledMax)
    : depositAmt;

  // Max borrowable = collateral value in USD × this reserve's max LTV — the
  // real number Kamino's own reserve config sets per asset (e.g. SPYx 73%,
  // AAPLx 40%), not a guessed constant.
  const maxLtv = reserve ? Number(reserve.maxLtv) : 0;
  const depositValueUsd = row ? depositAmt * row.price : 0;
  // Deposits are free — maxBorrowUsd is against the FULL deposited value,
  // no fee reduction. The 0.10% platform fee now lives on borrows instead,
  // taken in USDC as its own transfer inside executeKaminoAction().
  const maxBorrowUsd = depositValueUsd * maxLtv;
  const borrowAmt = Number(borrowAmount);
  const validBorrow = borrowAmt > 0 && borrowAmt <= maxBorrowUsd;
  const borrowFeeUsd = borrowAmt * (KAMINO_FEE_BPS / 10000);
  const netBorrowUsd = borrowAmt - borrowFeeUsd;

  const quickBorrowAmt = Number(quickBorrowAmount);
  const validQuickBorrow = quickBorrowAmt > 0 && quickBorrowAmt <= existingRoom.roomUsd;
  const quickBorrowFeeUsd = quickBorrowAmt * (KAMINO_FEE_BPS / 10000);
  const netQuickBorrowUsd = quickBorrowAmt - quickBorrowFeeUsd;

  const submitDeposit = async () => {
    if (!validDeposit || !reserve) return;
    const result = await action.run("deposit", {
      reserve: reserve.reserve, amount: String(kaminoDepositAmount),
      mint: row.mint, decimals: row.decimals, usdValue: depositValueUsd,
    });
    if (result) setStep("borrow");
  };

  const submitBorrow = async () => {
    if (!validBorrow || !usdcReserve) return;
    const result = await action.run("borrow", { reserve: usdcReserve.reserve, amount: borrowAmount });
    if (result) { setStep("done"); onDone?.(); }
  };

  const submitQuickBorrow = async () => {
    if (!validQuickBorrow || !usdcReserve) return;
    const result = await action.run("borrow", { reserve: usdcReserve.reserve, amount: quickBorrowAmount });
    if (result) { setStep("done"); onDone?.(); }
  };

  const canDepositNew = eligibleRows.length > 0;

  if (!canDepositNew && existingRoom.roomUsd <= 0.01 && !positionsLoading) {
    return (
      <div className="card">
        <p className="card-title">No eligible collateral</p>
        <p className="muted">
          You don't currently hold any xStocks that Kamino's xStocks Market accepts as collateral.
          Buy one of the supported stocks/ETFs first, then come back here to borrow against it.
        </p>
      </div>
    );
  }

  if (step === "done") {
    const viaFreshDeposit = Boolean(depositAmount);
    return (
      <div className="card">
        <p className="card-title">{viaFreshDeposit ? "Position opened" : "Borrow complete"}</p>
        <p className="muted">
          {viaFreshDeposit
            ? `Deposited ${depositAmount} ${row?.symbol} as collateral and borrowed $${borrowAmt.toFixed(2)} USDC. `
            : `Borrowed $${quickBorrowAmt.toFixed(2)} USDC against your existing collateral. `}
          Check "My Positions" to monitor your loan-to-value.
        </p>
        <button className="btn ghost" style={{ marginTop: 12 }}
          onClick={() => {
            setStep(canDepositNew ? "deposit" : "quick-borrow");
            setDepositAmount(""); setBorrowAmount(""); setQuickBorrowAmount("");
          }}>
          {canDepositNew ? "Open another position" : "Borrow more"}
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pop">
      <p className="card-title">Borrow against your holdings</p>
      <p className="lede sm">
        Post an xStock you already hold as collateral and borrow USDC against it — rates and limits are
        set per asset by Kamino's live market data.
      </p>

      {step === "quick-borrow" && (
        <>
          <p className="tiny muted">
            You already have ${existingRoom.collateralValue.toFixed(2)} in collateral deposited on this market
            {existingRoom.debtValue > 0 ? ` and $${existingRoom.debtValue.toFixed(2)} already borrowed` : ""} —
            up to ${existingRoom.roomUsd.toFixed(2)} more USDC available to borrow right now, no new deposit needed.
          </p>
          <div className="borrow-field">
            <span className="tiny muted">Borrow amount (USDC)</span>
            <div className="borrow-input-wrap">
              <input className="field" inputMode="decimal" value={quickBorrowAmount}
                onChange={(e) => setQuickBorrowAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="lvp-pct-presets">
              <button type="button" className="lvp-pct-btn" onClick={() => setQuickBorrowAmount((existingRoom.roomUsd * 0.25).toFixed(2))}>25%</button>
              <button type="button" className="lvp-pct-btn" onClick={() => setQuickBorrowAmount((existingRoom.roomUsd * 0.5).toFixed(2))}>50%</button>
              <button type="button" className="lvp-pct-btn" onClick={() => setQuickBorrowAmount(existingRoom.roomUsd.toFixed(2))}>Max</button>
            </div>
          </div>
          {quickBorrowAmt > 0 && (
            <p className="tiny muted">
              {(KAMINO_FEE_BPS / 100).toFixed(2)}% platform fee (${quickBorrowFeeUsd.toFixed(2)}) ·
              ${netQuickBorrowUsd.toFixed(2)} net received
            </p>
          )}
          <button className="btn primary" style={{ marginTop: 12 }} disabled={!validQuickBorrow || action.busy}
            onClick={() => void submitQuickBorrow()}>
            {action.busy ? "Waiting for signature…" : "Borrow USDC"}
          </button>
          {canDepositNew && (
            <button className="btn ghost" style={{ marginTop: 8, width: "100%" }} onClick={() => setStep("deposit")}>
              Deposit more collateral instead
            </button>
          )}
        </>
      )}

      {step === "deposit" && (
        <>
          {existingRoom.roomUsd > 0.01 && (
            <p className="tiny muted" style={{ marginBottom: 14 }}>
              You also have ${existingRoom.roomUsd.toFixed(2)} of unused borrowing room on collateral you've
              already deposited.{" "}
              <button className="linkish" onClick={() => setStep("quick-borrow")}>Borrow that instead →</button>
            </p>
          )}
          <div className="borrow-field">
            <span className="tiny muted">Collateral</span>
            <div className="borrow-asset-list">
              {eligibleRows.map((r) => {
                const res = reserves.find((x) => x.liquidityTokenMint === r.mint);
                const borrowApyPct = res ? Number(res.borrowApy) * 100 : null;
                const supplyApyPct = res ? Number(res.supplyApy) * 100 : null;
                return (
                  <button key={r.mint} className={`borrow-asset-row ${r.mint === selectedMint ? "sel" : ""}`}
                    onClick={() => { setSelectedMint(r.mint); setDepositAmount(""); }}>
                    <div className="borrow-asset-row-top">
                      <span className="borrow-asset-symbol mono">{r.symbol}</span>
                      <span className="tiny muted">{r.uiAmount} held · ${r.value.toFixed(2)}</span>
                    </div>
                    {res && (
                      <div className="borrow-asset-rates">
                        <span className="borrow-rate-chip borrow-rate-chip-borrow">
                          <span className="tiny muted">Borrow APY</span>
                          <span className="mono">{borrowApyPct.toFixed(2)}%</span>
                        </span>
                        {supplyApyPct > 0 && (
                          <span className="borrow-rate-chip borrow-rate-chip-deposit">
                            <span className="tiny muted">Deposit APY</span>
                            <span className="mono">{supplyApyPct.toFixed(2)}%</span>
                          </span>
                        )}
                        <span className="borrow-rate-chip borrow-rate-chip-ltv">
                          <span className="tiny muted">Max LTV</span>
                          <span className="mono">{(Number(res.maxLtv) * 100).toFixed(0)}%</span>
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {reserve && (
            <>
              <div className="borrow-field">
                <span className="tiny muted">Deposit amount ({row.symbol}) · max LTV {(maxLtv * 100).toFixed(0)}%</span>
                <div className="borrow-input-wrap">
                  <input className="field" inputMode="decimal" value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
                  <button className="btn ghost borrow-max" onClick={() => setDepositAmount(String(row.uiAmount))}>
                    Max {row.uiAmount}
                  </button>
                </div>
              </div>
              {depositAmt > 0 && (
                <p className="tiny muted">
                  ${depositValueUsd.toFixed(2)} in collateral value — no deposit fee —
                  up to ${maxBorrowUsd.toFixed(2)} borrowable
                </p>
              )}
              {!hasGasReserve && (
                <p className="tiny muted">
                  Opening your first position here needs ~{KAMINO_SOL_RESERVE} SOL (you have {solBalance.toFixed(4)}) —
                  we'll try to cover the difference automatically when you deposit.
                </p>
              )}
              <button className="btn primary" style={{ marginTop: 12 }} disabled={!validDeposit || action.busy}
                onClick={() => void submitDeposit()}>
                {action.busy ? "Waiting for signature…" : "Deposit collateral"}
              </button>
            </>
          )}
        </>
      )}

      {step === "borrow" && (
        <>
          <p className="tiny muted">
            Collateral deposited. Up to ${maxBorrowUsd.toFixed(2)} USDC borrowable at {row.symbol}'s {(maxLtv * 100).toFixed(0)}% max LTV —
            borrowing less than the max keeps a bigger safety margin from liquidation.
          </p>
          <div className="borrow-field">
            <span className="tiny muted">Borrow amount (USDC)</span>
            <div className="borrow-input-wrap">
              <input className="field" inputMode="decimal" value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="lvp-pct-presets">
              <button type="button" className="lvp-pct-btn" onClick={() => setBorrowAmount((maxBorrowUsd * 0.25).toFixed(2))}>25%</button>
              <button type="button" className="lvp-pct-btn" onClick={() => setBorrowAmount((maxBorrowUsd * 0.5).toFixed(2))}>50%</button>
              <button type="button" className="lvp-pct-btn" onClick={() => setBorrowAmount(maxBorrowUsd.toFixed(2))}>Max</button>
            </div>
          </div>
          {borrowAmt > 0 && (
            <p className="tiny muted">
              {(KAMINO_FEE_BPS / 100).toFixed(2)}% platform fee (${borrowFeeUsd.toFixed(2)}) ·
              ${netBorrowUsd.toFixed(2)} net received
            </p>
          )}
          <button className="btn primary" style={{ marginTop: 12 }} disabled={!validBorrow || action.busy}
            onClick={() => void submitBorrow()}>
            {action.busy ? "Waiting for signature…" : "Borrow USDC"}
          </button>
        </>
      )}

      {action.error && <p className="err tiny" style={{ marginTop: 10 }}>{action.error}</p>}
    </div>
  );
}
