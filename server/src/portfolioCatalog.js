/**
 * Curated multi-stock "theme baskets" for the Portfolios page — plain
 * editorial data, no logic. Weights are computed at serve time (equal-split
 * across whatever symbols actually resolve against the live registry, see
 * index.js's /api/portfolios route) rather than hand-authored here, so
 * adding/removing a symbol never requires touching a weight number.
 *
 * Every symbol below is a raw on-chain registry key (the real ticker + "x"
 * suffix for tokenized stocks — see XSTOCKS_RAW in tokens.js), except BTC,
 * which has no xStock suffix. This is deliberate: it's what plan.allocations
 * and registry[symbol] lookups throughout the app already expect, so a
 * basket picked here flows straight into the existing weight-editor/buy
 * path with no symbol translation needed.
 */
export const PORTFOLIO_CATALOG = [
  { id: "magnificent-seven", name: "Magnificent Seven", category: "Mega-Cap Tech",
    tagline: "The seven mega-cap tech leaders driving the market.",
    symbols: ["AAPLx", "MSFTx", "GOOGLx", "AMZNx", "METAx", "NVDAx", "TSLAx"] },
  { id: "ai-semiconductors", name: "AI & Semiconductors", category: "Tech & Growth",
    tagline: "Chipmakers and AI infrastructure powering the buildout.",
    symbols: ["NVDAx", "AMDx", "AVGOx", "TSMx", "MRVLx", "ASMLx", "AMATx"] },
  { id: "dividend-blue-chips", name: "Dividend Blue Chips", category: "Dividend & Income",
    tagline: "Steady, cash-generative household names.",
    symbols: ["JNJx", "PGx", "KOx", "MCDx", "HDx", "WMTx"] },
  { id: "banking-giants", name: "Banking & Payments Giants", category: "Financials",
    tagline: "The banks and payment networks moving the world's money.",
    symbols: ["JPMx", "BACx", "GSx", "MAx", "Vx", "PYPLx"] },
  { id: "crypto-adjacent", name: "Crypto & Digital Assets", category: "Crypto-Adjacent",
    tagline: "Public-market exposure to crypto, from exchanges to miners to Bitcoin itself.",
    symbols: ["COINx", "MSTRx", "MARAx", "RIOTx", "HOODx", "BTC"] },
  { id: "cloud-software", name: "Enterprise Cloud & Software", category: "Tech & Growth",
    tagline: "The software stack running the modern enterprise.",
    symbols: ["CRMx", "ORCLx", "ADBEx", "CRWDx", "NETx", "PANWx"] },
];
