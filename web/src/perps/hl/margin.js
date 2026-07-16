export function maintenanceMarginRate(maxLeverage) {
  if (maxLeverage <= 0) throw new Error("maxLeverage must be > 0");
  return 1 / (2 * maxLeverage);
}

export function maintenanceLeverage(maxLeverage) {
  return 2 * maxLeverage;
}

export function tierFor(notional, tiers) {
  if (!tiers.length) throw new Error("empty margin tier table");
  let selected = tiers[0];
  for (const t of tiers) {
    if (notional >= t.lowerBound) selected = t;
    else break;
  }
  return selected;
}

function liqPriceForMaintLev(p, maintLev) {
  const l = 1 / maintLev;
  const { side, size, markPrice, marginAvailable } = p;
  return markPrice - (side * marginAvailable) / size / (1 - l * side);
}

export function liquidationPrice(p) {
  if (p.size <= 0) throw new Error("size must be > 0");
  let tier = tierFor(p.size * p.markPrice, p.tiers);
  let price = liqPriceForMaintLev(p, maintenanceLeverage(tier.maxLeverage));
  for (let i = 0; i < 8; i++) {
    if (!Number.isFinite(price)) return null;
    const nextTier = tierFor(p.size * Math.max(price, 0), p.tiers);
    if (nextTier === tier) break;
    tier = nextTier;
    price = liqPriceForMaintLev(p, maintenanceLeverage(tier.maxLeverage));
  }
  if (p.side === 1 && price <= 0) return null;
  return price;
}

export function assessHealth(accountEquity, maintenanceMarginRequired, pos) {
  const marginRatio =
    maintenanceMarginRequired > 0 ? accountEquity / maintenanceMarginRequired : Infinity;
  const liq = pos ? liquidationPrice(pos) : null;
  const distanceToLiquidation =
    liq !== null && pos ? Math.abs(pos.markPrice - liq) / pos.markPrice : null;

  let status = "healthy";
  if (marginRatio < 2 / 3) status = "backstop_imminent";
  else if (marginRatio < 1.15) status = "critical";
  else if (marginRatio < 1.5) status = "warning";

  return { status, marginRatio, distanceToLiquidation, liquidationPrice: liq };
}
