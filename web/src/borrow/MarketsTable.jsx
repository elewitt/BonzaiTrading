import { displayTicker } from "../lib/api.js";

function fmtPct(x) {
  return `${(Number(x) * 100).toFixed(2)}%`;
}

function fmtUsd(x) {
  const n = Number(x) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Live rates for every reserve in Kamino's xStocks Market — USDC (the only
 * borrowable asset here) plus every xStock/other asset that can be posted
 * as collateral. Same data BorrowTicket already uses for maxLtv, just
 * surfaced directly instead of only being consumed behind the scenes.
 */
export default function MarketsTable({ reserves }) {
  const sorted = [...reserves].sort((a, b) => Number(b.totalSupplyUsd) - Number(a.totalSupplyUsd));

  return (
    <div className="card table-card">
      <div className="card-toprow">
        <p className="table-card-title">Kamino Tokenized-Stocks Market Rates</p>
      </div>
      <div className="trow-kamino-rates-wrap">
      <div className="trow trow-kamino-rates thead tiny label">
        <span>Asset</span>
        <span>Supply APY</span>
        <span>Borrow APY</span>
        <span>Utilization</span>
        <span>Total supplied</span>
        <span>Max LTV</span>
      </div>
      {sorted.map((r) => {
        const supplyUsd = Number(r.totalSupplyUsd) || 0;
        const borrowUsd = Number(r.totalBorrowUsd) || 0;
        const util = supplyUsd > 0 ? borrowUsd / supplyUsd : 0;
        const borrowable = r.liquidityToken === "USDC";
        return (
          <div className="trow trow-kamino-rates" key={r.reserve}>
            <span className="asset">
              <span className="serif">{displayTicker(r.liquidityToken)}</span>
              {borrowable && <span className="mono tiny muted">Borrowable here</span>}
            </span>
            <span className="mono gain">{fmtPct(r.supplyApy)}</span>
            <span className="mono">{Number(r.borrowApy) > 0 ? fmtPct(r.borrowApy) : "—"}</span>
            <span className="mono">{fmtPct(util)}</span>
            <span className="mono">{fmtUsd(r.totalSupplyUsd)}</span>
            <span className="mono">{Number(r.maxLtv) > 0 ? fmtPct(r.maxLtv) : "—"}</span>
          </div>
        );
      })}
      </div>
      <p className="tiny muted" style={{ marginTop: 14 }}>
        Depositing a tokenized stock as collateral also earns its Supply APY automatically —
        posting collateral and supplying liquidity are the same action in this market.
        Bonzai Trading currently only lets you borrow USDC here; Kamino's own market
        supports borrowing other assets too, just not yet through this page.
      </p>
    </div>
  );
}
