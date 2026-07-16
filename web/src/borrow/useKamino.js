import { useCallback, useEffect, useState } from "react";
import { api, executeKaminoAction, stripKaminoDust } from "../lib/api.js";

/** All reserves in Kamino's xStocks Market — collateral options + USDC. Polled, not fast-moving. */
export function useKaminoReserves(pollMs = 60_000) {
  const [reserves, setReserves] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const data = await api.kaminoReserves();
        if (!stop) { setReserves(data); setError(null); }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const h = setInterval(tick, pollMs);
    return () => { stop = true; clearInterval(h); };
  }, [pollMs]);

  return { reserves, error };
}

/**
 * A user's open obligations (borrow positions) in the xStocks market, each
 * enriched with its full loan detail (currentLtv, liquidationLtv, collateral,
 * debt) — two-step because the obligations list endpoint doesn't include
 * this detail itself (confirmed against the live API: it's just an array of
 * obligation pubkeys/summaries).
 */
export function useKaminoPositions(address, pollMs = 15_000) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address) { setPositions([]); setLoading(false); return; }
    let stop = false;

    const tick = async () => {
      try {
        const obligations = await api.kaminoObligations(address);
        const pubkeys = (obligations || []).map((o) => o.obligationAddress ?? o.obligation ?? o.pubkey).filter(Boolean);
        const details = await Promise.all(
          pubkeys.map((pk) => api.kaminoLoan(pk).catch(() => null)),
        );
        if (stop) return;
        setPositions(stripKaminoDust(details.filter(Boolean)));
        setError(null);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!stop) setLoading(false);
      }
    };
    void tick();
    const h = setInterval(tick, pollMs);
    return () => { stop = true; clearInterval(h); };
  }, [address, pollMs]);

  return { positions, loading, error };
}

/**
 * Deposit / borrow / repay / withdraw against the xStocks market. Each call
 * is a single real signature — never triggered from a poll/timer, only a
 * direct user click, same rule established for every other signing flow in
 * this app (Privy's embedded-wallet signing is unreliable otherwise).
 */
export function useKaminoAction(wallet, signWithWallet) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async (action, { reserve, amount }) => {
    if (!wallet || !signWithWallet) { setError("Wallet not ready"); return null; }
    setBusy(true); setError(null); setStatus(null);
    try {
      const result = await executeKaminoAction(action, {
        wallet, reserve, amount, signWithWallet,
        onStatus: setStatus,
      });
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [wallet, signWithWallet]);

  return { run, busy, status, error };
}
