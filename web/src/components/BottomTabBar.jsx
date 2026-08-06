import { useState } from "react";

// Hand-rolled stroke icons matching the app's existing style (e.g.
// TradingAgentApp.jsx's STEP_ICONS) — no icon library in this codebase.
// "Agent" reuses the exact same sliders icon already established for
// "Set a strategy" on the Trading Agent page's own how-it-works diagram,
// for visual consistency between the tab and the page it opens.
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  perps: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V11" /><path d="M12 20V4" /><path d="M20 20v-6" />
    </svg>
  ),
  borrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10l9-6 9 6" /><path d="M4 10h16" /><path d="M5 10v9" /><path d="M19 10v9" /><path d="M3 21h18" />
    </svg>
  ),
  agent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  ),
};

const TABS = [
  { view: "auto", screen: "dash", label: "Home", icon: "home" },
  { view: "perps", screen: "perps", label: "Perps", icon: "perps" },
  { view: "borrow", screen: "borrow", label: "Borrow", icon: "borrow" },
  { view: "agents", screen: "agents", label: "Agent", icon: "agent" },
];

/**
 * Mobile-only primary navigation — replaces the top header's row of
 * .head-nav-btn buttons on screens narrow enough that 5 buttons + a
 * profile dropdown would overflow (see App.jsx's .lv-head, which has no
 * wrap/collapse behavior of its own). Only 4 destinations fit a bottom
 * bar without crowding; everything else (the 2 lower-traffic markets
 * tabs, History, Refer & Earn, Account, Settings, Sign Out) lives one tap
 * deeper in "More" — which reuses the exact same .modal-overlay/.modal-box
 * markup as every other dialog in the app, so it automatically renders as
 * a bottom sheet too (see styles.css's mobile modal rules) with zero
 * extra work here.
 */
export default function BottomTabBar({ screen, setView, setProfileModal, logout }) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="bottom-tab-bar">
        {TABS.map((t) => (
          <button key={t.view} className={`bottom-tab-btn ${screen === t.screen ? "active" : ""}`} onClick={() => setView(t.view)}>
            <span className="bottom-tab-icon">{ICONS[t.icon]}</span>
            <span className="bottom-tab-label">{t.label}</span>
          </button>
        ))}
        <button className={`bottom-tab-btn ${moreOpen ? "active" : ""}`} onClick={() => setMoreOpen(true)}>
          <span className="bottom-tab-icon">{ICONS.more}</span>
          <span className="bottom-tab-label">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="modal-box card" style={{ maxWidth: 380 }}>
            <p className="tiny label" style={{ marginBottom: 10 }}>More</p>
            <button className="profile-menu-item" onClick={() => { setView("equities"); setMoreOpen(false); }}>Equities Markets</button>
            <button className="profile-menu-item" onClick={() => { setView("predictions"); setMoreOpen(false); }}>Prediction Markets</button>
            <button className="profile-menu-item" onClick={() => { setView("history"); setMoreOpen(false); }}>Transaction History</button>
            <button className="profile-menu-item" onClick={() => { setView("referrals"); setMoreOpen(false); }}>Refer &amp; Earn</button>
            <div className="profile-menu-divider" />
            <button className="profile-menu-item" onClick={() => { setProfileModal("account"); setMoreOpen(false); }}>My Account</button>
            <button className="profile-menu-item" onClick={() => { setProfileModal("settings"); setMoreOpen(false); }}>Settings</button>
            <div className="profile-menu-divider" />
            <button className="profile-menu-item danger" onClick={() => { setMoreOpen(false); logout(); }}>Sign Out</button>
          </div>
        </div>
      )}
    </>
  );
}
