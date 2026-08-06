import { Fragment, useCallback, useEffect, useState } from "react";
import StrategiesPanel from "./StrategiesPanel.jsx";
import { api } from "../lib/api.js";
import { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_URL } from "../lib/telegram.js";

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
 * Connect/manage Telegram right on the Trading Agent page — previously
 * this only existed buried in My Profile → Settings, with no indication
 * from the page that actually generates proposals that Telegram was even
 * an option. Polls telegram/status briefly after a code is generated so
 * "Connected" flips on by itself once the user sends /link in the bot,
 * without requiring a manual refresh.
 */
function TelegramConnectCard({
  solanaAddress, telegramCode, telegramCodeBusy, telegramCodeErr, getTelegramLinkCode,
  botTradingEnabled, botTradingBusy, toggleBotTrading,
}) {
  const [linked, setLinked] = useState(null); // null = still loading

  const refreshLinked = useCallback(async () => {
    if (!solanaAddress) return;
    try {
      const { linked } = await api.telegramStatus(solanaAddress);
      setLinked(linked);
    } catch {
      setLinked(false);
    }
  }, [solanaAddress]);

  useEffect(() => { refreshLinked(); }, [refreshLinked]);

  // Once a code has been generated, poll for a few minutes so linking
  // completes without the user needing to come back and refresh — stops
  // as soon as it's confirmed linked, or the code itself would expire.
  useEffect(() => {
    if (!telegramCode || linked) return;
    const t = setInterval(refreshLinked, 4000);
    return () => clearInterval(t);
  }, [telegramCode, linked, refreshLinked]);

  if (linked === null) return null; // avoid a flash of "not connected" before the first check resolves

  if (linked) {
    return (
      <div className="lvp-card agents-telegram-card" style={{ marginBottom: 24 }}>
        <div className="card-toprow">
          <p className="table-card-title">Telegram</p>
          <span className="tiny agents-telegram-status connected">✓ Connected</span>
        </div>
        <p className="lvp-muted" style={{ margin: "2px 0 0" }}>
          You'll get a message the moment a proposal is ready — reply "YES &lt;id&gt;" right in the chat to confirm it.
        </p>
        {!botTradingEnabled && (
          <div className="agents-telegram-bot-trading-row">
            <p className="tiny muted" style={{ margin: 0 }}>
              Enable Bot Trading to confirm from Telegram — linking alone only turns on notifications.
            </p>
            <label className="switch">
              <input type="checkbox" checked={botTradingEnabled} disabled={botTradingBusy}
                onChange={(e) => toggleBotTrading(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
            </label>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lvp-card agents-telegram-card" style={{ marginBottom: 24 }}>
      <div className="card-toprow">
        <p className="table-card-title">Connect Telegram</p>
        <span className="tiny muted agents-telegram-status">Not connected</span>
      </div>
      <p className="lvp-muted" style={{ margin: "2px 0 14px" }}>
        Get notified the moment a strategy proposal is ready, and confirm it right from the chat — no need to open the app.
      </p>
      <div className="agents-telegram-actions">
        <a className="btn ghost" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
          Open @{TELEGRAM_BOT_USERNAME} →
        </a>
        {telegramCode ? (
          <div className="account-row">
            <span className="mono">{telegramCode.code}</span>
            <span className="tiny muted">expires in {Math.round(telegramCode.expiresIn / 60)} min</span>
          </div>
        ) : (
          <button className="btn primary" disabled={telegramCodeBusy} onClick={getTelegramLinkCode}>
            {telegramCodeBusy ? "Generating…" : "Get linking code"}
          </button>
        )}
      </div>
      {telegramCodeErr && <p className="err tiny" style={{ marginTop: 8 }}>{telegramCodeErr}</p>}
      {telegramCode && (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Message it to the bot as <span className="mono">/link {telegramCode.code}</span> — this updates automatically once you do.
        </p>
      )}
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
export default function TradingAgentApp({
  solanaAddress, signWithWallet, onBack,
  telegramCode, telegramCodeBusy, telegramCodeErr, getTelegramLinkCode,
  botTradingEnabled, botTradingBusy, toggleBotTrading,
  evmAddress, hlCtx,
}) {
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

      <TelegramConnectCard solanaAddress={solanaAddress}
        telegramCode={telegramCode} telegramCodeBusy={telegramCodeBusy} telegramCodeErr={telegramCodeErr} getTelegramLinkCode={getTelegramLinkCode}
        botTradingEnabled={botTradingEnabled} botTradingBusy={botTradingBusy} toggleBotTrading={toggleBotTrading} />

      <StrategiesPanel address={solanaAddress} signWithWallet={signWithWallet} evmAddress={evmAddress} hlCtx={hlCtx} />
    </div>
  );
}
