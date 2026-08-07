import { USDC } from "./tokens.js";

/**
 * Shared between the web confirm path (strategyRoutes.js's /build route)
 * and the Telegram confirm path (telegram.js's handleStrategyConfirm), so
 * both resolve a leg's real trade amount — and record the same state
 * afterward — the exact same way. This was the actual bug behind a
 * TWAP confirmation failing with "Invalid amount" via Telegram: that path
 * only ever knew about DCA's precomputed leg.amount convention, so a
 * delta-neutral/TWAP/VWAP leg (which carries `usd` instead) resolved to
 * `String(undefined)`. Fixing it required extracting this logic instead
 * of just patching the one call site, since a duplicate copy would only
 * drift out of sync again the next time a new strategy type/leg shape
 * is added.
 */

/** Resolves ONE spot leg into a real atomic-unit amount. `leg.amount`
 * (DCA's precomputed-atomic-units convention) is used as-is when present.
 * Delta-neutral/TWAP/VWAP legs never carry a precomputed amount for a
 * SELL — a sell amount computed when the proposal was created could be
 * stale by confirm time — so `usd`/`sellAll` legs resolve their real
 * atomic amount from LIVE holdings/prices right here. Buys always
 * resolve fresh from `usd` (USDC's decimals never change, so this is
 * safe to compute at confirm time without a precomputed amount at all). */
export async function resolveSpotLegAmount(leg, walletAddress, { getHoldingsForAddress, getPricesForMints }) {
  if (leg.amount != null) return String(leg.amount);
  if (leg.side === "buy") return String(Math.floor(leg.usd * 10 ** USDC.decimals));

  const holdings = await getHoldingsForAddress(walletAddress);
  const held = holdings.tokens?.find((t) => t.mint === leg.inputMint);
  if (!held || Number(held.amount) === 0) throw new Error(`No ${leg.symbol} balance to sell.`);
  if (leg.sellAll) return held.amount;

  const prices = await getPricesForMints([leg.inputMint]);
  const price = prices[leg.inputMint];
  if (!price) throw new Error(`No live price available for ${leg.symbol} right now.`);
  // Never sell more than what's actually held, even if the usd target
  // (computed from a possibly-stale price snapshot at evaluate time)
  // would work out to more.
  return String(Math.min(Math.floor((leg.usd / price) * 10 ** held.decimals), Number(held.amount)));
}

/** Updates strategy state/status after a confirmed execution, based on
 * which kind of proposal it was — the one place this branching lives, so
 * the web and Telegram confirm paths can never drift apart on it again. */
export async function applyStrategyExecutionState(proposal, walletAddress, { touchStrategyEvaluated, setStrategyStatus }) {
  if (proposal.kind === "delta_neutral_open") {
    const now = new Date().toISOString();
    await touchStrategyEvaluated(proposal.strategy_id, { state: { openedAt: now, lastFundingCheckedAt: now } });
  } else if (proposal.kind === "delta_neutral_exit") {
    await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
  } else if (proposal.kind === "twap_slice" || proposal.kind === "vwap_slice") {
    // The confirmed slice's own leg carries sliceIndex/totalSlices (set
    // when the proposal was created — see strategyAgents/sliceExecution.js),
    // so the next filledSlices count comes from the proposal itself rather
    // than needing to re-fetch and re-derive the strategy's state.
    const leg = proposal.legs.find((l) => l.domain === "spot");
    const nextFilled = (leg?.sliceIndex ?? 0) + 1;
    if (leg && nextFilled >= leg.totalSlices) {
      await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
    } else {
      await touchStrategyEvaluated(proposal.strategy_id, { state: { filledSlices: nextFilled } });
    }
  } else if (proposal.kind !== "delta_neutral_rebalance") {
    // dca_buy — delta_neutral_rebalance needs no state change here at
    // all: evaluate() recomputes drift fresh from live holdings/perp
    // positions on the next tick regardless.
    await touchStrategyEvaluated(proposal.strategy_id, { state: { lastExecutedAt: new Date().toISOString() } });
  }
}
