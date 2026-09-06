"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { fmt } from "@/lib/format";

type Guest = {
  id: string; display_name: string; email: string; organisation: string | null;
  email_verified: boolean; vip: boolean; flagged: boolean; flagged_reason: string | null;
  dietary_notes: string | null; accessibility_notes: string | null;
  room_preference: string | null; arrival_preference: string | null;
  travel_notes: string | null; notes: string | null; marketing_ok: boolean;
  created_at: string;
};
type Stay = {
  id: string; programme_name: string | null; arrival: string; departure: string;
  status: string; people: number; rooms: string[];
};
type Comm = {
  id: string; kind: string; direction: string; subject: string | null;
  body: string | null; status: string; created_at: string;
};
type Complaint = {
  id: string; severity: string; department: string | null; description: string;
  resolution: string | null; resolved_at: string | null; created_at: string;
};

const SEV_COLOUR: Record<string, string> = { minor: "PROVISIONAL", moderate: "ENQUIRY", serious: "CANCELLED", critical: "CANCELLED" };

export default function Guest360() {
  const { can } = useStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; display_name: string; email: string; organisation: string | null; vip: boolean; email_verified: boolean }[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [comms, setComms] = useState<Comm[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [tab, setTab] = useState<"stays" | "preferences" | "comms" | "complaints">("stays");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Guest>>({});
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  // Search
  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(() =>
      api<{ items: typeof results }>(`/v1/guests?q=${encodeURIComponent(query)}&limit=20`)
        .then(r => setResults(r.items)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Load selected guest
  useEffect(() => {
    if (!selId) return;
    setGuest(null); setStays([]); setComms([]); setComplaints([]);
    api<Guest>(`/v1/guests/${selId}`).then(g => { setGuest(g); setDraft(g); }).catch(() => {});
    api<{ items: Stay[] }>(`/v1/guests/${selId}/stays`).then(r => setStays(r.items)).catch(() => {});
    api<{ items: Comm[] }>(`/v1/guests/${selId}/communications`).then(r => setComms(r.items)).catch(() => {});
    api<{ items: Complaint[] }>(`/v1/guests/${selId}/complaints`).then(r => setComplaints(r.items)).catch(() => {});
  }, [selId]);

  const save = async () => {
    if (!selId) return;
    try {
      await api(`/v1/guests/${selId}`, { method: "PATCH", body: JSON.stringify(draft) });
      const updated = await api<Guest>(`/v1/guests/${selId}`);
      setGuest(updated); setDraft(updated); setEditing(false); say("Saved");
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Save failed"); }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%", overflow: "hidden" }}>
      {/* Left: search + list */}
      <div style={{ borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <h1>Guests</h1>
          <input
            placeholder="Search by name or email…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ width: "100%", marginTop: 10 }}
            autoFocus
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {results.map(g => (
            <div key={g.id}
              className={selId === g.id ? "list-row active" : "list-row"}
              onClick={() => setSelId(g.id)}
              style={{ padding: "10px 12px", cursor: "pointer", borderRadius: 8, marginBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <b style={{ fontSize: 14 }}>{g.display_name}</b>
                {g.vip && <span className="chip CONFIRMED" style={{ fontSize: 10 }}>VIP</span>}
                {!g.email_verified && <span className="chip ENQUIRY" style={{ fontSize: 10 }}>unverified</span>}
              </div>
              <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{g.email}{g.organisation ? ` · ${g.organisation}` : ""}</div>
            </div>
          ))}
          {query.length >= 2 && results.length === 0 && (
            <p className="m" style={{ color: "var(--ink-2)", padding: "0 12px" }}>No guests found.</p>
          )}
          {query.length < 2 && (
            <p className="m" style={{ color: "var(--ink-2)", padding: "0 12px" }}>Type at least 2 characters to search.</p>
          )}
        </div>
      </div>

      {/* Right: guest profile */}
      {!guest ? (
        <div className="empty" style={{ padding: 48 }}>Select a guest to see their profile</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "24px 28px 16px", borderBottom: "1px solid var(--rule)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ margin: 0 }}>{guest.display_name}</h2>
                  {guest.vip && <span className="chip CONFIRMED">VIP</span>}
                  {guest.flagged && <span className="chip CANCELLED" title={guest.flagged_reason ?? ""}>⚑ Flagged</span>}
                  {guest.email_verified
                    ? <span className="chip CONFIRMED" style={{ fontSize: 11 }}>✓ email verified</span>
                    : <span className="chip ENQUIRY" style={{ fontSize: 11 }}>email unverified</span>}
                </div>
                <div className="m" style={{ color: "var(--ink-2)", marginTop: 4 }}>
                  {guest.email}{guest.organisation ? ` · ${guest.organisation}` : ""}
                  {" · "}Guest since {fmt(guest.created_at, { month: "short", year: "numeric" })}
                </div>
              </div>
              {can("guest.update") && (
                editing
                  ? <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" onClick={() => { setEditing(false); setDraft(guest); }}>Cancel</button>
                      <button className="btn primary" onClick={save}>Save changes</button>
                    </div>
                  : <button className="btn" onClick={() => setEditing(true)}>Edit profile</button>
              )}
            </div>
            {/* Stay summary strip */}
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              {[
                { label: "Stays", value: stays.length },
                { label: "Upcoming", value: stays.filter(s => s.arrival > new Date().toISOString().slice(0, 10)).length },
                { label: "Complaints", value: complaints.length },
                { label: "Emails", value: comms.filter(c => c.kind === "email").length },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
                  <div className="m" style={{ color: "var(--ink-2)", fontSize: 11 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="seg" role="tablist" style={{ margin: "0 28px", paddingTop: 14 }}>
            {(["stays", "preferences", "comms", "complaints"] as const).map(t => (
              <button key={t} role="tab" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "stays" ? `Stays (${stays.length})` :
                 t === "comms" ? `Comms (${comms.length})` :
                 t === "complaints" ? `Complaints (${complaints.length})` :
                 "Preferences"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px 28px" }}>

            {tab === "stays" && (
              stays.length === 0
                ? <p className="m" style={{ color: "var(--ink-2)" }}>No stays recorded yet.</p>
                : stays.map(s => (
                  <div key={s.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <b>{s.programme_name ?? "Private stay"}</b>
                      <span className={`chip ${s.status}`} style={{ fontSize: 11 }}>{s.status}</span>
                    </div>
                    <div className="m" style={{ color: "var(--ink-2)", marginTop: 3 }}>
                      {fmt(s.arrival, { day: "numeric", month: "short", year: "numeric" })} → {fmt(s.departure, { day: "numeric", month: "short", year: "numeric" })}
                      {s.rooms.length > 0 ? ` · ${s.rooms.join(", ")}` : ""}
                      {s.people > 1 ? ` · ${s.people} guests` : ""}
                    </div>
                  </div>
                ))
            )}

            {tab === "preferences" && (
              <div style={{ maxWidth: 560 }}>
                {(["dietary_notes", "accessibility_notes", "room_preference", "arrival_preference", "travel_notes", "notes"] as const).map(field => {
                  const labels: Record<string, string> = {
                    dietary_notes: "Dietary notes", accessibility_notes: "Accessibility needs",
                    room_preference: "Room preference", arrival_preference: "Arrival preference",
                    travel_notes: "Travel notes", notes: "Private house notes",
                  };
                  return (
                    <div key={field} style={{ marginBottom: 18 }}>
                      <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{labels[field]}</label>
                      {editing
                        ? <textarea rows={2} value={(draft as Record<string, string | null>)[field] ?? ""}
                            onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                            style={{ width: "100%", resize: "vertical" }} />
                        : <p className="m" style={{ color: (guest as unknown as Record<string, string | null>)[field] ? "var(--ink)" : "var(--ink-3)", margin: 0 }}>
                            {(guest as unknown as Record<string, string | null>)[field] ?? "Not recorded"}
                          </p>}
                    </div>
                  );
                })}
                {editing && (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!draft.vip} onChange={e => setDraft(d => ({ ...d, vip: e.target.checked }))} />
                      VIP guest
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!draft.marketing_ok} onChange={e => setDraft(d => ({ ...d, marketing_ok: e.target.checked }))} />
                      Marketing OK
                    </label>
                  </div>
                )}
              </div>
            )}

            {tab === "comms" && (
              comms.length === 0
                ? <p className="m" style={{ color: "var(--ink-2)" }}>No communications logged yet.</p>
                : comms.map(c => (
                  <div key={c.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ fontSize: 13 }}>{c.subject ?? `${c.kind} ${c.direction}`}</b>
                      <span className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{fmt(c.created_at, { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                    {c.body && <p className="m" style={{ color: "var(--ink-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{c.body.slice(0, 200)}{c.body.length > 200 ? "…" : ""}</p>}
                  </div>
                ))
            )}

            {tab === "complaints" && (
              complaints.length === 0
                ? <p className="m" style={{ color: "var(--ink-2)" }}>No complaints recorded.</p>
                : complaints.map(c => (
                  <div key={c.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className={`chip ${SEV_COLOUR[c.severity] ?? "ENQUIRY"}`} style={{ fontSize: 11 }}>{c.severity}</span>
                      <span className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{fmt(c.created_at, { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                    <p className="m" style={{ marginTop: 6 }}>{c.description}</p>
                    {c.resolution && <p className="m" style={{ color: "var(--ink-2)", marginTop: 4 }}>Resolution: {c.resolution}</p>}
                    {c.resolved_at && <p className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>Resolved {fmt(c.resolved_at, { day: "numeric", month: "short", year: "numeric" })}</p>}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
