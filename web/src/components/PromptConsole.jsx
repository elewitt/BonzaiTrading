import { useEffect, useRef, useState } from "react";
import { api, displayTicker, usd } from "../lib/api.js";
import { usePortfolioStats } from "../perps/useHyperliquid.js";
import Donut from "./Donut.jsx";
import TimeSeriesChart from "./TimeSeriesChart.jsx";
import PredictionPositionsPanel from "./PredictionPositionsPanel.jsx";

/**
 * An experimental alternate front door to the app: no dashboard, no tabs —
 * just a prompt bar. Ask for something and it materializes as a card on a
 * canvas; ask for something else and it joins the first one instead of
 * replacing it — "combine them as you see fit" is the actual point, not
 * just a single-answer lookup. Cards can be dragged to reorder, removed,
 * and reformatted (typed follow-up OR a clicked pill — both paths land on
 * the same state), and the whole layout survives a reload via localStorage.
 * This is a genuinely working prototype, not a mockup: every number comes
 * from the same live state the real dashboard/PerpsApp/BorrowApp compute,
 * and every chart is the app's own real chart component (Donut,
 * TimeSeriesChart) — "make it crisp" mostly meant "reuse what's already
 * crisp" rather than drawing a new chart language from scratch.
 *
 * Intent matching is a small client-side keyword table first — the whole
 * point being tested here is that asking feels instant — and only when
 * that local match fails does it fall back to a real Claude call
 * (api.parseConsole, server-side in /api/parse-console) that classifies
 * genuinely novel phrasing onto the same fixed set of real data sources
 * plus a small, honest set of display/sort/filter knobs. That fallback is
 * deliberately NOT a code/UI generator — "any custom interface" here means
 * any request that resolves onto Bonzai's own real data, never arbitrary
 * model-authored code running against a real financial dashboard. Both
 * paths converge on the same addOrFocusCard/setPortfolioSort/etc. state,
 * so the render side never needs to know which one decided.
 */
const INTENTS = [
  { key: "pnl",         label: "P&L",                  test: /p&l|pnl|profit|\bloss(es)?\b|performance/i },
  // \bown\b (not a bare "own" substring) so this doesn't fire on any word
  // that merely contains "own" (shown, brown, downturn, ...) — a real bug
  // caught while extending this list the first time.
  { key: "portfolio",   label: "Portfolio",            test: /portfolio|holdings|net worth|stocks|equit|brokerage|\bown\b/i },
  { key: "perps",       label: "Perpetual positions",  test: /perp|leverage|\blong\b|\bshort\b|liquidat/i },
  { key: "borrow",      label: "Loans",                test: /loan|borrow|debt|collateral|lend/i },
  { key: "predictions", label: "Predictions",          test: /predict|kalshi|wager|\byes\b.*\bno\b/i },
  { key: "strategies",  label: "Trading Agents",       test: /\bstrategy\b|strategies|trading agent|\bdca\b|automat/i },
];

const EXAMPLES = [
  "Show me my portfolio",
  "Show my portfolio as a pie chart",
  "My P&L from the past month",
  "What are my perp positions?",
  "Show my predictions",
  "Show my trading agents",
];

const PNL_PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

const CLEAR_WORDS = /\bclear (the )?(board|everything|all)\b|\bstart over\b|\breset\b/i;

/**
 * "Customize the design" — a curated set of full palettes (not an
 * open-ended color picker, which on a financial dashboard is much more
 * likely to produce something illegible than something nice) rather than
 * fake choice. Every entry here remaps the SAME custom-property names the
 * rest of the app already reads (--paper/--card/--ink/--pine/--moss/
 * --line/--gold) — applied inline on .pc-shell, they cascade into every
 * card, including reused real components (Donut, TimeSeriesChart,
 * PredictionPositionsPanel) for free, since those already read the same
 * variables rather than hardcoded colors.
 *
 * --gain/--loss are deliberately NOT remapped — green-for-gain and
 * red-for-loss are financial convention, not brand decoration, and should
 * mean the same thing in every theme. Donut's own wedge palette
 * (SEG_COLORS) is a handful of hardcoded hex values, not a variable, so
 * wedge hues stay constant across themes too — a real, honest limit on
 * "fully custom" worth knowing rather than papering over.
 */
const PC_THEMES = [
  { key: "sage", label: "Sage (default)", swatch: "#1A4433", tokens: {} },
  { key: "ocean", label: "Ocean", swatch: "#1D4C74", tokens: {
    paper: "#E3E9F0", card: "#F9FAFD", ink: "#10202E", pine: "#1D4C74", moss: "#5C6E7E", line: "#CDD7E0", gold: "#6B5A2E",
  } },
  { key: "clay", label: "Clay", swatch: "#8B4A2B", tokens: {
    paper: "#EFE6DA", card: "#FBF7F1", ink: "#2B1E14", pine: "#8B4A2B", moss: "#7A6858", line: "#E0D2C0", gold: "#A6741F",
  } },
  { key: "slate", label: "Slate (dark)", swatch: "#0F1618", tokens: {
    paper: "#14181A", card: "#1E2426", ink: "#ECEFEA", pine: "#6FA98A", moss: "#92A39A", line: "#333B3D", gold: "#C9A227",
  } },
];
const PC_DENSITIES = [{ key: "cozy", label: "Cozy" }, { key: "compact", label: "Compact" }];

function themeStyleVars(themeKey) {
  const theme = PC_THEMES.find((t) => t.key === themeKey) ?? PC_THEMES[0];
  return Object.fromEntries(Object.entries(theme.tokens).map(([k, v]) => [`--${k}`, v]));
}

function describeStrategy(s) {
  const p = s.params || {};
  if (s.type === "delta_neutral") return `${usd(p.notionalUsd)} delta-neutral ${displayTicker(p.symbol)} at ${p.leverage}x`;
  if (s.type === "twap" || s.type === "vwap") return `${usd(p.totalUsd)} ${s.type.toUpperCase()} into ${displayTicker(p.symbol)} over ${p.durationHours}h`;
  if (s.type === "trigger") {
    const level = p.thresholdType === "pct_change" ? `${p.thresholdValue}%` : `$${p.thresholdValue}`;
    return `${p.side === "buy" ? "Buy" : "Sell"} ${displayTicker(p.symbol)} if price ${p.direction === "above" ? "rises above" : "drops below"} ${level}`;
  }
  const every = p.intervalDays === 1 ? "day" : p.intervalDays === 7 ? "week" : `${p.intervalDays}d`;
  return `$${usd(p.usdPerInterval)} of ${displayTicker(p.symbol)} every ${every}`;
}

function resolveIntent(text) {
  return INTENTS.find((i) => i.test.test(text)) ?? null;
}

/** A time-scope word in the same sentence as a P&L request — "the past
 * month", "this week", "today". Falls back to a month view when a P&L
 * request names no period at all (a bare "show me my P&L" has to default
 * to something, and a month is the most useful first answer). */
function parsePeriodFromText(text) {
  if (/all[- ]?time|since (i started|the beginning)|\bever\b/i.test(text)) return "perpAllTime";
  if (/\bmonth\b/i.test(text)) return "perpMonth";
  if (/\bweek\b/i.test(text)) return "perpWeek";
  if (/\btoday\b|\bday\b|\b24\s?h(ours?)?\b/i.test(text)) return "perpDay";
  return null;
}

/** A chart-format word — "pie chart", "as a table" — independent of
 * whatever subject it's paired (or not paired) with. */
function parseDisplayMode(text) {
  if (/\bpie\b|\bdonut\b/i.test(text)) return "pie";
  if (/\btable\b|\blist\b/i.test(text)) return "table";
  return null;
}

/** A sort/limit word ("top 3", "biggest", "smallest first", "alphabetically")
 * — checked locally, same rules as the server's parse-console prompt, so
 * a request like "top 3 holdings as a pie chart" gets its limit applied
 * instantly even though "holdings" alone already resolves the portfolio
 * topic locally and would otherwise never reach the AI fallback. Returns
 * null when the text carries no sort/limit signal at all, so the caller
 * can fall back to clearing any previous sort. */
function parsePortfolioSort(text) {
  const topMatch = text.match(/\btop\s+(\d+)\b/i);
  const smallest = /\bsmallest\b|\bworst\b|\blowest\b/i.test(text);
  const biggest = /\bbiggest\b|\blargest\b|\bhighest\b/i.test(text);
  const byName = /\balphabetical(ly)?\b|\bby name\b/i.test(text);
  if (!topMatch && !smallest && !biggest && !byName) return null;
  if (byName) return { by: "name", dir: smallest ? "desc" : "asc", limit: topMatch ? Number(topMatch[1]) : null };
  return {
    by: "value",
    dir: smallest ? "asc" : "desc",
    limit: topMatch ? Number(topMatch[1]) : (biggest || smallest ? 1 : null),
  };
}

const LAYOUT_KEY = "bonzai_prompt_console_layout_v1";
function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private-browsing / storage-blocked — fall back to a blank board
  }
}

export default function PromptConsole({
  portfolio, perpsPositions = [], perpsAccountValue = 0, perpsPnl = 0,
  kaminoCollateralDeposits = [], kaminoDebtBorrows = [],
  hl, evmAddress, address,
  onBack, onNavigate,
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | materializing | unknown | settled
  const [askedFor, setAskedFor] = useState("");

  // The user's own arrangement — which cards, in what order, in what
  // display mode — restored on return so "their interface" actually
  // persists rather than resetting every visit.
  const [cards, setCards] = useState(() => loadLayout()?.cards ?? []);
  const [focusedKind, setFocusedKind] = useState(null);
  const [portfolioMode, setPortfolioMode] = useState(() => loadLayout()?.portfolioMode ?? "table");
  const [portfolioSort, setPortfolioSort] = useState(() => loadLayout()?.portfolioSort ?? { by: null, dir: null, limit: null });
  const [pnlPeriod, setPnlPeriod] = useState(() => loadLayout()?.pnlPeriod ?? "perpMonth");
  // The design half of "their own interface" — a palette and a density,
  // same persistence treatment as the layout itself.
  const [theme, setTheme] = useState(() => loadLayout()?.theme ?? "sage");
  const [density, setDensity] = useState(() => loadLayout()?.density ?? "cozy");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ cards, portfolioMode, portfolioSort, pnlPeriod, theme, density })); } catch {}
  }, [cards, portfolioMode, portfolioSort, pnlPeriod, theme, density]);

  // Same click-outside convention as the main dashboard's own profile/
  // markets dropdowns (a ref + a mousedown listener) — not a full-screen
  // backdrop, which would sit above the toggle button itself and block
  // using that same button to close what it just opened.
  useEffect(() => {
    if (!customizeOpen) return;
    const onDocClick = (e) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target)) setCustomizeOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [customizeOpen]);

  // Only fetched while this screen is mounted — same real hook
  // PerpsPerformancePanel uses for the account's own P&L history.
  const { pnlHistory, stats: pnlStats } = usePortfolioStats(hl, evmAddress);
  const pnlLoading = Object.keys(pnlHistory).length === 0;

  const addOrFocusCard = (kind) => {
    setCards((prev) => (prev.includes(kind) ? prev : [...prev, kind]));
    setFocusedKind(kind);
  };
  const removeCard = (kind) => {
    setCards((prev) => prev.filter((k) => k !== kind));
    setFocusedKind((f) => (f === kind ? null : f));
  };
  const reorderCard = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setCards((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const submit = async (text) => {
    const q = (text ?? query).trim();
    if (!q || phase === "materializing") return;
    setQuery(q); setAskedFor(q);

    if (CLEAR_WORDS.test(q)) {
      setPhase("materializing");
      setTimeout(() => { setCards([]); setFocusedKind(null); setPhase("idle"); }, 260);
      return;
    }

    const topicMatch = resolveIntent(q);
    const formatMatch = parseDisplayMode(q);

    // A bare reformat with no new subject named ("show me in pie chart
    // form") re-styles the focused card rather than failing — "on the
    // fly" means it applies to whichever card you're already looking at,
    // the same way clicking that card's own toggle pill would.
    if (!topicMatch && formatMatch && focusedKind === "portfolio") {
      setPhase("materializing");
      setTimeout(() => { setPortfolioMode(formatMatch); setPhase("settled"); }, 260);
      return;
    }

    setPhase("materializing");

    // The fast, instant path — an exact keyword match, no network round
    // trip. A fresh "show me my portfolio" resets any sort/limit from an
    // earlier request, but a sort/limit word in the SAME sentence ("top 3
    // holdings...") still applies locally — otherwise a topic keyword like
    // "holdings" would win the match and silently swallow the "top 3" that
    // was asked for right alongside it, since it'd never reach the AI path.
    if (topicMatch) {
      setTimeout(() => {
        addOrFocusCard(topicMatch.key);
        if (topicMatch.key === "portfolio") {
          if (formatMatch) setPortfolioMode(formatMatch);
          setPortfolioSort(parsePortfolioSort(q) ?? { by: null, dir: null, limit: null });
        }
        if (topicMatch.key === "pnl") setPnlPeriod(parsePeriodFromText(q) ?? "perpMonth");
        setPhase("settled");
      }, 420);
      return;
    }

    // No local keyword match — this is the "literally any request" path:
    // a real Claude call maps genuinely novel phrasing ("what's my
    // biggest position", "sort my portfolio by size, smallest first",
    // "top 3 holdings as a pie chart") onto the same real data sources
    // instead of a flat "I don't understand." Bounded, not a code
    // generator — see parseConsolePrompt's own comment server-side for why.
    try {
      const ai = await api.parseConsole(q);
      if (!ai.dataSource) { setPhase("unknown"); return; }
      addOrFocusCard(ai.dataSource);
      if (ai.dataSource === "portfolio") {
        if (ai.display) setPortfolioMode(ai.display === "line" ? "table" : ai.display);
        setPortfolioSort({ by: ai.sortBy, dir: ai.sortDir, limit: ai.limit });
      }
      if (ai.dataSource === "pnl" && ai.pnlPeriod) setPnlPeriod(ai.pnlPeriod);
      setPhase("settled");
    } catch {
      setPhase("unknown");
    }
  };

  const clearQuery = () => { setQuery(""); setAskedFor(""); setPhase(cards.length ? "settled" : "idle"); };
  const clearBoard = () => { setCards([]); setFocusedKind(null); setQuery(""); setAskedFor(""); setPhase("idle"); };

  // "Speak through the prompt" — the browser's own speech recognition
  // (Chrome/Edge/Safari; no support in Firefox), so the mic button simply
  // doesn't render where it wouldn't work, rather than a broken control
  // with an error message explaining why. finalTranscript accumulates in
  // the closure rather than React state so onend can read the finished
  // phrase directly without a stale-closure risk.
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const voiceSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleListening = () => {
    if (!voiceSupported) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    let finalTranscript = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      setQuery((finalTranscript + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      // Submits whatever was actually heard as soon as you stop talking —
      // "speak and it materializes" should feel like asking out loud, not
      // dictating into a box you still have to press Go on afterward.
      if (finalTranscript.trim()) submit(finalTranscript.trim());
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const docked = cards.length > 0 || phase !== "idle";

  const dragPropsFor = (kind, index) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData("text/plain", String(index)); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); reorderCard(Number(e.dataTransfer.getData("text/plain")), index); },
    onClick: () => setFocusedKind(kind),
  });
  const frameFor = (kind, index) => ({
    focused: focusedKind === kind, onRemove: () => removeCard(kind), dragProps: dragPropsFor(kind, index),
  });

  return (
    <div className={`pc-shell pc-density-${density}`} style={themeStyleVars(theme)}>
      <div className="pc-top">
        <button className="pc-back" onClick={onBack}>← Back to classic view</button>
        <div className="pc-customize-wrap" ref={customizeRef}>
          <button type="button" className="pc-customize-btn" onClick={() => setCustomizeOpen((o) => !o)}>
            <PaintIcon /> Customize
          </button>
          {customizeOpen && (
            <CustomizePanel theme={theme} onThemeChange={setTheme} density={density} onDensityChange={setDensity} />
          )}
        </div>
      </div>

      <div className={`pc-center ${docked ? "pc-docked" : ""}`}>
        {!docked && (
          <p className="serif pc-headline">What would you like to see?</p>
        )}

        <form
          className={`pc-bar ${docked ? "pc-bar-docked" : ""}`}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <SparkleIcon />
          <input
            className="pc-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask for anything — “show me my portfolio”"
            autoFocus
          />
          {voiceSupported && (
            <button
              type="button"
              className={`pc-mic-btn ${listening ? "pc-mic-listening" : ""}`}
              onClick={toggleListening}
              title={listening ? "Stop listening" : "Speak your request"}
              aria-pressed={listening}
            >
              <MicIcon />
            </button>
          )}
          {docked ? (
            <>
              <button type="button" className="pc-new-btn" onClick={clearQuery}>New question</button>
              {cards.length > 0 && (
                <button type="button" className="pc-clear-btn" onClick={clearBoard}>Clear board</button>
              )}
            </>
          ) : (
            <button type="submit" className="btn primary pc-go-btn">Go</button>
          )}
        </form>

        <div className="pc-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip pc-example-chip" onClick={() => submit(e)}>{e}</button>
          ))}
        </div>

        {phase === "materializing" && (
          <div className="pc-materializing">
            <span className="pc-dot" /><span className="pc-dot" /><span className="pc-dot" />
          </div>
        )}

        {phase === "unknown" && (
          <div className="pc-unknown">
            <p className="muted">
              I don't have a view for &ldquo;{askedFor}&rdquo; yet in this prototype — try one of the examples above.
            </p>
          </div>
        )}

        {cards.length > 0 && (
          <div className="pc-grid">
            {cards.map((kind, i) => {
              const frame = frameFor(kind, i);
              if (kind === "portfolio") return (
                <PortfolioResult key={kind} portfolio={portfolio} mode={portfolioMode} sort={portfolioSort}
                  onModeChange={(m) => { setPortfolioMode(m); setFocusedKind("portfolio"); }}
                  onNavigate={onNavigate} {...frame} />
              );
              if (kind === "pnl") return (
                <PnlResult key={kind} pnlHistory={pnlHistory} stats={pnlStats} loading={pnlLoading}
                  period={pnlPeriod} onPeriodChange={(p) => { setPnlPeriod(p); setFocusedKind("pnl"); }}
                  onNavigate={onNavigate} {...frame} />
              );
              if (kind === "perps") return (
                <PerpsResult key={kind} positions={perpsPositions} accountValue={perpsAccountValue} pnl={perpsPnl}
                  onNavigate={onNavigate} {...frame} />
              );
              if (kind === "borrow") return (
                <BorrowResult key={kind} deposits={kaminoCollateralDeposits} borrows={kaminoDebtBorrows}
                  onNavigate={onNavigate} {...frame} />
              );
              if (kind === "predictions") return (
                <PredictionsResult key={kind} address={address} onNavigate={onNavigate} {...frame} />
              );
              if (kind === "strategies") return (
                <StrategiesResult key={kind} address={address} onNavigate={onNavigate} {...frame} />
              );
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function PaintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22a9 9 0 1 1 6-15.5A3.5 3.5 0 0 1 15.5 13H14a2 2 0 0 0 0 4h.5a1.5 1.5 0 0 1 0 3H12" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** "Customize the design" — palette swatches + a density switch, both
 * persisted alongside the layout. Click-outside (the backdrop) closes it,
 * same convention as the app's other popovers (profile/markets menus). */
function CustomizePanel({ theme, onThemeChange, density, onDensityChange }) {
  return (
    <div className="pc-customize-panel">
      <p className="pc-customize-label">Theme</p>
      <div className="pc-swatches">
        {PC_THEMES.map((t) => (
          <button key={t.key} type="button"
            className={`pc-swatch ${theme === t.key ? "pc-swatch-active" : ""}`}
            style={{ background: t.swatch }}
            onClick={() => onThemeChange(t.key)}
            aria-label={t.label} title={t.label} aria-pressed={theme === t.key}
          />
        ))}
      </div>
      <p className="pc-customize-label">Density</p>
      <PillToggle options={PC_DENSITIES} value={density} onChange={onDensityChange} />
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--pine)" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="pc-sparkle">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Same pill-toggle look every period/category switch in the app already
 * uses (.lvp-pct-btn/.sel) — a display-mode switch is the same kind of
 * control as a chart-period switch, so it should look like one. */
function PillToggle({ options, value, onChange }) {
  return (
    <div className="pc-toggle">
      {options.map((o) => (
        <button key={o.key} type="button" className={`lvp-pct-btn ${value === o.key ? "sel" : ""}`}
          onClick={(e) => { e.stopPropagation(); onChange(o.key); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Every card's outer frame — draggable (native HTML5 DnD, no library:
 * grab anywhere on the card, drop it on another to swap places), focusable
 * (click sets it as the target of the next typed "show me as a ___"), and
 * removable. Same frame whether the content inside is a hand-built result
 * (ResultShell) or a whole reused real component (PredictionsResult). */
function CardFrame({ focused, wide, onRemove, dragProps, title, children }) {
  return (
    <div className={`pc-card lvp-card ${focused ? "pc-card-focused" : ""} ${wide ? "pc-card-wide" : ""}`} {...dragProps} aria-label={title}>
      <button type="button" className="pc-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${title}`}>
        ×
      </button>
      {children}
    </div>
  );
}

function ResultShell({ title, headValue, valueClass, headSub, toggle, onNavigate, navLabel, navTarget, children, focused, wide, onRemove, dragProps }) {
  return (
    <CardFrame focused={focused} wide={wide} onRemove={onRemove} dragProps={dragProps} title={title}>
      <div className="pc-result-head">
        <div>
          <p className="table-card-title" style={{ margin: 0 }}>{title}</p>
          {headSub && <p className="tiny muted" style={{ marginTop: 2 }}>{headSub}</p>}
        </div>
        <div className="pc-result-head-right">
          {toggle}
          {headValue && <p className={`serif pc-result-value ${valueClass || ""}`}>{headValue}</p>}
        </div>
      </div>
      {children}
      {onNavigate && (
        <button className="btn ghost pc-open-btn" onClick={(e) => { e.stopPropagation(); onNavigate(navTarget); }}>
          {navLabel} →
        </button>
      )}
    </CardFrame>
  );
}

/** "Top 3 holdings", "smallest position", "sort by size" — applies
 * server-classified sort/limit to the real rows. Defaults direction when
 * the request didn't state one (value/weight/price -> biggest first,
 * name -> A-Z), rather than requiring the model to always supply it. */
function sortPortfolioRows(rows, sort) {
  if (!sort?.by) return rows;
  const dir = sort.dir ?? (sort.by === "name" ? "asc" : "desc");
  const mul = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => sort.by === "name"
    ? mul * (a.name || a.symbol || "").localeCompare(b.name || b.symbol || "")
    : mul * ((a[sort.by] ?? 0) - (b[sort.by] ?? 0)));
  return sort.limit ? sorted.slice(0, sort.limit) : sorted;
}

function PortfolioResult({ portfolio, mode, sort, onModeChange, onNavigate, ...frame }) {
  const allRows = portfolio?.rows ?? [];
  if (!allRows.length) {
    return (
      <ResultShell title="Your Portfolio" headSub="Brokerage account" {...frame}>
        <p className="muted" style={{ padding: "12px 0" }}>No holdings yet — your portfolio is all cash.</p>
      </ResultShell>
    );
  }
  const rows = sortPortfolioRows(allRows, sort);
  // A limited subset (e.g. "top 3 holdings") is its own whole for the pie
  // — proportions among just those positions, not slivers against a total
  // that includes things not even shown. An unlimited sort still totals
  // to the real portfolio value; only a limit changes what "100%" means.
  const limitedTotal = sort?.limit ? rows.reduce((s, r) => s + (r.value || 0), 0) : portfolio.total;
  const toggle = (
    <PillToggle options={[{ key: "table", label: "Table" }, { key: "pie", label: "Pie" }]} value={mode} onChange={onModeChange} />
  );
  return (
    <ResultShell
      title="Your Portfolio"
      headSub={sort?.limit
        ? `Top ${rows.length} of ${allRows.length} positions${sort.by !== "value" ? ` by ${sort.by}` : ""}`
        : `${rows.length} position${rows.length === 1 ? "" : "s"} · $${usd(portfolio.cashUsdc)} cash`}
      headValue={`$${usd(limitedTotal)}`}
      toggle={toggle}
      onNavigate={onNavigate} navLabel="Open Brokerage" navTarget="dash"
      {...frame} wide={mode === "pie"}
    >
      {mode === "pie" ? (
        <div className="pc-donut-wrap">
          {/* The real donut — same gradient-shaded wedges, legend, and
              click-to-highlight behavior as the main dashboard's own chart. */}
          <Donut rows={rows} cash={sort?.limit ? 0 : portfolio.cashUsdc} total={limitedTotal} cashUsdy={sort?.limit ? 0 : (portfolio.cashUsdy ?? 0)} />
        </div>
      ) : (
        <div className="pc-rows">
          {rows.map((r, i) => (
            <div key={r.mint ?? r.symbol} className="pc-row" style={{ animationDelay: `${i * 45}ms` }}>
              <span className="lg-identity">
                <span className="serif lg-name">{r.name || displayTicker(r.symbol)}</span>
                <span className="mono tiny muted">{displayTicker(r.symbol)}</span>
              </span>
              <span className="mono tiny muted">{r.uiAmount}</span>
              <span className="lg-alloc">
                <span className="alloc-bar-track">
                  <span className="alloc-bar-fill" style={{ width: `${r.weight}%`, background: "#1A4433" }} />
                </span>
                <span className="mono tiny lg-pct">{r.weight.toFixed(1)}%</span>
              </span>
              <span className="mono pc-row-value">{r.value != null ? `$${usd(r.value)}` : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </ResultShell>
  );
}

function PnlResult({ pnlHistory, stats, loading, period, onPeriodChange, onNavigate, ...frame }) {
  const points = (pnlHistory[period] || []).map(([ts, v]) => ({ ts, v: Number(v) }));
  const total = points.length ? points[points.length - 1].v : 0;
  const periodPhrase = period === "perpAllTime" ? "All time" : `Past ${(PNL_PERIODS.find((p) => p.key === period)?.label ?? "Month").toLowerCase()}`;
  return (
    <ResultShell
      title="Perpetual P&L"
      headSub={`${periodPhrase} · ${stats?.totalTrades ?? 0} trades all-time · Hyperliquid`}
      headValue={`${total >= 0 ? "+" : "−"}$${usd(Math.abs(total))}`}
      valueClass={total >= 0 ? "gain" : "warn"}
      toggle={<PillToggle options={PNL_PERIODS} value={period} onChange={onPeriodChange} />}
      onNavigate={onNavigate} navLabel="Open Perps" navTarget="perps"
      {...frame}
    >
      <div className="pc-chart-wrap">
        <TimeSeriesChart points={points} period={period} loading={loading} mode="pnl"
          emptyText="Not enough history yet for this period." />
      </div>
    </ResultShell>
  );
}

function PerpsResult({ positions, accountValue, pnl, onNavigate, ...frame }) {
  if (!positions.length) {
    return (
      <ResultShell title="Perpetual Positions" headSub="Hyperliquid" {...frame}>
        <p className="muted" style={{ padding: "12px 0" }}>No open perp positions right now.</p>
      </ResultShell>
    );
  }
  return (
    <ResultShell
      title="Perpetual Positions"
      headSub={`${positions.length} open · account $${usd(accountValue)}`}
      headValue={`${pnl >= 0 ? "+" : ""}$${usd(pnl)}`}
      valueClass={pnl >= 0 ? "gain" : "warn"}
      onNavigate={onNavigate} navLabel="Open Perps" navTarget="perps"
      {...frame}
    >
      <div className="pc-rows">
        {positions.map((p, i) => (
          <div key={`${p.dex}-${p.coin}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(p.coin)}</span>
              <span className={`pos-side-badge ${p.side}`} style={{ alignSelf: "flex-start" }}>
                {p.side === "long" ? "Long" : "Short"}
              </span>
            </span>
            <span className="mono tiny muted">${usd(p.markPx)} mark</span>
            <span className="pos-leverage-chip">{p.leverage}x</span>
            <span className={`mono pc-row-value ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>
              {p.unrealizedPnl >= 0 ? "+" : ""}${usd(p.unrealizedPnl)}
            </span>
          </div>
        ))}
      </div>
    </ResultShell>
  );
}

function BorrowResult({ deposits, borrows, onNavigate, ...frame }) {
  if (!deposits.length && !borrows.length) {
    return (
      <ResultShell title="Loans" headSub="Kamino tokenized-stocks market" {...frame}>
        <p className="muted" style={{ padding: "12px 0" }}>No open loans — nothing posted as collateral.</p>
      </ResultShell>
    );
  }
  const totalDebt = borrows.reduce((s, b) => s + Number(b.tokenValue ?? b.marketValueUsd ?? 0), 0);
  return (
    <ResultShell
      title="Loans"
      headSub="Kamino tokenized-stocks market"
      headValue={`$${usd(totalDebt)} owed`}
      onNavigate={onNavigate} navLabel="Open Borrow / Lend" navTarget="borrow"
      {...frame}
    >
      <div className="pc-rows">
        {deposits.map((d, i) => (
          <div key={`c-${i}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(d.tokenName)}</span>
              <span className="tiny muted">Collateral</span>
            </span>
            <span className="mono tiny muted">{d.tokenAmount}</span>
            <span />
            <span className="mono pc-row-value">${usd(d.tokenValue ?? d.marketValueUsd ?? 0)}</span>
          </div>
        ))}
        {borrows.map((b, i) => (
          <div key={`b-${i}`} className="pc-row pc-row-attrs" style={{ animationDelay: `${(deposits.length + i) * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{displayTicker(b.tokenName || "USDC")}</span>
              <span className="tiny muted">Borrowed</span>
            </span>
            <span className="mono tiny muted">{b.tokenAmount}</span>
            <span />
            <span className="mono pc-row-value warn">${usd(b.tokenValue ?? b.marketValueUsd ?? 0)}</span>
          </div>
        ))}
      </div>
    </ResultShell>
  );
}

/** The one card that's a whole reused real screen (PredictionPositionsPanel
 * already fetches its own data and renders its own header/table) rather
 * than a hand-built ResultShell body — CardFrame doesn't care which. */
function PredictionsResult({ address, onNavigate, ...frame }) {
  return (
    <CardFrame title="Predictions" {...frame}>
      <PredictionPositionsPanel address={address} />
      {onNavigate && (
        <button className="btn ghost pc-open-btn" onClick={(e) => { e.stopPropagation(); onNavigate("predictions"); }}>
          Open Predictions →
        </button>
      )}
    </CardFrame>
  );
}

/** Trading Agents — self-fetches, same pattern PredictionPositionsPanel
 * uses, rather than threading yet another poll through App.jsx's already
 * large top-level state. A summary line per strategy (describeStrategy),
 * not the full configure/confirm flow the real Trading Agent page has —
 * this card is "what's running," not a second place to set one up. */
function StrategiesResult({ address, onNavigate, ...frame }) {
  const [state, setState] = useState({ loading: true, strategies: [] });

  useEffect(() => {
    if (!address) { setState({ loading: false, strategies: [] }); return; }
    let cancelled = false;
    api.listStrategies(address)
      .then((d) => {
        if (cancelled) return;
        setState({ loading: false, strategies: (d.strategies || []).filter((s) => s.status !== "cancelled") });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, strategies: [] }); });
    return () => { cancelled = true; };
  }, [address]);

  const { loading, strategies } = state;
  if (loading) {
    return (
      <ResultShell title="Trading Agents" headSub="Automated strategies" {...frame}>
        <p className="muted" style={{ padding: "12px 0" }}>Loading…</p>
      </ResultShell>
    );
  }
  if (!strategies.length) {
    return (
      <ResultShell title="Trading Agents" headSub="Automated strategies" {...frame}>
        <p className="muted" style={{ padding: "12px 0" }}>No active strategies yet.</p>
      </ResultShell>
    );
  }
  return (
    <ResultShell
      title="Trading Agents"
      headSub={`${strategies.length} active`}
      onNavigate={onNavigate} navLabel="Open Trading Agent" navTarget="agents"
      {...frame}
    >
      <div className="pc-rows">
        {strategies.map((s, i) => (
          <div key={s.id ?? i} className="pc-row pc-row-strategy" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="lg-identity">
              <span className="serif lg-name">{s.type.replace("_", " ")}</span>
              <span className={`strategy-status strategy-status-${s.status}`}>{s.status}</span>
            </span>
            <span className="tiny muted">{describeStrategy(s)}</span>
          </div>
        ))}
      </div>
    </ResultShell>
  );
}
