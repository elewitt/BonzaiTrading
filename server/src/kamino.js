/**
 * Kamino Finance's "xStocks Market" — a real, live Solana lending market that
 * accepts tokenized equities (xStocks) as collateral to borrow USDC. Verified
 * directly against Kamino's own API before building anything on top of it:
 *   - GET https://api.kamino.finance/v2/kamino-market confirmed this exact
 *     market pubkey exists and is named "xStocks Market" (there's also an
 *     unrelated "Superstate Opening Bell Market" — don't confuse the two).
 *   - GET /kamino-market/{market}/reserves/metrics confirmed the real
 *     supported collateral reserves (AAPLx, TSLAx, NVDAx, SPYx, GOOGLx,
 *     METAx, MSTRx, HOODx, CRCLx, QQQx, plus USDC/USDG/cbBTC) and their
 *     actual max LTVs (e.g. SPYx 0.73, AAPLx 0.4, TSLAx 0.55) before
 *     assuming any of this worked.
 *   - POST /ktx/klend/deposit tested live with a real address and reserve —
 *     confirmed it returns a genuine ~700-byte unsigned VersionedTransaction
 *     (one empty signature slot), not a placeholder/stub response.
 */

const KAMINO_BASE = "https://api.kamino.finance";
export const KAMINO_XSTOCKS_MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";

export class KaminoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function kaminoFetch(path, opts = {}) {
  let r;
  try {
    r = await fetch(`${KAMINO_BASE}${path}`, opts);
  } catch (e) {
    throw new KaminoError(502, `Kamino request failed: ${e.message}`);
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    // Kamino's documented error shape: { statusCode, message, error, code }
    throw new KaminoError(r.status >= 500 ? 502 : 400, data?.message || `Kamino ${path} failed (${r.status})`);
  }
  return data;
}

// Same in-memory TTL cache pattern as marketdata.js — reserve rates/LTVs
// don't need to be real-time-fresh for a collateral picker, and this keeps
// the xStocks Market page from hammering Kamino's API on every poll.
const cache = new Map();
async function cached(key, ttlMs, fetchFn) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetchFn();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}
const RESERVES_TTL = 60_000; // 1 min

/** Every reserve in the xStocks market — collateral options + USDC (the borrowable asset). */
export function getXstocksReserves() {
  return cached(`reserves:${KAMINO_XSTOCKS_MARKET}`, RESERVES_TTL, () =>
    kaminoFetch(`/kamino-market/${KAMINO_XSTOCKS_MARKET}/reserves/metrics`),
  );
}

/** A user's open obligations (borrow positions) in the xStocks market. Empty array if none. */
export function getObligations(userPubkey) {
  return kaminoFetch(`/kamino-market/${KAMINO_XSTOCKS_MARKET}/users/${encodeURIComponent(userPubkey)}/obligations`);
}

/**
 * Full detail for one obligation: currentLtv, maxLtv, liquidationLtv,
 * closeFactor, collateral.deposits[], debt.borrows[]. The gap between
 * currentLtv and liquidationLtv is the real safety margin — Kamino doesn't
 * expose a single normalized "health factor" number, so don't fabricate one.
 */
export function getLoanDetail(obligationPubkey) {
  return kaminoFetch(`/klend/loans/${encodeURIComponent(obligationPubkey)}`);
}

const KLEND_ACTIONS = new Set(["deposit", "borrow", "repay", "withdraw"]);

/**
 * Builds an unsigned deposit/borrow/repay/withdraw transaction for the
 * client to sign — mirrors buildOrder()'s role for Jupiter swaps. The
 * market is always pinned to KAMINO_XSTOCKS_MARKET server-side (never
 * client-supplied) so this can't be pointed at a different Kamino market.
 */
export async function buildKlendTx(action, { wallet, reserve, amount }) {
  if (!KLEND_ACTIONS.has(action)) throw new KaminoError(400, `unknown klend action: ${action}`);
  if (!wallet || !reserve || !amount) throw new KaminoError(400, "wallet, reserve, and amount required");
  const data = await kaminoFetch(`/ktx/klend/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, market: KAMINO_XSTOCKS_MARKET, reserve, amount: String(amount) }),
  });
  if (!data?.transaction) throw new KaminoError(502, `Kamino ${action} response missing transaction`);
  return data;
}
