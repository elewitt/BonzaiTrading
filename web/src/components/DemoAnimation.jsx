import { useState, useEffect } from "react";

const PROMPT = "60% big tech, 20% S&P 500, 20% gold";

const HOLDINGS = [
  { sym: "NVDA", name: "NVIDIA",     weight: 20, color: "#A78BFA" },
  { sym: "AAPL", name: "Apple",      weight: 20, color: "#60A5FA" },
  { sym: "MSFT", name: "Microsoft",  weight: 12, color: "#34D399" },
  { sym: "TSLA", name: "Tesla",       weight: 8,  color: "#F97316" },
  { sym: "SPY",  name: "S&P 500 ETF", weight: 20, color: "#FBBF24" },
  { sym: "GLD",  name: "Gold ETF",    weight: 20, color: "#D4A843" },
];

// phases: 0=blank 1=typing 2=processing 3=revealing 4=hold 5=fading
export default function DemoAnimation() {
  const [phase, setPhase]       = useState(0);
  const [typedLen, setTypedLen] = useState(0);
  const [shownRows, setShownRows] = useState(0);

  useEffect(() => {
    let t;
    if (phase === 0) {
      t = setTimeout(() => setPhase(1), 900);
    } else if (phase === 1) {
      if (typedLen < PROMPT.length) {
        t = setTimeout(() => setTypedLen(n => n + 1), 42);
      } else {
        t = setTimeout(() => setPhase(2), 500);
      }
    } else if (phase === 2) {
      t = setTimeout(() => setPhase(3), 1300);
    } else if (phase === 3) {
      if (shownRows < HOLDINGS.length) {
        t = setTimeout(() => setShownRows(n => n + 1), 170);
      } else {
        t = setTimeout(() => setPhase(4), 2800);
      }
    } else if (phase === 4) {
      t = setTimeout(() => setPhase(5), 400);
    } else if (phase === 5) {
      t = setTimeout(() => {
        setTypedLen(0);
        setShownRows(0);
        setPhase(0);
      }, 700);
    }
    return () => clearTimeout(t);
  }, [phase, typedLen, shownRows]);

  const showPromptBox  = true;
  const showCursor     = phase <= 1;
  const showProcessing = phase === 2;
  const showResult     = phase >= 3;
  const isFading       = phase === 5;

  return (
    <div className={`demo-card ${isFading ? "demo-fading" : ""}`}>

      {/* Decorative glow */}
      <div className="demo-glow" />

      {/* Header */}
      <div className="demo-header">
        <span className="demo-wordmark">Bonzai Trading</span>
        <span className="demo-header-label">Portfolio</span>
      </div>

      {/* Prompt input */}
      <div className="demo-prompt-row">
        <div className="demo-prompt-box">
          <span className="demo-placeholder" style={{ display: typedLen === 0 && phase === 0 ? undefined : "none" }}>
            Describe your ideal portfolio…
          </span>
          <span className="demo-typed">{PROMPT.slice(0, typedLen)}</span>
          <span className="demo-cursor" style={{ display: showCursor ? undefined : "none" }} />
        </div>
        <div className={`demo-go-btn ${phase >= 2 ? "demo-go-active" : ""}`}>
          <span className="demo-spinner" style={{ display: phase === 2 ? undefined : "none" }} />
          <span style={{ display: phase === 2 ? "none" : undefined }}>→</span>
        </div>
      </div>

      {/* Processing */}
      <div className={`demo-processing ${showProcessing ? "demo-visible" : ""}`}>
        <span className="demo-proc-dot" />
        <span className="demo-proc-dot" />
        <span className="demo-proc-dot" />
        <span className="demo-proc-text">Composing portfolio…</span>
      </div>

      {/* Result */}
      <div className={`demo-result ${showResult ? "demo-visible" : ""}`}>
        <div className="demo-result-header">
          <span className="demo-result-eyebrow">Allocation</span>
          <span className="demo-result-value">$10,000</span>
        </div>
        <div className="demo-rows">
          {HOLDINGS.map((h, i) => (
            <div key={h.sym} className={`demo-row ${i < shownRows ? "demo-row-visible" : ""}`}>
              <span className="demo-dot" style={{ background: h.color }} />
              <span className="demo-sym">{h.sym}</span>
              <span className="demo-name">{h.name}</span>
              <div className="demo-bar-track">
                <div
                  className="demo-bar-fill"
                  style={{
                    width: i < shownRows ? `${h.weight}%` : "0%",
                    background: h.color,
                  }}
                />
              </div>
              <span className="demo-pct">{h.weight}%</span>
            </div>
          ))}
        </div>
        <div className={`demo-confirm-row ${shownRows >= HOLDINGS.length ? "demo-row-visible" : ""}`}>
          <span className="demo-confirm-icon">✓</span>
          <span className="demo-confirm-text">6 swaps ready to execute</span>
        </div>
      </div>
    </div>
  );
}
