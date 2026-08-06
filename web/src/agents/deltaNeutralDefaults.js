// Mirrors the same-named constants in
// server/src/strategyAgents/deltaNeutral.js (the real source of truth —
// the server re-validates every one of these bounds regardless of what
// the form sends). Duplicated rather than imported since that module
// pulls in server-only code (Hyperliquid fetch helpers); these are just
// the display/default values for the creation form.
export const DEFAULT_LEVERAGE = 2;
export const DEFAULT_REBALANCE_THRESHOLD_PCT = 5;
export const DEFAULT_UNFAVORABLE_EXIT_HOURS = 24;
