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

  // Kamino's own quoted outstanding balance — the authoritative "pay this
  // much to fully close the loan" figure. A few atoms of interest accrue
  // between quoting and the transaction landing, but Kamino has already
  // been observed clamping a same-or-larger repay to the true remaining
  // debt rather than reverting, and any leftover dust is filtered out of
  // the positions list automatically once it's below a cent.
  const repayMax = Number(primaryDebt?.tokenAmount ?? 0);

  const [withdrawMint, setWithdrawMint] = useState(primaryCollateral?.tokenMint ?? null);
  const withdrawDeposit = focusedDeposit
    ?? collateralDeposits.find((d) => d.tokenMint === withdrawMint)
    ?? primaryCollateral;
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
            <button className="btn ghost borrow-max" onClick={() => setRepayAmount(String(repayMax))} disabled={repayMax <= 0}>
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
            <button className="btn ghost borrow-max" onClick={() => setWithdrawAmount(String(withdrawMax))} disabled={withdrawMax <= 0}>
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
