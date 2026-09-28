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
 * (api.parseConsole, server-side in /api/parse-console) that reads
 * genuinely novel or compound phrasing ("show my portfolio and make it
 * dark", "put my P&L up top and give it an amber accent") and returns a
 * spec covering three independent things one prompt can ask for at once:
 * WHICH DATA to show (dataSource/display/sort/limit/period — the same
 * fixed set of Bonzai's real products), WHAT IT LOOKS LIKE (a full custom
 * color palette, corner rounding, shadow depth, a typeface pairing — see
 * PC_THEMES/PC_RADII/PC_SHADOWS/PC_FONTS), and HOW IT'S ARRANGED (bring a
 * card to the front, widen/narrow it, remove it). "Prompt it like a
 * normal LLM" is the actual UX goal; what keeps this safe on a real
 * financial dashboard is that every one of those fields still lands on a
 * real, already-built control (a CSS variable this app already reads, a
 * sort this app already knows how to do) — never arbitrary markup, CSS,
 * or script the model writes and this executes. All three paths (local
 * topic table, local design-word table, AI fallback) converge on the same
 * addOrFocusCard/applyDesignPatch/applyLayoutPatch state, so the render
 * side never needs to know which one decided.
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

// Purely decorative — NOT clickable suggestions (the whole point of
// removing the example chips was one dominant bar, not a second set of
// prompts in icon form). Six faint glyphs scattered around the hero,
// positioned by eye rather than a grid, so the ring reads as ambient
// texture ("everything lives behind this one bar") instead of UI. The
// Icon components are function declarations further down this file —
// hoisted, so referencing them here before their textual definition
// works fine.
const HERO_ORBIT_ICONS = [
  { Icon: PortfolioGlyph, top: "8%", left: "9%", size: 30, rot: -12 },
  { Icon: PerpsGlyph, top: "13%", left: "87%", size: 27, rot: 9 },
  { Icon: PnlGlyph, top: "52%", left: "4%", size: 23, rot: 7 },
  { Icon: PredictionsGlyph, top: "58%", left: "93%", size: 28, rot: -8 },
  { Icon: BorrowGlyph, top: "87%", left: "15%", size: 24, rot: 13 },
  { Icon: StrategiesGlyph, top: "83%", left: "81%", size: 22, rot: -14 },
];

const PNL_PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

const CLEAR_WORDS = /\bclear (the )?(board|everything|all)\b|\bstart over\b|\breset\b/i;

/**
 * "Customize the design" — four curated full palettes for a one-click
 * pick, PLUS a genuinely open-ended fifth: "custom", filled in from
 * whatever colors a prompt asks for ("make it look like a rainy Tokyo
 * evening") via the server's AI classifier (validated hex, contrast-
 * checked — see /api/parse-console's paletteFromDesign). Every entry here
 * remaps the SAME custom-property names the rest of the app already reads
 * (--paper/--card/--ink/--pine/--moss/--line/--gold) — applied inline on
 * .pc-shell, they cascade into every card, including reused real
 * components (Donut, TimeSeriesChart, PredictionPositionsPanel) for free,
 * since those already read the same variables rather than hardcoded colors.
 *
 * --gain/--loss are deliberately NOT remapped, in either the presets or a
 * custom palette — green-for-gain and red-for-loss are financial
 * convention, not brand decoration, and should mean the same thing no
 * matter what the rest of the interface looks like. Donut's own wedge
 * palette (SEG_COLORS) is a handful of hardcoded hex values, not a
 * variable, so wedge hues stay constant too — a real, honest limit on
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

// Rounding and elevation as the same kind of promptable knob as color —
// "make the corners sharper", "flatten the shadows" — applied via CSS
// vars so the same three values also drive the manual Customize panel.
const PC_RADII = [
  { key: "sharp", label: "Sharp", value: "4px" },
  { key: "soft", label: "Soft (default)", value: "16px" },
  { key: "round", label: "Round", value: "26px" },
];
const PC_SHADOWS = [
  { key: "flat", label: "Flat", value: "none" },
  { key: "soft", label: "Soft (default)", value: "0 1px 2px rgba(10,24,18,.04), 0 6px 22px rgba(10,24,18,.05)" },
  { key: "bold", label: "Bold", value: "0 4px 10px rgba(10,24,18,.10), 0 22px 48px rgba(10,24,18,.18)" },
];

// A curated set of typeface PAIRINGS, not an open text-font request — the
// same reasoning as the color palettes above: a live financial dashboard
// where any arbitrary webfont could be requested is much more likely to
// break layout or legibility than to look good. Each pairing is a real,
// distinct typographic voice (not just weight tweaks), and — since only
// "Editorial" ships in the app's own index — a non-default choice lazy-
// loads its Google Fonts stylesheet the first time it's picked (see
// ensureFontLoaded below); this is a network stylesheet fetch, never code.
const PC_FONTS = [
  { key: "editorial", label: "Editorial", display: "'Young Serif', Georgia, serif", body: "'Instrument Sans', system-ui, sans-serif" },
  { key: "classic", label: "Classic", display: "'Libre Baskerville', Georgia, serif", body: "'Source Sans 3', system-ui, sans-serif",
    google: "Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@400;500;600" },
  { key: "modern", label: "Modern", display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif",
    google: "Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600" },
  { key: "technical", label: "Technical", display: "'IBM Plex Serif', Georgia, serif", body: "'IBM Plex Sans', system-ui, sans-serif",
    google: "IBM+Plex+Serif:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600" },
];

/**
 * Colors alone can't evoke an actual PLACE — "make it feel like Tokyo"
 * landing as a dark palette with pink/purple accents is defensible as a
 * mood, but it doesn't read as Tokyo to look at. This is the honest fix:
 * a small curated set of real background SCENES, drawn entirely in CSS/
 * SVG from the same palette tokens (never a fetched image, never
 * arbitrary markup) — a city skyline, rain, a starfield, waves, aurora
 * bands, mountains. Bounded the same way the palette itself is bounded:
 * a fixed, curated vocabulary the request maps onto, not "generate any
 * image of anything," but concrete enough that "Tokyo" can actually look
 * like a lit-window skyline at night instead of just a color.
 */
const PC_SCENES = [
  { key: "none", label: "None" },
  { key: "skyline", label: "Skyline" },
  { key: "rain", label: "Rain" },
  { key: "stars", label: "Stars" },
  { key: "waves", label: "Waves" },
  { key: "aurora", label: "Aurora" },
  { key: "mountains", label: "Mountains" },
];

function ensureFontLoaded(fontKey) {
  const font = PC_FONTS.find((f) => f.key === fontKey);
  if (!font?.google || typeof document === "undefined") return;
  if (document.querySelector(`link[data-pc-font="${fontKey}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  link.dataset.pcFont = fontKey;
  document.head.appendChild(link);
}

/** Builds the full inline style object for .pc-shell: color tokens from
 * either a preset or a validated custom palette, plus the radius/shadow/
 * font knobs — one place where "the design" becomes real CSS variables
 * that cascade into every reused real component. */
function designStyleVars({ theme, customPalette, radius, shadow, font }) {
  const preset = PC_THEMES.find((t) => t.key === theme);
  const colorTokens = theme === "custom" && customPalette ? customPalette : (preset?.tokens ?? {});
  const fontDef = PC_FONTS.find((f) => f.key === font) ?? PC_FONTS[0];
  const vars = Object.fromEntries(Object.entries(colorTokens).map(([k, v]) => [`--${k}`, v]));
  vars["--pc-radius"] = PC_RADII.find((r) => r.key === radius)?.value ?? PC_RADII[1].value;
  vars["--pc-shadow"] = PC_SHADOWS.find((s) => s.key === shadow)?.value ?? PC_SHADOWS[1].value;
  vars["--pc-font-display"] = fontDef.display;
  vars["--pc-font-body"] = fontDef.body;
  return vars;
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

/** Any language suggesting an open-ended color/mood/aesthetic request
 * ("amber accent", "give it a moody vibe", "make it feel like a rainy
 * evening in Tokyo") needs the AI's actual color generation — there's no
 * fixed keyword for "what should this look like" on principle. An exact
 * preset name is still unambiguous enough to resolve instantly even
 * alongside a color word ("switch to ocean, love that color"), so that
 * case doesn't count. Exported as its own check (not just baked into
 * resolveDesignLocal) because submit() also needs it: a topic match
 * ("show my portfolio...") is instant on its own, but must NOT take the
 * local fast path when the SAME sentence also carries unresolved color
 * intent ("...and give it a warm amber accent") — that combination has to
 * reach the AI too, or the color half silently never gets applied. */
function hasOpenColorIntent(text) {
  const namesPreset = PC_THEMES.some((t) => t.key !== "sage" && new RegExp(`\\b${t.key}\\b`, "i").test(text));
  return /\b(color|colour|accent|palette|hue|shade|mood|vibe|tone|aesthetic)\b/i.test(text) && !namesPreset;
}

/** The instant, no-network half of "change any aspect of the design" —
 * obvious, unambiguous design words ("dark mode", "sharper corners", "no
 * shadow") resolve locally same as the topic keyword table does. A
 * genuinely open-ended ask carries no fixed keyword to match on
 * principle (see hasOpenColorIntent), so it always falls through to the
 * AI classifier below — that's the real "prompt it like an LLM" half of
 * this, not this table. */
function resolveDesignLocal(text) {
  if (hasOpenColorIntent(text)) return null;

  const out = {};
  let matched = false;
  if (/\bdark mode\b|\bnight mode\b|\bmake it dark\b|\bgo dark\b/i.test(text)) { out.theme = "slate"; matched = true; }
  else if (/\blight mode\b|\bmake it light\b/i.test(text)) { out.theme = "sage"; matched = true; }
  for (const t of PC_THEMES) {
    if (t.key !== "sage" && new RegExp(`\\b${t.key}\\b`, "i").test(text)) { out.theme = t.key; matched = true; }
  }
  if (/\bsharp(er)? corners?\b|\bsquare corners?\b|\bno round(ing|ed corners)?\b/i.test(text)) { out.radius = "sharp"; matched = true; }
  else if (/\bround(ed|er)? corners?\b|\bmore round(ed)?\b/i.test(text)) { out.radius = "round"; matched = true; }
  if (/\bflat(ten)?\b.*\bshadow/i.test(text) || /\bno shadow/i.test(text)) { out.shadow = "flat"; matched = true; }
  else if (/\bbold(er)? shadow/i.test(text) || /\bdramatic shadow/i.test(text) || /\bmore shadow/i.test(text)) { out.shadow = "bold"; matched = true; }
  if (/\bcompact\b|\btighter\b|\bdenser\b/i.test(text)) { out.density = "compact"; matched = true; }
  else if (/\bcozy\b|\bmore (breathing room|space|room)\b|\bspac(ious|e (it )?out)\b/i.test(text)) { out.density = "cozy"; matched = true; }
  for (const f of PC_FONTS) {
    if (new RegExp(`\\b${f.key}\\b`, "i").test(text)) { out.font = f.key; matched = true; }
  }
  // Explicit scene words only — a PLACE name ("Tokyo", "Paris") carries no
  // fixed keyword on the same principle as hasOpenColorIntent, so that
  // always needs the AI to interpret. This only catches someone naming
  // the scene itself directly.
  if (/\bno background\b|\bplain background\b|\bremove the (scene|backdrop)\b|\bclear the backdrop\b/i.test(text)) { out.scene = "none"; matched = true; }
  else if (/\bskyline\b|\bcity(scape)?\b|\bbuildings?\b|\burban\b/i.test(text)) { out.scene = "skyline"; matched = true; }
  else if (/\brain(y|ing)?\b|\bstorm(y)?\b/i.test(text)) { out.scene = "rain"; matched = true; }
  else if (/\bstars?\b|\bstarry\b|\bnight sky\b/i.test(text)) { out.scene = "stars"; matched = true; }
  else if (/\bwaves?\b|\bocean\b|\bsea\b|\bbeach\b/i.test(text)) { out.scene = "waves"; matched = true; }
  else if (/\baurora\b|\bnorthern lights\b/i.test(text)) { out.scene = "aurora"; matched = true; }
  else if (/\bmountains?\b|\balpine\b|\bpeaks?\b/i.test(text)) { out.scene = "mountains"; matched = true; }
  return matched ? out : null;
}

/** Arrangement verbs ("get rid of", "up top", "bigger") — checked locally
 * alongside a topic match for exactly the reason parsePortfolioSort
 * exists: "get rid of my loans card" matches the "loans" topic keyword
 * and would otherwise just add/focus a Loans card instead of removing it,
 * since a topic match never falls through to the AI layout path. Returns
 * EVERY action the sentence named, not just the first — "put my P&L up
 * top AND make it bigger" asks for two actions in one sentence, and since
 * a topic match already commits to the instant local path, only checking
 * one verb would silently drop whichever one wasn't checked first. */
function resolveLayoutVerbsLocal(text) {
  if (/\bremove\b|\bget rid of\b|\bdelete\b|\btake (it |that )?off\b|\bhide\b/i.test(text)) return ["remove"];
  const verbs = [];
  if (/\bup top\b|\bto the top\b|\b(bring|move) .*(to the )?front\b/i.test(text)) verbs.push("bringToFront");
  if (/\bbigger\b|\bwider\b|\blarger\b|\bmore room\b/i.test(text)) verbs.push("widen");
  if (/\bsmaller\b|\bnarrower\b/i.test(text)) verbs.push("narrow");
  return verbs;
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
  // Which cards the user has explicitly widened via a request ("make my
  // P&L bigger") — separate from the portfolio card's own auto-wide-when-
  // pie behavior, so both can apply independently.
  const [wideCards, setWideCards] = useState(() => new Set(loadLayout()?.wideCards ?? []));
  // The design half of "their own interface" — color palette (a preset OR
  // a fully custom one filled in from a prompt), corner rounding, shadow
  // depth, and a typeface pairing — same persistence treatment as layout.
  const [theme, setTheme] = useState(() => loadLayout()?.theme ?? "sage");
  const [customPalette, setCustomPalette] = useState(() => loadLayout()?.customPalette ?? null);
  const [radius, setRadius] = useState(() => loadLayout()?.radius ?? "soft");
  const [shadow, setShadow] = useState(() => loadLayout()?.shadow ?? "soft");
  const [font, setFont] = useState(() => loadLayout()?.font ?? "editorial");
  const [density, setDensity] = useState(() => loadLayout()?.density ?? "cozy");
  // The actual "place" layer — see PC_SCENES' own comment.
  const [scene, setScene] = useState(() => loadLayout()?.scene ?? "none");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        cards, portfolioMode, portfolioSort, pnlPeriod, wideCards: [...wideCards],
        theme, customPalette, radius, shadow, font, density, scene,
      }));
    } catch {}
  }, [cards, portfolioMode, portfolioSort, pnlPeriod, wideCards, theme, customPalette, radius, shadow, font, density, scene]);

  useEffect(() => { ensureFontLoaded(font); }, [font]);

  // Applies whichever design fields a request actually named — a prompt
  // that only says "make it dark" shouldn't reset the font or corners the
  // user already picked, so each field is independently optional.
  const applyDesignPatch = (d) => {
    if (d.customPalette) { setCustomPalette(d.customPalette); setTheme("custom"); }
    else if (d.theme) setTheme(d.theme);
    if (d.radius) setRadius(d.radius);
    if (d.shadow) setShadow(d.shadow);
    if (d.font) setFont(d.font);
    if (d.density) setDensity(d.density);
    if (d.scene) setScene(d.scene);
  };

  // "Put my P&L up top", "make the portfolio card bigger", "get rid of
  // the loans card" — arrangement requests resolved the same way a topic
  // or design request is: converge on the same card-canvas state whether
  // it came from a click, a drag, or a typed/spoken ask.
  const applyLayoutPatch = (l) => {
    if (l.remove) removeCard(l.remove);
    if (l.bringToFront) {
      addOrFocusCard(l.bringToFront);
      setCards((prev) => [l.bringToFront, ...prev.filter((k) => k !== l.bringToFront)]);
    }
    if (l.widen) {
      addOrFocusCard(l.widen);
      setWideCards((prev) => new Set(prev).add(l.widen));
    }
    if (l.narrow) {
      setWideCards((prev) => { const next = new Set(prev); next.delete(l.narrow); return next; });
    }
    // "Shuffle the cards", "change the layout" — a genuinely vague
    // rearrangement ask (no specific card named) still has to DO
    // something rather than resolve to nothing; a real reshuffle of the
    // existing order is the honest equivalent of "surprise me" for data
    // cards, the same way a vague color ask gets a genuinely new palette.
    if (l.shuffle) {
      setCards((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [next[i], next[j]] = [next[j], next[i]];
        }
        return next;
      });
    }
  };

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
    const designMatch = resolveDesignLocal(q);
    // A topic match alone is normally instant, but not when the SAME
    // sentence also carries color/mood language neither resolveIntent nor
    // resolveDesignLocal can resolve ("show my portfolio and give it a
    // warm amber accent") — taking the local path there would apply the
    // topic and silently drop the color ask, since it'd never reach the
    // AI call below. See hasOpenColorIntent's own comment for why.
    const openColorIntent = hasOpenColorIntent(q);

    // A bare reformat with no new subject named ("show me in pie chart
    // form") re-styles the focused card rather than failing — "on the
    // fly" means it applies to whichever card you're already looking at,
    // the same way clicking that card's own toggle pill would.
    if (!topicMatch && !designMatch && !openColorIntent && formatMatch && focusedKind === "portfolio") {
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
    // A design word in the same sentence ("show my portfolio, make it
    // dark") applies right alongside the topic, same reasoning.
    if ((topicMatch || designMatch) && !openColorIntent) {
      const layoutVerbs = topicMatch ? resolveLayoutVerbsLocal(q) : [];
      setTimeout(() => {
        if (topicMatch) {
          if (layoutVerbs.includes("remove")) {
            removeCard(topicMatch.key);
          } else {
            addOrFocusCard(topicMatch.key);
            if (topicMatch.key === "portfolio") {
              if (formatMatch) setPortfolioMode(formatMatch);
              setPortfolioSort(parsePortfolioSort(q) ?? { by: null, dir: null, limit: null });
            }
            if (topicMatch.key === "pnl") setPnlPeriod(parsePeriodFromText(q) ?? "perpMonth");
            for (const verb of layoutVerbs) applyLayoutPatch({ [verb]: topicMatch.key });
          }
        }
        if (designMatch) applyDesignPatch(designMatch);
        setPhase("settled");
      }, 420);
      return;
    }

    // No local keyword match — this is "prompt it like an LLM": a real
    // Claude call (server-side, /api/parse-console) reads genuinely novel
    // phrasing and returns a structured spec covering three independent
    // things a request can ask for — which data to show (dataSource,
    // display, sort, limit, period), what it should look like (a full
    // custom color palette, an actual background SCENE — skyline, rain,
    // stars, waves, aurora, mountains, drawn from that same palette, so a
    // place like "Tokyo" can look like one instead of just being a color
    // — corner rounding, shadow depth, a typeface pairing), and how it
    // should be arranged (bring a card to the front,
    // widen/narrow it, remove it, shuffle the whole order) — any
    // combination of the three can come back from one sentence. A VAGUE
    // ask with no specifics ("change the color scheme", "shuffle the
    // cards") still has to do something real, not resolve to null and
    // silently no-op — the server is told to genuinely invent a new,
    // distinct palette or reshuffle rather than bail out just because
    // nothing concrete was named. Deliberately bounded, not a code
    // generator: every field lands on a real, already-built control,
    // never arbitrary markup or script — see parseConsolePrompt's own
    // comment server-side.
    try {
      // Current state, so a VAGUE ask ("change the color scheme",
      // "shuffle the cards") can act on something real — pick a palette
      // that's actually different from the one already active, or know
      // which cards exist to rearrange — instead of the server having to
      // guess blind and either invent a near-duplicate or do nothing.
      const context = {
        cards, theme, customPalette, radius, shadow, font, scene,
      };
      const ai = await api.parseConsole(q, context);
      let matched = false;
      if (ai.dataSource) {
        matched = true;
        addOrFocusCard(ai.dataSource);
        if (ai.dataSource === "portfolio") {
          if (ai.display) setPortfolioMode(ai.display === "line" ? "table" : ai.display);
          setPortfolioSort({ by: ai.sortBy, dir: ai.sortDir, limit: ai.limit });
        }
        if (ai.dataSource === "pnl" && ai.pnlPeriod) setPnlPeriod(ai.pnlPeriod);
      }
      if (ai.design) { matched = true; applyDesignPatch(ai.design); }
      if (ai.layout) { matched = true; applyLayoutPatch(ai.layout); }
      setPhase(matched ? "settled" : "unknown");
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
    focused: focusedKind === kind, wide: wideCards.has(kind),
    onRemove: () => removeCard(kind), dragProps: dragPropsFor(kind, index),
  });

  return (
    <div className={`pc-shell pc-density-${density}`} style={designStyleVars({ theme, customPalette, radius, shadow, font })}>
      <div className="pc-top">
        <button className="pc-back" onClick={onBack}>← Back to classic view</button>
        <div className="pc-customize-wrap" ref={customizeRef}>
          <button type="button" className="pc-customize-btn" onClick={() => setCustomizeOpen((o) => !o)}>
            <PaintIcon /> Customize
          </button>
          {customizeOpen && (
            <CustomizePanel
              theme={theme} onThemeChange={(k) => { setTheme(k); }} customPalette={customPalette}
              radius={radius} onRadiusChange={setRadius}
              shadow={shadow} onShadowChange={setShadow}
              font={font} onFontChange={setFont}
              density={density} onDensityChange={setDensity}
              scene={scene} onSceneChange={setScene}
            />
          )}
        </div>
      </div>

      <div className={`pc-center ${docked ? "pc-docked" : ""}`}>
        {/* The color orbs, scene, and grid texture are a persistent page
            background — "customize MY background" should mean it stays
            once you've actually asked for something, not just decorate
            the empty landing state. Only the orbit-icon flourish (tied to
            the "what would you like to see" invitation) is idle-only. */}
        <div className="pc-hero-bg" aria-hidden="true">
          <span className="pc-orb pc-orb-a" />
          <span className="pc-orb pc-orb-b" />
          <span className="pc-orb pc-orb-c" />
          <SceneLayer scene={scene} />
          <span className="pc-grid-texture" />
          {!docked && HERO_ORBIT_ICONS.map(({ Icon, top, left, size, rot }, i) => (
            <span
              key={i}
              className="pc-orbit-icon"
              style={{ top, left, width: size, height: size, transform: `rotate(${rot}deg)` }}
            >
              <Icon />
            </span>
          ))}
        </div>

        {!docked && (
          <>
            <p className="pc-eyebrow">Prompt Mode</p>
            <p className="serif pc-headline">What would you like to see?</p>
            <p className="pc-subhead">One bar for everything Bonzai does — your portfolio, positions, P&amp;L, even the interface itself.</p>
          </>
        )}

        <form
          className={`pc-bar ${docked ? "pc-bar-docked" : "pc-bar-hero"}`}
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

        {phase === "materializing" && (
          <div className="pc-materializing">
            <span className="pc-dot" /><span className="pc-dot" /><span className="pc-dot" />
          </div>
        )}

        {phase === "unknown" && (
          <div className="pc-unknown">
            <p className="muted">
              I don't have a view for &ldquo;{askedFor}&rdquo; yet — try naming a product (portfolio, perps, P&amp;L, predictions, loans, trading agents) or a look you want.
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

/** The actual "place" layer of the hero background — see PC_SCENES'
 * comment for why this exists alongside the color palette. Renders
 * nothing for "none"/unset, same as today. */
function SceneLayer({ scene }) {
  if (scene === "skyline") return <SkylineScene />;
  if (scene === "rain") return <RainScene />;
  if (scene === "stars") return <StarsScene />;
  if (scene === "waves") return <WavesScene />;
  if (scene === "aurora") return <AuroraScene />;
  if (scene === "mountains") return <MountainsScene />;
  return null;
}

const SKYLINE_BUILDINGS = [
  { left: "1%", width: "4.5%", height: "20%" }, { left: "6.5%", width: "3%", height: "32%" },
  { left: "10.5%", width: "5.5%", height: "17%" }, { left: "17%", width: "3.5%", height: "38%" },
  { left: "22%", width: "5%", height: "25%" }, { left: "28%", width: "3%", height: "14%" },
  { left: "73%", width: "3.5%", height: "28%" }, { left: "78%", width: "5.5%", height: "19%" },
  { left: "85%", width: "3%", height: "36%" }, { left: "89.5%", width: "4.5%", height: "23%" },
  { left: "95%", width: "3%", height: "15%" },
];
function SkylineScene() {
  return (
    <div className="pc-scene pc-scene-skyline">
      {SKYLINE_BUILDINGS.map((b, i) => (
        <span key={i} className="pc-building" style={{ left: b.left, width: b.width, height: b.height }}>
          {Array.from({ length: 6 }).map((_, w) => (
            <span
              key={w}
              className="pc-window"
              style={{ left: `${14 + (w % 2) * 45}%`, top: `${12 + Math.floor(w / 2) * 30}%`, opacity: (i * 3 + w) % 5 === 0 ? 0 : (i + w) % 3 === 0 ? 0.85 : 0.3 }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}
function RainScene() {
  return <div className="pc-scene pc-scene-rain" />;
}
function StarsScene() {
  return <div className="pc-scene pc-scene-stars" />;
}
function WavesScene() {
  return (
    <div className="pc-scene pc-scene-waves">
      <span className="pc-wave pc-wave-1" /><span className="pc-wave pc-wave-2" /><span className="pc-wave pc-wave-3" />
    </div>
  );
}
function AuroraScene() {
  return (
    <div className="pc-scene pc-scene-aurora">
      <span className="pc-aurora-band pc-aurora-1" /><span className="pc-aurora-band pc-aurora-2" /><span className="pc-aurora-band pc-aurora-3" />
    </div>
  );
}
function MountainsScene() {
  return (
    <div className="pc-scene pc-scene-mountains">
      <span className="pc-mountain pc-mountain-1" /><span className="pc-mountain pc-mountain-2" /><span className="pc-mountain pc-mountain-3" />
    </div>
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

/* Six ambient glyphs, one per real product, used ONLY as faint background
 * texture in the hero (see HERO_ORBIT_ICONS) — never rendered as a
 * clickable label or paired with prompt text, so this stays decoration
 * and doesn't quietly become a second set of "suggested prompts." Same
 * minimal line-icon style as PaintIcon/MicIcon above. */
function PortfolioGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </svg>
  );
}
function PerpsGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="4" x2="6" y2="20" /><rect x="4" y="9" width="4" height="7" rx="1" />
      <line x1="12" y1="2" x2="12" y2="22" /><rect x="10" y="6" width="4" height="10" rx="1" />
      <line x1="18" y1="6" x2="18" y2="18" /><rect x="16" y="10" width="4" height="5" rx="1" />
    </svg>
  );
}
function PnlGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" />
    </svg>
  );
}
function PredictionsGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function BorrowGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10l9-6 9 6" /><path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9" /><path d="M3 21h18" />
    </svg>
  );
}
function StrategiesGlyph() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

/** "Customize the design" — palette swatches + a density switch, both
 * persisted alongside the layout. Click-outside (the backdrop) closes it,
 * same convention as the app's other popovers (profile/markets menus). */
function CustomizePanel({
  theme, onThemeChange, customPalette,
  radius, onRadiusChange, shadow, onShadowChange, font, onFontChange,
  density, onDensityChange, scene, onSceneChange,
}) {
  return (
    <div className="pc-customize-panel">
      <p className="pc-customize-label">Palette</p>
      <div className="pc-swatches">
        {PC_THEMES.map((t) => (
          <button key={t.key} type="button"
            className={`pc-swatch ${theme === t.key ? "pc-swatch-active" : ""}`}
            style={{ background: t.swatch }}
            onClick={() => onThemeChange(t.key)}
            aria-label={t.label} title={t.label} aria-pressed={theme === t.key}
          />
        ))}
        {/* Only appears once a prompt has actually produced one — "ask for
            a color and it becomes a real, re-selectable option here too,"
            not just a one-off applied in the background. */}
        {customPalette && (
          <button type="button"
            className={`pc-swatch ${theme === "custom" ? "pc-swatch-active" : ""}`}
            style={{ background: `linear-gradient(135deg, ${customPalette.pine || "#1A4433"}, ${customPalette.gold || "#B08D33"})` }}
            onClick={() => onThemeChange("custom")}
            aria-label="Custom (from your prompt)" title="Custom (from your prompt)" aria-pressed={theme === "custom"}
          />
        )}
      </div>
      <p className="pc-customize-label">Corners</p>
      <PillToggle options={PC_RADII.map((r) => ({ key: r.key, label: r.label }))} value={radius} onChange={onRadiusChange} />
      <p className="pc-customize-label">Shadow</p>
      <PillToggle options={PC_SHADOWS.map((s) => ({ key: s.key, label: s.label }))} value={shadow} onChange={onShadowChange} />
      <p className="pc-customize-label">Typeface</p>
      <PillToggle options={PC_FONTS.map((f) => ({ key: f.key, label: f.label }))} value={font} onChange={onFontChange} />
      <p className="pc-customize-label">Density</p>
      <PillToggle options={PC_DENSITIES} value={density} onChange={onDensityChange} />
      <p className="pc-customize-label">Backdrop</p>
      <PillToggle options={PC_SCENES} value={scene} onChange={onSceneChange} />
      <p className="pc-customize-hint">Or just ask the prompt bar — “make it feel like Tokyo”, “give it a warm amber accent”, “put my P&amp;L up top”.</p>
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
      {...frame} wide={frame.wide || mode === "pie"}
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
