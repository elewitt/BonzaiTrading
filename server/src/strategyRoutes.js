import { STRATEGY_TYPES, MAX_ACTIVE_STRATEGIES_PER_WALLET } from "./strategyAgents/index.js";
import { USDC } from "./tokens.js";

/**
 * Mounts every Strategy Agents route on the given Express app. `deps`
 * carries the pieces already defined in index.js (registry, order
 * building, holdings/prices, activity logging, the strategy-state db
 * functions, the delta-neutral eligible-assets lookup, and the rate
 * limiter) so this module doesn't need a circular import back into
 * index.js — same shape as telegram.js's mountTelegramRoutes.
 *
 * Every route here requires the same requireAuth/requireAllowedGeo/
 * requireActiveAccount stack as /api/order and /api/kamino/:action.
 * Ownership is enforced by checking the client-supplied walletAddress
 * against the row, the same trust model already used everywhere else in
 * this codebase (Solana ownership is enforced at signing, not at this
 * layer) — requireAuth only proves a genuine logged-in Privy session, it
 * doesn't separately re-verify on-chain ownership of `walletAddress`.
 */
export function mountStrategyRoutes(app, deps) {
  const {
    requireAuth, requireAllowedGeo, requireActiveAccount, strategyLimiter,
    getRegistry, buildOrder, logActivity, getHoldingsForAddress, getPricesForMints,
    getDeltaNeutralEligibleAssets,
    createStrategy, listStrategiesForWallet, countActiveStrategiesForWallet,
    setStrategyStatus, touchStrategyEvaluated,
    listPendingProposalsForWallet, getProposal, listProposalsForStrategy,
    markProposalRejected, markProposalConfirmed, expireProposalsForStrategy,
  } = deps;
  const stack = [requireAuth, requireAllowedGeo, requireActiveAccount];

  /** Resolves + validates a strategy's params against the live registry
   * (and, for delta-neutral, the live Hyperliquid universe) before
   * anything is persisted. Stamps derived fields (a DCA mint; a
   * delta-neutral spotMint/hlCoin/hlDex) into the stored params so
   * evaluate() never has to trust or re-derive them later — same
   * "resolve once at creation" pattern for both types. Returns the params
   * object to store, or throws a plain Error with a user-facing message. */
  async function resolveParams(type, params) {
    if (type === "dca") {
      const { bySymbol } = await getRegistry();
      const token = bySymbol[params.symbol];
      if (!token || !token.mint || token.symbol === "USDC") {
        throw new Error(`unknown or unsupported symbol: ${params.symbol}`);
      }
      return { symbol: token.symbol, mint: token.mint, usdPerInterval: Number(params.usdPerInterval), intervalDays: Number(params.intervalDays) };
    }
    if (type === "delta_neutral") {
      const eligible = await getDeltaNeutralEligibleAssets();
      const asset = eligible.find((a) => a.symbol === params.symbol);
      if (!asset) throw new Error(`"${params.symbol}" isn't eligible for delta-neutral — it needs to be tradeable as both a spot asset here and a Hyperliquid perp.`);
      return {
        symbol: asset.symbol, spotMint: asset.mint, hlCoin: asset.hlCoin, hlDex: asset.hlDex,
        notionalUsd: Number(params.notionalUsd), leverage: Number(params.leverage),
        rebalanceThresholdPct: Number(params.rebalanceThresholdPct), unfavorableFundingExitHours: Number(params.unfavorableFundingExitHours),
      };
    }
    return params;
  }

  app.post("/api/strategies", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress, evmAddress, type, params } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const strategyType = STRATEGY_TYPES[type];
      if (!strategyType) return res.status(400).json({ error: `unsupported strategy type: ${type}` });
      if (type === "delta_neutral" && !evmAddress) {
        return res.status(400).json({ error: "evmAddress required for delta-neutral strategies (needed to read your live perp position)" });
      }

      const paramError = strategyType.validateParams(params);
      if (paramError) return res.status(400).json({ error: paramError });

      const activeCount = await countActiveStrategiesForWallet(walletAddress);
      if (activeCount >= MAX_ACTIVE_STRATEGIES_PER_WALLET) {
        return res.status(400).json({ error: `You can have at most ${MAX_ACTIVE_STRATEGIES_PER_WALLET} active strategies at a time.` });
      }

      const resolvedParams = await resolveParams(type, params);
      const id = await createStrategy({ walletAddress, evmAddress, privyUserId: req.privyUserId, type, params: resolvedParams });
      res.json({ id });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/strategies", ...stack, async (req, res) => {
    try {
      const wallet = String(req.query.wallet || "");
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      res.json({ strategies: await listStrategiesForWallet(wallet) });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  /** Every asset delta-neutral can currently target — read-only, no
   * wallet-specific data, but kept behind the same auth stack as
   * everything else here for consistency rather than carving out a
   * one-off public exception. */
  app.get("/api/strategies/delta-neutral/eligible-assets", ...stack, async (req, res) => {
    try {
      res.json({ assets: await getDeltaNeutralEligibleAssets() });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  /** Every proposal a strategy has ever had — "history of past purchases"
   * on the Trading Agent page. Every status is returned (not just
   * confirmed) so the UI can distinguish an executed buy from one that
   * was rejected or expired unconfirmed, rather than the history silently
   * looking sparser than what actually happened. */
  app.get("/api/strategies/:id/history", ...stack, async (req, res) => {
    try {
      const wallet = String(req.query.wallet || "");
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      res.json({ proposals: await listProposalsForStrategy(req.params.id, wallet) });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  async function transitionStrategy(req, res, status) {
    try {
      const { walletAddress } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const updated = await setStrategyStatus(req.params.id, walletAddress, status);
      if (!updated) return res.status(404).json({ error: "strategy not found" });
      if (status === "cancelled") await expireProposalsForStrategy(req.params.id);
      res.json({ strategy: updated });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  }
  app.post("/api/strategies/:id/pause", ...stack, strategyLimiter, (req, res) => transitionStrategy(req, res, "paused"));
  app.post("/api/strategies/:id/resume", ...stack, strategyLimiter, (req, res) => transitionStrategy(req, res, "active"));
  app.post("/api/strategies/:id/cancel", ...stack, strategyLimiter, (req, res) => transitionStrategy(req, res, "cancelled"));

  app.get("/api/strategies/proposals", ...stack, async (req, res) => {
    try {
      const wallet = String(req.query.wallet || "");
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      res.json({ proposals: await listPendingProposalsForWallet(wallet) });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/strategies/proposals/:id/reject", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const proposal = await getProposal(req.params.id, walletAddress);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") return res.status(400).json({ error: `proposal is already ${proposal.status}` });
      await markProposalRejected(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  /** Resolves ONE spot leg into a real, freshly-built Jupiter order.
   * `leg.amount` (DCA's precomputed-atomic-units convention) is used
   * as-is when present — unchanged from Phase A. Delta-neutral's legs
   * never carry a precomputed amount for a SELL: a sell amount computed
   * back when the proposal was created could be stale by the time the
   * user actually confirms (the held balance may have changed since), so
   * `usd`/`sellAll` legs resolve their real atomic amount from LIVE
   * holdings/prices right here — same never-reuse-a-stale-number
   * principle DCA already applies to the Jupiter quote itself, just
   * extended to the sell side too. Buys always resolve fresh from `usd`
   * (USDC's decimals never change, so this is safe to compute right at
   * build time rather than needing a precomputed amount at all). */
  async function resolveSpotLegOrder(leg, walletAddress) {
    let amount;
    if (leg.amount != null) {
      amount = String(leg.amount);
    } else if (leg.side === "buy") {
      amount = String(Math.floor(leg.usd * 10 ** USDC.decimals));
    } else {
      const holdings = await getHoldingsForAddress(walletAddress);
      const held = holdings.tokens?.find((t) => t.mint === leg.inputMint);
      if (!held || Number(held.amount) === 0) throw new Error(`No ${leg.symbol} balance to sell.`);
      if (leg.sellAll) {
        amount = held.amount;
      } else {
        const prices = await getPricesForMints([leg.inputMint]);
        const price = prices[leg.inputMint];
        if (!price) throw new Error(`No live price available for ${leg.symbol} right now.`);
        // Never propose selling more than what's actually held, even if
        // the usd target (computed from a possibly-stale price snapshot
        // at evaluate time) would work out to more.
        amount = String(Math.min(Math.floor((leg.usd / price) * 10 ** held.decimals), Number(held.amount)));
      }
    }
    return buildOrder({ inputMint: leg.inputMint, outputMint: leg.outputMint, amount, taker: walletAddress });
  }

  /** Never reuses the amount/quote captured when the proposal was created
   * for the SPOT leg — Ultra RFQ TTLs are ~52s, so a proposal that's been
   * sitting for even a few minutes needs a genuinely fresh order. A PERP
   * leg has nothing to "build" server-side at all — perps sign entirely
   * client-side (no unsigned tx, no quote), so it's passed through as-is
   * for the client to resolve (assetIndex/szDecimals via its own
   * Hyperliquid client) and sign itself, exactly like the existing
   * perps-via-prompt flow already does. Named "build," not "confirm": it
   * doesn't flip any status — only report-execution does, once the
   * client has actually executed what this returns. */
  app.post("/api/strategies/proposals/:id/build", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const proposal = await getProposal(req.params.id, walletAddress);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") return res.status(400).json({ error: `proposal is already ${proposal.status}` });
      if (new Date(proposal.expires_at) < new Date()) return res.status(400).json({ error: "proposal has expired" });

      const legs = [];
      for (const leg of proposal.legs) {
        if (leg.domain === "spot") {
          legs.push({ domain: "spot", order: await resolveSpotLegOrder(leg, walletAddress) });
        } else if (leg.domain === "perp") {
          legs.push({ domain: "perp", side: leg.side, hlCoin: leg.hlCoin, hlDex: leg.hlDex, notionalUsd: leg.notionalUsd ?? null, leverage: leg.leverage ?? null });
        } else {
          return res.status(501).json({ error: "this proposal type isn't supported yet" });
        }
      }
      res.json({ legs });
    } catch (e) {
      res.status(e.status || 502).json({ error: String(e.message || e) });
    }
  });

  /** Called by the client after it has already signed and executed every
   * leg `.../build` returned. Writes the confirmation, logs the SPOT leg
   * only to activity_log (kind:"swap" — this is what makes a spot buy
   * count toward referral fee volume, since getEquitiesStatsForWallet
   * already keys off kind='swap'; perp trades are tracked by Hyperliquid
   * itself, not this app's own activity log, matching how every other
   * perp trade in this codebase is already handled), and updates strategy
   * state/status according to which kind of proposal this was. */
  app.post("/api/strategies/proposals/:id/report-execution", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress, legResults } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const proposal = await getProposal(req.params.id, walletAddress);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") return res.status(400).json({ error: `proposal is already ${proposal.status}` });
      if (!Array.isArray(legResults) || legResults.length === 0) return res.status(400).json({ error: "legResults required" });

      await markProposalConfirmed(req.params.id, legResults.map((l) => l.signature).filter(Boolean));

      const spotLegIdx = proposal.legs.findIndex((l) => l.domain === "spot");
      if (spotLegIdx !== -1 && legResults[spotLegIdx]?.signature) {
        const leg = proposal.legs[spotLegIdx];
        logActivity({
          walletAddress, privyUserId: req.privyUserId, kind: "swap",
          symbol: leg.symbol, side: leg.side, usdValue: leg.usd ?? null, signature: legResults[spotLegIdx].signature,
          details: { inputMint: leg.inputMint, outputMint: leg.outputMint, feeBps: legResults[spotLegIdx].feeBps ?? null, strategyId: proposal.strategy_id, proposalId: proposal.id },
        });
      }

      if (proposal.kind === "delta_neutral_open") {
        const now = new Date().toISOString();
        await touchStrategyEvaluated(proposal.strategy_id, { state: { openedAt: now, lastFundingCheckedAt: now } });
      } else if (proposal.kind === "delta_neutral_exit") {
        await setStrategyStatus(proposal.strategy_id, walletAddress, "completed");
      } else if (proposal.kind !== "delta_neutral_rebalance") {
        // dca_buy — delta_neutral_rebalance needs no state change here at
        // all: evaluate() recomputes drift fresh from live holdings/perp
        // positions on the next tick regardless.
        await touchStrategyEvaluated(proposal.strategy_id, { state: { lastExecutedAt: new Date().toISOString() } });
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });
}
