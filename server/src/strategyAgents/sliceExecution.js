import { USDC } from "../tokens.js";

/* ————— Shared logic for TWAP and VWAP — both split a fixed total buy into
 * N slices executed at an even time cadence, differing only in how big
 * each slice is (equal for TWAP, weighted for VWAP). One-time execution
 * algorithms, not a recurring strategy like DCA: once every slice has
 * filled, the strategy is marked completed. —————
 */

const MIN_TOTAL_USD = 1;
const MAX_TOTAL_USD = 100_000;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 72; // 3 days — beyond this it's DCA's job, not an execution algo's
const SLICE_INTERVAL_MINUTES = 30; // fixed cadence, so the LLM/user only ever needs to give a total + a duration

export function sliceCount(durationHours) {
  return Math.max(2, Math.min(48, Math.round((durationHours * 60) / SLICE_INTERVAL_MINUTES)));
}

/** Shape/range validation only — same pattern as dca.js/deltaNeutral.js.
 * The caller (strategyRoutes.js) resolves params.symbol against the live
 * registry and stamps the resolved mint into params before createStrategy. */
export function validateSliceParams(params) {
  if (!params || typeof params !== "object") return "params required";
  if (!params.symbol || typeof params.symbol !== "string") return "symbol required";
  const totalUsd = Number(params.totalUsd);
  if (!Number.isFinite(totalUsd) || totalUsd < MIN_TOTAL_USD || totalUsd > MAX_TOTAL_USD) {
    return `totalUsd must be between $${MIN_TOTAL_USD} and $${MAX_TOTAL_USD.toLocaleString()}`;
  }
  const durationHours = Number(params.durationHours);
  if (!Number.isFinite(durationHours) || durationHours < MIN_DURATION_HOURS || durationHours > MAX_DURATION_HOURS) {
    return `durationHours must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS}`;
  }
  return null;
}

/** Equal-sized slices — TWAP. */
export function equalWeights(n) {
  return Array.from({ length: n }, () => 1 / n);
}

/** No real per-asset intraday volume feed exists in this codebase (Twelve
 * Data's own volume field isn't even extracted in marketdata.js today) —
 * so VWAP's slice sizing uses a canonical U-shaped curve (heavier at the
 * start and end of the window, lighter through the middle) as a stand-in
 * for "trade more when volume is typically higher," the same
 * approximation execution tools fall back to without a live per-asset
 * volume profile. This is a heuristic, not real market volume. */
export function uShapedVolumeWeights(n) {
  if (n <= 1) return [1];
  const raw = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1); // 0..1 across the window
    return 0.6 + 1.4 * Math.abs(t - 0.5) * 2; // ~0.6x at the midpoint, ~2x at the edges
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Builds an evaluate() for a slice-execution strategy type. Due-ness is
 * anchored to the strategy's own immutable created_at (never a separate
 * mutable "startedAt" in state) — state carries only filledSlices, so
 * report-execution can update it with a single scalar and nothing about
 * scheduling needs to be preserved/re-derived across ticks.
 *
 * Each proposal's spot leg carries its own sliceIndex/totalSlices — so
 * report-execution (strategyRoutes.js) can advance filledSlices, and know
 * when the strategy is fully executed, by reading the confirmed proposal
 * itself rather than needing to re-fetch and re-derive strategy state. */
export function makeSliceEvaluator(kind, weightsFn) {
  return async function evaluate(strategy, _ctx) {
    const { params, state, created_at } = strategy;
    const slices = sliceCount(params.durationHours);
    const filled = state?.filledSlices || 0;
    if (filled >= slices) return null; // report-execution already flips this to "completed" once the last slice fills — guard anyway

    const sliceIntervalMs = (params.durationHours * 60 * 60 * 1000) / slices;
    const dueAt = new Date(new Date(created_at).getTime() + filled * sliceIntervalMs);
    if (new Date() < dueAt) return null;

    const weights = weightsFn(slices);
    const sliceUsd = Math.round(params.totalUsd * weights[filled] * 100) / 100;
    const label = kind === "twap_slice" ? "TWAP" : "VWAP";
    return {
      kind,
      legs: [{
        domain: "spot", side: "buy", symbol: params.symbol,
        inputMint: USDC.mint, outputMint: params.mint, usd: sliceUsd,
        sliceIndex: filled, totalSlices: slices,
      }],
      summary: `${label} slice ${filled + 1}/${slices}: buy $${sliceUsd} of ${params.symbol}`,
    };
  };
}
