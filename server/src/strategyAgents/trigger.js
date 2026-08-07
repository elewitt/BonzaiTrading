import { USDC } from "../tokens.js";

/* ————— Trigger strategies — the same mechanism covers stop-loss,
 * take-profit, and "buy the dip," differing only in side (buy/sell) and
 * direction (above/below): a stop-loss is a sell-below, a take-profit is
 * a sell-above, a dip-buy is a buy-below, a breakout-buy is a buy-above.
 * One-time — unlike DCA's recurring schedule, a trigger fires at most
 * once and the strategy completes.
 */

const MIN_USD = 1;
const MAX_USD = 100_000;

/** Shape/range validation only — same pattern as every other type here.
 * The caller (strategyRoutes.js) resolves params.symbol against the live
 * registry and, for a percent-change trigger, stamps a live referencePrice
 * into params at creation time (never trusted from the client — the
 * server fetches it itself, same "never invent a number" principle
 * applied everywhere else in this codebase). */
function validateParams(params) {
  if (!params || typeof params !== "object") return "params required";
  if (!params.symbol || typeof params.symbol !== "string") return "symbol required";
  if (params.side !== "buy" && params.side !== "sell") return "side must be buy or sell";
  if (params.direction !== "above" && params.direction !== "below") return "direction must be above or below";
  if (params.thresholdType !== "price" && params.thresholdType !== "pct_change") {
    return "thresholdType must be price or pct_change";
  }
  const threshold = Number(params.thresholdValue);
  if (!Number.isFinite(threshold) || threshold <= 0) return "thresholdValue must be a positive number";
  if (params.thresholdType === "pct_change" && !Number.isFinite(Number(params.referencePrice))) {
    return "referencePrice is required for a percent-change trigger";
  }
  if (params.side === "sell" && params.sellAll) return null; // no usd needed — selling the whole position
  const usd = Number(params.usd);
  if (!Number.isFinite(usd) || usd < MIN_USD || usd > MAX_USD) {
    return `usd must be between $${MIN_USD} and $${MAX_USD.toLocaleString()}`;
  }
  return null;
}

/** Fires when the live price crosses the configured threshold, checked
 * against ctx.prices (evaluator.js's buildContext fetches this even for
 * assets the wallet doesn't currently hold, specifically for active
 * trigger strategies — see its own comment). No live-price-yet is a
 * normal, silent "not due" rather than an error — the next tick tries
 * again. */
async function evaluate(strategy, ctx) {
  const { params } = strategy;
  const price = ctx.prices?.[params.mint];
  if (!price) return null;

  let crossed;
  if (params.thresholdType === "price") {
    crossed = params.direction === "below" ? price <= params.thresholdValue : price >= params.thresholdValue;
  } else {
    const pctChange = ((price - params.referencePrice) / params.referencePrice) * 100;
    crossed = params.direction === "below" ? pctChange <= -Math.abs(params.thresholdValue) : pctChange >= Math.abs(params.thresholdValue);
  }
  if (!crossed) return null;

  const leg = params.side === "buy"
    ? { domain: "spot", side: "buy", symbol: params.symbol, inputMint: USDC.mint, outputMint: params.mint, usd: params.usd }
    : {
        domain: "spot", side: "sell", symbol: params.symbol, inputMint: params.mint, outputMint: USDC.mint,
        ...(params.sellAll ? { sellAll: true } : { usd: params.usd }),
      };

  const verb = params.side === "buy" ? "Buy" : "Sell";
  const amountLabel = params.side === "sell" && params.sellAll ? "entire position" : `$${params.usd}`;
  const moveLabel = params.direction === "below" ? "dropped to" : "rose to";
  return {
    kind: "trigger_fill",
    legs: [leg],
    summary: `${verb} ${amountLabel} of ${params.symbol} — price ${moveLabel} $${price.toFixed(2)}`,
  };
}

export default { key: "trigger", validateParams, evaluate };
