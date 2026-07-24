import { PROTOCOL } from "../config.js";

export class DepositOrchestrator {
  constructor(providers, store) {
    this.providers = providers;
    this.store = store;
  }

  // `rail`, if given (a single rail id, or an array of them), quotes only
  // those providers — required once multiple providers bridge from
  // DIFFERENT source assets (SOL vs USDC), since the same numeric
  // inputAmount means a different thing for each and isn't a fair
  // "pick the best quote" comparison. Omit `rail` to compare every
  // registered provider, or pass an array to compare a specific subset
  // that share the same input asset (e.g. the two USDC-source rails).
  async quote(inputAmount, user, rail) {
    const rails = Array.isArray(rail) ? rail : rail ? [rail] : Object.keys(this.providers);
    const providers = rails.map((r) => this.providers[r]).filter(Boolean);
    const quotes = await Promise.allSettled(providers.map((p) => p.quote(inputAmount, user)));
    const ok = quotes
      .filter((q) => q.status === "fulfilled")
      .map((q) => q.value);
    if (!ok.length) {
      // Surface the real reason (e.g. "below the $5 USDC bridge minimum")
      // instead of a generic message that hides why every provider failed.
      const reasons = quotes
        .filter((q) => q.status === "rejected")
        .map((q) => (q.reason instanceof Error ? q.reason.message : String(q.reason)));
      throw new Error(reasons[0] || "no funding rail available for quote");
    }
    return ok.sort((a, b) => b.estimatedUsdcOut - a.estimatedUsdcOut);
  }

  async start(id, rail, inputSol, user) {
    validateDeposit(rail, inputSol);
    const existing = await this.store.load(id);
    if (existing) return this.resume(existing);
    const state = {
      id, rail, step: "QUOTING", user, inputSol,
      srcAsset: this.providers[rail]?.srcAsset || "sol",
      legs: {}, updatedAt: Date.now(),
    };
    await this.store.save(state);
    return this.resume(state);
  }

  async resume(state) {
    const provider = this.providers[state.rail];
    let current = state;
    for (let i = 0; i < 12; i++) {
      if (current.step === "DONE" || current.step === "FAILED") break;
      const before = current.step;
      try {
        current = await provider.advance(current);
      } catch (e) {
        current = {
          ...current,
          step: "FAILED",
          error: e instanceof Error ? e.message : String(e),
          updatedAt: Date.now(),
        };
      }
      await this.store.save(current);
      if (current.step === before) break;
    }
    return current;
  }

  /**
   * Explicitly triggers the final Hyperliquid Bridge2 deposit signatures —
   * only call this from a real user click (e.g. a "Complete Deposit"
   * button), never from a poll/timer. Distinct from resume()'s automatic
   * loop, which only ever checks readiness for this step, not attempts it.
   */
  async completeDeposit(state) {
    const provider = this.providers[state.rail];
    if (!provider.completeHlDeposit) throw new Error("this rail doesn't support manual completion");
    let next;
    try {
      next = await provider.completeHlDeposit(state);
    } catch (e) {
      next = { ...state, step: "FAILED", error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() };
    }
    await this.store.save(next);
    return next;
  }
}

export function validateDeposit(rail, inputSol) {
  if (!(inputSol > 0)) throw new Error("deposit must be > 0 SOL");
  if (rail === "unit" && inputSol < PROTOCOL.MIN_UNIT_SOL_DEPOSIT) {
    throw new Error(
      `Unit rail minimum is ${PROTOCOL.MIN_UNIT_SOL_DEPOSIT} SOL — smaller deposits are not credited`,
    );
  }
}

/** In-memory store for testnet demo — no persistence needed */
export class MemoryStateStore {
  constructor() {
    this._map = new Map();
  }
  async load(id) { return this._map.get(id) ?? null; }
  async save(state) { this._map.set(state.id, state); }
}

/** localStorage-backed store for resuming across refreshes */
export class LocalStateStore {
  constructor(prefix = "lv_dep_") {
    this._prefix = prefix;
  }
  async load(id) {
    try {
      const raw = localStorage.getItem(this._prefix + id);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  async save(state) {
    try { localStorage.setItem(this._prefix + state.id, JSON.stringify(state)); } catch {}
  }
}
