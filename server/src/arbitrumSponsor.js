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
// Hyperliquid's Arbitrum bridge contract — sending USDC here credits the
// SENDER's Hyperliquid account (their indexer watches this contract).
// Same address web/src/perps/config.js's BRIDGE2_ADDRESS uses client-side.
const HL_BRIDGE2_ADDRESS = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
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
const ERC20_TRANSFER_ABI = [{
  name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];
// CCTP V2's MessageTransmitterV2 — same deployed address on every EVM chain
// (confirmed via developers.circle.com's own published address table:
// identical value listed for Ethereum/Arbitrum/Base/Optimism/etc, and
// cross-checked against the "address" field embedded in Circle's own
// mainnet IDL). receiveMessage() is permissionless — the message itself
// (not the caller) determines who gets minted the USDC, so the sponsor
// wallet can relay this on the user's behalf.
const CCTP_MESSAGE_TRANSMITTER_V2_ADDRESS = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
const CCTP_RECEIVE_MESSAGE_ABI = [{
  name: "receiveMessage", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  outputs: [{ name: "", type: "bool" }],
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

/** Read-only — live ETH balance + today's spend, for an admin status view. */
export async function getArbitrumSponsorStatus() {
  if (!account) return { configured: false };
  const today = new Date().toISOString().slice(0, 10);
  const balanceWei = await publicClient.getBalance({ address: account.address });
  return {
    configured: true,
    address: account.address,
    balanceEth: formatEther(balanceWei),
    dailyCapEth: formatEther(DAILY_CAP_WEI),
    spentTodayEth: formatEther(spendDay === today ? spendWei : 0n),
  };
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

/**
 * Deposits this wallet's own USDC into its own Hyperliquid account — a
 * plain ERC-20 transfer to Hyperliquid's Bridge2 contract, the standard,
 * documented deposit mechanism (their indexer credits whoever sent the
 * funds). Self-transfer only: this always moves the sponsor wallet's own
 * funds into its own Hyperliquid account, never an arbitrary destination —
 * used once to fund the ≥100 USDC builder-fee eligibility requirement (see
 * hlBuilder.js), admin-triggered, not exposed to any customer-facing route.
 */
export async function depositToHyperliquid(amountUsdc) {
  if (!walletClient) throw new Error("Arbitrum sponsor wallet not configured");
  const amount = BigInt(Math.round(amountUsdc * 1e6)); // USDC has 6 decimals
  const balance = await publicClient.readContract({
    address: ARB_USDC, abi: ERC20_BALANCE_OF_ABI, functionName: "balanceOf", args: [account.address],
  });
  if (balance < amount) {
    throw new Error(`sponsor wallet only has ${Number(balance) / 1e6} USDC on Arbitrum, can't send ${amountUsdc}`);
  }
  const hash = await walletClient.writeContract({
    address: ARB_USDC, abi: ERC20_TRANSFER_ABI, functionName: "transfer",
    args: [HL_BRIDGE2_ADDRESS, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[arbitrumSponsor] deposited ${amountUsdc} USDC to Hyperliquid: ${hash}`);
  return { hash, amountUsdc };
}

/**
 * Relays a CCTP V2 attested message to Arbitrum's MessageTransmitterV2,
 * minting the burned USDC to whichever address the original burn
 * instruction named as mintRecipient (not the sponsor's own address —
 * receiveMessage is permissionless, the message itself carries the real
 * destination). Used to auto-complete CCTP deposits without a second user
 * signature: the user only signs the Solana burn, this sponsor-paid relay
 * does the rest once Circle's attestation is ready.
 *
 * MessageTransmitterV2 reverts if this message's nonce was already used —
 * the caller (cctp.js) tracks "already relayed" itself and shouldn't call
 * this twice for the same message, but if it ever does, the revert is a
 * harmless no-op (a small amount of wasted gas estimation), not a fund-loss
 * risk, since the contract's own nonce check is the real source of truth.
 */
export async function relayCctpMessage(message, attestation) {
  if (!walletClient) throw new Error("Arbitrum sponsor wallet not configured");
  const hash = await walletClient.writeContract({
    address: CCTP_MESSAGE_TRANSMITTER_V2_ADDRESS,
    abi: CCTP_RECEIVE_MESSAGE_ABI,
    functionName: "receiveMessage",
    args: [message, attestation],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[arbitrumSponsor] relayed CCTP message to Arbitrum: ${hash}`);
  return { hash };
}
