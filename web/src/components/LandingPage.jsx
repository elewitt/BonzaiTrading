import DemoAnimation from "./DemoAnimation.jsx";

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

/* ─── Step illustrations ─── */
function Sparkle() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  );
}

function IllustPrompt() {
  const assets = [
    { sym: "NVDA", pct: "20%", color: "#A78BFA" },
    { sym: "AAPL", pct: "20%", color: "#60A5FA" },
    { sym: "MSFT", pct: "12%", color: "#34D399" },
    { sym: "TSLA", pct:  "8%", color: "#F97316" },
    { sym: "SPY",  pct: "20%", color: "#FBBF24" },
    { sym: "GLD",  pct: "20%", color: "#D4A843" },
  ];
  return (
    <div className="lp-illust lp-illust--prompt">
      <div className="lp-illust-input">
        <Sparkle />
        <span>60% big tech, 20% S&amp;P 500, 20% gold</span>
      </div>
      <div className="lp-illust-down-arrow">
        <svg width="14" height="18" viewBox="0 0 14 18" fill="none"
          stroke="rgba(255,255,255,.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="7" y1="0" x2="7" y2="12"/><polyline points="3,8 7,14 11,8"/>
        </svg>
      </div>
      <div className="lp-illust-chips">
        {assets.map(a => (
          <div key={a.sym} className="lp-illust-chip" style={{ borderColor: a.color + "33" }}>
            <span className="lp-illust-chip-dot" style={{ background: a.color }} />
            <span className="lp-illust-chip-sym" style={{ color: a.color }}>{a.sym}</span>
            <span className="lp-illust-chip-pct">{a.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IllustExecution() {
  const trades = [
    { sym: "NVDA", time: "1.2s", done: true },
    { sym: "AAPL", time: "0.9s", done: true },
    { sym: "SPY",  time: "1.5s", done: true },
    { sym: "GLD",  time: "…",    done: false },
  ];
  return (
    <div className="lp-illust lp-illust--exec">
      <div className="lp-illust-exec-header">
        <div className="lp-illust-live"><span className="lp-illust-live-dot" />LIVE</div>
        <div className="lp-illust-247">24/7</div>
        <div className="lp-illust-exec-sub">Markets never close</div>
      </div>
      <div className="lp-illust-exec-rows">
        {trades.map(t => (
          <div key={t.sym} className={`lp-illust-exec-row ${t.done ? "done" : "live"}`}>
            <span className="lp-illust-exec-icon">{t.done ? "✓" : "↑"}</span>
            <span className="lp-illust-exec-sym">{t.sym}</span>
            <div className="lp-illust-exec-track">
              <div className={`lp-illust-exec-fill ${t.done ? "done" : "live"}`} />
            </div>
            <span className="lp-illust-exec-time">{t.time}</span>
          </div>
        ))}
      </div>
      <div className="lp-illust-exec-footer">⬡ Confirmed on Solana</div>
    </div>
  );
}

function IllustRebalance() {
  const before = [
    { sym: "NVDA", w: 12, color: "#A78BFA" },
    { sym: "AAPL", w: 42, color: "#60A5FA" },
    { sym: "SPY",  w: 38, color: "#FBBF24" },
    { sym: "GLD",  w:  8, color: "#D4A843" },
  ];
  const after = [
    { sym: "NVDA", w: 28, color: "#A78BFA" },
    { sym: "AAPL", w: 25, color: "#60A5FA" },
    { sym: "SPY",  w: 27, color: "#FBBF24" },
    { sym: "GLD",  w: 20, color: "#D4A843" },
  ];
  return (
    <div className="lp-illust lp-illust--rebal">
      <div className="lp-illust-rebal-cols">
        <div className="lp-illust-rebal-col">
          <div className="lp-illust-rebal-colhead">Before</div>
          {before.map(r => (
            <div key={r.sym} className="lp-illust-rebal-row">
              <span className="lp-illust-rebal-sym">{r.sym}</span>
              <div className="lp-illust-rebal-track">
                <div className="lp-illust-rebal-fill" style={{ width: `${r.w * 2.2}%`, background: r.color + "88" }} />
              </div>
              <span className="lp-illust-rebal-pct" style={{ color: r.color + "99" }}>{r.w}%</span>
            </div>
          ))}
        </div>
        <div className="lp-illust-rebal-mid">↺</div>
        <div className="lp-illust-rebal-col">
          <div className="lp-illust-rebal-colhead">After</div>
          {after.map(r => (
            <div key={r.sym} className="lp-illust-rebal-row">
              <span className="lp-illust-rebal-sym">{r.sym}</span>
              <div className="lp-illust-rebal-track">
                <div className="lp-illust-rebal-fill" style={{ width: `${r.w * 2.2}%`, background: r.color }} />
              </div>
              <span className="lp-illust-rebal-pct" style={{ color: r.color }}>{r.w}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-illust-rebal-prompt">
        <Sparkle />
        <span>More NVDA, reduce S&amp;P exposure</span>
      </div>
    </div>
  );
}

/* ─── Products: Perps & Borrow/Lend ─── */
const PRODUCTS = [
  {
    key: "perps",
    screenshot: "/perps-screenshot.png",
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
  },
  {
    key: "borrow",
    screenshot: "/borrow-markets-screenshot.png",
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
  },
];

/* ─── Features ─── */
const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    title: "Self-custodied",
    body: "Your wallet, your keys. An embedded Solana wallet is created for you — no seed phrase, no custodian, no middlemen.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
    ),
    title: "Real-time execution",
    body: "Trades route through Jupiter's liquidity aggregator for best-price swaps, confirmed on-chain in seconds.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    title: "167 assets",
    body: "Every major stock and ETF available 24/7 — from Apple and NVIDIA to SpaceX, Palantir, and Gold.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
    ),
    title: "AI-powered allocation",
    body: "Claude maps your plain-English investment thesis to exact token allocations — names, percentages, or just a vibe.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    title: "Yield on idle cash",
    body: "Uninvested USDC earns ~5% APY automatically via USDY. Turn it on or off in one click.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    title: "Full transparency",
    body: "Every swap logged, every trade linkable to Solscan. Your complete portfolio history, searchable in the app.",
  },
];

/* ─── Infrastructure ─── */
const INFRA = [
  { name: "xStocks by Backed", desc: "Tokenized equities" },
  { name: "Jupiter",           desc: "DEX routing" },
  { name: "Privy",             desc: "Embedded wallets" },
  { name: "Solana",            desc: "L1 blockchain" },
];

/* ─── Main component ─── */
export default function LandingPage({ onLogin }) {
  return (
    <div className="landing">

      {/* ── Hero ── */}
      <section className="lp-hero">
<div className="lp-center">
          <h1 className="lp-headline">Your perfect portfolio<br />is one prompt away</h1>
          <div className="lp-demo-wrap">
            <DemoAnimation />
          </div>
          <div className="lp-hero-cta">
            <button className="btn primary lp-cta-btn" onClick={onLogin}>Get started →</button>
            <p className="tiny muted" style={{ textAlign: "center" }}>
              No seed phrase · self-custodied · non-US residents only
            </p>
          </div>
        </div>
      </section>

      {/* ── Assets marquee ── */}
      <section className="lp-section lp-assets-section">
        <div className="lp-container" style={{ textAlign: "center", marginBottom: 40 }}>
          <p className="eyebrow lp-dark-eyebrow">Available now</p>
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

      {/* ── How it works ── */}
      <section className="lp-section lp-how">
        <div className="lp-container">
          <p className="eyebrow" style={{ textAlign: "center" }}>How it works</p>
          <h2 className="lp-section-title">From idea to invested<br />in seconds</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">01</div>
              <h3 className="lp-step-title">Prompt</h3>
              <p className="lp-step-body">
                Type your investment thesis in plain English. Claude researches
                the best matching assets and maps them to exact allocations — ready to trade.
              </p>
              <IllustPrompt />
            </div>
            <div className="lp-step">
              <div className="lp-step-num">02</div>
              <h3 className="lp-step-title">Instant Trade Execution 24/7</h3>
              <p className="lp-step-body">
                Review every swap before it runs, then execute in one click.
                Trades route through Jupiter and settle on-chain in seconds — any time, any day.
              </p>
              <IllustExecution />
            </div>
            <div className="lp-step">
              <div className="lp-step-num">03</div>
              <h3 className="lp-step-title">Rebalance Portfolio</h3>
              <p className="lp-step-body">
                Markets move. Prompt again to shift your weights, add new positions,
                or trim exposure — Bonzai Trading recalculates and rebalances instantly.
              </p>
              <IllustRebalance />
            </div>
          </div>
        </div>
      </section>

      {/* ── Products: Perps & Borrow/Lend ── */}
      <section className="lp-section lp-products-section">
        <div className="lp-container">
          <p className="eyebrow lp-dark-eyebrow" style={{ textAlign: "center" }}>Beyond the brokerage</p>
          <h2 className="lp-section-title lp-dark-title" style={{ textAlign: "center" }}>
            Trade with leverage.<br />Borrow against what you hold.
          </h2>
          <div className="lp-products">
            {PRODUCTS.map((p) => (
              <div key={p.key} className="lp-product-card">
                <div className="lp-product-shot-wrap">
                  <img className="lp-product-shot" src={p.screenshot} alt={`${p.title} screen`} />
                </div>
                <div className="lp-product-content">
                  <div className="lp-product-top">
                    <div className="lp-product-icon">{p.icon}</div>
                    {p.tag && <span className="lp-product-tag">{p.tag}</span>}
                  </div>
                  <h3 className="lp-product-title">{p.title}</h3>
                  <p className="lp-product-body">{p.body}</p>
                  <ul className="lp-product-points">
                    {p.points.map((pt) => <li key={pt}>{pt}</li>)}
                  </ul>
                  <button className="btn ghost lp-product-btn" onClick={onLogin}>{p.cta}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="lp-section lp-features-section">
        <div className="lp-container">
          <p className="eyebrow" style={{ textAlign: "center" }}>Everything you need</p>
          <h2 className="lp-section-title" style={{ textAlign: "center" }}>Built for serious investors</h2>
          <div className="lp-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature">
                <div className="lp-feature-icon">{f.icon}</div>
                <h4 className="lp-feature-title">{f.title}</h4>
                <p className="lp-feature-body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Infrastructure ── */}
      <section className="lp-section lp-infra-section">
        <div className="lp-container">
          <p className="tiny muted" style={{ textAlign: "center", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 28 }}>
            Powered by
          </p>
          <div className="lp-infra">
            {INFRA.map((p) => (
              <div key={p.name} className="lp-infra-item">
                <span className="lp-infra-name serif">{p.name}</span>
                <span className="lp-infra-desc tiny muted">{p.desc}</span>
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
