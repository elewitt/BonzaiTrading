import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePrivy, useSessionSigners, useWallets, useSignTypedData } from "@privy-io/react-auth";
import { useSolanaWallets, useSignTransaction, useSignMessage, useFundWallet } from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
import Donut from "./components/Donut.jsx";
import { useLongviewHl, usePositions } from "./perps/useHyperliquid.js";
import { DEFAULT_CONFIG, EQUITY_DEX } from "./perps/config.js";
import PerformanceChart from "./components/PerformanceChart.jsx";
import AssetInfoModal from "./components/AssetInfoModal.jsx";
import NewsPanel from "./components/NewsPanel.jsx";
import HistoryScreen from "./components/HistoryScreen.jsx";
import ShareModal from "./components/ShareCard.jsx";
import DemoAnimation from "./components/DemoAnimation.jsx";
import LandingPage from "./components/LandingPage.jsx";
import PerpsApp from "./perps/PerpsApp.jsx";
import BorrowApp from "./borrow/BorrowApp.jsx";
import PositionCard from "./borrow/PositionCard.jsx";
import { useKaminoReserves } from "./borrow/useKamino.js";
import { api, executeSwap, executeWithdraw, derivePortfolio, planTrades, mergePortfolioCollateral, stripKaminoDust, usd, short, setAuthTokenProvider } from "./lib/api.js";
import { buildQaBypassMessage, setQaBypassCredentials, hasQaBypassCredentials } from "./lib/qaBypass.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// USDT isn't a supported holding here — any that arrives gets auto-offered
// a one-click convert to USDC instead.
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// Key quorum ID for the app's Wallet Infrastructure authorization key
// (dashboard: Wallet infrastructure → Authorization keys → "Bonzai"). Not a
// secret — a public identifier, same trust level as the Privy app ID.
// useDelegatedActions().delegateWallet() does NOT take a signer ID and left
// the wallet's additionalSigners empty (confirmed via walletApi.getWallets()
// server-side); useSessionSigners().addSessionSigners() with this explicit
// signerId is what actually registers our authorization key as an
// authorized signer on the user's wallet.
const BOT_SESSION_SIGNER_ID = "km6qux413cpcb5n4ug8ujqp7";

// Close-position action for the dashboard's Perps "Positions" table — a
// single grid cell, not the taller PerpsPanel.jsx PositionRow card (that's
// for the dedicated Perps app's own layout, not this compact table row).
function PerpsCloseCell({ p, hl, user, tradingWallet, onClosed }) {
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

export default function App() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const wallet = wallets.find((w) => w.walletClientType === "privy") || wallets[0];
  const address = wallet?.address;

  // Read-only Perps data for the consolidated dashboard's Perps tab —
  // clearinghouseState is a public query (no signing), so this is safe to
  // poll in the background regardless of which product tab is active. EVM
  // address derivation mirrors PerpsApp.jsx exactly (useWallets() has a
  // confirmed sync gap; falling back to the linkedAccounts list works
  // around it).
  const { wallets: evmWallets } = useWallets();
  const evmWallet = evmWallets.find((w) => w.walletClientType === "privy" && w.chainType === "ethereum");
  const evmLinkedAccount = user?.linkedAccounts?.find(
    (a) => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy"
  );
  const evmAddress = evmWallet?.address ?? evmLinkedAccount?.address ?? null;
  const hl = useLongviewHl(DEFAULT_CONFIG);
  const cryptoPerps = usePositions(hl, evmAddress, undefined, 20_000);
  const equityPerps = usePositions(hl, evmAddress, EQUITY_DEX, 20_000);

  // EVM signing for closing a Perps position directly from this dashboard —
  // identical minimal "viem local account" shape PerpsApp.jsx builds
  // (Hyperliquid's SDK only needs { address, signTypedData }).
  const { signTypedData } = useSignTypedData();
  const perpsWallet = useMemo(() => {
    if (!evmAddress) return null;
    return {
      address: evmAddress,
      signTypedData: async (params) => {
        const { signature } = await signTypedData(params, { address: evmAddress });
        return signature;
      },
    };
  }, [evmAddress, signTypedData]);

  // Same signed QA-bypass credentials used by the perps flow, reused here so
  // xStocks trade endpoints (which have their own server-side geo-gate) don't
  // block internal testing either. Opt-in only via ?qa_bypass=1 — ordinary
  // users never see this; the server still requires a real signature from an
  // allowlisted address (PERPS_QA_ALLOWLIST), so the query param alone grants
  // nothing to anyone else.
  const wantsQaBypass = new URLSearchParams(window.location.search).get("qa_bypass") === "1";
  const [qaBypassDone, setQaBypassDone] = useState(hasQaBypassCredentials());
  const [qaBypassBusy, setQaBypassBusy] = useState(false);
  const [qaBypassErr, setQaBypassErr] = useState(null);
  const verifyQaBypass = useCallback(async () => {
    if (!address) return;
    setQaBypassBusy(true);
    setQaBypassErr(null);
    try {
      const message = buildQaBypassMessage(address);
      const sigBytes = await signMessage({ message: new TextEncoder().encode(message) });
      const signature = btoa(String.fromCharCode(...sigBytes));
      setQaBypassCredentials({ address, message, signature });
      setQaBypassDone(true);
    } catch (e) {
      setQaBypassErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQaBypassBusy(false);
    }
  }, [address, signMessage]);

  const [registry, setRegistry] = useState(null);
  const [sponsored, setSponsored] = useState(false);
  const [prices, setPrices] = useState({});
  const [holdings, setHoldings] = useState(null);
  const [copied, setCopied] = useState(false);

  // build / rebalance flow
  const [view, setView] = useState("auto"); // auto | build | weights | execute
  const [prompt, setPrompt] = useState("");
  const [rebalPrompt, setRebalPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [withdrawalProposal, setWithdrawalProposal] = useState(null); // {to, usd, amount}
  const [legs, setLegs] = useState([]);
  const [error, setError] = useState("");
  const [investPct, setInvestPct] = useState(100);
  const [statsFlipped, setStatsFlipped] = useState(false);
  const [dashProduct, setDashProduct] = useState("brokerage"); // "brokerage" | "perps" | "borrow"
  const [borrowDashTabKey, setBorrowDashTabKey] = useState(null);
  const [history, setHistory] = useState([]);
  const [yieldMode, setYieldMode] = useState(() => localStorage.getItem("lv_yield_mode") === "true");
  const [hideDustAmounts, setHideDustAmounts] = useState(() => localStorage.getItem("lv_hide_dust") === "true");
  const [answer, setAnswer] = useState(null); // { text, sources, mentionedSymbols }
  const [shareOpen, setShareOpen] = useState(false);
  const [customRebalanceOpen, setCustomRebalanceOpen] = useState(false);
  const [customAllocs, setCustomAllocs] = useState([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  const [usdtToken, setUsdtToken] = useState(null); // holdings entry for a detected USDT deposit
  const [usdtModalOpen, setUsdtModalOpen] = useState(false);
  const [usdtHandledAmount, setUsdtHandledAmount] = useState(0); // uiAmount already prompted/converted — don't re-nag for the same deposit
  const [usdtSwap, setUsdtSwap] = useState({ busy: false, status: null, error: null });
  const [txHistory, setTxHistory] = useState([]);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAsset, setWithdrawAsset] = useState("USDC");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmountStr, setWithdrawAmountStr] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileModal, setProfileModal] = useState(null); // "account" | "settings" | null
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState([]); // [{ label, address }]
  const [newAddrLabel, setNewAddrLabel] = useState("");
  const [newAddrValue, setNewAddrValue] = useState("");
  const [withdrawToSaved, setWithdrawToSaved] = useState("");
  const [telegramCode, setTelegramCode] = useState(null); // { code, expiresIn } | null
  const [telegramCodeBusy, setTelegramCodeBusy] = useState(false);
  const [telegramCodeErr, setTelegramCodeErr] = useState(null);
  const [botTradingEnabled, setBotTradingEnabled] = useState(() => localStorage.getItem("lv_bot_trading") === "true");
  const [botTradingBusy, setBotTradingBusy] = useState(false);
  const [botTradingErr, setBotTradingErr] = useState(null);
  const [watchedPortfolios, setWatchedPortfolios] = useState([]); // [{ label, address }]
  const [activeAllocTab, setActiveAllocTab] = useState("mine"); // "mine" | watched address
  const [viewedHoldings, setViewedHoldings] = useState(null);
  const [addPortfolioOpen, setAddPortfolioOpen] = useState(false);
  const [newPortfolioEmail, setNewPortfolioEmail] = useState("");
  const [addPortfolioBusy, setAddPortfolioBusy] = useState(false);
  const [addPortfolioErr, setAddPortfolioErr] = useState(null);
  const [discoverable, setDiscoverableState] = useState(() => localStorage.getItem("lv_discoverable") === "true");
  const [discoverableBusy, setDiscoverableBusy] = useState(false);
  const [discoverableErr, setDiscoverableErr] = useState(null);
  const [assetInfoSymbol, setAssetInfoSymbol] = useState(null);
  const busy = useRef(false);
  const profileRef = useRef(null);

  /* ——— auth: hand the server-request helper a way to fetch a fresh Privy token ——— */
  useEffect(() => { setAuthTokenProvider(getAccessToken); }, [getAccessToken]);

  /* ——— profile menu: close on outside click ——— */
  useEffect(() => {
    if (!profileOpen) return;
    const onDocClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [profileOpen]);

  /* ——— bootstrap: token registry ——— */
  useEffect(() => {
    api.tokens()
      .then((d) => { setRegistry(d.tokens); setSponsored(d.sponsored); })
      .catch((e) => setError(`Server unreachable — is longview-server running? (${e.message})`));
  }, []);

  /* ——— prices: poll Jupiter every 15s ——— */
  useEffect(() => {
    if (!registry) return;
    const mints = Object.values(registry).filter((t) => t.symbol !== "USDC").map((t) => t.mint);
    // Merge, don't replace — the server returns {} for any price batch that
    // transiently fails (Jupiter rate limit/hiccup), and a wholesale replace
    // would zero out that token's value for one poll cycle, misclassifying a
    // real position as dust and flickering the Rebalance buttons out.
    const tick = () => api.prices(mints).then((fresh) => setPrices((prev) => ({ ...prev, ...fresh }))).catch(() => {});
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [registry]);

  /* ——— holdings: poll every 30s ——— */
  const refreshHoldings = useCallback(() => {
    if (!address) return Promise.resolve();
    return api.holdings(address).then(setHoldings).catch(() => {});
  }, [address]);
  useEffect(() => {
    if (!address) return;
    refreshHoldings();
    const id = setInterval(refreshHoldings, 30000);
    return () => clearInterval(id);
  }, [address, refreshHoldings]);

  const { fundWallet } = useFundWallet({ onUserExited: refreshHoldings });

  // ——— USDT deposits: not a supported holding on this platform, so any
  // USDT that lands in the wallet (e.g. sent to the deposit address by
  // mistake, or from an exchange that doesn't support USDC withdrawals)
  // gets flagged for an explicit, user-confirmed auto-convert to USDC
  // rather than silently sitting there or silently being swapped. ———
  useEffect(() => {
    const usdt = holdings?.tokens?.find((t) => t.mint === USDT_MINT);
    const uiAmount = usdt?.uiAmount || 0;
    if (uiAmount > 0 && uiAmount > usdtHandledAmount) {
      setUsdtToken(usdt);
      setUsdtModalOpen(true);
    }
  }, [holdings, usdtHandledAmount]);

  const portfolio = useMemo(
    () => (registry && holdings ? derivePortfolio(holdings, prices, registry, { yieldMode }) : null),
    [registry, holdings, prices, yieldMode]
  );

  /* ——— portfolio history: load from localStorage when address changes ——— */
  useEffect(() => {
    if (!address) return;
    try { setHistory(JSON.parse(localStorage.getItem(`lv_hist_${address}`) || "[]")); }
    catch { setHistory([]); }
    try { setTxHistory(JSON.parse(localStorage.getItem(`lv_txns_${address}`) || "[]")); }
    catch { setTxHistory([]); }
    try { setSavedAddresses(JSON.parse(localStorage.getItem(`lv_saved_addrs_${address}`) || "[]")); }
    catch { setSavedAddresses([]); }
    try { setWatchedPortfolios(JSON.parse(localStorage.getItem(`lv_watched_portfolios_${address}`) || "[]")); }
    catch { setWatchedPortfolios([]); }
  }, [address]);

  const addWatchedPortfolio = useCallback((label, addr) => {
    if (!address) return;
    setWatchedPortfolios((prev) => {
      const updated = [...prev, { label, address: addr }];
      try { localStorage.setItem(`lv_watched_portfolios_${address}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [address]);

  const removeWatchedPortfolio = useCallback((addr) => {
    if (!address) return;
    setWatchedPortfolios((prev) => {
      const updated = prev.filter((a) => a.address !== addr);
      try { localStorage.setItem(`lv_watched_portfolios_${address}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
    setActiveAllocTab((t) => (t === addr ? "mine" : t));
  }, [address]);

  /* ——— viewed (non-own) portfolio: fetch on tab switch ——— */
  useEffect(() => {
    if (activeAllocTab === "mine") { setViewedHoldings(null); return; }
    let cancelled = false;
    api.holdings(activeAllocTab).then((d) => { if (!cancelled) setViewedHoldings(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeAllocTab]);

  const viewedPortfolio = useMemo(() => {
    if (activeAllocTab === "mine") return portfolio;
    return registry && viewedHoldings ? derivePortfolio(viewedHoldings, prices, registry, { yieldMode: false }) : null;
  }, [activeAllocTab, portfolio, registry, viewedHoldings, prices]);

  /* ——— Kamino loans: full obligation detail, not just deposits — powers
     both the Brokerage donut merge below (deposited collateral leaves the
     wallet's SPL balance, so without merging it back in a borrow makes that
     position's value look wrong) and the dashboard's own Borrow/Lend
     product tab. ——— */
  const [kaminoLoans, setKaminoLoans] = useState([]);
  const viewedKaminoAddr = activeAllocTab === "mine" ? address : activeAllocTab;
  // Callable directly (not just effect-driven) so a repay/withdraw done
  // from the dashboard's Borrow tab can refresh immediately rather than
  // waiting up to one 20s poll interval.
  const refreshKaminoLoans = useCallback(async () => {
    if (!viewedKaminoAddr) { setKaminoLoans([]); return; }
    try {
      const obligations = await api.kaminoObligations(viewedKaminoAddr);
      const pubkeys = (obligations || []).map((o) => o.obligationAddress).filter(Boolean);
      const loans = await Promise.all(pubkeys.map((pk) => api.kaminoLoan(pk).catch(() => null)));
      setKaminoLoans(stripKaminoDust(loans.filter(Boolean)));
    } catch { setKaminoLoans([]); }
  }, [viewedKaminoAddr]);
  useEffect(() => {
    void refreshKaminoLoans();
    const h = setInterval(refreshKaminoLoans, 20_000);
    return () => clearInterval(h);
  }, [refreshKaminoLoans]);

  // Reserves + signing for repay/withdraw directly from the dashboard's
  // Borrow tab — same signWithWallet one-liner BorrowApp.jsx uses, built
  // from this file's own existing Solana wallet/signTransaction.
  const { reserves: kaminoReserves } = useKaminoReserves();
  const signKaminoTx = async (tx) => {
    if (wallet?.signTransaction) return wallet.signTransaction(tx);
    return signTransaction({ transaction: tx, wallet });
  };

  const kaminoCollateralDeposits = useMemo(
    () => kaminoLoans.flatMap((l) => l.loanInfo?.collateral?.deposits ?? []),
    [kaminoLoans]
  );
  const kaminoDebtBorrows = useMemo(
    () => kaminoLoans.flatMap((l) => l.loanInfo?.debt?.borrows ?? []),
    [kaminoLoans]
  );

  const displayPortfolio = useMemo(
    () => mergePortfolioCollateral(viewedPortfolio, kaminoCollateralDeposits),
    [viewedPortfolio, kaminoCollateralDeposits]
  );

  // The logged-in user's own total, Kamino collateral included — used
  // anywhere on the dashboard that isn't the Brokerage tab's watched-
  // portfolio viewer (which can be showing someone else's wallet). Falls
  // back to the raw wallet-only total on the rare tick where the "mine" tab
  // isn't active, since kaminoCollateralDeposits is scoped to whichever
  // address is currently being viewed there.
  const myPortfolioTotal = activeAllocTab === "mine" ? (displayPortfolio?.total ?? 0) : (portfolio?.total ?? 0);

  /* ——— Perpetual Futures dashboard tab: notional exposure per coin, across
     both the crypto and equities (xyz) dexs. Read-only — no signing. ——— */
  const perpsPositions = useMemo(() => [
    ...cryptoPerps.positions.map((p) => ({ ...p, dex: "crypto" })),
    ...equityPerps.positions.map((p) => ({ ...p, dex: "equity" })),
  ], [cryptoPerps.positions, equityPerps.positions]);
  const perpsAccountValue = (cryptoPerps.accountValue || 0) + (equityPerps.accountValue || 0);
  const perpsPnl = perpsPositions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const perpsRows = useMemo(() => perpsPositions.map((p) => ({
    symbol: p.coin, name: `${p.coin} ${p.side === "long" ? "Long" : "Short"} ${p.leverage}x`,
    value: Math.abs(p.size * p.markPx), price: p.markPx, uiAmount: p.size,
  })), [perpsPositions]);
  const perpsNotionalTotal = perpsRows.reduce((s, r) => s + r.value, 0);

  /* ——— Borrow/Lend dashboard tab: collateral posted per asset + blended
     LTV, derived from the same kaminoLoans fetched above. ——— */
  const borrowRows = useMemo(() => {
    const byMint = new Map();
    for (const d of kaminoCollateralDeposits) {
      const usdVal = Number(d.tokenValue) || 0;
      const prev = byMint.get(d.tokenMint);
      if (prev) prev.value += usdVal;
      else byMint.set(d.tokenMint, { symbol: d.tokenName, name: d.tokenName, value: usdVal, price: Number(d.tokenPrice) || 0 });
    }
    return [...byMint.values()];
  }, [kaminoCollateralDeposits]);
  const borrowCollateralTotal = borrowRows.reduce((s, r) => s + r.value, 0);
  const borrowDebtTotal = kaminoDebtBorrows.reduce((s, d) => s + (Number(d.tokenValue) || 0), 0);
  const borrowBlendedLtv = borrowCollateralTotal > 0 ? (borrowDebtTotal / borrowCollateralTotal) * 100 : 0;

  useEffect(() => { if (dashProduct !== "brokerage") setStatsFlipped(false); }, [dashProduct]);

  const addSavedAddress = useCallback((label, addr) => {
    if (!address) return;
    setSavedAddresses((prev) => {
      const updated = [...prev, { label, address: addr }];
      try { localStorage.setItem(`lv_saved_addrs_${address}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [address]);

  const removeSavedAddress = useCallback((addr) => {
    if (!address) return;
    setSavedAddresses((prev) => {
      const updated = prev.filter((a) => a.address !== addr);
      try { localStorage.setItem(`lv_saved_addrs_${address}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [address]);

  const getTelegramLinkCode = useCallback(async () => {
    if (!address) return;
    setTelegramCodeBusy(true);
    setTelegramCodeErr(null);
    try {
      const result = await api.telegramLinkCode(address);
      setTelegramCode(result);
    } catch (e) {
      setTelegramCodeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTelegramCodeBusy(false);
    }
  }, [address]);

  // Delegation is a separate, explicit consent step from linking a Telegram
  // identity — granting the server standing signing rights over this wallet
  // (via Privy's Wallet API) is a bigger deal than just linking an account,
  // and the user should see it as such rather than have it bundled silently.
  const toggleBotTrading = useCallback(async (on) => {
    if (!address) return;
    setBotTradingBusy(true);
    setBotTradingErr(null);
    try {
      if (on) {
        await addSessionSigners({ address, signers: [{ signerId: BOT_SESSION_SIGNER_ID }] });
      } else {
        await removeSessionSigners({ address });
      }
      localStorage.setItem("lv_bot_trading", String(on));
      setBotTradingEnabled(on);
    } catch (e) {
      setBotTradingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBotTradingBusy(false);
    }
  }, [address, addSessionSigners, removeSessionSigners]);

  const toggleDiscoverable = useCallback(async (on) => {
    setDiscoverableBusy(true);
    setDiscoverableErr(null);
    try {
      await api.setDiscoverable(on);
      localStorage.setItem("lv_discoverable", String(on));
      setDiscoverableState(on);
    } catch (e) {
      setDiscoverableErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscoverableBusy(false);
    }
  }, []);

  const appendTxHistory = useCallback((records) => {
    if (!address) return;
    const key = `lv_txns_${address}`;
    setTxHistory((prev) => {
      const updated = [...records, ...prev].slice(0, 500);
      localStorage.setItem(key, JSON.stringify(updated));
      return updated;
    });
  }, [address]);

  /* ——— portfolio history: snapshot whenever total value changes ——— */
  useEffect(() => {
    if (!address || !portfolio) return;
    const key = `lv_hist_${address}`;
    const now = Date.now();
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.v - myPortfolioTotal) < 0.01 && now - last.ts < 60000) return prev;
      const next = [...prev, { ts: now, v: myPortfolioTotal }].slice(-2000);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [myPortfolioTotal, portfolio, address]);

  /* ——— sign helper: Privy embedded wallet ——— */
  const signWithWallet = useCallback(async (tx) => {
    if (wallet?.signTransaction) return wallet.signTransaction(tx);
    return signTransaction({ transaction: tx, wallet });
  }, [wallet, signTransaction]);

  /* ——— USDT deposit → USDC auto-convert, only after explicit confirmation ——— */
  const confirmUsdtConvert = async () => {
    if (!usdtToken || !registry) return;
    setUsdtSwap({ busy: true, status: null, error: null });
    try {
      const result = await executeSwap({
        inputMint: USDT_MINT,
        outputMint: registry.USDC.mint,
        amount: usdtToken.amount, // raw atomic units straight from holdings — never reconstructed from uiAmount
        taker: address,
        signWithWallet,
        onStatus: (s) => setUsdtSwap((p) => ({ ...p, status: s })),
      });
      if (result.status && result.status !== "Success") throw new Error(result.error || `swap failed (${result.status})`);
      setUsdtHandledAmount(usdtToken.uiAmount || 0);
      setUsdtModalOpen(false);
      setUsdtSwap({ busy: false, status: null, error: null });
      await refreshHoldings();
    } catch (e) {
      setUsdtSwap({ busy: false, status: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const dismissUsdtModal = () => {
    setUsdtHandledAmount(usdtToken?.uiAmount || 0);
    setUsdtModalOpen(false);
    setUsdtSwap({ busy: false, status: null, error: null });
  };

  /* ——— Yield mode toggle: swap all USDC↔USDY ——— */
  const handleYieldMode = async (on) => {
    localStorage.setItem("lv_yield_mode", String(on));
    setYieldMode(on);
    if (busy.current) return;
    const h = await api.holdings(address);
    if (on) {
      const usdcBal = h.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;
      if (usdcBal < 1) return;
      const amount = Math.floor(usdcBal * 0.995 * 10 ** registry.USDC.decimals);
      if (amount <= 0) return;
      busy.current = true;
      setLegs([{ symbol: "USDY", side: "buy", usd: usdcBal, inputMint: registry.USDC.mint, outputMint: registry.USDY.mint, amount, status: "queued", sig: null }]);
      setView("execute");
      const setLeg = (patch) => setLegs((L) => [{ ...L[0], ...patch }]);
      try {
        const result = await executeSwap({ inputMint: registry.USDC.mint, outputMint: registry.USDY.mint, amount, taker: address, signWithWallet, onStatus: (s) => setLeg({ status: s }) });
        setLeg({ status: "confirmed", sig: result.signature });
      } catch (e) {
        setLeg({ status: "failed", err: e.message });
      } finally {
        busy.current = false;
        await refreshHoldings();
      }
    } else {
      const usdyToken = registry.USDY ? h.tokens?.find((t) => t.mint === registry.USDY.mint) : null;
      const usdyAtoms = Number(usdyToken?.amount || 0);
      if (usdyAtoms <= 0) return;
      const usdyUsd = (usdyToken?.uiAmount || 0) * (prices[registry.USDY.mint] || 1);
      busy.current = true;
      setLegs([{ symbol: "USDY", side: "sell", usd: usdyUsd, inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, status: "queued", sig: null }]);
      setView("execute");
      const setLeg = (patch) => setLegs((L) => [{ ...L[0], ...patch }]);
      try {
        const result = await executeSwap({ inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, taker: address, signWithWallet, onStatus: (s) => setLeg({ status: s }) });
        setLeg({ status: "confirmed", sig: result.signature });
      } catch (e) {
        setLeg({ status: "failed", err: e.message });
      } finally {
        busy.current = false;
        await refreshHoldings();
      }
    }
  };

  /* ——— USDC withdrawal ——— */
  const runWithdraw = async ({ to, usd: usdAmt, amount, symbol = "USDC", mint, decimals = 6 }) => {
    if (busy.current) return;
    busy.current = true;
    const leg = { side: "send", symbol, usd: usdAmt, to, status: "queued", sig: null };
    setLegs([leg]);
    setView("execute");
    setError("");
    const setLeg = (patch) => setLegs((L) => [{ ...L[0], ...patch }]);
    try {
      const result = await executeWithdraw({ from: address, to, amount, mint, decimals, signWithWallet,
        onStatus: (s) => setLeg({ status: s }) });
      setLeg({ status: "confirmed", sig: result.signature });
      appendTxHistory([{
        id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "withdrawal", symbol, usd: usdAmt, to,
        signature: result.signature, status: "confirmed", timestamp: Date.now(),
      }]);
    } catch (e) {
      setLeg({ status: "failed", err: e.message });
    } finally {
      busy.current = false;
      setWithdrawalProposal(null);
      setWithdrawOpen(false);
      await refreshHoldings();
    }
  };

  /* ——— prompt → allocations or financial Q&A ——— */
  const SOLANA_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  const SEND_RE = /\b(withdraw|transfer)\b|\bsend\b.*\bto\b/i;
  // The search bar's primary job is executing trades, not answering
  // questions — Q&A is a fallback for prompts with no plausible trade
  // intent, not the default for anything phrased politely or ending in "?".
  // Confirmed as a real gap: "Can you make my portfolio a combination of
  // all of the FAANG companies?" matched none of the old trade verbs
  // (sell/buy/rebalance/...) so it fell through to Q&A purely because it
  // started with "Can " and ended in "?", even though it's unambiguously a
  // portfolio-construction command. Broadened to cover the actual verbs
  // people use to describe building/changing a portfolio, not just
  // liquidating one.
  const TRADE_RE = /\b(sell|buy|rebalance|liquidate|invest|trim|remove|swap|for cash|go to cash|make|build|create|compose|allocate|diversify|combine|combination|convert|construct|split|distribute|put (me|it|my \w+) (in|into)|switch (me|it|my \w+) to|shift (me|it|my \w+) to|turn (it|my \w+) into|set (my|the) portfolio|change my portfolio|hold only)\b/i;
  const runPrompt = async (text, isRebalance) => {
    const addrMatch = text.match(SOLANA_ADDR_RE);
    const isSend = SEND_RE.test(text) && addrMatch;
    const hasTradeIntent = TRADE_RE.test(text);
    const QUESTION_START_RE = /^(what|how|why|when|who|which|tell me|explain|is |are |does |should |can |will |show me|analyze|compare|what's|how's)/i;
    const isQuestion = !hasTradeIntent && (text.includes("?") || QUESTION_START_RE.test(text.trim()));

    if (isQuestion) {
      setThinking(true); setError(""); setAnswer(null);
      try {
        const result = await api.ask(text);
        setAnswer({ text: result.answer, sources: result.sources || [], mentionedSymbols: result.mentionedSymbols || [] });
      } catch (e) {
        setError(e.message);
      } finally {
        setThinking(false);
      }
      return;
    }

    if (isSend && hasTradeIntent) {
      // Compound command: trade instruction + withdraw-to-address
      const to = addrMatch[0];
      const addrPos = text.indexOf(to);
      const beforeAddr = text.slice(0, addrPos);
      // Strip the "and then withdraw/send/transfer to" connector to isolate the trade part
      const tradePart = beforeAddr
        .replace(/\s*(,\s*)?(and\s+)?(then\s+)?(withdraw|transfer|send)(\s+to)?\s*$/i, "")
        .trim() || text;

      setThinking(true); setError("");
      try {
        const current = isRebalance
          ? portfolio.rows.map((r) => ({ symbol: r.symbol, weight: r.weight }))
          : undefined;
        const result = await api.parse(tradePart, current, portfolio?.total);
        if (isRebalance) {
          const { trades, maxSkippedDelta } = planTrades({ allocations: result.allocations, portfolio, prices, registry });
          setProposal({ ...result, trades, maxSkippedDelta, pendingWithdrawal: { to } });
        } else {
          setPlan({ ...result, pendingWithdrawal: { to } });
          setView("weights");
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setThinking(false);
      }
      return;
    }

    if (isSend) {
      // Pure withdrawal — detect token symbol, fall back to USDC
      const to = addrMatch[0];
      const beforeAddr = text.slice(0, text.indexOf(to));

      // Find first registry symbol mentioned (longest match first to avoid prefix collisions)
      const symbolsByLength = Object.keys(registry).sort((a, b) => b.length - a.length);
      const foundSymbol = symbolsByLength.find((sym) =>
        new RegExp(`\\b${sym}\\b`, "i").test(text)
      ) || "USDC";

      const tok = registry[foundSymbol];
      const isStable = foundSymbol === "USDC" || foundSymbol === "USDY";
      const decimals = tok?.decimals ?? (isStable ? 6 : 8);
      const mint = tok?.mint;

      // Find holding — for xStocks look in portfolio rows, for stables use cash balance
      let maxQty;
      let rawAmount = null; // exact on-chain atomic balance, when available — see note below
      if (foundSymbol === "USDC") {
        maxQty = portfolio?.cash ?? 0;
      } else if (foundSymbol === "USDY") {
        maxQty = portfolio?.usdyAmount ?? 0;
      } else {
        const row = portfolio?.rows?.find((r) => r.symbol === foundSymbol);
        maxQty = row?.uiAmount ?? 0;
        rawAmount = row?.amount ?? null;
      }

      if (maxQty <= 0) {
        setError(`No ${foundSymbol} balance to send.`);
        return;
      }

      const nums = beforeAddr.match(/\d+(?:\.\d+)?/g);
      const parsed = nums ? parseFloat(nums[nums.length - 1]) : null;
      const qty = (parsed !== null && parsed > 0 && parsed <= maxQty) ? parsed : maxQty;
      // Derive atoms from the real on-chain balance (rawAmount), never from
      // qty × 10**decimals — some xStocks mints carry Token-2022's
      // scaled-UI-amount extension (used to represent a stock split), which
      // makes uiAmount a *display* value that no longer round-trips back to
      // atoms via decimals alone.
      const amount = rawAmount != null
        ? (qty >= maxQty ? Number(rawAmount) : Math.floor((qty / maxQty) * Number(rawAmount)))
        : Math.floor(qty * 10 ** decimals);
      if (amount <= 0) { setError(`No ${foundSymbol} balance to send.`); return; }

      const usdVal = isStable ? qty : qty * (prices[mint] || 0);
      setWithdrawalProposal({ to, qty, usd: usdVal, amount, symbol: foundSymbol, mint, decimals });
      setRebalPrompt("");
      return;
    }

    setThinking(true); setError("");
    try {
      const current = isRebalance
        ? portfolio.rows.map((r) => ({ symbol: r.symbol, weight: r.weight }))
        : undefined;
      const result = await api.parse(text, current, portfolio?.total);
      if (isRebalance) {
        const { trades, maxSkippedDelta } = planTrades({ allocations: result.allocations, portfolio, prices, registry });
        setProposal({ ...result, trades, maxSkippedDelta });
        setAnswer(null);
      } else {
        setPlan(result);
        setView("weights");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setThinking(false);
    }
  };

  /* ——— execute a list of trades sequentially, for real ——— */
  const runTrades = async (trades, { afterWithdrawTo = null, groupLabel = "Rebalance" } = {}) => {
    if (busy.current) return;
    busy.current = true;
    setLegs(trades.map((t) => ({ ...t, status: "queued", sig: null })));
    setView("execute");
    setError("");
    const groupId = `grp_${Date.now()}`;
    let totalLegs = trades.length;
    try {
      const firstBuyIdx = trades.findIndex((t) => t.side === "buy");
      const splitIdx = firstBuyIdx === -1 ? trades.length : firstBuyIdx;

      // Phase 1: sells
      for (let i = 0; i < splitIdx; i++) {
        const t = trades[i];
        const setLeg = (patch) =>
          setLegs((L) => L.map((l, j) => (j === i ? { ...l, ...patch } : l)));
        try {
          const result = await executeSwap({
            inputMint: t.inputMint, outputMint: t.outputMint,
            amount: t.amount, taker: address, signWithWallet,
            onStatus: (s) => setLeg({ status: s }),
          });
          setLeg({ status: "confirmed", sig: result.signature });
          appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: t.side, symbol: t.symbol, usd: t.usd, signature: result.signature, status: "confirmed", timestamp: Date.now() }]);
        } catch (e) {
          setLeg({ status: "failed", err: e.message });
          appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: t.side, symbol: t.symbol, usd: t.usd, signature: null, status: "failed", timestamp: Date.now() }]);
        }
        await refreshHoldings();
      }

      // Phase 2: buys — re-read actual USDC balance so slippage on sells doesn't overshoot
      if (splitIdx < trades.length) {
        let h = await api.holdings(address);
        let usdcBal = h.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;
        const totalBuyUsd = trades.slice(splitIdx).reduce((s, t) => s + (t.usd || 0), 0);

        // Phase 2a: yieldMode — pre-convert USDY → USDC if insufficient USDC for buys
        if (yieldMode && registry.USDY && usdcBal < totalBuyUsd * 0.9) {
          const usdyToken = h.tokens?.find((t) => t.mint === registry.USDY.mint);
          const usdyAtoms = Number(usdyToken?.amount || 0);
          if (usdyAtoms > 0) {
            const preIdx = totalLegs++;
            const usdyUsd = (usdyToken?.uiAmount || 0) * (prices[registry.USDY.mint] || 1);
            setLegs((prev) => [...prev, {
              symbol: "USDY", side: "sell", usd: usdyUsd,
              inputMint: registry.USDY.mint, outputMint: registry.USDC.mint,
              amount: usdyAtoms, status: "queued", sig: null,
            }]);
            const setPre = (patch) => setLegs((L) => L.map((l, j) => j === preIdx ? { ...l, ...patch } : l));
            try {
              const result = await executeSwap({
                inputMint: registry.USDY.mint, outputMint: registry.USDC.mint,
                amount: usdyAtoms, taker: address, signWithWallet,
                onStatus: (s) => setPre({ status: s }),
              });
              setPre({ status: "confirmed", sig: result.signature });
              appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: "sell", symbol: "USDY", usd: usdyUsd, signature: result.signature, status: "confirmed", timestamp: Date.now() }]);
              const h2 = await api.holdings(address);
              usdcBal = h2.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;
            } catch (e) {
              setPre({ status: "failed", err: e.message });
            }
          }
        }

        for (let i = splitIdx; i < trades.length; i++) {
          const t = trades[i];
          const setLeg = (patch) =>
            setLegs((L) => L.map((l, j) => (j === i ? { ...l, ...patch } : l)));
          // Scale each buy proportionally to what's actually available (99.5% to leave fee buffer)
          const amount = totalBuyUsd > 0
            ? Math.floor((t.usd / totalBuyUsd) * usdcBal * 0.995 * 10 ** registry.USDC.decimals)
            : t.amount;
          try {
            const result = await executeSwap({
              inputMint: t.inputMint, outputMint: t.outputMint,
              amount, taker: address, signWithWallet,
              onStatus: (s) => setLeg({ status: s }),
            });
            setLeg({ status: "confirmed", sig: result.signature });
            appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: t.side, symbol: t.symbol, usd: t.usd, signature: result.signature, status: "confirmed", timestamp: Date.now() }]);
          } catch (e) {
            setLeg({ status: "failed", err: e.message });
            appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: t.side, symbol: t.symbol, usd: t.usd, signature: null, status: "failed", timestamp: Date.now() }]);
          }
          await refreshHoldings();
        }
      }

      // Phase 3: yieldMode — sweep remaining USDC → USDY (skip if we're about to withdraw)
      if (yieldMode && registry.USDY && !afterWithdrawTo) {
        const hFinal = await api.holdings(address);
        const usdcBal = hFinal.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;
        if (usdcBal >= 1) {
          const sweepAmount = Math.floor(usdcBal * 0.995 * 10 ** registry.USDC.decimals);
          if (sweepAmount > 0) {
            const sweepIdx = totalLegs++;
            setLegs((prev) => [...prev, {
              symbol: "USDY", side: "buy", usd: usdcBal,
              inputMint: registry.USDC.mint, outputMint: registry.USDY.mint,
              amount: sweepAmount, status: "queued", sig: null,
            }]);
            const setSweep = (patch) => setLegs((L) => L.map((l, j) => j === sweepIdx ? { ...l, ...patch } : l));
            try {
              const result = await executeSwap({
                inputMint: registry.USDC.mint, outputMint: registry.USDY.mint,
                amount: sweepAmount, taker: address, signWithWallet,
                onStatus: (s) => setSweep({ status: s }),
              });
              setSweep({ status: "confirmed", sig: result.signature });
              appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, groupId, groupLabel, type: "swap", side: "buy", symbol: "USDY", usd: usdcBal, signature: result.signature, status: "confirmed", timestamp: Date.now() }]);
            } catch (e) {
              setSweep({ status: "failed", err: e.message });
            }
            await refreshHoldings();
          }
        }
      }

      // Phase 4: post-trade withdrawal (compound command)
      if (afterWithdrawTo) {
        // If yieldMode had swept USDY in, convert it back to USDC first
        if (yieldMode && registry.USDY) {
          const hY = await api.holdings(address);
          const usdyToken = hY.tokens?.find((t) => t.mint === registry.USDY.mint);
          const usdyAtoms = Number(usdyToken?.amount || 0);
          if (usdyAtoms > 0) {
            const convIdx = totalLegs++;
            const usdyUsd = (usdyToken?.uiAmount || 0) * (prices[registry.USDY.mint] || 1);
            setLegs((prev) => [...prev, { symbol: "USDY", side: "sell", usd: usdyUsd, inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, status: "queued", sig: null }]);
            const setConv = (patch) => setLegs((L) => L.map((l, j) => j === convIdx ? { ...l, ...patch } : l));
            try {
              const result = await executeSwap({ inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, taker: address, signWithWallet, onStatus: (s) => setConv({ status: s }) });
              setConv({ status: "confirmed", sig: result.signature });
            } catch (e) {
              setConv({ status: "failed", err: e.message });
            }
            await refreshHoldings();
          }
        }
        const hW = await api.holdings(address);
        const usdcBal = hW.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;
        if (usdcBal >= 0.25) {
          const usdcAmount = Math.floor(usdcBal * 10 ** 6);
          const wIdx = totalLegs++;
          setLegs((prev) => [...prev, { side: "send", symbol: "USDC", usd: usdcBal, to: afterWithdrawTo, amount: usdcAmount, status: "queued", sig: null }]);
          const setW = (patch) => setLegs((L) => L.map((l, j) => j === wIdx ? { ...l, ...patch } : l));
          try {
            const result = await executeWithdraw({ from: address, to: afterWithdrawTo, amount: usdcAmount, signWithWallet, onStatus: (s) => setW({ status: s }) });
            setW({ status: "confirmed", sig: result.signature });
            appendTxHistory([{ id: `txn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, type: "withdrawal", symbol: "USDC", usd: usdcBal, to: afterWithdrawTo, signature: result.signature, status: "confirmed", timestamp: Date.now() }]);
          } catch (e) {
            setW({ status: "failed", err: e.message });
          }
          await refreshHoldings();
        }
      }
    } finally {
      busy.current = false;
      setProposal(null); setRebalPrompt(""); setPlan(null);
      await refreshHoldings();
    }
  };

  const executeBuild = async () => {
    const h = await api.holdings(address);
    const usdcBal = h.tokens?.find((t) => t.mint === registry.USDC.mint)?.uiAmount || 0;

    // In yieldMode, USDY counts as investable cash — convert it first
    const usdyToken = yieldMode && registry.USDY ? h.tokens?.find((t) => t.mint === registry.USDY.mint) : null;
    const usdyAtoms = Number(usdyToken?.amount || 0);
    const usdyUsd = usdyToken ? (usdyToken.uiAmount || 0) * (prices[registry.USDY.mint] || 1) : 0;

    const totalCash = usdcBal + usdyUsd;
    const investable = (totalCash * investPct) / 100 * 0.995;
    const weightSum = plan.allocations.reduce((s, a) => s + (+a.weight || 0), 0) || 100;
    const buyTrades = plan.allocations
      .map((a) => {
        const tok = registry[a.symbol];
        const usdAmt = (a.weight / weightSum) * investable;
        return {
          symbol: a.symbol, side: "buy", usd: usdAmt,
          inputMint: registry.USDC.mint, outputMint: tok.mint,
          amount: Math.floor(usdAmt * 10 ** registry.USDC.decimals),
        };
      })
      .filter((t) => t.amount > 0);

    const trades = [];
    if (yieldMode && usdyAtoms > 0) {
      trades.push({ symbol: "USDY", side: "sell", usd: usdyUsd, inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms });
    }
    trades.push(...buyTrades);
    runTrades(trades, { afterWithdrawTo: plan.pendingWithdrawal?.to || null });
  };

  /* ——— weights editing ——— */
  const setWeight = (symbol, w) =>
    setPlan((p) => ({ ...p, allocations: p.allocations.map((a) => (a.symbol === symbol ? { ...a, weight: w } : a)) }));
  const removeSymbol = (symbol) =>
    setPlan((p) => ({ ...p, allocations: p.allocations.filter((a) => a.symbol !== symbol) }));
  const equalize = () =>
    setPlan((p) => {
      const w = +(100 / p.allocations.length).toFixed(2);
      return { ...p, allocations: p.allocations.map((a) => ({ ...a, weight: w })) };
    });
  const weightSum = plan ? plan.allocations.reduce((a, x) => a + (+x.weight || 0), 0) : 0;

  // Derived from the name rather than a hardcoded symbol list — every ETF in
  // the registry has "ETF" in its name (VOOx "Vanguard S&P 500 ETF", XLEx
  // "Energy Select Sector SPDR ETF", etc.), so this self-maintains as new
  // xStocks are added instead of silently misclassifying them as "Stock".
  const assetCategory = (sym) =>
    sym === "USDY" ? "Yield" : sym === "BTC" ? "Crypto" : sym === "EURC" ? "Currency"
    : registry?.[sym]?.name?.includes("ETF") ? "ETF" : "Stock";
  const fmtQty = (n) => {
    const v = n || 0;
    if (v === 0) return "0";
    if (v >= 100) return v.toFixed(2);
    if (v >= 1)   return v.toFixed(4);
    return v.toFixed(6);
  };

  // Round DOWN to a fixed number of decimals, never up — used anywhere a
  // balance is displayed or turned into a suggested withdrawal amount.
  // toFixed() rounds to nearest, so it can show (or prefill) a number
  // slightly larger than the wallet's true on-chain balance, which then
  // fails on-chain with "insufficient funds" for a transfer that looked
  // valid in the UI.
  const floorTo = (n, places) => {
    const f = 10 ** places;
    return Math.floor((n || 0) * f) / f;
  };

  const copy = () => {
    navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  const toggleHideDust = (on) => {
    localStorage.setItem("lv_hide_dust", String(on));
    setHideDustAmounts(on);
  };

  const loginMethod = user?.email ? "Email" : user?.google ? "Google" : "Wallet";
  const loginIdentity = user?.email?.address || user?.google?.email || short(address);
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const clearTxHistory = () => {
    if (!address) return;
    localStorage.removeItem(`lv_txns_${address}`);
    localStorage.removeItem(`lv_hist_${address}`);
    setTxHistory([]);
    setHistory([]);
  };

  /* ——————————— render ——————————— */
  const hasPositions = portfolio?.rows.length > 0;
  const hasCash = (portfolio?.cash || 0) >= 1;
  const DUST_HIDE_THRESHOLD = 1; // "Hide Dust Amounts" toggle hides anything under this
  const visibleRows = portfolio
    ? (hideDustAmounts ? portfolio.rows.filter((r) => r.value >= DUST_HIDE_THRESHOLD) : portfolio.rows)
    : [];
  const hiddenByToggle = portfolio && hideDustAmounts
    ? portfolio.rows.filter((r) => r.value < DUST_HIDE_THRESHOLD)
    : [];
  const screen =
    !ready || !registry ? "loading"
    : !authenticated ? "auth"
    : !address ? "wallet-pending"
    : view === "execute" ? "execute"
    : view === "weights" && plan ? "weights"
    : view === "build" ? "build"
    : view === "history" ? "history"
    : view === "perps" ? "perps"
    : view === "borrow" ? "borrow"
    : "dash";

  return (
    <div className="lv-root">
      <header className="lv-head">
        <div className="head-left">
          <div className="wordmark">
            <img className="wordmark-logo" src="/bonsai-icon.png" alt="" />
            Bonzai Trading
          </div>
        </div>
        {address && (
          <div className="head-right">
            {screen !== "perps" && (
              <button className="head-nav-btn" onClick={() => setView("perps")}>Perpetual Futures Markets</button>
            )}
            {screen !== "borrow" && (
              <button className="head-nav-btn" onClick={() => setView("borrow")}>Borrow / Lend Markets</button>
            )}
            <div className="profile-wrap" ref={profileRef}>
              <button className="head-nav-btn profile-btn" onClick={() => setProfileOpen((o) => !o)}>
                My Profile
                <svg className={`profile-chevron ${profileOpen ? "open" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <button className="profile-menu-item" onClick={() => { setProfileModal("account"); setProfileOpen(false); }}>My Account</button>
                  <button className="profile-menu-item" onClick={() => { setProfileModal("settings"); setProfileOpen(false); }}>Settings</button>
                  <button className="profile-menu-item" onClick={() => { setView("history"); setProfileOpen(false); }}>Transaction History</button>
                  <div className="profile-menu-divider" />
                  <button className="profile-menu-item danger" onClick={logout}>Sign Out</button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {wantsQaBypass && !qaBypassDone && address && (
        <div className="perps-notice">
          <p className="tiny muted">
            {qaBypassErr ? `QA bypass failed: ${qaBypassErr}` : "QA geo-bypass available for this session."}{" "}
            <button className="linkish" onClick={verifyQaBypass} disabled={qaBypassBusy}>
              {qaBypassBusy ? "Waiting for signature…" : "Verify QA access"}
            </button>
          </p>
        </div>
      )}

      {profileModal === "account" && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setProfileModal(null)}>
          <div className="modal-box card">
            <div className="answer-header">
              <p className="tiny label" style={{ margin: 0 }}>My Account</p>
              <button className="x" onClick={() => setProfileModal(null)}>×</button>
            </div>
            <div className="account-rows">
              <div className="account-row">
                <span className="tiny muted">Signed in with</span>
                <span className="mono">{loginMethod} · {loginIdentity}</span>
              </div>
              {memberSince && (
                <div className="account-row">
                  <span className="tiny muted">Member since</span>
                  <span className="mono">{memberSince}</span>
                </div>
              )}
              <div className="account-row">
                <span className="tiny muted">Wallet address</span>
                <span className="mono account-addr" onClick={copy} title="Click to copy">
                  {short(address)} {copied ? "✓" : ""}
                </span>
              </div>
              <div className="account-row">
                <span className="tiny muted">Network</span>
                <span className="mono">Solana Mainnet</span>
              </div>
              <div className="account-row">
                <span className="tiny muted">Gas fees</span>
                <span className="mono">{sponsored ? "Sponsored — no SOL required" : "Paid by you in SOL"}</span>
              </div>
              <div className="account-row">
                <span className="tiny muted">Portfolio value</span>
                <span className="mono">${usd(portfolio?.total || 0)}</span>
              </div>
            </div>
            <button className="btn ghost" style={{ width: "100%", marginTop: 18 }}
              onClick={() => { setProfileModal(null); setDepositOpen(true); }}>
              View deposit address / QR →
            </button>
          </div>
        </div>
      )}

      {profileModal === "settings" && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setProfileModal(null)}>
          <div className="modal-box card">
            <div className="answer-header">
              <p className="tiny label" style={{ margin: 0 }}>Settings</p>
              <button className="x" onClick={() => setProfileModal(null)}>×</button>
            </div>

            <div className="settings-row">
              <div>
                <p className="settings-row-title serif">Earn Yield On Idle Cash</p>
                <p className="tiny muted">Automatically hold spare USDC as USDY (~5% APY)</p>
              </div>
              <div className="seg-ctrl">
                <button className={`seg-btn ${!yieldMode ? "active" : ""}`} onClick={() => yieldMode && handleYieldMode(false)}>No</button>
                <button className={`seg-btn ${yieldMode ? "active" : ""}`} onClick={() => !yieldMode && handleYieldMode(true)}>Yes</button>
              </div>
            </div>

            <div className="settings-row">
              <div>
                <p className="settings-row-title serif">Hide Dust Amounts</p>
                <p className="tiny muted">Hide positions worth less than $1 in the table</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={hideDustAmounts} onChange={(e) => toggleHideDust(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
              </label>
            </div>

            <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ marginBottom: 10 }}>
                <p className="settings-row-title serif">Telegram Trading Bot</p>
                <p className="tiny muted">Trade by chatting — e.g. "sell my BTC for cash". Two separate steps: link your account, then explicitly enable trading.</p>
              </div>

              <div style={{ marginBottom: 14 }}>
                <p className="tiny muted" style={{ marginBottom: 6 }}>
                  1. Get a code, then message it to the bot on Telegram as <span className="mono">/link 123456</span>.
                </p>
                {telegramCode ? (
                  <div className="account-row">
                    <span className="mono">{telegramCode.code}</span>
                    <span className="tiny muted">expires in {Math.round(telegramCode.expiresIn / 60)} min</span>
                  </div>
                ) : (
                  <button className="btn ghost" disabled={telegramCodeBusy} onClick={getTelegramLinkCode}>
                    {telegramCodeBusy ? "Generating…" : "Get linking code"}
                  </button>
                )}
                {telegramCodeErr && <p className="tiny warn" style={{ marginTop: 4 }}>{telegramCodeErr}</p>}
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p className="tiny muted" style={{ marginBottom: 2 }}>
                      2. Enable Bot Trading — lets the bot sign trades for you (Privy still holds your keys; revocable anytime here).
                    </p>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={botTradingEnabled} disabled={botTradingBusy}
                      onChange={(e) => toggleBotTrading(e.target.checked)} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                  </label>
                </div>
                {botTradingErr && <p className="tiny warn" style={{ marginTop: 4 }}>{botTradingErr}</p>}
              </div>
            </div>

            <div className="settings-row">
              <div>
                <p className="settings-row-title serif">Discoverable by Email</p>
                <p className="tiny muted">Let other users find and view your portfolio by searching your email. Off by default — your holdings stay private until you enable this.</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={discoverable} disabled={discoverableBusy}
                  onChange={(e) => toggleDiscoverable(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
              </label>
            </div>
            {discoverableErr && <p className="tiny warn" style={{ marginTop: -8, marginBottom: 8 }}>{discoverableErr}</p>}

            <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ marginBottom: 10 }}>
                <p className="settings-row-title serif">Saved Addresses</p>
                <p className="tiny muted">Quick-select destinations when withdrawing</p>
              </div>
              {savedAddresses.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", marginBottom: 10 }}>
                  {savedAddresses.map((a) => (
                    <div key={a.address} className="account-row">
                      <span className="mono tiny">{a.label} <span className="muted">— {short(a.address)}</span></span>
                      <button className="x" onClick={() => removeSavedAddress(a.address)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input className="withdraw-input" style={{ flex: "0 0 90px" }} placeholder="Label"
                  value={newAddrLabel} onChange={(e) => setNewAddrLabel(e.target.value)} />
                <input className="withdraw-input mono" style={{ flex: 1 }} placeholder="Solana address"
                  value={newAddrValue} onChange={(e) => setNewAddrValue(e.target.value)} />
                <button className="btn ghost"
                  disabled={!newAddrLabel.trim() || !SOLANA_ADDRESS_RE.test(newAddrValue.trim()) || savedAddresses.some((a) => a.address === newAddrValue.trim())}
                  onClick={() => {
                    addSavedAddress(newAddrLabel.trim(), newAddrValue.trim());
                    setNewAddrLabel(""); setNewAddrValue("");
                  }}>
                  Save
                </button>
              </div>
              {newAddrValue && !SOLANA_ADDRESS_RE.test(newAddrValue.trim()) && (
                <p className="tiny warn" style={{ marginTop: 4 }}>Invalid Solana address</p>
              )}
            </div>

            <div className="settings-row settings-danger">
              <div>
                <p className="settings-row-title serif">Clear Transaction History</p>
                <p className="tiny muted">Removes locally stored history for this wallet. Doesn't affect on-chain data.</p>
              </div>
              {confirmClearHistory ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost" onClick={() => setConfirmClearHistory(false)}>Cancel</button>
                  <button className="btn primary" onClick={() => { clearTxHistory(); setConfirmClearHistory(false); }}>Confirm</button>
                </div>
              ) : (
                <button className="btn ghost" onClick={() => setConfirmClearHistory(true)}>Clear</button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && screen !== "build" && <p className="err tiny center">{error}</p>}

      {screen === "loading" && (
        <main className="loading-wrap">
          <div className="loading-dots"><span /><span /><span /></div>
        </main>
      )}

      {screen === "auth" && <LandingPage onLogin={login} />}

      {screen === "wallet-pending" && (
        <main className="loading-wrap">
          <div className="loading-dots"><span /><span /><span /></div>
        </main>
      )}

      {screen === "build" && (
        <main className="stage narrow">
          <p className="eyebrow">${usd(portfolio.cash, 0)} {yieldMode ? "Yield Cash" : "USDC"} ready to invest</p>
          <h2 className="display sm">What do you want to hold?</h2>
          <p className="lede">Name companies, indexes, even a rough thesis. Claude maps it to available xStocks.</p>
          <div className="prompt-wrap">
            <textarea className="prompt-box" rows={3}
              placeholder={'"A portfolio of Apple, Tesla, Nvidia, QQQ and SPY"'}
              value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <button className="btn primary" disabled={!prompt.trim() || thinking}
              onClick={() => runPrompt(prompt, false)}>
              {thinking ? "Reading your prompt…" : "Compose portfolio"}
            </button>
          </div>
          {error && <p className="err tiny">{error}</p>}
          <div className="universe">
            <p className="tiny label">Available today</p>
            <div className="uni-grid">
              {Object.values(registry).filter((t) => t.symbol !== "USDC").map((t) => (
                <button key={t.symbol} className="uni-chip"
                  onClick={() => setPrompt((p) => (p ? p.replace(/\.?$/, "") + ", " + t.name : t.name))}>
                  <span className="mono">{t.symbol}</span> {t.name}
                </button>
              ))}
            </div>
          </div>
          {(hasPositions || hasCash) && <button className="linkish" onClick={() => setView("auto")}>← Back to dashboard</button>}
        </main>
      )}

      {screen === "weights" && (
        <main className="stage narrow">
          <p className="eyebrow">Set your proportions</p>
          <h2 className="display sm">How much of each?</h2>
          {plan.summary && <p className="lede">{plan.summary}</p>}
          <div className="card">
            {plan.allocations.map((a) => (
              <div className="wrow" key={a.symbol}>
                <div className="wname">
                  <span className="serif">{registry[a.symbol]?.name}</span>
                  <span className="mono tiny muted"> {a.symbol}</span>
                </div>
                <input type="range" min="0" max="100" step="1" className="slider"
                  value={a.weight} onChange={(e) => setWeight(a.symbol, +e.target.value)} />
                <div className="wnum">
                  <input className="field num mono" type="number" min="0" max="100" step="0.5"
                    value={a.weight} onChange={(e) => setWeight(a.symbol, +e.target.value)} />
                  <span className="tiny muted">%</span>
                </div>
                <button className="x" onClick={() => removeSymbol(a.symbol)} title="Remove">×</button>
              </div>
            ))}
            <div className="wrow">
              <div className="wname"><span className="serif">Invest</span><span className="mono tiny muted"> of cash</span></div>
              <input type="range" min="1" max="100" step="1" className="slider"
                value={investPct} onChange={(e) => setInvestPct(+e.target.value)} />
              <div className="wnum"><span className="mono">{investPct}%</span></div>
              <span className="x" style={{ visibility: "hidden" }}>×</span>
            </div>
            <div className="wfoot">
              <button className="btn ghost" onClick={equalize}>Equal weights</button>
              <span className={`mono tiny ${Math.abs(weightSum - 100) < 0.5 ? "" : "warn"}`}>
                Total {weightSum.toFixed(1)}%
              </span>
              <button className="btn primary"
                disabled={Math.abs(weightSum - 100) > 0.5 || !plan.allocations.length}
                onClick={executeBuild}>
                Invest ${usd((portfolio.cash * investPct) / 100, 0)} →
              </button>
            </div>
          </div>
          <button className="linkish" onClick={() => setView("build")}>← Change the lineup</button>
        </main>
      )}

      {screen === "execute" && (
        <main className="stage narrow">
          <p className="eyebrow">Executing</p>
          <h2 className="display sm">Routing your swaps</h2>
          <div className="card card-pop exec-card">
            <div className="card-toprow">
              <p className="table-card-title">Transaction Progress</p>
              <span className="tiny muted mono">
                {legs.filter((l) => l.status === "confirmed").length} / {legs.length} confirmed
              </span>
            </div>
            {legs.map((l, i) => (
              <div className={`leg ${l.status}`} key={i}>
                <span className={`leg-icon-badge ${l.status}`}>
                  {l.status === "queued"    && "○"}
                  {l.status === "routing"   && "↻"}
                  {l.status === "signing"   && "◎"}
                  {l.status === "executing" && "↑"}
                  {l.status === "confirmed" && "✓"}
                  {l.status === "failed"    && "×"}
                </span>
                <span className="leg-route mono">
                  {l.side === "send" ? `${l.symbol || "USDC"} → ${short(l.to)}`
                    : l.side === "buy" ? `USDC → ${l.symbol}`
                    : `${l.symbol} → USDC`}
                </span>
                <span className="mono tiny muted">${usd(l.usd)}</span>
                <span className={`leg-status-badge ${l.status}`}>
                  {l.status === "queued"    && "Pending"}
                  {l.status === "routing"   && "Routing…"}
                  {l.status === "signing"   && "Sign in wallet…"}
                  {l.status === "executing" && "Broadcasting…"}
                  {l.status === "confirmed" && (
                    <a href={`https://solscan.io/tx/${l.sig}`} target="_blank" rel="noreferrer" className="leg-confirmed-link">
                      Confirmed ↗
                    </a>
                  )}
                  {l.status === "failed" && (l.err || "Failed")}
                </span>
              </div>
            ))}
          </div>
          {!busy.current && (
            <button className="btn primary" style={{ marginTop: 20, width: "100%" }}
              onClick={() => setView("auto")}>
              Back to dashboard →
            </button>
          )}
          <p className="tiny muted center" style={{ marginTop: 12 }}>
            {sponsored ? "Gas fees sponsored — no SOL required." : "Network fees paid in SOL from your wallet."}
          </p>
        </main>
      )}

      {screen === "history" && (
        <HistoryScreen txHistory={txHistory} onBack={() => setView("auto")} />
      )}

      {screen === "perps" && (
        <PerpsApp solanaAddress={address} solBalance={holdings?.sol ?? 0} usdcBalance={portfolio?.cashUsdc ?? 0} onBack={() => setView("auto")} />
      )}

      {screen === "borrow" && (
        <BorrowApp solanaAddress={address} solBalance={holdings?.sol ?? 0} portfolioRows={portfolio?.rows ?? []} onBack={() => setView("auto")} />
      )}

      {screen === "dash" && portfolio && (
        <main className="stage wide dash-wide">
          <section className="hero-row">
            <div>
              <p className="eyebrow">Total portfolio value</p>
              <h2 className="display value-serif">${usd(myPortfolioTotal)}</h2>
              <div className="yield-ctrl">
                <span className="yield-ctrl-label">Earn Yield On Idle Cash</span>
                <div className="seg-ctrl">
                  <button className={`seg-btn ${!yieldMode ? "active" : ""}`}
                    onClick={() => yieldMode && handleYieldMode(false)}>
                    No
                  </button>
                  <button className={`seg-btn ${yieldMode ? "active" : ""}`}
                    onClick={() => !yieldMode && handleYieldMode(true)}>
                    Yes
                  </button>
                </div>
              </div>
            </div>
            <div className="hero-prompt">
              <div className="hero-prompt-top">
                <p className="hero-prompt-label serif">What would you like to do?</p>
                <button className="hist-icon-btn" onClick={() => setView("history")} title="Transaction history">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span className="tiny">History</span>
                </button>
              </div>
              <div className="prompt-wrap row">
                <input className="prompt-box oneline"
                  placeholder={'"Go 50% SPY, trim Tesla" · "What are Apple\'s latest earnings?"'}
                  value={rebalPrompt} onChange={(e) => setRebalPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && rebalPrompt.trim() && !thinking && runPrompt(rebalPrompt, true)} />
                <button className="btn primary" disabled={!rebalPrompt.trim() || thinking}
                  onClick={() => runPrompt(rebalPrompt, true)}>
                  {thinking ? (rebalPrompt.includes("?") && !TRADE_RE.test(rebalPrompt) ? "Researching…" : "Thinking…") : "Go"}
                </button>
              </div>
              {error && <p className="err tiny">{error}</p>}
              <div className="hero-btns">
                <button className="btn ghost hero-action-btn" onClick={() => setDepositOpen(true)}>Deposit</button>
                <button className="btn ghost hero-action-btn" onClick={() => {
                  setWithdrawAsset(portfolio?.rows[0]?.symbol || "USDC");
                  setWithdrawAddress("");
                  setWithdrawAmountStr("");
                  setWithdrawToSaved("");
                  setWithdrawOpen(true);
                }}>Withdraw</button>
              </div>
            </div>
          </section>

          <div className="dash-tabs-row">
          <div className="dash-product-tabs">
            <button className={`dash-product-tab ${dashProduct === "brokerage" ? "active" : ""}`}
              onClick={() => setDashProduct("brokerage")}>
              Brokerage
            </button>
            <button className={`dash-product-tab ${dashProduct === "perps" ? "active" : ""}`}
              onClick={() => setDashProduct("perps")}>
              Perpetual Futures
            </button>
            <button className={`dash-product-tab ${dashProduct === "borrow" ? "active" : ""}`}
              onClick={() => setDashProduct("borrow")}>
              Borrow / Lend
            </button>
          </div>
          </div>{/* dash-tabs-row */}

          <div className="dash-grid">
          <div className="dash-main">

          {dashProduct === "brokerage" && (
          <div className="flip-scene">
            <div className={`flip-inner ${statsFlipped ? "flipped" : ""}`}>
              <div className="flip-face flip-front card card-pop">
                <div className="card-toprow">
                  <p className="table-card-title">Brokerage Account</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="stats-toggle-btn alloc-share-btn" onClick={() => setShareOpen(true)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                      </svg>
                      Share
                    </button>
                    <button className="stats-toggle-btn" onClick={() => setStatsFlipped(true)}>
                      Portfolio Stats →
                    </button>
                  </div>
                </div>

                <div className="alloc-tabs">
                  <button className={`alloc-tab ${activeAllocTab === "mine" ? "active" : ""}`}
                    onClick={() => setActiveAllocTab("mine")}>
                    Mine
                  </button>
                  {watchedPortfolios.map((w) => (
                    <button key={w.address} className={`alloc-tab ${activeAllocTab === w.address ? "active" : ""}`}
                      onClick={() => setActiveAllocTab(w.address)}>
                      {w.label}
                      <span className="alloc-tab-x" onClick={(e) => { e.stopPropagation(); removeWatchedPortfolio(w.address); }}>×</span>
                    </button>
                  ))}
                  <button className="alloc-tab alloc-tab-add" title="Watch another portfolio"
                    onClick={() => setAddPortfolioOpen(true)}>+</button>
                </div>

                {!viewedPortfolio ? (
                  <div className="loading-dots" style={{ margin: "24px 0" }}><span /><span /><span /></div>
                ) : (
                <>
                <Donut rows={displayPortfolio.rows} cash={displayPortfolio.cash} total={displayPortfolio.total} cashUsdy={displayPortfolio.cashUsdy} />
                {activeAllocTab !== "mine" && (
                  <p className="tiny muted" style={{ textAlign: "center", marginTop: 10 }}>
                    Viewing {watchedPortfolios.find((w) => w.address === activeAllocTab)?.label} — read only
                  </p>
                )}
                {activeAllocTab === "mine" && portfolio.total > 0 && (
                  <div className="alloc-actions">
                    {portfolio.rows.length >= 1 && (
                      <button className="btn ghost"
                        onClick={() => {
                          const n = portfolio.rows.length;
                          const weight = 100 / n;
                          const allocations = portfolio.rows.map((r) => ({ symbol: r.symbol, weight }));
                          const { trades, maxSkippedDelta } = planTrades({ allocations, portfolio, prices, registry });
                          setProposal({
                            summary: `Equal-weight rebalance — ${n} positions at ${weight.toFixed(1)}% each`,
                            allocations,
                            trades,
                            maxSkippedDelta,
                          });
                        }}>
                        Rebalance Portfolio
                      </button>
                    )}
                    <button className="btn ghost"
                      onClick={() => {
                        setCustomAllocs(portfolio.rows.map((r) => ({
                          symbol: r.symbol,
                          name: r.name,
                          weight: r.weight.toFixed(1),
                        })));
                        setCustomRebalanceOpen(true);
                      }}>
                      Custom Rebalance
                    </button>
                  </div>
                )}
                </>
                )}
              </div>
              <div className="flip-face flip-back card card-pop">
                <div className="card-toprow">
                  <p className="tiny label" style={{ margin: 0 }}>Performance</p>
                  <button className="stats-toggle-btn" onClick={() => setStatsFlipped(false)}>
                    ← Allocation
                  </button>
                </div>
                <PerformanceChart history={history} />
              </div>
            </div>
          </div>
          )}

          {dashProduct === "perps" && (
          <div className="card" style={{ marginBottom: 26 }}>
            <div className="card-toprow">
              <p className="table-card-title">Perpetual Futures Account</p>
            </div>
            {perpsRows.length === 0 ? (
              <p className="muted" style={{ margin: "24px 0" }}>No open perpetual futures positions.</p>
            ) : (
              <Donut rows={perpsRows} cash={0} total={perpsNotionalTotal} />
            )}
            <p className="tiny muted" style={{ textAlign: "center", marginTop: 10 }}>
              Account value ${usd(perpsAccountValue)} · Unrealized PnL {perpsPnl >= 0 ? "+" : ""}${usd(perpsPnl)}
            </p>
          </div>
          )}

          {dashProduct === "borrow" && (
          <div className="card" style={{ marginBottom: 26 }}>
            <div className="card-toprow">
              <p className="table-card-title">Borrow / Lend Account</p>
            </div>
            {borrowRows.length === 0 ? (
              <p className="muted" style={{ margin: "24px 0" }}>No collateral posted to Kamino yet.</p>
            ) : (
              <Donut rows={borrowRows} cash={0} total={borrowCollateralTotal} />
            )}
            <p className="tiny muted" style={{ textAlign: "center", marginTop: 10 }}>
              Collateral ${usd(borrowCollateralTotal)} · Borrowed ${usd(borrowDebtTotal)} · Blended LTV {borrowBlendedLtv.toFixed(1)}%
            </p>
            {kaminoLoans.length > 0 && (() => {
              // One tab per collateral ASSET, not per obligation — same
              // grouping as BorrowApp.jsx's Positions tab, since Kamino
              // pools every collateral type into one shared obligation
              // (one debt, one LTV) and each asset should still be
              // viewable/actionable independently.
              const assetTabs = kaminoLoans.flatMap((loan, li) => {
                const deposits = loan.loanInfo?.collateral?.deposits ?? [];
                const loanKey = loan.loanId ?? loan.obligation ?? li;
                if (deposits.length === 0) return [{ key: `${loanKey}`, loan, mint: null, label: `Position ${li + 1}` }];
                return deposits.map((d) => ({ key: `${loanKey}:${d.tokenMint}`, loan, mint: d.tokenMint, label: d.tokenName }));
              });
              const activeKey = assetTabs.some((t) => t.key === borrowDashTabKey) ? borrowDashTabKey : assetTabs[0].key;
              const active = assetTabs.find((t) => t.key === activeKey);
              return (
                <div style={{ marginTop: 20 }}>
                  <div className="borrow-position-tabs">
                    {assetTabs.map((t) => (
                      <button key={t.key} className={`borrow-position-tab ${t.key === activeKey ? "active" : ""}`}
                        onClick={() => setBorrowDashTabKey(t.key)}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <PositionCard key={active.key} loan={active.loan} focusMint={active.mint} reserves={kaminoReserves}
                    wallet={address} signWithWallet={signKaminoTx} onDone={refreshKaminoLoans} />
                </div>
              );
            })()}
          </div>
          )}

          {dashProduct === "brokerage" && (
          <section className="card table-card card-pop">
            <div className="card-toprow">
              <p className="table-card-title">Positions</p>
              <label className="dust-toggle">
                <span className="tiny muted">Hide Dust Amounts</span>
                <span className="switch">
                  <input type="checkbox" checked={hideDustAmounts} onChange={(e) => toggleHideDust(e.target.checked)} />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
              </label>
            </div>
            <div className="trow thead tiny label">
              <span>Asset</span>
              <span>Price / token</span>
              <span>Quantity</span>
              <span>Market value</span>
              <span>Allocation</span>
            </div>
            {visibleRows.map((r) => {
              const category = assetCategory(r.symbol);
              const clickable = category === "Stock" || category === "ETF" || category === "Crypto";
              return (
                <div className={`trow ${clickable ? "asset-row-clickable" : ""}`} key={r.symbol}
                  onClick={clickable ? () => setAssetInfoSymbol(r.symbol) : undefined}>
                  <span className="asset">
                    <span className="serif">{r.name}</span>
                    <span className="mono tiny muted">{r.symbol} · {category}</span>
                  </span>
                  <span className="mono">${usd(r.price)}</span>
                  <span className="mono">{fmtQty(r.uiAmount)}<span className="muted tiny"> {r.symbol}</span></span>
                  <span className="mono">${usd(r.value)}</span>
                  <span className="mono">{r.weight.toFixed(1)}<span className="muted tiny">%</span></span>
                </div>
              );
            })}
            {yieldMode && portfolio.usdyAmount > 0.5 && (
              <div className="trow cashrow yield-cash-row">
                <span className="asset">
                  <span className="serif">Yield Cash</span>
                  <span className="mono tiny muted">USDY · Yield · ~5% APY</span>
                </span>
                <span className="mono muted">${usd(prices[registry.USDY?.mint] || 1)}</span>
                <span className="mono">{fmtQty(portfolio.usdyAmount)}<span className="muted tiny"> USDY</span></span>
                <span className="mono">${usd(portfolio.cashUsdy)}</span>
                <span className="mono">
                  {portfolio.total > 0 ? ((portfolio.cashUsdy / portfolio.total) * 100).toFixed(1) : "—"}<span className="muted tiny">%</span>
                </span>
              </div>
            )}
            {(!yieldMode || portfolio.cashUsdc > 0.01) && (
              <div className="trow cashrow">
                <span className="asset">
                  <span className="serif">Cash</span>
                  <span className="mono tiny muted">USDC · Stablecoin</span>
                </span>
                <span className="mono muted">$1.00</span>
                <span className="mono">{usd(portfolio.cashUsdc ?? portfolio.cash)}<span className="muted tiny"> USDC</span></span>
                <span className="mono">${usd(portfolio.cashUsdc ?? portfolio.cash)}</span>
                <span className="mono">
                  {portfolio.total > 0 ? (((portfolio.cashUsdc ?? portfolio.cash) / portfolio.total) * 100).toFixed(1) : "—"}<span className="muted tiny">%</span>
                </span>
              </div>
            )}
            {portfolio.dustRows?.length > 0 && (
              <div className="trow dust-notice">
                <span style={{ gridColumn: "1/-1" }} className="tiny muted">
                  {portfolio.dustRows.length} dust position{portfolio.dustRows.length !== 1 ? "s" : ""} hidden
                  ({portfolio.dustRows.map((r) => r.symbol).join(", ")} · {"<"}$0.01)
                </span>
              </div>
            )}
            {hiddenByToggle.length > 0 && (
              <div className="trow dust-notice">
                <span style={{ gridColumn: "1/-1" }} className="tiny muted">
                  {hiddenByToggle.length} position{hiddenByToggle.length !== 1 ? "s" : ""} hidden by "Hide Dust Amounts"
                  ({hiddenByToggle.map((r) => r.symbol).join(", ")} · {"<"}$1)
                </span>
              </div>
            )}
          </section>
          )}

          {dashProduct === "perps" && (
          <section className="card table-card">
            <div className="card-toprow">
              <p className="table-card-title">Positions</p>
            </div>
            <div className="trow thead tiny label" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr" }}>
              <span>Asset</span>
              <span>Entry price</span>
              <span>Size</span>
              <span>Mark price</span>
              <span>Unrealized PnL</span>
              <span>Leverage</span>
              <span></span>
            </div>
            {perpsPositions.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0" }}>No open positions.</p>
            ) : perpsPositions.map((p) => (
              <div className="trow" key={`${p.dex}-${p.coin}`} style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr" }}>
                <span className="asset">
                  <span className="serif">{p.coin}</span>
                  <span className="mono tiny muted">{p.side === "long" ? "Long" : "Short"} · {p.dex === "equity" ? "Equities" : "Crypto"}</span>
                </span>
                <span className="mono">${usd(p.entryPx)}</span>
                <span className="mono">{p.size}</span>
                <span className="mono">${usd(p.markPx)}</span>
                <span className={`mono ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>{p.unrealizedPnl >= 0 ? "+" : ""}${usd(p.unrealizedPnl)}</span>
                <span className="mono">{p.leverage}x</span>
                <PerpsCloseCell p={p} hl={hl} user={evmAddress} tradingWallet={perpsWallet} />
              </div>
            ))}
          </section>
          )}

          {dashProduct === "borrow" && (
          <section className="card table-card">
            <div className="card-toprow">
              <p className="table-card-title">Positions</p>
            </div>
            <div className="trow thead tiny label" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
              <span>Asset</span>
              <span>Collateral</span>
              <span>Borrowed</span>
              <span>Current LTV</span>
              <span>Liquidation LTV</span>
            </div>
            {kaminoLoans.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0" }}>No open borrow positions.</p>
            ) : kaminoLoans.map((loan) => {
              const info = loan.loanInfo ?? {};
              const deposits = info.collateral?.deposits ?? [];
              const borrows = info.debt?.borrows ?? [];
              const collateralVal = deposits.reduce((s, d) => s + (Number(d.tokenValue) || 0), 0);
              const debtVal = borrows.reduce((s, d) => s + (Number(d.tokenValue) || 0), 0);
              const assetName = deposits.map((d) => d.tokenName).join(" + ") || "—";
              const debtName = borrows.map((d) => d.tokenName).join(" + ") || "—";
              return (
                <div className="trow" key={loan.loanId} style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
                  <span className="asset">
                    <span className="serif">{assetName}</span>
                    <span className="mono tiny muted">Borrowed {debtName}</span>
                  </span>
                  <span className="mono">${usd(collateralVal)}</span>
                  <span className="mono">${usd(debtVal)}</span>
                  <span className="mono">{((Number(info.currentLtv) || 0) * 100).toFixed(1)}%</span>
                  <span className="mono">{((Number(info.liquidationLtv) || 0) * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </section>
          )}

          {assetInfoSymbol && (() => {
            const row = portfolio.rows.find((r) => r.symbol === assetInfoSymbol);
            return (
              <AssetInfoModal
                symbol={assetInfoSymbol}
                name={row?.name || assetInfoSymbol}
                category={assetCategory(assetInfoSymbol)}
                onClose={() => setAssetInfoSymbol(null)}
              />
            );
          })()}

          </div>{/* dash-main */}

          <NewsPanel
            symbols={
              portfolio.rows.length > 0
                ? portfolio.rows.map((r) => r.symbol)
                : ["SPYx", "AAPLx", "TSLAx"]
            }
          />
          </div>{/* dash-grid */}

          {(proposal || withdrawalProposal || answer) && (
            <div className="modal-overlay" onClick={(e) => {
              if (e.target === e.currentTarget) {
                setProposal(null); setWithdrawalProposal(null); setAnswer(null);
              }
            }}>
              <div className="modal-box card">
                {answer && (<>
                  <div className="answer-header">
                    <p className="tiny label" style={{ margin: 0 }}>Research</p>
                    <button className="x" onClick={() => setAnswer(null)} title="Dismiss">×</button>
                  </div>
                  <div className="answer-body">
                    {answer.text.split("\n\n").map((para, i) => (
                      <p key={i} className="answer-para"
                        dangerouslySetInnerHTML={{
                          __html: para
                            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                            .replace(/\*(.*?)\*/g, "<em>$1</em>")
                            .replace(/\n/g, "<br>"),
                        }}
                      />
                    ))}
                  </div>
                  {answer.sources.length > 0 && (
                    <div className="answer-sources">
                      {answer.sources.map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noreferrer" className="source-chip tiny mono">
                          {s.title || s.url}
                        </a>
                      ))}
                    </div>
                  )}
                  {answer.mentionedSymbols.length > 0 && (
                    <div className="answer-actions">
                      <span className="tiny muted">Trade this:</span>
                      {answer.mentionedSymbols.map((sym) => (
                        <button key={sym} className="uni-chip"
                          onClick={() => { setRebalPrompt(`add ${sym}`); setAnswer(null); }}>
                          <span className="mono">{sym}</span> {registry[sym]?.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>)}

                {withdrawalProposal && (<>
                  <p className="tiny label">Withdraw</p>
                  <p className="lede sm">
                    Send{" "}
                    {withdrawalProposal.symbol === "USDC" || withdrawalProposal.symbol === "USDY" || !withdrawalProposal.symbol
                      ? <><strong>${usd(withdrawalProposal.usd)}</strong> {withdrawalProposal.symbol || "USDC"}</>
                      : <><strong>{fmtQty(withdrawalProposal.qty)}</strong> {withdrawalProposal.symbol} <span className="muted">(~${usd(withdrawalProposal.usd)})</span></>
                    }{" "}
                    to <span className="mono">{withdrawalProposal.to}</span>
                  </p>
                  <div className="wfoot">
                    <button className="btn ghost" onClick={() => setWithdrawalProposal(null)}>Cancel</button>
                    <button className="btn primary" onClick={() => runWithdraw(withdrawalProposal)}>
                      {withdrawalProposal.symbol === "USDC" || withdrawalProposal.symbol === "USDY" || !withdrawalProposal.symbol
                        ? `Send $${usd(withdrawalProposal.usd)} →`
                        : `Send ${fmtQty(withdrawalProposal.qty)} ${withdrawalProposal.symbol} →`}
                    </button>
                  </div>
                </>)}

                {proposal && (<>
                  <p className="tiny label">Proposed change</p>
                  {proposal.summary && <p className="lede sm">{proposal.summary}</p>}
                  <div className="trades">
                    {proposal.trades.map((t, i) => (
                      <span key={i} className={`trade-chip mono tiny ${t.side}`}>
                        {t.side === "buy" ? "Buy" : "Sell"} ${usd(t.usd)} {t.symbol}
                      </span>
                    ))}
                    {!proposal.trades.length && (
                      <span className="tiny muted">
                        {proposal.maxSkippedDelta > 0
                          ? `Proposed change is too small to execute (largest leg: $${usd(proposal.maxSkippedDelta)} — minimum is $0.25). Try a larger rebalance.`
                          : "No trades needed — you're already there."}
                      </span>
                    )}
                  </div>
                  {proposal.pendingWithdrawal && (
                    <p className="tiny muted" style={{ marginTop: 6 }}>
                      Then withdraw proceeds → <span className="mono">{short(proposal.pendingWithdrawal.to)}</span>
                    </p>
                  )}
                  <div className="wfoot">
                    <button className="btn ghost" onClick={() => setProposal(null)}>Discard</button>
                    {(proposal.trades.length > 0 || proposal.pendingWithdrawal) && (
                      <button className="btn primary" onClick={() => runTrades(proposal.trades, { afterWithdrawTo: proposal.pendingWithdrawal?.to || null, groupLabel: proposal.summary || "Rebalance" })}>
                        {proposal.trades.length > 0
                          ? `Execute ${proposal.trades.length} swap${proposal.trades.length > 1 ? "s" : ""}${proposal.pendingWithdrawal ? " + withdraw" : ""} →`
                          : "Withdraw →"}
                      </button>
                    )}
                  </div>
                </>)}
              </div>
            </div>
          )}

          {addPortfolioOpen && (() => {
            const trimmedEmail = newPortfolioEmail.trim();
            const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
            const canAdd = emailValid && !addPortfolioBusy;
            const close = () => {
              setAddPortfolioOpen(false);
              setNewPortfolioEmail("");
              setAddPortfolioErr(null);
              setAddPortfolioBusy(false);
            };
            const submit = async () => {
              setAddPortfolioBusy(true);
              setAddPortfolioErr(null);
              try {
                const result = await api.lookupUserByEmail(trimmedEmail);
                if (!result.found) {
                  setAddPortfolioErr("No discoverable user found with that email.");
                  return;
                }
                if (watchedPortfolios.some((w) => w.address === result.address)) {
                  setAddPortfolioErr("You're already watching this portfolio.");
                  return;
                }
                addWatchedPortfolio(result.label, result.address);
                setActiveAllocTab(result.address);
                close();
              } catch (e) {
                setAddPortfolioErr(e instanceof Error ? e.message : String(e));
              } finally {
                setAddPortfolioBusy(false);
              }
            };
            return (
              <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
                <div className="modal-box card" style={{ maxWidth: 420 }}>
                  <div className="answer-header">
                    <p className="tiny label" style={{ margin: 0 }}>Watch a portfolio</p>
                    <button className="x" onClick={close}>×</button>
                  </div>
                  <p className="tiny muted" style={{ marginBottom: 18 }}>
                    Search by the email another user signed up with. Only users who've enabled
                    "Discoverable by Email" in their own Settings can be found this way.
                  </p>
                  <div className="withdraw-field">
                    <label className="tiny label withdraw-label">Email</label>
                    <input className="withdraw-input" placeholder="their@email.com" type="email"
                      value={newPortfolioEmail}
                      onChange={(e) => { setNewPortfolioEmail(e.target.value); setAddPortfolioErr(null); }}
                      onKeyDown={(e) => e.key === "Enter" && canAdd && submit()}
                    />
                    {trimmedEmail && !emailValid && <p className="tiny warn" style={{ marginTop: 4 }}>Invalid email</p>}
                    {addPortfolioErr && <p className="tiny warn" style={{ marginTop: 4 }}>{addPortfolioErr}</p>}
                  </div>
                  <div className="wfoot">
                    <button className="btn ghost" onClick={close}>Cancel</button>
                    <button className="btn primary" disabled={!canAdd} onClick={submit}>
                      {addPortfolioBusy ? "Searching…" : "Add"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {customRebalanceOpen && (() => {
            const sum = customAllocs.reduce((s, a) => s + (+a.weight || 0), 0);
            const valid = Math.abs(sum - 100) < 0.1 && customAllocs.length > 0;
            const atMax = customAllocs.length >= 10;
            const q = assetSearch.trim().toLowerCase();
            const addableAssets = q
              ? Object.values(registry)
                  .filter((t) => t.symbol !== "USDC" && !customAllocs.some((a) => a.symbol === t.symbol))
                  .filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
                  .slice(0, 8)
              : [];
            return (
              <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setCustomRebalanceOpen(false)}>
                <div className="modal-box card">
                  <div className="answer-header">
                    <p className="tiny label" style={{ margin: 0 }}>Custom Rebalance</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="tiny muted">{customAllocs.length} / 10</span>
                      <button className="x" onClick={() => setCustomRebalanceOpen(false)}>×</button>
                    </div>
                  </div>
                  <p className="tiny muted" style={{ marginBottom: 18 }}>
                    Set your target allocation — must total 100%
                  </p>
                  {customAllocs.length > 0 && (
                    <button className="btn ghost" style={{ width: "100%", marginBottom: 12 }}
                      onClick={() => {
                        const w = +(100 / customAllocs.length).toFixed(2);
                        setCustomAllocs((prev) => prev.map((a) => ({ ...a, weight: String(w) })));
                      }}>
                      Equal Distribution
                    </button>
                  )}
                  <div className="custom-alloc-list">
                    {customAllocs.map((a, i) => (
                      <div key={a.symbol} className="custom-alloc-row">
                        <div className="custom-alloc-label">
                          <span className="serif">{a.name}</span>
                          <span className="mono tiny muted">{a.symbol}</span>
                        </div>
                        <div className="custom-alloc-input-wrap">
                          <input
                            type="number" min="0" max="100" step="0.1"
                            className="custom-alloc-input"
                            value={a.weight}
                            onChange={(e) => {
                              const next = [...customAllocs];
                              next[i] = { ...next[i], weight: e.target.value };
                              setCustomAllocs(next);
                            }}
                          />
                          <span className="tiny muted">%</span>
                          <button
                            className="custom-alloc-remove"
                            onClick={() => setCustomAllocs((prev) => prev.filter((_, j) => j !== i))}
                            title="Remove">×</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {!atMax && (
                    <div className="custom-alloc-add-wrap">
                      <div className="custom-alloc-search-wrap">
                        <svg className="custom-alloc-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                          className="custom-alloc-search"
                          placeholder="Add asset — search by name or ticker…"
                          value={assetSearch}
                          onChange={(e) => setAssetSearch(e.target.value)}
                        />
                      </div>
                      {addableAssets.length > 0 && (
                        <div className="custom-alloc-results">
                          {addableAssets.map((t) => (
                            <button key={t.symbol} className="uni-chip"
                              onClick={() => {
                                setCustomAllocs((prev) => [...prev, { symbol: t.symbol, name: t.name, weight: "0" }]);
                                setAssetSearch("");
                              }}>
                              <span className="mono">{t.symbol}</span> {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {q && addableAssets.length === 0 && (
                        <p className="tiny muted" style={{ padding: "6px 2px" }}>No matching assets.</p>
                      )}
                    </div>
                  )}
                  {atMax && (
                    <p className="tiny muted" style={{ marginBottom: 12 }}>Maximum of 10 assets reached.</p>
                  )}

                  <div className="custom-alloc-total">
                    <span className="tiny muted">Total</span>
                    <span className={`mono ${valid ? "gain" : "warn"}`}>{sum.toFixed(1)}%</span>
                    {!valid && sum > 0 && <span className="tiny muted">{sum < 100 ? `— ${(100 - sum).toFixed(1)}% remaining` : `— ${(sum - 100).toFixed(1)}% over`}</span>}
                  </div>
                  <div className="wfoot">
                    <button className="btn ghost" onClick={() => setCustomRebalanceOpen(false)}>Cancel</button>
                    <button className="btn primary" disabled={!valid}
                      onClick={() => {
                        const allocations = customAllocs.map((a) => ({ symbol: a.symbol, weight: +a.weight }));
                        const { trades, maxSkippedDelta } = planTrades({ allocations, portfolio, prices, registry });
                        setProposal({
                          summary: `Custom rebalance across ${allocations.length} position${allocations.length !== 1 ? "s" : ""}`,
                          allocations, trades, maxSkippedDelta,
                        });
                        setCustomRebalanceOpen(false);
                        setAssetSearch("");
                      }}>
                      Preview Trades →
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {withdrawOpen && (() => {
            const withdrawableAssets = [
              ...portfolio.rows.map((r) => ({
                symbol: r.symbol, name: r.name,
                uiAmount: r.uiAmount,
                // Exact on-chain atomic balance, straight from holdings — some
                // xStocks mints carry Token-2022's ScaledUiAmount extension
                // (e.g. to represent a stock split), which makes `uiAmount`
                // a *display* value (raw amount × a multiplier) that no
                // longer round-trips back to atoms via `× 10**decimals`.
                // rawAmount is the actual transferable balance and is what
                // an amount sent to the chain must be derived from.
                rawAmount: r.amount,
                mint: registry[r.symbol]?.mint,
                decimals: registry[r.symbol]?.decimals ?? 8,
              })),
              ...(portfolio.cashUsdc > 0.001 ? [{ symbol: "USDC", name: "USD Coin", uiAmount: portfolio.cashUsdc, mint: registry.USDC?.mint, decimals: 6 }] : []),
              ...(yieldMode && portfolio.usdyAmount > 0.001 ? [{ symbol: "USDY", name: "US Dollar Yield", uiAmount: portfolio.usdyAmount, mint: registry.USDY?.mint, decimals: 6 }] : []),
            ];
            const asset = withdrawableAssets.find((a) => a.symbol === withdrawAsset) || withdrawableAssets[0];
            const available = asset?.uiAmount || 0;
            const amountNum = parseFloat(withdrawAmountStr) || 0;
            const addrValid = SOLANA_ADDRESS_RE.test(withdrawAddress.trim());
            const amountValid = amountNum > 0 && amountNum <= available;
            const canSend = addrValid && amountValid && asset;
            const setQuickPct = (pct) => setWithdrawAmountStr(pct === 1 ? String(available) : String(floorTo(available * pct, asset?.decimals <= 6 ? 2 : 6)));
            return (
              <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setWithdrawOpen(false)}>
                <div className="modal-box card withdraw-modal">
                  <div className="answer-header">
                    <p className="tiny label" style={{ margin: 0 }}>Withdraw</p>
                    <button className="x" onClick={() => setWithdrawOpen(false)}>×</button>
                  </div>

                  <div className="withdraw-field">
                    <label className="tiny label withdraw-label">Asset</label>
                    <select className="withdraw-select"
                      value={withdrawAsset}
                      onChange={(e) => { setWithdrawAsset(e.target.value); setWithdrawAmountStr(""); }}>
                      {withdrawableAssets.map((a) => (
                        <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol}) — {a.uiAmount < 0.001 ? "<0.001" : floorTo(a.uiAmount, 4)}</option>
                      ))}
                    </select>
                  </div>

                  {savedAddresses.length > 0 && (
                    <div className="withdraw-field">
                      <label className="tiny label withdraw-label">Saved addresses</label>
                      <select className="withdraw-select"
                        value={withdrawToSaved}
                        onChange={(e) => {
                          setWithdrawToSaved(e.target.value);
                          const saved = savedAddresses.find((a) => a.address === e.target.value);
                          if (saved) setWithdrawAddress(saved.address);
                        }}>
                        <option value="">Choose a saved address…</option>
                        {savedAddresses.map((a) => (
                          <option key={a.address} value={a.address}>{a.label} — {short(a.address)}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="withdraw-field">
                    <label className="tiny label withdraw-label">Destination address</label>
                    <input className="withdraw-input mono"
                      placeholder="Solana wallet address"
                      value={withdrawAddress}
                      onChange={(e) => { setWithdrawAddress(e.target.value); setWithdrawToSaved(""); }}
                    />
                    {withdrawAddress && !addrValid && <p className="tiny warn" style={{ marginTop: 4 }}>Invalid Solana address</p>}
                  </div>

                  <div className="withdraw-field">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <label className="tiny label withdraw-label">Amount</label>
                      <span className="tiny muted">Available: {floorTo(available, asset?.decimals <= 6 ? 2 : 4)} {withdrawAsset}</span>
                    </div>
                    <div className="withdraw-amount-row">
                      <input className="withdraw-input withdraw-amount-input"
                        type="number" min="0" step="any"
                        placeholder="0.00"
                        value={withdrawAmountStr}
                        onChange={(e) => setWithdrawAmountStr(e.target.value)}
                      />
                      <div className="pct-btns">
                        {[["25%", 0.25], ["50%", 0.5], ["75%", 0.75], ["All", 1]].map(([label, pct]) => (
                          <button key={label} className="pct-btn" onClick={() => setQuickPct(pct)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {withdrawAmountStr && amountNum > available && <p className="tiny warn" style={{ marginTop: 4 }}>Exceeds available balance</p>}
                  </div>

                  <div className="wfoot">
                    <button className="btn ghost" onClick={() => setWithdrawOpen(false)}>Cancel</button>
                    <button className="btn primary" disabled={!canSend}
                      onClick={() => {
                        // Derive the raw atom count to send from the real
                        // on-chain balance (asset.rawAmount), never from
                        // uiAmount × 10**decimals — for mints with a
                        // Token-2022 scaled-UI-amount multiplier (stock
                        // splits) that reconstruction is wrong by exactly
                        // the multiplier and always undershoots/overshoots
                        // the true transferable balance.
                        const atoms = asset.rawAmount != null
                          ? (amountNum >= available
                              ? Number(asset.rawAmount)
                              : Math.floor((amountNum / available) * Number(asset.rawAmount)))
                          : Math.floor(amountNum * 10 ** asset.decimals);
                        const usdVal = asset.symbol === "USDC" || asset.symbol === "USDY"
                          ? amountNum
                          : amountNum * (prices[asset.mint] || 0);
                        runWithdraw({
                          to: withdrawAddress.trim(),
                          usd: usdVal,
                          amount: atoms,
                          symbol: asset.symbol,
                          mint: asset.mint,
                          decimals: asset.decimals,
                        });
                      }}>
                      Send {withdrawAmountStr || "0"} {withdrawAsset} →
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {shareOpen && (
            <ShareModal portfolio={portfolio} history={history} onClose={() => setShareOpen(false)} />
          )}

          {depositOpen && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDepositOpen(false)}>
              <div className="modal-box card deposit-modal">
                <div className="answer-header">
                  <p className="tiny label" style={{ margin: 0 }}>Deposit USDC</p>
                  <button className="x" onClick={() => setDepositOpen(false)}>×</button>
                </div>
                <button className="btn primary fund-pay-btn" style={{ width: "100%", marginBottom: 12 }}
                  onClick={() => fundWallet(address, { defaultFundingMethod: "card" })}>
                  <span className="fund-apple-icon">􀠦</span> Buy with Apple Pay / Card
                </button>
                <p className="tiny muted center" style={{ marginBottom: 20 }}>
                  Powered by Privy · no crypto needed to start
                </p>
                <p className="tiny muted" style={{ marginBottom: 8 }}>
                  Or send USDC on Solana to your self-custodied wallet:
                </p>
                <div className="deposit-qr-wrap">
                  <QRCodeSVG value={address} size={180} bgColor="transparent" fgColor="var(--ink)" level="M" />
                </div>
                <div className="deposit-addr-row">
                  <span className="mono deposit-addr">{address}</span>
                  <button className="btn ghost deposit-copy-btn" onClick={copy}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <p className="tiny muted center" style={{ marginTop: 12 }}>
                  Solana network only — do not send from other chains
                </p>
              </div>
            </div>
          )}
        </main>
      )}

      <footer className="lv-foot">
        <span>xStocks by Backed</span>
        <span className="foot-sep">·</span>
        <span>Routing by Jupiter</span>
        <span className="foot-sep">·</span>
        <span>Wallets by Privy</span>
        <span className="foot-sep">·</span>
        <span>Solana mainnet</span>
        <span className="foot-sep" style={{ margin: "0 4px" }}>—</span>
        <span>Not available to US persons or restricted jurisdictions.</span>
      </footer>

      {usdtModalOpen && usdtToken && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !usdtSwap.busy && dismissUsdtModal()}>
          <div className="modal-box card">
            <div className="answer-header">
              <p className="tiny label" style={{ margin: 0 }}>USDT received</p>
              {!usdtSwap.busy && <button className="x" onClick={dismissUsdtModal}>×</button>}
            </div>
            <p className="muted" style={{ marginBottom: 20 }}>
              We received <strong className="mono">{usdtToken.uiAmount}</strong> USDT in your wallet.
              Bonzai Trading only trades against USDC — USDT can't be used to buy assets here directly.
              We can automatically convert it to USDC via Jupiter now, at the best available rate.
            </p>
            {usdtSwap.error && <p className="err tiny" style={{ marginBottom: 12 }}>{usdtSwap.error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={dismissUsdtModal} disabled={usdtSwap.busy}>
                Not now
              </button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => void confirmUsdtConvert()} disabled={usdtSwap.busy}>
                {usdtSwap.busy
                  ? (usdtSwap.status === "routing" ? "Routing…" : usdtSwap.status === "signing" ? "Sign in wallet…"
                    : usdtSwap.status === "executing" ? "Converting…" : "Working…")
                  : "Convert to USDC"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
