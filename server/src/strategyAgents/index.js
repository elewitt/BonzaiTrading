import dca from "./dca.js";

/* ————— Strategy-type registry — the extensibility point Strategy Agents
 * is built around. A new strategy type is a new module exporting
 * { key, validateParams(params), async evaluate(strategy, ctx) } plus one
 * entry here — not a rearchitect. `delta_neutral` is already a valid
 * `strategies.type` at the DB level (Phase A's CHECK constraint anticipates
 * it) but has no module here yet — Phase B adds
 * server/src/strategyAgents/deltaNeutral.js and registers it below. —————
 */
export const STRATEGY_TYPES = {
  [dca.key]: dca,
};

export const MAX_ACTIVE_STRATEGIES_PER_WALLET = Number(process.env.MAX_ACTIVE_STRATEGIES_PER_WALLET || 10);
