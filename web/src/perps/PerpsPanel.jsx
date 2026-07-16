import { useState } from "react";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { tenthsBpsToPercent } from "./hl/builder.js";
import { useBuilderApproval, usePlaceOrder, usePositions } from "./useHyperliquid.js";
import { liquidationPrice } from "./hl/margin.js";

/**
 * Explicit one-time transfer between dexs (e.g. crypto ↔ equities) via
 * sendAsset — reused in the Trade-tab "fund before first trade" gate below
 * and in the Fund Account tab's per-account Deposit/Withdraw views
 * (PerpsApp.jsx), since both are the same underlying action with the
 * source/destination swapped.
 */
export function MoveFundsCard({
  title, description,
  fromBalance, sourceDex, destinationDex, moveDexFunds, buttonLabel = "Move funds", onDone,
}) {
  const [amount, setAmount] = useState("");
  const amt = Number(amount);
  const valid = amt > 0 && amt <= (fromBalance ?? 0);

  const submit = async () => {
    const ok = await moveDexFunds.move(amt, sourceDex, destinationDex);
    if (ok) { setAmount(""); onDone?.(); }
  };

  return (
    <div className="lvp-card">
      <h3>{title}</h3>
      {description && <p className="lvp-muted">{description}</p>}
      <div className="lvp-field" style={{ marginTop: 10 }}>
        <span>Available: ${(fromBalance ?? 0).toFixed(2)}</span>
        <div className="lvp-input-wrap">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" />
          <button className="lvp-max" onClick={() => setAmount((fromBalance ?? 0).toFixed(2))}>
            Max {(fromBalance ?? 0).toFixed(2)}
          </button>
        </div>
      </div>
      <button className="lvp-btn primary" disabled={!valid || moveDexFunds.busy} onClick={() => void submit()}>
        {moveDexFunds.busy ? "Waiting for signature…" : buttonLabel}
      </button>
      {moveDexFunds.error && <p className="lvp-error" style={{ marginTop: 10 }}>{moveDexFunds.error}</p>}
    </div>
  );
}

export function OrderTicket({
  hl, cfg, user, mainWallet, tradingWallet, assetIndex, assetName, assetDisplayName, markPrice, maxLeverage, szDecimals,
  accountValue, withdrawable, positions, marginTiers, isEquity, equityDex, cryptoWithdrawable, moveDexFunds,
}) {
  const approval = useBuilderApproval(hl, user, mainWallet);
  const order = usePlaceOrder(hl, tradingWallet, user);
  const [isBuy, setIsBuy] = useState(true);
  const [size, setSize] = useState("");
  const [limit, setLimit] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [leveragePending, setLeveragePending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgType, setMsgType] = useState("ok"); // ok | err

  const feePct = tenthsBpsToPercent(cfg.builderFeeTenthsBps);
  const showConsent = approval.status !== null && !approval.status.sufficient;
  const max = maxLeverage ?? 20;

  const applyLeverage = async () => {
    if (!tradingWallet || !user) return;
    setLeveragePending(true);
    try {
      await hl.setLeverage(tradingWallet, assetIndex, leverage);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Leverage update failed"); setMsgType("err");
    } finally {
      setLeveragePending(false);
    }
  };

  const submit = async () => {
    setMsg(null);
    if (!tradingWallet || !user) { setMsg("Wallet not ready"); setMsgType("err"); return; }
    try {
      // Apply leverage first, then place order
      await hl.setLeverage(tradingWallet, assetIndex, leverage);
      // Hyperliquid rejects prices with more than 5 significant figures or
      // more than (6 - szDecimals) decimal places — confirmed against a
      // real "Order has invalid price" rejection on BTC (szDecimals=5,
      // so only 1 decimal place is allowed; the old plain .toFixed(2) was
      // always 2, invalid for any high-szDecimals asset). formatPrice/
      // formatSize are the SDK's own utilities for these exact rules,
      // rather than reimplementing them by hand.
      const rawPrice = limit || (isBuy ? markPrice * 1.02 : markPrice * 0.98);
      const price = formatPrice(rawPrice, szDecimals ?? 0);
      const formattedSize = formatSize(size, szDecimals ?? 0);
      await order.place({
        assetIndex,
        isBuy,
        size: formattedSize,
        price,
        tif: limit ? "Gtc" : "Ioc",
      });
      setMsg(`Order placed: ${isBuy ? "long" : "short"} ${size} ${assetDisplayName ?? assetName} @ ${leverage}x`);
      setMsgType("ok");
      setSize(""); setLimit("");
    } catch (e) {
      if (!order.needsApproval) { setMsg(e instanceof Error ? e.message : "Order failed"); setMsgType("err"); }
    }
  };

  if (showConsent) {
    return (
      <div className="lvp-card">
        <h3>Before your first trade</h3>
        <p className="lvp-muted">
          Bonzai Trading adds a {feePct}% fee on each perps fill via Hyperliquid's on-chain
          builder-fee system. You're approving a ceiling of {cfg.approvalMaxFeeRate} —
          we can never charge above it, and you can revoke it any time in Settings.
        </p>
        <button className="lvp-btn primary" disabled={approval.busy} onClick={() => void approval.approve()}>
          {approval.busy ? "Waiting for signature…" : `Approve ${cfg.approvalMaxFeeRate} max fee`}
        </button>
      </div>
    );
  }

  // Stocks/commodities run on a separate builder dex with its own margin —
  // confirmed against a real account showing $0 there despite funds on the
  // main dex. Hyperliquid's own "dexAbstraction" opt-in for unifying
  // collateral across dexs is confirmed broken server-side (rejects a
  // correctly-signed request citing an unrelated address every time,
  // verified via signature recovery — not our bug). This uses sendAsset
  // instead: an explicit, one-time move of USDC from the crypto dex into
  // this one, which is a separate, longer-established primitive that
  // doesn't depend on the broken endpoint at all.
  if (isEquity && withdrawable <= 0) {
    return (
      <MoveFundsCard
        title="Fund Equities"
        description="Trading equities uses a separate Hyperliquid market from crypto perps, with its own balance. Move some of your crypto perps balance over to get started."
        fromBalance={cryptoWithdrawable}
        sourceDex="" destinationDex={equityDex}
        moveDexFunds={moveDexFunds}
      />
    );
  }

  const notional = (parseFloat(size) || 0) * markPrice;
  const marginRequired = leverage > 0 ? notional / leverage : 0;
  const currentPosition = positions?.find((p) => p.coin === assetName) || null;

  // What fraction of available margin this order would use — the actual
  // answer to "how much of my account am I risking," which a raw
  // asset-unit size input doesn't convey on its own. Sets size FROM a
  // chosen percentage (one-way: dragging the slider computes size; typing
  // a size just updates what percentage is shown) rather than keeping two
  // redundant pieces of state in sync.
  const pctOfMargin = withdrawable > 0 ? Math.min(100, (marginRequired / withdrawable) * 100) : 0;
  const setSizeFromPct = (pct) => {
    if (!withdrawable || !markPrice || !leverage) return;
    const desiredNotional = (pct / 100) * withdrawable * leverage;
    if (desiredNotional <= 0) { setSize(""); return; }
    try {
      setSize(formatSize(desiredNotional / markPrice, szDecimals ?? 0));
    } catch {
      setSize("");
    }
  };

  // Live liquidation preview — same math already used for open positions'
  // liquidation display (hl/margin.js), just fed the order being sized
  // instead of an existing position.
  let liqPreview = null;
  if (notional > 0 && markPrice > 0) {
    const tiers = marginTiers?.get(assetName)?.tiers ?? [{ lowerBound: 0, maxLeverage: max }];
    try {
      liqPreview = liquidationPrice({
        side: isBuy ? 1 : -1,
        size: parseFloat(size) || 0,
        markPrice,
        marginAvailable: marginRequired,
        tiers,
      });
    } catch { liqPreview = null; }
  }

  return (
    <div className="lvp-card">
      <div className="lvp-account-row">
        <span><span className="lvp-muted">Available to Trade</span> <strong>${(withdrawable ?? 0).toFixed(2)}</strong></span>
        <span><span className="lvp-muted">Current Position</span> <strong>{currentPosition ? `${currentPosition.side === "long" ? "" : "-"}${currentPosition.size}` : "0"} {assetDisplayName ?? assetName}</strong></span>
      </div>

      <div className="lvp-sideswitch" role="tablist" aria-label="Direction">
        <button role="tab" aria-selected={isBuy}  className={`lvp-side-btn ${isBuy  ? "sel long"  : ""}`} onClick={() => setIsBuy(true)}>Long</button>
        <button role="tab" aria-selected={!isBuy} className={`lvp-side-btn ${!isBuy ? "sel short" : ""}`} onClick={() => setIsBuy(false)}>Short</button>
      </div>

      <div className="lvp-leverage-row">
        <span className="lvp-leverage-label">Leverage: <strong>{leverage}x</strong></span>
        <input
          type="range" min="1" max={max} step="1" value={leverage}
          className="lvp-leverage-slider"
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
        <span className="lvp-muted" style={{ fontSize: 11 }}>max {max}x</span>
      </div>

      <div className="lvp-field" style={{ marginTop: 10 }}>
        <span>Size ({assetDisplayName ?? assetName})</span>
        <div className="lvp-input-wrap">
          <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
      </div>

      <div className="lvp-pct-row">
        <input
          type="range" min="0" max="100" step="1"
          value={Math.round(pctOfMargin)}
          className="lvp-pct-slider"
          disabled={!withdrawable}
          onChange={(e) => setSizeFromPct(Number(e.target.value))}
        />
        <span className="lvp-pct-value mono">{Math.round(pctOfMargin)}%</span>
      </div>
      <div className="lvp-pct-presets">
        {[25, 50, 75, 100].map((pct) => (
          <button key={pct} type="button" className="lvp-pct-btn" disabled={!withdrawable} onClick={() => setSizeFromPct(pct)}>
            {pct === 100 ? "Max" : `${pct}%`}
          </button>
        ))}
      </div>

      <div className="lvp-field">
        <span>Limit price (blank = market)</span>
        <div className="lvp-input-wrap">
          <input
            inputMode="decimal" value={limit}
            placeholder={markPrice ? markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
      </div>

      <div className="lvp-order-summary">
        <div className="lvp-row"><span className="lvp-muted">Order Value</span><span>{notional > 0 ? `$${notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</span></div>
        <div className="lvp-row"><span className="lvp-muted">Margin Required</span><span>{notional > 0 ? `$${marginRequired.toFixed(2)} (${pctOfMargin.toFixed(0)}% of available)` : "—"}</span></div>
        <div className="lvp-row"><span className="lvp-muted">Liquidation Price</span><span>{liqPreview !== null ? `$${liqPreview.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</span></div>
        <div className="lvp-row"><span className="lvp-muted">Fees</span><span>{feePct}% + Hyperliquid taker/maker</span></div>
      </div>

      <button className="lvp-btn primary" disabled={order.pending || !size || !markPrice} onClick={() => void submit()}>
        {order.pending ? "Placing…" : `${isBuy ? "Long" : "Short"} ${assetDisplayName ?? assetName} ${leverage}x`}
      </button>
      {msg && <p className={`lvp-order-msg ${msgType === "err" ? "lvp-error" : "lvp-muted"}`} role="status">{msg}</p>}
    </div>
  );
}

export function PositionsPanel({ hl, cfg, user, tradingWallet, onPositionClosed }) {
  const { positions, accountValue, withdrawable } = usePositions(hl, user);
  return (
    <div className="lvp-card lvp-positions-card">
      <header className="lvp-row">
        <h3>Open Positions</h3>
        <span className="lvp-muted">
          Equity ${accountValue.toFixed(2)} · Available ${withdrawable.toFixed(2)}
        </span>
      </header>
      {positions.length === 0 && (
        <p className="lvp-muted" style={{ marginTop: 8 }}>No open positions.</p>
      )}
      {positions.map((p) => (
        <PositionRow key={p.coin} p={p} hl={hl} cfg={cfg} user={user} tradingWallet={tradingWallet} onClosed={onPositionClosed} />
      ))}
    </div>
  );
}

export function PositionRow({ p, hl, cfg, user, tradingWallet, onClosed }) {
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState(null);
  const h = p.health;

  const close = async () => {
    if (!tradingWallet || !user) return;
    setClosing(true); setCloseErr(null);
    try {
      await hl.closePosition(tradingWallet, user, {
        assetIndex: p.assetIndex,
        isLong: p.side === "long",
        size: p.size,
        markPrice: p.markPx,
        szDecimals: p.szDecimals,
      });
      onClosed?.();
    } catch (e) {
      setCloseErr(e instanceof Error ? e.message : "Close failed");
    } finally {
      setClosing(false);
    }
  };

  const badge =
    h.status === "healthy" ? null : (
      <span className={`lvp-badge ${h.status}`}>
        {h.status === "warning"          && "Margin getting thin"}
        {h.status === "critical"         && "Near liquidation"}
        {h.status === "backstop_imminent"&& "Liquidation imminent"}
      </span>
    );

  return (
    <div className="lvp-pos">
      <div className="lvp-row">
        <strong>{p.coin} · {p.side} {p.leverage}x</strong>
        <span className="lvp-pos-headright">
          <span className={p.unrealizedPnl >= 0 ? "lvp-pnl-up" : "lvp-pnl-down"}>
            {p.unrealizedPnl >= 0 ? "+" : ""}{p.unrealizedPnl.toFixed(2)} Cash
          </span>
          <button className="lvp-close-btn" disabled={closing} onClick={close}>
            {closing ? "Closing…" : "Close"}
          </button>
        </span>
      </div>
      <div className="lvp-row lvp-muted">
        <span>{p.size} @ {p.entryPx.toFixed(2)} · mark {p.markPx.toFixed(2)}</span>
        <span>
          Liq {h.liquidationPrice !== null ? h.liquidationPrice.toFixed(2) : "—"}
          {h.distanceToLiquidation !== null && ` (${(h.distanceToLiquidation * 100).toFixed(1)}% away)`}
        </span>
      </div>
      {badge && (
        <div className="lvp-warnrow">
          {badge}
          <span className="lvp-fine">A stop-loss closes you above the liquidation price so you keep remaining margin.</span>
        </div>
      )}
      {closeErr && <p className="lvp-error" style={{ fontSize: 11, marginTop: 6 }}>{closeErr}</p>}
    </div>
  );
}
