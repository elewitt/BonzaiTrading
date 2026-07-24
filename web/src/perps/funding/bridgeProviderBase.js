/**
 * Shared deposit state machine for any "Solana/Arbitrum source → lands on
 * Arbitrum → Bridge2 into Hyperliquid" rail. Every such rail (deBridge,
 * CCTP, any future one) goes through the exact same steps — only how the
 * source-chain leg is quoted/executed differs, which is why this only
 * requires an `io` object shaped like:
 *   - fetchQuote(inputAmount, evmRecipient, srcAsset?) -> {usdcOut, feeUsd, etaSeconds}
 *   - createAndSendOrder(state) -> {txSig, orderId}
 *   - isOrderFulfilled(orderId) -> boolean
 *   - checkHlReady(evmAddress) -> {ready, needsGas?, error?}   (read-only)
 *   - completeHlDeposit(evmAddress) -> {credited, error?}      (real signing)
 *
 * Subclasses only need to implement quote() (rails price differently —
 * deBridge calls a server quote endpoint, CCTP computes locally since
 * Standard Transfer has no protocol fee) and set this.rail/this.io.
 */
export class BridgeProviderBase {
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
        // completeHlDeposit below) — a real stuck deposit confirmed
        // attempting them from a background poll silently never completes,
        // even with gas present.
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
