/**
 * The final "Arbitrum → Hyperliquid Bridge2" deposit step — identical no
 * matter which bridge got the USDC onto Arbitrum in the first place
 * (deBridge, CCTP, or any future rail), so every rail's IO class shares
 * this instead of re-implementing it. See realDebridge.js's file header for
 * why this is a single plain ERC20 transfer with no approve step or custom
 * Bridge2 ABI call.
 */
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

export async function getArbEthBalance(address) {
  const r = await fetch(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const { result } = await r.json();
  return BigInt(result);
}

// ERC20 balanceOf selector: 0x70a08231 + 32-byte padded address
export async function getArbUsdcBalanceAtoms(address) {
  const data = "0x70a08231" + "000000000000000000000000" + address.slice(2).toLowerCase();
  const r = await fetch(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: ARB_USDC, data }, "latest"] }),
  });
  const { result } = await r.json();
  return BigInt(result);
}

const ERC20_TRANSFER_ABI = [{
  name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}];

/**
 * Read-only — safe to call from a background poll (see completeHlDeposit's
 * doc comment for why the actual deposit signature is a separate method).
 */
export async function checkHlReady(evmAddress) {
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
 * Only ever call this from a real user click — Privy's embedded-wallet
 * signing is unreliable when not invoked from a genuine user gesture (see
 * realDebridge.js's class comment for the real stuck deposit this was
 * confirmed against).
 *
 * Deposits the wallet's ACTUAL current USDC balance on Arbitrum, not a
 * fixed constant — confirmed as a real bug against a $6.85 delivery where a
 * fixed $5 constant left ~$1.85 stranded on Arbitrum, uncredited.
 */
export async function completeHlDeposit(evmAddress, sendEvmTx) {
  const usdcAtoms = await getArbUsdcBalanceAtoms(evmAddress);
  if (usdcAtoms <= 0n) {
    return { credited: false, error: "No cash found on Arbitrum for this address to deposit." };
  }
  try {
    await sendEvmTx({
      to: ARB_USDC,
      data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [BRIDGE2, usdcAtoms] }),
      chainId: ARB_CHAIN_ID,
      gasLimit: 100_000,
    });
    return { credited: true };
  } catch (e) {
    console.error("[hlDeposit] Bridge2 deposit failed:", e.message);
    return { credited: false, error: e instanceof Error ? e.message : String(e) };
  }
}
