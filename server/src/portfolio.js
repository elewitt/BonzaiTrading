/**
 * Server-side port of web/src/lib/api.js's derivePortfolio/planTrades.
 * These are pure functions (no browser/React dependency) — ported here
 * verbatim so the Telegram bot can compute trade legs the same way the web
 * app does, without a browser in the loop. Keep in sync with the web copy
 * if either changes.
 */

const DUST_USD = 0.01; // positions worth less than $0.01 are treated as dust (always hidden)

/** Given holdings + prices, compute the invested rows and totals. */
export function derivePortfolio(holdings, prices, registry, { yieldMode = false } = {}) {
  const usdcMint = registry.USDC.mint;
  const usdyMint = registry.USDY?.mint;
  let cashUsdc = 0, cashUsdy = 0, usdyAmount = 0;
  const rows = [];
  const dustRows = [];
  for (const t of holdings?.tokens || []) {
    if (t.mint === usdcMint) { cashUsdc = t.uiAmount || 0; continue; }
    if (yieldMode && t.mint === usdyMint) {
      usdyAmount = t.uiAmount || 0;
      cashUsdy = usdyAmount * (prices[usdyMint] || 1);
      continue;
    }
    if (!t.symbol) continue;
    const price = prices[t.mint] || 0;
    const value = (t.uiAmount || 0) * price;
    if (value < DUST_USD) { dustRows.push({ ...t, price, value }); continue; }
    rows.push({ ...t, price, value });
  }
  rows.sort((a, b) => b.value - a.value);
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const cash = cashUsdc + cashUsdy;
  const total = invested + cash;
  // weight = share of TOTAL portfolio (incl. cash) — consistent with the donut chart
  rows.forEach((r) => (r.weight = total ? (r.value / total) * 100 : 0));
  return { rows, dustRows, cash, cashUsdc, cashUsdy, usdyAmount, invested, total };
}

/** Turn target weights into concrete buy/sell legs (sells first). */
export function planTrades({ allocations, portfolio, prices, registry }) {
  const total = portfolio.total;
  const targetVal = {};
  // Weights are % of total portfolio. Divide by 100 — never renormalize.
  // A partial sell returns weights < 100; the difference stays as cash.
  for (const a of allocations) targetVal[a.symbol] = ((+a.weight || 0) / 100) * total;
  const curVal = {};
  for (const r of portfolio.rows) curVal[r.symbol] = r.value;

  const MIN_TRADE_USD = 0.25;
  const symbols = new Set([...Object.keys(targetVal), ...Object.keys(curVal)]);
  const trades = [];
  let maxSkippedDelta = 0; // largest delta that was skipped as dust
  for (const s of symbols) {
    const delta = (targetVal[s] || 0) - (curVal[s] || 0);
    if (Math.abs(delta) < 0.01) continue; // truly negligible — portfolio already matches
    const tok = registry[s];
    if (!tok) continue;
    if (Math.abs(delta) < MIN_TRADE_USD) {
      maxSkippedDelta = Math.max(maxSkippedDelta, Math.abs(delta));
      continue;
    }
    if (delta < 0) {
      const row = portfolio.rows.find((r) => r.symbol === s);
      const shares = Math.min(Math.abs(delta) / (prices[tok.mint] || 1), row?.uiAmount || 0);
      // Cap at exact on-chain atomic balance — uiAmount can exceed amount due to Token-2022 fee imprecision
      const atoms = Math.min(Math.floor(shares * 10 ** tok.decimals), Number(row?.amount || 0));
      trades.push({
        symbol: s, side: "sell", usd: Math.abs(delta),
        inputMint: tok.mint, outputMint: registry.USDC.mint,
        amount: atoms,
      });
    } else {
      trades.push({
        symbol: s, side: "buy", usd: delta,
        inputMint: registry.USDC.mint, outputMint: tok.mint,
        amount: Math.floor(delta * 10 ** registry.USDC.decimals),
      });
    }
  }
  trades.sort((a) => (a.side === "sell" ? -1 : 1)); // sells free up USDC first
  return { trades: trades.filter((t) => t.amount > 0), maxSkippedDelta };
}
