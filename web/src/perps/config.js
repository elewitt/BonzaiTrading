export const PROTOCOL = {
  MAX_PERP_BUILDER_FEE_TENTHS_BPS: 100,
  MAX_SPOT_BUILDER_FEE_TENTHS_BPS: 1000,
  MIN_BRIDGE2_DEPOSIT_USDC: 5,
  MIN_UNIT_SOL_DEPOSIT: 0.2,
  ARBITRUM_NATIVE_USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  BRIDGE2_ADDRESS: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7",
  BACKSTOP_MM_FRACTION: 2 / 3,
  MAX_BUILDER_APPROVALS_PER_USER: 10,
};

export const DEFAULT_CONFIG = {
  network: import.meta.env.VITE_HL_NETWORK || "testnet",
  builderAddress: import.meta.env.VITE_HL_BUILDER_ADDRESS || "0x0000000000000000000000000000000000000000",
  builderFeeTenthsBps: 70, // 7bps — still within the 0.08% approval ceiling below, so this applies to already-approved customers with no re-signature needed
  approvalMaxFeeRate: "0.08%",
};

// "xyz" is a real HIP-3 builder-deployed perp dex on Hyperliquid offering
// stocks/ETFs/commodities/indices/FX as perpetuals (AAPL, TSLA, GOLD, SILVER,
// SP500, EWY/EWZ ETFs, etc) — confirmed via the live meta/perpDexs API,
// distinct from Hyperliquid's own crypto-only default dex. It has
// independent margining (confirmed via clearinghouseState with dex="xyz"
// returning a separate $0 balance for an account funded on the main dex) —
// trading it needs USDC moved over explicitly (via sendAsset — Hyperliquid's
// "dexAbstraction" auto-unify opt-in is confirmed broken server-side, see
// useHyperliquid.js's useMoveDexFunds).
export const EQUITY_DEX = "xyz";
export const EQUITY_DEX_LABEL = "Equities";
