import { STRATEGY_TYPES } from "./index.js";
import { sendEmail } from "../email.js";
import { notifyStrategyProposal as sendTelegramProposal } from "../telegram.js";
import { getPerpsPositions } from "../hyperliquid.js";
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
  delta_neutral_open: 24 * 60 * 60 * 1000,
  delta_neutral_exit: 4 * 60 * 60 * 1000, // shorter — the condition driving this can shift faster than a day
  delta_neutral_rebalance: 4 * 60 * 60 * 1000,
  twap_slice: 2 * 60 * 60 * 1000, // slices are only ~30min apart — a stale unconfirmed one defeats the point of a timed execution schedule
  vwap_slice: 2 * 60 * 60 * 1000,
  trigger_fill: 6 * 60 * 60 * 1000, // the condition that fired it can un-fire just as fast — shorter than DCA's day-long window
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
 * strategy that wallet owns. Also fetches live Hyperliquid perp positions
 * when at least one of the wallet's strategies has an evm_address on file
 * (only delta-neutral strategies set one — DCA never touches perps) —
 * needed for rebalance-drift's perpValueUsd. Fails soft throughout: a
 * wallet whose holdings/positions can't be read right now just evaluates
 * with empty data rather than hard-failing the whole tick.
 *
 * Prices normally only cover currently-HELD mints (all the other types
 * only ever need to price something already in the wallet). A trigger
 * strategy watching an asset the wallet doesn't hold yet (e.g. "buy the
 * dip" on something new) needs that mint priced too, so its target mints
 * are folded into the same batched price fetch here rather than each
 * trigger strategy fetching its own price independently every tick. */
async function buildContext(wallet, evmAddress, walletStrategies, deps) {
  const holdings = await deps.getHoldingsForAddress(wallet).catch(() => null);
  const heldMints = (holdings?.tokens || []).map((t) => t.mint);
  const triggerMints = walletStrategies
    .filter((s) => s.type === "trigger" && s.params?.mint)
    .map((s) => s.params.mint);
  const mints = [...new Set([...heldMints, ...triggerMints])];
  const prices = mints.length ? await deps.getPricesForMints(mints).catch(() => ({})) : {};
  const perps = evmAddress ? await getPerpsPositions(evmAddress).catch(() => ({ positions: [] })) : { positions: [] };
  return { holdings, prices, perpPositions: perps.positions };
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
  if (!type) return; // unknown/not-yet-implemented type — skip, don't crash the tick

  if (await hasPendingProposalForStrategy(strategy.id)) return; // don't pile up duplicates while one's still awaiting confirmation

  const result = await type.evaluate(strategy, ctx);
  // `newState` is how a type persists its own per-tick bookkeeping (e.g.
  // delta-neutral's lastFundingCheckedAt) independent of whether anything
  // was actually due — falls back to the strategy's existing state
  // unchanged when a type doesn't use it (DCA never does).
  await touchStrategyEvaluated(strategy.id, { state: result?.newState ?? strategy.state });
  if (!result?.kind) return; // nothing due this tick

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
    const evmAddress = walletStrategies.find((s) => s.evm_address)?.evm_address ?? null;
    const ctx = await buildContext(wallet, evmAddress, walletStrategies, deps);
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
