import { Fragment, useState } from "react";
import DemoAnimation from "./DemoAnimation.jsx";

// Order matches DemoAnimation's own SCENES array exactly — the headline
// word is driven by that same scene index (via onSceneChange) rather than
// its own separate timer, so the two can never drift out of sync.
const HEADLINE_WORDS = ["portfolio", "long", "borrow", "prediction"];

/* ─── Marquee data ─── */
const ROW1 = [
  ["AAPL","Apple"],["NVDA","NVIDIA"],["TSLA","Tesla"],["MSFT","Microsoft"],
  ["AMZN","Amazon"],["META","Meta"],["GOOGL","Alphabet"],["AVGO","Broadcom"],
  ["NFLX","Netflix"],["PLTR","Palantir"],["COIN","Coinbase"],["UBER","Uber"],
  ["PYPL","PayPal"],["JPM","JPMorgan"],["V","Visa"],["MA","Mastercard"],
  ["TSM","TSMC"],["AMD","AMD"],["ORCL","Oracle"],["INTC","Intel"],
];
const ROW2 = [
  ["SPY","S&P 500 ETF"],["QQQ","Nasdaq-100"],["GLD","Gold ETF"],["SLV","Silver ETF"],
  ["VOO","Vanguard S&P"],["IWM","Russell 2000"],["SPCX","SpaceX"],["GME","GameStop"],
  ["BRK.B","Berkshire"],["MARA","MARA Holdings"],["RIOT","Riot Platforms"],
  ["NET","Cloudflare"],["CRWD","CrowdStrike"],["PANW","Palo Alto"],["CRM","Salesforce"],
  ["ADBE","Adobe"],["APP","AppLovin"],["ASML","ASML"],["SMH","Semiconductors"],
  ["SOXX","Chip ETF"],
];

function MarqueeRow({ items, reverse }) {
  const doubled = [...items, ...items];
  return (
    <div className="lp-marquee-wrap">
      <div className={`lp-marquee-track ${reverse ? "lp-marquee-rev" : ""}`}>
        {doubled.map(([sym, name], i) => (
          <div key={i} className="lp-ticker">
            <span className="lp-ticker-sym">{sym}</span>
            <span className="lp-ticker-name">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Product tab pictures ───
   Static (non-animated) renders of DemoAnimation's own visual language —
   same .demo-card/.demo-result/.demo-alloc-row/.demo-attr-row classes, so
   the "picture" for each tab looks like an actual screen from the app
   rather than a separate illustration style. */
function ProductPicture({ prompt, eyebrow, value, tableTitle, kind, rows, asset, side, leverage, confirm }) {
  return (
    <div className="demo-card lp-tab-card">
      <div className="demo-value-block">
        <p className="eyebrow demo-eyebrow">{eyebrow}</p>
        <p className="demo-value serif">{value}</p>
      </div>

      <div className="lp-tab-prompt-chip">
        <SparkleIcon />
        <span>{prompt}</span>
      </div>

      <div className="demo-result table-card demo-visible">
        <p className="table-card-title demo-table-title">{tableTitle}</p>

        {kind === "alloc" && (
          <div className="demo-rows">
            {rows.map((r) => (
              <div key={r.sym} className="demo-alloc-row demo-row-visible">
                <span className="dot demo-row-dot" style={{ background: r.color }} />
                <span className="lg-identity">
                  <span className="lg-name serif">{r.name}</span>
                  <span className="lg-meta mono tiny muted">{r.sym}{r.badge && <span className="cat-badge">{r.badge}</span>}</span>
                </span>
                <span className="mono tiny muted demo-row-price">{r.price}</span>
                <span className="lg-alloc">
                  <span className="alloc-bar-track">
                    <span className="alloc-bar-fill" style={{ width: `${r.pct}%`, background: r.color }} />
                  </span>
                  <span className="mono tiny lg-pct">{r.pct}%</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {kind === "attrs" && (
          <div className="demo-rows">
            {asset && (
              <div className="demo-attr-row demo-attr-headline demo-row-visible">
                <span className="mono demo-attr-asset">{asset}</span>
                <span className={`pos-side-badge ${side}`}>{side}</span>
                <span className="pos-leverage-chip">{leverage}</span>
              </div>
            )}
            {rows.map((r) => (
              <div key={r.code} className="demo-attr-row demo-row-visible">
                <span className="mono tiny muted demo-attr-code">{r.code}</span>
                <span className="tiny muted demo-attr-label">{r.label}</span>
                {r.bar != null ? (
                  <span className="lg-alloc">
                    <span className="alloc-bar-track">
                      <span className="alloc-bar-fill" style={{ width: `${r.bar}%`, background: "#1A4433" }} />
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

        <div className="demo-confirm-row demo-row-visible">
          <span className="demo-confirm-icon">✓</span>
          <span className="demo-confirm-text">{confirm}</span>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--pine)" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/* ─── Bonzai Trading Products ───
   picture{} mirrors DemoAnimation's own scene shape exactly — same data
   language, rendered statically via ProductPicture above. */
const PRODUCT_TABS = [
  {
    key: "brokerage",
    label: "Brokerage",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M12 3a9 9 0 0 1 9 9h-9z" opacity=".45" />
      </svg>
    ),
    title: "Brokerage",
    body: "Describe your ideal portfolio in plain English — Claude maps it to real allocations across 167 tokenized stocks and ETFs, executed on-chain in seconds.",
    points: [
      "167 tokenized stocks and ETFs on Solana",
      "AI-powered allocation from plain English",
      "Rebalance anytime with a single prompt",
    ],
    cta: "Explore Brokerage →",
    picture: {
      prompt: "60% big tech, 20% S&P 500, 20% gold",
      eyebrow: "Total Portfolio Value",
      value: "$10,000",
      tableTitle: "Brokerage Account",
      kind: "alloc",
      rows: [
        { sym: "NVDA", name: "NVIDIA",      badge: "STOCK", price: "$128.50", pct: 25, color: "#1C4A38" },
        { sym: "AAPL", name: "Apple",       badge: "STOCK", price: "$254.10", pct: 25, color: "#2F6B50" },
        { sym: "SPY",  name: "S&P 500 ETF", badge: "ETF",   price: "$598.20", pct: 30, color: "#4C8A69" },
        { sym: "GLD",  name: "Gold ETF",    badge: "ETF",   price: "$241.75", pct: 20, color: "#9AC4A8" },
      ],
      confirm: "4 swaps ready to execute",
    },
  },
  {
    key: "perps",
    label: "Perpetual Futures",
    tag: "New",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" />
      </svg>
    ),
    title: "Perpetual Futures",
    body: "Trade crypto and tokenized equities with leverage, 24/7 — long or short BTC, ETH, AAPL, TSLA, and more, powered by Hyperliquid and settled on-chain.",
    points: [
      "Leverage on both crypto and equity perpetuals",
      "Deep liquidity via Hyperliquid's order books",
      "Markets never close — trade stocks on weekends",
    ],
    cta: "Explore Perps →",
    picture: {
      prompt: "Long SOL 5x with 20% of my account",
      eyebrow: "Position Size",
      value: "$2,400.00",
      tableTitle: "Perpetual Position",
      kind: "attrs",
      asset: "SOL", side: "long", leverage: "5x",
      rows: [
        { code: "ENTRY", label: "Entry price", value: "$142.30" },
        { code: "LIQ",   label: "Liquidation", value: "$118.65" },
        { code: "PNL",   label: "Unrealized",  value: "+$64.20", gain: true },
      ],
      confirm: "Position opened",
    },
  },
  {
    key: "borrow",
    label: "Borrow / Lend",
    tag: "New",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="22" x2="21" y2="22" /><line x1="6" y1="18" x2="6" y2="11" /><line x1="10" y1="18" x2="10" y2="11" />
        <line x1="14" y1="18" x2="14" y2="11" /><line x1="18" y1="18" x2="18" y2="11" /><polygon points="12 2 21 7 3 7" />
      </svg>
    ),
    title: "Borrow / Lend",
    body: "Borrow USDC against your tokenized stocks and ETFs without selling — powered by Kamino Finance's live tokenized-stocks lending market.",
    points: [
      "Post SPYx, AAPLx, TSLAx, and more as collateral",
      "Live market rates, up to 80% max LTV on USDC",
      "Posted collateral keeps earning supply yield",
    ],
    cta: "Explore Borrow / Lend →",
    picture: {
      prompt: "Deposit my TSLA and borrow $500 USDC",
      eyebrow: "Borrowed",
      value: "$500.00",
      tableTitle: "Loan",
      kind: "attrs",
      rows: [
        { code: "COLL", label: "Collateral posted (TSLA)", value: "$2,500.00" },
        { code: "LTV",  label: "Loan-to-value",             value: "20%", bar: 20 },
        { code: "MAX",  label: "Max LTV",                    value: "55%" },
      ],
      confirm: "Loan opened",
    },
  },
  {
    key: "predictions",
    label: "Predictions",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Prediction Markets",
    body: "Trade real, CFTC-regulated Kalshi markets — politics, economics, and more — tokenized on Solana via DFlow.",
    points: [
      "Real, regulated markets via Kalshi",
      "Financial, political, and economic events",
      "Thousands of live markets to browse",
    ],
    cta: "Explore Predictions →",
    picture: {
      prompt: "Buy YES: Fed cuts rates in March",
      eyebrow: "Market Price",
      value: "68¢",
      tableTitle: "Prediction Market",
      kind: "alloc",
      rows: [
        { sym: "YES", name: "Fed cuts rates",   price: "68¢", pct: 68, color: "#156040" },
        { sym: "NO",  name: "Fed holds steady", price: "32¢", pct: 32, color: "#963626" },
      ],
      confirm: "Order filled · 42 shares",
    },
  },
];

/* ─── Agentic Trading (step flow + strategy showcase) ───
   Highlights the Trading Agent product — the real 4-step flow (configure,
   watch, confirm, execute) is the same one shown on the in-app Trading
   Agent page itself, redrawn for this dark section rather than shared
   verbatim, since that page's own CSS assumes a light background. */
const AGENT_STEPS = [
  { icon: "configure", label: "Set a strategy", sub: "Describe it in plain English" },
  { icon: "watch", label: "Agent watches", sub: "Checks the market on a schedule" },
  { icon: "confirm", label: "You confirm", sub: "Review every proposal yourself" },
  { icon: "execute", label: "Trade executes", sub: "Signed by your own wallet, never ours" },
];

const AGENT_STEP_ICONS = {
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

function AgentStepArrow() {
  return (
    <svg className="lp-agent-step-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

// Same four strategy types the real Trading Agent page supports — one
// color per card, continuing the green family already used across this
// section rather than introducing a new palette.
// Explicit `badge` overrides — Dollar-Cost Averaging and Delta-Neutral
// Hedge otherwise both default to a "D" monogram (FlowChip's fallback is
// just the name's first letter), which reads as a mistake sitting side by
// side in the grid.
const AGENT_STRATEGIES = [
  { name: "Dollar-Cost Averaging", badge: "DCA", blurb: "Buy a fixed amount on a recurring schedule, no matter what the market's doing.", color: "#2F6B50" },
  { name: "Delta-Neutral Hedge", badge: "Δ", blurb: "Pair a spot position with an offsetting perp to collect funding while staying market-neutral.", color: "#4C8A69" },
  { name: "TWAP / VWAP Execution", badge: "T/V", blurb: "Split a large order into slices over hours, so one trade doesn't move the price against you.", color: "#6FA98A" },
  { name: "Price Triggers", badge: "TRG", blurb: "Stop-loss, take-profit, buy-the-dip, or breakout-buy — set a price, the agent watches for it.", color: "#9AC4A8" },
];

// Wordmark-only treatment (no icon marks) for every partner — deliberate,
// not a placeholder: several of these (Coinbase, Kalshi, DFlow) don't have
// a logo file in /public/logos yet, and mixing raster logos for some
// entries with plain text for others would look unfinished. Brand color
// (Coinbase blue, Kalshi green, etc.) carries the identity instead of an
// icon; swap in real logo files later by rendering an <img> here instead.
// Reused here for the strategy-type cards below, same treatment.
function FlowChip({ name, blurb, color, gradient, caps, badge }) {
  const textStyle = gradient
    ? {
        backgroundImage: "linear-gradient(90deg, #9945FF, #14F195)",
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
      }
    : color
    ? { color }
    : undefined;
  // Same color that colors the name also fills a small monogram badge —
  // one consistent identity per partner instead of a plain bullet, without
  // needing an actual logo file for the ones we don't have.
  const badgeStyle = gradient
    ? { backgroundImage: "linear-gradient(135deg, #9945FF, #14F195)" }
    : { backgroundColor: color || "var(--pine)" };
  // Defaults to the name's first letter (fine when every item in a group
  // starts with a different letter); pass an explicit `badge` when two
  // items in the same grid would otherwise collide on the same initial.
  const badgeText = badge ?? name.trim().charAt(0).toUpperCase();
  return (
    <div className="lp-flow-chip">
      <span className={`lp-flow-chip-badge ${badgeText.length > 1 ? "lp-flow-chip-badge-wide" : ""}`} style={badgeStyle}>{badgeText}</span>
      <span className="lp-flow-chip-body">
        <span className={`serif lp-flow-chip-name ${caps ? "lp-flow-chip-caps" : ""}`} style={textStyle}>{name}</span>
        <span className="tiny muted lp-flow-chip-blurb">{blurb}</span>
      </span>
    </div>
  );
}

function AgenticTradingSection({ onLogin }) {
  return (
    <section className="lp-section lp-flow-section">
      <div className="lp-container">
        <p className="eyebrow lp-flow-eyebrow" style={{ textAlign: "center" }}>Bonzai Trading Agents</p>
        <h2 className="lp-section-title lp-dark-title" style={{ textAlign: "center" }}>Agentic trading, on autopilot</h2>
        <p className="lp-assets-sub">
          Set a strategy once, in plain English — a recurring buy, a delta-neutral hedge, a TWAP execution,
          or a price trigger. Your agent watches the market and proposes the trade when it's time; nothing
          executes until you review it and sign with your own wallet.
        </p>

        <div className="lp-agent-steps">
          {AGENT_STEPS.map((s, i) => (
            <Fragment key={s.label}>
              <div className="lp-agent-step">
                <div className="lp-agent-step-icon">{AGENT_STEP_ICONS[s.icon]}</div>
                <div className="lp-agent-step-text">
                  <p className="lp-agent-step-label">{s.label}</p>
                  <p className="lp-agent-step-sub">{s.sub}</p>
                </div>
              </div>
              {i < AGENT_STEPS.length - 1 && <AgentStepArrow />}
            </Fragment>
          ))}
        </div>

        <div className="lp-flow-chips lp-agent-strategy-grid">
          {AGENT_STRATEGIES.map((s) => <FlowChip key={s.name} {...s} />)}
        </div>

        <div style={{ textAlign: "center", marginTop: 40 }}>
          <button className="btn primary lp-cta-btn" onClick={onLogin}>Set up a Trading Agent →</button>
        </div>
      </div>
    </section>
  );
}

/* ─── Infrastructure ─── */
const INFRA = [
  { name: "Tokenized stocks by Backed & Ondo", logo: "/logos/xstocks.svg" },
  { name: "Jupiter",           logo: "/logos/jupiter.svg" },
  { name: "Privy",             logo: "/logos/privy.png" },
  { name: "Solana",            logo: "/logos/solana.svg" },
  { name: "Kamino",            logo: "/logos/kamino.png" },
  { name: "Hyperliquid",       logo: "/logos/hyperliquid.png" },
];

/* ─── Main component ─── */
export default function LandingPage({ onLogin }) {
  const [wordIdx, setWordIdx] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const activeProduct = PRODUCT_TABS[activeTab];

  return (
    <div className="landing">

      {/* ── Hero ── */}
      <section className="lp-hero">
        <img className="lp-hero-bg" src="/hero-bonsai.jpg" alt="" />
        <div className="lp-hero-bg-overlay" />
<div className="lp-center">
          <h1 className="lp-headline">
            Your perfect{" "}
            <span className="lp-headline-word" key={wordIdx}>{HEADLINE_WORDS[wordIdx]}</span>
            {" "}is one prompt away
          </h1>
          <div className="lp-demo-wrap">
            <DemoAnimation onSceneChange={setWordIdx} />
          </div>
          <div className="lp-hero-cta">
            <button className="btn primary lp-cta-btn" onClick={onLogin}>Get started →</button>
          </div>
        </div>
      </section>

      {/* ── Assets marquee ── */}
      <section className="lp-section lp-assets-section">
        <div className="lp-container" style={{ textAlign: "center", marginBottom: 40 }}>
          <h2 className="lp-section-title lp-dark-title">
            167 tokenized stocks<br />and ETFs
          </h2>
          <p className="lp-assets-sub">
            From Apple and NVIDIA to SpaceX, Palantir, and Gold —
            every major equity available 24 / 7 on Solana.
          </p>
        </div>
        <div className="lp-marquees">
          <MarqueeRow items={ROW1} reverse={false} />
          <MarqueeRow items={ROW2} reverse={true} />
        </div>
      </section>

      {/* ── Bonzai Trading Products (tabbed) ── */}
      <section className="lp-section lp-products-tabbed">
        <div className="lp-container">
          <p className="eyebrow" style={{ textAlign: "center" }}>Bonzai Trading Products</p>
          <h2 className="lp-section-title" style={{ textAlign: "center" }}>One app, every market</h2>

          <div className="lp-tab-row" role="tablist">
            {PRODUCT_TABS.map((p, i) => (
              <button key={p.key} role="tab" aria-selected={i === activeTab}
                className={`lp-tab-btn ${i === activeTab ? "active" : ""}`}
                onClick={() => setActiveTab(i)}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="lp-tab-panel">
            <div className="lp-tab-picture">
              <ProductPicture key={activeProduct.key} {...activeProduct.picture} />
            </div>
            <div className="lp-product-content">
              <div className="lp-product-top">
                <div className="lp-product-icon">{activeProduct.icon}</div>
                {activeProduct.tag && <span className="lp-product-tag">{activeProduct.tag}</span>}
              </div>
              <h3 className="lp-product-title">{activeProduct.title}</h3>
              <p className="lp-product-body">{activeProduct.body}</p>
              <ul className="lp-product-points">
                {activeProduct.points.map((pt) => <li key={pt}>{pt}</li>)}
              </ul>
              <button className="btn ghost lp-product-btn" onClick={onLogin}>{activeProduct.cta}</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agentic Trading ── */}
      <AgenticTradingSection onLogin={onLogin} />

      {/* ── Infrastructure ── */}
      <section className="lp-section lp-infra-section">
        <div className="lp-container">
          <p className="tiny muted" style={{ textAlign: "center", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 28 }}>
            Powered by
          </p>
          <div className="lp-infra">
            {INFRA.map((p) => (
              <div key={p.name} className="lp-infra-item">
                <img className="lp-infra-logo" src={p.logo} alt="" />
                <span className="lp-infra-name serif">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-section lp-final-cta">
        <div className="lp-container" style={{ textAlign: "center" }}>
          <h2 className="lp-cta-headline">Build your portfolio today</h2>
          <p className="lp-cta-sub">
            Sign up in seconds. Your first portfolio is one sentence away.
          </p>
          <button className="btn lp-cta-main-btn" onClick={onLogin}>Get started →</button>
          <p className="lp-legal">
            Tokenized stocks by Backed &amp; Ondo · routing by Jupiter · wallets by Privy · Solana mainnet<br />
            Not available to US persons or residents of restricted jurisdictions.
          </p>
        </div>
      </section>

    </div>
  );
}
