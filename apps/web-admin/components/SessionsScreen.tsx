"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Session = { id: string; device_label: string | null; ip_address: string | null; last_seen_at: string; created_at: string; is_current: boolean };

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<{ provider: string; ip_address: string | null; device_label: string | null; success: boolean; created_at: string }[]>([]);
  const [tab, setTab] = useState<"devices" | "history">("devices");
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => {
    api<{ items: Session[] }>("/v1/me/sessions").then(r => setSessions(r.items)).catch(() => {});
    api<{ items: typeof history }>("/v1/me/sign-in-history").then(r => setHistory(r.items)).catch(() => {});
  };
  useEffect(load, []);

  const revoke = async (id: string) => {
    await api(`/v1/me/sessions/${id}`, { method: "DELETE" });
    setSessions(s => s.filter(x => x.id !== id));
    say("Device signed out");
  };

  const revokeAll = async () => {
    if (!confirm("Sign out all other devices? You will stay signed in here.")) return;
    const r = await api<{ revoked: number }>("/v1/me/sessions/revoke-all", { method: "POST" });
    await load();
    say(`Signed out ${r.revoked} device${r.revoked !== 1 ? "s" : ""}`);
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><div className="kicker">Account</div><h1 style={{ margin: 0 }}>My devices & sign-ins</h1></div>
        {sessions.filter(s => !s.is_current).length > 0 && (
          <button className="btn danger" style={{ color: "var(--danger, #c62828)" }} onClick={revokeAll}>
            Sign out all other devices
          </button>
        )}
      </div>

      <div className="seg" style={{ marginBottom: 20 }}>
        <button className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}>Active devices ({sessions.length})</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Sign-in history</button>
      </div>

      {tab === "devices" && (
        sessions.length === 0
          ? <p className="m" style={{ color: "var(--ink-2)" }}>No active sessions found.</p>
          : sessions.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--rule)" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: s.is_current ? "var(--forest)" : "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                  {(s.device_label ?? "").includes("iPhone") || (s.device_label ?? "").includes("iPad") ? "📱" :
                   (s.device_label ?? "").includes("Android") ? "📱" : "💻"}
                </div>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b>{s.device_label ?? "Unknown device"}</b>
                    {s.is_current && <span className="chip CONFIRMED" style={{ fontSize: 10 }}>This device</span>}
                  </div>
                  <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>
                    {s.ip_address ?? "IP unknown"} · Last seen {new Date(s.last_seen_at).toLocaleString("en-GB")}
                  </div>
                  <div className="m" style={{ color: "var(--ink-3)", fontSize: 11 }}>
                    Signed in {new Date(s.created_at).toLocaleString("en-GB")}
                  </div>
                </div>
              </div>
              {!s.is_current && (
                <button className="btn" style={{ fontSize: 12, color: "var(--danger, #c62828)" }} onClick={() => revoke(s.id)}>
                  Sign out
                </button>
              )}
            </div>
          ))
      )}

      {tab === "history" && (
        history.length === 0
          ? <p className="m" style={{ color: "var(--ink-2)" }}>No sign-in history yet.</p>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
                {["When", "Device", "IP", "Provider", "Result"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "10px 12px" }}>{new Date(h.created_at).toLocaleString("en-GB")}</td>
                    <td style={{ padding: "10px 12px" }}>{h.device_label ?? "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{h.ip_address ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{h.provider}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className={`chip ${h.success ? "CONFIRMED" : "CANCELLED"}`} style={{ fontSize: 11 }}>
                        {h.success ? "✓ Success" : "✗ Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
