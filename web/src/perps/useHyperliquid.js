import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LongviewHl, BuilderApprovalRequiredError } from "./hl/client.js";
import { assessHealth } from "./hl/margin.js";
import { EQUITY_DEX } from "./config.js";

export function useLongviewHl(cfg) {
  return useMemo(() => new LongviewHl(cfg), [cfg]);
}

/**
 * Moves USDC collateral directly between dexs (e.g. crypto ↔ "xyz"
 * equities/commodities) via sendAsset — a workaround for Hyperliquid's
 * "dexAbstraction" opt-in, confirmed broken server-side across multiple
 * independent attempts (it rejects the correctly-signed request citing a
 * different, unrelated, never-used address every time). sendAsset achieves
 * the same practical outcome as an explicit one-time transfer instead of
 * an automatic "unify everything" toggle, sidestepping that broken
 * endpoint entirely, and works in both directions — moving funds "into"
 * or "out of" the equities dex is the same underlying action with the
 * source/destination swapped.
 */
export function useMoveDexFunds(hl, user, mainWallet) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const move = useCallback(async (amountUsdc, sourceDex, destinationDex) => {
    if (!mainWallet || !user) { setError("Wallet not ready"); return false; }
    setBusy(true);
    setError(null);
    try {
      await hl.moveUsdcToDex(mainWallet, { destination: user, sourceDex, destinationDex, amount: amountUsdc });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move funds — please try again");
      return false;
    } finally {
      setBusy(false);
    }
  }, [hl, mainWallet, user]);

  return { move, busy, error };
}

export function useBuilderApproval(hl, user, mainWallet) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !hl.hasBuilder) return;
    setStatus(await hl.approvalStatus(user));
  }, [hl, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = useCallback(async () => {
    if (!mainWallet) throw new Error("main wallet required");
    setBusy(true);
    try {
      await hl.approveBuilderFee(mainWallet);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [hl, mainWallet, refresh]);

  return { status, approve, busy, refresh };
}

/**
 * @param dex undefined for the main crypto dex, EQUITY_DEX for
 *   stocks/commodities — they have independent margining, so every call
 *   here (meta, clearinghouseState) must be scoped to the same dex.
 */
export function usePositions(hl, user, dex, pollMs = 4000) {
  const [positions, setPositions] = useState([]);
  const [accountValue, setAccountValue] = useState(0);
  const [withdrawable, setWithdrawable] = useState(0);
  const tiersRef = useRef(new Map());

  useEffect(() => {
    if (!user) return;
    let stop = false;
    tiersRef.current = new Map();

    const loadMeta = async () => {
      const [meta, converter] = await Promise.all([hl.meta(dex), hl.symbolConverter()]);
      meta.universe.forEach((u) => {
        tiersRef.current.set(u.name, {
          // Global order asset id, not the position within this dex's own
          // universe array — those diverge for builder dexs (HIP-3 offsets
          // ids beyond the main dex's simple 0..N indexing).
          index: converter.getAssetId(u.name),
          szDecimals: u.szDecimals,
          tiers: [{ lowerBound: 0, maxLeverage: u.maxLeverage }],
        });
      });
    };

    const tick = async () => {
      const st = await hl.clearinghouseState(user, dex);
      if (stop) return;
      const av = Number(st.marginSummary.accountValue);
      const mm = Number(st.crossMaintenanceMarginUsed);
      setAccountValue(av);
      setWithdrawable(Number(st.withdrawable));
      setPositions(
        st.assetPositions.map(({ position: p }) => {
          const szi = Number(p.szi);
          const side = szi >= 0 ? 1 : -1;
          const markPx = Number(p.positionValue) / Math.abs(szi || 1);
          const assetMeta = tiersRef.current.get(p.coin);
          const health = assessHealth(av, mm, {
            side,
            size: Math.abs(szi),
            markPrice: markPx,
            marginAvailable: av - mm,
            tiers: assetMeta?.tiers ?? [{ lowerBound: 0, maxLeverage: p.leverage.value }],
          });
          return {
            coin: p.coin,
            assetIndex: assetMeta?.index ?? -1,
            szDecimals: assetMeta?.szDecimals ?? 0,
            side: side === 1 ? "long" : "short",
            size: Math.abs(szi),
            entryPx: Number(p.entryPx),
            markPx,
            unrealizedPnl: Number(p.unrealizedPnl),
            leverage: p.leverage.value,
            health,
          };
        }),
      );
    };

    void loadMeta().then(tick);
    const h = setInterval(() => void tick().catch(() => {}), pollMs);
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, [hl, user, dex, pollMs]);

  // tiersRef is mutated in place (not its own state) — safe to expose
  // directly since usePositions already re-renders on every poll tick,
  // carrying the latest tier data along with it.
  return { positions, accountValue, withdrawable, marginTiers: tiersRef.current };
}

/**
 * Powers the trade-screen dashboard: P&L/account-value history (for the
 * chart) and recent fills (for the activity feed). Polled less frequently
 * than live position data (usePositions, 4s) — history and past fills
 * aren't sub-second-critical.
 */
const EMPTY_STATS = { totalTrades: 0, realizedPnl: 0, winRate: null, avgTradeSize: 0 };

/**
 * Returns the full retained fill history (not trimmed) — the dashboard's
 * History view needs the whole list to search/filter, and stats (win rate,
 * avg trade size, etc) are derived from this same list rather than
 * re-fetching separately.
 */
export function usePortfolioStats(hl, user, pollMs = 15000) {
  const [pnlHistory, setPnlHistory] = useState({});   // period -> [ts, value][]
  const [accountValueHistory, setAccountValueHistory] = useState({});
  const [fills, setFills] = useState([]);
  const [volume, setVolume] = useState(0);
  const [stats, setStats] = useState(EMPTY_STATS);

  useEffect(() => {
    if (!user) return;
    let stop = false;

    const tick = async () => {
      const [portfolio, rawFills] = await Promise.all([hl.portfolio(user), hl.userFills(user)]);
      if (stop) return;

      const byPeriod = Object.fromEntries(portfolio);
      const pnl = {}, acctVal = {};
      for (const period of ["perpDay", "perpWeek", "perpMonth", "perpAllTime"]) {
        pnl[period] = byPeriod[period]?.pnlHistory ?? [];
        acctVal[period] = byPeriod[period]?.accountValueHistory ?? [];
      }
      setPnlHistory(pnl);
      setAccountValueHistory(acctVal);
      setVolume(Number(byPeriod.perpAllTime?.vlm ?? 0));

      const mapped = [...rawFills]
        .sort((a, b) => b.time - a.time)
        .map((f) => ({
          coin: f.coin,
          isBuy: f.side === "B",
          dir: f.dir,
          size: Number(f.sz),
          price: Number(f.px),
          time: f.time,
          closedPnl: Number(f.closedPnl),
        }));
      setFills(mapped);

      const closed = mapped.filter((f) => f.closedPnl !== 0);
      const wins = closed.filter((f) => f.closedPnl > 0);
      const totalNotional = mapped.reduce((sum, f) => sum + f.size * f.price, 0);
      setStats({
        totalTrades: mapped.length,
        realizedPnl: closed.reduce((sum, f) => sum + f.closedPnl, 0),
        winRate: closed.length ? (wins.length / closed.length) * 100 : null,
        avgTradeSize: mapped.length ? totalNotional / mapped.length : 0,
      });
    };

    void tick().catch(() => {});
    const h = setInterval(() => void tick().catch(() => {}), pollMs);
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, [hl, user, pollMs]);

  return { pnlHistory, accountValueHistory, fills, volume, stats };
}

export function usePlaceOrder(hl, wallet, user) {
  const [pending, setPending] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);

  const place = useCallback(
    async (p) => {
      if (!wallet || !user) throw new Error("wallet not connected");
      setPending(true);
      setNeedsApproval(false);
      try {
        return await hl.placeOrder(wallet, user, p);
      } catch (e) {
        if (e instanceof BuilderApprovalRequiredError) setNeedsApproval(true);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [hl, wallet, user],
  );

  return { place, pending, needsApproval };
}

/**
 * Fetches both the main crypto dex and the equities/commodities builder
 * dex, tagged with `category` so the Market panel can filter by it. Asset
 * ids come from the SDK's SymbolConverter (not array position) since
 * builder-dex ids are offset from the main dex's — using the wrong one
 * would route an order to the wrong asset.
 */
export function useAssets(hl) {
  const [assets, setAssets] = useState([]);
  const [markPrices, setMarkPrices] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [converter, cryptoMeta, equityMeta] = await Promise.all([
        hl.symbolConverter(),
        hl.meta(),
        hl.meta(EQUITY_DEX),
      ]);
      if (cancelled) return;

      const build = (meta, category) =>
        meta.universe
          .filter((u) => !u.isDelisted)
          .map((u) => ({
            name: u.name,
            displayName: category === "equity" ? (u.name.split(":")[1] ?? u.name) : u.name,
            index: converter.getAssetId(u.name),
            maxLeverage: u.maxLeverage,
            szDecimals: u.szDecimals,
            category,
          }))
          .filter((a) => a.index !== undefined);

      setAssets([...build(cryptoMeta, "crypto"), ...build(equityMeta, "equity")]);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [hl]);

  useEffect(() => {
    const tick = async () => {
      try {
        const [cryptoRes, equityRes] = await Promise.all([
          hl.metaAndAssetCtxs(),
          hl.metaAndAssetCtxs(EQUITY_DEX),
        ]);
        const prices = {};
        [cryptoRes, equityRes].forEach(([m, ctxs]) => {
          ctxs.forEach((ctx, i) => {
            if (m.universe[i]) prices[m.universe[i].name] = Number(ctx.markPx ?? 0);
          });
        });
        setMarkPrices(prices);
      } catch {}
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [hl]);

  return { assets, markPrices };
}
