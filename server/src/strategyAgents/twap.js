import { validateSliceParams, makeSliceEvaluator, equalWeights } from "./sliceExecution.js";

/** TWAP (time-weighted average price) — splits a one-time total buy into
 * equal-sized slices spread evenly over a time window, to reduce the
 * market impact a single large order would have. See sliceExecution.js
 * for the shared scheduling/proposal logic this and vwap.js both use. */
export default { key: "twap", validateParams: validateSliceParams, evaluate: makeSliceEvaluator("twap_slice", equalWeights) };
