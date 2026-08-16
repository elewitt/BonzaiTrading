import { useRef, useState, useCallback, useEffect } from "react";
import { toPng } from "html-to-image";
import { usd, displayTicker } from "../lib/api.js";

const CARD_COLORS = [
  "#60A5FA", "#F87171", "#A78BFA", "#34D399",
  "#FBBF24", "#F97316", "#22D3EE", "#F472B6",
  "#A3E635", "#FDE047",
];

function formatDate() {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function computePerf(history) {
  if (!history || history.length < 2) return null;
  const latest = history[history.length - 1].v;
  const cutoff = Date.now() - 7 * 86400000;
  const ref = [...history].reverse().find((h) => h.ts < cutoff) || history[0];
  const delta = latest - ref.v;
  const pct = ref.v > 0 ? (delta / ref.v) * 100 : 0;
  const label = ref === history[0] && history[0].ts > cutoff ? "all time" : "7d";
  return { delta, pct, label };
}

function CardContent({ portfolio, history }) {
  const rows = (portfolio?.rows || []).slice(0, 7);
  const total = portfolio?.total || 0;
  const invested = portfolio?.invested || 0;
  const cash = portfolio?.cash || 0;
  const perf = computePerf(history);

  const allRows = [
    ...rows.map((r, i) => ({
      sym: displayTicker(r.symbol),
      name: r.name,
      pct: total > 0 ? (r.value / total) * 100 : 0,
      color: CARD_COLORS[i % CARD_COLORS.length],
    })),
    ...(cash > 1 && rows.length < 7
      ? [{ sym: "USD", name: "Cash", pct: total > 0 ? (cash / total) * 100 : 0, color: "#D4A843" }]
      : []),
  ];

  const sign = perf && perf.delta >= 0;

  return (
    <div style={{
      width: 540, height: 540,
      background: "#0B1B10",
      position: "relative", overflow: "hidden",
      padding: "50px 54px",
      boxSizing: "border-box",
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
      WebkitFontSmoothing: "antialiased",
      display: "flex", flexDirection: "column",
    }}>
      {/* Background glows */}
      <div style={{
        position: "absolute", right: -100, top: -100,
        width: 380, height: 380, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(48,148,80,0.22) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", left: -80, bottom: -80,
        width: 260, height: 260, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(28,100,52,0.14) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <span style={{
          fontFamily: "'Young Serif', Georgia, serif",
          fontSize: 19, color: "#4DCE82", letterSpacing: "-0.02em",
        }}>Bonzai Trading</span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, color: "#2F5040", letterSpacing: "0.04em",
        }}>{formatDate()}</span>
      </div>

      {/* Value */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 28 }}>
        <span style={{
          fontSize: 10, fontWeight: 500, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "#3A6048",
        }}>Portfolio Value</span>
        <span style={{
          fontFamily: "'Young Serif', Georgia, serif",
          fontSize: 52, color: "#EBF4EE", lineHeight: 1.05, letterSpacing: "-0.02em",
        }}>${usd(total)}</span>
        {perf && Math.abs(perf.delta) > 0.01 && (
          <span style={{
            fontSize: 13, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 6, marginTop: 2,
            color: sign ? "#4DCE82" : "#E87070",
          }}>
            <span>{sign ? "+" : "−"}${usd(Math.abs(perf.delta), 0)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{sign ? "+" : "−"}{Math.abs(perf.pct).toFixed(1)}%</span>
            <span style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono', monospace" }}>
              {perf.label}
            </span>
          </span>
        )}
      </div>

      {/* Allocation bars */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
        {allRows.map((r) => (
          <div key={r.sym} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, fontWeight: 500, color: "#C8E4D4",
              width: 44, flexShrink: 0,
            }}>{r.sym}</span>
            <span style={{
              fontSize: 11, color: "#4E7060", flex: 1, minWidth: 0,
              overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            }}>{r.name}</span>
            <div style={{
              width: 156, flexShrink: 0,
              height: 5, background: "rgba(255,255,255,0.06)",
              borderRadius: 999, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: 999,
                width: `${Math.min(r.pct, 100)}%`,
                background: r.color, opacity: 0.88,
              }} />
            </div>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, color: "#4E7060",
              width: 36, textAlign: "right", flexShrink: 0,
            }}>
              {r.pct.toFixed(1)}<span style={{ opacity: 0.55 }}>%</span>
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginTop: 24, paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.07)",
      }}>
        <span style={{ fontSize: 11, color: "#2E4E3A", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#4A7060" }}>${usd(invested, 0)}</span>
          <span>invested</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ color: "#4A7060" }}>{rows.length}</span>
          <span>position{rows.length !== 1 ? "s" : ""}</span>
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10, color: "#2A4434", letterSpacing: "0.05em",
        }}>bonzaitrading.app</span>
      </div>
    </div>
  );
}

export default function ShareModal({ portfolio, history, onClose }) {
  const cardRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [capturing, setCapturing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const capture = useCallback(async () => {
    if (!cardRef.current) return;
    setCapturing(true);
    setError(null);
    try {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      setImgUrl(url);
    } catch (e) {
      setError("Could not generate card. Try again.");
    } finally {
      setCapturing(false);
    }
  }, []);

  useEffect(() => { capture(); }, [capture]);

  const download = () => {
    const a = document.createElement("a");
    a.href = imgUrl;
    a.download = `bonzai-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  const copyImg = async () => {
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  const shareNative = async () => {
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const file = new File([blob], "bonzai-portfolio.png", { type: "image/png" });
      await navigator.share({ files: [file], title: "My Bonzai Trading Portfolio" });
    } catch {}
  };

  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.write;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card share-modal">
        <div className="answer-header">
          <p className="tiny label" style={{ margin: 0 }}>Share Portfolio</p>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {/* Off-screen render target */}
        <div style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none", zIndex: -1 }} aria-hidden="true">
          <div ref={cardRef}>
            <CardContent portfolio={portfolio} history={history} />
          </div>
        </div>

        <div className="share-preview-wrap">
          {capturing && (
            <div className="share-preview-spinner">
              <div className="loading-dots"><span /><span /><span /></div>
            </div>
          )}
          {error && <p className="tiny warn" style={{ padding: 24 }}>{error}</p>}
          {imgUrl && !capturing && (
            <img src={imgUrl} className="share-preview-img" alt="Portfolio card preview" />
          )}
        </div>

        <div className="share-actions">
          <button className="btn ghost share-action-btn" onClick={download} disabled={!imgUrl || capturing}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </button>
          {canCopy && (
            <button className="btn ghost share-action-btn" onClick={copyImg} disabled={!imgUrl || capturing}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {copied ? "Copied!" : "Copy Image"}
            </button>
          )}
          {canShare ? (
            <button className="btn primary share-action-btn" onClick={shareNative} disabled={!imgUrl || capturing}>
              Share →
            </button>
          ) : (
            <button className="btn primary share-action-btn" onClick={download} disabled={!imgUrl || capturing}>
              Save →
            </button>
          )}
        </div>
        <p className="tiny muted center" style={{ marginTop: 10 }}>
          Share on X, TikTok, Instagram Stories, and more.
        </p>
      </div>
    </div>
  );
}
