"use client";
import { useEffect, useState } from "react";
import { api, ApiError, API, token } from "@/lib/api";
import { useStore } from "@/lib/store";
import { fmt } from "@/lib/format";
import { MatchPrompts, ReturningCards, type MatchPrompt, type ReturningCardData } from "@/components/ReturningCard";

type Stay = { id: string; name: string; arrival: string; departure: string; status: string; rooms: string[] };
type Note = { id: string; body: string; authorId: string; author: string; at: string };
type Feedback = { id: string; scores: string; comment: string | null; capaId: string | null };
type Hit = { id: string; display_name: string; email?: string | null; phone?: string | null; vip?: boolean; allergen_line?: string; room_preference?: string | null };
type Guest = {
  id: string; name: string; view: string; email?: string | null; phone?: string | null; organisation?: string | null;
  vip?: boolean; preferences?: string | null; accessibility?: string | null; roomPreference?: string | null;
  specialRequests?: string | null; dateOfBirth?: string | null; postcode?: string | null;
  allergenLine?: string; diet?: string[]; allergens?: { code: string; severity: string }[];
  previousStays?: number; lastVisit?: string | null; stays?: Stay[]; notes?: Note[];
  feedback?: Feedback[]; pastIssues?: string[]; compliments?: string[];
  consent?: boolean; consentAt?: string | null; withdrawnAt?: string | null; marker?: string | null;
  prompts?: MatchPrompt[]; card?: ReturningCardData;
};

export default function Guest360() {
  const { can } = useStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [tab, setTab] = useState<"stays" | "preferences" | "diet" | "notes" | "feedback">("stays");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const manager = guest?.view === "manager" || can("guest.profile.manage");

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(() =>
      api<{ items: Hit[] }>(`/v1/guest-history/search?q=${encodeURIComponent(query)}`)
        .then(r => setResults(r.items)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = (id: string) => {
    api<Guest>(`/v1/guest-history/${id}`).then(setGuest).catch(() => setGuest(null));
  };
  useEffect(() => { if (selId) load(selId); }, [selId]);

  const decide = async (id: string, action: "confirm" | "dismiss") => {
    try {
      await api(`/v1/guest-history/matches/${id}/${action}`, { method: "POST", body: "{}" });
      if (selId) load(selId);
      say(action === "confirm" ? "Profiles merged" : "Match dismissed");
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not update the match"); }
  };

  const download = async (format: "json" | "pdf") => {
    if (!selId) return;
    const headers: Record<string, string> = {};
    const t = token.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/guest-history/${selId}/export?format=${format}`, { headers });
    if (!res.ok) { say("Export failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = format === "pdf" ? "guest-profile.pdf" : "guest-profile.json";
    a.click(); URL.revokeObjectURL(url);
  };

  const stays = guest?.stays ?? [];
  const notes = guest?.notes ?? [];
  const feedback = guest?.feedback ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%", overflow: "hidden" }}>
      <div style={{ borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <h1>Guests</h1>
          <input placeholder="Search by name, email or phone…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: "100%", marginTop: 10 }} autoFocus />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {results.map(g => (
            <div key={g.id} className={selId === g.id ? "list-row active" : "list-row"} onClick={() => setSelId(g.id)} style={{ padding: "10px 12px", cursor: "pointer", borderRadius: 8, marginBottom: 2 }}>
              <b style={{ fontSize: 14 }}>{g.display_name}</b>
              {g.vip && <span className="chip CONFIRMED" style={{ fontSize: 10, marginLeft: 6 }}>VIP</span>}
              <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{[g.email, g.phone, g.room_preference, g.allergen_line].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
          {query.length >= 2 && results.length === 0 && <p className="m" style={{ color: "var(--ink-2)", padding: "0 12px" }}>No guests found.</p>}
          {query.length < 2 && <p className="m" style={{ color: "var(--ink-2)", padding: "0 12px" }}>Type at least 2 characters to search.</p>}
        </div>
      </div>

      {!guest ? (
        <div className="empty" style={{ padding: 48 }}>Select a guest to see their profile</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "24px 28px 16px", borderBottom: "1px solid var(--rule)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>{guest.name}</h2>
                <div className="m" style={{ color: "var(--ink-2)", marginTop: 4 }}>
                  {[guest.email, guest.phone, guest.organisation].filter(Boolean).join(" · ") || "Profile"}
                  {guest.marker ? ` · ${guest.marker}` : ""}
                </div>
              </div>
              {manager && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => download("json")}>Export JSON</button>
                  <button className="btn" onClick={() => download("pdf")}>Export PDF</button>
                  <button className="btn" onClick={() => {
                    if (!selId || !confirm("Erase this guest's profile? This cannot be undone.")) return;
                    api(`/v1/guest-history/${selId}/erase`, { method: "POST", body: "{}" }).then(() => { load(selId); say("Profile erased"); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Erase failed"));
                  }}>Erase</button>
                </div>
              )}
            </div>
            {guest.card && <ReturningCards cards={[guest.card]} />}
            <MatchPrompts prompts={guest.prompts ?? []} onDecide={decide} />
            {manager && (
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => selId && api(`/v1/guest-history/${selId}/consent`, { method: "POST", body: JSON.stringify({ keep: !guest.consent }) }).then(() => { load(selId); say(guest.consent ? "Consent withdrawn" : "Consent recorded"); })}>
                  {guest.consent ? "Withdraw allergen consent" : "Record consent to keep allergens"}
                </button>
                {guest.consentAt && <span className="m" style={{ marginLeft: 8 }}>Recorded {fmt(guest.consentAt, { day: "numeric", month: "short", year: "numeric" })}</span>}
                <button className="btn" style={{ marginLeft: 8 }} onClick={() => selId && api(`/v1/guest-history/${selId}/unmerge`, { method: "POST", body: "{}" }).then(() => { load(selId); say("Merge undone"); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Nothing to unmerge"))}>Unmerge</button>
              </div>
            )}
          </div>

          <div className="seg" role="tablist" style={{ margin: "0 28px", paddingTop: 14 }}>
            {(["stays", "preferences", "diet", "notes", "feedback"] as const).map(t => (
              <button key={t} role="tab" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "stays" ? `Stays (${stays.length})` : t === "notes" ? `Notes (${notes.length})` : t === "feedback" ? `Feedback (${feedback.length})` : t === "diet" ? "Diet history" : "Preferences"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px 28px" }}>
            {tab === "stays" && (stays.length === 0
              ? <p className="m">No stays recorded yet.</p>
              : stays.map(s => (
                <div key={s.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                  <b>{s.name}</b> <span className={`chip ${s.status}`}>{s.status}</span>
                  <div className="m">{s.arrival} → {s.departure}{s.rooms?.length ? ` · ${s.rooms.join(", ")}` : ""}</div>
                </div>
              )))}

            {tab === "preferences" && (
              <div>
                <p>Room: {guest.roomPreference || "Not recorded"}</p>
                <p>Access: {guest.accessibility || "Not recorded"}</p>
                <p>Requests: {guest.specialRequests || guest.preferences || "Not recorded"}</p>
                {guest.dateOfBirth && <p>Date of birth: {guest.dateOfBirth}</p>}
                {guest.postcode && <p>Postcode: {guest.postcode}</p>}
              </div>
            )}

            {tab === "diet" && (
              <div>
                <p style={{ fontWeight: 700 }}>{guest.allergenLine || "allergens: ask again"}</p>
                {!!guest.diet?.length && <p>Diet: {guest.diet.join(", ").replace(/_/g, " ")}</p>}
                {(guest.allergens ?? []).map(item => <div key={item.code}>{item.code.replace(/_/g, " ")} · {item.severity}</div>)}
                <p className="m">Without consent to keep dietary details, older allergens are not shown. The card says &quot;allergens: ask again&quot;.</p>
              </div>
            )}

            {tab === "notes" && (
              <div>
                {manager && (
                  <div style={{ marginBottom: 12 }}>
                    <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="House note" style={{ width: "100%" }} />
                    <button className="btn primary" onClick={() => {
                      if (!selId || !note.trim()) return;
                      api(`/v1/guest-history/${selId}/notes`, { method: "POST", body: JSON.stringify({ body: note }) })
                        .then(() => { setNote(""); load(selId); say("Note added"); })
                        .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not save the note"));
                    }}>Add note</button>
                  </div>
                )}
                {notes.length === 0 && <p className="m">No staff notes.</p>}
                {notes.map(n => (
                  <div key={n.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                    <b>{n.author}</b> <span className="m">{fmt(n.at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {editing === n.id
                      ? <div><textarea rows={2} value={editBody} onChange={e => setEditBody(e.target.value)} style={{ width: "100%" }} />
                        <button className="btn" onClick={() => api(`/v1/guest-history/notes/${n.id}`, { method: "PATCH", body: JSON.stringify({ body: editBody }) }).then(() => { setEditing(null); if (selId) load(selId); })}>Save</button></div>
                      : <p>{n.body}</p>}
                    {manager && editing !== n.id && !n.body.startsWith("deleted per retention") && !n.body.startsWith("erased at") && (
                      <button className="btn" onClick={() => { setEditing(n.id); setEditBody(n.body); }}>Edit</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === "feedback" && (
              <div>
                {(guest.pastIssues ?? []).map(issue => <p key={issue}>Be aware: {issue}</p>)}
                {(guest.compliments ?? []).map(line => <p key={line}>Kind word: {line}</p>)}
                {feedback.map(row => (
                  <div key={row.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                    <b>Scores {row.scores}</b>
                    {row.capaId && <span className="m"> · corrective action linked</span>}
                    {row.comment && <p>{row.comment}</p>}
                  </div>
                ))}
                {feedback.length === 0 && <p className="m">No feedback linked yet.</p>}
              </div>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
