import { useState } from "react";
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
    body: "Borrow USDC against your tokenized stocks and ETFs without selling — powered by Kamino Finance's live xStocks lending market.",
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

/* ─── How Bonzai Trading Works (step flow) ───
   Distinct from the Products tabs above (what you can do) — this walks
   through the stack underneath it (what's actually moving your funds),
   one layer at a time: the wallet, the assets, the protocols executing
   trades, and the chain everything settles on. */
// Inactive nav tabs use these — one cohesive green family (matching the
// section's own dark-green field) rather than a different hue per step —
// the active tab turns solid white instead (see .lp-flow-tab.active) so it
// visually fuses with the card below it.
const STEP_GRADIENTS = {
  wallet: "linear-gradient(135deg, #2F6B50, #163427)",
  assets: "linear-gradient(135deg, #4C8A69, #1F4E39)",
  defi: "linear-gradient(135deg, #6FA98A, #2C6449)",
  network: "linear-gradient(135deg, #9AC4A8, #3D7A5C)",
};

const HOW_IT_WORKS = [
  {
    key: "wallet",
    label: "Wallet",
    title: "One wallet, fully yours",
    body: "Sign in with just an email — Privy creates a self-custodial embedded wallet behind the scenes, spanning Solana and Arbitrum. Bonzai Trading never holds your keys or your funds; every trade, deposit, and withdrawal is signed by a wallet only you control.",
    points: [
      "No seed phrases, no browser extension — just email",
      "Self-custodial by default — we never hold your keys or funds",
      "One wallet covers Solana and Arbitrum automatically",
    ],
    chips: [
      { name: "Privy", blurb: "Embedded, self-custodial wallet infrastructure" },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    title: "Real assets, tokenized 1:1",
    body: "Every position you hold is backed by the real thing — tokenized equities, regulated stablecoins, and yield-bearing cash, issued by regulated partners and settled on-chain.",
    points: [
      "167 tokenized stocks and ETFs, issued 1:1 by Backed's xStocks",
      "USDC and EURC — Coinbase's regulated stablecoins",
      "USDY — Ondo Finance's yield-bearing tokenized Treasury note",
    ],
    chips: [
      { name: "xStocks", blurb: "167 tokenized stocks & ETFs, by Backed" },
      { name: "Coinbase", blurb: "USDC & EURC regulated stablecoins", color: "#0052FF" },
      { name: "Ondo Finance", blurb: "USDY yield-bearing Treasury token" },
    ],
  },
  {
    key: "defi",
    label: "Trading",
    title: "Execution on real, audited protocols",
    body: "Every trade is a real on-chain transaction, routed through established DeFi infrastructure — never an internal ledger. You hold custody at every step, from quote to settlement.",
    points: [
      "Jupiter — instant spot swaps between any asset, with no loss of custody",
      "Hyperliquid — leveraged crypto and equity perpetual futures",
      "Kamino — borrow directly against tokenized equity or crypto positions",
      "Kalshi, via DFlow — regulated, tokenized prediction market positions",
    ],
    chips: [
      { name: "Jupiter", blurb: "Instant spot swaps, no custody loss" },
      { name: "Hyperliquid", blurb: "Crypto & equity perpetual futures" },
      { name: "KAMINO", blurb: "Borrow against tokenized positions", caps: true },
      { name: "Kalshi", blurb: "Regulated prediction markets", color: "#00A67E" },
      { name: "DFlow", blurb: "Tokenization & routing layer", color: "#2D5DA8" },
    ],
  },
  {
    key: "network",
    label: "Network",
    title: "Settled on Solana",
    body: "Every trade, swap, and position lives on Solana — sub-second finality and fees measured in fractions of a cent, so markets that used to take days to settle now settle before you finish reading this.",
    points: [
      "Sub-second transaction finality",
      "Fees measured in fractions of a cent",
      "Every position is a real, verifiable on-chain transaction",
    ],
    chips: [
      { name: "Solana", blurb: "High-performance settlement layer", gradient: true },
    ],
  },
];

// Wordmark-only treatment (no icon marks) for every partner — deliberate,
// not a placeholder: several of these (Coinbase, Kalshi, DFlow) don't have
// a logo file in /public/logos yet, and mixing raster logos for some
// entries with plain text for others would look unfinished. Brand color
// (Coinbase blue, Kalshi green, etc.) carries the identity instead of an
// icon; swap in real logo files later by rendering an <img> here instead.
function FlowChip({ name, blurb, color, gradient, caps }) {
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
  return (
    <div className="lp-flow-chip">
      <span className="lp-flow-chip-badge" style={badgeStyle}>{name.trim().charAt(0).toUpperCase()}</span>
      <span className="lp-flow-chip-body">
        <span className={`serif lp-flow-chip-name ${caps ? "lp-flow-chip-caps" : ""}`} style={textStyle}>{name}</span>
        <span className="tiny muted lp-flow-chip-blurb">{blurb}</span>
      </span>
    </div>
  );
}

function HowItWorksSection({ onLogin }) {
  const [step, setStep] = useState(0);
  const active = HOW_IT_WORKS[step];
  const last = HOW_IT_WORKS.length - 1;

  return (
    <section className="lp-section lp-flow-section">
      <div className="lp-container">
        <h2 className="lp-section-title lp-dark-title" style={{ textAlign: "center" }}>Tokenized Trading Simplified</h2>

        <div className="lp-flow-nav" role="tablist">
          {HOW_IT_WORKS.map((s, i) => (
            <button key={s.key} role="tab" aria-selected={i === step}
              className={`lp-flow-tab ${i === step ? "active" : ""}`}
              style={i === step ? undefined : { backgroundImage: STEP_GRADIENTS[s.key] }}
              onClick={() => setStep(i)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="lp-flow-card" key={active.key}>
          <div className="lp-flow-panel">
            <div className="lp-flow-text">
              <h3 className="lp-product-title">{active.title}</h3>
              <p className="lp-product-body">{active.body}</p>
              <ul className="lp-product-points">
                {active.points.map((pt) => <li key={pt}>{pt}</li>)}
              </ul>
            </div>
            <div className="lp-flow-chips">
              {active.chips.map((c) => <FlowChip key={c.name} {...c} />)}
            </div>
          </div>
        </div>

        <div className="lp-flow-arrows">
          <button className="btn ghost lp-flow-arrow-btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← Back</button>
          <button className="btn ghost lp-flow-arrow-btn" onClick={() => (step === last ? onLogin() : setStep((s) => s + 1))}>
            {step === last ? "Get started →" : "Next →"}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Infrastructure ─── */
const INFRA = [
  { name: "xStocks by Backed", logo: "/logos/xstocks.svg" },
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

      {/* ── How Bonzai Trading Works ── */}
      <HowItWorksSection onLogin={onLogin} />

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
            xStocks by Backed · routing by Jupiter · wallets by Privy · Solana mainnet<br />
            Not available to US persons or residents of restricted jurisdictions.
          </p>
        </div>
      </section>

    </div>
  );
}
