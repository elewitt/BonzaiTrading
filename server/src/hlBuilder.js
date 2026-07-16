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
