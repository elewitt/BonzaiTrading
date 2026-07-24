/**
 * Production deBridge IO.
 *
 * Flow:
 *   1. Quote  → ${API_BASE}/api/perps/bridge/quote  (server proxies deBridge DLN)
 *   2. Create → ${API_BASE}/api/perps/bridge/tx     (server proxies; returns Solana tx + orderId)
 *   3. Sign   → Privy Solana wallet (same signing path as Jupiter swaps)
 *   4. Poll   → ${API_BASE}/api/perps/bridge/status/:id  until Fulfilled
 *   5. Deposit → a single plain USDC transfer to Bridge2 on Arbitrum
 *
 * Bridge2 (0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7) credits WHOEVER
 * SENT the transfer, so the depositor must be the user's own EVM address.
 * Confirmed directly against the deployed contract (no verified ABI
 * exposes a "sendDeposit" function at all — codeslaw.app's decoded
 * function list only shows batchedDepositWithPermit/batchedRequest/
 * batchedFinalizeWithdrawals) and against Hyperliquid's own docs: "no
 * swap, no intermediate token, no third-party bridge contract... users
 * can transfer directly without a separate approval transaction."
 * An earlier version of this file called a hand-written
 * approve()+sendDeposit(address,uint64) pair that doesn't correspond to
 * any real function on this contract — it happened to not throw
 * immediately (wrong selector, but syntactically valid calldata) and only
 * surfaced as an on-chain revert on a real attempt.
 */
import { Connection } from "@solana/web3.js";
import { API_BASE } from "../../lib/api.js";
import { checkHlReady as checkHlReadyShared, completeHlDeposit as completeHlDepositShared } from "./arbitrumHlDeposit.js";

export class RealDeBridgeIo {
  /**
   * @param {object} opts
   * @param {(txBase64: string) => Promise<string>} opts.signAndSendSolana
   *   Sign + submit a base64 Solana transaction; return the signature string.
   * @param {(params: {to: string, data: string, chainId: number}) => Promise<string>} opts.sendEvmTx
   *   Send an EVM transaction; return the tx hash.
   * @param {string} opts.rpcUrl  Solana RPC URL for submitting signed txs.
   */
  constructor({ signAndSendSolana, sendEvmTx, rpcUrl }) {
    this._signAndSendSolana = signAndSendSolana;
    this._sendEvmTx = sendEvmTx;
    this._connection = new Connection(rpcUrl || "https://api.mainnet-beta.solana.com", "confirmed");
  }

  async fetchQuote(inputAmount, evmRecipient, srcAsset = "sol") {
    const r = await fetch(`${API_BASE}/api/perps/bridge/quote?solAmount=${inputAmount}&evmRecipient=${encodeURIComponent(evmRecipient)}&srcAsset=${srcAsset}`);
    if (!r.ok) throw new Error(`bridge quote failed: ${(await r.json()).error}`);
    return await r.json(); // { usdcOut, feeUsd, etaSeconds }
  }

  async createAndSendOrder(state) {
    const { inputSol, user, srcAsset } = state;
    const r = await fetch(`${API_BASE}/api/perps/bridge/tx?solAmount=${inputSol}&evmRecipient=${encodeURIComponent(user.evm)}&srcAsset=${srcAsset || "sol"}&solanaSender=${encodeURIComponent(user.solana)}`);
    if (!r.ok) throw new Error(`bridge tx failed: ${(await r.json()).error}`);
    const { txData, orderId } = await r.json();

    // txData is a 0x-prefixed hex string (confirmed via deBridge's raw API
    // response) — _signAndSendSolana decodes it accordingly, not as base64.
    const txSig = await this._signAndSendSolana(txData);
    return { txSig, orderId };
  }

  async isOrderFulfilled(orderId) {
    const r = await fetch(`${API_BASE}/api/perps/bridge/status/${encodeURIComponent(orderId)}`);
    if (!r.ok) return false;
    const { fulfilled } = await r.json();
    return fulfilled;
  }

  /**
   * After deBridge delivers USDC to user.evm on Arbitrum, deposit into HL Bridge2.
   * Two EVM transactions: approve + sendDeposit.
   * User's Privy EVM wallet must have a small ETH balance on Arbitrum for gas (~$0.02).
   *
   * Split into two methods, not one — checkHlReady() (read-only, safe to
   * call from a background poll) and completeHlDeposit() (real signing,
   * must only be called from a genuine user click). A real stuck deposit
   * confirmed why: this used to attempt both EVM signatures from a
   * setInterval poll, which Privy's embedded-wallet SDK handles
   * unreliably when not triggered by a real user gesture (the same lesson
   * learned earlier building the xStocks/EVM-wallet flows) — the wallet
   * had enough gas, but the deposit still never completed because nothing
   * ever prompted a real signature.
   */
  async checkHlReady(evmAddress) {
    return checkHlReadyShared(evmAddress);
  }

  /**
   * Only ever call this from a real user click — see class comment above.
   */
  async completeHlDeposit(evmAddress) {
    return completeHlDepositShared(evmAddress, this._sendEvmTx);
  }
}
