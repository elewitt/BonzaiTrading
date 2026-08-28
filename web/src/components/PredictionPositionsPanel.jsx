import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cents(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100);
}
function formatClose(unixSeconds) {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Read-only view of the prediction-market outcome tokens a wallet holds,
 * joined against the market snapshot server-side (/api/predictions/positions).
 * Trading these requires DFlow's Trade API + Proof KYC (Kalshi is a
 * regulated venue and there's no on-chain AMM liquidity for the tokens),
 * so there's no buy/sell here yet — this just surfaces what you hold.
 */
export default function PredictionPositionsPanel({ address }) {
  const [state, setState] = useState({ loading: true, positions: [], error: null });

  const load = useCallback(() => {
    if (!address) { setState({ loading: false, positions: [], error: null }); return; }
    setState((s) => ({ ...s, loading: true }));
    api.predictionPositions(address)
      .then((d) => setState({ loading: false, positions: d.positions || [], error: null }))
      .catch((e) => setState({ loading: false, positions: [], error: e instanceof Error ? e.message : String(e) }));
  }, [address]);

  useEffect(() => { load(); }, [load]);

  const { loading, positions, error } = state;
  const totalValue = positions.reduce((sum, p) => sum + (num(p.value) || 0), 0);

  if (!address) {
    return <div className="card pm-positions-empty"><p className="muted">Connect a wallet to see your prediction-market positions.</p></div>;
  }

  return (
    <div className="card table-card pm-positions-card">
      <div className="pm-positions-head">
        <h3>Open positions</h3>
        {positions.length > 0 && (
          <span className="tiny muted">Total value ≈ <strong className="mono">${totalValue.toFixed(2)}</strong></span>
        )}
      </div>

      {loading && positions.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>Loading positions…</p>}
      {error && (
        <p className="muted" style={{ padding: "12px 0" }}>
          {/HTTP 404/.test(error)
            ? "Positions are still rolling out — check back shortly."
            : `Couldn't load positions: ${error}`}
        </p>
      )}
      {!loading && !error && positions.length === 0 && (
        <p className="muted" style={{ padding: "16px 0" }}>
          No prediction-market positions in this wallet.
        </p>
      )}

      {positions.length > 0 && (
        <>
          <div className="trow trow-pmpos thead tiny label">
            <span>Market</span>
            <span>Side</span>
            <span>Contracts</span>
            <span>Mark</span>
            <span>Value</span>
          </div>
          {positions.map((p) => (
            <div key={p.mint} className="trow trow-pmpos">
              <span className="asset">
                <span className="serif">{p.title}</span>
                <span className="tiny muted">{p.category} · Closes {formatClose(p.closeTime)}</span>
              </span>
              <span className={`pm-pos-side ${p.side}`}>{p.side === "yes" ? "Yes" : "No"}</span>
              <span className="mono tiny">{(p.uiAmount || 0).toFixed(2)}</span>
              <span className="mono tiny">{cents(p.markPrice) != null ? `${cents(p.markPrice)}¢` : "—"}</span>
              <span className="mono tiny">{num(p.value) != null ? `$${num(p.value).toFixed(2)}` : "—"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
