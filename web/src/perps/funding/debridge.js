/**
 * DeBridge provider — testnet stub.
 * Quotes a realistic estimate; advance() simulates the deposit flow with delays.
 * Replace this.io with a real DeBridgeIo implementation for mainnet.
 */
import { PROTOCOL } from "../config.js";
import { BridgeProviderBase } from "./bridgeProviderBase.js";

export class DeBridgeProvider extends BridgeProviderBase {
  // srcAsset: "sol" (default) or "usdc" — which Solana-side asset this
  // instance bridges FROM. Each asset gets its own rail id so both can be
  // registered side by side and quoted independently (they aren't
  // comparable the way two SOL-bridging providers would be — the input
  // amount means a different asset depending on which is picked).
  constructor(io, srcAsset = "sol") {
    super();
    this.srcAsset = srcAsset;
    this.rail = srcAsset === "usdc" ? "debridge_usdc" : "debridge";
    this.io = io;
  }

  async quote(inputAmount, user) {
    const q = await this.io.fetchQuote(inputAmount, user.evm, this.srcAsset);
    if (q.usdcOut < PROTOCOL.MIN_BRIDGE2_DEPOSIT_USDC) {
      throw new Error(
        `quote of $${q.usdcOut.toFixed(2)} cash is below the $${PROTOCOL.MIN_BRIDGE2_DEPOSIT_USDC} bridge minimum`,
      );
    }
    return {
      rail: this.rail,
      estimatedUsdcOut: q.usdcOut,
      estimatedSeconds: q.etaSeconds,
      feeUsd: q.feeUsd,
    };
  }
}

/**
 * Demo IO — simulates the deposit flow without real bridge calls.
 * Useful for testnet UI development.
 */
export class DeBridgeDemoIo {
  constructor(solPrice = 150) {
    this._solPrice = solPrice;
    this._fulfilled = new Map();
    this._creditDelay = 12000; // 12 seconds simulated bridge time
  }

  async fetchQuote(inputSol, _evmRecipient) {
    const gross = inputSol * this._solPrice;
    const feeUsd = gross * 0.002 + 0.5;
    return {
      usdcOut: Math.max(0, gross - feeUsd),
      feeUsd,
      etaSeconds: 45,
    };
  }

  async createAndSendOrder(state) {
    const orderId = `demo_${state.id}_${Date.now()}`;
    // Simulate fulfillment after delay
    setTimeout(() => this._fulfilled.set(orderId, Date.now() + this._creditDelay), 0);
    return { txSig: `demoTx_${Date.now()}`, orderId };
  }

  async isOrderFulfilled(orderId) {
    const fulfilledAt = this._fulfilled.get(orderId);
    return fulfilledAt != null && Date.now() >= fulfilledAt;
  }

  async checkHlReady(_evm) {
    return { ready: true }; // demo: always ready once fulfilled
  }

  async completeHlDeposit(_evm) {
    return { credited: true }; // demo: credit immediately
  }
}
