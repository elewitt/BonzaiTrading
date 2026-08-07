import { validateSliceParams, makeSliceEvaluator, uShapedVolumeWeights } from "./sliceExecution.js";

/** VWAP (volume-weighted average price) — same as TWAP (a one-time total
 * buy spread over a time window) but slice sizes are weighted toward a
 * canonical U-shaped intraday volume curve instead of being equal — see
 * sliceExecution.js's uShapedVolumeWeights for why (no real per-asset
 * volume feed exists in this codebase yet). */
export default { key: "vwap", validateParams: validateSliceParams, evaluate: makeSliceEvaluator("vwap_slice", uShapedVolumeWeights) };
