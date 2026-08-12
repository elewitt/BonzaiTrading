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
  // ————— Kamino borrow-fee ledger — the server-side source of truth for
  // what's owed, replacing the earlier design where the fee amount was
  // just whatever the client claimed when calling /api/kamino/fee (a real
  // fee-bypass: nothing tied /api/kamino/borrow to that call ever
  // happening at all). One row per borrow that owes a fee; a wallet with
  // any unpaid row can't borrow again until it's settled — see
  // getUnpaidKaminoFeeObligation's usage in index.js. —————
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kamino_fee_obligations (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      wallet_address TEXT NOT NULL,
      amount_usd NUMERIC NOT NULL,
      fee_atoms BIGINT NOT NULL,
      paid_at TIMESTAMPTZ,
      signature TEXT
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS kamino_fee_obligations_wallet_idx
      ON kamino_fee_obligations (wallet_address, paid_at);
  `);
  // ————— Strategy Agents — persistent, user-defined recurring/conditional
  // strategies (DCA, delta-neutral funding harvest) that a background
  // evaluator (server/src/strategyAgents/evaluator.js) checks on a
  // schedule. Execution is never autonomous: when a strategy is due or
  // triggered, the evaluator writes a `strategy_proposals` row instead of
  // signing anything — the user reviews and confirms every proposal in
  // the app with their own wallet, same trust model as every other
  // trade in this codebase. `state` on `strategies` carries whatever
  // per-type bookkeeping the evaluator needs across ticks (e.g. DCA's
  // lastExecutedAt) — kept separate from `params` (the user's own
  // configuration, never mutated by the evaluator). —————
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strategies (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      wallet_address TEXT NOT NULL,
      evm_address TEXT,
      privy_user_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('dca', 'delta_neutral', 'twap', 'vwap', 'trigger')),
      params JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
      state JSONB NOT NULL DEFAULT '{}',
      last_evaluated_at TIMESTAMPTZ,
      last_proposed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS strategies_wallet_idx ON strategies (wallet_address, status);
  `);
  // Widens the type CHECK for databases created before TWAP/VWAP existed —
  // the CREATE TABLE above only takes effect on a fresh database, so
  // already-deployed ones need the constraint itself altered. Postgres has
  // no ADD CONSTRAINT IF NOT EXISTS, so drop-then-add is the idempotent
  // form (safe to run every boot); "strategies_type_check" is the default
  // name Postgres gives an inline CHECK with no explicit name.
  await pool.query(`ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_type_check;`);
  await pool.query(`ALTER TABLE strategies ADD CONSTRAINT strategies_type_check CHECK (type IN ('dca', 'delta_neutral', 'twap', 'vwap', 'trigger'));`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strategy_proposals (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      strategy_id BIGINT NOT NULL REFERENCES strategies(id),
      wallet_address TEXT NOT NULL,
      kind TEXT NOT NULL,
      legs JSONB NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ,
      executed_signatures JSONB
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS strategy_proposals_wallet_idx
      ON strategy_proposals (wallet_address, status, created_at DESC);
  `);
  // ————— Telegram chat↔wallet links — durable so the Strategy Agents
  // evaluator can notify a linked chat days after the /link happened.
  // telegram.js's own linkCodes/pendingProposals stay in-memory
  // deliberately (both have short, single-digit-minute TTLs, so losing
  // them on a deploy just means retrying a still-fresh action) — this
  // table is the one piece that genuinely needs to survive a restart.
  // One row per chat (a chat links to at most one wallet at a time,
  // latest link wins); a wallet can have more than one linked chat. —————
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_links (
      chat_id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS telegram_links_wallet_idx ON telegram_links (wallet_address);
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
  // Payout ledger — this table, not an in-memory counter, is the source of
  // truth for "how much has this referrer already been paid," since
  // in-memory state resets on every deploy/restart and isn't safe for real
  // money (unlike the sponsorBudgetOk in-memory daily cap used elsewhere
  // for gas top-ups, where that's an acceptable tradeoff). The partial
  // unique index below is what actually prevents a double-claim race (two
  // tabs, a double-click) — only one 'pending' row can exist per referrer
  // per fee_source at a time, enforced at the DB level, not just in
  // application code.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_payouts (
      id SERIAL PRIMARY KEY,
      referrer_privy_user_id TEXT NOT NULL REFERENCES referral_codes(privy_user_id),
      fee_source TEXT NOT NULL CHECK (fee_source IN ('kamino', 'perps', 'equities')),
      amount_usd NUMERIC NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('auto_onchain', 'manual_request')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'paid_manually', 'rejected')),
      wallet_address TEXT,
      tx_signature TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS referral_payouts_referrer_idx ON referral_payouts (referrer_privy_user_id);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS referral_payouts_pending_idx
      ON referral_payouts (referrer_privy_user_id, fee_source) WHERE status = 'pending';
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

/** Top N referrers by signup count — deliberately NOT ranked by $ earned.
 * A $-ranked leaderboard needs the same per-referred-wallet fan-out
 * getReferralsFor's caller (the dashboard endpoint) already does, run for
 * EVERY referrer instead of just one — expensive enough to need caching/
 * materializing, not worth it for v1. Signup count is a plain GROUP BY on
 * this table alone. */
export async function getTopReferrers(limit = 10) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT referrer_privy_user_id, COUNT(*) AS referral_count
     FROM referrals GROUP BY referrer_privy_user_id
     ORDER BY referral_count DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ privyUserId: r.referrer_privy_user_id, referralCount: Number(r.referral_count) }));
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

/** Kamino fee revenue generated by one referred wallet since a given
 * timestamp — unlike getEquitiesStatsForWallet, usd_value on a
 * kamino_borrow_fee row already IS the realized fee dollar amount
 * (computed client-side at the moment it's charged, in
 * executeKaminoAction()), not a trade value needing a bps multiplication.
 * "Volume" here is the borrow's full value, backed out from the fee at
 * the known flat rate — good enough for a dashboard total, not meant to
 * be authoritative to the cent. Matches both 'kamino_borrow_fee' (current —
 * fee moved onto borrows, charged in USDC) and the older
 * 'kamino_deposit_fee' kind (fee used to be charged on deposits, in
 * whatever stock was being deposited) so historical fee revenue from
 * before that change isn't dropped from lifetime totals. */
export async function getKaminoFeeStatsForWallet(walletAddress, sinceIso, feeBps) {
  if (!pool) return { volume: 0, fees: 0 };
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(usd_value), 0) AS fees
     FROM activity_log
     WHERE wallet_address = $1 AND kind IN ('kamino_borrow_fee', 'kamino_deposit_fee') AND status = 'confirmed'
       AND usd_value IS NOT NULL AND created_at >= $2`,
    [walletAddress, sinceIso],
  );
  const fees = Number(rows[0].fees);
  return { volume: feeBps > 0 ? (fees / feeBps) * 10000 : 0, fees };
}

// ————— Referral payout ledger —————
// Source of truth for "how much has this referrer already been paid,"
// per fee_source — always computed fresh from this table (SUM), never an
// in-memory counter. See the schema comment above for why.

/** Total already paid out (successfully) to this referrer for one fee
 * source — subtract this from the live-computed "earned" total to get
 * what's actually still payable. */
export async function getReferralPayoutsTotal(referrerPrivyUserId, feeSource) {
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM referral_payouts
     WHERE referrer_privy_user_id = $1 AND fee_source = $2 AND status IN ('sent', 'paid_manually')`,
    [referrerPrivyUserId, feeSource],
  );
  return Number(rows[0].total);
}

/** Insert a 'pending' payout row. Throws with e.code === '23505' (unique
 * violation) if this referrer already has a pending payout for this
 * fee_source — the caller should surface that as "a claim/request is
 * already in progress," not retry-loop it (unlike randomReferralCode's
 * retry-on-collision, a pending-payout conflict is a real, meaningful
 * state, not a random collision to paper over). */
export async function insertPendingReferralPayout({ referrerPrivyUserId, feeSource, amountUsd, method, walletAddress }) {
  if (!pool) throw new Error("database not configured");
  const { rows } = await pool.query(
    `INSERT INTO referral_payouts (referrer_privy_user_id, fee_source, amount_usd, method, wallet_address)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [referrerPrivyUserId, feeSource, amountUsd, method, walletAddress ?? null],
  );
  return rows[0].id;
}

export async function markReferralPayoutSent(id, txSignature) {
  if (!pool) return;
  await pool.query(
    `UPDATE referral_payouts SET status = 'sent', tx_signature = $2, completed_at = now() WHERE id = $1`,
    [id, txSignature],
  );
}

/** Releases the pending lock (the partial unique index only blocks
 * 'pending' rows) so a real failure — e.g. the on-chain send itself
 * erroring after the row was already inserted — doesn't permanently
 * strand this referrer/fee_source from ever claiming again. */
export async function markReferralPayoutFailed(id) {
  if (!pool) return;
  await pool.query(`UPDATE referral_payouts SET status = 'failed', completed_at = now() WHERE id = $1`, [id]);
}

export async function markReferralPayoutPaidManually(id, txSignature) {
  if (!pool) return;
  const { rows } = await pool.query(
    `UPDATE referral_payouts SET status = 'paid_manually', tx_signature = $2, completed_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id, txSignature ?? null],
  );
  return rows[0]?.id ?? null;
}

/** All pending manual-request payouts, oldest first — the admin review
 * queue for perps/equities payouts (never auto-sent, see index.js). */
export async function getPendingManualPayoutRequests() {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, referrer_privy_user_id, fee_source, amount_usd, wallet_address, created_at
     FROM referral_payouts WHERE method = 'manual_request' AND status = 'pending' ORDER BY created_at ASC`,
  );
  return rows;
}

/** This referrer's own payout history (all sources, all statuses) —
 * powers the "past payouts" list on their own dashboard. */
export async function getReferralPayoutsFor(referrerPrivyUserId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT fee_source, amount_usd, method, status, tx_signature, created_at, completed_at
     FROM referral_payouts WHERE referrer_privy_user_id = $1 ORDER BY created_at DESC`,
    [referrerPrivyUserId],
  );
  return rows;
}

/** Platform-wide Kamino fee revenue, all-time — powers the admin fee
 * dashboard (distinct from getKaminoFeeStatsForWallet above, which is
 * scoped to one referred wallet for the customer referral dashboard).
 * Broken down by mint — today that's always USDC (fees are charged on
 * borrows only), but the older kamino_deposit_fee rows this also includes
 * were collected in whatever stock was being deposited (AAPLx, TSLAx, ...),
 * so this stays grouped by mint rather than assuming one currency; the
 * caller resolves mint addresses to symbols via the token registry. */
export async function getKaminoFeeTotals() {
  if (!pool) return { totalUsd: 0, count: 0, byMint: [] };
  const [totals, byMint] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(usd_value), 0) AS total_usd, COUNT(*) AS count
       FROM activity_log WHERE kind IN ('kamino_borrow_fee', 'kamino_deposit_fee') AND status = 'confirmed'`,
    ),
    pool.query(
      `SELECT details->>'mint' AS mint, COALESCE(SUM(usd_value), 0) AS usd, COUNT(*) AS count
       FROM activity_log WHERE kind IN ('kamino_borrow_fee', 'kamino_deposit_fee') AND status = 'confirmed'
       GROUP BY details->>'mint' ORDER BY usd DESC`,
    ),
  ]);
  return {
    totalUsd: Number(totals.rows[0].total_usd),
    count: Number(totals.rows[0].count),
    byMint: byMint.rows.map((r) => ({ mint: r.mint, usd: Number(r.usd), count: Number(r.count) })),
  };
}

/** Records a fee owed on a borrow that just happened — created with the
 * server-computed amount at the moment /api/kamino/borrow builds the
 * transaction, using the SAME `amount` that determines what's actually
 * borrowed on-chain, so this can't be under-reported by a client. Unlike
 * logActivity, this one DOES throw on failure — it's what
 * getUnpaidKaminoFeeObligation blocks future borrows on, so a silently
 * "swallowed" insert here would silently defeat the whole point of it. */
export async function createKaminoFeeObligation({ walletAddress, amountUsd, feeAtoms }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO kamino_fee_obligations (wallet_address, amount_usd, fee_atoms) VALUES ($1, $2, $3) RETURNING id`,
    [walletAddress, amountUsd, feeAtoms],
  );
  return rows[0].id;
}

/** Most recent unpaid fee obligation for a wallet, if any — the borrow
 * route blocks a new borrow while this is non-null (see index.js), and
 * /api/kamino/fee builds the transfer from THIS row's fee_atoms rather
 * than trusting a client-supplied amount. Only looks back 24h so a
 * transient failure (fee tx never got signed, wallet closed, etc.) can't
 * permanently lock a wallet out of borrowing again — the obligation stays
 * in the table as unpaid for reporting either way, this just stops it
 * from blocking forever. */
export async function getUnpaidKaminoFeeObligation(walletAddress) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, wallet_address, amount_usd, fee_atoms, created_at FROM kamino_fee_obligations
     WHERE wallet_address = $1 AND paid_at IS NULL AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [walletAddress],
  );
  return rows[0] ?? null;
}

/** Marks an obligation settled once its fee transfer actually lands —
 * called from /api/execute only after executeSignedOrder has already
 * confirmed success (see the kind === "kamino_borrow_fee" branch there),
 * never speculatively. */
export async function markKaminoFeeObligationPaid(id, signature) {
  if (!pool || !id) return;
  try {
    await pool.query(`UPDATE kamino_fee_obligations SET paid_at = now(), signature = $2 WHERE id = $1`, [id, signature ?? null]);
  } catch (e) {
    console.error(`[db] markKaminoFeeObligationPaid failed (non-fatal): ${e.message}`);
  }
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

/* ————— Strategy Agents — persistent DCA / delta-neutral strategies plus
 * the proposals a background evaluator (server/src/strategyAgents/) writes
 * when one is due. Execution is never autonomous: creating a strategy only
 * ever produces a `strategy_proposals` row here; nothing in this file signs
 * or moves funds — the user confirms every proposal with their own wallet,
 * same trust model as every other trade in this codebase. —————
 */

export async function createStrategy({ walletAddress, evmAddress, privyUserId, type, params }) {
  if (!pool) throw new Error("database not configured");
  const { rows } = await pool.query(
    `INSERT INTO strategies (wallet_address, evm_address, privy_user_id, type, params)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [walletAddress, evmAddress ?? null, privyUserId ?? null, type, JSON.stringify(params)],
  );
  return rows[0].id;
}

export async function listStrategiesForWallet(walletAddress) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM strategies WHERE wallet_address = $1 ORDER BY created_at DESC`,
    [walletAddress],
  );
  return rows;
}

/** Full scan of every active strategy across every wallet — the evaluator's
 * per-tick worklist. Only ever called from the background job, never from a
 * request handler. */
export async function listActiveStrategies() {
  if (!pool) return [];
  const { rows } = await pool.query(`SELECT * FROM strategies WHERE status = 'active'`);
  return rows;
}

/** Gates strategy creation at MAX_ACTIVE_STRATEGIES_PER_WALLET (see
 * strategyRoutes.js) so one wallet can't unboundedly grow the evaluator's
 * per-tick workload. */
export async function countActiveStrategiesForWallet(walletAddress) {
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT count(*) FROM strategies WHERE wallet_address = $1 AND status = 'active'`,
    [walletAddress],
  );
  return Number(rows[0].count);
}

/** Ownership-checked the same way getProposal is — used by
 * applyStrategyExecutionState (strategyLegs.js) to read a strategy's
 * CURRENT state before merging in an execution-quality fill record, since
 * touchStrategyEvaluated replaces `state` wholesale rather than merging. */
export async function getStrategyById(id, walletAddress) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM strategies WHERE id = $1 AND wallet_address = $2`,
    [id, walletAddress],
  );
  return rows[0] ?? null;
}

/** Ownership-checked: the WHERE clause requires the row's own
 * wallet_address, so this can't be used to pause/cancel someone else's
 * strategy by guessing an id. Returns the updated row, or null if the id
 * doesn't exist or belongs to a different wallet. */
export async function setStrategyStatus(id, walletAddress, status) {
  if (!pool) throw new Error("database not configured");
  const { rows } = await pool.query(
    `UPDATE strategies SET status = $3 WHERE id = $1 AND wallet_address = $2 RETURNING *`,
    [id, walletAddress, status],
  );
  return rows[0] ?? null;
}

/** Called every eval tick regardless of whether the strategy turned out to
 * be due — `state` is the type module's own bookkeeping (e.g. DCA's
 * lastExecutedAt), kept separate from `params` so the evaluator never
 * mutates what the user actually configured. */
export async function touchStrategyEvaluated(id, { state }) {
  if (!pool) return;
  await pool.query(
    `UPDATE strategies SET last_evaluated_at = now(), state = $2 WHERE id = $1`,
    [id, JSON.stringify(state)],
  );
}

export async function markStrategyProposed(id) {
  if (!pool) return;
  await pool.query(`UPDATE strategies SET last_proposed_at = now() WHERE id = $1`, [id]);
}

export async function createProposal({ strategyId, walletAddress, kind, legs, summary, expiresAt }) {
  if (!pool) throw new Error("database not configured");
  const { rows } = await pool.query(
    `INSERT INTO strategy_proposals (strategy_id, wallet_address, kind, legs, summary, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [strategyId, walletAddress, kind, JSON.stringify(legs), summary, expiresAt],
  );
  return rows[0];
}

export async function listPendingProposalsForWallet(walletAddress) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM strategy_proposals WHERE wallet_address = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [walletAddress],
  );
  return rows;
}

/** Every proposal a strategy has ever had (any status) — the "history of
 * past purchases" view. Ownership-checked the same way getProposal is
 * (id + walletAddress together), so this can't be used to read another
 * wallet's strategy history by guessing an id. */
export async function listProposalsForStrategy(strategyId, walletAddress) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM strategy_proposals WHERE strategy_id = $1 AND wallet_address = $2 ORDER BY created_at DESC`,
    [strategyId, walletAddress],
  );
  return rows;
}

/** Ownership-checked the same way setStrategyStatus is — used before
 * building or confirming a proposal so a wallet can't act on one that
 * isn't theirs. */
export async function getProposal(id, walletAddress) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM strategy_proposals WHERE id = $1 AND wallet_address = $2`,
    [id, walletAddress],
  );
  return rows[0] ?? null;
}

/** Dedupe gate the evaluator checks before proposing again — same shape as
 * getUnpaidKaminoFeeObligation: a strategy with a still-pending proposal is
 * skipped rather than piling up a second one on the next tick. */
export async function hasPendingProposalForStrategy(strategyId) {
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM strategy_proposals WHERE strategy_id = $1 AND status = 'pending' LIMIT 1`,
    [strategyId],
  );
  return rows.length > 0;
}

export async function markProposalConfirmed(id, executedSignatures) {
  if (!pool) throw new Error("database not configured");
  await pool.query(
    `UPDATE strategy_proposals SET status = 'confirmed', resolved_at = now(), executed_signatures = $2 WHERE id = $1`,
    [id, executedSignatures ? JSON.stringify(executedSignatures) : null],
  );
}

export async function markProposalRejected(id) {
  if (!pool) throw new Error("database not configured");
  await pool.query(
    `UPDATE strategy_proposals SET status = 'rejected', resolved_at = now() WHERE id = $1`,
    [id],
  );
}

/** Bulk-expires anything the user never acted on — called at the top of
 * every eval tick so a stale pending proposal doesn't block
 * hasPendingProposalForStrategy forever if it's just being ignored. */
export async function expireStalePendingProposals() {
  if (!pool) return;
  await pool.query(
    `UPDATE strategy_proposals SET status = 'expired', resolved_at = now()
     WHERE status = 'pending' AND expires_at < now()`,
  );
}

/** Called from cancel so a cancelled strategy doesn't leave an orphaned
 * pending proposal a user could still confirm after the strategy itself is
 * gone. */
export async function expireProposalsForStrategy(strategyId) {
  if (!pool) return;
  await pool.query(
    `UPDATE strategy_proposals SET status = 'expired', resolved_at = now()
     WHERE strategy_id = $1 AND status = 'pending'`,
    [strategyId],
  );
}

/** Upserts the link for a chat — re-linking (e.g. a fresh /link code)
 * overwrites whatever wallet this chat pointed at before, matching the
 * old in-memory Map's `links.set()` semantics exactly. */
export async function upsertTelegramLink({ chatId, walletAddress }) {
  if (!pool) throw new Error("database not configured");
  await pool.query(
    `INSERT INTO telegram_links (chat_id, wallet_address) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET wallet_address = $2, linked_at = now()`,
    [chatId, walletAddress],
  );
}

/** Shaped as { address } (not the raw row) so every existing
 * `link.address` call site in telegram.js needed no rewrite beyond
 * awaiting this instead of a synchronous Map.get(). */
export async function getTelegramLinkForChat(chatId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT wallet_address FROM telegram_links WHERE chat_id = $1`,
    [chatId],
  );
  return rows[0] ? { address: rows[0].wallet_address } : null;
}

/** Every chat currently linked to a wallet — a wallet can have more than
 * one (re-linking from a new device doesn't unlink the old chat), so the
 * evaluator notifies all of them rather than assuming exactly one. */
export async function getTelegramLinksForWallet(walletAddress) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT chat_id FROM telegram_links WHERE wallet_address = $1`,
    [walletAddress],
  );
  return rows.map((r) => r.chat_id);
}
