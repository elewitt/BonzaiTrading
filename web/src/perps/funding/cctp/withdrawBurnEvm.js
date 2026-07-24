/**
 * Builds the Arbitrum-side "depositForBurn" calldata for CCTP V2's withdraw
 * direction — burn USDC on Arbitrum, later minted into the user's own
 * Solana USDC account once Circle's attestation service signs off and the
 * Solana sponsor relays it (see server/src/cctpSolanaRelay.js).
 *
 * Much simpler than the deposit direction's Solana-side burn
 * (burnInstruction.js): this is a plain EVM contract call (ABI-encoded via
 * viem, same pattern the deBridge withdraw path already uses for its own
 * approve+order-creation), no PDAs or Anchor client needed — that
 * complexity only exists on the Solana side, which here is the *mint*
 * side (server-relayed, permissionless) rather than something the browser
 * has to build at all.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { encodeFunctionData } from "viem";

export const CCTP_TOKEN_MESSENGER_V2_ARBITRUM = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_CHAIN_ID = 42161;
const CCTP_SOLANA_DOMAIN = 5;
const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const ERC20_APPROVE_ABI = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];
const DEPOSIT_FOR_BURN_ABI = [{
  name: "depositForBurn", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
  ],
  outputs: [],
}];

/**
 * @param {object} opts
 * @param {bigint} opts.amountAtoms  USDC amount in 6-decimal atoms
 * @param {string} opts.solanaRecipient  User's own Solana wallet address —
 *   mintRecipient must be their USDC *token account* (ATA), not the wallet
 *   address itself, since Solana requires an explicit account to hold SPL
 *   tokens (confirmed against Circle's own reference: the EVM-side example
 *   passes a decoded token-account address, not a wallet pubkey, when the
 *   destination is Solana).
 * @returns {Promise<{approve: object, depositForBurn: object}>} tx params
 *   shaped for the existing sendEvmTx({to, data, chainId, gasLimit}) callback.
 */
export async function buildWithdrawBurnTxs({ amountAtoms, solanaRecipient }) {
  const recipientAta = await getAssociatedTokenAddress(SOLANA_USDC_MINT, new PublicKey(solanaRecipient));
  const mintRecipientHex = `0x${Buffer.from(recipientAta.toBytes()).toString("hex")}`;

  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI, functionName: "approve",
    args: [CCTP_TOKEN_MESSENGER_V2_ARBITRUM, amountAtoms],
  });
  const depositForBurnData = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_ABI, functionName: "depositForBurn",
    args: [
      amountAtoms,
      CCTP_SOLANA_DOMAIN,
      mintRecipientHex,
      ARB_USDC,
      ZERO_BYTES32, // destinationCaller = 0 → anyone (the Solana sponsor) may relay the mint
      0n,           // maxFee = 0 — Standard Transfer tier, no extra fee
      1000,         // minFinalityThreshold = 1000 — Standard (matches the deposit direction's choice)
    ],
  });

  return {
    approve: { to: ARB_USDC, data: approveData, chainId: ARB_CHAIN_ID, gasLimit: 100_000 },
    depositForBurn: { to: CCTP_TOKEN_MESSENGER_V2_ARBITRUM, data: depositForBurnData, chainId: ARB_CHAIN_ID, gasLimit: 250_000 },
  };
}
