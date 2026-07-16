/**
 * Shared QA geo-bypass credentials — one signed message, reused across both
 * the perps client-side gate and xStocks server-side gate (via headers on
 * every request). Signing happens once per day (the message embeds today's
 * date); the server independently verifies the signature against
 * PERPS_QA_ALLOWLIST on every use, so persisting it here client-side is just
 * a convenience, not a trust boundary — an attacker with these values still
 * can't produce a valid signature for a different address or a different day.
 *
 * Persisted to localStorage so a page reload doesn't lose it and force
 * re-verifying — it naturally stops working once the date in the cached
 * message no longer matches "today" server-side, so no separate expiry
 * logic is needed here.
 */
const STORAGE_KEY = "lv_qa_bypass";

let cached = null; // { address, message, signature } | null
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) cached = JSON.parse(raw);
} catch {}

export function buildQaBypassMessage(address) {
  // Plain ASCII only — this travels as an HTTP header value for xStocks
  // routes, and non-ASCII bytes (e.g. an em-dash) get corrupted in transit.
  const today = new Date().toISOString().slice(0, 10);
  return `Bonzai Trading QA bypass - ${address} - ${today}`;
}

export function setQaBypassCredentials(creds) {
  cached = creds;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(creds)); } catch {}
}

export function hasQaBypassCredentials() {
  if (!cached) return false;
  // The signed message embeds the date it was signed for, and the server
  // independently re-derives and checks that same date-stamped message —
  // so a credential signed for a previous day will just be rejected
  // server-side with no clear signal to the user. Detect that here and
  // clear it, so the UI correctly re-prompts instead of silently
  // geoblocking while believing bypass is still active.
  if (cached.message !== buildQaBypassMessage(cached.address)) {
    cached = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
  return true;
}

export function getQaBypassHeaders() {
  if (!cached) return {};
  return {
    "x-qa-address": cached.address,
    "x-qa-message": cached.message,
    "x-qa-signature": cached.signature,
  };
}
