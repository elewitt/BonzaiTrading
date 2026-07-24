/**
 * CCTP V2 deposit rail — Circle's native USDC burn-and-mint bridge, an
 * alternative to deBridge for the "usdc already on Solana" source asset.
 * Unlike DLN (deBridge), there's no solver/liquidity margin: burning $X on
 * Solana mints exactly $X on Arbitrum once Circle's attestation service
 * signs off, so the only real cost is network gas (already sponsored on
 * the Arbitrum leg). See burnInstruction.js for the Solana-side mechanics
 * and server/src/cctp.js for the attestation-poll + sponsor-relayed mint.
 *
 * Plugs into the same Provider/Io split every rail uses (see debridge.js) —
 * advance()/completeHlDeposit() are identical across rails (BridgeProviderBase),
 * only quote() and the actual source-chain signing differ.
 */
import { Connection } from "@solana/web3.js";
import { PROTOCOL } from "../config.js";
import { API_BASE } from "../../lib/api.js";
import { BridgeProviderBase } from "./bridgeProviderBase.js";
import { buildDepositForBurnInstruction } from "./cctp/burnInstruction.js";
import { checkHlReady as checkHlReadyShared, completeHlDeposit as completeHlDepositShared } from "./arbitrumHlDeposit.js";

export class CctpProvider extends BridgeProviderBase {
  constructor(io) {
    super();
    this.rail = "cctp_usdc";
    this.io = io;
  }

  async quote(inputAmount, user) {
    // Same output shape DeBridgeProvider.quote() produces — DepositWizard's
    // quote-comparison UI reads rail/estimatedUsdcOut/estimatedSeconds off
    // every provider's result uniformly, regardless of which rail it came
    // from. Returning io.fetchQuote()'s raw {usdcOut, feeUsd, etaSeconds}
    // here directly left estimatedUsdcOut undefined, crashing the render
    // (a real bug against a real deposit attempt: "Cannot read properties
    // of undefined (reading 'toFixed')").
    const q = await this.io.fetchQuote(inputAmount, user.evm);
    return {
      rail: this.rail,
      estimatedUsdcOut: q.usdcOut,
      estimatedSeconds: q.etaSeconds,
      feeUsd: q.feeUsd,
    };
  }
}

export class RealCctpIo {
  /**
   * @param {object} opts
   * @param {(instruction, messageSentEventKeypair) => Promise<string>} opts.signAndSendCctpBurn
   *   Wraps the instruction in a Transaction, co-signs with the ephemeral
   *   event keypair, gets the user's signature, submits, and returns the
   *   Solana tx signature. Built in PerpsApp.jsx (needs the Privy signing
   *   hook, which funding/*.js files deliberately stay agnostic of).
   * @param {(params: {to, data, chainId, gasLimit, value?}) => Promise<string>} opts.sendEvmTx
   * @param {string} opts.rpcUrl
   */
  constructor({ signAndSendCctpBurn, sendEvmTx, rpcUrl }) {
    this._signAndSendCctpBurn = signAndSendCctpBurn;
    this._sendEvmTx = sendEvmTx;
    this._connection = new Connection(rpcUrl || "https://api.mainnet-beta.solana.com", "confirmed");
  }

  async fetchQuote(inputAmount) {
    if (!(inputAmount >= PROTOCOL.MIN_BRIDGE2_DEPOSIT_USDC)) {
      throw new Error(`amount is below the $${PROTOCOL.MIN_BRIDGE2_DEPOSIT_USDC} bridge minimum`);
    }
    // CCTP V2 Standard Transfer (maxFee=0, the tier this always uses — see
    // burnInstruction.js) is a native 1:1 burn-and-mint, no solver margin
    // like deBridge's DLN — what you burn is exactly what mints. The only
    // real cost is Solana's own tiny network fee, already priced into the
    // wallet's SOL balance elsewhere, not worth itemizing as a fee here.
    // etaSeconds is an estimate (Solana finality + Circle attestation +
    // sponsor relay), not a live quote — CCTP has no per-transfer pricing
    // API the way a liquidity-based bridge does.
    return { usdcOut: inputAmount, feeUsd: 0, etaSeconds: 120 };
  }

  async createAndSendOrder(state) {
    const { inputSol: amountUsdc, user } = state; // "inputSol" is the generic field name every rail's amount goes in, not literally SOL — see DepositOrchestrator.start()
    const amountAtoms = BigInt(Math.round(amountUsdc * 1e6));
    const { instruction, messageSentEventKeypair } = await buildDepositForBurnInstruction({
      connection: this._connection,
      solanaSender: user.solana,
      evmRecipient: user.evm,
      amountAtoms,
    });
    const txSig = await this._signAndSendCctpBurn(instruction, messageSentEventKeypair);
    // orderId doubles as the Solana burn tx signature — the only handle
    // Circle's attestation API and our own relay-status endpoint need.
    return { txSig, orderId: txSig };
  }

  async isOrderFulfilled(orderId) {
    const r = await fetch(`${API_BASE}/api/perps/cctp/deposit-status/${encodeURIComponent(orderId)}`);
    if (!r.ok) return false;
    const { status } = await r.json();
    return status === "relayed";
  }

  async checkHlReady(evmAddress) {
    return checkHlReadyShared(evmAddress);
  }

  async completeHlDeposit(evmAddress) {
    return completeHlDepositShared(evmAddress, this._sendEvmTx);
  }
}
