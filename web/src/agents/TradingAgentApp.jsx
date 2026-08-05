import StrategiesPanel from "./StrategiesPanel.jsx";

/**
 * Trading Agent — a standalone top-level page (own nav button, own screen),
 * not a tab nested inside the brokerage dashboard. Same shell pattern as
 * PredictionMarketsApp.jsx: a back button + an intro card explaining the
 * product, since unlike Perps/Borrow this isn't self-explanatory from the
 * nav label alone. The actual strategy creation/management UI lives in
 * StrategiesPanel.jsx — this file is just the page's chrome.
 */
export default function TradingAgentApp({ registry, solanaAddress, signWithWallet, onBack }) {
  return (
    <div className="stage wide">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>

      <div className="card agents-intro-card" style={{ marginTop: 16, marginBottom: 24 }}>
        <div className="card-toprow">
          <p className="table-card-title">Trading Agent</p>
          <span className="tiny muted agents-intro-badge">You confirm every trade</span>
        </div>
        <p className="lede sm">
          Set up a strategy once and let it run on a schedule — no more manually placing the same
          trade every week. An agent watches your strategy in the background and prepares each trade
          when it's due, but nothing is ever signed or sent without you: every trade shows up here as
          a proposal you review and confirm yourself, with your own wallet. Dollar-cost averaging is
          available today; more curated strategies are on the way.
        </p>
      </div>

      <StrategiesPanel registry={registry} address={solanaAddress} signWithWallet={signWithWallet} />
    </div>
  );
}
