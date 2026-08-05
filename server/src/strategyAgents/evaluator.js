import { STRATEGY_TYPES } from "./index.js";
import { sendEmail } from "../email.js";
import { notifyStrategyProposal as sendTelegramProposal } from "../telegram.js";
import {
  listActiveStrategies, hasPendingProposalForStrategy, touchStrategyEvaluated,
  createProposal, markStrategyProposed, expireStalePendingProposals,
} from "../db.js";

/* ————— Strategy Agents — background evaluator —————
 * Same shape as marketHealth.js/predictionMarkets.js (fire once immediately,
 * then on setInterval), with the one deviation this feature requires: it
 * writes durable proposals to Postgres instead of an in-memory snapshot.
 * Never signs or moves anything itself — evaluate() only ever returns a
 * proposal description; the user reviews and signs every leg themselves in
 * the app. A failure evaluating one strategy is caught and logged, never
 * allowed to take down the rest of that tick.
 */
const EVAL_INTERVAL_MS = Number(process.env.STRATEGY_EVAL_INTERVAL_MS || 30 * 60 * 1000);
const DEFAULT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // matches kamino_fee_obligations' 24h precedent
const PROPOSAL_TTL_MS = {
  dca_buy: 24 * 60 * 60 * 1000,
};

function groupByWallet(strategies) {
  const byWallet = new Map();
  for (const s of strategies) {
    if (!byWallet.has(s.wallet_address)) byWallet.set(s.wallet_address, []);
    byWallet.get(s.wallet_address).push(s);
  }
  return byWallet;
}

/** Holdings + prices fetched ONCE per wallet per tick, shared across every
 * strategy that wallet owns — cheap even at Phase A's single-DCA-type
 * scale, and the multi-leg Phase B types will need the same holdings read
 * anyway (e.g. rebalance-drift's spotValueUsd). Fails soft: a wallet whose
 * holdings can't be read right now just evaluates with `holdings: null` —
 * DCA doesn't use it at all, and no strategy type should ever hard-fail a
 * whole tick because one RPC call had a bad moment. */
async function buildContext(wallet, deps) {
  const holdings = await deps.getHoldingsForAddress(wallet).catch(() => null);
  const mints = (holdings?.tokens || []).map((t) => t.mint);
  const prices = mints.length ? await deps.getPricesForMints(mints).catch(() => ({})) : {};
  return { holdings, prices };
}

/** Best-effort nudges on every channel the wallet has connected — a
 * proposal sits waiting in the app regardless of whether either of these
 * succeeds, so a missing RESEND_API_KEY, no linked email, or no linked
 * Telegram chat must never block proposal creation itself. The two
 * channels are independent (one failing/missing doesn't skip the other). */
async function notifyProposal(strategy, proposal, deps) {
  const expiresLabel = new Date(proposal.expires_at).toLocaleString();

  if (strategy.privy_user_id && deps.privyClient) {
    try {
      const user = await deps.privyClient.getUserById(strategy.privy_user_id);
      const email = user?.linkedAccounts?.find((a) => a.type === "email")?.address;
      if (email) {
        await sendEmail({
          to: email,
          subject: "Bonzai Trading — a strategy proposal is ready to confirm",
          text: `${proposal.summary}\n\nReview and confirm it in the app: https://bonzaitrading.com\n\nThis proposal expires at ${expiresLabel} if not confirmed.`,
        });
      }
    } catch (e) {
      console.error(`[strategyAgents] email notify failed for strategy ${strategy.id}:`, e.message);
    }
  }

  try {
    await sendTelegramProposal(
      strategy.wallet_address,
      `📩 ${proposal.summary}\n\nReply "YES ${proposal.id}" to confirm or "NO ${proposal.id}" to reject.\nExpires ${expiresLabel}.\n\nOr review it in the app: https://bonzaitrading.com`,
    );
  } catch (e) {
    console.error(`[strategyAgents] telegram notify failed for strategy ${strategy.id}:`, e.message);
  }
}

async function evaluateStrategy(strategy, ctx, deps) {
  const type = STRATEGY_TYPES[strategy.type];
  if (!type) return; // unknown/not-yet-implemented type (e.g. delta_neutral before Phase B ships) — skip, don't crash the tick

  if (await hasPendingProposalForStrategy(strategy.id)) return; // don't pile up duplicates while one's still awaiting confirmation

  const result = await type.evaluate(strategy, ctx);
  await touchStrategyEvaluated(strategy.id, { state: strategy.state });
  if (!result) return;

  const ttlMs = PROPOSAL_TTL_MS[result.kind] ?? DEFAULT_PROPOSAL_TTL_MS;
  const proposal = await createProposal({
    strategyId: strategy.id, walletAddress: strategy.wallet_address,
    kind: result.kind, legs: result.legs, summary: result.summary,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  await markStrategyProposed(strategy.id);
  await notifyProposal(strategy, proposal, deps);
}

async function tick(deps) {
  await expireStalePendingProposals();
  const strategies = await listActiveStrategies();
  if (!strategies.length) return;

  const byWallet = groupByWallet(strategies);
  for (const [wallet, walletStrategies] of byWallet) {
    const ctx = await buildContext(wallet, deps);
    for (const strategy of walletStrategies) {
      try {
        await evaluateStrategy(strategy, ctx, deps);
      } catch (e) {
        console.error(`[strategyAgents] eval failed for strategy ${strategy.id}:`, e.message);
      }
    }
  }
}

/** Starts the background job. Call once at boot, alongside
 * startMarketHealthMonitor()/startPredictionMarketsMonitor() — never
 * awaited by any request, purely a side background loop.
 * `deps`: { getHoldingsForAddress, getPricesForMints, privyClient } */
export function startStrategyEvaluator(deps) {
  const run = () => void tick(deps).catch((e) => console.error("[strategyAgents] tick failed:", e.message));
  run();
  return setInterval(run, EVAL_INTERVAL_MS);
}
