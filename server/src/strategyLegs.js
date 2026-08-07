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

/** Computes ONE slice's real fill price from the raw Jupiter order amounts
 * (inAmount/outAmount, atomic units — see get-order in Jupiter's Ultra API
 * docs) captured at build/confirm time by whichever client path executed
 * it (web's executeProposal.js, or Telegram's handleStrategyConfirm).
 * Needs a registry lookup for the output asset's decimals; USDC's are
 * fixed. Best-effort — returns null (never throws) on anything missing or
 * unparseable, since a missed fill-price record shouldn't block recording
 * that the trade itself executed. */
async function computeFillPrice(spotFill, outputMint, getRegistry) {
  if (!spotFill?.inAmount || !spotFill?.outAmount || !getRegistry) return null;
  try {
    const { byMint } = await getRegistry();
    const outToken = byMint[outputMint];
    if (!outToken) return null;
    const usdIn = Number(spotFill.inAmount) / 10 ** USDC.decimals;
    const qtyOut = Number(spotFill.outAmount) / 10 ** outToken.decimals;
    if (!(qtyOut > 0) || !(usdIn > 0)) return null;
    return { price: usdIn / qtyOut, usd: usdIn };
  } catch {
    return null;
  }
}

/** Updates strategy state/status after a confirmed execution, based on
 * which kind of proposal it was — the one place this branching lives, so
 * the web and Telegram confirm paths can never drift apart on it again.
 *
 * `spotFill` ({inAmount, outAmount} from the executed order, or null when
 * unavailable) powers TWAP/VWAP execution-quality tracking — each
 * confirmed slice appends its real fill price to state.fills, so the
 * strategy card can show actual average fill vs. a lump-sum-at-start
 * baseline (params.startPrice, captured live at strategy creation — see
 * strategyRoutes.js's resolveParams). touchStrategyEvaluated replaces
 * `state` wholesale rather than merging, so appending requires reading
 * the CURRENT state first via getStrategyById. */
export async function applyStrategyExecutionState(proposal, walletAddress, spotFill, { touchStrategyEvaluated, setStrategyStatus, getStrategyById, getRegistry }) {
  if (proposal.kind === "delta_neutral_open") {
    const now = new Date().toISOString();
    await touchStrategyEvaluated(proposal.strategy_id, { state: { openedAt: now, lastFundingCheckedAt: now } });
  } else if (proposal.kind === "delta_neutral_exit") {
    await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
  } else if (proposal.kind === "trigger_fill") {
    // One-time by nature — unlike DCA's recurring schedule, a trigger
    // fires at most once and is done.
    await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
  } else if (proposal.kind === "twap_slice" || proposal.kind === "vwap_slice") {
    // The confirmed slice's own leg carries sliceIndex/totalSlices (set
    // when the proposal was created — see strategyAgents/sliceExecution.js),
    // so the next filledSlices count comes from the proposal itself rather
    // than needing to re-fetch and re-derive the strategy's state.
    const leg = proposal.legs.find((l) => l.domain === "spot");
    const nextFilled = (leg?.sliceIndex ?? 0) + 1;

    let fills;
    const current = getStrategyById ? await getStrategyById(proposal.strategy_id, walletAddress).catch(() => null) : null;
    const priorFills = current?.state?.fills || [];
    const fill = await computeFillPrice(spotFill, leg?.outputMint, getRegistry);
    fills = fill ? [...priorFills, { sliceIndex: leg.sliceIndex, price: fill.price, usd: fill.usd, ts: new Date().toISOString() }] : priorFills;

    if (leg && nextFilled >= leg.totalSlices) {
      await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
      // setStrategyStatus only touches the `status` column — the final
      // slice's own fill (if captured) still needs its own explicit write.
      if (fills.length) await touchStrategyEvaluated(proposal.strategy_id, { state: { filledSlices: nextFilled, fills } });
    } else {
      await touchStrategyEvaluated(proposal.strategy_id, { state: { filledSlices: nextFilled, fills } });
    }
  } else if (proposal.kind !== "delta_neutral_rebalance") {
    // dca_buy — delta_neutral_rebalance needs no state change here at
    // all: evaluate() recomputes drift fresh from live holdings/perp
    // positions on the next tick regardless.
    await touchStrategyEvaluated(proposal.strategy_id, { state: { lastExecutedAt: new Date().toISOString() } });
  }
}
