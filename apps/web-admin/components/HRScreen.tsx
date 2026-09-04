"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

type Shift = { id: string; shift_date: string; start_time: string; end_time: string; department: string; status: string; display_name: string };
type ClockStatus = { clocked_in: boolean; record: { id: string; clocked_in_at: string } | null };
type Absence = { id: string; kind: string; from_date: string; to_date: string; days: number | null; status: string; display_name: string };
type Training = { id: string; title: string; kind: string; completed_at: string | null; expires_at: string | null; cert_status: string; display_name?: string };

export default function HRScreen() {
  const { can, user } = useStore();
  const [tab, setTab] = useState<"rota" | "clock" | "absence" | "training">("rota");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [training, setTraining] = useState<Training[]>([]);
  const [expiring, setExpiring] = useState<Training[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    api<{ items: Shift[] }>(`/v1/rota?from=${today}&to=${weekEnd}`).then(r => setShifts(r.items)).catch(() => {});
    api<ClockStatus>("/v1/clock/status").then(setClock).catch(() => {});
    api<{ items: Absence[] }>("/v1/absence").then(r => setAbsences(r.items)).catch(() => {});
    api<{ items: Training[] }>("/v1/training").then(r => setTraining(r.items)).catch(() => {});
    if (can("clock.manage")) api<{ items: Training[] }>("/v1/training/expiring").then(r => setExpiring(r.items)).catch(() => {});
  }, []);

  const clockIn = async () => {
    try { const r = await api<any>("/v1/clock/in", { method: "POST" }); setClock({ clocked_in: true, record: r }); say("Clocked in ✓"); } catch (e: any) { say(e.message ?? "Failed"); }
  };
  const clockOut = async () => {
    try { await api("/v1/clock/out", { method: "POST" }); setClock({ clocked_in: false, record: null }); say("Clocked out ✓"); } catch (e: any) { say(e.message ?? "Failed"); }
  };

  const byDay = shifts.reduce((m: Record<string, Shift[]>, s) => { (m[s.shift_date] = m[s.shift_date] ?? []).push(s); return m; }, {});

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><div className="kicker">People</div><h1 style={{ margin: 0 }}>HR & Rota</h1></div>
        {/* Clock in/out strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface-2)", borderRadius: 10, padding: "10px 16px" }}>
          <div>
            <div className="m" style={{ fontSize: 12, color: "var(--ink-2)" }}>You are</div>
            <b style={{ color: clock?.clocked_in ? "var(--success, #2d6a4f)" : "var(--ink-2)" }}>{clock?.clocked_in ? "Clocked in" : "Not clocked in"}</b>
            {clock?.record && <div className="m" style={{ fontSize: 11, color: "var(--ink-3)" }}>since {new Date(clock.record.clocked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>}
          </div>
          <button className={`btn ${clock?.clocked_in ? "" : "primary"}`} onClick={clock?.clocked_in ? clockOut : clockIn}>
            {clock?.clocked_in ? "Clock out" : "Clock in"}
          </button>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="note" style={{ marginBottom: 20, background: "var(--warning-bg, #fff3cd)", borderColor: "var(--warning, #ffc107)" }}>
          ⚠️ <b>{expiring.length} certificate{expiring.length > 1 ? "s" : ""} expiring within 60 days</b> — {expiring.map(e => `${e.title} (${e.display_name ?? "—"}, ${e.expires_at})`).join("; ")}
        </div>
      )}

      <div className="seg" style={{ marginBottom: 20 }}>
        {(["rota", "clock", "absence", "training"] as const).map(t => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "rota" ? "Rota (7 days)" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "rota" && (
        Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayShifts]) => (
          <div key={date} style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 10 }}>{new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h3>
            {dayShifts.map(s => (
              <div key={s.id} style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
                <div style={{ width: 120, fontSize: 13 }}>{s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}</div>
                <span className={`chip ${s.status === "confirmed" ? "CONFIRMED" : "ENQUIRY"}`} style={{ fontSize: 11, width: 80, textAlign: "center" }}>{s.department}</span>
                <div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{s.display_name}</b></div>
                <span className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{s.status}</span>
              </div>
            ))}
          </div>
        ))
      )}

      {tab === "clock" && (
        <div>
          <p className="m" style={{ color: "var(--ink-2)", marginBottom: 16 }}>Your clock records for the last 50 shifts.</p>
          {/* Clock records fetched on demand */}
          <ClockRecords />
        </div>
      )}

      {tab === "absence" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Absence & holiday</h3>
            <button className="btn primary" onClick={() => {
              const from = prompt("From date (YYYY-MM-DD):"); if (!from) return;
              const to = prompt("To date (YYYY-MM-DD):"); if (!to) return;
              const kind = prompt("Kind (holiday/sickness/compassionate/other):", "holiday") ?? "holiday";
              api("/v1/absence", { method: "POST", body: JSON.stringify({ from_date: from, to_date: to, kind }) })
                .then(() => api<{ items: Absence[] }>("/v1/absence").then(r => setAbsences(r.items)))
                .then(() => say("Request submitted")).catch(() => say("Failed"));
            }}>Request absence</button>
          </div>
          {absences.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
              <div>
                <b>{a.display_name}</b> — <span className="m">{a.kind}</span>
                <div className="m" style={{ color: "var(--ink-2)", fontSize: 13 }}>{a.from_date} → {a.to_date}{a.days ? ` (${a.days} days)` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`chip ${a.status === "approved" ? "CONFIRMED" : a.status === "declined" ? "CANCELLED" : "ENQUIRY"}`} style={{ fontSize: 11 }}>{a.status}</span>
                {can("clock.manage") && a.status === "pending" && (
                  <>
                    <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={() => api(`/v1/absence/${a.id}/approve`, { method: "POST" }).then(() => say("Approved")).catch(() => {})}>Approve</button>
                    <button className="btn" style={{ fontSize: 11, padding: "2px 10px", color: "var(--danger)" }} onClick={() => api(`/v1/absence/${a.id}/decline`, { method: "POST", body: JSON.stringify({ reason: "Not approved" }) }).then(() => say("Declined")).catch(() => {})}>Decline</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "training" && (
        <div>
          <h3 style={{ marginBottom: 12 }}>Training & qualifications</h3>
          {training.map(t => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
              <div>
                <b>{t.title}</b> <span className="m" style={{ color: "var(--ink-2)" }}>({t.kind})</span>
                <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{t.completed_at ?? "Not completed"}{t.expires_at ? ` · Expires ${t.expires_at}` : ""}</div>
              </div>
              {t.expires_at && (
                <span className={`chip ${t.cert_status === "valid" ? "CONFIRMED" : t.cert_status === "expiring_soon" ? "PROVISIONAL" : "CANCELLED"}`} style={{ fontSize: 11 }}>
                  {t.cert_status === "valid" ? "Valid" : t.cert_status === "expiring_soon" ? "Expiring soon" : "Expired"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ClockRecords() {
  const [records, setRecords] = useState<any[]>([]);
  useEffect(() => { api<{ items: any[] }>("/v1/clock/records").then(r => setRecords(r.items)).catch(() => {}); }, []);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead><tr style={{ borderBottom: "2px solid var(--rule)", textAlign: "left" }}>
        <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Date</th>
        <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>In</th>
        <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Out</th>
        <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Hours</th>
        <th style={{ padding: "8px 12px", color: "var(--ink-2)", fontWeight: 600 }}>Status</th>
      </tr></thead>
      <tbody>
        {records.map(r => (
          <tr key={r.id} style={{ borderBottom: "1px solid var(--rule)" }}>
            <td style={{ padding: "10px 12px" }}>{new Date(r.clocked_in_at).toLocaleDateString("en-GB")}</td>
            <td style={{ padding: "10px 12px" }}>{new Date(r.clocked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</td>
            <td style={{ padding: "10px 12px" }}>{r.clocked_out_at ? new Date(r.clocked_out_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "In progress"}</td>
            <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.hours_worked ? Number(r.hours_worked).toFixed(1) : "—"}</td>
            <td style={{ padding: "10px 12px" }}><span className={`chip ${r.approved_at ? "CONFIRMED" : "ENQUIRY"}`} style={{ fontSize: 11 }}>{r.approved_at ? "Approved" : "Pending"}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
