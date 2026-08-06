import { USDC } from "../tokens.js";
import { getFundingHistory } from "../hyperliquid.js";

// Conservative, explicitly-capped defaults — this is a leveraged short on
// one leg, unlike DCA's zero-liquidation-risk spot buys. Leverage stays
// low deliberately: this is a market-neutral carry trade, not a
// directional bet, so higher leverage doesn't add expected return per
// unit of hedge — it only adds liquidation risk from basis/execution
// slippage between the two legs. These bounds were my own call (the user
// deferred the specifics), chosen to bias toward "won't get liquidated by
// normal volatility" over "maximum capital efficiency."
const MIN_NOTIONAL_USD = 50;
const MAX_NOTIONAL_USD = 50_000;
const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 3;
export const DEFAULT_LEVERAGE = 2;
const MIN_REBALANCE_THRESHOLD_PCT = 2;
const MAX_REBALANCE_THRESHOLD_PCT = 25;
export const DEFAULT_REBALANCE_THRESHOLD_PCT = 5;
const MIN_UNFAVORABLE_EXIT_HOURS = 4;
const MAX_UNFAVORABLE_EXIT_HOURS = 168; // 1 week
export const DEFAULT_UNFAVORABLE_EXIT_HOURS = 24;

/** Shape/range validation only — the caller (strategyRoutes.js) resolves
 * params.symbol against getDeltaNeutralEligibleAssets() (rejecting
 * anything not tradeable as BOTH a registry spot asset and a Hyperliquid
 * perp) and stamps spotMint/hlCoin/hlDex into params before calling
 * createStrategy — same "resolve once at creation, never re-derive"
 * pattern dca.js uses for its mint. Returns an error string, or null if
 * valid. */
function validateParams(params) {
  if (!params || typeof params !== "object") return "params required";
  if (!params.symbol || typeof params.symbol !== "string") return "symbol required";

  const notional = Number(params.notionalUsd);
  if (!Number.isFinite(notional) || notional < MIN_NOTIONAL_USD || notional > MAX_NOTIONAL_USD) {
    return `notionalUsd must be between $${MIN_NOTIONAL_USD} and $${MAX_NOTIONAL_USD.toLocaleString()}`;
  }
  const leverage = Number(params.leverage);
  if (!Number.isFinite(leverage) || leverage < MIN_LEVERAGE || leverage > MAX_LEVERAGE) {
    return `leverage must be between ${MIN_LEVERAGE}x and ${MAX_LEVERAGE}x`;
  }
  const rebalanceThresholdPct = Number(params.rebalanceThresholdPct);
  if (!Number.isFinite(rebalanceThresholdPct) || rebalanceThresholdPct < MIN_REBALANCE_THRESHOLD_PCT || rebalanceThresholdPct > MAX_REBALANCE_THRESHOLD_PCT) {
    return `rebalanceThresholdPct must be between ${MIN_REBALANCE_THRESHOLD_PCT}% and ${MAX_REBALANCE_THRESHOLD_PCT}%`;
  }
  const unfavorableFundingExitHours = Number(params.unfavorableFundingExitHours);
  if (!Number.isInteger(unfavorableFundingExitHours) || unfavorableFundingExitHours < MIN_UNFAVORABLE_EXIT_HOURS || unfavorableFundingExitHours > MAX_UNFAVORABLE_EXIT_HOURS) {
    return `unfavorableFundingExitHours must be a whole number between ${MIN_UNFAVORABLE_EXIT_HOURS} and ${MAX_UNFAVORABLE_EXIT_HOURS}`;
  }
  return null;
}

/** Consecutive unfavorable hourly funding prints since `since` — funding
 * prints land hourly on Hyperliquid (confirmed live), so "periods" and
 * "hours" are the same unit here. Short position ⇒ unfavorable means
 * fundingRate < 0 (shorts pay longs). Counts from the END of the history
 * backward so a single favorable print earlier in the window doesn't get
 * counted against a currently-unfavorable streak. */
async function countConsecutiveUnfavorableHours(hlCoin, since) {
  const history = await getFundingHistory({ coin: hlCoin, startTime: since.getTime() });
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (Number(history[i].fundingRate) < 0) count++;
    else break;
  }
  return count;
}

/**
 * evaluate() checks three things in order, first match wins:
 * 1. Not yet open → propose opening both legs.
 * 2. Open, but funding has been unfavorable for too many consecutive
 *    hours → propose closing both legs.
 * 3. Open, funding still favorable, but spot/perp values have drifted
 *    apart → propose a rebalancing spot trade.
 *
 * Spot legs never carry a precomputed atomic `amount` the way dca.js's
 * do — a sell amount computed now could be stale by the time the user
 * actually confirms (their held balance may have changed). Instead they
 * carry `usd` (a buy, or a partial sell sized in dollars) or `sellAll`
 * (a full exit) and strategyRoutes.js's /build route resolves the real
 * atomic amount from LIVE holdings/prices at build time — same
 * never-stale principle DCA already applies to Jupiter quotes, just
 * extended to the sell side too.
 *
 * `ctx.perpPositions` (from evaluator.js's buildContext) is this wallet's
 * live Hyperliquid positions across both dexs — read-only, matched by
 * `coin === params.hlCoin`, same shape getPerpsPositions() already
 * returns for the admin tool.
 */
async function evaluate(strategy, ctx) {
  const { params, state } = strategy;
  const underlying = params.symbol.replace(/x$/, "");

  if (!state?.openedAt) {
    return {
      kind: "delta_neutral_open",
      legs: [
        { domain: "spot", side: "buy", symbol: params.symbol, inputMint: USDC.mint, outputMint: params.spotMint, usd: params.notionalUsd },
        { domain: "perp", side: "short", hlCoin: params.hlCoin, hlDex: params.hlDex, notionalUsd: params.notionalUsd, leverage: params.leverage },
      ],
      summary: `Open delta-neutral: $${params.notionalUsd} long ${params.symbol} / short ${underlying} perp at ${params.leverage}x`,
    };
  }

  const fundingSince = state.lastFundingCheckedAt ? new Date(state.lastFundingCheckedAt) : new Date(state.openedAt);
  const unfavorableHours = await countConsecutiveUnfavorableHours(params.hlCoin, fundingSince);
  const stateAfterCheck = { ...state, lastFundingCheckedAt: new Date().toISOString() };

  if (unfavorableHours >= params.unfavorableFundingExitHours) {
    return {
      kind: "delta_neutral_exit",
      legs: [
        { domain: "spot", side: "sell", symbol: params.symbol, inputMint: params.spotMint, outputMint: USDC.mint, sellAll: true },
        { domain: "perp", side: "reduce", hlCoin: params.hlCoin, hlDex: params.hlDex },
      ],
      summary: `Close delta-neutral ${params.symbol}: funding has been unfavorable for ${unfavorableHours}+ consecutive hours`,
      newState: stateAfterCheck,
    };
  }

  const spotHolding = ctx.holdings?.tokens?.find((t) => t.mint === params.spotMint);
  const spotValueUsd = spotHolding ? (spotHolding.uiAmount || 0) * (ctx.prices?.[params.spotMint] || 0) : 0;
  const perpPosition = ctx.perpPositions?.find((p) => p.coin === params.hlCoin);
  const perpValueUsd = perpPosition ? perpPosition.size * perpPosition.markPx : 0;
  const driftPct = params.notionalUsd > 0 ? (Math.abs(spotValueUsd - perpValueUsd) / params.notionalUsd) * 100 : 0;

  if (driftPct > params.rebalanceThresholdPct) {
    const deltaUsd = Math.abs(perpValueUsd - spotValueUsd);
    const buyMoreSpot = perpValueUsd > spotValueUsd; // perp bigger (in $ terms) => spot lagging => buy more spot to catch up
    return {
      kind: "delta_neutral_rebalance",
      legs: [
        buyMoreSpot
          ? { domain: "spot", side: "buy", symbol: params.symbol, inputMint: USDC.mint, outputMint: params.spotMint, usd: deltaUsd }
          : { domain: "spot", side: "sell", symbol: params.symbol, inputMint: params.spotMint, outputMint: USDC.mint, usd: deltaUsd },
      ],
      summary: `Rebalance ${params.symbol}: spot/perp have drifted ${driftPct.toFixed(1)}% apart (threshold ${params.rebalanceThresholdPct}%)`,
      newState: stateAfterCheck,
    };
  }

  // Nothing due — still advance lastFundingCheckedAt so the next tick
  // doesn't recount hours already checked here.
  return { newState: stateAfterCheck };
}

export default { key: "delta_neutral", validateParams, evaluate };
