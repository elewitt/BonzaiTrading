import dca from "./dca.js";
import deltaNeutral from "./deltaNeutral.js";
import twap from "./twap.js";
import vwap from "./vwap.js";
import trigger from "./trigger.js";

/* ————— Strategy-type registry — the extensibility point Strategy Agents
 * is built around. A new strategy type is a new module exporting
 * { key, validateParams(params), async evaluate(strategy, ctx) } plus one
 * entry here — not a rearchitect. —————
 */
export const STRATEGY_TYPES = {
  [dca.key]: dca,
  [deltaNeutral.key]: deltaNeutral,
  [twap.key]: twap,
  [vwap.key]: vwap,
  [trigger.key]: trigger,
};

export const MAX_ACTIVE_STRATEGIES_PER_WALLET = Number(process.env.MAX_ACTIVE_STRATEGIES_PER_WALLET || 10);
