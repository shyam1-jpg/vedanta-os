"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Event = { from_status: string | null; to_status: string | null; note: string | null; by_name: string | null; created_at: string };
type Flag = {
  id: string; first_name: string | null; problem_category: string; problem_detail: string | null; created_at: string;
  maintenance_ticket_id: string | null; capa_id: string | null; status: string | null; due_on: string | null;
  owner_user_id: string | null; owner_name: string | null; root_cause: string | null; corrective_action: string | null; preventive_action: string | null;
  events?: Event[];
};
type Dash = {
  averages: { n: number; food: string | null; room: string | null; overall: string | null };
  trends: { month: string; n: number; overall: string | null }[];
  people?: { id: string; name: string }[];
  flagged: Flag[];
};

const STATUS = ["open", "investigating", "action_taken", "verified", "closed"];
const STATUS_LABEL: Record<string, string> = { open: "Open", investigating: "Investigating", action_taken: "Action taken", verified: "Verified", closed: "Closed" };
const CAT: Record<string, string> = { food: "Food", room: "Room", staff: "Team", other: "Other" };

export default function FeedbackBoard() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [words, setWords] = useState<{ first_name: string; comment: string | null; created_at: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string; owner_user_id: string; root_cause: string; corrective_action: string; preventive_action: string; due_on: string }>>({});
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3000); };
  const load = () => {
    api<Dash>("/v1/feedback/dashboard").then(setDash).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open feedback"));
    api<{ items: typeof words }>("/v1/feedback/kind-words").then(r => setWords(r.items)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (!dash) return <div className="empty">Opening feedback…</div>;
  const avg = dash.averages;
  return (
    <>
      <div className="topbar"><div><h1>Guest feedback</h1><p>Scores after the stay, problems that need a corrective action, and kind words for the team.</p></div></div>
      <div className="pulse">
        <article><div className="k">Food</div><b>{avg.food ?? "—"}</b><div className="s">{avg.n} notes</div></article>
        <article><div className="k">Room</div><b>{avg.room ?? "—"}</b></article>
        <article><div className="k">Overall</div><b>{avg.overall ?? "—"}</b></article>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Trend</h3>
        {dash.trends.length === 0 && <p className="m">No notes yet.</p>}
        {dash.trends.map(t => <div key={t.month} className="m">{t.month} · overall {t.overall ?? "—"} · {t.n}</div>)}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Flagged</h3>
        {dash.flagged.length === 0 && <p className="m">Nothing flagged.</p>}
        {dash.flagged.map(f => {
          const d = draft[f.id] ?? { status: f.status ?? "open", owner_user_id: f.owner_user_id ?? "", root_cause: f.root_cause ?? "", corrective_action: f.corrective_action ?? "", preventive_action: f.preventive_action ?? "", due_on: f.due_on ?? "" };
          return (
            <div key={f.id} className="ops-card">
              <div className="ops-card-top"><b>{f.first_name || "Guest"} · {CAT[f.problem_category] ?? f.problem_category}</b><span className="m">{STATUS_LABEL[f.status ?? "open"] ?? f.status}{f.owner_name ? ` · ${f.owner_name}` : ""}</span></div>
              <p style={{ whiteSpace: "pre-wrap" }}>{f.problem_detail}</p>
              {f.maintenance_ticket_id && <div className="m">A maintenance ticket is open for this room.</div>}
              {f.capa_id && <button className="btn" type="button" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Hide corrective action" : "Corrective action"}</button>}
              {open === f.id && f.capa_id && (
                <div style={{ marginTop: 8 }}>
                  <label className="m">Status
                    <select value={d.status} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, status: e.target.value } }))}>{STATUS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                  </label>
                  <label className="m">Owner
                    <select value={d.owner_user_id} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, owner_user_id: e.target.value } }))}>
                      <option value="">Unassigned</option>
                      {(dash.people ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="m">Root cause<textarea rows={2} value={d.root_cause} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, root_cause: e.target.value } }))} /></label>
                  <label className="m">Corrective action<textarea rows={2} value={d.corrective_action} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, corrective_action: e.target.value } }))} /></label>
                  <label className="m">Preventive action<textarea rows={2} value={d.preventive_action} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, preventive_action: e.target.value } }))} /></label>
                  <label className="m">Due<input type="date" value={d.due_on} onChange={e => setDraft(s => ({ ...s, [f.id]: { ...d, due_on: e.target.value } }))} /></label>
                  <button className="btn primary" type="button" onClick={async () => {
                    try {
                      await api(`/v1/feedback/capa/${f.capa_id}`, { method: "PATCH", body: JSON.stringify(d) });
                      say("Saved");
                      load();
                    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
                  }}>Save</button>
                  {(f.events ?? []).length > 0 && (
                    <ul className="m">
                      {(f.events ?? []).map((ev, i) => (
                        <li key={i}>{STATUS_LABEL[ev.to_status ?? ""] ?? ev.to_status}{ev.by_name ? ` · ${ev.by_name}` : ""}{ev.note ? ` · ${ev.note}` : ""}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Kind words</h3>
        {words.length === 0 && <p className="m">No kind words yet.</p>}
        {words.map((w, i) => <div key={i} className="ops-card"><b>{w.first_name}</b><p style={{ whiteSpace: "pre-wrap" }}>{w.comment}</p></div>)}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
