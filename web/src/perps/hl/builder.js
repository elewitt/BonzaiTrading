import { PROTOCOL } from "../config.js";

export function tenthsBpsToPercent(tenthsBps) {
  return tenthsBps / 1000;
}

export function percentStringToTenthsBps(pct) {
  const n = Number(pct.replace(/%\s*$/, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid percent: ${pct}`);
  return Math.round(n * 1000);
}

export function tenthsBpsToPercentString(tenthsBps) {
  return `${tenthsBpsToPercent(tenthsBps)}%`;
}

export function builderFeeUsd(notionalUsd, tenthsBps) {
  return notionalUsd * (tenthsBps / 100_000);
}

export function checkApproval(maxBuilderFeeResult, intendedTenthsBps) {
  const approvedTenthsBps = maxBuilderFeeResult ?? 0;
  return {
    approved: approvedTenthsBps > 0,
    approvedTenthsBps,
    sufficient: approvedTenthsBps >= intendedTenthsBps,
  };
}

export function assertValidPerpBuilderFee(tenthsBps) {
  if (!Number.isInteger(tenthsBps) || tenthsBps < 0) {
    throw new Error(`builder fee must be a non-negative integer (tenths of a bp), got ${tenthsBps}`);
  }
  if (tenthsBps > PROTOCOL.MAX_PERP_BUILDER_FEE_TENTHS_BPS) {
    throw new Error(
      `builder fee ${tenthsBps} exceeds perps protocol max of ${PROTOCOL.MAX_PERP_BUILDER_FEE_TENTHS_BPS} (0.10%)`,
    );
  }
}
