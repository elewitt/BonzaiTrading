import { useState, useEffect } from "react";

// Four scenes cycle through the product line. Styled with the same design
// system as the real dashboard (--paper/--card/--ink/--line/--pine, Young
// Serif headlines, IBM Plex Mono codes, the real .seg-btn tab pills and
// .cat-badge/.pos-side-badge chips) rather than a standalone dark mockup,
// so this actually reads as "the real app," not a generic marketing demo.
const TABS = ["Brokerage", "Perpetual Futures", "Borrow / Lend", "Predictions"];

// `legs` are what actually plays during the executing phase below — real
// swap routes (USDC → the thing being bought/sold), same shape and same
// route-arrow language as the app's own real execute-screen (App.jsx's
// `.leg`/`legs` — see "Routing your swaps", "{n}/{total} confirmed").
// Sized to add up to `value` above (or, for brokerage, to each row's own
// pct of it) so the numbers a viewer glances at all agree with each other.
const SCENES = [
  {
    kind: "alloc",
    prompt: "60% big tech, 20% S&P 500, 20% gold",
    eyebrow: "Total Portfolio Value",
    value: "$10,000",
    tableTitle: "Brokerage Account",
    rows: [
      { sym: "NVDA", name: "NVIDIA",      badge: "STOCK",      price: "$128.50", pct: 25, color: "#1C4A38" },
      { sym: "AAPL", name: "Apple",       badge: "STOCK",      price: "$254.10", pct: 25, color: "#2F6B50" },
      { sym: "SPY",  name: "S&P 500 ETF", badge: "ETF",        price: "$598.20", pct: 30, color: "#4C8A69" },
      { sym: "GLD",  name: "Gold ETF",    badge: "ETF",        price: "$241.75", pct: 20, color: "#9AC4A8" },
    ],
    confirm: "4 swaps ready to execute",
    legs: [
      { route: "USDC → NVDA", usd: "$2,500.00" },
      { route: "USDC → AAPL", usd: "$2,500.00" },
      { route: "USDC → SPY",  usd: "$3,000.00" },
      { route: "USDC → GLD",  usd: "$2,000.00" },
    ],
  },
  {
    kind: "attrs",
    prompt: "Long SOL 5x with 20% of my account",
    eyebrow: "Position Size",
    value: "$2,400.00",
    tableTitle: "Perpetual Position",
    asset: "SOL", side: "long", leverage: "5x",
    rows: [
      { code: "ENTRY", label: "Entry price",  value: "$142.30" },
      { code: "LIQ",   label: "Liquidation",  value: "$118.65" },
      { code: "PNL",   label: "Unrealized",   value: "+$64.20", gain: true },
    ],
    confirm: "Position opened",
    legs: [{ route: "USDC → SOL-PERP", usd: "$2,400.00" }],
  },
  {
    kind: "attrs",
    prompt: "Deposit my TSLA and borrow $500 USDC",
    eyebrow: "Borrowed",
    value: "$500.00",
    tableTitle: "Loan",
    rows: [
      { code: "COLL", label: "Collateral posted (TSLA)", value: "$2,500.00" },
      { code: "LTV",  label: "Loan-to-value",             value: "20%", bar: 20 },
      { code: "MAX",  label: "Max LTV",                    value: "55%" },
    ],
    confirm: "Loan opened",
    legs: [{ route: "TSLA → USDC", usd: "$500.00" }],
  },
  {
    kind: "alloc",
    prompt: "Buy YES: Fed cuts rates in March",
    eyebrow: "Market Price",
    value: "68¢",
    tableTitle: "Prediction Market",
    rows: [
      { sym: "YES", name: "Fed cuts rates",   price: "68¢", pct: 68, color: "#156040" },
      { sym: "NO",  name: "Fed holds steady", price: "32¢", pct: 32, color: "#963626" },
    ],
    confirm: "Order filled · 42 shares",
    legs: [{ route: "USDC → YES", usd: "$28.56" }],
  },
];

// Same four states (and the same order) as the real execute screen's
// per-leg status machine — queued, routing, signing, executing, confirmed.
const LEG_ICON = { queued: "○", routing: "↻", signing: "◎", executing: "↑", confirmed: "✓" };
const LEG_LABEL = { queued: "Pending", routing: "Routing…", signing: "Sign in wallet…", executing: "Broadcasting…", confirmed: "Confirmed ↗" };
const LEG_STAGE_MS = { routing: 260, signing: 380, executing: 260, confirmed: 220 };
const LEG_STAGE_ORDER = ["routing", "signing", "executing", "confirmed"];

// phases: 0=blank 1=typing 2=executing (real per-leg routing/signing/
// broadcasting/confirmed, like the app's own execute screen) 3=revealing
// 4=hold 5=fading
export default function DemoAnimation({ onSceneChange }) {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [phase, setPhase]       = useState(0);
  const [typedLen, setTypedLen] = useState(0);
  const [shownRows, setShownRows] = useState(0);
  const [legIdx, setLegIdx]     = useState(0);
  const [legStage, setLegStage] = useState("routing");

  const scene = SCENES[sceneIdx];

  // Fires in the same render/commit as every other scene-dependent bit of
  // this card (eyebrow, value, active tab) — the caller's UI changes in
  // perfect lockstep with this one, not on a separate timer of its own.
  useEffect(() => {
    onSceneChange?.(sceneIdx);
  }, [sceneIdx, onSceneChange]);

  useEffect(() => {
    let t;
    if (phase === 0) {
      t = setTimeout(() => setPhase(1), 900);
    } else if (phase === 1) {
      if (typedLen < scene.prompt.length) {
        t = setTimeout(() => setTypedLen(n => n + 1), 42);
      } else {
        t = setTimeout(() => setPhase(2), 500);
      }
    } else if (phase === 2) {
      // Steps each leg through the exact same routing → signing →
      // broadcasting → confirmed sequence the real execute screen uses,
      // one leg at a time — so "4 swaps ready to execute" actually plays
      // out as 4 real-looking confirmations, not a generic spinner.
      t = setTimeout(() => {
        const stagePos = LEG_STAGE_ORDER.indexOf(legStage);
        if (stagePos < LEG_STAGE_ORDER.length - 1) {
          setLegStage(LEG_STAGE_ORDER[stagePos + 1]);
        } else if (legIdx < scene.legs.length - 1) {
          setLegIdx((i) => i + 1);
          setLegStage("routing");
        } else {
          setPhase(3);
        }
      }, LEG_STAGE_MS[legStage]);
    } else if (phase === 3) {
      if (shownRows < scene.rows.length) {
        t = setTimeout(() => setShownRows(n => n + 1), 170);
      } else {
        t = setTimeout(() => setPhase(4), 2600);
      }
    } else if (phase === 4) {
      t = setTimeout(() => setPhase(5), 400);
    } else if (phase === 5) {
      t = setTimeout(() => {
        setTypedLen(0);
        setShownRows(0);
        setLegIdx(0);
        setLegStage("routing");
        setPhase(0);
        setSceneIdx(i => (i + 1) % SCENES.length);
      }, 700);
    }
    return () => clearTimeout(t);
  }, [phase, typedLen, shownRows, legIdx, legStage, scene]);

  const showCursor     = phase <= 1;
  const showExecuting  = phase === 2;
  const legsConfirmed  = phase > 2 ? scene.legs.length : legIdx + (legStage === "confirmed" ? 1 : 0);
  const showResult     = phase >= 3;
  const isFading        = phase === 5;

  return (
    <div className={`demo-card ${isFading ? "demo-fading" : ""}`}>

      {/* Header — mirrors the dashboard's own "eyebrow + big serif value" pattern */}
      <div className="demo-value-block">
        <p className="eyebrow demo-eyebrow">{scene.eyebrow}</p>
        <p className="demo-value serif">{scene.value}</p>
      </div>

      {/* Prompt input — styled like the real hero prompt bar */}
      <div className="demo-prompt-row">
        <div className="demo-prompt-box field">
          <span className="demo-placeholder" style={{ display: typedLen === 0 && phase === 0 ? undefined : "none" }}>
            What would you like to do?
          </span>
          <span className="demo-typed">{scene.prompt.slice(0, typedLen)}</span>
          <span className="demo-cursor" style={{ display: showCursor ? undefined : "none" }} />
        </div>
        <div className={`demo-go-btn btn primary ${phase >= 2 ? "demo-go-active" : ""}`}>
          <span className="demo-spinner" style={{ display: phase === 2 ? undefined : "none" }} />
          <span style={{ display: phase === 2 ? "none" : undefined }}>Go</span>
        </div>
      </div>

      {/* Real product tabs — the active pill tracks which scene is playing */}
      <div className="seg-ctrl demo-seg-ctrl">
        {TABS.map((t, i) => (
          <span key={t} className={`seg-btn demo-seg-btn ${i === sceneIdx ? "active" : ""}`}>{t}</span>
        ))}
      </div>

      {/* Executing — same route-arrow legs, icon badges, and status wording
          as the real execute screen (App.jsx's own .leg/.leg-icon-badge/
          .leg-status-badge), just sized to fit this card. */}
      <div className={`demo-exec ${showExecuting ? "demo-visible" : ""}`}>
        <div className="demo-exec-head">
          <span className="demo-exec-title">Routing your {scene.legs.length > 1 ? "swaps" : "order"}</span>
          <span className="mono tiny muted">{legsConfirmed} / {scene.legs.length} confirmed</span>
        </div>
        {scene.legs.map((leg, i) => {
          const status = i < legIdx ? "confirmed" : i === legIdx ? legStage : "queued";
          return (
            <div className={`leg ${status}`} key={i}>
              <span className={`leg-icon-badge ${status}`}>{LEG_ICON[status]}</span>
              <span className="leg-route mono">{leg.route}</span>
              <span className="mono tiny muted">{leg.usd}</span>
              <span className={`leg-status-badge ${status}`}>{LEG_LABEL[status]}</span>
            </div>
          );
        })}
      </div>

      {/* Result — a light table-card, same visual language as the real
          Holdings/Positions/Loan panels */}
      <div className={`demo-result table-card ${showResult ? "demo-visible" : ""}`}>
        <p className="table-card-title demo-table-title">{scene.tableTitle}</p>

        {scene.kind === "alloc" && (
          <div className="demo-rows">
            {scene.rows.map((r, i) => (
              <div key={r.sym} className={`demo-alloc-row ${i < shownRows ? "demo-row-visible" : ""}`}>
                <span className="dot demo-row-dot" style={{ background: r.color }} />
                <span className="lg-identity">
                  <span className="lg-name serif">{r.name}</span>
                  <span className="lg-meta mono tiny muted">{r.sym}{r.badge && <span className="cat-badge">{r.badge}</span>}</span>
                </span>
                <span className="mono tiny muted demo-row-price">{r.price}</span>
                <span className="lg-alloc">
                  <span className="alloc-bar-track">
                    <span className="alloc-bar-fill" style={{ width: i < shownRows ? `${r.pct}%` : "0%", background: r.color }} />
                  </span>
                  <span className="mono tiny lg-pct">{r.pct}%</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {scene.kind === "attrs" && (
          <div className="demo-rows">
            {scene.asset && (
              <div className={`demo-attr-row demo-attr-headline ${shownRows > 0 ? "demo-row-visible" : ""}`}>
                <span className="mono demo-attr-asset">{scene.asset}</span>
                <span className={`pos-side-badge ${scene.side}`}>{scene.side}</span>
                <span className="pos-leverage-chip">{scene.leverage}</span>
              </div>
            )}
            {scene.rows.map((r, i) => (
              <div key={r.code} className={`demo-attr-row ${i < shownRows ? "demo-row-visible" : ""}`}>
                <span className="mono tiny muted demo-attr-code">{r.code}</span>
                <span className="tiny muted demo-attr-label">{r.label}</span>
                {r.bar != null ? (
                  <span className="lg-alloc">
                    <span className="alloc-bar-track">
                      <span className="alloc-bar-fill" style={{ width: i < shownRows ? `${r.bar}%` : "0%", background: "#1A4433" }} />
                    </span>
                    <span className="mono tiny lg-pct">{r.value}</span>
                  </span>
                ) : (
                  <span className={`mono demo-attr-value ${r.gain ? "gain" : ""}`}>{r.value}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={`demo-confirm-row ${shownRows >= scene.rows.length ? "demo-row-visible" : ""}`}>
          <span className="demo-confirm-icon">✓</span>
          <span className="demo-confirm-text">{scene.confirm}</span>
        </div>
      </div>

      {/* Scene indicator */}
      <div className="demo-scene-dots">
        {SCENES.map((s, i) => (
          <span key={i} className={`demo-scene-dot ${i === sceneIdx ? "demo-scene-dot-active" : ""}`} />
        ))}
      </div>
    </div>
  );
}
