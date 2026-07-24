/**
 * Withdraw funds from Hyperliquid back to the user's Solana/Bonzai Trading
 * balance. Two legs, both real money movements needing separate user
 * signatures — mirrors the deposit flow's "polling only checks readiness,
 * signing only ever happens from a real click" rule established after a
 * real stuck deposit confirmed background-triggered signing silently never
 * completes with Privy's embedded wallets:
 *
 *   1. Hyperliquid withdraw3 → lands USDC on the user's own Arbitrum
 *      address (~5 min, Hyperliquid's own $1 flat fee taken automatically).
 *      Rail-agnostic — this step is identical no matter which bridge
 *      brings the funds back to Solana afterward.
 *   2. Arbitrum → Solana, via either deBridge DLN (the original rail) or
 *      CCTP V2 (added alongside it — Circle's native burn-and-mint, no
 *      solver margin, same tradeoff as the deposit direction's two rails).
 *      Selected per-withdrawal via `rail` at start() time.
 */
import { encodeFunctionData } from "viem";
import { PROTOCOL } from "../config.js";
import { API_BASE } from "../../lib/api.js";
import { buildWithdrawBurnTxs } from "./cctp/withdrawBurnEvm.js";

const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const ARB_USDC = PROTOCOL.ARBITRUM_NATIVE_USDC;
const ARB_CHAIN_ID = 42161;

// Hyperliquid takes a flat $1 withdraw fee, and the return bridge has its
// own ~$1 fee on top (deBridge's fixed 0.001 ETH protocol fee + DLN
// margin) — anything much smaller than this isn't worth withdrawing.
export const MIN_WITHDRAW_USDC = 5;

// deBridge's fixed protocol fee on EVM-origin orders (paid as native ETH
// tx value, confirmed via a real create-tx response for this exact route)
// plus gas for both the approve and order-creation transactions.
const MIN_ARB_ETH_FOR_BRIDGE_WEI = "1500000000000000"; // 0.0015 ETH
// CCTP's approve + depositForBurn need less — no protocol fee paid as tx
// value (Standard Transfer, maxFee=0), just gas for the two calls.
const MIN_ARB_ETH_FOR_CCTP_WEI = "500000000000000"; // 0.0005 ETH

const ERC20_ABI = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];

async function getArbUsdcBalanceAtoms(address) {
  const data = "0x70a08231" + "000000000000000000000000" + address.slice(2).toLowerCase();
  const r = await fetch(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: ARB_USDC, data }, "latest"] }),
  });
  const { result } = await r.json();
  return BigInt(result);
}

async function getArbEthBalance(address) {
  const r = await fetch(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const { result } = await r.json();
  return BigInt(result);
}

/**
 * Confirmed as a real bug against a real stuck withdrawal: sendEvmTx (Privy's
 * sendTransaction) only guarantees the transaction was broadcast, not that it
 * succeeded on-chain — a reverted order-creation tx was treated as complete
 * (state advanced to AWAITING_SOL_CREDIT, a bridgeOrderId was recorded) while
 * the wallet's Arbitrum balance never actually moved and deBridge's API had
 * no record of the order ("UNKNOWN_ORDER"). Every EVM transaction in this
 * flow must be confirmed via receipt before the state machine trusts it.
 */
async function waitForArbTxReceipt(hash, { timeoutMs = 60_000, pollMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(ARB_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    });
    const { result } = await r.json();
    if (result) {
      if (result.status === "0x1") return result;
      throw new Error(`Transaction ${hash} reverted on-chain.`);
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  throw new Error(`Transaction ${hash} didn't confirm within ${timeoutMs / 1000}s — check an Arbitrum block explorer.`);
}

export class WithdrawOrchestrator {
  /**
   * @param {object} opts
   * @param {import("../hl/client.js").LongviewHl} opts.hl
   * @param {object} opts.mainWallet  Signing account for both withdraw3 and the bridge txs.
   * @param {(params: {to: string, data: string, chainId: number, gasLimit: number, value?: string}) => Promise<string>} opts.sendEvmTx
   * @param {{load: (id: string) => Promise<object|null>, save: (state: object) => Promise<void>}} opts.store
   */
  constructor({ hl, mainWallet, sendEvmTx, store }) {
    this.hl = hl;
    this.mainWallet = mainWallet;
    this.sendEvmTx = sendEvmTx;
    this.store = store;
  }

  // `rail`, if given (a single rail id or an array), quotes only those —
  // same convention DepositOrchestrator.quote() uses. Omit to compare both.
  async quote(usdcAmount, user, rail) {
    const rails = Array.isArray(rail) ? rail : rail ? [rail] : ["debridge", "cctp"];
    const results = await Promise.allSettled(rails.map((r) => this._quoteOne(usdcAmount, user, r)));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) {
      const reasons = results.filter((r) => r.status === "rejected").map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      throw new Error(reasons[0] || "no return-bridge rail available for quote");
    }
    return ok.sort((a, b) => b.usdcOut - a.usdcOut);
  }

  async _quoteOne(usdcAmount, user, rail) {
    if (rail === "cctp") {
      // CCTP V2 Standard Transfer (maxFee=0) is a native 1:1 burn-and-mint
      // — no solver margin like deBridge's DLN, so the only real cost is
      // gas (already sponsored). etaSeconds is an estimate, not a live
      // quote — same reasoning as the deposit direction's CCTP rail.
      return { rail: "cctp", usdcOut: usdcAmount, feeUsd: 0, etaSeconds: 120 };
    }
    const r = await fetch(`${API_BASE}/api/perps/withdraw-bridge/quote?usdcAmount=${usdcAmount}&solanaRecipient=${encodeURIComponent(user.solana)}&evmSender=${encodeURIComponent(user.evm)}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "couldn't price this withdrawal");
    const d = await r.json(); // { usdcOut, feeUsd, etaSeconds }
    return { rail: "debridge", ...d };
  }

  async start(id, usdcAmount, user, rail = "cctp") {
    if (!(usdcAmount >= MIN_WITHDRAW_USDC)) {
      throw new Error(`Minimum withdrawal is $${MIN_WITHDRAW_USDC} — Hyperliquid's flat $1 fee plus the return bridge fee make smaller amounts not worth withdrawing.`);
    }
    const existing = await this.store.load(id);
    if (existing) return existing;
    const state = { id, step: "INIT", user, amountUsdc: usdcAmount, rail, legs: {}, updatedAt: Date.now() };
    await this.store.save(state);
    return state;
  }

  /**
   * Real user click only — signs the Hyperliquid withdraw3 action. Never
   * call this from a poll/timer (see file header).
   */
  async initiateWithdraw(state) {
    let next;
    try {
      const arbBalanceBefore = await getArbUsdcBalanceAtoms(state.user.evm);
      await this.hl.withdrawFromHl(this.mainWallet, { destination: state.user.evm, amount: state.amountUsdc });
      next = {
        ...state,
        step: "AWAITING_ARB_ARRIVAL",
        legs: { ...state.legs, arbBalanceBeforeAtoms: arbBalanceBefore.toString(), withdrawRequestedAt: Date.now() },
        updatedAt: Date.now(),
      };
    } catch (e) {
      next = { ...state, step: "FAILED", error: e instanceof Error ? e.message : String(e), updatedAt: Date.now() };
    }
    await this.store.save(next);
    return next;
  }

  /** Safe to poll — read-only checks only, mirrors DepositOrchestrator.resume(). */
  async advance(state) {
    if (state.step === "AWAITING_ARB_ARRIVAL") {
      // Confirmed as a real bug against a real stuck withdrawal: comparing
      // against a "before" balance snapshot breaks if the user has more
      // than one withdrawal in flight (or retried) — a later attempt's
      // "before" snapshot can already include an earlier attempt's
      // arrived funds, so "any increase" never becomes true again even
      // though the money has genuinely landed. Check for a real, non-dust
      // balance directly instead — same philosophy as the deposit flow's
      // completeHlDeposit(), which trusts the actual on-chain balance
      // rather than a remembered figure.
      let now;
      try { now = await getArbUsdcBalanceAtoms(state.user.evm); } catch { return state; }
      if (now < 1_000_000n) return state; // < $1 — not a real arrival yet

      const next = { ...state, step: "READY_TO_BRIDGE", legs: { ...state.legs, arbArrivedAtoms: now.toString() }, updatedAt: Date.now() };
      await this.store.save(next);
      return next;
    }

    if (state.step === "AWAITING_SOL_CREDIT") {
      try {
        if (state.rail === "cctp") {
          const r = await fetch(`${API_BASE}/api/perps/cctp/withdraw-status/${encodeURIComponent(state.legs.bridgeOrderId)}?solanaRecipient=${encodeURIComponent(state.user.solana)}`);
          if (r.ok) {
            const { status } = await r.json();
            if (status === "relayed") {
              const next = { ...state, step: "DONE", updatedAt: Date.now() };
              await this.store.save(next);
              return next;
            }
          }
        } else {
          const r = await fetch(`${API_BASE}/api/perps/bridge/status/${encodeURIComponent(state.legs.bridgeOrderId)}`);
          if (r.ok) {
            const { fulfilled } = await r.json();
            if (fulfilled) {
              const next = { ...state, step: "DONE", updatedAt: Date.now() };
              await this.store.save(next);
              return next;
            }
          }
        }
      } catch {}
      return state;
    }

    return state;
  }

  /**
   * Real user click only — the ERC20 approve + return-bridge order-creation
   * transactions. Same rule as completeDeposit() in orchestrator.js.
   */
  async completeBridgeToSolana(state) {
    if (state.rail === "cctp") return this._completeBridgeCctp(state);
    return this._completeBridgeDebridge(state);
  }

  async _completeBridgeDebridge(state) {
    let next;
    try {
      const arbAtoms = await getArbUsdcBalanceAtoms(state.user.evm);
      if (arbAtoms <= 0n) throw new Error("No cash found on Arbitrum to bridge back.");

      // Ensure enough ETH for deBridge's fixed protocol fee (paid as tx
      // value) + gas for both transactions — reuses the same sponsor
      // endpoint the deposit flow uses, just with a higher target.
      //
      // Confirmed as a real bug against a real stuck withdrawal: the
      // sponsor endpoint's response only includes a `balance` field on its
      // success paths (already-funded or successfully topped-up) — every
      // failure reason ("sponsor daily budget exhausted", "sponsor wallet
      // needs funding", etc) omits it entirely. Checking `gasCheck.balance`
      // meant those failures were silently treated as "gas is fine" and
      // this proceeded anyway. Query the real on-chain balance directly
      // instead of trusting the shape of that response.
      await fetch(`${API_BASE}/api/perps/arbitrum-gas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: state.user.evm, minWei: MIN_ARB_ETH_FOR_BRIDGE_WEI }),
      }).catch(() => {});
      const ethBalance = await getArbEthBalance(state.user.evm);
      if (ethBalance < BigInt(MIN_ARB_ETH_FOR_BRIDGE_WEI)) {
        throw new Error("Needs a small amount of ETH on Arbitrum to bridge back — your cash is safe on Arbitrum and this is the last step.");
      }

      const usdcAmount = Number(arbAtoms) / 1e6;
      const r = await fetch(
        `${API_BASE}/api/perps/withdraw-bridge/tx?usdcAmount=${usdcAmount}&solanaRecipient=${encodeURIComponent(state.user.solana)}&evmSender=${encodeURIComponent(state.user.evm)}`,
      );
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "couldn't prepare the return bridge transaction");
      const { allowanceTarget, allowanceValue, orderTo, orderData, orderValue, orderId } = await r.json();

      // Wait for + verify each receipt before trusting it — sendEvmTx only
      // guarantees broadcast, not on-chain success (see waitForArbTxReceipt
      // comment above for what went wrong without this).
      const approveHash = await this.sendEvmTx({
        to: ARB_USDC,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [allowanceTarget, BigInt(allowanceValue)] }),
        chainId: ARB_CHAIN_ID,
        gasLimit: 100_000,
      });
      await waitForArbTxReceipt(approveHash);

      const orderHash = await this.sendEvmTx({
        to: orderTo,
        data: orderData,
        value: orderValue,
        chainId: ARB_CHAIN_ID,
        gasLimit: 500_000,
      });
      await waitForArbTxReceipt(orderHash);

      next = { ...state, step: "AWAITING_SOL_CREDIT", legs: { ...state.legs, bridgeOrderId: orderId }, updatedAt: Date.now() };
    } catch (e) {
      next = { ...state, legs: { ...state.legs, bridgeError: e instanceof Error ? e.message : String(e) }, updatedAt: Date.now() };
    }
    await this.store.save(next);
    return next;
  }

  async _completeBridgeCctp(state) {
    let next;
    try {
      const arbAtoms = await getArbUsdcBalanceAtoms(state.user.evm);
      if (arbAtoms <= 0n) throw new Error("No cash found on Arbitrum to bridge back.");

      await fetch(`${API_BASE}/api/perps/arbitrum-gas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: state.user.evm, minWei: MIN_ARB_ETH_FOR_CCTP_WEI }),
      }).catch(() => {});
      const ethBalance = await getArbEthBalance(state.user.evm);
      if (ethBalance < BigInt(MIN_ARB_ETH_FOR_CCTP_WEI)) {
        throw new Error("Needs a small amount of ETH on Arbitrum to bridge back — your cash is safe on Arbitrum and this is the last step.");
      }

      const { approve, depositForBurn } = await buildWithdrawBurnTxs({
        amountAtoms: arbAtoms, solanaRecipient: state.user.solana,
      });

      const approveHash = await this.sendEvmTx(approve);
      await waitForArbTxReceipt(approveHash);

      const burnHash = await this.sendEvmTx(depositForBurn);
      await waitForArbTxReceipt(burnHash);

      // bridgeOrderId doubles as the burn tx hash here — Circle's
      // attestation API looks messages up by source transactionHash, no
      // separate order id like deBridge's DLN has.
      next = { ...state, step: "AWAITING_SOL_CREDIT", legs: { ...state.legs, bridgeOrderId: burnHash }, updatedAt: Date.now() };
    } catch (e) {
      next = { ...state, legs: { ...state.legs, bridgeError: e instanceof Error ? e.message : String(e) }, updatedAt: Date.now() };
    }
    await this.store.save(next);
    return next;
  }
}
