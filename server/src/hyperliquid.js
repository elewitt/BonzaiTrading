/* ————— Hyperliquid — read-only, server-side, admin lookups only —————
 * The server has no other Hyperliquid integration; all perps trading is
 * client-side (see web/src/perps/). This is just enough to show a
 * customer's positions in the admin tool: two plain, unauthenticated,
 * public POSTs to Hyperliquid's info endpoint (main crypto dex + the "xyz"
 * equities/commodities builder dex, same pair of calls
 * web/src/perps/useHyperliquid.js already makes client-side). No SDK
 * dependency needed for two read calls — matches kamino.js's plain-fetch
 * style rather than adding @nktkas/hyperliquid to the server too.
 */
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const EQUITY_DEX = "xyz"; // kept in sync with web/src/perps/config.js

async function clearinghouseState(user, dex) {
  const body = dex ? { type: "clearinghouseState", user, dex } : { type: "clearinghouseState", user };
  const r = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Hyperliquid info request failed (${r.status})`);
  return r.json();
}

function mapPositions(state, dexLabel) {
  return (state?.assetPositions || []).map(({ position: p }) => {
    const szi = Number(p.szi);
    const side = szi >= 0 ? "long" : "short";
    const markPx = Number(p.positionValue) / Math.abs(szi || 1);
    return {
      dex: dexLabel,
      coin: p.coin,
      side,
      size: Math.abs(szi),
      entryPx: Number(p.entryPx),
      markPx,
      unrealizedPnl: Number(p.unrealizedPnl),
      leverage: p.leverage?.value ?? null,
    };
  });
}

/** A customer's Perps picture across both dexs, keyed by their EVM address
 * (Privy's embedded Ethereum wallet — Perps never touches Solana). Fails
 * soft (empty positions, zero values) on lookup error so one broken
 * upstream call doesn't take down the whole admin customer view. */
export async function getPerpsPositions(evmAddress) {
  if (!evmAddress) return { positions: [], cryptoAccountValue: 0, equityAccountValue: 0 };
  try {
    const [crypto, equity] = await Promise.all([
      clearinghouseState(evmAddress),
      clearinghouseState(evmAddress, EQUITY_DEX),
    ]);
    return {
      positions: [...mapPositions(crypto, "crypto"), ...mapPositions(equity, "equity")],
      cryptoAccountValue: Number(crypto?.marginSummary?.accountValue ?? 0),
      equityAccountValue: Number(equity?.marginSummary?.accountValue ?? 0),
    };
  } catch (e) {
    console.error(`[hyperliquid] lookup failed for ${evmAddress} (non-fatal): ${e.message}`);
    return { positions: [], cryptoAccountValue: 0, equityAccountValue: 0 };
  }
}
