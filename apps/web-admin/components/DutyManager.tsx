"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Message = { role: "user" | "assistant"; text: string; time: string };

const SUGGESTIONS = [
  "What should I worry about today?",
  "Which rooms are not ready?",
  "How many guests are arriving today?",
  "What dietary needs do we have in house?",
  "Are there any safety maintenance issues?",
  "Who is checking out today?",
  "What overdue tasks do we have?",
  "Give me a full house summary",
];

export default function DutyManager() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingTime, setBriefingTime] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const loadBriefing = async () => {
    setBriefingLoading(true); setError(null);
    try {
      const r = await api<{ briefing: string; generated_at: string }>("/v1/duty-manager/morning-briefing");
      setBriefing(r.briefing);
      setBriefingTime(new Date(r.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      if (e instanceof ApiError && e.problem?.status === 503) setConfigured(false);
      else setError("Could not generate briefing — check the API is running.");
    } finally { setBriefingLoading(false); }
  };

  useEffect(() => { loadBriefing(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const ask = async (q: string) => {
    if (!q.trim() || loading) return;
    const userMsg: Message = { role: "user", text: q, time: now() };
    setMessages(m => [...m, userMsg]);
    setInput(""); setLoading(true); setError(null);
    try {
      const r = await api<{ answer: string }>("/v1/duty-manager/ask", {
        method: "POST", body: JSON.stringify({ question: q }),
      });
      setMessages(m => [...m, { role: "assistant", text: r.answer, time: now() }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.problem?.detail ?? "Query failed" : "Query failed";
      setMessages(m => [...m, { role: "assistant", text: `⚠️ ${msg}`, time: now() }]);
    } finally { setLoading(false); }
  };

  if (!configured) return (
    <div style={{ padding: 48, maxWidth: 560 }}>
      <h1>AI Duty Manager</h1>
      <div className="note" style={{ marginTop: 20 }}>
        <b>Not configured.</b> To enable the AI Duty Manager, add <code>ANTHROPIC_API_KEY</code> to your Render environment variables.
        <br /><br />
        Get your key at <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>, then add it in Render → your API service → Environment.
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", height: "100%", overflow: "hidden" }}>

      {/* Left: Morning briefing */}
      <div style={{ borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 12px", borderBottom: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="kicker">AI Duty Manager</div>
              <h2 style={{ margin: "4px 0 0" }}>Morning briefing</h2>
            </div>
            <button className="btn" disabled={briefingLoading} onClick={loadBriefing} style={{ fontSize: 12 }}>
              {briefingLoading ? "Generating…" : "↻ Refresh"}
            </button>
          </div>
          {briefingTime && <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginTop: 6 }}>Generated at {briefingTime}</div>}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {briefingLoading && (
            <div style={{ color: "var(--ink-2)" }}>
              <div className="empty" style={{ padding: 0 }}>Consulting the house data…</div>
            </div>
          )}
          {!briefingLoading && briefing && (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              {briefing}
            </pre>
          )}
          {!briefingLoading && !briefing && !error && (
            <div className="empty">No briefing yet.</div>
          )}
          {error && <div className="note">{error}</div>}
        </div>
      </div>

      {/* Right: chat interface */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid var(--rule)" }}>
          <h2 style={{ margin: 0 }}>Ask about the house</h2>
          <p className="m" style={{ color: "var(--ink-2)", margin: "4px 0 0" }}>
            Ask anything — rooms, guests, dietary needs, maintenance, tasks.
          </p>
        </div>

        {/* Suggestions */}
        {messages.length === 0 && (
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--rule)" }}>
            <div className="m" style={{ color: "var(--ink-2)", marginBottom: 10, fontSize: 12 }}>Try asking:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} className="btn" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              marginBottom: 20,
              display: "flex",
              flexDirection: m.role === "user" ? "row-reverse" : "row",
              gap: 12, alignItems: "flex-start",
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: m.role === "user" ? "var(--forest)" : "var(--gold)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: m.role === "user" ? "var(--cream)" : "var(--forest)", fontWeight: 700,
              }}>
                {m.role === "user" ? "S" : "AI"}
              </div>
              <div style={{ maxWidth: "80%" }}>
                <div style={{
                  background: m.role === "user" ? "var(--forest)" : "var(--surface-2)",
                  color: m.role === "user" ? "var(--cream)" : "var(--ink)",
                  borderRadius: 12, padding: "10px 14px", fontSize: 14, lineHeight: 1.6,
                }}>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{m.text}</pre>
                </div>
                <div className="m" style={{ color: "var(--ink-3)", fontSize: 11, marginTop: 4,
                  textAlign: m.role === "user" ? "right" : "left" }}>{m.time}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--forest)", fontWeight: 700 }}>AI</div>
              <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: "10px 14px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ink-3)", animation: `pulse 1.2s ${i * 0.4}s infinite` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 24px 20px", borderTop: "1px solid var(--rule)" }}>
          <div className="frow" style={{ gap: 10 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && ask(input)}
              placeholder="Ask about the house… (Enter to send)"
              disabled={loading}
              style={{ flex: 1 }}
              autoFocus
            />
            <button className="btn primary" disabled={!input.trim() || loading} onClick={() => ask(input)}>
              {loading ? "…" : "Ask"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
