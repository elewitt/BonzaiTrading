import { useState, useEffect } from "react";

/* ————— Admin / ops — Phase 1: customer lookup —————
 * Deliberately separate from the customer-facing app: no Privy, no wallet
 * connect, just a shared-password gate (see main.jsx — this renders instead
 * of <App/> when the path starts with /admin, without <PrivyProvider>).
 * Utilitarian styling reusing the existing .card/.trow/.field/.btn classes —
 * this doesn't need product-level polish, just to be legible fast.
 */
const API_BASE = import.meta.env.VITE_API_URL || "";
const PASSWORD_KEY = "bonzai_admin_password";

const usd = (n, dp = 2) =>
  n == null || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

const num = (n, dp = 4) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: dp }));

const short = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "—");

async function adminFetch(path, password, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", "X-Admin-Password": password, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function PasswordGate({ onAuthed }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/api/admin/login", password, { method: "POST" });
      sessionStorage.setItem(PASSWORD_KEY, password);
      onAuthed(password);
    } catch {
      setError("Wrong password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage narrow center" style={{ paddingTop: 96 }}>
      <form className="card auth-card" onSubmit={submit} style={{ textAlign: "left" }}>
        <h2 className="card-title">Bonzai Ops</h2>
        <p className="muted tiny" style={{ margin: "0 0 4px" }}>Internal tool. Authorized operators only.</p>
        <input
          className="field"
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="tiny warn">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !password}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 className="card-title">{title}</h3>
      {children}
    </div>
  );
}

function IdentitySection({ identity }) {
  return (
    <Section title="Identity">
      <div className="trow"><span className="label">Email</span><span>{identity.email || "—"}</span></div>
      <div className="trow"><span className="label">Privy user ID</span><span className="mono tiny">{identity.privyUserId || "—"}</span></div>
      <div className="trow"><span className="label">Solana wallet</span><span className="mono tiny">{identity.solanaAddress || "—"}</span></div>
      <div className="trow"><span className="label">Ethereum wallet (Perps)</span><span className="mono tiny">{identity.evmAddress || "—"}</span></div>
    </Section>
  );
}

function HoldingsSection({ holdings }) {
  if (!holdings) return <Section title="Brokerage holdings"><p className="muted tiny">No Solana wallet resolved for this customer.</p></Section>;
  const tokens = (holdings.tokens || []).filter((t) => Number(t.uiAmount) > 0);
  return (
    <Section title="Brokerage holdings">
      <div className="trow"><span className="label">SOL</span><span className="mono">{num(holdings.sol, 4)}</span></div>
      {tokens.length === 0 && <p className="muted tiny">No other token balances.</p>}
      {tokens.map((t) => (
        <div className="trow" key={t.mint}>
          <span>{t.symbol || t.name || short(t.mint)}</span>
          <span className="mono">{num(t.uiAmount, 4)}</span>
        </div>
      ))}
    </Section>
  );
}

function KaminoSection({ kaminoLoans }) {
  if (!kaminoLoans || kaminoLoans.length === 0) {
    return <Section title="Kamino borrow positions"><p className="muted tiny">No open positions.</p></Section>;
  }
  return (
    <Section title="Kamino borrow positions">
      {kaminoLoans.map((loan, i) => {
        const info = loan.loanInfo ?? loan;
        const deposits = info.collateral?.deposits ?? [];
        const borrows = info.debt?.borrows ?? [];
        const currentLtv = Number(info.currentLtv ?? 0);
        const liquidationLtv = Number(info.liquidationLtv ?? 0);
        const risky = liquidationLtv > 0 && currentLtv / liquidationLtv > 0.85;
        return (
          <div key={i} style={{ marginBottom: i < kaminoLoans.length - 1 ? 16 : 0, paddingBottom: i < kaminoLoans.length - 1 ? 16 : 0, borderBottom: i < kaminoLoans.length - 1 ? "1px solid var(--line)" : "none" }}>
            <div className="trow">
              <span className="label">LTV</span>
              <span className={risky ? "warn" : ""}>{(currentLtv * 100).toFixed(1)}% / liq {(liquidationLtv * 100).toFixed(1)}%</span>
            </div>
            {deposits.map((d) => (
              <div className="trow" key={d.tokenMint}>
                <span>Collateral · {d.tokenName || short(d.tokenMint)}</span>
                <span className="mono">{usd(d.tokenValue)}</span>
              </div>
            ))}
            {borrows.map((b) => (
              <div className="trow" key={b.tokenMint}>
                <span>Debt · {b.tokenName || short(b.tokenMint)}</span>
                <span className="mono">{usd(b.tokenValue)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </Section>
  );
}

function PerpsSection({ perps }) {
  const positions = perps?.positions || [];
  return (
    <Section title="Perps">
      <div className="trow"><span className="label">Crypto account value</span><span className="mono">{usd(perps?.cryptoAccountValue)}</span></div>
      <div className="trow"><span className="label">Equity account value</span><span className="mono">{usd(perps?.equityAccountValue)}</span></div>
      {positions.length === 0 && <p className="muted tiny">No open positions.</p>}
      {positions.map((p, i) => (
        <div className="trow" key={i}>
          <span>{p.coin} · {p.side} · {p.leverage ?? "—"}x <span className="tiny muted">({p.dex})</span></span>
          <span className={`mono ${p.unrealizedPnl >= 0 ? "gain" : "warn"}`}>{usd(p.unrealizedPnl)}</span>
        </div>
      ))}
    </Section>
  );
}

const STATUS_LABEL = { active: "Reactivate", paused: "Pause", rejected: "Reject" };
const STATUS_WARNING = {
  paused: "Pausing blocks trading and withdrawals immediately. The customer can still log in and view their portfolio.",
  rejected: "Rejecting blocks trading and withdrawals immediately. The customer can still log in and view their portfolio.",
  active: "Reactivating restores full trading access immediately.",
};

function AccountControlSection({ password, privyUserId, statusInfo, onStatusChanged }) {
  const [pendingAction, setPendingAction] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!privyUserId) {
    return (
      <Section title="Account control">
        <p className="muted tiny">No linked Privy account for this customer — nothing to pause or reject.</p>
      </Section>
    );
  }

  const current = statusInfo?.status || "active";
  const otherStatuses = ["active", "paused", "rejected"].filter((s) => s !== current);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const data = await adminFetch(`/api/admin/customer/${privyUserId}/status`, password, {
        method: "POST",
        body: JSON.stringify({ status: pendingAction, reason: reason.trim() }),
      });
      onStatusChanged({ status: data.status, reason: data.reason, updatedAt: new Date().toISOString() });
      setPendingAction(null);
      setReason("");
    } catch (err) {
      setError(err.message || "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Account control">
      <div className="trow">
        <span className="label">Status</span>
        <span className={current === "active" ? "gain" : "warn"}>
          {current}{statusInfo?.reason ? ` — ${statusInfo.reason}` : ""}
        </span>
      </div>
      {!pendingAction ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {otherStatuses.map((s) => (
            <button key={s} className="btn ghost" onClick={() => setPendingAction(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p className="tiny muted" style={{ margin: "0 0 8px" }}>{STATUS_WARNING[pendingAction]}</p>
          <input
            className="field"
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ marginBottom: 8, width: "100%" }}
            autoFocus
          />
          {error && <div className="tiny warn" style={{ marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy || !reason.trim()} onClick={confirm}>
              {busy ? "Working…" : `Confirm ${STATUS_LABEL[pendingAction].toLowerCase()}`}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => { setPendingAction(null); setError(null); setReason(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function EmailCustomerSection({ password, privyUserId, email }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  if (!privyUserId || !email) {
    return <Section title="Email customer"><p className="muted tiny">No email on file for this customer.</p></Section>;
  }

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await adminFetch(`/api/admin/customer/${privyUserId}/email`, password, {
        method: "POST",
        body: JSON.stringify({ subject, body }),
      });
      setResult({ ok: true });
      setSubject("");
      setBody("");
    } catch (err) {
      setResult({ error: err.message || "Failed to send." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={`Email customer — ${email}`}>
      <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input className="field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="field"
          placeholder="Message"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ resize: "vertical", fontFamily: "inherit" }}
        />
        {result?.error && <div className="tiny warn">{result.error}</div>}
        {result?.ok && <div className="tiny gain">Sent.</div>}
        <button className="btn primary" type="submit" disabled={busy || !subject.trim() || !body.trim()} style={{ alignSelf: "flex-start" }}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </Section>
  );
}

function ActivitySection({ activity }) {
  if (!activity || activity.length === 0) {
    return <Section title="Recent activity"><p className="muted tiny">No logged activity yet (logging started 2026-07-16 — nothing before that is recorded).</p></Section>;
  }
  return (
    <Section title="Recent activity">
      {activity.map((row) => (
        <div className="trow" key={row.id}>
          <span>
            {new Date(row.created_at).toLocaleString()} · {row.kind}
            {row.side ? ` · ${row.side}` : ""}
            {row.symbol ? ` · ${row.symbol}` : ""}
          </span>
          <span className="mono tiny">
            {row.usd_value ? usd(row.usd_value) : ""}
            {row.signature && (
              <>
                {" "}
                <a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">↗</a>
              </>
            )}
          </span>
        </div>
      ))}
    </Section>
  );
}

function PlatformFeesSection({ password }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'setup' | 'claim' | 'add-mint' | null
  const [claimResult, setClaimResult] = useState(null);
  const [addMint, setAddMint] = useState("");

  async function refresh() {
    try {
      setStatus(await adminFetch("/api/admin/jupiter-fees/status", password));
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load fee status.");
    }
  }

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setup() {
    setBusy("setup");
    setError(null);
    try {
      await adminFetch("/api/admin/jupiter-fees/setup", password, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err.message || "Setup failed.");
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    setBusy("claim");
    setError(null);
    setClaimResult(null);
    try {
      const data = await adminFetch("/api/admin/jupiter-fees/claim", password, { method: "POST" });
      setClaimResult(data);
      await refresh();
    } catch (err) {
      setError(err.message || "Claim failed.");
    } finally {
      setBusy(null);
    }
  }

  async function submitAddMint(e) {
    e.preventDefault();
    setBusy("add-mint");
    setError(null);
    try {
      await adminFetch("/api/admin/jupiter-fees/add-mint", password, {
        method: "POST",
        body: JSON.stringify({ mint: addMint.trim() }),
      });
      setAddMint("");
      await refresh();
    } catch (err) {
      setError(err.message || "Failed to add mint.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Platform fees — brokerage swaps">
      {error && <div className="tiny warn" style={{ marginBottom: 8 }}>{error}</div>}
      {!status ? (
        <p className="muted tiny">Loading…</p>
      ) : (
        <>
          <div className="trow">
            <span className="label">Fee charging</span>
            <span className={status.enabled ? "gain" : "warn"}>{status.enabled ? `on — ${status.feeBps}bps` : "off (JUP_FEES_ENABLED not set)"}</span>
          </div>
          <div className="trow">
            <span className="label">Referral account</span>
            <span className="mono tiny">{status.referralAccount}</span>
          </div>
          <div className="trow">
            <span className="label">Setup</span>
            <span className={status.configured ? "gain" : "warn"}>{status.configured ? "done" : "not set up yet"}</span>
          </div>
          {status.configured && (
            <>
              <div className="trow"><span className="label">Pending USDC (unclaimed)</span><span className="mono">{usd(status.pendingUsdc ?? 0)}</span></div>
              <div className="trow"><span className="label">Sponsor wallet USDC balance</span><span className="mono">{usd(status.sponsorUsdcBalance)}</span></div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {!status.configured && (
              <button className="btn primary" disabled={busy === "setup"} onClick={setup}>
                {busy === "setup" ? "Setting up…" : "Set up referral account"}
              </button>
            )}
            {status.configured && (
              <button className="btn primary" disabled={busy === "claim"} onClick={claim}>
                {busy === "claim" ? "Claiming…" : "Claim fees"}
              </button>
            )}
          </div>

          {claimResult && (
            <p className="tiny gain" style={{ marginTop: 10 }}>
              Claimed {claimResult.count} batch{claimResult.count === 1 ? "" : "es"}: {claimResult.signatures.join(", ")}
            </p>
          )}

          {status.configured && (
            <form onSubmit={submitAddMint} style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <input
                className="field"
                style={{ flex: 1 }}
                placeholder="Add fee coverage for another mint address"
                value={addMint}
                onChange={(e) => setAddMint(e.target.value)}
              />
              <button className="btn ghost" type="submit" disabled={busy === "add-mint" || !addMint.trim()}>
                {busy === "add-mint" ? "Adding…" : "Add mint"}
              </button>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

function HyperliquidBuilderFeesSection({ password }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [claimResult, setClaimResult] = useState(null);

  async function refresh() {
    try {
      setStatus(await adminFetch("/api/admin/hl-builder/status", password));
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load builder-fee status.");
    }
  }

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function claim() {
    setBusy(true);
    setError(null);
    setClaimResult(null);
    try {
      const data = await adminFetch("/api/admin/hl-builder/claim", password, { method: "POST" });
      setClaimResult(data);
      await refresh();
    } catch (err) {
      setError(err.message || "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Hyperliquid builder fees — perps">
      {error && <div className="tiny warn" style={{ marginBottom: 8 }}>{error}</div>}
      {!status ? (
        <p className="muted tiny">Loading…</p>
      ) : !status.configured ? (
        <p className="muted tiny">Arbitrum sponsor wallet not configured — builder fees unavailable.</p>
      ) : (
        <>
          <div className="trow"><span className="label">Builder address</span><span className="mono tiny">{status.builderAddress}</span></div>
          <div className="trow">
            <span className="label">Eligibility</span>
            <span className={status.eligible ? "gain" : "warn"}>
              {status.eligible ? "eligible" : `needs ≥${status.minEligibleUsdc} USDC perps account value`} (currently {usd(status.perpsAccountValue)})
            </span>
          </div>
          {!status.eligible && (
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Deposit USDC into this wallet's Hyperliquid account to reach the {status.minEligibleUsdc} USDC minimum before builder fees can be charged.
            </p>
          )}
          <div className="trow"><span className="label">Unclaimed rewards</span><span className="mono">{usd(status.unclaimedRewards)}</span></div>
          <div className="trow"><span className="label">Claimed to date</span><span className="mono">{usd(status.claimedRewards)}</span></div>
          <div className="trow"><span className="label">Builder rewards (lifetime)</span><span className="mono">{usd(status.builderRewards)}</span></div>

          <div style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={busy || status.unclaimedRewards <= 0} onClick={claim}>
              {busy ? "Claiming…" : "Claim rewards"}
            </button>
          </div>
          {claimResult && <p className="tiny gain" style={{ marginTop: 10 }}>Claimed successfully.</p>}
        </>
      )}
    </Section>
  );
}

function KaminoFeesSection({ password }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      setStatus(await adminFetch("/api/admin/kamino-fees/status", password));
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load Kamino fee status.");
    }
  }

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section title="Kamino borrow fees — borrow/lend">
      {error && <div className="tiny warn" style={{ marginBottom: 8 }}>{error}</div>}
      {!status ? (
        <p className="muted tiny">Loading…</p>
      ) : !status.configured ? (
        <p className="muted tiny">Sponsor wallet not configured — Kamino fees unavailable.</p>
      ) : (
        <>
          <div className="trow"><span className="label">Fee rate</span><span className="mono">{(status.feeBps / 100).toFixed(2)}% on borrow</span></div>
          <div className="trow"><span className="label">Fee wallet</span><span className="mono tiny">{status.sponsorAddress}</span></div>
          <div className="trow"><span className="label">Total collected (lifetime)</span><span className="mono">{usd(status.totalUsd)}</span></div>
          <div className="trow"><span className="label">Fee events</span><span className="mono">{status.count}</span></div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            No separate claim step — each fee lands directly in the wallet above as a plain transfer the moment it's charged.
          </p>
          {status.byAsset.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p className="tiny label" style={{ marginBottom: 6 }}>By asset</p>
              {status.byAsset.map((a) => (
                <div className="trow" key={a.mint}>
                  <span>{a.symbol || short(a.mint)}</span>
                  <span className="mono">{usd(a.usd)} <span className="tiny muted">({a.count})</span></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// Live, not load-once like the other Ops sections — these wallets can run
// dry between page loads with zero other warning signal (they just silently
// stop sponsoring gas), so this polls rather than waiting for a manual
// refresh.
const SPONSOR_LOW_SOL = 0.01;
const SPONSOR_LOW_ETH = 0.002;

function GasSponsorSection({ password }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      setStatus(await adminFetch("/api/admin/sponsor-status", password));
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load sponsor wallet status.");
    }
  }

  useEffect(() => {
    refresh();
    const h = setInterval(refresh, 20_000);
    return () => clearInterval(h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sol = status?.solana;
  const arb = status?.arbitrum;

  return (
    <Section title="Gas sponsor wallets">
      <p className="tiny muted" style={{ marginTop: -6, marginBottom: 10 }}>
        Pay gas on customers' behalf (xStock sell top-ups + CCTP relays on Solana; Bridge2 deposit gas + CCTP relays on Arbitrum). Silently stop working once empty.
      </p>
      {error && <div className="tiny warn" style={{ marginBottom: 8 }}>{error}</div>}
      {!status ? (
        <p className="muted tiny">Loading…</p>
      ) : (
        <div className="admin-ops-grid">
          <div>
            <p className="label" style={{ marginBottom: 6 }}>Solana</p>
            {!sol?.configured ? (
              <p className="muted tiny">Not configured.</p>
            ) : (
              <>
                <div className="trow"><span className="label">Address</span><span className="mono tiny">{sol.address}</span></div>
                <div className="trow">
                  <span className="label">Balance</span>
                  <span className={`mono ${sol.balanceSol < SPONSOR_LOW_SOL ? "warn" : "gain"}`}>{sol.balanceSol.toFixed(5)} SOL</span>
                </div>
                <div className="trow"><span className="label">Spent today</span><span className="mono tiny">{sol.spentTodaySol.toFixed(5)} / {sol.dailyCapSol.toFixed(3)} SOL cap</span></div>
              </>
            )}
          </div>
          <div>
            <p className="label" style={{ marginBottom: 6 }}>Arbitrum</p>
            {!arb?.configured ? (
              <p className="muted tiny">Not configured.</p>
            ) : (
              <>
                <div className="trow"><span className="label">Address</span><span className="mono tiny">{arb.address}</span></div>
                <div className="trow">
                  <span className="label">Balance</span>
                  <span className={`mono ${Number(arb.balanceEth) < SPONSOR_LOW_ETH ? "warn" : "gain"}`}>{Number(arb.balanceEth).toFixed(5)} ETH</span>
                </div>
                <div className="trow"><span className="label">Spent today</span><span className="mono tiny">{Number(arb.spentTodayEth).toFixed(5)} / {Number(arb.dailyCapEth).toFixed(3)} ETH cap</span></div>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function OfacMatchList({ result }) {
  if (result.listError) return <p className="tiny warn">OFAC list unavailable: {result.listError}</p>;
  if (result.matches.length === 0) return <p className="tiny gain">No matches found.</p>;
  return (
    <>
      <p className="tiny warn" style={{ marginBottom: 8 }}>
        {result.matches.length} possible match{result.matches.length === 1 ? "" : "es"} — review each, this is a fuzzy match, not a confirmed hit
      </p>
      {result.matches.map((m, i) => (
        <div className="card" key={`${m.name}-${i}`} style={{ marginBottom: 10, padding: 14 }}>
          <div className="trow"><span className="label">Name</span><span>{m.name}</span></div>
          {m.matchedName && <div className="trow"><span className="label">Matched alias</span><span>{m.matchedName}</span></div>}
          <div className="trow"><span className="label">Match score</span><span className="mono">{(m.score * 100).toFixed(0)}%</span></div>
          <div className="trow"><span className="label">List</span><span>{m.source}</span></div>
          {m.type && <div className="trow"><span className="label">Type</span><span>{m.type}</span></div>}
          {m.programs?.length > 0 && <div className="trow"><span className="label">Programs</span><span>{m.programs.join(", ")}</span></div>}
          {m.remarks && <p className="tiny muted" style={{ marginTop: 6 }}>{m.remarks}</p>}
          {m.sourceInformationUrl && (
            <a className="tiny" href={m.sourceInformationUrl} target="_blank" rel="noreferrer">View list source →</a>
          )}
        </div>
      ))}
    </>
  );
}

function AdverseMediaResults({ result }) {
  if (result.error) return <p className="tiny warn">Search failed: {result.error}</p>;
  if (result.results.length === 0) return <p className="tiny muted">No results.</p>;
  return result.results.map((r, i) => (
    <div className="trow" key={i} style={{ alignItems: "flex-start" }}>
      <a href={r.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>{r.title}</a>
      <span className="tiny muted" style={{ flex: 1, textAlign: "right" }}>{r.description}</span>
    </div>
  ));
}

const TRADE_KIND_LABELS = {
  swap: "Swap",
  kamino_deposit: "Kamino Deposit",
  kamino_borrow: "Kamino Borrow",
  kamino_repay: "Kamino Repay",
  kamino_withdraw: "Kamino Withdraw",
  kamino_borrow_fee: "Kamino Fee",
  kamino_deposit_fee: "Kamino Fee",
  perp_fill: "Perps",
};

function tradeSideChipClass(side) {
  const s = String(side || "").toLowerCase();
  if (s.includes("long") || s === "buy") return "buy";
  if (s.includes("short") || s === "sell") return "sell";
  return null;
}

/**
 * Cumulative trading volume over time — hand-rolled SVG, same technique as
 * PerpsDashboard.jsx's PnlChart (gradient-filled line, no charting
 * library anywhere in this app). Uses --pine rather than gain/loss
 * coloring since this is a volume-growth curve, not a P&L series — it
 * only ever goes up, so green/red would be misleading here.
 */
function TradeVolumeChart({ trades }) {
  const points = [...trades].filter((t) => t.usdValue != null).sort((a, b) => a.time - b.time);
  if (points.length < 2) {
    return <p className="tiny muted" style={{ padding: "28px 0", textAlign: "center" }}>Not enough valued trades yet to chart.</p>;
  }

  let running = 0;
  const series = points.map((t) => { running += Math.abs(t.usdValue); return { time: t.time, v: running }; });

  const W = 600, H = 200;
  const PAD = { top: 10, right: 16, bottom: 16, left: 62 };
  const vMax = series[series.length - 1].v || 1;
  const tMin = series[0].time, tMax = series[series.length - 1].time;
  const tRange = tMax - tMin || 1;
  const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  const sx = (ts) => PAD.left + ((ts - tMin) / tRange) * inner.w;
  const sy = (v) => PAD.top + inner.h - (v / vMax) * inner.h;

  const mapped = series.map((p) => [sx(p.time), sy(p.v)]);
  const linePath = mapped.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const bottom = (PAD.top + inner.h + 1).toFixed(1);
  const areaPath = `${linePath} L${mapped[mapped.length - 1][0].toFixed(1)},${bottom} L${mapped[0][0].toFixed(1)},${bottom} Z`;
  const [cx, cy] = mapped[mapped.length - 1];

  const TICK_COUNT = 4;
  const yTicks = Array.from({ length: TICK_COUNT }, (_, i) => (vMax * i) / (TICK_COUNT - 1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lvp-pnl-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="adminVolGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--pine)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--pine)" stopOpacity="0.01" />
        </linearGradient>
        <clipPath id="adminVolClip">
          <rect x={PAD.left} y={PAD.top - 4} width={inner.w + 1} height={inner.h + 5} />
        </clipPath>
      </defs>
      {yTicks.map((v, i) => (
        <line key={i} x1={PAD.left} y1={sy(v).toFixed(1)} x2={W - PAD.right} y2={sy(v).toFixed(1)} stroke="var(--line)" strokeWidth="1" opacity="0.6" />
      ))}
      <path d={areaPath} fill="url(#adminVolGrad)" clipPath="url(#adminVolClip)" />
      <path d={linePath} fill="none" stroke="var(--pine)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath="url(#adminVolClip)" />
      <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="4.5" fill="var(--pine)" stroke="var(--card)" strokeWidth="2" />
      {yTicks.map((v, i) => (
        <text key={i} x={PAD.left - 10} y={sy(v) + 3} textAnchor="end" fontSize="11" fontFamily="IBM Plex Mono,monospace" fill="var(--moss)">
          {v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`}
        </text>
      ))}
    </svg>
  );
}

function TradeRow({ t }) {
  const sideClass = tradeSideChipClass(t.side);
  return (
    <div className="trow" style={{ alignItems: "center" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="pos-leverage-chip">{TRADE_KIND_LABELS[t.kind] || t.kind}</span>
        {sideClass ? (
          <span className={`trade-chip ${sideClass}`} style={{ padding: "3px 10px", fontSize: 11 }}>{t.side}</span>
        ) : t.side ? (
          <span className="tiny muted">{t.side}</span>
        ) : null}
        <span>{t.symbol || "—"}</span>
        {t.status && t.status !== "confirmed" && <span className="tiny warn">({t.status})</span>}
      </span>
      <span className="mono tiny" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span className="muted" style={{ marginRight: 10 }}>{new Date(t.time).toLocaleString()}</span>
        {t.usdValue != null && <span>{usd(t.usdValue)}</span>}
        {t.closedPnl ? (
          <span className={t.closedPnl >= 0 ? "gain" : "warn"} style={{ marginLeft: 8 }}>
            {t.closedPnl >= 0 ? "+" : ""}{usd(t.closedPnl)}
          </span>
        ) : null}
        {t.signature && (
          <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>↗</a>
        )}
      </span>
    </div>
  );
}

/**
 * Brokerage swaps + Kamino activity + Hyperliquid perps fills, merged into
 * one chronological record — separate on-demand fetch from the initial
 * customer lookup (see /api/admin/customer/:query/trading-history's own
 * comment for why), same on-demand pattern as the OFAC/adverse-media
 * searches above.
 */
function TradingHistorySection({ password, query }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  async function load() {
    setBusy(true); setError(null); setData(null);
    try {
      setData(await adminFetch(`/api/admin/customer/${encodeURIComponent(query)}/trading-history`, password));
    } catch (err) {
      setError(err.message || "Failed to load trading history.");
    } finally {
      setBusy(false);
    }
  }

  const trades = data?.trades || [];
  const q = search.trim().toLowerCase();
  const filtered = q ? trades.filter((t) => (t.symbol || "").toLowerCase().includes(q) || t.kind.toLowerCase().includes(q)) : trades;

  const totalVolume = trades.reduce((s, t) => s + Math.abs(t.usdValue || 0), 0);
  const closedPerp = trades.filter((t) => t.kind === "perp_fill" && t.closedPnl);
  const realizedPnl = closedPerp.reduce((s, t) => s + t.closedPnl, 0);
  const winRate = closedPerp.length ? (closedPerp.filter((t) => t.closedPnl > 0).length / closedPerp.length) * 100 : null;

  return (
    <Section title="Trading history">
      <p className="tiny muted" style={{ marginBottom: 12 }}>
        Brokerage swaps, Kamino borrow/lend activity, and Hyperliquid perps fills, merged into one chronological record.
      </p>
      {!data && (
        <button className="btn ghost" disabled={busy} onClick={load}>
          {busy ? "Loading…" : "Load trading history"}
        </button>
      )}
      {error && <p className="warn tiny" style={{ marginTop: 10 }}>{error}</p>}

      {data && (
        trades.length === 0 ? (
          <p className="muted tiny">No trading activity found for this customer.</p>
        ) : (
          <>
            <div className="lvp-stats-row" style={{ marginBottom: 18 }}>
              <div className="card lvp-stat-box">
                <span className="tiny muted">Total Trades</span>
                <p className="mono lvp-stat-value">{trades.length}</p>
              </div>
              <div className="card lvp-stat-box">
                <span className="tiny muted">Total Volume</span>
                <p className="mono lvp-stat-value">{usd(totalVolume, 0)}</p>
              </div>
              <div className="card lvp-stat-box">
                <span className="tiny muted">Perps Realized P&L</span>
                <p className={`mono lvp-stat-value ${realizedPnl >= 0 ? "gain" : "warn"}`}>{usd(realizedPnl)}</p>
              </div>
              <div className="card lvp-stat-box">
                <span className="tiny muted">Perps Win Rate</span>
                <p className="mono lvp-stat-value">{winRate != null ? `${winRate.toFixed(0)}%` : "—"}</p>
              </div>
            </div>

            <TradeVolumeChart trades={trades} />

            <input
              className="field perps-asset-search"
              placeholder="Filter by asset or type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ margin: "18px 0 4px", width: "100%" }}
            />
            {filtered.length === 0 ? (
              <p className="tiny muted" style={{ marginTop: 8 }}>No trades match "{search}".</p>
            ) : (
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {filtered.map((t, i) => <TradeRow key={i} t={t} />)}
              </div>
            )}
          </>
        )
      )}

      {data && (
        <button className="btn ghost" style={{ marginTop: 14 }} disabled={busy} onClick={load}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      )}
    </Section>
  );
}

function ComplianceView({ password }) {
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [ofacResult, setOfacResult] = useState(null);
  const [ofacBusy, setOfacBusy] = useState(false);
  const [ofacError, setOfacError] = useState(null);
  const [mediaResult, setMediaResult] = useState(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true); setError(null); setCustomer(null);
    setName(""); setOfacResult(null); setMediaResult(null);
    try {
      const data = await adminFetch(`/api/admin/customer/${encodeURIComponent(q)}`, password);
      setCustomer(data.identity);
    } catch (err) {
      setError(err.message || "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runOfac() {
    const n = name.trim();
    if (!n) return;
    setOfacBusy(true); setOfacError(null); setOfacResult(null);
    try {
      setOfacResult(await adminFetch(`/api/admin/compliance/ofac?name=${encodeURIComponent(n)}`, password));
    } catch (err) {
      setOfacError(err.message || "OFAC search failed.");
    } finally {
      setOfacBusy(false);
    }
  }

  async function runAdverseMedia() {
    const n = name.trim();
    if (!n) return;
    setMediaBusy(true); setMediaError(null); setMediaResult(null);
    try {
      setMediaResult(await adminFetch(`/api/admin/compliance/adverse-media?name=${encodeURIComponent(n)}`, password));
    } catch (err) {
      setMediaError(err.message || "Adverse media search failed.");
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <div>
      <p className="lede sm">Select a customer, then screen a name against OFAC's sanctions lists and run an adverse-media search.</p>
      <form onSubmit={submit} style={{ display: "flex", gap: 10, margin: "0 0 24px" }}>
        <input
          className="field"
          style={{ flex: 1 }}
          placeholder="Email or wallet address (Solana or Ethereum)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="btn primary" type="submit" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Find customer"}
        </button>
      </form>
      {error && <p className="warn">{error}</p>}

      {customer && (
        <>
          <IdentitySection identity={customer} />

          <Section title="Screening">
            <p className="tiny muted" style={{ marginBottom: 10 }}>
              No legal name is stored for any customer — enter the name to screen. Neither search below makes any
              automated decision; both return results for manual review.
            </p>
            <div className="borrow-field" style={{ marginBottom: 14 }}>
              <span className="tiny muted">Full legal name</span>
              <input className="field" placeholder="Jane Q. Customer" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <button className="btn ghost" disabled={!name.trim() || ofacBusy} onClick={runOfac}>
                {ofacBusy ? "Checking…" : "Run OFAC search"}
              </button>
              <button className="btn ghost" disabled={!name.trim() || mediaBusy} onClick={runAdverseMedia}>
                {mediaBusy ? "Searching…" : "Run adverse media search"}
              </button>
            </div>

            {ofacError && <p className="warn tiny">{ofacError}</p>}
            {ofacResult && (
              <div style={{ marginBottom: 22 }}>
                <p className="tiny label" style={{ marginBottom: 8 }}>
                  OFAC result for "{ofacResult.query}"
                  {ofacResult.dataUpdatedAt && (
                    <span className="muted"> · Treasury list data as of {new Date(ofacResult.dataUpdatedAt).toLocaleString()}</span>
                  )}
                </p>
                <OfacMatchList result={ofacResult} />
              </div>
            )}

            {mediaError && <p className="warn tiny">{mediaError}</p>}
            {mediaResult && (
              <div>
                <p className="tiny label" style={{ marginBottom: 4 }}>Adverse media search for "{mediaResult.query}"</p>
                <p className="tiny muted" style={{ marginBottom: 8 }}>
                  General web search for the name plus risk keywords — not a licensed adverse-media provider. Review manually.
                </p>
                <AdverseMediaResults result={mediaResult} />
              </div>
            )}
          </Section>

          <TradingHistorySection key={query} password={password} query={query} />
        </>
      )}
    </div>
  );
}

function CustomerServiceView({ password }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await adminFetch(`/api/admin/customer/${encodeURIComponent(q)}`, password);
      setResult(data);
    } catch (err) {
      setError(err.message || "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="lede sm">Search a customer by email or wallet address, see their full picture across every product, and take action on their account.</p>
      <form onSubmit={submit} style={{ display: "flex", gap: 10, margin: "0 0 24px" }}>
        <input
          className="field"
          style={{ flex: 1 }}
          placeholder="Email or wallet address (Solana or Ethereum)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="btn primary" type="submit" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="warn">{error}</p>}
      {result && (
        <>
          <AccountControlSection
            password={password}
            privyUserId={result.identity.privyUserId}
            statusInfo={result.status}
            onStatusChanged={(status) => setResult((r) => ({ ...r, status }))}
          />
          <IdentitySection identity={result.identity} />
          <HoldingsSection holdings={result.holdings} />
          <KaminoSection kaminoLoans={result.kaminoLoans} />
          <PerpsSection perps={result.perps} />
          <EmailCustomerSection password={password} privyUserId={result.identity.privyUserId} email={result.identity.email} />
          <ActivitySection activity={result.activity} />
        </>
      )}
    </div>
  );
}

function OpsView({ password }) {
  return (
    <div>
      <p className="lede sm">Platform-wide revenue — not tied to any one customer.</p>
      <PlatformFeesSection password={password} />
      <HyperliquidBuilderFeesSection password={password} />
      <KaminoFeesSection password={password} />
      <GasSponsorSection password={password} />
    </div>
  );
}

function AdminShell({ password, onLogout }) {
  const [tab, setTab] = useState("customer"); // "customer" | "ops" | "compliance"

  return (
    <div className="stage wide">
      <div className="card-toprow">
        <h2 className="card-title" style={{ margin: 0 }}>Bonzai Ops</h2>
        <button className="btn ghost" onClick={onLogout}>Log out</button>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === "customer" ? "active" : ""}`} onClick={() => setTab("customer")}>
          Customer Service
        </button>
        <button className={`admin-tab ${tab === "ops" ? "active" : ""}`} onClick={() => setTab("ops")}>
          Ops
        </button>
        <button className={`admin-tab ${tab === "compliance" ? "active" : ""}`} onClick={() => setTab("compliance")}>
          Compliance
        </button>
      </div>

      {tab === "customer" && <CustomerServiceView password={password} />}
      {tab === "ops" && <OpsView password={password} />}
      {tab === "compliance" && <ComplianceView password={password} />}
    </div>
  );
}

export default function AdminApp() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY));

  function logout() {
    sessionStorage.removeItem(PASSWORD_KEY);
    setPassword(null);
  }

  return (
    <div className="lv-root">
      {password ? <AdminShell password={password} onLogout={logout} /> : <PasswordGate onAuthed={setPassword} />}
    </div>
  );
}
