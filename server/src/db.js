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
      type TEXT NOT NULL CHECK (type IN ('dca', 'delta_neutral')),
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
