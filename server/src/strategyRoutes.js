import { STRATEGY_TYPES, MAX_ACTIVE_STRATEGIES_PER_WALLET } from "./strategyAgents/index.js";

/**
 * Mounts every Strategy Agents route on the given Express app. `deps`
 * carries the pieces already defined in index.js (registry, order
 * building, activity logging, the strategy-state db functions, and the
 * rate limiter) so this module doesn't need a circular import back into
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
    getRegistry, buildOrder, logActivity,
    createStrategy, listStrategiesForWallet, countActiveStrategiesForWallet,
    setStrategyStatus, touchStrategyEvaluated,
    listPendingProposalsForWallet, getProposal, listProposalsForStrategy,
    markProposalRejected, markProposalConfirmed, expireProposalsForStrategy,
  } = deps;
  const stack = [requireAuth, requireAllowedGeo, requireActiveAccount];

  /** Resolves + validates a strategy's params against the live registry
   * before anything is persisted. Type-specific: DCA needs a spot mint
   * resolved from `params.symbol` and stamped into the stored params (see
   * strategyAgents/dca.js's own comment) so evaluate() never has to trust
   * or re-derive a client-supplied mint later. Returns the params object to
   * store, or throws a plain Error with a user-facing message. */
  async function resolveParams(type, params) {
    if (type === "dca") {
      const { bySymbol } = await getRegistry();
      const token = bySymbol[params.symbol];
      if (!token || !token.mint || token.symbol === "USDC") {
        throw new Error(`unknown or unsupported symbol: ${params.symbol}`);
      }
      return { symbol: token.symbol, mint: token.mint, usdPerInterval: Number(params.usdPerInterval), intervalDays: Number(params.intervalDays) };
    }
    return params; // Phase B (delta_neutral) resolves its own eligible-asset shape when that type lands
  }

  app.post("/api/strategies", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress, evmAddress, type, params } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const strategyType = STRATEGY_TYPES[type];
      if (!strategyType) return res.status(400).json({ error: `unsupported strategy type: ${type}` });

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

  /** Never reuses the amount/quote captured when the proposal was created —
   * Ultra RFQ TTLs are ~52s, so a proposal that's been sitting for even a
   * few minutes needs a genuinely fresh order. Named "build," not
   * "confirm": it doesn't flip any status — only report-execution does,
   * once the client has actually executed what this returns. */
  app.post("/api/strategies/proposals/:id/build", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const proposal = await getProposal(req.params.id, walletAddress);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") return res.status(400).json({ error: `proposal is already ${proposal.status}` });
      if (new Date(proposal.expires_at) < new Date()) return res.status(400).json({ error: "proposal has expired" });

      const leg = proposal.legs[0];
      if (!leg || leg.domain !== "spot") return res.status(501).json({ error: "this proposal type isn't supported yet" });
      const order = await buildOrder({ inputMint: leg.inputMint, outputMint: leg.outputMint, amount: String(leg.amount), taker: walletAddress });
      res.json(order);
    } catch (e) {
      res.status(e.status || 502).json({ error: String(e.message || e) });
    }
  });

  /** Called by the client after it has already signed and executed the
   * leg(s) `.../build` returned (via the normal /api/execute path, exactly
   * like any other swap). Writes the confirmation, and logs a kind:"swap"
   * activity row for the executed leg — this is what makes DCA buys count
   * toward referral fee volume for free, since getEquitiesStatsForWallet
   * already keys off kind='swap'; no new accounting path needed. */
  app.post("/api/strategies/proposals/:id/report-execution", ...stack, strategyLimiter, async (req, res) => {
    try {
      const { walletAddress, legResults } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
      const proposal = await getProposal(req.params.id, walletAddress);
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "pending") return res.status(400).json({ error: `proposal is already ${proposal.status}` });
      const signature = legResults?.[0]?.signature;
      if (!signature) return res.status(400).json({ error: "signature required" });

      await markProposalConfirmed(req.params.id, legResults.map((l) => l.signature).filter(Boolean));

      const leg = proposal.legs[0];
      logActivity({
        walletAddress, privyUserId: req.privyUserId, kind: "swap",
        symbol: leg.symbol, side: leg.side, usdValue: leg.usd, signature,
        details: { inputMint: leg.inputMint, outputMint: leg.outputMint, amount: leg.amount, feeBps: legResults[0].feeBps ?? null, strategyId: proposal.strategy_id, proposalId: proposal.id },
      });
      // DCA-shaped: state is just { lastExecutedAt }. Phase B's multi-leg
      // types will need to merge into existing state here rather than
      // overwrite it wholesale.
      await touchStrategyEvaluated(proposal.strategy_id, { state: { lastExecutedAt: new Date().toISOString() } });

      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });
}
