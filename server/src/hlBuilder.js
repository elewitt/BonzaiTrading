import { HttpTransport, InfoClient, ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

/* ————— Hyperliquid builder-fee codes — claiming, mainnet-only —————
 * Distinct from hyperliquid.js (plain fetch, read-only admin lookups):
 * claiming rewards is a wallet-signed L1 action (claimRewards), so this
 * needs the real SDK for EIP-712 signing, not just fetch. Reads
 * ARBITRUM_SPONSOR_PRIVATE_KEY itself rather than importing
 * arbitrumSponsor.js — same self-contained-per-integration-file style as
 * referral.js/kamino.js/hyperliquid.js. This *is* the same wallet as
 * arbitrumSponsorAddress by design (see the plan): builder-fee revenue
 * funds the same Arbitrum gas-sponsorship budget that wallet already
 * covers.
 */
const SPONSOR_KEY = process.env.ARBITRUM_SPONSOR_PRIVATE_KEY || "";
const account = SPONSOR_KEY ? privateKeyToAccount(SPONSOR_KEY) : null;

const transport = new HttpTransport({ isTestnet: false });
const info = new InfoClient({ transport });
const exchange = account ? new ExchangeClient({ transport, wallet: account, isTestnet: false }) : null;

if (!account) {
  console.warn("[hlBuilder] ARBITRUM_SPONSOR_PRIVATE_KEY not set — builder-fee status/claim unavailable.");
}

export const builderAddress = account?.address || null;

// Hyperliquid's own eligibility requirement: a builder address must hold at
// least 100 USDC of perps account value to be allowed to charge fees at all.
const MIN_ELIGIBLE_USDC = 100;

/** Builder-fee status: eligibility (real perps account value, not assumed)
 * plus accrued rewards. Returns { configured: false } if the sponsor wallet
 * isn't set up — mirrors every other optional-integration convention here. */
export async function getBuilderFeeStatus() {
  if (!account) return { configured: false };
  const [referral, state] = await Promise.all([
    info.referral({ user: account.address }),
    info.clearinghouseState({ user: account.address }),
  ]);
  const perpsAccountValue = Number(state?.marginSummary?.accountValue ?? 0);
  return {
    configured: true,
    builderAddress: account.address,
    perpsAccountValue,
    eligible: perpsAccountValue >= MIN_ELIGIBLE_USDC,
    minEligibleUsdc: MIN_ELIGIBLE_USDC,
    unclaimedRewards: Number(referral.unclaimedRewards),
    claimedRewards: Number(referral.claimedRewards),
    builderRewards: Number(referral.builderRewards),
  };
}

/** Sweeps accrued builder-fee rewards into the sponsor wallet's own
 * balance. Manual/admin-triggered, same posture as the Jupiter fee claim. */
export async function claimBuilderRewards() {
  if (!exchange) throw new Error("Arbitrum sponsor wallet not configured");
  return exchange.claimRewards();
}

/**
 * One user's real perps trading volume + builder-fee revenue generated
 * since a given time — powers the referral dashboard's per-user perps
 * stats. `userFillsByTime` has no `dex` filter and returns fills across
 * every perp dex (main crypto + the "xyz" equities dex) in one combined
 * list already (confirmed via the SDK's request schema — no dex param
 * exists), matching how this app already treats Perps as a single
 * product spanning both dexs everywhere else (e.g. App.jsx's
 * perpsAccountValue). `info` here is a plain read-only client — not tied
 * to the builder/sponsor account — so it's safe to query any user's
 * address, not just our own.
 */
export async function getUserPerpsStats(evmAddress, sinceMs) {
  const fills = await info.userFillsByTime({ user: evmAddress, startTime: sinceMs });
  let volume = 0, fees = 0;
  for (const f of fills) {
    volume += Math.abs(Number(f.px) * Number(f.sz));
    fees += Number(f.builderFee || 0);
  }
  return { volume, fees };
}

/**
 * Withdraws USDC from the sponsor's OWN Hyperliquid account to an arbitrary
 * Arbitrum address — withdraw3's `destination` field isn't restricted to
 * the signer's own address, so this can land directly on a customer's
 * wallet in one step. Hyperliquid takes its standard flat $1 fee off the
 * requested amount automatically. Manual/admin-triggered only — used once
 * to correct a deposit that landed on the sponsor's account instead of a
 * customer's by mistake, not exposed to any customer-facing route.
 */
export async function withdrawFromSponsor(destination, amountUsdc) {
  if (!exchange) throw new Error("Arbitrum sponsor wallet not configured");
  return exchange.withdraw3({ destination, amount: String(amountUsdc) });
}
