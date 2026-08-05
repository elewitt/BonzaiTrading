import { Fragment } from "react";
import StrategiesPanel from "./StrategiesPanel.jsx";

// Hand-rolled line icons, matching the stroke-based style already used
// elsewhere in the app (e.g. the "Share" icon on the brokerage dashboard,
// the profile-menu chevron) — no icon library in this codebase, so a new
// dependency isn't worth pulling in for four small glyphs.
const STEP_ICONS = {
  configure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  watch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  confirm: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.6 2.6L16 9.4" />
    </svg>
  ),
  execute: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  ),
};

const STEPS = [
  { icon: "configure", label: "Set a strategy", sub: "Asset, amount, schedule" },
  { icon: "watch", label: "Agent watches", sub: "Checks in on a timer" },
  { icon: "confirm", label: "You confirm", sub: "Review, then sign yourself" },
  { icon: "execute", label: "Trade executes", sub: "Straight to your wallet" },
];

function StepArrow() {
  return (
    <svg className="agents-step-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function HowItWorks() {
  return (
    <div className="agents-how-it-works">
      {STEPS.map((s, i) => (
        <Fragment key={s.label}>
          <div className="agents-step">
            <div className="agents-step-icon">{STEP_ICONS[s.icon]}</div>
            <div className="agents-step-text">
              <p className="agents-step-label">{s.label}</p>
              <p className="agents-step-sub">{s.sub}</p>
            </div>
          </div>
          {i < STEPS.length - 1 && <StepArrow />}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Trading Agent — a standalone top-level page (own nav button, own screen),
 * not a tab nested inside the brokerage dashboard. Same shell pattern as
 * PredictionMarketsApp.jsx: a back button + an intro card explaining the
 * product, since unlike Perps/Borrow this isn't self-explanatory from the
 * nav label alone — the explanation is a 4-step diagram rather than a
 * paragraph, so it reads at a glance. The actual strategy creation/
 * management UI lives in StrategiesPanel.jsx — this file is just chrome.
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
        <p className="lvp-muted" style={{ margin: "2px 0 20px" }}>
          Set up a strategy once — an agent runs it on a schedule and prepares each trade, but nothing is ever signed without you.
        </p>
        <HowItWorks />
      </div>

      <StrategiesPanel registry={registry} address={solanaAddress} signWithWallet={signWithWallet} />
    </div>
  );
}
