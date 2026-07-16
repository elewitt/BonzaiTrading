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
import { encodeFunctionData } from "viem";
import { PROTOCOL } from "../config.js";
import { API_BASE } from "../../lib/api.js";

const BRIDGE2   = PROTOCOL.BRIDGE2_ADDRESS;
const ARB_USDC  = PROTOCOL.ARBITRUM_NATIVE_USDC;
const ARB_CHAIN_ID = 42161;
const ARB_RPC = "https://arb1.arbitrum.io/rpc";
// A real stuck deposit had 0.00002 ETH and failed to cover approve+deposit's
// gas — this threshold gives real margin above that observed failure point.
const MIN_ARB_ETH_WEI = 100_000_000_000_000n; // 0.0001 ETH

async function getArbEthBalance(address) {
  const r = await fetch(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const { result } = await r.json();
  return BigInt(result);
}

// ERC20 balanceOf selector: 0x70a08231 + 32-byte padded address
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

// Standard ERC20 transfer — this is the whole deposit mechanism (see file
// header comment). No custom Bridge2 ABI needed at all.
const ERC20_TRANSFER_ABI = [{
  name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];

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
    // Ask the server to top up gas if needed BEFORE checking balance — the
    // sponsor endpoint checks balance internally too, so one call covers
    // both "already funded" and "needs a top-up" cases.
    let ethBalance;
    try {
      const topupResult = await fetch(`${API_BASE}/api/perps/arbitrum-gas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: evmAddress }),
      }).then((r) => r.json());
      ethBalance = topupResult.balance != null ? BigInt(topupResult.balance) : await getArbEthBalance(evmAddress);
    } catch {
      try { ethBalance = await getArbEthBalance(evmAddress); }
      catch (e2) { return { ready: false, error: `Couldn't check Arbitrum gas balance: ${e2.message}` }; }
    }
    if (ethBalance < MIN_ARB_ETH_WEI) {
      return {
        ready: false,
        needsGas: true,
        error: `Needs a small amount of ETH on Arbitrum to complete (has ${(Number(ethBalance) / 1e18).toFixed(6)}, needs ~${Number(MIN_ARB_ETH_WEI) / 1e18}) — your cash has already arrived at ${evmAddress} and is safe, this is the last step.`,
      };
    }
    return { ready: true };
  }

  /**
   * Only ever call this from a real user click — see class comment above.
   *
   * Deposits the wallet's ACTUAL current USDC balance on Arbitrum, not a
   * fixed constant. This used to always pass PROTOCOL.MIN_BRIDGE2_DEPOSIT_USDC
   * (a fixed $5) regardless of how much really arrived — confirmed as a
   * real bug against a $6.85 delivery: it would have deposited only $5 and
   * left the remaining ~$1.85 stranded on Arbitrum, uncredited, with no
   * account of it anywhere.
   */
  async completeHlDeposit(evmAddress) {
    const usdcAtoms = await getArbUsdcBalanceAtoms(evmAddress);
    if (usdcAtoms <= 0n) {
      return { credited: false, error: "No cash found on Arbitrum for this address to deposit." };
    }
    try {
      // One plain ERC20 transfer to Bridge2 — see file header comment for
      // why there's no approve step or custom Bridge2 function call.
      // Explicit gasLimit: Privy's auto-estimation failed with "intrinsic
      // gas too low" on a real attempt; a standard ERC20 transfer needs
      // ~50-65k gas, 100k gives real margin at negligible Arbitrum cost.
      await this._sendEvmTx({
        to: ARB_USDC,
        data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [BRIDGE2, usdcAtoms] }),
        chainId: ARB_CHAIN_ID,
        gasLimit: 100_000,
      });
      return { credited: true };
    } catch (e) {
      console.error("[deBridge] Bridge2 deposit failed:", e.message);
      return { credited: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
