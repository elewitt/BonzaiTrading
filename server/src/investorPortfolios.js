/**
 * "Legendary Investor" portfolios — unlike PORTFOLIO_CATALOG (Bonzai's own
 * editorial theme baskets), these are grounded in real, public SEC 13F
 * disclosures (or, for ARK, its own published daily holdings) of well-known
 * investors and funds. Only holdings that are ALSO tradeable in Bonzai's own
 * registry are included — most of these funds hold many more positions than
 * what's listed here, so `symbols` is a subset, not a full replica.
 *
 * Sourced (see /api/portfolios' asOf field, shown to users as a disclaimer):
 *  - Berkshire Hathaway: Q2 2026 13F (filed 2026-08-14). Top holdings AAPL,
 *    AXP, KO, GOOGL, BAC — AXP isn't in Bonzai's registry, dropped.
 *  - ARK Invest (ARKK): published holdings. Top names include TSLA, SpaceX,
 *    Tempus AI, CRISPR Therapeutics, COIN, AMD — only TSLA/SPCX/COIN/AMD are
 *    in the registry (Tempus AI, CRISPR Therapeutics aren't).
 *  - Pershing Square: Q1 2026 13F (filed 2026-05-15). Top holdings BN
 *    (Brookfield), AMZN, UBER, MSFT, QSR — BN and QSR aren't in the
 *    registry, dropped.
 *  - Situational Awareness LP (Leopold Aschenbrenner): last 13F before the
 *    fund unwound its public-equity book in 2026 — an AI-compute-buildout
 *    bet (GPU/HPC hosting, power, silicon/optics supply chain). This is a
 *    HISTORICAL snapshot, not an active fund's current portfolio — the
 *    tagline says so explicitly.
 *  - Bridgewater Associates: Q1 2026 13F. Top holdings SPY, IVV, AMZN, NVDA,
 *    GOOGL — IVV isn't in the registry, dropped. Attributed to the firm, not
 *    to Ray Dalio personally — he sold his final stake and left the board
 *    in 2025, so this is no longer his portfolio.
 *  - George Soros / Soros Fund Management: Q1 2026 13F. Top/notable holdings
 *    SPY, AMZN, TSM, NVDA, GOOGL, AAPL, EA — EA isn't in the registry,
 *    dropped.
 *  - David Tepper / Appaloosa Management: Q1 2026 13F. Top 5 holdings AMZN,
 *    MU, GOOGL, UBER, TSM — all in the registry.
 *  - Steve Cohen / Point72 Asset Management: Q1 2026 13F. Top 5 holdings
 *    NVDA, AMZN, ANET, ASML, CRDO — CRDO isn't in the registry, dropped.
 *  - Daniel Loeb / Third Point: Q1 2026 13F. Notable holdings AMZN, MSFT,
 *    TSM among others — most of the rest (PCG, TDS, CRH, TPX, CRS, NSC,
 *    COF) aren't in the registry, dropped, leaving a thinner 3-symbol set.
 *  - Nancy Pelosi: U.S. House member financial disclosure under the STOCK
 *    Act (public record, not a managed fund) — 2026 disclosed holdings
 *    concentrated in mega-cap tech: NVDA, AAPL, MSFT, AMZN, GOOGL, AVGO.
 *    Framed neutrally as a public disclosure, not investment advice or
 *    political commentary.
 *
 * The 20 entries below (added in a second pass, bringing the total to 30)
 * follow the exact same rule: real, sourced 13F holdings (mostly Q1 2026,
 * a few blending the most recent 1-2 quarters where sourcing was mixed —
 * `asOf` says "recent 13F filings" rather than a specific quarter in those
 * cases, to avoid overclaiming precision), every symbol individually
 * cross-checked against the live registry, only the resolvable subset
 * kept. A handful of researched funds were dropped entirely rather than
 * included thin or misleading: Michael Burry/Scion (his last 13F holdings
 * — Molina, Lululemon, SLM, Bruker — have zero registry overlap, and his
 * newer disclosed position is short-dated NVDA/PLTR puts, not a "buy
 * this" long book), Carl Icahn, Elliott Management, GAMCO, Greenlight
 * Capital, Greenoaks, Voss Capital, and several others whose real
 * holdings are dominated by small/mid-caps, options, or non-US listings
 * outside this app's ~167-symbol registry. A few funds without one widely
 * recognized individual "face" (Alkeon, Farallon, Two Sigma) use the
 * firm's own name as `investor` and a short descriptor as `fund`, rather
 * than inventing a spokesperson.
 *
 * None of this implies affiliation with, endorsement by, or review from any
 * of these investors, funds, or public officials — see the disclaimer
 * rendered alongside this data in web/src/PortfoliosApp.jsx.
 */
export const INVESTOR_PORTFOLIOS = [
  { id: "warren-buffett", investor: "Warren Buffett", fund: "Berkshire Hathaway",
    asOf: "Q2 2026 13F",
    tagline: "The Oracle of Omaha's largest public equity bets.",
    symbols: ["AAPLx", "KOx", "GOOGLx", "BACx"] },
  { id: "cathie-wood", investor: "Cathie Wood", fund: "ARK Invest",
    asOf: "ARKK holdings",
    tagline: "Disruptive-innovation bets from ARK's flagship fund.",
    symbols: ["TSLAx", "SPCXx", "COINx", "AMDx"] },
  { id: "bill-ackman", investor: "Bill Ackman", fund: "Pershing Square",
    asOf: "Q1 2026 13F",
    tagline: "Concentrated, activist-style positions in a handful of names.",
    symbols: ["AMZNx", "UBERx", "MSFTx"] },
  { id: "situational-awareness", investor: "Leopold Aschenbrenner", fund: "Situational Awareness LP",
    asOf: "last 13F before winding down",
    tagline: "A bet on the AI compute buildout — chips, optics, and datacenter power.",
    symbols: ["INTCx", "LITEx", "CORZx", "APLDx", "IRENx", "SNDKx"] },
  { id: "bridgewater", investor: "Bridgewater Associates", fund: "Founded by Ray Dalio",
    asOf: "Q1 2026 13F",
    tagline: "The world's largest hedge fund's largest public equity bets.",
    symbols: ["SPYx", "AMZNx", "NVDAx", "GOOGLx"] },
  { id: "george-soros", investor: "George Soros", fund: "Soros Fund Management",
    asOf: "Q1 2026 13F",
    tagline: "A permanent-capital family office's core equity holdings.",
    symbols: ["SPYx", "AMZNx", "TSMx", "NVDAx", "GOOGLx", "AAPLx"] },
  { id: "david-tepper", investor: "David Tepper", fund: "Appaloosa Management",
    asOf: "Q1 2026 13F",
    tagline: "A concentrated, mega-cap-tech-heavy hedge fund portfolio.",
    symbols: ["AMZNx", "MUx", "GOOGLx", "UBERx", "TSMx"] },
  { id: "steve-cohen", investor: "Steve Cohen", fund: "Point72 Asset Management",
    asOf: "Q1 2026 13F",
    tagline: "Top holdings from one of the largest multi-strategy hedge funds.",
    symbols: ["NVDAx", "AMZNx", "ANETx", "ASMLx"] },
  { id: "daniel-loeb", investor: "Daniel Loeb", fund: "Third Point",
    asOf: "Q1 2026 13F",
    tagline: "Event-driven, activist-style bets from an outspoken hedge fund manager.",
    symbols: ["AMZNx", "MSFTx", "TSMx"] },
  { id: "nancy-pelosi", investor: "Nancy Pelosi", fund: "U.S. House of Representatives",
    asOf: "2026 STOCK Act disclosure",
    tagline: "Publicly disclosed holdings, concentrated in mega-cap tech.",
    symbols: ["NVDAx", "AAPLx", "MSFTx", "AMZNx", "GOOGLx", "AVGOx"] },

  { id: "tiger-global", investor: "Chase Coleman", fund: "Tiger Global Management",
    asOf: "Q1 2026 13F",
    tagline: "A concentrated bet on AI hardware and hyperscalers.",
    symbols: ["GOOGLx", "NVDAx", "AMZNx", "TSMx", "METAx"] },
  { id: "coatue", investor: "Philippe Laffont", fund: "Coatue Management",
    asOf: "Q1 2026 13F",
    tagline: "Tech-centric positioning across semiconductors and cloud infrastructure.",
    symbols: ["TSMx", "GEVx", "LRCXx", "AMATx", "AVGOx", "ASMLx"] },
  { id: "bill-gates", investor: "Bill Gates", fund: "Cascade Investment",
    asOf: "Q1 2026 13F",
    tagline: "The personal wealth manager's largest public equity bets.",
    symbols: ["AAPLx", "VTIx", "MSFTx", "AMATx", "AMZNx"] },
  { id: "paul-tudor-jones", investor: "Paul Tudor Jones", fund: "Tudor Investment Corp",
    asOf: "recent 13F filings",
    tagline: "A legendary macro trader's largest equity and index bets.",
    symbols: ["TSMx", "MSFTx", "NVDAx", "MUx", "QQQx", "AMZNx"] },
  { id: "altimeter", investor: "Brad Gerstner", fund: "Altimeter Capital",
    asOf: "Q1 2026 13F",
    tagline: "A concentrated bet on AI infrastructure and hyperscalers.",
    symbols: ["NVDAx", "METAx", "UBERx", "TSMx", "MSFTx", "AMZNx"] },
  { id: "alkeon", investor: "Alkeon Capital", fund: "Tech-focused hedge fund",
    asOf: "Q1 2026 13F",
    tagline: "Large, concentrated bets on semiconductors and cloud platforms.",
    symbols: ["TSMx", "GOOGLx", "METAx", "AMZNx", "KLACx"] },
  { id: "maverick", investor: "Lee Ainslie", fund: "Maverick Capital",
    asOf: "recent 13F filings",
    tagline: "A Tiger Cub's concentrated bets on AI and mega-cap tech.",
    symbols: ["NVDAx", "AMZNx", "TSMx", "ASMLx", "MSFTx", "GOOGLx"] },
  { id: "whale-rock", investor: "Alex Sacerdote", fund: "Whale Rock Capital",
    asOf: "Q1 2026 13F",
    tagline: "A dedicated technology fund's top public equity stakes.",
    symbols: ["GOOGLx", "SNDKx", "AMZNx"] },
  { id: "renaissance", investor: "Jim Simons", fund: "Renaissance Technologies",
    asOf: "Q1 2026 13F",
    tagline: "The legendary quant fund's largest disclosed equity stakes.",
    symbols: ["AAPLx", "MUx", "PLTRx"] },
  { id: "adage", investor: "Adage Capital Partners", fund: "Multi-billion-dollar equity fund",
    asOf: "Q1 2026 13F",
    tagline: "A multi-billion-dollar fund's largest mega-cap tech bets.",
    symbols: ["NVDAx", "AAPLx", "MSFTx", "AMZNx", "GOOGLx"] },
  { id: "hound-partners", investor: "Jonathan Auerbach", fund: "Hound Partners",
    asOf: "Q1 2026 13F",
    tagline: "A concentrated long/short fund's highest-conviction bets.",
    symbols: ["NVDAx", "PLTRx", "HOODx"] },
  { id: "gqg", investor: "Rajiv Jain", fund: "GQG Partners",
    asOf: "recent 13F filings",
    tagline: "A contrarian global-equity investor's largest public bets.",
    symbols: ["PMx", "MSFTx", "METAx"] },
  { id: "discovery-capital", investor: "Rob Citrone", fund: "Discovery Capital Management",
    asOf: "recent 13F filings",
    tagline: "A macro fund's bets on semiconductors and AI infrastructure.",
    symbols: ["SNDKx", "MUx", "IRENx", "JPMx"] },
  { id: "soroban", investor: "Eric Mandelblatt", fund: "Soroban Capital Partners",
    asOf: "Q1 2026 13F",
    tagline: "Concentrated positions in mega-cap tech and payments.",
    symbols: ["MSFTx", "METAx", "AMZNx", "MAx"] },
  { id: "farallon", investor: "Farallon Capital", fund: "Multi-strategy hedge fund",
    asOf: "Q1 2026 13F",
    tagline: "A multi-strategy fund's largest disclosed equity positions.",
    symbols: ["SPYx", "AMZNx", "MSFTx"] },
  { id: "ken-fisher", investor: "Ken Fisher", fund: "Fisher Asset Management",
    asOf: "recent 13F filings",
    tagline: "One of the largest independent money managers' top holdings.",
    symbols: ["NVDAx", "AAPLx", "GOOGLx", "MSFTx"] },
  { id: "two-sigma", investor: "Two Sigma", fund: "Quantitative hedge fund",
    asOf: "Q1 2026 13F",
    tagline: "A quantitative hedge fund's largest disclosed equity stakes.",
    symbols: ["NVDAx", "AAPLx", "AMZNx", "GOOGLx", "TSLAx"] },
  { id: "marshall-wace", investor: "Marshall Wace", fund: "Paul Marshall & Ian Wace",
    asOf: "recent 13F filings",
    tagline: "A global multi-strategy fund's largest public equity bets.",
    symbols: ["NVDAx", "AAPLx", "AMZNx", "AMDx"] },
  { id: "al-gore", investor: "Al Gore", fund: "Generation Investment Management",
    asOf: "Q1 2026 13F",
    tagline: "A sustainability-focused fund's largest public equity bets.",
    symbols: ["MSFTx", "DHRx", "AMZNx", "GOOGLx", "Vx"] },
  { id: "polen-capital", investor: "Polen Capital", fund: "Concentrated growth fund",
    asOf: "recent 13F filings",
    tagline: "A concentrated growth fund's largest quality-compounder bets.",
    symbols: ["MSFTx", "GOOGLx", "LLYx", "AVGOx", "AMZNx", "ORCLx"] },
];
