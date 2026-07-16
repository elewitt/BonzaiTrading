import pg from "pg";

/* ————— Postgres — the project's first real database —————
 * Everything else on this server is in-memory (sponsor-spend budget, geo
 * cache, Kamino reserve cache) and resets on restart. This is durable
 * storage for the admin/ops activity log, nothing else uses it. Fails soft
 * if DATABASE_URL isn't set (matches the rest of the file's convention of
 * degrading a feature rather than crashing at boot) so local dev without a
 * database still runs the trading routes fine — just without logging.
 */
const connectionString = process.env.DATABASE_URL;
export const pool = connectionString ? new pg.Pool({ connectionString }) : null;

export async function initSchema() {
  if (!pool) {
    console.warn("[db] DATABASE_URL not set — activity logging disabled");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      wallet_address TEXT NOT NULL,
      privy_user_id TEXT,
      kind TEXT NOT NULL,
      symbol TEXT,
      side TEXT,
      usd_value NUMERIC,
      signature TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      details JSONB
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS activity_log_wallet_idx ON activity_log (wallet_address, created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_status (
      privy_user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log("[db] schema ready");
}

/** Insert one activity row. Never throws — logging must never break a real
 * trade; a failed insert is logged and swallowed. */
export async function logActivity(row) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO activity_log (wallet_address, privy_user_id, kind, symbol, side, usd_value, signature, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.walletAddress,
        row.privyUserId ?? null,
        row.kind,
        row.symbol ?? null,
        row.side ?? null,
        row.usdValue ?? null,
        row.signature ?? null,
        row.status ?? "confirmed",
        row.details ? JSON.stringify(row.details) : null,
      ],
    );
  } catch (e) {
    console.error(`[db] logActivity failed (non-fatal): ${e.message}`);
  }
}

/** Recent activity for one wallet, newest first. */
export async function getActivityForWallet(walletAddress, limit = 100) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, created_at, wallet_address, privy_user_id, kind, symbol, side, usd_value, signature, status, details
     FROM activity_log WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT $2`,
    [walletAddress, limit],
  );
  return rows;
}

/* ————— Account status — pause/reject enforcement —————
 * Keyed on Privy user ID, never a wallet address: requireAuth verifies the
 * caller's Privy token and sets req.privyUserId from it, so enforcement
 * can't be routed around by switching which wallet a request names. No
 * DATABASE_URL means no pool, which means every account reads as "active" —
 * matches this file's existing fail-soft convention (degrade the feature,
 * never block trading because of an infra gap).
 */
export async function getCustomerStatus(privyUserId) {
  if (!pool || !privyUserId) return "active";
  const { rows } = await pool.query(
    `SELECT status FROM customer_status WHERE privy_user_id = $1`,
    [privyUserId],
  );
  return rows[0]?.status ?? "active";
}

export async function setCustomerStatus(privyUserId, status, reason) {
  if (!pool) throw new Error("database not configured");
  await pool.query(
    `INSERT INTO customer_status (privy_user_id, status, reason, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (privy_user_id) DO UPDATE SET status = $2, reason = $3, updated_at = now()`,
    [privyUserId, status, reason ?? null],
  );
}

export async function getCustomerStatusDetail(privyUserId) {
  if (!pool || !privyUserId) return { status: "active", reason: null, updatedAt: null };
  const { rows } = await pool.query(
    `SELECT status, reason, updated_at FROM customer_status WHERE privy_user_id = $1`,
    [privyUserId],
  );
  const row = rows[0];
  return row
    ? { status: row.status, reason: row.reason, updatedAt: row.updated_at }
    : { status: "active", reason: null, updatedAt: null };
}
