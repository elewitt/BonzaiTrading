import { useEffect, useId, useRef, useState } from "react";

const WIDGET_SRC = "https://app.debridge.com/assets/scripts/widget.js";
// DLN's own chain identifier for Solana — distinct from any EVM chain id,
// per deBridge's widget docs. Not derivable from our own token registry
// (that only has the mint address, not deBridge's chain-id scheme).
const DLN_SOLANA_CHAIN_ID = 7565164;
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// The widget has no real token allowlist — inputChain/inputCurrency are
// just presets the user can still change inside the widget's own token
// picker, not a hard lock. So the actual restriction happens here: our
// own chain picker is the only thing offered up front, USDC only, one
// button per chain — the widget only ever opens already preset to the
// exact pair the user chose, so there's normally no reason to touch its
// token selector at all. Native (Circle-issued) USDC addresses, not
// bridged USDC.e variants — verified against Circle's own contract list.
const CHAINS = [
  { id: "ethereum", label: "Ethereum", evmChainId: 1,     usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { id: "base",     label: "Base",     evmChainId: 8453,  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { id: "arbitrum", label: "Arbitrum", evmChainId: 42161, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { id: "optimism", label: "Optimism", evmChainId: 10,    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { id: "polygon",  label: "Polygon",  evmChainId: 137,   usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  { id: "avalanche",label: "Avalanche",evmChainId: 43114, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
];

// Re-themed to the app's own paper/pine palette instead of the widget's
// default look — keeps this feeling like part of Bonzai rather than a
// dropped-in third-party frame. Base64-encoded JSON per the widget's
// `styles` param.
const WIDGET_STYLES = btoa(JSON.stringify({
  appBackground: "#FAFBF8",
  appAccentBg: "#EDEFE9",
  chartBg: "#EDEFE9",
  primary: "#1A4433",
  secondary: "#5A6C62",
  badge: "#84631A",
  borderColor: "#D2D8CE",
  borderRadius: 12,
  fontColor: "#0F1F18",
  fontColorAccent: "#1A4433",
  fontFamily: "Instrument Sans",
}));

let widgetScriptPromise = null;
function loadWidgetScript() {
  if (widgetScriptPromise) return widgetScriptPromise;
  widgetScriptPromise = new Promise((resolve, reject) => {
    if (window.deBridge) return resolve();
    const s = document.createElement("script");
    s.src = WIDGET_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load the bridge widget — check your connection and try again."));
    document.head.appendChild(s);
  });
  return widgetScriptPromise;
}

/**
 * Embeds deBridge's own hosted cross-chain widget rather than building a
 * custom multi-chain wallet-connect flow ourselves — the widget handles
 * wallet connection and the actual swap for whatever chain the user
 * picks below, and settles directly into `solanaAddress` (their own
 * wallet — we never custody the funds mid-transfer).
 */
export default function CrossChainDeposit({ solanaAddress }) {
  const containerId = `debridge-widget-${useId().replace(/:/g, "")}`;
  const containerRef = useRef(null);
  const [chain, setChain] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chain) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await loadWidgetScript();
        if (cancelled || !containerRef.current) return;
        // No documented destroy() on the widget API — clearing the
        // container ourselves before re-init covers both the modal
        // close/reopen case and switching chains without leaking a
        // duplicate instance.
        containerRef.current.innerHTML = "";

        // Init with ONLY the output side set (outputChain/outputCurrency/
        // address) — confirmed via direct testing that also setting
        // inputChain/inputCurrency in this same init call makes the
        // widget silently drop the output-token lock and default "You
        // receive" to native SOL instead of USDC. Setting the input side
        // afterward via the documented changeInputChain/changeInputToken
        // methods on the resolved instance avoids that bug entirely.
        const inst = await window.deBridge.widget({
          element: containerId,
          v: "1",
          mode: "deswap",
          width: "380",
          height: "600",
          outputChain: DLN_SOLANA_CHAIN_ID,
          outputCurrency: SOLANA_USDC_MINT,
          address: solanaAddress,
          lang: "en",
          theme: "light",
          styles: WIDGET_STYLES,
        });
        if (cancelled) return;
        await inst.changeInputChain(chain.evmChainId);
        if (cancelled) return;
        await inst.changeInputToken(chain.usdc);
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [chain, containerId, solanaAddress]);

  if (!chain) {
    return (
      <div className="cross-chain-deposit">
        <p className="tiny muted center" style={{ margin: "4px 0 14px" }}>
          Send USDC from any of these chains — it arrives as USDC in your wallet on Solana.
        </p>
        <div className="cc-chain-grid">
          {CHAINS.map((c) => (
            <button key={c.id} className="cc-chain-btn" onClick={() => setChain(c)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cross-chain-deposit">
      <button className="cc-change-chain" onClick={() => setChain(null)}>← Choose a different chain</button>
      {loading && <p className="tiny muted center" style={{ margin: "24px 0" }}>Loading…</p>}
      {error && <p className="err tiny center" style={{ margin: "24px 0" }}>{error}</p>}
      <div id={containerId} ref={containerRef} />
      <p className="tiny muted center" style={{ marginTop: 10 }}>
        Powered by deBridge · sending USDC from {chain.label} to your Bonzai wallet on Solana
      </p>
    </div>
  );
}
