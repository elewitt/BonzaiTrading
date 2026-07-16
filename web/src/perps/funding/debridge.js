/**
 * DeBridge provider — testnet stub.
 * Quotes a realistic estimate; advance() simulates the deposit flow with delays.
 * Replace this.io with a real DeBridgeIo implementation for mainnet.
 */
import { PROTOCOL } from "../config.js";

export class DeBridgeProvider {
  // srcAsset: "sol" (default) or "usdc" — which Solana-side asset this
  // instance bridges FROM. Each asset gets its own rail id so both can be
  // registered side by side and quoted independently (they aren't
  // comparable the way two SOL-bridging providers would be — the input
  // amount means a different asset depending on which is picked).
  constructor(io, srcAsset = "sol") {
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

  async advance(state) {
    switch (state.step) {
      case "QUOTING":
      case "SWAPPING_SOL_TO_USDC":
        return { ...state, step: "BRIDGING", updatedAt: Date.now() };

      case "BRIDGING": {
        if (!state.legs.bridgeTxId) {
          const { txSig, orderId } = await this.io.createAndSendOrder(state);
          return {
            ...state,
            legs: { ...state.legs, swapTxSig: txSig, bridgeTxId: orderId },
            step: "AWAITING_HL_CREDIT",
            updatedAt: Date.now(),
          };
        }
        return { ...state, step: "AWAITING_HL_CREDIT", updatedAt: Date.now() };
      }

      case "AWAITING_HL_CREDIT": {
        // Polling only ever CHECKS readiness (order fulfilled + gas
        // present) — it never attempts the actual approve+deposit
        // signatures itself. Those require a real user click (see
        // completeHlDeposit below and realDebridge.js's class comment) —
        // a real stuck deposit confirmed that attempting them from this
        // background poll silently never completes, even with gas present.
        const fulfilled = await this.io.isOrderFulfilled(state.legs.bridgeTxId);
        if (!fulfilled) return state;
        const readiness = await this.io.checkHlReady(state.user.evm);
        if (!readiness.ready) {
          return {
            ...state,
            legs: { ...state.legs, hlDepositError: readiness.error, needsArbGas: !!readiness.needsGas, readyForHlDeposit: false },
            updatedAt: Date.now(),
          };
        }
        if (state.legs.readyForHlDeposit) return state; // already surfaced, wait for the user's click
        return {
          ...state,
          legs: { ...state.legs, readyForHlDeposit: true, hlDepositError: null, needsArbGas: false },
          updatedAt: Date.now(),
        };
      }

      default:
        return state;
    }
  }

  /**
   * Called directly by DepositOrchestrator.completeDeposit(), NOT part of
   * the advance()/resume() polling loop — only invoke this from a real user
   * click (e.g. a "Complete Deposit" button), never from a timer.
   */
  async completeHlDeposit(state) {
    const result = await this.io.completeHlDeposit(state.user.evm);
    if (!result.credited) {
      return {
        ...state,
        legs: { ...state.legs, hlDepositError: result.error },
        updatedAt: Date.now(),
      };
    }
    return {
      ...state,
      legs: { ...state.legs, hlCreditObserved: true, hlDepositError: null, readyForHlDeposit: false },
      step: "DONE",
      updatedAt: Date.now(),
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
