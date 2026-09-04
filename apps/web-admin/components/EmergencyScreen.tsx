"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Incident = { id: string; kind: string; severity: string; title: string; location: string | null; resolved_at: string | null; created_at: string; reported_by_name: string };
type Asset = { id: string; qr_code: string; name: string; category: string; location: string | null; status: string; next_service_date: string | null; service_status: string };

const SEV: Record<string, string> = { green: "CONFIRMED", amber: "PROVISIONAL", red: "ENQUIRY", critical: "CANCELLED" };
const KIND_ICON: Record<string, string> = { fire: "🔥", medical: "🏥", missing_guest: "🔍", power_failure: "⚡", water_leak: "💧", evacuation: "🚨", security: "🔒", other: "⚠️" };

export default function EmergencyScreen() {
  const [tab, setTab] = useState<"incidents" | "compliance" | "assets">("incidents");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selIncident, setSelIncident] = useState<any | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [compliance, setCompliance] = useState<any[]>([]);
  const [newAction, setNewAction] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api<{ items: Incident[] }>("/v1/emergencies").then(r => setIncidents(r.items)).catch(() => {});
    api<{ items: Asset[] }>("/v1/assets").then(r => setAssets(r.items)).catch(() => {});
    api<{ items: any[] }>("/v1/compliance").then(r => setCompliance(r.items)).catch(() => {});
  }, []);

  const raiseIncident = async () => {
    const kind = prompt("Incident type (fire/medical/missing_guest/power_failure/water_leak/evacuation/security/other):"); if (!kind) return;
    const title = prompt("Brief description:"); if (!title) return;
    const location = prompt("Location (optional):") ?? undefined;
    const severity = prompt("Severity (green/amber/red/critical):", "amber") ?? "amber";
    const r = await api<{ id: string }>("/v1/emergencies", { method: "POST", body: JSON.stringify({ kind, title, location, severity }) });
    const full = await api<any>(`/v1/emergencies/${r.id}`);
    setSelIncident(full); setIncidents(i => [{ id: r.id, kind, severity, title, location: location ?? null, resolved_at: null, created_at: new Date().toISOString(), reported_by_name: "You" }, ...i]);
    say("🚨 Incident raised");
  };

  const addAction = async () => {
    if (!selIncident || !newAction.trim()) return;
    const r = await api<any>(`/v1/emergencies/${selIncident.id}/actions`, { method: "POST", body: JSON.stringify({ action: newAction }) });
    setSelIncident((i: any) => ({ ...i, actions: [...(i.actions ?? []), r] }));
    setNewAction(""); say("Action logged");
  };

  const resolve = async () => {
    if (!selIncident) return;
    const notes = prompt("Resolution notes:");
    await api(`/v1/emergencies/${selIncident.id}/resolve`, { method: "POST", body: JSON.stringify({ resolution_notes: notes }) });
    setSelIncident((i: any) => ({ ...i, resolved_at: new Date().toISOString() }));
    setIncidents(is => is.map(i => i.id === selIncident.id ? { ...i, resolved_at: new Date().toISOString() } : i));
    say("Incident resolved ✓");
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><div className="kicker">Safety</div><h1 style={{ margin: 0 }}>Emergency & Compliance</h1></div>
        <button className="btn danger" style={{ background: "var(--danger, #c62828)", color: "white", fontWeight: 700 }} onClick={raiseIncident}>🚨 Raise incident</button>
      </div>

      <div className="seg" style={{ marginBottom: 20 }}>
        {(["incidents", "compliance", "assets"] as const).map(t => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "incidents" ? `Incidents (${incidents.filter(i => !i.resolved_at).length} open)` :
             t === "compliance" ? `Compliance (${compliance.filter(c => !c.completed_at || (c.due_date && c.due_date < new Date().toISOString().slice(0, 10))).length} due)` :
             `Assets (${assets.filter(a => a.service_status !== "ok").length} need attention)`}
          </button>
        ))}
      </div>

      {tab === "incidents" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24, height: "calc(100vh - 220px)", overflow: "hidden" }}>
          {/* List */}
          <div style={{ overflowY: "auto" }}>
            {incidents.length === 0 && <p className="m" style={{ color: "var(--ink-2)" }}>No incidents recorded.</p>}
            {incidents.map(i => (
              <div key={i.id} className={selIncident?.id === i.id ? "list-row active" : "list-row"}
                onClick={() => api<any>(`/v1/emergencies/${i.id}`).then(setSelIncident)}
                style={{ padding: "12px 14px", cursor: "pointer", borderRadius: 8, marginBottom: 4, borderLeft: `4px solid var(--${i.severity === "critical" ? "danger" : i.severity === "red" ? "danger" : "gold"}, #b8860b)` }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 18 }}>{KIND_ICON[i.kind] ?? "⚠️"}</span>
                  <span className={`chip ${SEV[i.severity] ?? "ENQUIRY"}`} style={{ fontSize: 10 }}>{i.severity}</span>
                  <b style={{ fontSize: 14 }}>{i.title}</b>
                </div>
                <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginTop: 4 }}>
                  {i.location ? `${i.location} · ` : ""}{new Date(i.created_at).toLocaleString("en-GB")}
                  {i.resolved_at ? " · ✓ Resolved" : " · 🔴 Open"}
                </div>
              </div>
            ))}
          </div>
          {/* Detail */}
          {selIncident ? (
            <div style={{ overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{KIND_ICON[selIncident.kind]} {selIncident.title}</h2>
                  <div className="m" style={{ color: "var(--ink-2)", marginTop: 4 }}>
                    {selIncident.kind} · {selIncident.severity} · {selIncident.location ?? "no location"} · Reported by {selIncident.reported_by_name}
                  </div>
                </div>
                {!selIncident.resolved_at && <button className="btn primary" onClick={resolve}>Mark resolved</button>}
              </div>
              {selIncident.description && <p style={{ marginBottom: 16 }}>{selIncident.description}</p>}
              <h3>Action log</h3>
              {(selIncident.actions ?? []).map((a: any) => (
                <div key={a.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14 }}>{a.action}</span>
                    <span className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{new Date(a.taken_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {a.display_name ?? "—"}</span>
                  </div>
                </div>
              ))}
              {!selIncident.resolved_at && (
                <div className="frow" style={{ gap: 10, marginTop: 16 }}>
                  <input placeholder="Log an action…" value={newAction} onChange={e => setNewAction(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addAction()} style={{ flex: 1 }} />
                  <button className="btn primary" disabled={!newAction.trim()} onClick={addAction}>Log</button>
                </div>
              )}
              {selIncident.resolved_at && selIncident.resolution_notes && (
                <div style={{ marginTop: 16, background: "var(--surface-2)", borderRadius: 8, padding: 14 }}>
                  <b>Resolution:</b> {selIncident.resolution_notes}
                </div>
              )}
            </div>
          ) : <div className="empty">Select an incident to view details and log actions</div>}
        </div>
      )}

      {tab === "compliance" && (
        <div>
          {compliance.length === 0
            ? <p className="m" style={{ color: "var(--ink-2)" }}>No compliance records. Add fire safety, food hygiene, legionella and health & safety records.</p>
            : compliance.map(c => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                <div>
                  <b>{c.title}</b> <span className="m" style={{ color: "var(--ink-2)" }}>({c.category})</span>
                  <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>
                    {c.frequency ? `${c.frequency} · ` : ""}{c.due_date ? `Due ${c.due_date}` : "No due date"}
                    {c.completed_at ? ` · Completed ${new Date(c.completed_at).toLocaleDateString("en-GB")} by ${c.completed_by_name ?? "—"}` : ""}
                  </div>
                  {c.failure_notes && <div className="m" style={{ color: "var(--danger)", fontSize: 12 }}>Failure: {c.failure_notes}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={`chip ${c.completed_at && c.passed ? "CONFIRMED" : c.completed_at && !c.passed ? "CANCELLED" : "ENQUIRY"}`} style={{ fontSize: 11 }}>
                    {c.completed_at ? (c.passed ? "Passed" : "Failed") : "Pending"}
                  </span>
                  {!c.completed_at && (
                    <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }}
                      onClick={() => api(`/v1/compliance/${c.id}/complete`, { method: "POST", body: JSON.stringify({ passed: true }) }).then(() => say("Marked complete")).catch(() => {})}>
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === "assets" && (
        <div>
          {assets.filter(a => a.service_status !== "ok").length > 0 && (
            <div className="note" style={{ marginBottom: 16 }}>
              ⚠️ {assets.filter(a => a.service_status === "overdue").length} assets overdue for service · {assets.filter(a => a.service_status === "due_soon").length} due within 30 days
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Asset</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>QR</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Category</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Location</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Next service</th>
              <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Status</th>
            </tr></thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{a.name}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-2)", fontFamily: "monospace" }}>{a.qr_code}</td>
                  <td style={{ padding: "10px 12px" }}>{a.category}</td>
                  <td style={{ padding: "10px 12px", color: "var(--ink-2)" }}>{a.location ?? "—"}</td>
                  <td style={{ padding: "10px 12px", color: a.service_status === "overdue" ? "var(--danger)" : a.service_status === "due_soon" ? "var(--gold, #b8860b)" : "var(--ink)" }}>
                    {a.next_service_date ?? "—"}
                    {a.service_status === "overdue" && " ⚠️"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className={`chip ${a.status === "operational" ? "CONFIRMED" : a.status === "under_maintenance" ? "PROVISIONAL" : "CANCELLED"}`} style={{ fontSize: 11 }}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
