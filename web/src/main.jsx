import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

// Catch any uncaught error and paint it to the screen (overlay, not innerHTML
// on root) — but only in dev. A production user has no use for a raw stack
// trace, and painting one full-screen hides whatever's underneath even when
// it's still working fine (confirmed against a real case: an unhandled
// rejection from a benign, unrelated background call inside a third-party
// SDK covered up an otherwise-functional modal). Production just logs to
// the console instead — still inspectable via devtools, doesn't block the UI.
function showDevError(text) {
  if (!import.meta.env.DEV) return;
  let el = document.getElementById("_dev_err");
  if (!el) {
    el = document.createElement("div");
    el.id = "_dev_err";
    el.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;padding:32px;";
    document.body.appendChild(el);
  }
  el.innerHTML = `<pre style="color:red;font-family:monospace;white-space:pre-wrap">${text}</pre>`;
}
window.onerror = (msg, src, line, col, err) => {
  console.error("Uncaught error:", err || msg);
  showDevError(`<b>Uncaught error:</b>\n${err ? err.stack : msg}`);
};
window.onunhandledrejection = (e) => {
  console.error("Unhandled promise rejection:", e.reason);
  showDevError(`<b>Unhandled promise rejection:</b>\n${e.reason?.stack || e.reason}`);
};

import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App.jsx";
import AdminApp from "./admin/AdminApp.jsx";
import "./styles.css";
import "./lib/swipeToDismissSheet.js";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, fontFamily: "monospace", color: "red" }}>
        <b>React error:</b><br /><pre>{this.state.error.stack || String(this.state.error)}</pre>
      </div>
    );
    return this.props.children;
  }
}

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

// /admin is a separate internal tool (password-gated, no customer auth) —
// render it standalone, skipping PrivyProvider entirely since it has no use
// for Privy login. Vercel's catch-all rewrite already sends this path to
// index.html, so no deploy config is needed.
const isAdmin = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isAdmin ? (
        <AdminApp />
      ) : (
        <PrivyProvider
          appId={PRIVY_APP_ID}
          config={{
            loginMethods: ["email", "google"],
            appearance: { theme: "light", accentColor: "#1C4A38" },
            embeddedWallets: {
              solana: { createOnLogin: "users-without-wallets" },
              ethereum: { createOnLogin: "users-without-wallets" },
            },
          }}
        >
          <App />
        </PrivyProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
