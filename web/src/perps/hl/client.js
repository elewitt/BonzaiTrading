import * as hl from "@nktkas/hyperliquid";
import { formatPrice, formatSize, SymbolConverter } from "@nktkas/hyperliquid/utils";
import { assertValidPerpBuilderFee, checkApproval, tenthsBpsToPercentString } from "./builder.js";
import { EQUITY_DEX } from "../config.js";

export class LongviewHl {
  constructor(cfg) {
    assertValidPerpBuilderFee(cfg.builderFeeTenthsBps);
    this.cfg = cfg;
    this.transport = new hl.HttpTransport({ isTestnet: cfg.network === "testnet" });
    this.info = new hl.InfoClient({ transport: this.transport });
    this._symbolConverterPromise = null;
  }

  /**
   * Lazily-created, cached converter for computing correct order asset ids
   * on builder-deployed (HIP-3) dexs — their id scheme is offset from the
   * main dex's simple array-position indices, and hand-rolling that offset
   * math risks silently routing an order to the wrong asset. The SDK's own
   * converter is the tested source of truth for it.
   */
  symbolConverter() {
    if (!this._symbolConverterPromise) {
      this._symbolConverterPromise = SymbolConverter.create({ transport: this.transport, dexs: [EQUITY_DEX] });
    }
    return this._symbolConverterPromise;
  }

  exchange(wallet) {
    return new hl.ExchangeClient({
      transport: this.transport,
      wallet,
      isTestnet: this.cfg.network === "testnet",
    });
  }

  async approvalStatus(user) {
    const max = await this.info.maxBuilderFee({
      user,
      builder: this.cfg.builderAddress,
    });
    return checkApproval(max, this.cfg.builderFeeTenthsBps);
  }

  async approveBuilderFee(mainWallet) {
    const ex = this.exchange(mainWallet);
    await ex.approveBuilderFee({
      builder: this.cfg.builderAddress,
      maxFeeRate: this.cfg.approvalMaxFeeRate,
    });
  }

  async revokeBuilderFee(mainWallet) {
    const ex = this.exchange(mainWallet);
    await ex.approveBuilderFee({
      builder: this.cfg.builderAddress,
      maxFeeRate: tenthsBpsToPercentString(0),
    });
  }

  get hasBuilder() {
    const z = "0x0000000000000000000000000000000000000000";
    return this.cfg.builderAddress && this.cfg.builderAddress !== z;
  }

  async placeOrder(wallet, user, p) {
    if (this.hasBuilder) {
      const approval = await this.approvalStatus(user);
      if (!approval.sufficient) throw new BuilderApprovalRequiredError(approval);
    }
    const ex = this.exchange(wallet);
    return ex.order({
      orders: [
        {
          a: p.assetIndex,
          b: p.isBuy,
          s: p.size,
          p: p.price,
          r: p.reduceOnly ?? false,
          t: { limit: { tif: p.tif ?? "Gtc" } },
          ...(p.cloid ? { c: p.cloid } : {}),
        },
      ],
      grouping: "na",
      ...(this.hasBuilder ? { builder: { b: this.cfg.builderAddress, f: this.cfg.builderFeeTenthsBps } } : {}),
    });
  }

  /**
   * Market-close a position. Uses an IoC reduceOnly order at a very aggressive
   * limit price so it fills immediately at best available, same as a market order.
   */
  async closePosition(wallet, user, { assetIndex, isLong, size, markPrice, szDecimals }) {
    // Gate the approval check and builder param on hasBuilder, same as
    // placeOrder() — this was unconditional here, which meant a
    // zero/unconfigured builder address (the current production config)
    // blocked EVERY position close with "builder fee not approved for
    // this user", even though no builder fee was ever going to be
    // charged. Confirmed as a real bug: opening orders worked fine
    // (placeOrder correctly skips the check), but nothing could close.
    if (this.hasBuilder) {
      const approval = await this.approvalStatus(user);
      if (!approval.sufficient) throw new BuilderApprovalRequiredError(approval);
    }
    const ex = this.exchange(wallet);
    const isBuy = !isLong; // opposite side closes the position
    // Sentinel prices ("1" / "999999999") used to guarantee an IOC fill
    // always got rejected with "Order price cannot be more than 95% away
    // from the reference price" — Hyperliquid enforces that band on every
    // order, close or not. Price tight around the real mark instead, same
    // 2% slippage placeOrder already uses successfully for market orders.
    const rawPrice = isBuy ? markPrice * 1.02 : markPrice * 0.98;
    const price = formatPrice(rawPrice, szDecimals ?? 0);
    const formattedSize = formatSize(String(Math.abs(size)), szDecimals ?? 0);
    return ex.order({
      orders: [{
        a: assetIndex,
        b: isBuy,
        s: formattedSize,
        p: price,
        r: true,             // reduceOnly — never opens a new position
        t: { limit: { tif: "Ioc" } },
      }],
      grouping: "na",
      ...(this.hasBuilder ? { builder: { b: this.cfg.builderAddress, f: this.cfg.builderFeeTenthsBps } } : {}),
    });
  }

  /**
   * Set leverage for an asset before placing an order.
   * Must be called whenever the user changes leverage.
   */
  async setLeverage(wallet, assetIndex, leverage, isCross = true) {
    const ex = this.exchange(wallet);
    return ex.updateLeverage({ asset: assetIndex, isCross, leverage: Math.round(leverage) });
  }

  /**
   * Withdraw USDC from Hyperliquid to the user's own Arbitrum address.
   * User-signed EIP-712 (same signing path as approveBuilderFee), $1 flat
   * fee taken by Hyperliquid, confirmed ~5 min to land — per their docs.
   */
  async withdrawFromHl(mainWallet, { destination, amount }) {
    const ex = this.exchange(mainWallet);
    await ex.withdraw3({ destination, amount });
  }

  /**
   * Move USDC collateral directly between dexs (e.g. main crypto dex →
   * the "xyz" equities/commodities dex) — a workaround for Hyperliquid's
   * "dexAbstraction" opt-in, confirmed broken server-side (rejected with a
   * different, unrelated, never-used address on every attempt across
   * multiple sessions, despite our signed payload verified correct via
   * signature recovery). sendAsset is a separate, longer-established
   * primitive that achieves the same practical goal — a funded xyz dex —
   * via an explicit one-time transfer instead of an automatic "unify
   * everything" toggle, so it doesn't depend on that broken endpoint at
   * all. Self-transfer only (destination = the caller's own address);
   * self-custody is never at risk either way.
   */
  async moveUsdcToDex(mainWallet, { destination, sourceDex = "", destinationDex, amount }) {
    const ex = this.exchange(mainWallet);
    // Real mainnet USDC token id, confirmed via spotMeta — the SDK's own
    // usage example uses a placeholder id that isn't valid on mainnet.
    await ex.sendAsset({
      destination, sourceDex, destinationDex, amount,
      token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
    });
  }

  /**
   * Builder-deployed dexs (dex="xyz" for stocks/commodities) have
   * independent margining — confirmed by querying a real funded account's
   * main-dex balance vs its xyz-dex balance and finding them separate. This
   * always needs the right dex passed explicitly rather than assumed.
   */
  clearinghouseState(user, dex) {
    return this.info.clearinghouseState(dex ? { user, dex } : { user });
  }

  meta(dex) {
    return this.info.meta(dex ? { dex } : undefined);
  }

  metaAndAssetCtxs(dex) {
    return this.info.metaAndAssetCtxs(dex ? { dex } : undefined);
  }

  /** Account-value/PnL history grouped by period — powers the dashboard chart. */
  portfolio(user) {
    return this.info.portfolio({ user });
  }

  /** Individual trade fills — powers the dashboard's recent-activity feed. */
  userFills(user) {
    return this.info.userFills({ user });
  }

}

export class BuilderApprovalRequiredError extends Error {
  constructor(approval) {
    super(
      approval.approved
        ? `builder fee approval too low: approved ${approval.approvedTenthsBps} tenths-bps`
        : "builder fee not approved for this user",
    );
    this.name = "BuilderApprovalRequiredError";
    this.approval = approval;
  }
}
