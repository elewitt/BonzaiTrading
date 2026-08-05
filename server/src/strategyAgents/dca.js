import { USDC } from "../tokens.js";

const MIN_USD_PER_INTERVAL = 1;
const MAX_USD_PER_INTERVAL = 100_000; // sanity cap — same order of magnitude as other order-size guards in this codebase
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;

/** Shape/range validation only — the caller (strategyRoutes.js) resolves
 * `params.symbol` against the live registry (rejecting unknown symbols or
 * USDC itself) and stamps the resolved `mint` into params before calling
 * createStrategy, so evaluate() below never needs registry access at all —
 * same "resolve once at creation, never re-derive" pattern delta-neutral's
 * hlCoin will use in Phase B. Returns an error string, or null if valid. */
function validateParams(params) {
  if (!params || typeof params !== "object") return "params required";
  if (!params.symbol || typeof params.symbol !== "string") return "symbol required";
  const usd = Number(params.usdPerInterval);
  if (!Number.isFinite(usd) || usd < MIN_USD_PER_INTERVAL || usd > MAX_USD_PER_INTERVAL) {
    return `usdPerInterval must be between $${MIN_USD_PER_INTERVAL} and $${MAX_USD_PER_INTERVAL}`;
  }
  const days = Number(params.intervalDays);
  if (!Number.isInteger(days) || days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) {
    return `intervalDays must be a whole number between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS}`;
  }
  return null;
}

/** Due when now is past (last execution, or strategy creation if it's never
 * run) + the configured interval. No live-balance precheck here — if USDC
 * is insufficient the swap simply fails at confirm time exactly like any
 * manual buy today; nothing autonomous is at risk since this only ever
 * produces a proposal, never a signature. */
async function evaluate(strategy, _ctx) {
  const { params, state, created_at } = strategy;
  const lastExecutedAt = state?.lastExecutedAt ? new Date(state.lastExecutedAt) : new Date(created_at);
  const nextDueAt = new Date(lastExecutedAt.getTime() + params.intervalDays * 24 * 60 * 60 * 1000);
  if (new Date() < nextDueAt) return null;

  const amount = Math.floor(params.usdPerInterval * 10 ** USDC.decimals);
  const leg = {
    domain: "spot", side: "buy", symbol: params.symbol,
    inputMint: USDC.mint, outputMint: params.mint,
    amount, usd: params.usdPerInterval,
  };
  return {
    kind: "dca_buy",
    legs: [leg],
    summary: `DCA buy: $${params.usdPerInterval} of ${params.symbol}`,
  };
}

export default { key: "dca", validateParams, evaluate };
