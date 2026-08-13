import { useEffect, useId, useRef, useState } from "react";

const WIDGET_SRC = "https://app.debridge.com/assets/scripts/widget.js";
// DLN's own chain identifier for Solana — distinct from any EVM chain id,
// per deBridge's widget docs. Not derivable from our own token registry
// (that only has the mint address, not deBridge's chain-id scheme).
const DLN_SOLANA_CHAIN_ID = 7565164;
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Script tag is shared/cached across every mount — the widget script
// self-registers a global `window.deBridge`, so loading it twice would
// just race two copies of the same script for no benefit.
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
 * wallet connection and chain/token selection for whatever source chain
 * the user picks, and settles directly into `solanaAddress` (their own
 * wallet — we never custody the funds mid-transfer). Output side is
 * locked to Solana USDC; the input side is left open so any chain/token
 * the widget supports works, not just USDC specifically.
 */
export default function CrossChainDeposit({ solanaAddress }) {
  const containerId = `debridge-widget-${useId().replace(/:/g, "")}`;
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWidgetScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // No documented destroy() on the widget API — clearing the
        // container ourselves before re-init covers the modal
        // close/reopen case without leaking a duplicate instance.
        containerRef.current.innerHTML = "";
        window.deBridge.widget({
          element: containerId,
          v: "1",
          mode: "deswap",
          width: "380",
          height: "640",
          outputChain: DLN_SOLANA_CHAIN_ID,
          outputCurrency: SOLANA_USDC_MINT,
          address: solanaAddress,
          lang: "en",
          theme: "light",
        });
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [containerId, solanaAddress]);

  return (
    <div className="cross-chain-deposit">
      {loading && <p className="tiny muted center" style={{ margin: "24px 0" }}>Loading bridge…</p>}
      {error && <p className="err tiny center" style={{ margin: "24px 0" }}>{error}</p>}
      <div id={containerId} ref={containerRef} />
      <p className="tiny muted center" style={{ marginTop: 10 }}>
        Powered by deBridge · funds arrive as USDC in your Bonzai wallet on Solana
      </p>
    </div>
  );
}
