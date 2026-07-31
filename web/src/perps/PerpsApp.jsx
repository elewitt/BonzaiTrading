import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallets, useSendTransaction, useCreateWallet, useUser, useSignTypedData } from "@privy-io/react-auth";
import { useSignTransaction, useSignMessage as useSolanaSignMessage } from "@privy-io/react-auth/solana";
import { VersionedTransaction, Transaction, Connection, PublicKey } from "@solana/web3.js";

import { DEFAULT_CONFIG, EQUITY_DEX, EQUITY_DEX_LABEL } from "./config.js";
import { COINGECKO_SLUGS } from "./coingeckoSlugs.js";
import { API_BASE } from "../lib/api.js";
import { buildQaBypassMessage, setQaBypassCredentials } from "../lib/qaBypass.js";
import { evaluateGate, fetchIpCountry } from "./compliance/geoGate.js";
import { DepositOrchestrator, LocalStateStore } from "./funding/orchestrator.js";
import { DeBridgeProvider } from "./funding/debridge.js";
import { RealDeBridgeIo } from "./funding/realDebridge.js";
import { CctpProvider, RealCctpIo } from "./funding/cctp.js";
import { WithdrawOrchestrator } from "./funding/withdraw.js";
import { useLongviewHl, useAssets, usePositions, useMoveDexFunds } from "./useHyperliquid.js";
import { DepositWizard } from "./DepositWizard.jsx";
import { WithdrawWizard } from "./WithdrawWizard.jsx";
import { OrderTicket, PositionsPanel, MoveFundsCard } from "./PerpsPanel.jsx";
import PerpsDashboard from "./PerpsDashboard.jsx";

const RESTRICTED_REASON_COPY = {
  restricted_country: "Bonzai Trading Perps is not available in your country.",
  restricted_region: "Bonzai Trading Perps is not available in your region (Ontario, Canada).",
  vpn_suspected: "Please disable VPN/proxy and reload.",
  kill_switch: "Bonzai Trading Perps is temporarily unavailable.",
  no_signal: "Unable to verify your location. Please check your connection.",
};

const SOL_RPC = import.meta.env.VITE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Equity asset displayNames are already the bare underlying ticker (the
// "xyz:" dex prefix stripped in useHyperliquid.js's useAssets) — Yahoo
// Finance quote pages are addressable directly by ticker, no lookup needed.
function yahooFinanceUrl(ticker) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}

// Direct coin-page link where we have a verified slug (COINGECKO_SLUGS —
// see that file for how it was generated and two real ticker-collision
// bugs caught along the way). Falls back to CoinGecko's search page for
// anything not in the map, rather than guessing a slug — a search results
// page is never wrong, a bad direct link is.
function coingeckoUrl(ticker) {
  const slug = COINGECKO_SLUGS[ticker];
  if (slug) return `https://www.coingecko.com/en/coins/${slug}`;
  return `https://www.coingecko.com/en/search?query=${encodeURIComponent(ticker)}`;
}

export default function PerpsApp({ solanaAddress, solBalance = 0, usdcBalance = 0, onBack }) {
  const [geoState, setGeoState] = useState("checking");
  const [geoReason, setGeoReason] = useState(null);
  const [tab, setTab] = useState("trade");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategory, setAssetCategory] = useState("crypto"); // "crypto" | "equity"
  const ticketColRef = useRef(null);
  const [ticketHeight, setTicketHeight] = useState(null);
  const [fundView, setFundView] = useState("deposit"); // "deposit" | "withdraw"
  const [fundAccount, setFundAccount] = useState("crypto"); // "crypto" | "equity"
  const [fundModal, setFundModal] = useState(false);

  // ——— Wallets —��—
  const { wallets } = useWallets();
  const { user: privyUser, refreshUser } = useUser();
  const evmWallet = wallets.find((w) => w.walletClientType === "privy" && w.chainType === "ethereum");
  // Fallback to the account's linkedAccounts list when useWallets() hasn't
  // synced this wallet — confirmed via the Privy dashboard that the wallet
  // genuinely exists even when useWallets() doesn't surface it. This lets
  // the deposit flow (which only needs an address, not a "connected" wallet
  // object) work despite that sync gap.
  const evmLinkedAccount = privyUser?.linkedAccounts?.find(
    (a) => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy"
  );
  const evmAddress = evmWallet?.address ?? evmLinkedAccount?.address ?? null;

  // Hyperliquid's SDK only needs { address, signTypedData } (it explicitly
  // supports this minimal "viem local account" shape, docs even call out
  // Privy compatibility) — so build that directly from useSignTypedData's
  // explicit-address option instead of toViemAccount({ wallet: evmWallet }),
  // which requires the ConnectedWallet object useWallets() has a confirmed
  // sync bug on (see the EVM-wallet-setup notes below). Privy's
  // SignTypedDataParams shape ({ domain, types, primaryType, message })
  // matches Hyperliquid's ViemTypedDataParams exactly, so no transform needed.
  const { signTypedData } = useSignTypedData();
  // Skips Privy's own signing modal for every action this wallet object
  // signs (trades, builder approval, withdraw, moving funds between dexs)
  // — this app's own buttons are the sole confirmation gate everywhere now,
  // not just the deposit/trade flows this started with.
  const viemAccount = useMemo(() => {
    if (!evmAddress) return null;
    return {
      address: evmAddress,
      signTypedData: async (params) => {
        const { signature } = await signTypedData(params, { address: evmAddress, uiOptions: { showWalletUIs: false } });
        return signature;
      },
    };
  }, [evmAddress, signTypedData]);

  // Explicit fallback: don't rely solely on Privy's dashboard "create on login"
  // setting, which only fires at login time and won't retroactively create a
  // wallet for an already-authenticated session. Click-triggered only (never
  // auto-run from an effect) — same lesson as the geo-bypass signing prompt:
  // Privy's embedded wallet operations seem to need a direct user gesture to
  // complete reliably rather than hanging indefinitely with no error.
  const { createWallet: createEvmWallet } = useCreateWallet();

  // Diagnostic only — compares the live "connected wallets" list (useWallets)
  // against the account's actual linked-accounts list (useUser). If an
  // ethereum entry shows up in linkedAccounts but never in wallets, that's a
  // Privy SDK connector-sync bug, not a data problem — open the browser
  // console to see this.
  useEffect(() => {
    console.log("[perps/wallets] useWallets():", wallets.map((w) => ({
      walletClientType: w.walletClientType, chainType: w.chainType, address: w.address,
    })));
    console.log("[perps/wallets] user.linkedAccounts:", privyUser?.linkedAccounts?.map((a) => ({
      type: a.type, chainType: a.chainType, address: a.address,
    })));
  }, [wallets, privyUser]);
  const [evmCreateError, setEvmCreateError] = useState(null);
  const [evmCreating, setEvmCreating] = useState(false);
  const [evmCreateAttempted, setEvmCreateAttempted] = useState(false);
  const [evmNeedsReload, setEvmNeedsReload] = useState(false);

  const attemptEvmCreate = useCallback(async () => {
    setEvmCreateAttempted(true);
    setEvmCreateError(null);
    setEvmNeedsReload(false);
    setEvmCreating(true);
    try {
      await createEvmWallet();
      setEvmCreateError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already/i.test(msg)) {
        // Privy's own records say a wallet exists, but this session's
        // useWallets() state never picked it up. Tried refreshUser() as a
        // fix — it resolves without error but does NOT actually update
        // useWallets() state, so it's not a real fix, just a false signal.
        // Only a full page reload (fresh SDK bootstrap) has confirmed to work.
        await refreshUser().catch(() => {});
        setEvmCreateError("Your EVM wallet already exists, but this browser session hasn't loaded it. This needs a page reload, not another click.");
        setEvmNeedsReload(true);
      } else {
        setEvmCreateError(msg);
      }
    } finally {
      setEvmCreating(false);
    }
  }, [createEvmWallet, refreshUser]);

  // Privy EVM send transaction (for Bridge2 deposit on Arbitrum)
  const { sendTransaction: sendEvmTx } = useSendTransaction();

  // Privy Solana sign transaction (for deBridge Solana tx) — the properly
  // typed useSignTransaction() hook, needed (not the wallet-adapter-style
  // ConnectedSolanaWallet.signTransaction) since only the hook form accepts
  // uiOptions to skip Privy's own confirmation modal.
  const { signTransaction: signSolanaTx } = useSignTransaction();

  // ——— HL client + assets ———
  const hl = useLongviewHl(DEFAULT_CONFIG);
  const { assets, markPrices } = useAssets(hl);
  // Equities run on a separate builder dex with independent margining
  // (confirmed against a real account: $0 there despite funds on the main
  // dex) — polled separately, always both at once (not just whichever
  // category is selected) so the balance bar can show both simultaneously.
  // Polls real Hyperliquid account state every 4s — surfaced persistently
  // (not just on the "Positions" tab) so a deposit's effect is visible
  // right away without having to navigate to find it.
  const cryptoAccount = usePositions(hl, evmAddress);
  const equityAccount = usePositions(hl, evmAddress, EQUITY_DEX);
  const isEquityView = assetCategory === "equity";
  // The currently-selected category's numbers — what the ticket/dashboard
  // below actually trade against.
  const accountValue = isEquityView ? equityAccount.accountValue : cryptoAccount.accountValue;
  const withdrawable = isEquityView ? equityAccount.withdrawable : cryptoAccount.withdrawable;
  const positions = isEquityView ? equityAccount.positions : cryptoAccount.positions;
  const marginTiers = isEquityView ? equityAccount.marginTiers : cryptoAccount.marginTiers;
  // Withdrawing (and funding the equities dex) is always FROM the crypto
  // dex regardless of which category is selected.
  const cryptoWithdrawable = cryptoAccount.withdrawable;
  const moveDexFunds = useMoveDexFunds(hl, evmAddress, viemAccount);

  // Shared by both the deposit orchestrator (approve/transfer into HL) and
  // the withdraw orchestrator (approve/order-creation back out) — same
  // wallet, same signing path, no reason to duplicate it per-orchestrator.
  //
  // Always skips Privy's own transaction-confirmation modal
  // (uiOptions.showWalletUIs: false) — this app's own buttons are the sole
  // confirmation step everywhere now, not just deposit.
  const sendEvm = useCallback(async ({ to, data, chainId, gasLimit, value }) => {
    // Explicit address, not reliance on useWallets()'s "connected" wallet
    // list — that list has a confirmed sync gap (wallet verified to exist
    // via the Privy dashboard but absent from useWallets()). sendTransaction
    // accepts a target address directly, which routes around it.
    //
    // Explicit gasLimit too — a real Bridge2 deposit attempt failed with
    // "intrinsic gas too low" relying on Privy's auto-estimation for these
    // specific ERC20 approve / custom Bridge2 calls. Callers pass a
    // generous fixed limit instead of leaving it to auto-estimation.
    const result = await sendEvmTx(
      { to, data, chainId, gasLimit, value },
      { address: evmAddress, uiOptions: { showWalletUIs: false } },
    );
    return result.hash ?? result.transactionHash ?? result;
  }, [sendEvmTx, evmAddress]);

  // ——— Deposit orchestrator with real deBridge IO ———
  const orchestrator = useMemo(() => {
    const store = new LocalStateStore();

    const signAndSendSolana = async (txHex) => {
      // deBridge's create-tx returns tx.data as a 0x-prefixed HEX string, not
      // base64 — confirmed by inspecting the raw API response directly.
      // Decoding it with atob() (as if base64) produced garbage bytes and
      // failed with "Reached end of buffer unexpectedly" on deserialize.
      const hex = txHex.startsWith("0x") ? txHex.slice(2) : txHex;
      const bytes = Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
      const tx = VersionedTransaction.deserialize(bytes);

      const connection = new Connection(SOL_RPC, "confirmed");
      // Refresh the blockhash right before signing. deBridge bakes one in
      // when it builds the tx server-side, but blockhashes expire in
      // ~60-90s — by the time the user gets through Privy's signing modal,
      // it can already be stale ("Blockhash not found" on submit). Safe to
      // overwrite pre-signature since this tx only needs the user's own
      // signature (verified: 1 required signer, no other co-signer to
      // invalidate by changing it).
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      tx.message.recentBlockhash = blockhash;

      // Sign with the Privy Solana wallet via the properly-typed hook (not
      // the legacy wallet-adapter-style solanaWallet.signTransaction(tx),
      // which has no uiOptions support at all) — deposit is the first flow
      // opted into skipping Privy's own confirmation modal in favor of this
      // app's own "Deposit"/"Complete Deposit" buttons as the sole gate.
      const signed = await signSolanaTx({
        transaction: tx,
        connection,
        address: solanaAddress,
        uiOptions: { showWalletUIs: false },
      });
      // Submit to Solana
      return connection.sendRawTransaction(signed.serialize());
    };

    const debridgeIo = new RealDeBridgeIo({
      signAndSendSolana,
      sendEvmTx: sendEvm,
      rpcUrl: SOL_RPC,
    });

    // CCTP's burn instruction is built locally (see cctp/burnInstruction.js)
    // rather than fetched from a server — it also needs a second, ephemeral
    // co-signer (a fresh ed25519 keypair generated per-transaction that
    // owns the new "message sent" event account CCTP creates), unlike
    // deBridge's single-signer pre-built tx above.
    const signAndSendCctpBurn = async (instruction, messageSentEventKeypair) => {
      const connection = new Connection(SOL_RPC, "confirmed");
      const tx = new Transaction();
      tx.add(instruction);
      tx.feePayer = new PublicKey(solanaAddress);
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.partialSign(messageSentEventKeypair);

      const signed = await signSolanaTx({
        transaction: tx,
        connection,
        address: solanaAddress,
        uiOptions: { showWalletUIs: false },
      });
      return connection.sendRawTransaction(signed.serialize());
    };

    const cctpIo = new RealCctpIo({
      signAndSendCctpBurn,
      sendEvmTx: sendEvm,
      rpcUrl: SOL_RPC,
    });

    return new DepositOrchestrator(
      // Unit rail excluded: funding/unit.js is still UnitDemoIo, a fake stub
      // that never touches real funds but reports "done" — unsafe to expose
      // until it has a real IO implementation.
      {
        debridge: new DeBridgeProvider(debridgeIo, "sol"),
        debridge_usdc: new DeBridgeProvider(debridgeIo, "usdc"),
        cctp_usdc: new CctpProvider(cctpIo),
      },
      store,
    );
  }, [signSolanaTx, sendEvm, solanaAddress]);

  const user = useMemo(() => {
    if (!solanaAddress || !evmAddress) return null;
    return { solana: solanaAddress, evm: evmAddress };
  }, [solanaAddress, evmAddress]);

  // ——— Withdraw orchestrator (Hyperliquid → Arbitrum → Solana) ———
  const withdrawOrchestrator = useMemo(() => {
    return new WithdrawOrchestrator({
      hl,
      mainWallet: viemAccount,
      sendEvmTx: sendEvm,
      store: new LocalStateStore("lv_wd_"),
    });
  }, [hl, viemAccount, sendEvm]);

  // ——— Geo gate ———
  const { signMessage: signSolanaMessage } = useSolanaSignMessage();
  const [qaBypassStatus, setQaBypassStatus] = useState(null);
  // null | "signing" | "checking-server" | "declined:<msg>" | "server-rejected" | "network-error:<msg>"
  const wantsQaBypass = new URLSearchParams(window.location.search).get("qa_bypass") === "1";

  // ⚠️ GEO-GATING INTENTIONALLY DISABLED SITE-WIDE (2026-07-16, explicit
  // user request, made with informed awareness of the compliance
  // implications — Hyperliquid's own terms of service still restrict US
  // persons and OFAC-sanctioned jurisdictions; only this technical
  // enforcement was turned off). fetchIpCountry/evaluateGate and the
  // "blocked" render path below are left in place in case this needs to be
  // reinstated before any real compliance review.
  useEffect(() => {
    setGeoState("allowed");
  }, []);

  // Click-triggered only (never auto-run from an effect) — wallet SDKs
  // generally expect signing requests to originate from a direct user
  // gesture; triggering this from background code left Privy's own
  // "Connecting to your wallet" modal stuck indefinitely in testing.
  // Opt-in via ?qa_bypass=1 so ordinary visitors never see this button at
  // all — the server still requires a real signature from an allowlisted
  // address (PERPS_QA_ALLOWLIST), so this can't be used by anyone else even
  // if they find the query param.
  const attemptQaBypass = useCallback(async () => {
    if (!solanaAddress) return;
    setQaBypassStatus("signing");
    const message = buildQaBypassMessage(solanaAddress);
    let signature;
    try {
      const sigBytes = await signSolanaMessage({ message: new TextEncoder().encode(message) });
      signature = btoa(String.fromCharCode(...sigBytes));
    } catch (e) {
      setQaBypassStatus(`declined:${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setQaBypassStatus("checking-server");
    try {
      const r = await fetch(`${API_BASE}/api/perps/qa-bypass`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: solanaAddress, message, signature }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.allowed) {
        // Cache for reuse: xStocks routes (api.js) attach the same signed
        // credentials as headers on every request, so one signature covers
        // both the perps client-gate and the xStocks server-gate.
        setQaBypassCredentials({ address: solanaAddress, message, signature });
        setGeoState("allowed"); setQaBypassStatus("allowed"); return;
      }
      setQaBypassStatus("server-rejected");
    } catch (e) {
      setQaBypassStatus(`network-error:${e instanceof Error ? e.message : String(e)}`);
    }
  }, [solanaAddress, signSolanaMessage]);

  const filteredAssets = useMemo(() => {
    const q = assetSearch.toLowerCase();
    return assets.filter(
      (a) => a.category === assetCategory && (!q || a.name.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q)),
    );
  }, [assets, assetSearch, assetCategory]);

  // selectedAsset can be stale after switching category (it belongs to the
  // other list) — fall back to the new category's first asset in that case.
  const asset = (selectedAsset?.category === assetCategory ? selectedAsset : null) ?? filteredAssets[0] ?? null;
  const markPrice = asset ? (markPrices[asset.name] ?? 0) : 0;

  // "Add" on an open position (Positions tab) — rather than building a
  // second, separately-tested order-submission path, this just hands off
  // to the real Trade tab's own OrderTicket, preselected to the position's
  // exact market. Looks the asset up from the real `assets` list (not
  // built from the position's own fields) so maxLeverage/displayName are
  // never guessed at.
  const handleAddToPosition = useCallback((p) => {
    const match = assets.find((a) => a.name === p.coin && a.category === (p.dex === "equity" ? "equity" : "crypto"));
    if (!match) return;
    setAssetCategory(match.category);
    setSelectedAsset(match);
    setTab("trade");
  }, [assets]);

  // The order ticket's natural height (leverage slider, size input, etc.) is
  // the reference the Market panel and the chart/positions column should
  // both be capped to and scroll within — not the other way around, so a
  // long asset list or position history never makes the row taller than a
  // normal order form needs to be.
  useEffect(() => {
    const el = ticketColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setTicketHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [asset]);

  // ——— Render: loading / blocked ———
  if (geoState === "checking") {
    return (
      <div className="perps-stage">
        <PerpsTopbar onBack={onBack} />
        <div className="loading-wrap"><div className="loading-dots"><span /><span /><span /></div></div>
      </div>
    );
  }

  if (geoState === "blocked") {
    return (
      <div className="perps-stage">
        <PerpsTopbar onBack={onBack} />
        <div className="perps-blocked">
          <div className="perps-blocked-icon">⛔</div>
          <h2 className="display sm">Not available</h2>
          <p className="lede">{RESTRICTED_REASON_COPY[geoReason] ?? "Bonzai Trading Perps is not available in your region."}</p>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Leveraged perpetuals are restricted in certain jurisdictions. Bonzai Trading's spot equity product remains available.
          </p>
          {wantsQaBypass && (
            <div style={{ marginTop: 16 }}>
              <button
                className="btn ghost"
                disabled={!solanaAddress || qaBypassStatus === "signing" || qaBypassStatus === "checking-server"}
                onClick={attemptQaBypass}
              >
                {qaBypassStatus === "signing" ? "Waiting for signature…"
                  : qaBypassStatus === "checking-server" ? "Verifying…"
                  : "Verify QA access"}
              </button>
              {qaBypassStatus && (
                <p className="tiny muted mono" style={{ marginTop: 8, wordBreak: "break-word" }}>
                  qa_bypass: {qaBypassStatus}
                </p>
              )}
            </div>
          )}
          <button className="btn ghost" style={{ marginTop: 24 }} onClick={onBack}>← Back to portfolio</button>
        </div>
      </div>
    );
  }

  // ——— Render: main perps UI ———
  return (
    <div className="perps-stage">
      <PerpsTopbar onBack={onBack} />

      {!evmAddress && (
        <div className="perps-notice">
          {evmCreateError ? (
            <p className="tiny muted">
              {evmCreateError}{" "}
              {evmNeedsReload ? (
                <button className="linkish" onClick={() => window.location.reload()}>Reload page</button>
              ) : (
                <button className="linkish" onClick={attemptEvmCreate} disabled={evmCreating}>
                  {evmCreating ? "Retrying…" : "Retry"}
                </button>
              )}
            </p>
          ) : (
            <p className="tiny muted">
              Trading perps needs a second wallet (Arbitrum + Hyperliquid), created alongside your Solana one.{" "}
              <button className="linkish" onClick={attemptEvmCreate} disabled={evmCreating}>
                {evmCreating ? "Setting up…" : evmCreateAttempted ? "Try again" : "Set up EVM wallet"}
              </button>
            </p>
          )}
        </div>
      )}

      {evmAddress && (
        <div className="perps-balance-bar">
          <span>
            <span className="tiny muted">Crypto Account Equity</span>
            <span className="mono perps-balance-value">${cryptoAccount.accountValue.toFixed(2)}</span>
          </span>
          <span>
            <span className="tiny muted">{EQUITY_DEX_LABEL} Account Equity</span>
            <span className="mono perps-balance-value">${equityAccount.accountValue.toFixed(2)}</span>
          </span>
          <span>
            <span className="tiny muted">Available to trade</span>
            <span className="mono perps-balance-value">${withdrawable.toFixed(2)}</span>
          </span>
          <span style={{ marginLeft: "auto", flexDirection: "row", gap: 10 }}>
            <button className="lvp-btn" onClick={() => { setFundView("deposit"); setFundModal(true); }}>Deposit</button>
            <button className="lvp-btn" onClick={() => { setFundView("withdraw"); setFundModal(true); }}>Withdraw</button>
          </span>
        </div>
      )}

      <div className="perps-tabs">
        <button className={`perps-tab ${tab === "trade"   ? "active" : ""}`} onClick={() => setTab("trade")}>Trade</button>
        <button className={`perps-tab ${tab === "account" ? "active" : ""}`} onClick={() => setTab("account")}>Positions</button>
      </div>

      {tab === "trade" && (
        <div className="perps-trade-layout">
          <div className="perps-asset-panel lvp-card" style={ticketHeight ? { maxHeight: ticketHeight, overflowY: "auto" } : undefined}>
            <h3>Market</h3>
            <div className="perps-category-toggle">
              <button className={`lvp-pct-btn ${assetCategory === "crypto" ? "sel" : ""}`}
                onClick={() => { setAssetCategory("crypto"); setSelectedAsset(null); }}>Crypto</button>
              <button className={`lvp-pct-btn ${assetCategory === "equity" ? "sel" : ""}`}
                onClick={() => { setAssetCategory("equity"); setSelectedAsset(null); }}>{EQUITY_DEX_LABEL}</button>
            </div>
            <input className="perps-asset-search" placeholder="Search…" value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)} />
            <div className="perps-asset-list">
              {filteredAssets.slice(0, 40).map((a) => (
                <div key={a.name} className={`perps-asset-row ${asset?.name === a.name ? "active" : ""}`}
                  role="button" tabIndex={0}
                  onClick={() => setSelectedAsset(a)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedAsset(a); }}>
                  <a className="perps-asset-name mono perps-asset-link"
                    href={a.category === "equity" ? yahooFinanceUrl(a.displayName) : coingeckoUrl(a.displayName)}
                    target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    {a.displayName}
                  </a>
                  <span className="perps-asset-price">
                    {markPrices[a.name] ? `$${Number(markPrices[a.name]).toLocaleString()}` : "—"}
                  </span>
                </div>
              ))}
              {filteredAssets.length === 0 && <p className="lvp-muted" style={{ padding: "12px 0" }}>No markets found.</p>}
            </div>
          </div>

          <div className="perps-ticket-col" ref={ticketColRef}>
            {asset ? (
              <>
                <div className="perps-market-header">
                  <a className="serif perps-asset-link" style={{ fontSize: 20 }}
                    href={asset.category === "equity" ? yahooFinanceUrl(asset.displayName) : coingeckoUrl(asset.displayName)}
                    target="_blank" rel="noopener noreferrer">
                    {asset.displayName}-PERP
                  </a>
                  <span className="lvp-muted">{asset.maxLeverage}x max</span>
                  {markPrice > 0 && (
                    <span className="mono" style={{ fontSize: 18 }}>
                      ${markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <OrderTicket
                  hl={hl} cfg={DEFAULT_CONFIG}
                  user={evmAddress} mainWallet={viemAccount} tradingWallet={viemAccount}
                  assetIndex={asset.index} assetName={asset.name} assetDisplayName={asset.displayName}
                  markPrice={markPrice} maxLeverage={asset.maxLeverage} szDecimals={asset.szDecimals}
                  accountValue={accountValue} withdrawable={withdrawable}
                  positions={positions} marginTiers={marginTiers}
                  isEquity={asset.category === "equity"} equityDex={EQUITY_DEX}
                  cryptoWithdrawable={cryptoWithdrawable} moveDexFunds={moveDexFunds}
                />
              </>
            ) : (
              <div className="lvp-card"><p className="lvp-muted">Select a market to start trading.</p></div>
            )}
          </div>

          <div style={ticketHeight ? { maxHeight: ticketHeight, overflowY: "auto" } : undefined}>
            <PerpsDashboard hl={hl} cfg={DEFAULT_CONFIG} user={evmAddress} tradingWallet={viemAccount} positions={positions} />
          </div>
        </div>
      )}

      {fundModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setFundModal(false)}>
          <div className="modal-box card">
            {user ? (
              <>
                <div className="perps-category-toggle" style={{ marginBottom: 16 }}>
                  <button className={`lvp-pct-btn ${fundAccount === "crypto" ? "sel" : ""}`} onClick={() => setFundAccount("crypto")}>Crypto</button>
                  <button className={`lvp-pct-btn ${fundAccount === "equity" ? "sel" : ""}`} onClick={() => setFundAccount("equity")}>{EQUITY_DEX_LABEL}</button>
                </div>

                {fundAccount === "crypto" && fundView === "deposit" && (
                  <DepositWizard orchestrator={orchestrator} user={user}
                    walletSolBalance={solBalance} walletUsdcBalance={usdcBalance} rpcUrl={SOL_RPC}
                    onFunded={() => setFundModal(false)} />
                )}
                {fundAccount === "crypto" && fundView === "withdraw" && (
                  <WithdrawWizard orchestrator={withdrawOrchestrator} user={user}
                    withdrawable={cryptoWithdrawable} onWithdrawn={() => setFundModal(false)} />
                )}
                {fundAccount === "equity" && fundView === "deposit" && (
                  <>
                    <MoveFundsCard
                      title={`Deposit to ${EQUITY_DEX_LABEL}`}
                      description={`Move cash already in your trading account into ${EQUITY_DEX_LABEL}.`}
                      fromBalance={cryptoWithdrawable}
                      sourceDex="" destinationDex={EQUITY_DEX}
                      moveDexFunds={moveDexFunds}
                      buttonLabel="Deposit"
                      onDone={() => setFundModal(false)}
                    />
                    {/* sendAsset can only move USDC already inside Hyperliquid
                        between dexs — it can't pull from the wallet directly,
                        so a user with little/no crypto-dex balance had no way
                        to fund Equities at all without leaving this modal,
                        depositing on the Crypto tab, then coming back. Offer
                        the same wallet deposit inline instead. */}
                    <p className="lvp-muted" style={{ marginTop: 18, marginBottom: 8, fontSize: 13 }}>
                      Need more cash first? Add funds below, then move them to {EQUITY_DEX_LABEL} above.
                    </p>
                    <DepositWizard orchestrator={orchestrator} user={user}
                      walletSolBalance={solBalance} walletUsdcBalance={usdcBalance} rpcUrl={SOL_RPC}
                      onFunded={() => {}} />
                  </>
                )}
                {fundAccount === "equity" && fundView === "withdraw" && (
                  <MoveFundsCard
                    title={`Withdraw from ${EQUITY_DEX_LABEL}`}
                    fromBalance={equityAccount.withdrawable}
                    sourceDex={EQUITY_DEX} destinationDex=""
                    moveDexFunds={moveDexFunds}
                    buttonLabel="Withdraw"
                    onDone={() => setFundModal(false)}
                  />
                )}
              </>
            ) : (
              <div>
                <p className="lvp-muted">
                  {evmCreateError || "Trading perps needs a second wallet (Arbitrum + Hyperliquid)."}
                </p>
                {evmNeedsReload ? (
                  <button className="lvp-btn" style={{ marginTop: 10 }} onClick={() => window.location.reload()}>
                    Reload page
                  </button>
                ) : (
                  <button className="lvp-btn" style={{ marginTop: 10 }} disabled={evmCreating} onClick={attemptEvmCreate}>
                    {evmCreating ? "Setting up…" : evmCreateAttempted || evmCreateError ? "Try again" : "Set up EVM wallet"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "account" && (
        <div className="perps-account-layout">
          <PositionsPanel hl={hl} user={evmAddress}
            tradingWallet={viemAccount}
            onPositionClosed={() => {}}
            onAddToPosition={handleAddToPosition} />
        </div>
      )}
    </div>
  );
}

function PerpsTopbar({ onBack }) {
  return (
    <div className="perps-topbar">
      <button className="btn ghost perps-back-btn" onClick={onBack}>← Back</button>
      <span className="perps-wordmark">Bonzai Trading <span className="perps-tag">Perps</span></span>
      <div className="perps-network-badge">
        {DEFAULT_CONFIG.network === "mainnet" ? "Mainnet" : "Testnet"}
      </div>
    </div>
  );
}
