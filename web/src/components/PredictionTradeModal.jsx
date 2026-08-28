import { useState } from "react";
import { executeSwap } from "../lib/api.js";

// YES/NO prices come off the snapshot as strings ("0.9180"). One contract
// pays $1 if that side resolves true, so the fractional price IS the
// probability and `usd / price` is the contract count.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cents(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100);
}

const STATUS_LABEL = {
  routing: "Finding best route…",
  signing: "Approve in your wallet…",
  executing: "Submitting…",
  confirmed: "Confirmed",
};

/**
 * Buy or sell a prediction-market outcome. Both directions are a plain
 * Jupiter swap (USDC <-> the YES/NO SPL token), the exact same path
 * xStocks use — there's no DFlow order API in the loop.
 *
 *  - mode="buy":  market + initial side; spend USDC, receive contracts
 *  - mode="sell": position (from /api/predictions/positions); sell contracts back to USDC
 */
export default function PredictionTradeModal({
  mode, market, position, initialSide = "yes",
  availableCash = 0, address, signWithWallet, usdcMint, usdcDecimals = 6,
  onClose, onDone,
}) {
  const isBuy = mode === "buy";
  const src = isBuy ? market : position;
  const [side, setSide] = useState(isBuy ? initialSide : position.side);
  const [usdInput, setUsdInput] = useState("");
  const [sellPct, setSellPct] = useState(100);
  const [status, setStatus] = useState(null); // null | routing | signing | executing | confirmed
  const [error, setError] = useState(null);

  const yesPrice = num(src.yesAsk ?? src.yesBid);
  const noPrice = num(src.noAsk ?? src.noBid);
  const buyPrice = side === "yes" ? yesPrice : noPrice;

  // ---- buy math ----
  const usd = Number(usdInput) || 0;
  const overCash = usd > availableCash + 0.005;
  const contracts = isBuy && buyPrice ? usd / buyPrice : 0;
  const buyValid = isBuy && usd > 0 && !overCash && buyPrice != null;

  // ---- sell math ----
  const heldContracts = isBuy ? 0 : position.uiAmount || 0;
  const sellContracts = heldContracts * (sellPct / 100);
  const sellMark = isBuy ? null : num(position.markPrice);
  const sellProceeds = sellMark != null ? sellContracts * sellMark : null;
  const sellValid = !isBuy && sellPct > 0 && heldContracts > 0;

  const busy = status != null && status !== "confirmed";
  const valid = isBuy ? buyValid : sellValid;

  const setPct = (pct) => setUsdInput((availableCash * (pct / 100)).toFixed(2));

  const submit = async () => {
    setError(null);
    try {
      if (isBuy) {
        const outputMint = side === "yes" ? market.yesMint : market.noMint;
        if (!outputMint) throw new Error("This market has no tradeable token for that side.");
        await executeSwap({
          inputMint: usdcMint,
          outputMint,
          amount: Math.floor(usd * 10 ** usdcDecimals),
          taker: address,
          signWithWallet,
          onStatus: setStatus,
          usdValue: usd,
        });
      } else {
        const atoms = sellPct >= 100
          ? String(position.amount)
          : String(Math.floor(Number(position.amount) * (sellPct / 100)));
        await executeSwap({
          inputMint: position.mint,
          outputMint: usdcMint,
          amount: atoms,
          taker: address,
          signWithWallet,
          onStatus: setStatus,
          usdValue: sellProceeds ?? undefined,
        });
      }
      setStatus("confirmed");
      onDone?.();
      window.setTimeout(onClose, 700);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-box card" style={{ maxWidth: 400 }}>
        <div className="card-toprow">
          <p className="card-title">{isBuy ? "Buy" : "Sell"} {side === "yes" ? "Yes" : "No"}</p>
          <button className="x" onClick={onClose} disabled={busy}>×</button>
        </div>
        <p className="tiny muted" style={{ margin: "0 0 14px" }}>{src.title}</p>

        {/* Yes / No selector — buy only; a sell is locked to the side you hold. */}
        {isBuy && (
          <div className="pm-side-toggle">
            <button type="button" className={`pm-side-btn yes ${side === "yes" ? "sel" : ""}`}
              onClick={() => setSide("yes")}>
              Yes <span className="mono">{cents(yesPrice) != null ? `${cents(yesPrice)}¢` : "—"}</span>
            </button>
            <button type="button" className={`pm-side-btn no ${side === "no" ? "sel" : ""}`}
              onClick={() => setSide("no")}>
              No <span className="mono">{cents(noPrice) != null ? `${cents(noPrice)}¢` : "—"}</span>
            </button>
          </div>
        )}

        {isBuy ? (
          <>
            <div className="borrow-field">
              <span className="tiny muted">Amount (USD) · ${availableCash.toFixed(2)} available</span>
              <input className="field" inputMode="decimal" autoFocus placeholder="100"
                value={usdInput} onChange={(e) => setUsdInput(e.target.value)} disabled={busy} />
            </div>
            <div className="lvp-pct-presets">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" className="lvp-pct-btn" disabled={!availableCash || busy}
                  onClick={() => setPct(pct)}>
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>
            {usd > 0 && buyPrice != null && (
              <div className="pm-trade-summary">
                <div><span className="tiny muted">Contracts</span><span className="mono">≈ {contracts.toFixed(2)}</span></div>
                <div><span className="tiny muted">Payout if {side === "yes" ? "Yes" : "No"}</span><span className="mono gain">${contracts.toFixed(2)}</span></div>
                <div><span className="tiny muted">Profit / max loss</span><span className="mono"><span className="gain">+${(contracts - usd).toFixed(2)}</span> / <span className="loss">−${usd.toFixed(2)}</span></span></div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="tiny muted" style={{ margin: "0 0 8px" }}>
              You hold <strong className="mono">{heldContracts.toFixed(2)}</strong> {position.side === "yes" ? "Yes" : "No"} contracts
              {sellMark != null ? ` · worth ≈ $${(heldContracts * sellMark).toFixed(2)}` : ""}
            </p>
            <div className="lvp-pct-presets">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" className={`lvp-pct-btn ${sellPct === pct ? "sel" : ""}`}
                  disabled={busy} onClick={() => setSellPct(pct)}>
                  {pct === 100 ? "All" : `${pct}%`}
                </button>
              ))}
            </div>
            <div className="pm-trade-summary">
              <div><span className="tiny muted">Selling</span><span className="mono">{sellContracts.toFixed(2)} contracts</span></div>
              {sellProceeds != null && (
                <div><span className="tiny muted">Est. proceeds</span><span className="mono">≈ ${sellProceeds.toFixed(2)}</span></div>
              )}
            </div>
          </>
        )}

        {isBuy && market && market.settledInUsdc === false && (
          <p className="tiny gold" style={{ margin: "10px 0 0" }}>
            This market isn't USDC-settled — a route may not be available.
          </p>
        )}

        {status && (
          <p className={`tiny ${status === "confirmed" ? "gain" : "muted"}`} style={{ margin: "12px 0 0" }}>
            {STATUS_LABEL[status]}
          </p>
        )}
        {error && <p className="tiny warn" style={{ margin: "10px 0 0" }}>{error}</p>}
        {overCash && isBuy && <p className="tiny warn" style={{ margin: "8px 0 0" }}>Exceeds available cash.</p>}

        <button className="btn primary" style={{ width: "100%", marginTop: 14 }}
          disabled={!valid || busy} onClick={submit}>
          {busy ? "Working…" : isBuy ? `Buy ${side === "yes" ? "Yes" : "No"}` : "Sell"}
        </button>
      </div>
    </div>
  );
}
