import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * MoonPay's on-ramp is a hosted page, not a JS widget — the server signs
 * the URL (currencyCode + walletAddress locked to USDC-on-Solana + the
 * user's own wallet, see /api/moonpay/widget-url) and this just iframes
 * it. baseCurrencyCode is left unset server-side so MoonPay auto-detects
 * the visitor's local fiat currency and payment methods from their IP —
 * that's what makes this work for non-US buyers without us maintaining
 * our own country/currency list.
 */
export default function MoonPayDeposit() {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.moonpayWidgetUrl()
      .then((r) => { if (!cancelled) setUrl(r.url); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="cross-chain-deposit">
      {error && <p className="err tiny center" style={{ margin: "24px 0" }}>{error}</p>}
      {!error && !url && <p className="tiny muted center" style={{ margin: "24px 0" }}>Loading…</p>}
      {url && (
        <iframe
          src={url}
          title="Buy USDC with card"
          className="moonpay-frame"
          allow="payment; camera; microphone"
        />
      )}
      <p className="tiny muted center" style={{ marginTop: 10 }}>
        Powered by MoonPay · card, Apple Pay, and local payment methods worldwide
      </p>
    </div>
  );
}
