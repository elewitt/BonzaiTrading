/**
 * Arbitrum gas sponsor — tops up a user's EVM wallet with a small amount of
 * ETH so they can complete the final Hyperliquid Bridge2 deposit step.
 *
 * Mirrors the existing Solana sponsor pattern in index.js (sponsorBudgetOk/
 * trackSponsorSpend) but on a different chain — built after a real deposit
 * got stuck: USDC arrived on Arbitrum via deBridge, but the wallet had no
 * ETH to pay for the approve+deposit transactions into Hyperliquid, and sat
 * there indefinitely with no way to recover without funding it manually.
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

const ARB_RPC = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const SPONSOR_KEY = process.env.ARBITRUM_SPONSOR_PRIVATE_KEY || "";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
// A wallet stuck exactly where this exists to help ALWAYS has real USDC
// sitting on Arbitrum already (that's the whole scenario — deBridge
// delivered it, but the Bridge2 deposit step needs gas to finish). Anyone
// calling this endpoint without real USDC there isn't a legitimate stuck
// deposit, just a free-ETH request — this is the primary anti-abuse gate,
// tying top-ups to genuine recoverable funds rather than any address a
// caller supplies.
const MIN_USDC_TO_QUALIFY = 1_000_000n; // $1 (6 decimals)
const ERC20_BALANCE_OF_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }],
}];

const account = SPONSOR_KEY ? privateKeyToAccount(SPONSOR_KEY) : null;
const publicClient = createPublicClient({ chain: arbitrum, transport: http(ARB_RPC) });
const walletClient = account ? createWalletClient({ account, chain: arbitrum, transport: http(ARB_RPC) }) : null;

if (!account) {
  console.warn("[arbitrumSponsor] ARBITRUM_SPONSOR_PRIVATE_KEY not set — Arbitrum gas top-ups unavailable.");
}

export const arbitrumSponsorAddress = account?.address || null;

// Same daily-cap backstop pattern as the Solana sponsor.
const DAILY_CAP_WEI = parseEther(process.env.ARBITRUM_SPONSOR_DAILY_ETH_CAP || "0.01");
let spendDay = null;
let spendWei = 0n;
function budgetOk(wei) {
  const today = new Date().toISOString().slice(0, 10);
  if (spendDay !== today) { spendDay = today; spendWei = 0n; }
  return spendWei + wei <= DAILY_CAP_WEI;
}
function trackSpend(wei) {
  const today = new Date().toISOString().slice(0, 10);
  if (spendDay !== today) { spendDay = today; spendWei = 0n; }
  spendWei += wei;
}

/**
 * Tops up `targetAddress` up to `minWei` if it's currently below that, using
 * the sponsor wallet. No-op (returns { topped: false }) if already funded,
 * sponsor isn't configured, or the daily budget is exhausted.
 */
export async function ensureArbitrumGas(targetAddress, minWei) {
  // BigInt doesn't survive JSON.stringify (Express's res.json would throw)
  // — every returned balance is converted to a decimal string.
  if (!walletClient) return { topped: false, reason: "sponsor not configured" };

  const usdcBalance = await publicClient.readContract({
    address: ARB_USDC, abi: ERC20_BALANCE_OF_ABI, functionName: "balanceOf", args: [targetAddress],
  });
  if (usdcBalance < MIN_USDC_TO_QUALIFY) {
    return { topped: false, reason: "no qualifying USDC balance on Arbitrum for this address" };
  }

  const balance = await publicClient.getBalance({ address: targetAddress });
  if (balance >= minWei) return { topped: false, balance: balance.toString() };

  const topup = minWei - balance;
  if (!budgetOk(topup)) return { topped: false, reason: "sponsor daily budget exhausted", balance: balance.toString() };

  console.log(`[arbitrumSponsor] topping up ${targetAddress.slice(0, 8)} with ${formatEther(topup)} ETH`);
  let hash;
  try {
    hash = await walletClient.sendTransaction({ to: targetAddress, value: topup });
  } catch (e) {
    // Sponsor wallet itself out of funds — a real, expected-until-funded
    // state, not a caller error. Don't leak the raw viem error (account
    // addresses, full technical detail) to API responses.
    console.error("[arbitrumSponsor] sponsor wallet couldn't send top-up:", e.message);
    return { topped: false, reason: "sponsor wallet needs funding" };
  }
  await publicClient.waitForTransactionReceipt({ hash });
  trackSpend(topup);
  console.log(`[arbitrumSponsor] top-up confirmed: ${hash}`);
  return { topped: true, hash, balance: (balance + topup).toString() };
}
