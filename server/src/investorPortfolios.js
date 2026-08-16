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
 *
 * None of this implies affiliation with, endorsement by, or review from any
 * of these investors or funds — see the disclaimer rendered alongside this
 * data in web/src/PortfoliosApp.jsx.
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
];
