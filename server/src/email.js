/* ————— Email — outbound customer messages via Resend —————
 * Plain fetch() against Resend's HTTP API, no SDK — matches hyperliquid.js
 * and kamino.js's existing style for a single external call. Requires
 * RESEND_API_KEY (Resend dashboard) and a verified sending domain
 * (bonzaitrading.com must have Resend's DNS records added before delivery
 * actually works — an account-level setup step, not something this code can
 * do). Fails loud (throws) rather than soft: unlike activity logging, a
 * failed send is the entire point of the admin action and must be reported
 * back to the operator, not swallowed.
 */
const RESEND_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "Bonzai Trading <support@bonzaitrading.com>";

export async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("email not configured (RESEND_API_KEY not set)");
  const r = await fetch(RESEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, text }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Resend request failed (${r.status})`);
  return data; // { id: "..." }
}
