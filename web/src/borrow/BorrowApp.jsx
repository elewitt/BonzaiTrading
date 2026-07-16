import { useMemo, useState } from "react";
import { useSolanaWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { useKaminoReserves, useKaminoPositions } from "./useKamino.js";
import BorrowTicket from "./BorrowTicket.jsx";
import PositionCard from "./PositionCard.jsx";
import MarketsTable from "./MarketsTable.jsx";

// ⚠️ GEO-GATE INTENTIONALLY DISABLED FOR TESTING (2026-07-14, explicit user
// request). Kamino's own terms restrict this market ("not available to US,
// UK, nor any other restricted jurisdictions" — kamino.finance governance
// forum), same restriction perps/xStocks already enforce via
// `../perps/compliance/geoGate.js`'s evaluateGate/fetchIpCountry. Before any
// real launch, reinstate that same check here (see PerpsApp.jsx for the
// exact pattern this file had until it was removed) — right now this
// component has NO jurisdiction restriction of its own; only Kamino's
// backend (if it enforces anything independently) stands between a
// restricted-region user and this feature.
export default function BorrowApp({ solanaAddress, solBalance = 0, portfolioRows = [], onBack }) {
  const [tab, setTab] = useState("borrow"); // "borrow" | "positions"
  const [selectedTabKey, setSelectedTabKey] = useState(null);

  // Own Solana wallet/signing hooks, same pattern PerpsApp uses — a
  // self-contained sub-app doesn't share App.jsx's wallet state directly.
  const { signTransaction } = useSignTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaWallet = solanaWallets.find((w) => w.walletClientType === "privy") || solanaWallets[0];
  const signWithWallet = async (tx) => {
    if (solanaWallet?.signTransaction) return solanaWallet.signTransaction(tx);
    return signTransaction({ transaction: tx, wallet: solanaWallet });
  };

  const { reserves } = useKaminoReserves();
  const { positions, loading: positionsLoading } = useKaminoPositions(solanaAddress);

  // Only xStocks the user actually holds AND that Kamino's xStocks Market
  // accepts as collateral — "borrow against your positions," not a general
  // leverage tool where you'd deposit something new.
  const eligibleRows = useMemo(() => {
    const reserveMints = new Set(reserves.map((r) => r.liquidityTokenMint));
    return portfolioRows.filter((r) => reserveMints.has(r.mint) && r.uiAmount > 0);
  }, [portfolioRows, reserves]);

  return (
    <div className="borrow-stage">
      <BorrowTopbar onBack={onBack} />

      <div className="borrow-tabs">
        <button className={`borrow-tab ${tab === "borrow" ? "active" : ""}`} onClick={() => setTab("borrow")}>Borrow</button>
        <button className={`borrow-tab ${tab === "positions" ? "active" : ""}`} onClick={() => setTab("positions")}>My Positions</button>
        <button className={`borrow-tab ${tab === "markets" ? "active" : ""}`} onClick={() => setTab("markets")}>Markets</button>
      </div>

      <div className={`stage ${tab === "markets" ? "wide" : "narrow"}`}>
        {tab === "borrow" && (
          <BorrowTicket eligibleRows={eligibleRows} reserves={reserves}
            wallet={solanaAddress} signWithWallet={signWithWallet} solBalance={solBalance}
            positions={positions} positionsLoading={positionsLoading} />
        )}
        {tab === "positions" && (
          <>
            {positionsLoading && <p className="muted">Loading positions…</p>}
            {!positionsLoading && positions.length === 0 && (
              <p className="muted">No open borrow positions yet.</p>
            )}
            {positions.length > 0 && (() => {
              // One tab per collateral ASSET, not per obligation — Kamino
              // pools every collateral type a user deposits into this
              // market into one shared obligation (one debt, one LTV), so
              // "SPYx + TSLAx" showing as a single combined card is real
              // on-chain behavior, not something this app merged. Splitting
              // by asset here lets each be viewed/withdrawn independently,
              // same as the request — the shared debt/LTV is still called
              // out explicitly on each tab rather than hidden.
              const assetTabs = positions.flatMap((loan, li) => {
                const deposits = loan.loanInfo?.collateral?.deposits ?? [];
                const loanKey = loan.loanId ?? loan.obligation ?? li;
                if (deposits.length === 0) return [{ key: `${loanKey}`, loan, loanKey, mint: null, label: `Position ${li + 1}` }];
                return deposits.map((d) => ({ key: `${loanKey}:${d.tokenMint}`, loan, loanKey, mint: d.tokenMint, label: d.tokenName }));
              });
              const activeKey = assetTabs.some((t) => t.key === selectedTabKey) ? selectedTabKey : assetTabs[0].key;
              const active = assetTabs.find((t) => t.key === activeKey);
              return (
                <>
                  <div className="borrow-position-tabs">
                    {assetTabs.map((t) => {
                      const info = t.loan.loanInfo ?? t.loan;
                      const liquidationLtv = Number(info.liquidationLtv ?? 0);
                      const currentLtv = Number(info.currentLtv ?? 0);
                      const isRisky = liquidationLtv > 0 && currentLtv / liquidationLtv > 0.85;
                      return (
                        <button key={t.key}
                          className={`borrow-position-tab ${t.key === activeKey ? "active" : ""}`}
                          onClick={() => setSelectedTabKey(t.key)}>
                          {t.label}{isRisky && <span className="warn"> ⚠</span>}
                        </button>
                      );
                    })}
                  </div>
                  <PositionCard
                    key={active.key}
                    loan={active.loan} focusMint={active.mint} reserves={reserves}
                    wallet={solanaAddress} signWithWallet={signWithWallet} />
                </>
              );
            })()}
          </>
        )}
        {tab === "markets" && <MarketsTable reserves={reserves} />}
      </div>
    </div>
  );
}

function BorrowTopbar({ onBack }) {
  return (
    <div className="perps-topbar">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>
      <span className="perps-wordmark">Bonzai Trading <span className="perps-tag">Borrow</span></span>
      <div className="perps-network-badge">Kamino xStocks Market</div>
    </div>
  );
}
