import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePrivy, useSessionSigners, useWallets, useSignTypedData } from "@privy-io/react-auth";
import { useSolanaWallets, useSignTransaction, useSignMessage, useFundWallet } from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
import Donut from "./components/Donut.jsx";
import { useLongviewHl, usePositions, useAssets } from "./perps/useHyperliquid.js";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { liquidationPrice } from "./perps/hl/margin.js";
import { DEFAULT_CONFIG, EQUITY_DEX } from "./perps/config.js";
import TimeSeriesChart, { priceLabel } from "./components/TimeSeriesChart.jsx";
import MarketsExplorer from "./components/MarketsExplorer.jsx";
import TradingAgentApp from "./agents/TradingAgentApp.jsx";
import BottomTabBar from "./components/BottomTabBar.jsx";
import { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_URL } from "./lib/telegram.js";
import AssetInfoModal from "./components/AssetInfoModal.jsx";
import NewsPanel from "./components/NewsPanel.jsx";
import HistoryScreen from "./components/HistoryScreen.jsx";
import ShareModal from "./components/ShareCard.jsx";
import DemoAnimation from "./components/DemoAnimation.jsx";
import LandingPage from "./components/LandingPage.jsx";
import PerpsApp from "./perps/PerpsApp.jsx";
import { PerpsCloseCell } from "./perps/PerpsPanel.jsx";
import EquitiesMarketsApp from "./EquitiesMarketsApp.jsx";
import PredictionMarketsApp from "./PredictionMarketsApp.jsx";
import ReferralsApp from "./ReferralsApp.jsx";
import BorrowApp from "./borrow/BorrowApp.jsx";
import PositionCard from "./borrow/PositionCard.jsx";
import { useKaminoReserves, useKaminoAction } from "./borrow/useKamino.js";
import { api, executeSwap, executeWithdraw, executeKaminoAction, KAMINO_FEE_BPS, derivePortfolio, planTrades, mergePortfolioCollateral, stripKaminoDust, usd, short, setAuthTokenProvider } from "./lib/api.js";
import { buildQaBypassMessage, setQaBypassCredentials, hasQaBypassCredentials } from "./lib/qaBypass.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Client-owned presentation tiers for a trade's estimated price impact —
// the server (/api/quote-preview) just returns the raw percentage. Red
// threshold matches MAX_PRICE_IMPACT_PCT server-side (server/src/index.js)
// — at that point the real trade would actually be rejected, not just risky.
function impactBadge(impact) {
  if (!impact) return null;
  if (impact.error) return { label: "no quote available", className: "warn" };
  const pct = impact.priceImpactPct;
  if (pct >= 5) return { label: `${pct.toFixed(1)}% impact — likely to fail`, className: "warn" };
  if (pct >= 2) return { label: `${pct.toFixed(1)}% impact`, className: "gold" };
  return null; // normal — no badge needed
}
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

// Same period-key vocabulary as the perps dashboard's own period selector
// (see perps/PerpsDashboard.jsx) — reused here for the brokerage "Portfolio
// Stats" panel so both charts behave identically, not because this is
// perps data.
const DASH_STATS_PERIODS = [
  { key: "perpDay", label: "Day" },
  { key: "perpWeek", label: "Week" },
  { key: "perpMonth", label: "Month" },
  { key: "perpAllTime", label: "All" },
];

// Single-position sell popup for the main dashboard's brokerage Positions
// table — mirrors EquitiesMarketsApp.jsx's BuyPopup exactly (same $/units
// toggle + preset-percentage + custom-amount pattern), sized against this
// position's own value/holding rather than available cash. Presets are
// always exact percentages of `row.value`, so 100%/"Max" and the modal's
// own overHolding cap agree by construction — no separate "sell everything"
// special case needed here; quickSell (App body) is what caps the
// resulting trade to the exact on-chain balance regardless of which mode
// (USD or units) produced the requested usdAmount.
function SellModal({ row, onClose, onConfirm }) {
  const [mode, setMode] = useState("usd"); // "usd" | "units"
  const [input, setInput] = useState("");

  const inputNum = Number(input) || 0;
  const usdAmount = mode === "usd" ? inputNum : inputNum * (row.price || 0);
  const overHolding = usdAmount > row.value + 0.005;
  const valid = usdAmount > 0 && !overHolding;

  const setPct = (pct) => {
    const usdVal = row.value * (pct / 100);
    setInput(mode === "usd" ? usdVal.toFixed(2) : row.price ? (usdVal / row.price).toFixed(6) : "");
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card" style={{ maxWidth: 380 }}>
        <div className="card-toprow">
          <p className="card-title">Sell {row.symbol}</p>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <p className="tiny muted" style={{ margin: "0 0 4px" }}>{row.name} · ${usd(row.price)} current price</p>
        <p className="tiny muted" style={{ margin: "0 0 10px" }}>
          You hold {Number(row.uiAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.symbol} (${usd(row.value)})
        </p>

        <div className="lvp-pct-presets" style={{ marginBottom: 10 }}>
          <button type="button" className={`lvp-pct-btn ${mode === "usd" ? "sel" : ""}`}
            onClick={() => { setMode("usd"); setInput(""); }} style={{ flex: 1 }}>$</button>
          <button type="button" className={`lvp-pct-btn ${mode === "units" ? "sel" : ""}`} disabled={!row.price}
            onClick={() => { setMode("units"); setInput(""); }} style={{ flex: 1 }}>{row.symbol}</button>
        </div>

        <div className="borrow-field">
          <span className="tiny muted">{mode === "usd" ? "Amount (USD)" : `Amount (${row.symbol})`}</span>
          <input className="field" inputMode="decimal" autoFocus placeholder={mode === "usd" ? "100" : "1.5"}
            value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        {mode === "units" && row.price && inputNum > 0 && (
          <p className="tiny muted" style={{ margin: "-8px 0 12px" }}>≈ ${usd(usdAmount)}</p>
        )}

        <div className="lvp-pct-presets">
          {[25, 50, 75, 100].map((pct) => (
            <button key={pct} type="button" className="lvp-pct-btn" onClick={() => setPct(pct)}>
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>

        <button className="btn primary" style={{ width: "100%", marginTop: 4 }} disabled={!valid}
          onClick={() => onConfirm(usdAmount)}>
          Review sell →
        </button>
        {overHolding && <p className="tiny warn" style={{ marginTop: 8 }}>Exceeds your position value (${usd(row.value)}).</p>}
      </div>
    </div>
  );
}

// Same on-chain requirement BorrowTicket.jsx documents (~0.0336 SOL for
// InitObligation + collateral token account on a wallet's first Kamino
// deposit) — kept in sync with KAMINO_SOL_RESERVE there.
const KAMINO_SOL_RESERVE = 0.042;

/**
 * Deposit-only Kamino lend action, launched directly from a brokerage
 * position row rather than the full Borrow/Lend page — same underlying
 * deposit call as BorrowTicket.jsx's "deposit" step (useKaminoAction +
 * executeKaminoAction), just scoped to the one row/reserve already known
 * from the click instead of rendering its own asset picker.
 */
function LendModal({ row, reserve, wallet, signWithWallet, solBalance = 0, onClose, onDone }) {
  const action = useKaminoAction(wallet, signWithWallet);
  const [depositAmount, setDepositAmount] = useState("");
  const [done, setDone] = useState(false);

  const hasGasReserve = solBalance >= KAMINO_SOL_RESERVE;
  const depositAmt = Number(depositAmount);
  const validDeposit = depositAmt > 0 && depositAmt <= row.uiAmount;

  // Same Token-2022 ScaledUiAmount correction as BorrowTicket.jsx — send the
  // true unscaled ratio, not the display uiAmount, so a full "Max" deposit
  // never asks Kamino to pull more raw atoms than the wallet actually holds.
  const trueUnscaledMax = row.amount != null ? Number(row.amount) / 10 ** (row.decimals ?? 8) : row.uiAmount;
  const kaminoDepositAmount = row.uiAmount > 0
    ? (depositAmt >= row.uiAmount ? trueUnscaledMax : (depositAmt / row.uiAmount) * trueUnscaledMax)
    : depositAmt;

  const maxLtv = reserve ? Number(reserve.maxLtv) : 0;
  const supplyApyPct = reserve ? Number(reserve.supplyApy) * 100 : 0;
  const depositValueUsd = depositAmt * (row.price || 0);
  // Deposits are free — the 0.10% platform fee lives on borrows instead,
  // taken in USDC, so this is against the full deposited value.
  const maxBorrowUsd = depositValueUsd * maxLtv;

  const submitDeposit = async () => {
    if (!validDeposit || !reserve) return;
    const result = await action.run("deposit", {
      reserve: reserve.reserve, amount: String(kaminoDepositAmount),
      mint: row.mint, decimals: row.decimals, usdValue: depositValueUsd,
    });
    if (result) { setDone(true); onDone?.(); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card" style={{ maxWidth: 380 }}>
        <div className="card-toprow">
          <p className="card-title">Lend {row.symbol}</p>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {done ? (
          <>
            <p className="muted">
              Deposited {depositAmount} {row.symbol} as collateral on Kamino's xStocks Market — up to
              ${maxBorrowUsd.toFixed(2)} USDC now borrowable against it. Check the Borrow / Lend tab to
              monitor your position or borrow against it.
            </p>
            <button className="btn ghost" style={{ marginTop: 12, width: "100%" }} onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="tiny muted" style={{ margin: "0 0 10px" }}>
              You hold {Number(row.uiAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.symbol} (${usd(row.value)}) ·
              {" "}{supplyApyPct > 0 ? `${supplyApyPct.toFixed(2)}% supply APY · ` : ""}max LTV {(maxLtv * 100).toFixed(0)}%
            </p>

            <div className="borrow-field">
              <span className="tiny muted">Deposit amount ({row.symbol})</span>
              <div className="borrow-input-wrap">
                <input className="field" inputMode="decimal" autoFocus value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
                <button className="btn ghost borrow-max" onClick={() => setDepositAmount(String(row.uiAmount))}>
                  Max {row.uiAmount}
                </button>
              </div>
            </div>

            {depositAmt > 0 && (
              <p className="tiny muted">
                ${depositValueUsd.toFixed(2)} in collateral value — no deposit fee —
                up to ${maxBorrowUsd.toFixed(2)} borrowable
              </p>
            )}
            {!hasGasReserve && (
              <p className="tiny muted">
                Opening your first position here needs ~{KAMINO_SOL_RESERVE} SOL (you have {solBalance.toFixed(4)}) —
                we'll try to cover the difference automatically when you deposit.
              </p>
            )}

            <button className="btn primary" style={{ marginTop: 12, width: "100%" }} disabled={!validDeposit || action.busy}
              onClick={() => void submitDeposit()}>
              {action.busy ? "Waiting for signature…" : "Deposit collateral"}
            </button>
            {action.error && <p className="err tiny" style={{ marginTop: 10 }}>{action.error}</p>}
          </>
        )}
      </div>
    </div>
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
  // Full tradable-asset list (both dexs) + live mark prices — needed to
  // resolve a spoken asset name ("Solana") from the prompt bar into a real
  // assetIndex/markPrice/szDecimals/maxLeverage, same source PerpsApp.jsx's
  // own order ticket uses.
  const { assets: perpAssets, markPrices: perpMarkPrices } = useAssets(hl);

  // EVM signing for closing a Perps position directly from this dashboard —
  // identical minimal "viem local account" shape PerpsApp.jsx builds
  // (Hyperliquid's SDK only needs { address, signTypedData }). Only ever
  // used to close positions (a "trade" action), so it skips Privy's own
  // signing modal unconditionally — same scope as PerpsApp.jsx's tradingWallet.
  const { signTypedData } = useSignTypedData();
  const perpsWallet = useMemo(() => {
    if (!evmAddress) return null;
    return {
      address: evmAddress,
      signTypedData: async (params) => {
        const { signature } = await signTypedData(params, { address: evmAddress, uiOptions: { showWalletUIs: false } });
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

  // Referral attribution — same "capture from URL, persist across the login
  // redirect, consume once" shape as qa_bypass above. The code is stashed
  // the moment it's seen (even pre-login, since a Privy auth redirect can
  // drop the original query string) and submitted exactly once per wallet.
  // The server also enforces "one referrer, ever" itself
  // (referrals.referred_privy_user_id is a PRIMARY KEY) — this local guard
  // is just to avoid a pointless repeat network call, not the real safety net.
  useEffect(() => {
    const refCode = new URLSearchParams(window.location.search).get("ref");
    if (refCode) localStorage.setItem("lv_ref_code", refCode.toUpperCase());
  }, []);
  useEffect(() => {
    if (!authenticated || !address) return;
    const code = localStorage.getItem("lv_ref_code");
    if (!code || localStorage.getItem("lv_ref_attributed") === "1") return;
    api.attributeReferral({ code, walletAddress: address, evmAddress })
      .then(() => localStorage.setItem("lv_ref_attributed", "1"))
      .catch(() => {}); // leave unmarked on a real network/server error — retry next load
  }, [authenticated, address, evmAddress]);

  const [registry, setRegistry] = useState(null);
  const [sponsored, setSponsored] = useState(false);
  const [prices, setPrices] = useState({});
  const [holdings, setHoldings] = useState(null);
  const [copied, setCopied] = useState(false);

  // build / rebalance flow
  const [view, setView] = useState("auto"); // auto | build | weights | execute
  // Trade execution/routing progress shows as a popup over whatever screen
  // is already showing (almost always dash) instead of navigating to a
  // separate full screen — decoupled from `view` entirely so the screen
  // underneath stays mounted the whole time.
  const [executeOpen, setExecuteOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [rebalPrompt, setRebalPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [proposalImpacts, setProposalImpacts] = useState({}); // symbol -> { priceImpactPct } | { error }
  const [withdrawalProposal, setWithdrawalProposal] = useState(null); // {to, usd, amount}
  const [perpProposal, setPerpProposal] = useState(null); // resolved, ready-to-sign perps order intent
  const [perpOrderBusy, setPerpOrderBusy] = useState(false);
  const [borrowProposal, setBorrowProposal] = useState(null); // resolved Kamino deposit/borrow intent
  const [borrowActionBusy, setBorrowActionBusy] = useState(false);

  // Fires once per new proposal (rebalance or build) — not on every weight/
  // slider change, since a proposal is only (re)computed on a real user
  // action. Side-effect-free preview (see api.quotePreview — deliberately
  // NOT api.order, which tops up SOL for gas on sells as a side effect
  // even just to return a quote).
  useEffect(() => {
    if (!proposal?.trades?.length) { setProposalImpacts({}); return; }
    let cancelled = false;
    setProposalImpacts({});
    Promise.all(proposal.trades.map(async (t) => {
      try {
        const data = await api.quotePreview({ inputMint: t.inputMint, outputMint: t.outputMint, amount: t.amount });
        return [t.symbol, data];
      } catch {
        return [t.symbol, { error: "preview unavailable" }];
      }
    })).then((entries) => {
      if (!cancelled) setProposalImpacts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [proposal]);
  const [legs, setLegs] = useState([]);
  const [error, setError] = useState("");
  const [investPct, setInvestPct] = useState(100);
  const [statsFlipped, setStatsFlipped] = useState(false);
  const [dashProduct, setDashProduct] = useState("brokerage"); // "brokerage" | "perps" | "borrow" | "markets"
  const [newsSearchInput, setNewsSearchInput] = useState("");
  const [newsSearchSymbol, setNewsSearchSymbol] = useState(null);
  const runNewsSearch = (e) => {
    e.preventDefault();
    const cleaned = newsSearchInput.trim().replace(/^\$/, "").toUpperCase();
    if (cleaned) setNewsSearchSymbol(cleaned);
  };
  const clearNewsSearch = () => { setNewsSearchInput(""); setNewsSearchSymbol(null); };
  const [borrowDashTabKey, setBorrowDashTabKey] = useState(null);
  const [history, setHistory] = useState([]);
  // Same period-key vocabulary ("perpDay" etc.) TimeSeriesChart's own
  // date-formatting switches on, reused here even though this panel isn't
  // perps data — keeps one shared chart component's label logic instead of
  // adding a second vocabulary just for this call site.
  const [statsPeriod, setStatsPeriod] = useState("perpAllTime");
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
  const [showAllWatchTabs, setShowAllWatchTabs] = useState(false);
  const [viewedHoldings, setViewedHoldings] = useState(null);
  const [addPortfolioOpen, setAddPortfolioOpen] = useState(false);
  const [newPortfolioEmail, setNewPortfolioEmail] = useState("");
  const [addPortfolioBusy, setAddPortfolioBusy] = useState(false);
  const [addPortfolioErr, setAddPortfolioErr] = useState(null);
  const [discoverable, setDiscoverableState] = useState(() => localStorage.getItem("lv_discoverable") === "true");
  const [discoverableBusy, setDiscoverableBusy] = useState(false);
  const [discoverableErr, setDiscoverableErr] = useState(null);
  const [assetInfoSymbol, setAssetInfoSymbol] = useState(null);
  const [sellTarget, setSellTarget] = useState(null);
  const [lendTarget, setLendTarget] = useState(null);
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
  // rather than silently sitting there or silently being swapped. Dust
  // under $0.01 (USDT trades close enough to its $1 peg that uiAmount is a
  // fine stand-in for USD value here) is ignored — not worth interrupting
  // someone over, and not worth the gas to convert. ———
  const USDT_NOTIFY_MIN = 0.01;
  useEffect(() => {
    const usdt = holdings?.tokens?.find((t) => t.mint === USDT_MINT);
    const uiAmount = usdt?.uiAmount || 0;
    if (uiAmount >= USDT_NOTIFY_MIN && uiAmount > usdtHandledAmount) {
      setUsdtToken(usdt);
      setUsdtModalOpen(true);
    }
  }, [holdings, usdtHandledAmount]);

  const portfolio = useMemo(
    () => (registry && holdings ? derivePortfolio(holdings, prices, registry, { yieldMode }) : null),
    [registry, holdings, prices, yieldMode]
  );

  // Period-filtered view of the portfolio-value history for the "Portfolio
  // Stats" chart — the underlying `history` array holds the full ~2000-
  // point local snapshot log unfiltered, same shape TimeSeriesChart wants
  // ({ts, v}) already, just needs windowing by whichever range is active.
  // Falls back to the full series if the window has under 2 points (e.g. a
  // new account with only a day of history but "Week" selected) rather
  // than showing an empty chart when there's real data to show.
  const STATS_PERIOD_MS = { perpDay: 86400000, perpWeek: 7 * 86400000, perpMonth: 30 * 86400000, perpAllTime: Infinity };
  const statsPoints = useMemo(() => {
    if (!history.length) return [];
    const lookback = STATS_PERIOD_MS[statsPeriod] ?? Infinity;
    const cutoff = Number.isFinite(lookback) ? Date.now() - lookback : -Infinity;
    const inRange = history.filter((p) => p.ts >= cutoff);
    return inRange.length >= 2 ? inRange : history;
  }, [history, statsPeriod]);

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
  // Which held mints Kamino's xStocks Market actually accepts as collateral —
  // powers the dashboard's per-row "Lend" button (only shown when eligible),
  // same eligibility check BorrowApp.jsx uses for its own asset picker.
  const kaminoReserveByMint = useMemo(
    () => new Map(kaminoReserves.map((r) => [r.liquidityTokenMint, r])),
    [kaminoReserves]
  );
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

  // Unused borrowing room on whatever's already deposited in the Kamino
  // xStocks market — same calc BorrowTicket.jsx uses for its "quick borrow,
  // no new deposit needed" path, needed here too so a prompt like "borrow
  // $500 more" (no asset named) resolves against real existing room instead
  // of requiring a fresh deposit every time.
  const existingBorrowRoom = useMemo(() => {
    let loan = null, collateralValue = 0, debtValue = 0, maxLtv = 0;
    for (const l of kaminoLoans) {
      const info = l.loanInfo ?? l;
      const cv = (info.collateral?.deposits ?? []).reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);
      const dv = (info.debt?.borrows ?? []).reduce((s, d) => s + Number(d.tokenValue ?? 0), 0);
      const ltv = Number(info.maxLtv ?? 0);
      const room = Math.max(0, cv * ltv - dv);
      if (room > 0.01 && !loan) { loan = l; collateralValue = cv; debtValue = dv; maxLtv = ltv; }
    }
    return { loan, collateralValue, debtValue, maxLtv, roomUsd: Math.max(0, collateralValue * maxLtv - debtValue) };
  }, [kaminoLoans]);

  // The logged-in user's own net worth across every product — Brokerage
  // (incl. Kamino collateral, already merged into displayPortfolio above),
  // Perps equity (accountValue already nets in unrealized PnL — the actual
  // "your money" figure, not perpsNotionalTotal's leveraged exposure), minus
  // Kamino debt (a real liability that reduces net worth; collateral was
  // added by mergePortfolioCollateral but never had its offsetting debt
  // subtracted anywhere, confirmed via mergePortfolioCollateral's own
  // implementation). Falls back to the raw wallet-only total on the rare
  // tick where the "mine" tab isn't active — perps/Kamino aren't fetchable
  // for an arbitrary watched address, only the logged-in user's own.
  const myPortfolioTotal = activeAllocTab === "mine"
    ? (displayPortfolio?.total ?? 0) + perpsAccountValue - borrowDebtTotal
    : (portfolio?.total ?? 0);

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
        try {
          await addSessionSigners({ address, signers: [{ signerId: BOT_SESSION_SIGNER_ID }] });
        } catch (e) {
          // The toggle's on/off state is cached in localStorage, never
          // re-verified against Privy's actual delegation state on load —
          // so a wallet that's already delegated (a previous enable that
          // succeeded server-side but whose localStorage write never
          // landed, or state carried over from a different browser/
          // device) shows this toggle as "off" even though it's already
          // on. Privy's error for that exact case is unambiguous
          // ("Duplicate signer(s) provided") — treat it as the success it
          // already represents rather than surfacing a confusing error.
          const msg = e instanceof Error ? e.message : String(e);
          if (!/duplicate signer/i.test(msg)) throw e;
        }
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
        usdValue: usdtToken.uiAmount || 0,
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
      setExecuteOpen(true);
      const setLeg = (patch) => setLegs((L) => [{ ...L[0], ...patch }]);
      try {
        const result = await executeSwap({ inputMint: registry.USDC.mint, outputMint: registry.USDY.mint, amount, taker: address, signWithWallet, onStatus: (s) => setLeg({ status: s }), usdValue: usdcBal });
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
      setExecuteOpen(true);
      const setLeg = (patch) => setLegs((L) => [{ ...L[0], ...patch }]);
      try {
        const result = await executeSwap({ inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, taker: address, signWithWallet, onStatus: (s) => setLeg({ status: s }), usdValue: usdyUsd });
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
    setExecuteOpen(true);
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
  // Distinct, narrower signal than TRADE_RE's "buy"/"sell" (which also match
  // ordinary brokerage prompts) — requires an unambiguous leverage/perps
  // word so a normal "buy Tesla" doesn't get misrouted here.
  const PERP_RE = /\bleverage\b|\bperps?\b|\bfutures?\b|\b\d+(\.\d+)?x\b/i;
  // Kamino borrow/lend signal — "borrow" alone is unambiguous (no other
  // flow in this app uses that verb); "collateral"/"kamino"/"ltv" cover
  // deposit-only phrasing that doesn't happen to say "borrow"; "loan"/
  // "repay"/"pay back" cover repay/withdraw phrasing like "pay back my
  // loan and withdraw my TSLA" (confirmed as a real gap — that exact
  // phrase matched none of the original words and fell through to the
  // brokerage allocation parser instead).
  const BORROW_RE = /\bborrow(ing)?\b|\bcollateral\b|\bkamino\b|\bltv\b|\bloans?\b|\brepay(ing|ment)?\b|\bpay(ing)?\s+back\b/i;
  const runPrompt = async (text, isRebalance) => {
    const addrMatch = text.match(SOLANA_ADDR_RE);
    const isSend = SEND_RE.test(text) && addrMatch;
    const hasTradeIntent = TRADE_RE.test(text);
    const isPerp = PERP_RE.test(text);
    const isBorrow = BORROW_RE.test(text);
    const QUESTION_START_RE = /^(what|how|why|when|who|which|tell me|explain|is |are |does |should |can |will |show me|analyze|compare|what's|how's)/i;
    const isQuestion = !hasTradeIntent && !isPerp && !isBorrow && (text.includes("?") || QUESTION_START_RE.test(text.trim()));

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

    if (isPerp) {
      await runPerpPrompt(text);
      return;
    }

    if (isBorrow) {
      await runBorrowPrompt(text);
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

  /* ——— perps-via-prompt: "buy SOL perp at 5x with all my cash" ———
   * parsePerpPrompt() (server) only extracts linguistic intent — never a
   * real dollar figure. Everything below resolves that intent against live
   * data (real asset list, real mark price, real withdrawable margin) and
   * stops at a fully-computed confirm screen (setPerpProposal) rather than
   * ever signing directly off the parsed text — same discipline the
   * rebalance/build paths use via the "Proposed change" modal, doubly
   * important here since a misparse on a leveraged order amplifies loss. */
  const runPerpPrompt = async (text) => {
    setThinking(true); setError("");
    try {
      const intent = await api.parsePerp(text);
      const wantedAsset = String(intent.asset || "").toUpperCase();
      const asset = perpAssets.find(
        (a) => a.name.toUpperCase() === wantedAsset || a.displayName.toUpperCase() === wantedAsset
      );
      if (!asset) throw new Error(`"${intent.asset}" isn't tradable as a perp here.`);

      const isEquity = asset.category === "equity";
      const markPrice = perpMarkPrices[asset.name];

      if (intent.action === "close") {
        const positions = (isEquity ? equityPerps : cryptoPerps)?.positions || [];
        const pos = positions.find((p) => p.coin === asset.name);
        if (!pos) throw new Error(`No open ${asset.displayName} position to close.`);
        setPerpProposal({
          action: "close", asset, side: pos.side,
          markPrice: pos.markPx, notionalUsd: pos.size * pos.markPx,
          closeSize: pos.size, closeAssetIndex: pos.assetIndex, closeSzDecimals: pos.szDecimals,
          summary: intent.summary,
        });
        return;
      }

      if (intent.leverage == null) throw new Error('Say how much leverage to use, e.g. "at 5x leverage".');
      if (intent.sizeType === "unspecified") throw new Error('Say how much to trade, e.g. "with all my cash" or "$500".');

      const leverage = Math.max(1, Math.min(Math.round(intent.leverage), asset.maxLeverage || 20));
      if (!markPrice) throw new Error("No live price available for that asset right now — try again in a moment.");

      const withdrawable = (isEquity ? equityPerps : cryptoPerps)?.withdrawable ?? 0;

      let marginUsd, notionalUsd, size;
      if (intent.sizeType === "all") {
        marginUsd = withdrawable;
        size = (marginUsd * leverage) / markPrice;
      } else if (intent.sizeType === "percent") {
        marginUsd = (intent.sizeValue / 100) * withdrawable;
        size = (marginUsd * leverage) / markPrice;
      } else if (intent.sizeType === "asset_amount") {
        size = intent.sizeValue;
        marginUsd = (size * markPrice) / leverage;
      } else {
        // "usd" — a spoken dollar amount ("$500 of SOL") reads as the
        // position's notional value, not the margin behind it (unlike the
        // manual order ticket's own $ field, which pairs live with an
        // asset-amount field a user is actively watching update).
        marginUsd = intent.sizeValue / leverage;
        size = intent.sizeValue / markPrice;
      }
      notionalUsd = size * markPrice;

      if (!(marginUsd > 0) || !(size > 0)) throw new Error("That works out to a zero-size order — try a larger amount.");
      if (marginUsd > withdrawable + 0.01)
        throw new Error(`That needs $${marginUsd.toFixed(2)} margin but only $${withdrawable.toFixed(2)} is available to trade.`);

      let formattedSize;
      try { formattedSize = formatSize(String(size), asset.szDecimals ?? 0); }
      catch { throw new Error("That size is too small to place at this asset's precision."); }
      if (!(Number(formattedSize) > 0)) throw new Error("That works out to a zero-size order — try a larger amount.");

      let liqPrice = null;
      try {
        liqPrice = liquidationPrice({
          side: intent.side === "long" ? 1 : -1,
          size: Number(formattedSize),
          markPrice,
          marginAvailable: marginUsd,
          tiers: [{ lowerBound: 0, maxLeverage: asset.maxLeverage || leverage }],
        });
      } catch { liqPrice = null; }

      setPerpProposal({
        action: "open", asset, leverage, isBuy: intent.side === "long", side: intent.side,
        markPrice, marginUsd, notionalUsd, formattedSize, liqPrice, summary: intent.summary,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setThinking(false);
    }
  };

  const executePerpOrder = async () => {
    if (!perpProposal || !perpsWallet || !evmAddress) return;
    setPerpOrderBusy(true); setError("");
    try {
      if (perpProposal.action === "close") {
        // Mirrors PerpsCloseCell's close() exactly — same call, just
        // triggered from a parsed prompt instead of the Positions table.
        await hl.closePosition(perpsWallet, evmAddress, {
          assetIndex: perpProposal.closeAssetIndex,
          isLong: perpProposal.side === "long",
          size: perpProposal.closeSize,
          markPrice: perpProposal.markPrice,
          szDecimals: perpProposal.closeSzDecimals,
        });
      } else {
        await hl.setLeverage(perpsWallet, perpProposal.asset.index, perpProposal.leverage);
        const rawPrice = perpProposal.isBuy ? perpProposal.markPrice * 1.02 : perpProposal.markPrice * 0.98;
        const price = formatPrice(rawPrice, perpProposal.asset.szDecimals ?? 0);
        await hl.placeOrder(perpsWallet, evmAddress, {
          assetIndex: perpProposal.asset.index,
          isBuy: perpProposal.isBuy,
          size: perpProposal.formattedSize,
          price,
          tif: "Ioc",
        });
      }
      setPerpProposal(null);
      setRebalPrompt("");
      await refreshHoldings();
    } catch (e) {
      setError(
        e?.name === "BuilderApprovalRequiredError"
          ? "Approve perps trading first from the Perps tab, then try again."
          : (e instanceof Error ? e.message : "Order failed")
      );
    } finally {
      setPerpOrderBusy(false);
    }
  };

  /* ——— borrow/lend-via-prompt: "deposit my AAPL and borrow $500 USDC" ———
   * Same split as perps: parseBorrowPrompt() (server) only extracts what
   * was said (which xStock, a deposit size intent, a borrow size intent).
   * Resolution against real held balances, real reserve maxLTVs, and real
   * existing obligation room happens here, stopping at a confirm screen —
   * never signing straight off the parsed text. */
  const runBorrowPrompt = async (text) => {
    setThinking(true); setError("");
    try {
      const intent = await api.parseBorrow(text);
      const usdcReserve = kaminoReserves.find((r) => r.liquidityToken === "USDC");
      if (!usdcReserve) throw new Error("Borrow market data isn't available right now — try again in a moment.");

      if (["repay", "withdraw", "repay_and_withdraw"].includes(intent.action)) {
        // Repay uses Kamino's own quoted outstanding balance (tokenAmount) —
        // the authoritative "pay this much to fully close the loan" figure,
        // same source PositionCard.jsx's manual Repay tab already reads.
        const primaryDebt = kaminoDebtBorrows[0] || null;
        const repayMax = Number(primaryDebt?.tokenAmount ?? 0);
        const needsRepay = intent.action !== "withdraw";
        let repayReserve = null, repayAmt = 0, repayAmtStr = "0", isFullRepay = false;
        if (needsRepay) {
          if (repayMax <= 0) throw new Error("You don't have an outstanding Kamino loan to repay.");
          repayReserve = kaminoReserves.find((r) => r.liquidityTokenMint === primaryDebt.tokenMint);
          if (!repayReserve) throw new Error("Couldn't find the debt reserve for your loan.");
          if (intent.repaySizeType === "all") repayAmt = repayMax;
          else if (intent.repaySizeType === "percent") repayAmt = (intent.repaySizeValue / 100) * repayMax;
          else if (intent.repaySizeType === "usd") repayAmt = intent.repaySizeValue;
          if (!(repayAmt > 0)) throw new Error("That works out to a zero-size repay — try a larger amount.");
          isFullRepay = repayAmt >= repayMax;
          if (isFullRepay) {
            repayAmt = repayMax;
            // A full repay can't just send Kamino's own snapshotted debt
            // figure, even byte-exact — debt accrues interest continuously,
            // so by the time this transaction actually lands (after the
            // user reviews the confirm screen and signs) the true on-chain
            // debt is already slightly higher than what was quoted here,
            // leaving dust behind and tripping Kamino's own
            // "NetValueRemainingTooSmall" guard — confirmed as the real
            // cause of a production failure, even after fixing a separate,
            // real (but insufficient on its own) floating-point-precision
            // bug in this exact spot. Verified directly against klend's
            // real on-chain source (Reserve::calculate_repay) that a repay
            // request AT OR ABOVE the true debt is clamped down to the
            // exact amount actually owed at execution time — the same
            // mechanism its own u64::MAX "repay everything" sentinel relies
            // on — and verified live against Kamino's real hosted API that
            // it happily builds a repay tx for far more than the actual
            // debt with no balance pre-check. So: overshoot on purpose by a
            // wide, safe margin and let the chain settle the exact amount,
            // rather than trying to predict a moving target.
            repayAmtStr = String(repayMax * 1.1);
          } else {
            repayAmtStr = String(repayAmt);
          }
        }

        const needsWithdraw = intent.action !== "repay";
        let withdrawDeposit = null, withdrawReserve = null, withdrawAmt = 0, withdrawAmtStr = "0", withdrawMax = 0;
        if (needsWithdraw) {
          const wanted = intent.asset.toUpperCase();
          withdrawDeposit = kaminoCollateralDeposits.find((d) => d.tokenName?.toUpperCase().replace(/X$/, "") === wanted);
          if (!withdrawDeposit) throw new Error(`You don't have ${intent.asset} deposited as collateral.`);
          withdrawReserve = kaminoReserves.find((r) => r.liquidityTokenMint === withdrawDeposit.tokenMint);
          if (!withdrawReserve) throw new Error(`Couldn't find the reserve for ${intent.asset}.`);

          // Once the full loan is paid off (by this same command, or
          // already zero), the whole deposit unlocks — not just Kamino's
          // current maxWithdrawableAmount, which still reflects the
          // pre-repay LTV constraint. For a partial repay (or no repay at
          // all with debt still outstanding), stick with Kamino's own
          // authoritative LTV-aware figure rather than re-deriving it.
          const willFullyRepay = needsRepay ? isFullRepay : repayMax <= 0.01;
          const fullWithdrawStr = willFullyRepay ? withdrawDeposit.tokenAmount : withdrawDeposit.maxWithdrawableAmount;
          withdrawMax = Number(fullWithdrawStr ?? 0);

          if (intent.withdrawSizeType === "all") withdrawAmt = withdrawMax;
          else if (intent.withdrawSizeType === "percent") withdrawAmt = (intent.withdrawSizeValue / 100) * withdrawMax;
          else if (intent.withdrawSizeType === "units") withdrawAmt = intent.withdrawSizeValue;
          else if (intent.withdrawSizeType === "usd") {
            const impliedPrice = Number(withdrawDeposit.tokenAmount) > 0 ? Number(withdrawDeposit.tokenValue) / Number(withdrawDeposit.tokenAmount) : 0;
            withdrawAmt = impliedPrice ? intent.withdrawSizeValue / impliedPrice : 0;
          }
          if (!(withdrawAmt > 0)) throw new Error("That works out to a zero-size withdrawal — try a larger amount.");
          if (withdrawAmt > withdrawMax + 1e-6)
            throw new Error(`Only ${withdrawMax.toFixed(6)} ${withdrawDeposit.tokenName} is withdrawable right now${needsRepay ? " after that repay" : ""}.`);

          const isFullWithdraw = withdrawAmt >= withdrawMax - 1e-9;
          if (isFullWithdraw && willFullyRepay) {
            // Same overshoot-and-clamp reasoning as the full-repay case
            // above — verified in klend's withdraw handler too: once
            // borrows are empty, a withdraw request at or above the true
            // deposited amount clamps down to exactly what's deposited
            // (`deposited_amount.min(requested)`), so this is safe against
            // the deposit's own share-to-underlying exchange rate drifting
            // between this snapshot and execution (confirmed as a real,
            // continuously-moving value, not just the debt side).
            withdrawAmtStr = String(withdrawMax * 1.1);
          } else if (isFullWithdraw) {
            // Debt is still outstanding here, so the LTV-constrained
            // max-withdraw path applies instead — that clamping behavior
            // isn't confirmed to be as permissive, so stick with Kamino's
            // exact authoritative string rather than risk overshooting
            // past what's actually allowed.
            withdrawAmtStr = fullWithdrawStr;
          } else {
            withdrawAmtStr = String(withdrawAmt);
          }
        }

        setBorrowProposal({
          action: intent.action, repayReserve, repayAmt, repayAmtStr, repayMax,
          withdrawDeposit, withdrawReserve, withdrawAmt, withdrawAmtStr, withdrawMax,
          summary: intent.summary,
        });
        return;
      }

      let row = null, reserve = null, depositAmt = 0, depositValueUsd = 0, kaminoDepositAmount = 0;
      if (intent.action !== "borrow") {
        const wanted = intent.asset.toUpperCase();
        row = (portfolio?.rows || []).find((r) => r.symbol.toUpperCase().replace(/X$/, "") === wanted);
        if (!row) throw new Error(`You don't hold ${intent.asset} — nothing to deposit.`);
        reserve = kaminoReserves.find((r) => r.liquidityTokenMint === row.mint);
        if (!reserve) throw new Error(`${row.symbol} isn't accepted as collateral on Kamino's xStocks market.`);

        if (intent.depositSizeType === "all") depositAmt = row.uiAmount;
        else if (intent.depositSizeType === "percent") depositAmt = (intent.depositSizeValue / 100) * row.uiAmount;
        else if (intent.depositSizeType === "units") depositAmt = intent.depositSizeValue;
        else if (intent.depositSizeType === "usd") depositAmt = row.price ? intent.depositSizeValue / row.price : 0;
        if (!(depositAmt > 0)) throw new Error("That works out to a zero-size deposit — try a larger amount.");
        if (depositAmt > row.uiAmount + 1e-9) throw new Error(`You only hold ${row.uiAmount} ${row.symbol}.`);
        depositValueUsd = depositAmt * row.price;

        // Same Token-2022 ScaledUiAmount correction BorrowTicket.jsx uses —
        // row.uiAmount is a display value; Kamino needs the true unscaled
        // atoms-derived amount so it never asks to pull more than is held.
        const trueUnscaledMax = row.amount != null ? Number(row.amount) / 10 ** (row.decimals ?? 8) : row.uiAmount;
        kaminoDepositAmount = depositAmt >= row.uiAmount ? trueUnscaledMax : (depositAmt / row.uiAmount) * trueUnscaledMax;
      }

      // Deposits are free — a fresh deposit's borrow ceiling is its FULL
      // value × its own max LTV, not combined with unrelated existing room —
      // Kamino's cross-margin behavior across multiple different collateral
      // assets in one obligation isn't confirmed safe/simple enough to blend
      // here yet.
      const maxLtv = reserve ? Number(reserve.maxLtv) : 0;
      const maxBorrowUsd = intent.action === "borrow" ? existingBorrowRoom.roomUsd : depositValueUsd * maxLtv;

      let borrowUsd = 0;
      if (intent.action !== "deposit") {
        if (intent.borrowSizeType === "all") borrowUsd = maxBorrowUsd;
        else if (intent.borrowSizeType === "percent") borrowUsd = (intent.borrowSizeValue / 100) * maxBorrowUsd;
        else if (intent.borrowSizeType === "usd") borrowUsd = intent.borrowSizeValue;
        if (!(borrowUsd > 0)) throw new Error("That works out to a zero-size borrow — try a larger amount.");
        if (borrowUsd > maxBorrowUsd + 0.01)
          throw new Error(`That needs $${borrowUsd.toFixed(2)} of borrowing room but only $${maxBorrowUsd.toFixed(2)} is available.`);
      }
      // 0.10% platform fee on the borrow leg only, taken in USDC.
      const borrowFeeUsd = borrowUsd * (KAMINO_FEE_BPS / 10000);
      const netBorrowUsd = borrowUsd - borrowFeeUsd;

      setBorrowProposal({
        action: intent.action, row, reserve, usdcReserveKey: usdcReserve.reserve,
        depositAmt, depositValueUsd, kaminoDepositAmount, maxLtv,
        borrowUsd, borrowFeeUsd, netBorrowUsd, maxBorrowUsd, summary: intent.summary,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setThinking(false);
    }
  };

  const executeBorrowProposal = async () => {
    if (!borrowProposal || !address) return;
    setBorrowActionBusy(true); setError("");

    if (["repay", "withdraw", "repay_and_withdraw"].includes(borrowProposal.action)) {
      try {
        if (borrowProposal.action !== "withdraw") {
          await executeKaminoAction("repay", {
            wallet: address, reserve: borrowProposal.repayReserve.reserve,
            amount: borrowProposal.repayAmtStr,
            signWithWallet: signKaminoTx,
          });
        }
      } catch (e) {
        setBorrowActionBusy(false);
        setError(e instanceof Error ? e.message : "Repay failed");
        return;
      }
      try {
        if (borrowProposal.action !== "repay") {
          await executeKaminoAction("withdraw", {
            wallet: address, reserve: borrowProposal.withdrawReserve.reserve,
            amount: borrowProposal.withdrawAmtStr,
            signWithWallet: signKaminoTx,
          });
        }
        setBorrowProposal(null);
        setRebalPrompt("");
      } catch (e) {
        setError(
          borrowProposal.action === "repay_and_withdraw"
            ? `Repaid, but withdraw failed: ${e instanceof Error ? e.message : "unknown error"}. Check My Positions — you can withdraw from there.`
            : (e instanceof Error ? e.message : "Withdraw failed")
        );
      } finally {
        setBorrowActionBusy(false);
        await refreshKaminoLoans();
        await refreshHoldings();
      }
      return;
    }

    try {
      if (borrowProposal.action !== "borrow") {
        await executeKaminoAction("deposit", {
          wallet: address, reserve: borrowProposal.reserve.reserve,
          amount: String(borrowProposal.kaminoDepositAmount),
          signWithWallet: signKaminoTx,
          mint: borrowProposal.row.mint, decimals: borrowProposal.row.decimals,
          usdValue: borrowProposal.depositValueUsd,
        });
      }
    } catch (e) {
      setBorrowActionBusy(false);
      setError(e instanceof Error ? e.message : "Deposit failed");
      return;
    }
    try {
      if (borrowProposal.action !== "deposit") {
        await executeKaminoAction("borrow", {
          wallet: address, reserve: borrowProposal.usdcReserveKey,
          amount: String(borrowProposal.borrowUsd),
          signWithWallet: signKaminoTx,
        });
      }
      setBorrowProposal(null);
      setRebalPrompt("");
    } catch (e) {
      setError(
        borrowProposal.action === "deposit_and_borrow"
          ? `Deposited, but borrow failed: ${e instanceof Error ? e.message : "unknown error"}. Check My Positions — you can borrow from there.`
          : (e instanceof Error ? e.message : "Borrow failed")
      );
    } finally {
      setBorrowActionBusy(false);
      await refreshKaminoLoans();
      await refreshHoldings();
    }
  };

  /* ——— execute a list of trades sequentially, for real ——— */
  const runTrades = async (trades, { afterWithdrawTo = null, groupLabel = "Rebalance" } = {}) => {
    if (busy.current) return;
    busy.current = true;
    setLegs(trades.map((t) => ({ ...t, status: "queued", sig: null })));
    setExecuteOpen(true);
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
            usdValue: t.usd,
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
                usdValue: usdyUsd,
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
              usdValue: t.usd,
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
                usdValue: usdcBal,
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
              const result = await executeSwap({ inputMint: registry.USDY.mint, outputMint: registry.USDC.mint, amount: usdyAtoms, taker: address, signWithWallet, onStatus: (s) => setConv({ status: s }), usdValue: usdyUsd });
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
    // Review-before-execute, same as the rebalance path already has — reuses
    // the "Proposed change" modal (and its impact-preview effect) rather than
    // calling runTrades directly, which used to skip straight to execution
    // with no confirm step and no slippage visibility at all.
    setProposal({ trades, pendingWithdrawal: plan.pendingWithdrawal ?? null });
  };

  // Single-asset quick buy, triggered from the Equities Markets page — same
  // review-before-execute pipeline as executeBuild/rebalance above (one
  // trade instead of many), not a separate execution path. The proposal
  // modal only renders as part of the "dash" screen, so this also switches
  // back to it — otherwise setting proposal alone would be invisible while
  // still on the Equities Markets screen.
  const quickBuy = (row, usdAmount) => {
    setProposal({
      trades: [{
        symbol: row.symbol, side: "buy", usd: usdAmount,
        inputMint: registry.USDC.mint, outputMint: row.mint,
        amount: Math.floor(usdAmount * 10 ** registry.USDC.decimals),
      }],
      pendingWithdrawal: null,
    });
    setView("auto");
  };

  // Single-asset quick sell, triggered from the main dashboard's Positions
  // table (SellModal) — same review-before-execute pipeline as quickBuy
  // above, source/destination mints swapped. Caps the trade to the exact
  // on-chain balance (row.amount, raw atoms) rather than a price-derived
  // figure, same reasoning planTrades already uses: a requested amount
  // right at (or nominally over, via the modal's own rounding) the full
  // position's dollar value must still resolve to selling the exact
  // holding, not slightly over/under it from a $ -> shares roundtrip.
  const quickSell = (row, usdAmount) => {
    const isFullSell = usdAmount >= row.value - 0.01;
    const decimals = registry[row.symbol]?.decimals ?? 6;
    const atoms = isFullSell
      ? Number(row.amount || 0)
      : Math.min(
          Math.floor(Math.min(usdAmount / (row.price || 1), row.uiAmount || 0) * 10 ** decimals),
          Number(row.amount || 0),
        );
    setProposal({
      trades: [{
        symbol: row.symbol, side: "sell", usd: usdAmount,
        inputMint: row.mint, outputMint: registry.USDC.mint,
        amount: atoms,
      }],
      pendingWithdrawal: null,
    });
    setView("auto");
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
    registry?.[sym]?.category === "yield" ? "Yield" : sym === "BTC" ? "Crypto" : sym === "EURC" ? "Currency"
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
    : view === "weights" && plan ? "weights"
    : view === "build" ? "build"
    : view === "history" ? "history"
    : view === "equities" ? "equities"
    : view === "predictions" ? "predictions"
    : view === "perps" ? "perps"
    : view === "borrow" ? "borrow"
    : view === "agents" ? "agents"
    : view === "referrals" ? "referrals"
    : "dash";

  return (
    <div className="lv-root">
      <header className="lv-head">
        <div className="head-left">
          <button className="wordmark wordmark-btn" onClick={() => setView("auto")}>
            <img className="wordmark-logo" src="/bonsai-icon.png" alt="" />
            Bonzai Trading
          </button>
        </div>
        {screen === "auth" && (
          <div className="head-right">
            <button className="head-nav-btn" onClick={login}>Log in</button>
          </div>
        )}
        {address && (
          <div className="head-right head-right-authed">
            <button className={`head-nav-btn ${screen === "equities" ? "active" : ""}`} onClick={() => setView("equities")}>Equities Markets</button>
            <button className={`head-nav-btn ${screen === "predictions" ? "active" : ""}`} onClick={() => setView("predictions")}>Prediction Markets</button>
            <button className={`head-nav-btn ${screen === "perps" ? "active" : ""}`} onClick={() => setView("perps")}>Perpetual Futures Markets</button>
            <button className={`head-nav-btn ${screen === "borrow" ? "active" : ""}`} onClick={() => setView("borrow")}>Borrow / Lend Markets</button>
            <button className={`head-nav-btn ${screen === "agents" ? "active" : ""}`} onClick={() => setView("agents")}>Trading Agent</button>
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
                  <button className="profile-menu-item" onClick={() => { setView("referrals"); setProfileOpen(false); }}>Refer & Earn</button>
                  <div className="profile-menu-divider" />
                  <button className="profile-menu-item danger" onClick={logout}>Sign Out</button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {address && (
        <BottomTabBar screen={screen} setView={setView} setProfileModal={setProfileModal} logout={logout} />
      )}

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
                  1. Open the bot on Telegram, get a code, then message it as <span className="mono">/link 123456</span>.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <a className="btn ghost" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
                    Open @{TELEGRAM_BOT_USERNAME} →
                  </a>
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
                </div>
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

      {screen === "history" && (
        <HistoryScreen txHistory={txHistory} onBack={() => setView("auto")} />
      )}

      {screen === "equities" && (
        <EquitiesMarketsApp onBack={() => setView("auto")} onQuickBuy={quickBuy}
          availableCash={portfolio?.cashUsdc ?? portfolio?.cash ?? 0} />
      )}

      {screen === "predictions" && (
        <PredictionMarketsApp onBack={() => setView("auto")} />
      )}

      {screen === "perps" && (
        <PerpsApp solanaAddress={address} solBalance={holdings?.sol ?? 0} usdcBalance={portfolio?.cashUsdc ?? 0} onBack={() => setView("auto")} />
      )}

      {screen === "borrow" && (
        <BorrowApp solanaAddress={address} solBalance={holdings?.sol ?? 0} portfolioRows={portfolio?.rows ?? []} onBack={() => setView("auto")} />
      )}

      {screen === "agents" && (
        <TradingAgentApp solanaAddress={address} signWithWallet={signWithWallet} onBack={() => setView("auto")}
          telegramCode={telegramCode} telegramCodeBusy={telegramCodeBusy} telegramCodeErr={telegramCodeErr} getTelegramLinkCode={getTelegramLinkCode}
          botTradingEnabled={botTradingEnabled} botTradingBusy={botTradingBusy} toggleBotTrading={toggleBotTrading}
          evmAddress={evmAddress} hlCtx={{ hl, perpsWallet, evmAddress, hlAssets: perpAssets, markPrices: perpMarkPrices }} />
      )}

      {screen === "referrals" && (
        <ReferralsApp onBack={() => setView("auto")} />
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
                  placeholder={'"Buy SPY and QQQ" · "Go long BTC at 5x leverage" · "Lend my TSLA and borrow cash"'}
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
          <div className="dash-tabs-left">
            {dashProduct === "brokerage" && (
              <div className="watch-tabs-row">
                {(showAllWatchTabs ? watchedPortfolios : watchedPortfolios.slice(0, 4)).map((w) => (
                  <button key={w.address} className={`watch-tab ${activeAllocTab === w.address ? "active" : ""}`}
                    onClick={() => setActiveAllocTab(activeAllocTab === w.address ? "mine" : w.address)}>
                    {w.label}
                    <span className="alloc-tab-x" onClick={(e) => { e.stopPropagation(); removeWatchedPortfolio(w.address); }}>×</span>
                  </button>
                ))}
                {!showAllWatchTabs && watchedPortfolios.length > 4 && (
                  <button className="watch-tab watch-tab-more" onClick={() => setShowAllWatchTabs(true)}>
                    +{watchedPortfolios.length - 4} more
                  </button>
                )}
                {showAllWatchTabs && watchedPortfolios.length > 4 && (
                  <button className="watch-tab watch-tab-more" onClick={() => setShowAllWatchTabs(false)}>
                    Show less
                  </button>
                )}
                <button className="watch-tab watch-tab-add" title="Watch another portfolio"
                  onClick={() => setAddPortfolioOpen(true)}>+</button>
              </div>
            )}
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
              <button className={`dash-product-tab ${dashProduct === "markets" ? "active" : ""}`}
                onClick={() => setDashProduct("markets")}>
                View Markets
              </button>
            </div>
          </div>
          <form className="news-search-row" onSubmit={runNewsSearch}>
            <input className="perps-asset-search news-search-input"
              placeholder="Search news — e.g. $TSLA"
              value={newsSearchInput}
              onChange={(e) => setNewsSearchInput(e.target.value)} />
            {newsSearchSymbol && (
              <button type="button" className="btn ghost news-search-clear" onClick={clearNewsSearch}>Clear</button>
            )}
          </form>
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

                {activeAllocTab !== "mine" && (
                  <div className="watch-readonly-banner">
                    <span>Viewing {watchedPortfolios.find((w) => w.address === activeAllocTab)?.label} — read only</span>
                    <button className="btn ghost" onClick={() => setActiveAllocTab("mine")}>← Back to my dashboard</button>
                  </div>
                )}

                {!viewedPortfolio ? (
                  <div className="loading-dots" style={{ margin: "24px 0" }}><span /><span /><span /></div>
                ) : (
                <>
                <Donut rows={displayPortfolio.rows} cash={displayPortfolio.cash} total={displayPortfolio.total} cashUsdy={displayPortfolio.cashUsdy} onAssetClick={setAssetInfoSymbol} />
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
                <div className="lvp-pnl-header-row">
                  <div>
                    <p className="lvp-muted" style={{ marginBottom: 2 }}>Portfolio Value</p>
                    {statsPoints.length >= 2 ? (() => {
                      const first = statsPoints[0].v, last = statsPoints[statsPoints.length - 1].v;
                      const pct = first > 0 ? ((last - first) / first) * 100 : null;
                      return (
                        <p className="lvp-pnl-focal">
                          {priceLabel(last)}
                          {pct != null && (
                            <span className={`lvp-pnl-focal-chip mono ${pct >= 0 ? "gain" : "loss"}`}>
                              {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                            </span>
                          )}
                        </p>
                      );
                    })() : (
                      <p className="lvp-pnl-focal lvp-muted" style={{ fontSize: 28 }}>—</p>
                    )}
                  </div>
                  <div className="lvp-pnl-periods">
                    {DASH_STATS_PERIODS.map((p) => (
                      <button key={p.key} className={`lvp-pct-btn ${statsPeriod === p.key ? "sel" : ""}`}
                        onClick={() => setStatsPeriod(p.key)}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <TimeSeriesChart key={statsPeriod} points={statsPoints} period={statsPeriod} loading={false} mode="price"
                  emptyText="History builds up over time — check back soon." />
              </div>
            </div>
          </div>
          )}

          {dashProduct === "perps" && (
          <div className="card" style={{ marginBottom: 26 }}>
            <div className="card-toprow">
              <p className="table-card-title">Perpetual Futures Account</p>
              <button className="stats-toggle-btn" onClick={() => setView("perps")}>Trade Perps →</button>
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
              <button className="stats-toggle-btn" onClick={() => setView("borrow")}>Borrow / Lend →</button>
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

          {dashProduct === "markets" && <MarketsExplorer registry={registry} />}

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
            <div className="trow thead tiny label" style={{ gridTemplateColumns: "1.6fr .8fr 1.1fr .8fr .55fr .55fr" }}>
              <span>Asset</span>
              <span>Price / token</span>
              <span>Quantity</span>
              <span>Market value</span>
              <span>Allocation</span>
              <span></span>
            </div>
            {visibleRows.map((r) => {
              const category = assetCategory(r.symbol);
              const clickable = category === "Stock" || category === "ETF" || category === "Crypto";
              return (
                <div className={`trow ${clickable ? "asset-row-clickable" : ""}`} key={r.symbol}
                  style={{ gridTemplateColumns: "1.6fr .8fr 1.1fr .8fr .55fr .55fr" }}
                  onClick={clickable ? () => setAssetInfoSymbol(r.symbol) : undefined}>
                  <span className="asset">
                    <span className="serif">{r.name}</span>
                    <span className="mono tiny muted">{r.symbol} · {category}</span>
                  </span>
                  <span className="mono">{r.priceUnavailable ? "—" : `$${usd(r.price)}`}</span>
                  <span className="mono">{fmtQty(r.uiAmount)}<span className="muted tiny"> {r.symbol}</span></span>
                  <span className="mono">{r.priceUnavailable ? <span className="tiny muted">Price unavailable</span> : `$${usd(r.value)}`}</span>
                  <span className="mono">{r.priceUnavailable ? "—" : <>{r.weight.toFixed(1)}<span className="muted tiny">%</span></>}</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                    {kaminoReserveByMint.has(r.mint) && (
                      <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 12 }}
                        disabled={r.priceUnavailable}
                        onClick={(e) => { e.stopPropagation(); setLendTarget(r); }}>
                        Lend
                      </button>
                    )}
                    <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 12 }}
                      disabled={r.priceUnavailable}
                      onClick={(e) => { e.stopPropagation(); setSellTarget(r); }}>
                      Sell
                    </button>
                  </span>
                </div>
              );
            })}
            {yieldMode && portfolio.usdyAmount > 0.5 && (
              <div className="trow cashrow yield-cash-row" style={{ gridTemplateColumns: "1.6fr .8fr 1.1fr .8fr .55fr .55fr" }}>
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
                <span></span>
              </div>
            )}
            {(!yieldMode || portfolio.cashUsdc > 0.01) && (
              <div className="trow cashrow" style={{ gridTemplateColumns: "1.6fr .8fr 1.1fr .8fr .55fr .55fr" }}>
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
                <span></span>
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
            {perpsPositions.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0" }}>No open positions.</p>
            ) : (
              <div className="positions-table-wrap">
                <table className="positions-table">
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
                    {perpsPositions.map((p) => (
                      <tr key={`${p.dex}-${p.coin}`}>
                        <td className="pt-asset">
                          <span className="asset">
                            <span className="serif">{p.coin}</span>
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
                        <td data-label="Mark price">${usd(p.markPx)}</td>
                        <td data-label="Liq. price">{p.health.liquidationPrice != null ? `$${usd(p.health.liquidationPrice)}` : "—"}</td>
                        <td data-label="Unrealized PnL" className={`pos-pnl ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>{p.unrealizedPnl >= 0 ? "+" : ""}${usd(p.unrealizedPnl)}</td>
                        <td data-label="Leverage"><span className="pos-leverage-chip">{p.leverage}x</span></td>
                        <td className="pt-action"><PerpsCloseCell p={p} hl={hl} user={evmAddress} tradingWallet={perpsWallet} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}

          {dashProduct === "borrow" && (
          <section className="card table-card">
            <div className="card-toprow">
              <p className="table-card-title">Positions</p>
            </div>
            {kaminoLoans.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0" }}>No open borrow positions.</p>
            ) : (
              <div className="positions-table-wrap">
                <table className="positions-table">
                  <thead>
                    <tr>
                      <th className="pt-asset">Asset</th>
                      <th>Collateral</th>
                      <th>Borrowed</th>
                      <th>Current LTV</th>
                      <th>Liquidation LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kaminoLoans.map((loan) => {
                      const info = loan.loanInfo ?? {};
                      const deposits = info.collateral?.deposits ?? [];
                      const borrows = info.debt?.borrows ?? [];
                      const collateralVal = deposits.reduce((s, d) => s + (Number(d.tokenValue) || 0), 0);
                      const debtVal = borrows.reduce((s, d) => s + (Number(d.tokenValue) || 0), 0);
                      const assetName = deposits.map((d) => d.tokenName).join(" + ") || "—";
                      const debtName = borrows.map((d) => d.tokenName).join(" + ") || "—";
                      return (
                        <tr key={loan.loanId}>
                          <td className="pt-asset">
                            <span className="asset">
                              <span className="serif">{assetName}</span>
                              <span className="tiny muted">Borrowed {debtName}</span>
                            </span>
                          </td>
                          <td data-label="Collateral">${usd(collateralVal)}</td>
                          <td data-label="Borrowed">${usd(debtVal)}</td>
                          <td data-label="Current LTV">{((Number(info.currentLtv) || 0) * 100).toFixed(1)}%</td>
                          <td data-label="Liquidation LTV">{((Number(info.liquidationLtv) || 0) * 100).toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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

          {sellTarget && (
            <SellModal
              row={sellTarget}
              onClose={() => setSellTarget(null)}
              onConfirm={(usdAmount) => {
                quickSell(sellTarget, usdAmount);
                setSellTarget(null);
              }}
            />
          )}

          {lendTarget && (
            <LendModal
              row={lendTarget}
              reserve={kaminoReserveByMint.get(lendTarget.mint)}
              wallet={address}
              signWithWallet={signKaminoTx}
              solBalance={holdings?.sol ?? 0}
              onClose={() => setLendTarget(null)}
              onDone={refreshKaminoLoans}
            />
          )}

          {perpProposal && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !perpOrderBusy && setPerpProposal(null)}>
              <div className="modal-box card" style={{ maxWidth: 380 }}>
                <p className="tiny label">
                  {perpProposal.action === "close"
                    ? `Close ${perpProposal.side} ${perpProposal.asset.displayName}`
                    : `${perpProposal.side === "long" ? "Long" : "Short"} ${perpProposal.asset.displayName} ${perpProposal.leverage}x`}
                </p>
                {perpProposal.summary && <p className="lede sm">{perpProposal.summary}</p>}
                <div className="borrow-field" style={{ marginTop: 10 }}>
                  <span className="tiny muted">Position size</span>
                  <span className="mono">
                    {perpProposal.action === "close" ? perpProposal.closeSize : perpProposal.formattedSize} {perpProposal.asset.displayName} (${usd(perpProposal.notionalUsd)})
                  </span>
                </div>
                {perpProposal.action !== "close" && (
                  <div className="borrow-field">
                    <span className="tiny muted">Margin required</span>
                    <span className="mono">${usd(perpProposal.marginUsd)}</span>
                  </div>
                )}
                <div className="borrow-field">
                  <span className="tiny muted">Mark price</span>
                  <span className="mono">${usd(perpProposal.markPrice)}</span>
                </div>
                {perpProposal.liqPrice != null && (
                  <div className="borrow-field">
                    <span className="tiny muted">Est. liquidation price</span>
                    <span className="mono">${usd(perpProposal.liqPrice)}</span>
                  </div>
                )}
                <div className="wfoot" style={{ marginTop: 12 }}>
                  <button className="btn ghost" disabled={perpOrderBusy} onClick={() => setPerpProposal(null)}>Discard</button>
                  <button className="btn primary" disabled={perpOrderBusy} onClick={executePerpOrder}>
                    {perpOrderBusy
                      ? (perpProposal.action === "close" ? "Closing…" : "Placing…")
                      : (perpProposal.action === "close" ? "Close position →" : `${perpProposal.side === "long" ? "Long" : "Short"} ${perpProposal.asset.displayName} →`)}
                  </button>
                </div>
              </div>
            </div>
          )}

          {borrowProposal && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !borrowActionBusy && setBorrowProposal(null)}>
              <div className="modal-box card" style={{ maxWidth: 380 }}>
                <p className="tiny label">
                  {borrowProposal.action === "deposit" && `Deposit ${borrowProposal.row.symbol} as collateral`}
                  {borrowProposal.action === "borrow" && "Borrow USDC"}
                  {borrowProposal.action === "deposit_and_borrow" && `Deposit ${borrowProposal.row.symbol} & borrow USDC`}
                  {borrowProposal.action === "repay" && "Repay loan"}
                  {borrowProposal.action === "withdraw" && `Withdraw ${borrowProposal.withdrawDeposit.tokenName}`}
                  {borrowProposal.action === "repay_and_withdraw" && `Repay loan & withdraw ${borrowProposal.withdrawDeposit.tokenName}`}
                </p>
                {borrowProposal.summary && <p className="lede sm">{borrowProposal.summary}</p>}

                {(borrowProposal.action === "deposit" || borrowProposal.action === "deposit_and_borrow") && (
                  <div className="borrow-field" style={{ marginTop: 10 }}>
                    <span className="tiny muted">Deposit</span>
                    <span className="mono">
                      {borrowProposal.depositAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} {borrowProposal.row.symbol} (${usd(borrowProposal.depositValueUsd)}) · max LTV {(borrowProposal.maxLtv * 100).toFixed(0)}% · no deposit fee
                    </span>
                  </div>
                )}
                {(borrowProposal.action === "borrow" || borrowProposal.action === "deposit_and_borrow") && (<>
                  <div className="borrow-field">
                    <span className="tiny muted">Borrow</span>
                    <span className="mono">${usd(borrowProposal.borrowUsd)} USDC (of ${usd(borrowProposal.maxBorrowUsd)} available)</span>
                  </div>
                  <div className="borrow-field">
                    <span className="tiny muted">Platform fee ({(KAMINO_FEE_BPS / 100).toFixed(2)}%)</span>
                    <span className="mono">${usd(borrowProposal.borrowFeeUsd)} · ${usd(borrowProposal.netBorrowUsd)} net received</span>
                  </div>
                </>)}
                {(borrowProposal.action === "repay" || borrowProposal.action === "repay_and_withdraw") && (
                  <div className="borrow-field" style={{ marginTop: 10 }}>
                    <span className="tiny muted">Repay</span>
                    <span className="mono">{borrowProposal.repayAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC (of {borrowProposal.repayMax.toLocaleString(undefined, { maximumFractionDigits: 6 })} owed)</span>
                  </div>
                )}
                {(borrowProposal.action === "withdraw" || borrowProposal.action === "repay_and_withdraw") && (
                  <div className="borrow-field">
                    <span className="tiny muted">Withdraw</span>
                    <span className="mono">{borrowProposal.withdrawAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} {borrowProposal.withdrawDeposit.tokenName} (of {borrowProposal.withdrawMax.toLocaleString(undefined, { maximumFractionDigits: 6 })} available)</span>
                  </div>
                )}
                <div className="wfoot" style={{ marginTop: 12 }}>
                  <button className="btn ghost" disabled={borrowActionBusy} onClick={() => setBorrowProposal(null)}>Discard</button>
                  <button className="btn primary" disabled={borrowActionBusy} onClick={executeBorrowProposal}>
                    {borrowActionBusy ? "Waiting for signature…" : "Confirm →"}
                  </button>
                </div>
              </div>
            </div>
          )}

          </div>{/* dash-main */}

          <NewsPanel
            symbols={
              portfolio.rows.length > 0
                ? portfolio.rows.map((r) => r.symbol)
                : ["SPYx", "AAPLx", "TSLAx"]
            }
            searchSymbol={newsSearchSymbol}
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
                    {proposal.trades.map((t, i) => {
                      const badge = impactBadge(proposalImpacts[t.symbol]);
                      return (
                        <span key={i} className={`trade-chip mono tiny ${t.side}`}>
                          {t.side === "buy" ? "Buy" : "Sell"} ${usd(t.usd)} {t.symbol}
                          {badge && <span className={`tiny ${badge.className}`} style={{ marginLeft: 6 }}>· {badge.label}</span>}
                        </span>
                      );
                    })}
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

      {executeOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy.current && setExecuteOpen(false)}>
          <div className="modal-box card card-pop exec-card exec-modal-box">
            <div className="card-toprow">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Executing</p>
                <p className="table-card-title" style={{ marginTop: 4 }}>Routing your swaps</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="tiny muted mono">
                  {legs.filter((l) => l.status === "confirmed").length} / {legs.length} confirmed
                </span>
                {!busy.current && <button className="x" onClick={() => setExecuteOpen(false)}>×</button>}
              </div>
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
            {!busy.current && (
              <button className="btn primary" style={{ marginTop: 20, width: "100%" }}
                onClick={() => setExecuteOpen(false)}>
                Done
              </button>
            )}
            <p className="tiny muted center" style={{ marginTop: 12 }}>
              {sponsored ? "Gas fees sponsored — no SOL required." : "Network fees paid in SOL from your wallet."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
