import { useState } from "react";
import { useKaminoAction } from "./useKamino.js";

/**
 * Shows one open Kamino obligation and lets the user repay/withdraw against
 * it. Field shape confirmed against a real populated obligation: each
 * deposit/borrow entry uses tokenMint/tokenName/tokenValue (not the
 * mint/name/usdValue the docs implied), currentLtv/liquidationLtv sit
 * directly on loanInfo.
 *
 * The safety metric shown is the gap between currentLtv and liquidationLtv —
 * Kamino doesn't expose a single normalized "health factor," and its own
 * docs frame that gap (not the gap to maxLtv) as the real liquidation buffer.
 *
 * Repay and Withdraw are deliberately kept as two separate sub-tabs, never
 * shown side by side — they act on different sides of the position (debt vs
 * collateral) and cramming both into one row made it easy to fill in the
 * wrong field or miss that a full repay doesn't also return collateral.
 *
 * `focusMint`: when a Kamino obligation holds more than one collateral
 * asset (e.g. SPYx and TSLAx both deposited into the same market), the
 * caller renders one tab per asset and passes the selected mint here. The
 * card then scopes its title, collateral figure, and Withdraw panel to just
 * that asset — debt/LTV stay obligation-level since Kamino genuinely shares
 * one debt pool and liquidation threshold across every collateral type in
 * the obligation; that's a real on-chain fact, not something this app
 * combined on its own, so it's called out explicitly rather than hidden.
 */
export default function PositionCard({ loan, reserves, wallet, signWithWallet, focusMint, onDone }) {
  // Its own action instance, independent from BorrowTicket's (and from any
  // other open position's) — a stuck deposit/borrow elsewhere must never
  // silently disable this card's Repay/Withdraw buttons with no indication
  // why (previously they shared one instance app-wide).
  const action = useKaminoAction(wallet, signWithWallet);
  const [section, setSection] = useState("repay"); // "repay" | "withdraw"
  const [repayAmount, setRepayAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const info = loan.loanInfo ?? loan;
  const currentLtv = Number(info.currentLtv ?? 0);
  const liquidationLtv = Number(info.liquidationLtv ?? 0);
  const collateralDeposits = info.collateral?.deposits ?? [];
  const debtBorrows = info.debt?.borrows ?? [];

  const focusedDeposit = focusMint ? collateralDeposits.find((d) => d.tokenMint === focusMint) : null;
  const otherDeposits = focusMint ? collateralDeposits.filter((d) => d.tokenMint !== focusMint) : [];

  const collateralValue = focusedDeposit
    ? Number(focusedDeposit.tokenValue ?? 0)
    : collateralDeposits.reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);
  const debtValue = debtBorrows.reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);

  // How close current LTV is to the liquidation threshold, as a fraction —
  // 1.0 means "about to be liquidated," not "fully utilized."
  const proximityToLiquidation = liquidationLtv > 0 ? currentLtv / liquidationLtv : 0;
  const isRisky = proximityToLiquidation > 0.85;

  const primaryDebt = debtBorrows[0];
  const primaryCollateral = focusedDeposit ?? collateralDeposits[0];

  // Kamino's own quoted outstanding balance — used as a Number here only
  // for display/enabled-state (e.g. disabled={repayMax<=0} below). The
  // "Max" button itself must NOT send this snapshotted figure at all
  // (whether as a Number or its exact original string) — debt accrues
  // interest continuously, so by the time a signed transaction actually
  // lands the true on-chain debt is already slightly higher than whatever
  // was quoted here, leaving dust behind and tripping Kamino's own
  // "NetValueRemainingTooSmall" guard (confirmed as a real production
  // failure — twice, the second time even after fixing a separate,
  // real-but-insufficient floating-point-precision bug in this exact
  // spot). Verified directly against klend's on-chain source
  // (Reserve::calculate_repay) that a repay request AT OR ABOVE the true
  // debt is clamped down to the exact amount actually owed at execution
  // time — the same mechanism its own u64::MAX "repay everything" sentinel
  // relies on — and verified live against Kamino's real hosted API that it
  // happily builds a repay tx for far more than the actual debt with no
  // balance pre-check. So the Max button intentionally overshoots by a
  // wide, safe margin (see onClick below) and lets the chain settle the
  // exact amount, rather than trying to predict a moving target.
  const repayMax = Number(primaryDebt?.tokenAmount ?? 0);

  const [withdrawMint, setWithdrawMint] = useState(primaryCollateral?.tokenMint ?? null);
  const withdrawDeposit = focusedDeposit
    ?? collateralDeposits.find((d) => d.tokenMint === withdrawMint)
    ?? primaryCollateral;
  // Number form for display only. The "Max" button overshoots the same way
  // repayMax's does, but ONLY once debt is already fully paid off — once
  // borrows are empty, klend's withdraw handler clamps an overshoot down
  // to the true deposited amount the same permissive way repay does
  // (confirmed in its source: `deposited_amount.min(requested)`), which
  // covers the deposit's own share-to-underlying exchange rate drifting
  // between this snapshot and execution too (confirmed as a real,
  // continuously-moving value, not just the debt side). While debt is
  // still outstanding, withdraws are LTV-constrained instead — that path
  // isn't confirmed to clamp as permissively, so stick with Kamino's exact
  // maxWithdrawableAmount string there rather than risk overshooting past
  // what's actually allowed.
  const withdrawMax = Number(withdrawDeposit?.maxWithdrawableAmount ?? 0);

  const submitRepay = async () => {
    const reserve = reserves.find((r) => r.liquidityTokenMint === primaryDebt?.tokenMint);
    if (!reserve || !repayAmount) return;
    const result = await action.run("repay", { reserve: reserve.reserve, amount: repayAmount });
    if (result) { setRepayAmount(""); onDone?.(); }
  };

  const submitWithdraw = async () => {
    const reserve = reserves.find((r) => r.liquidityTokenMint === withdrawDeposit?.tokenMint);
    if (!reserve || !withdrawAmount) return;
    const result = await action.run("withdraw", { reserve: reserve.reserve, amount: withdrawAmount });
    if (result) { setWithdrawAmount(""); onDone?.(); }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-toprow">
        <p className="card-title">
          {focusedDeposit ? focusedDeposit.tokenName
            : collateralDeposits.length > 0 ? collateralDeposits.map((d) => d.tokenName).join(" + ") : "Position"}
        </p>
        {isRisky && <span className="borrow-badge">Near liquidation</span>}
      </div>

      {otherDeposits.length > 0 && (
        <p className="tiny muted" style={{ marginTop: -8, marginBottom: 14 }}>
          Debt and LTV below are shared with your {otherDeposits.map((d) => d.tokenName).join(", ")} collateral
          — Kamino tracks them as one obligation, not something separable on-chain.
        </p>
      )}

      <div className="borrow-stats-row">
        <div><span className="tiny muted">{focusedDeposit ? "This asset's collateral" : "Collateral"}</span><p className="mono">${collateralValue.toFixed(2)}</p></div>
        <div><span className="tiny muted">Borrowed</span><p className="mono">${debtValue.toFixed(2)}</p></div>
        <div><span className="tiny muted">Current LTV</span><p className="mono">{(currentLtv * 100).toFixed(1)}%</p></div>
        <div><span className="tiny muted">Liquidation LTV</span><p className="mono">{(liquidationLtv * 100).toFixed(1)}%</p></div>
      </div>

      <div className="borrow-ltv-bar">
        <div className={`borrow-ltv-fill ${isRisky ? "risk" : ""}`} style={{ width: `${Math.min(100, proximityToLiquidation * 100)}%` }} />
      </div>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        {liquidationLtv > 0
          ? `${((liquidationLtv - currentLtv) * 100).toFixed(1)} percentage points of LTV before liquidation`
          : "Liquidation threshold unavailable"}
      </p>

      <div className="borrow-subtabs">
        <button className={`borrow-subtab ${section === "repay" ? "active" : ""}`} onClick={() => setSection("repay")}>
          Repay Loan
        </button>
        <button className={`borrow-subtab ${section === "withdraw" ? "active" : ""}`} onClick={() => setSection("withdraw")}>
          Withdraw Collateral
        </button>
      </div>

      {section === "repay" && (
        <div className="borrow-section-panel">
          <p className="tiny muted">
            Paying down your USDC debt frees up room under your LTV limit — it does not return any
            collateral on its own. Withdraw that separately once repaid.
          </p>
          <div className="borrow-input-wrap">
            <input className="field" inputMode="decimal" value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)} placeholder="Repay USDC" />
            <button className="btn ghost borrow-max"
              onClick={() => setRepayAmount(repayMax > 0 ? String(repayMax * 1.1) : "0")}
              disabled={repayMax <= 0}>
              Max
            </button>
            <button className="btn primary" disabled={!repayAmount || action.busy} onClick={() => void submitRepay()}>
              {action.busy ? "Waiting for signature…" : "Repay"}
            </button>
          </div>
          {repayMax > 0 && (
            <p className="tiny muted">
              You owe {repayMax.toFixed(6)} USDC (${debtValue.toFixed(2)}) — Max pays this off in full.
            </p>
          )}
        </div>
      )}

      {section === "withdraw" && (
        <div className="borrow-section-panel">
          <p className="tiny muted">
            Withdraws move collateral back to your wallet — only the amount not backing an
            outstanding loan is available.
          </p>
          {!focusMint && collateralDeposits.length > 1 && (
            <div className="borrow-asset-list borrow-withdraw-picker">
              {collateralDeposits.map((d) => (
                <button key={d.tokenMint}
                  className={`borrow-asset-row ${d.tokenMint === withdrawMint ? "sel" : ""}`}
                  onClick={() => { setWithdrawMint(d.tokenMint); setWithdrawAmount(""); }}>
                  <span className="mono">{d.tokenName}</span>
                  <span className="tiny muted">{Number(d.maxWithdrawableAmount).toFixed(6)} withdrawable</span>
                </button>
              ))}
            </div>
          )}
          <div className="borrow-input-wrap">
            <input className="field" inputMode="decimal" value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)} placeholder={`Withdraw ${withdrawDeposit?.tokenName ?? "collateral"}`} />
            <button className="btn ghost borrow-max"
              onClick={() => setWithdrawAmount(
                withdrawMax > 0
                  ? (debtValue <= 0 ? String(withdrawMax * 1.1) : withdrawDeposit?.maxWithdrawableAmount ?? "0")
                  : "0"
              )}
              disabled={withdrawMax <= 0}>
              Max
            </button>
            <button className="btn primary" disabled={!withdrawAmount || action.busy} onClick={() => void submitWithdraw()}>
              {action.busy ? "Waiting for signature…" : "Withdraw"}
            </button>
          </div>
          {withdrawDeposit && (
            <p className="tiny muted">
              Up to {withdrawMax.toFixed(6)} {withdrawDeposit.tokenName} (${Number(withdrawDeposit.maxWithdrawableValue ?? 0).toFixed(2)}) withdrawable now
              {debtValue > 0 ? " — limited by your outstanding LTV" : ""}
            </p>
          )}
        </div>
      )}

      {action.error && <p className="err tiny" style={{ marginTop: 10 }}>{action.error}</p>}
    </div>
  );
}
