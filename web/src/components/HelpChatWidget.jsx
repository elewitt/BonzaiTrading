import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const GREETING = "Hi! I can help you find your way around Bonzai Trading — ask me anything about the app, like \"where's the referral page\" or \"how do I open a perps position\".";

export default function HelpChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const r = await api.helpChat(next.map((m) => ({ role: m.role, content: m.content })));
      setMessages((prev) => [...prev, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {open && (
        <div className="help-chat-panel">
          <div className="help-chat-header">
            <span>Ask Bonzai</span>
            <button className="x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="help-chat-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`help-chat-bubble ${m.role}`}>{m.content}</div>
            ))}
            {sending && <div className="help-chat-bubble assistant help-chat-typing"><span></span><span></span><span></span></div>}
            {error && <div className="help-chat-bubble error">{error}</div>}
          </div>
          <div className="help-chat-input-row">
            <input ref={inputRef} type="text" value={input} placeholder="Ask a question…"
              onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={sending} />
            <button className="btn primary" onClick={send} disabled={sending || !input.trim()}>Send</button>
          </div>
        </div>
      )}
      <button className="help-chat-fab" onClick={() => setOpen((o) => !o)} aria-label="Site help chat">
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </>
  );
}
