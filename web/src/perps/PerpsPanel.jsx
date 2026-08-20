import { useEffect, useMemo, useState } from "react";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { tenthsBpsToPercent } from "./hl/builder.js";
import { useBuilderApproval, usePlaceOrder, usePositions } from "./useHyperliquid.js";
import { liquidationPrice } from "./hl/margin.js";
import { EQUITY_DEX, displayCoin } from "./config.js";
import { usd } from "../lib/api.js";

const HL_MIN_NOTIONAL_USD = 10; // Hyperliquid's own exchange-wide minimum order value

/**
 * Shared close-position button + inline error, used by both the account
 * page's Open Positions table below and the main dashboard's Perps
 * Positions table (App.jsx) — one place for the actual closePosition()
 * call so the two views can't drift out of sync on how a close is built.
 */
export function PerpsCloseCell({ p, hl, user, tradingWallet, onClosed }) {
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState(null);

  const close = async () => {
    if (!tradingWallet || !user) return;
    setClosing(true); setErr(null);
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
      setErr(e instanceof Error ? e.message : "Close failed");
    } finally {
      setClosing(false);
    }
  };

  return (
    <span>
      <button className="lvp-close-btn" disabled={closing} onClick={close}>
        {closing ? "Closing…" : "Close"}
      </button>
      {err && <span className="lvp-error" style={{ display: "block", fontSize: 11, marginTop: 4 }}>{err}</span>}
    </span>
  );
}

/**
 * Explicit one-time transfer between dexs (e.g. crypto ↔ equities) via
 * sendAsset — reused in the Trade-tab "fund before first trade" gate below
 * and in the Fund Account tab's per-account Deposit/Withdraw views
 * (PerpsApp.jsx), since both are the same underlying action with the
 * source/destination swapped.
 */
export function MoveFundsCard({
  title, description,
  fromBalance, sourceDex, destinationDex, moveDexFunds, buttonLabel = "Move funds", onDone, initialAmount,
}) {
  const [amount, setAmount] = useState(() => (initialAmount != null ? String(initialAmount) : ""));
  const amt = Number(amount);
  // Floor (not round) to cents for display/Max — fromBalance is a raw float,
  // and .toFixed(2) rounding it up (e.g. 5.5361 -> "5.54") meant clicking Max
  // produced an amount that failed its own "exceeds available" check against
  // the un-rounded value. Same fix as WithdrawWizard.jsx.
  const fromBalanceDisplay = Math.floor((fromBalance ?? 0) * 100) / 100;
  const valid = amt > 0 && amt <= fromBalanceDisplay;

  const submit = async () => {
    const ok = await moveDexFunds.move(amt, sourceDex, destinationDex);
    if (ok) { setAmount(""); onDone?.(); }
  };

  return (
    <div className="lvp-card">
      <h3>{title}</h3>
      {description && <p className="lvp-muted">{description}</p>}
      <div className="lvp-field" style={{ marginTop: 10 }}>
        <span>Available: ${fromBalanceDisplay.toFixed(2)}</span>
        <div className="lvp-input-wrap">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" />
          <button className="lvp-max" onClick={() => setAmount(fromBalanceDisplay.toFixed(2))}>
            Max {fromBalanceDisplay.toFixed(2)}
          </button>
        </div>
      </div>
      <button className="lvp-btn primary" disabled={!valid || moveDexFunds.busy} onClick={() => void submit()}>
        {moveDexFunds.busy ? "Confirming…" : buttonLabel}
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
  // Both fields are shown together and both stay editable — "size" (asset
  // units) is still what actually goes into the order downstream (notional,
  // margin, liquidation preview, submit), "usdAmount" is just the same
  // amount expressed in dollars. "lastEdited" tracks which one the user
  // actually typed into, so a leverage change knows which value to hold
  // fixed and which to recompute: edit USD, drag leverage, the asset size
  // updates to match (and vice versa if they'd typed the asset size instead).
  const [size, setSize] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [lastEdited, setLastEdited] = useState("usd"); // "usd" | "asset"
  const [limit, setLimit] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [leveragePending, setLeveragePending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgType, setMsgType] = useState("ok"); // ok | err

  // Live preview always shows the real computed number, even one that's
  // below the tradeable minimum at this asset's precision — formatSize
  // (the strict, truncate-and-throw-on-zero version Hyperliquid actually
  // requires) is only applied at submit time below. Using it here too
  // meant a small enough $ amount (e.g. $0.07 margin on BTC, whose
  // szDecimals=5 truncates anything under ~0.00001 BTC to zero) silently
  // blanked the field instead of showing why nothing was happening.
  useEffect(() => {
    if (lastEdited !== "usd") return;
    const usd = Number(usdAmount) || 0;
    if (usd <= 0 || !markPrice || !leverage) { setSize(""); return; }
    const raw = (usd * leverage) / markPrice;
    setSize(raw > 0 ? raw.toFixed(Math.max(szDecimals ?? 0, 8)) : "");
  }, [usdAmount, leverage, markPrice, szDecimals, lastEdited]);

  useEffect(() => {
    if (lastEdited !== "asset") return;
    const sz = Number(size) || 0;
    if (sz <= 0 || !markPrice || !leverage) { setUsdAmount(""); return; }
    const usd = (sz * markPrice) / leverage;
    setUsdAmount(usd > 0 ? usd.toFixed(2) : "");
  }, [size, leverage, markPrice, lastEdited]);

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
    // Hyperliquid rejects any order under $10 notional — catch it here with
    // a plain-English message instead of letting the raw exchange error
    // ("Order must have minimum value of $10. asset=...") reach the user.
    const notionalUsd = (Number(size) || 0) * (markPrice || 0);
    if (notionalUsd < HL_MIN_NOTIONAL_USD) {
      setMsg(`That's a $${notionalUsd.toFixed(2)} position — Hyperliquid requires at least $${HL_MIN_NOTIONAL_USD} per order. Try a larger amount or higher leverage.`);
      setMsgType("err");
      return;
    }
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
      setSize(""); setUsdAmount(""); setLimit("");
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
          {approval.busy ? "Confirming…" : `Approve ${cfg.approvalMaxFeeRate} max fee`}
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

  // Calls the real formatSize (not an approximation) so this exactly
  // matches what submit() will actually do — Hyperliquid truncates
  // (rounds down) to szDecimals, which isn't the same as JS's toFixed
  // (rounds to nearest) right at the boundary.
  let sizeTooSmall = false;
  if (notional > 0) {
    try { formatSize(size, szDecimals ?? 0); } catch { sizeTooSmall = true; }
  }

  // What fraction of available margin this order would use — the actual
  // answer to "how much of my account am I risking," which a raw
  // asset-unit size input doesn't convey on its own. Sets size FROM a
  // chosen percentage (one-way: dragging the slider computes size; typing
  // a size just updates what percentage is shown) rather than keeping two
  // redundant pieces of state in sync. Also keeps usdAmount in sync so
  // switching to $ mode afterward shows a sensible starting value instead
  // of a blank field.
  const pctOfMargin = withdrawable > 0 ? Math.min(100, (marginRequired / withdrawable) * 100) : 0;
  const setSizeFromPct = (pct) => {
    if (!withdrawable || !markPrice || !leverage) return;
    setLastEdited("usd");
    const marginUsd = (pct / 100) * withdrawable;
    setUsdAmount(marginUsd > 0 ? marginUsd.toFixed(2) : "");
    const desiredNotional = marginUsd * leverage;
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

      {/* Both fields shown together, both editable — type into either one
          and the other recomputes from it (margin × leverage ÷ price).
          Whichever was typed into most recently stays fixed when leverage
          changes, and the other updates to match. */}
      <div className="lvp-size-pair" style={{ marginTop: 10 }}>
        <div className="lvp-field">
          <span>USD</span>
          <div className="lvp-input-wrap">
            <input inputMode="decimal" placeholder="100" value={usdAmount}
              onChange={(e) => { setLastEdited("usd"); setUsdAmount(e.target.value); }} />
          </div>
        </div>
        <div className="lvp-field">
          <span>{assetDisplayName ?? assetName}</span>
          <div className="lvp-input-wrap">
            <input inputMode="decimal" value={size}
              onChange={(e) => { setLastEdited("asset"); setSize(e.target.value); }} />
          </div>
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

      {sizeTooSmall && (
        <p className="lvp-error" style={{ marginBottom: 8 }}>
          Too small to trade — try a larger amount or higher leverage.
        </p>
      )}
      <button className="lvp-btn primary" disabled={order.pending || !size || !markPrice || sizeTooSmall} onClick={() => void submit()}>
        {order.pending ? "Placing…" : `${isBuy ? "Long" : "Short"} ${assetDisplayName ?? assetName} ${leverage}x`}
      </button>
      {msg && <p className={`lvp-order-msg ${msgType === "err" ? "lvp-error" : "lvp-muted"}`} role="status">{msg}</p>}
    </div>
  );
}

// Table layout is the same shape as the main dashboard's Perps Positions
// card (App.jsx) — same .positions-table markup/columns/badges, so a
// position reads the same at a glance in both places — dressed up further
// here with a per-side accent, bolder key numbers, and Add/Close actions,
// since this is the dedicated account page rather than a compact summary.
export function PositionsPanel({ hl, user, tradingWallet, onPositionClosed, onAddToPosition }) {
  // Crypto and equities ("xyz") are independently-margined dexs on
  // Hyperliquid — querying only the crypto dex here meant equities
  // positions never appeared in this panel at all, regardless of how long
  // you waited (confirmed against a real open xyz:MU position that never
  // showed up). Fetch and merge both, same as the main dashboard does.
  const cryptoAccount = usePositions(hl, user);
  const equityAccount = usePositions(hl, user, EQUITY_DEX);
  const positions = useMemo(() => [
    ...cryptoAccount.positions.map((p) => ({ ...p, dex: "crypto" })),
    ...equityAccount.positions.map((p) => ({ ...p, dex: "equity" })),
  ], [cryptoAccount.positions, equityAccount.positions]);
  const accountValue = (cryptoAccount.accountValue || 0) + (equityAccount.accountValue || 0);
  const withdrawable = (cryptoAccount.withdrawable || 0) + (equityAccount.withdrawable || 0);
  return (
    <section className="card table-card card-pop">
      <div className="card-toprow">
        <p className="table-card-title">
          Open Positions{positions.length > 0 && <span className="pos-count-badge">{positions.length}</span>}
        </p>
        <span className="tiny muted">Equity ${accountValue.toFixed(2)} · Available ${withdrawable.toFixed(2)}</span>
      </div>
      {positions.length === 0 ? (
        <p className="muted" style={{ padding: "16px 0" }}>No open positions.</p>
      ) : (
        <div className="positions-table-wrap">
          <table className="positions-table positions-table-lg">
            <thead>
              <tr>
                <th className="pt-asset">Asset</th>
                <th>Entry price</th>
                <th>Size</th>
                <th>Mark price</th>
                <th>Liq. price</th>
                <th>Unrealized PnL</th>
                <th>Leverage</th>
                <th className="pt-action"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={`${p.dex}-${p.coin}`}>
                  <td className={`pt-asset pos-accent-${p.side}`}>
                    <span className="asset">
                      <span className="serif pos-asset-name">{displayCoin(p.coin)}</span>
                      <span className="pos-side-row">
                        <span className={`pos-side-badge ${p.side}`}>{p.side === "long" ? "Long" : "Short"}</span>
                        <span className="tiny muted">{p.dex === "equity" ? "Equities" : "Crypto"}</span>
                        {p.health.status !== "healthy" && (
                          <span className={`lvp-badge ${p.health.status}`}>
                            {p.health.status === "warning" && "Thin margin"}
                            {p.health.status === "critical" && "Near liq."}
                            {p.health.status === "backstop_imminent" && "Liq. imminent"}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td data-label="Entry price">${usd(p.entryPx)}</td>
                  <td data-label="Size">{p.size}</td>
                  <td className="pos-mark" data-label="Mark price">${usd(p.markPx)}</td>
                  <td data-label="Liq. price" className={p.health.status !== "healthy" ? `pos-liq-warn ${p.health.status}` : undefined}>
                    {p.health.liquidationPrice != null ? `$${usd(p.health.liquidationPrice)}` : "—"}
                  </td>
                  <td data-label="Unrealized PnL" className={`pos-pnl pos-pnl-lg ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>
                    {p.unrealizedPnl >= 0 ? "+" : ""}${usd(p.unrealizedPnl)}
                  </td>
                  <td data-label="Leverage"><span className="pos-leverage-chip">{p.leverage}x</span></td>
                  <td className="pt-action">
                    <span className="pt-action-group">
                      <button className="lvp-add-btn" onClick={() => onAddToPosition?.(p)}>Add</button>
                      <PerpsCloseCell p={p} hl={hl} user={user} tradingWallet={tradingWallet} onClosed={onPositionClosed} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

