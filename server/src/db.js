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
  // ————— Referral system — 50% fee-share flywheel —————
  // One code per user (lazily created on first dashboard/attribute call),
  // and one attribution row per REFERRED user (never per referrer) so a
  // PRIMARY KEY on referred_privy_user_id enforces "one referrer max, ever"
  // at the DB level rather than relying on application logic alone.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      privy_user_id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      referred_privy_user_id TEXT PRIMARY KEY,
      referred_wallet_address TEXT NOT NULL,
      referred_evm_address TEXT,
      referrer_privy_user_id TEXT NOT NULL REFERENCES referral_codes(privy_user_id),
      code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_privy_user_id);
  `);
  console.log("[db] schema ready");
}

/** Random 8-char base36 code — collisions are handled by the caller via the
 * table's UNIQUE constraint (retry on conflict) rather than checked here. */
function randomReferralCode() {
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36))
    .join("")
    .toUpperCase();
}

/** Get this user's referral code, creating one on first call. A few retries
 * on the (astronomically unlikely) chance of a random collision with the
 * UNIQUE constraint — simpler than pre-checking existence separately. */
export async function getOrCreateReferralCode(privyUserId) {
  if (!pool) throw new Error("database not configured");
  const existing = await pool.query(
    `SELECT code FROM referral_codes WHERE privy_user_id = $1`,
    [privyUserId],
  );
  if (existing.rows[0]) return existing.rows[0].code;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO referral_codes (privy_user_id, code) VALUES ($1, $2)
         ON CONFLICT (privy_user_id) DO UPDATE SET privy_user_id = EXCLUDED.privy_user_id
         RETURNING code`,
        [privyUserId, randomReferralCode()],
      );
      return rows[0].code;
    } catch (e) {
      if (e.code !== "23505" || attempt === 4) throw e; // 23505 = unique_violation on `code`
    }
  }
}

/** Look up whose code this is. Returns null if the code doesn't exist. */
export async function findReferralCodeOwner(code) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT privy_user_id FROM referral_codes WHERE code = $1`,
    [code],
  );
  return rows[0]?.privy_user_id ?? null;
}

/** Attribute `referredPrivyUserId` to `referrerPrivyUserId`, once, ever.
 * Returns { attributed: true } on a fresh insert, { attributed: false,
 * reason } if it's a no-op (already attributed — to anyone, including this
 * same referrer, so a repeat client call is always safe) or blocked
 * (self-referral). Never throws for these expected cases — only a real
 * DB error should surface as an exception. */
export async function attributeReferral({ referredPrivyUserId, referredWalletAddress, referredEvmAddress, code }) {
  if (!pool) throw new Error("database not configured");
  const referrerPrivyUserId = await findReferralCodeOwner(code);
  if (!referrerPrivyUserId) return { attributed: false, reason: "invalid code" };
  if (referrerPrivyUserId === referredPrivyUserId) return { attributed: false, reason: "self-referral" };

  const { rows } = await pool.query(
    `INSERT INTO referrals (referred_privy_user_id, referred_wallet_address, referred_evm_address, referrer_privy_user_id, code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (referred_privy_user_id) DO NOTHING
     RETURNING referred_privy_user_id`,
    [referredPrivyUserId, referredWalletAddress, referredEvmAddress ?? null, referrerPrivyUserId, code],
  );
  return rows[0] ? { attributed: true } : { attributed: false, reason: "already attributed" };
}

/** Everyone this user has referred, oldest first. */
export async function getReferralsFor(referrerPrivyUserId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT referred_privy_user_id, referred_wallet_address, referred_evm_address, created_at
     FROM referrals WHERE referrer_privy_user_id = $1 ORDER BY created_at ASC`,
    [referrerPrivyUserId],
  );
  return rows;
}

/** Brokerage volume + fee revenue generated by one referred wallet since a
 * given timestamp — feeBps is read from activity_log.details (populated
 * going forward per swap; see executeSwap()'s new usdValue/feeBps params in
 * web/src/lib/api.js) and defaults to 0 when absent, which correctly means
 * "no fee was actually charged on this swap" (e.g. the AMM no-fee fallback
 * path), not "unknown". */
export async function getEquitiesStatsForWallet(walletAddress, sinceIso) {
  if (!pool) return { volume: 0, fees: 0 };
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(usd_value), 0) AS volume,
       COALESCE(SUM(usd_value * COALESCE((details->>'feeBps')::numeric, 0) / 10000), 0) AS fees
     FROM activity_log
     WHERE wallet_address = $1 AND kind = 'swap' AND status = 'confirmed'
       AND usd_value IS NOT NULL AND created_at >= $2`,
    [walletAddress, sinceIso],
  );
  return { volume: Number(rows[0].volume), fees: Number(rows[0].fees) };
}

/** Kamino deposit fee revenue generated by one referred wallet since a
 * given timestamp — unlike getEquitiesStatsForWallet, usd_value on a
 * kamino_deposit_fee row already IS the realized fee dollar amount
 * (computed client-side at the moment it's charged, in
 * executeKaminoAction()), not a trade value needing a bps multiplication.
 * "Volume" here is the deposit's full value, backed out from the fee at
 * the known flat rate — good enough for a dashboard total, not meant to
 * be authoritative to the cent. */
export async function getKaminoFeeStatsForWallet(walletAddress, sinceIso, feeBps) {
  if (!pool) return { volume: 0, fees: 0 };
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(usd_value), 0) AS fees
     FROM activity_log
     WHERE wallet_address = $1 AND kind = 'kamino_deposit_fee' AND status = 'confirmed'
       AND usd_value IS NOT NULL AND created_at >= $2`,
    [walletAddress, sinceIso],
  );
  const fees = Number(rows[0].fees);
  return { volume: feeBps > 0 ? (fees / feeBps) * 10000 : 0, fees };
}

/** Platform-wide Kamino deposit fee revenue, all-time — powers the admin
 * fee dashboard (distinct from getKaminoFeeStatsForWallet above, which is
 * scoped to one referred wallet for the customer referral dashboard).
 * Broken down by collateral mint since fees are collected in whatever
 * token was deposited (AAPLx, TSLAx, ...), not a single pooled currency
 * like the Jupiter/Hyperliquid fee mechanisms — the caller resolves mint
 * addresses to symbols via the token registry. */
export async function getKaminoFeeTotals() {
  if (!pool) return { totalUsd: 0, count: 0, byMint: [] };
  const [totals, byMint] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(usd_value), 0) AS total_usd, COUNT(*) AS count
       FROM activity_log WHERE kind = 'kamino_deposit_fee' AND status = 'confirmed'`,
    ),
    pool.query(
      `SELECT details->>'mint' AS mint, COALESCE(SUM(usd_value), 0) AS usd, COUNT(*) AS count
       FROM activity_log WHERE kind = 'kamino_deposit_fee' AND status = 'confirmed'
       GROUP BY details->>'mint' ORDER BY usd DESC`,
    ),
  ]);
  return {
    totalUsd: Number(totals.rows[0].total_usd),
    count: Number(totals.rows[0].count),
    byMint: byMint.rows.map((r) => ({ mint: r.mint, usd: Number(r.usd), count: Number(r.count) })),
  };
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
