import { VersionedTransaction } from "@solana/web3.js";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { api } from "../lib/api.js";

async function executeSpotLeg(order, taker, signWithWallet) {
  if (!order.transaction) throw new Error("no route available for this pair right now");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(order.transaction), (c) => c.charCodeAt(0)));
  const signed = await signWithWallet(tx);
  const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
  const result = await api.execute({
    signedTransaction: signedB64,
    requestId: order.requestId, sponsored: order._sponsored, swapV1: order._swapV1, isSell: order._isSell,
  });
  if (result.status && result.status !== "Success") throw new Error(result.error || `execution failed (${result.status})`);
  return { signature: result.signature, feeBps: order.feeBps ?? null };
}

/** Hyperliquid's exchange endpoint can return overall status "ok" while an
 * individual order inside it still failed (statuses[0].error) — confirmed
 * against the SDK's own OrderResponse type, which documents `error` as a
 * per-order outcome distinct from the request-level throw a hard failure
 * causes. Both need checking; the order-placing calls below only guard
 * against the second by way of try/catch upstream. */
function checkOrderResult(result) {
  const status = result?.response?.data?.statuses?.[0];
  if (status?.error) throw new Error(status.error);
  return status?.filled?.oid ?? status?.resting?.oid ?? null;
}

/**
 * Resolves and signs one perp leg entirely client-side — no server
 * involvement at all, same as every other Perps trade in this app (see
 * App.jsx's executePerpOrder, which this mirrors). `hlAssets`/`markPrices`
 * come from the same `useAssets(hl)` hook the dashboard's own perp
 * positions already use, so this reads live, already-polled data rather
 * than fetching its own snapshot.
 *
 * "notionalUsd" fully determines position SIZE regardless of leverage —
 * leverage only changes the margin Hyperliquid reserves for it, confirmed
 * directly against executePerpOrder's own math (its "usd"-sized branch:
 * `size = intent.sizeValue / markPrice`, independent of leverage).
 */
async function executePerpLeg(leg, { hl, perpsWallet, evmAddress, hlAssets, markPrices }) {
  const asset = hlAssets.find((a) => a.name === leg.hlCoin);
  if (!asset) throw new Error(`Live market data for ${leg.hlCoin} isn't available right now — try again in a moment.`);
  const markPrice = markPrices[leg.hlCoin];
  if (!markPrice) throw new Error(`No live price available for ${leg.hlCoin} right now.`);

  if (leg.side === "reduce") {
    const state = await hl.clearinghouseState(evmAddress, leg.hlDex || undefined);
    const pos = (state?.assetPositions || []).find((p) => p.position.coin === leg.hlCoin);
    if (!pos) throw new Error(`No open ${leg.hlCoin} position found to close.`);
    const szi = Number(pos.position.szi);
    const result = await hl.closePosition(perpsWallet, evmAddress, {
      assetIndex: asset.index, isLong: szi >= 0, size: Math.abs(szi), markPrice, szDecimals: asset.szDecimals,
    });
    const oid = checkOrderResult(result);
    return { signature: `hl-close-${leg.hlCoin}-${oid ?? Date.now()}` };
  }

  const isBuy = leg.side === "long"; // "short" (opening) and anything else -> sell side
  const size = leg.notionalUsd / markPrice;
  let formattedSize;
  try { formattedSize = formatSize(String(size), asset.szDecimals ?? 0); }
  catch { throw new Error(`That size is too small to place at ${leg.hlCoin}'s precision.`); }

  await hl.setLeverage(perpsWallet, asset.index, leg.leverage);
  const rawPrice = isBuy ? markPrice * 1.02 : markPrice * 0.98;
  const price = formatPrice(rawPrice, asset.szDecimals ?? 0);
  const result = await hl.placeOrder(perpsWallet, evmAddress, { assetIndex: asset.index, isBuy, size: formattedSize, price, tif: "Ioc" });
  const oid = checkOrderResult(result);
  return { signature: `hl-${leg.side}-${leg.hlCoin}-${oid ?? Date.now()}` };
}

/**
 * Executes every leg of a confirmed Strategy Agents proposal — one spot
 * leg (Jupiter, same as any DCA buy) and/or one perp leg (Hyperliquid,
 * signed entirely client-side, same as any other Perps trade in this
 * app). Legs execute in the order `.../build` returned them; if a later
 * leg fails, the earlier ones have already landed — that partial state is
 * reported honestly via `legResults` rather than assumed all-or-nothing,
 * same pattern the existing deposit_and_borrow/repay_and_withdraw flows
 * already use for their own partial-failure cases.
 */
export async function executeStrategyProposal({ proposalId, taker, signWithWallet, hlCtx, onStatus }) {
  onStatus?.("routing");
  const built = await api.buildStrategyProposal(proposalId, taker);

  const legResults = [];
  for (const leg of built.legs) {
    onStatus?.(leg.domain === "spot" ? "signing" : "signing perp order");
    if (leg.domain === "spot") {
      legResults.push(await executeSpotLeg(leg.order, taker, signWithWallet));
    } else if (leg.domain === "perp") {
      legResults.push(await executePerpLeg(leg, hlCtx));
    } else {
      throw new Error("Unsupported leg type — try confirming this from a newer version of the app.");
    }
  }
  onStatus?.("confirmed");

  await api.reportStrategyProposalExecution(proposalId, { walletAddress: taker, legResults });
  return legResults;
}
