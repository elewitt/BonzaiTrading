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

function CustomerLookup({ password, onLogout }) {
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
    <div className="stage wide">
      <div className="card-toprow">
        <h2 className="card-title" style={{ margin: 0 }}>Bonzai Ops</h2>
        <button className="btn ghost" onClick={onLogout}>Log out</button>
      </div>
      <PlatformFeesSection password={password} />
      <HyperliquidBuilderFeesSection password={password} />
      <h3 className="card-title" style={{ marginTop: 4 }}>Customer lookup</h3>
      <form onSubmit={submit} style={{ display: "flex", gap: 10, margin: "18px 0 24px" }}>
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

export default function AdminApp() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY));

  function logout() {
    sessionStorage.removeItem(PASSWORD_KEY);
    setPassword(null);
  }

  return (
    <div className="lv-root">
      {password ? <CustomerLookup password={password} onLogout={logout} /> : <PasswordGate onAuthed={setPassword} />}
    </div>
  );
}
