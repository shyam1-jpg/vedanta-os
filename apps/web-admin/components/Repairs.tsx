"use client";
import { useEffect, useState } from "react";
import { api, ApiError, API, token } from "@/lib/api";
import { useStore } from "@/lib/store";
import { mayOperate } from "../../../domains/ops/suite";
import { ReportFault } from "@/components/Maintenance";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Ticket = { id: string; number: number; title: string; description: string | null; priority: string; status: string; location: string | null; department: string | null; room: string | null; assigned_to: string | null; assigned_to_user_id: string | null; photo_count: number; resolution: string | null };
type Photo = { id: string; filename: string };
const NEXT: Record<string, [string, string][]> = {
  OPEN: [["start", "Start"], ["wait", "Waiting for parts"], ["done", "Done"], ["cancel", "Cancel"]],
  IN_PROGRESS: [["wait", "Waiting for parts"], ["done", "Done"], ["cancel", "Cancel"]],
  WAITING_PARTS: [["start", "Start"], ["done", "Done"], ["cancel", "Cancel"]],
  DONE: [["reopen", "Reopen"]],
  CANCELLED: [["reopen", "Reopen"]],
};

export default function Repairs() {
  const { can, user } = useStore();
  const operate = mayOperate(user?.permissions ?? []) && can("maintenance.report");
  const [items, setItems] = useState<Ticket[]>([]);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [closed, setClosed] = useState(false);
  const [sel, setSel] = useState<Ticket | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reporting, setReporting] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ items: Ticket[]; assignees: { id: string; name: string }[] }>(`/v1/maintenance?status=${closed ? "closed" : "open"}`).then(r => { setItems(r.items); setAssignees(r.assignees); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open repairs"));
  useEffect(() => { load(); }, [closed]);
  useEffect(() => { if (sel) api<{ items: Photo[] }>(`/v1/maintenance/${sel.id}/photos`).then(r => setPhotos(r.items)).catch(() => setPhotos([])); }, [sel?.id]);
  return (
    <>
      <div className="topbar">
        <div><h1>Repairs</h1><p>Faults with a priority, a place, an owner and a photo. The same tickets as Maintenance.</p></div>
      </div>
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={q} onQuery={setQ} placeholder="Search repairs"
        onAdd={operate ? () => setReporting(true) : undefined}
        addLabel="Add entry"
        filters={<div className="seg"><button className={!closed ? "on" : ""} onClick={() => setClosed(false)}>Open</button><button className={closed ? "on" : ""} onClick={() => setClosed(true)}>Closed</button></div>}
      />
      <div className="split">
        <div className="list">
          {items.filter(t => `${t.number} ${t.title} ${t.location ?? ""} ${t.room ?? ""} ${t.assigned_to ?? ""}`.toLowerCase().includes(q.toLowerCase())).map(t => (
            <EntryRow key={t.id} selected={sel?.id === t.id} onClick={() => setSel(t)} name={t.assigned_to || t.department} title={`M-${t.number} · ${t.title}`} meta={`${t.room ?? t.location ?? "House"} · ${t.department ?? ""} · ${t.photo_count} photo${t.photo_count === 1 ? "" : "s"}`} badge={t.status.replace(/_/g, " ").toLowerCase()} tone={t.priority === "SAFETY" || t.priority === "URGENT" ? "bad" : undefined} />
          ))}
          {items.length === 0 && <EmptyState title="No tickets in this list" detail="Open repairs show here. Use Add entry to report a fault." />}
        </div>
        {sel && (
          <article className="detail">
            <header><h2>M-{sel.number}</h2><span className="chip PROVISIONAL">{sel.status.replace(/_/g, " ")}</span></header>
            <p>{sel.description}</p>
            <div className="facts">
              <div><span>Priority</span><b>{sel.priority}</b></div>
              <div><span>Place</span><b>{sel.room ?? sel.location ?? "—"}</b></div>
              <div><span>Assigned</span><b>{sel.assigned_to ?? "—"}</b></div>
            </div>
            {can("maintenance.work") && <label>Assign<select value={sel.assigned_to_user_id ?? ""} onChange={async e => { await api(`/v1/maintenance/${sel.id}`, { method: "PATCH", body: JSON.stringify({ assigned_to_user_id: e.target.value || null }) }); load(); }}><option value="">Unassigned</option>{assignees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            {can("maintenance.work") && <div className="actions">{(NEXT[sel.status] ?? []).map(([cmd, label]) => <button key={cmd} className="btn" onClick={async () => { await api(`/v1/maintenance/${sel.id}/commands/${cmd}`, { method: "POST", body: "{}" }); setSel(null); load(); }}>{label}</button>)}</div>}
            {photos.map(p => <p key={p.id}><a href={`${API}/v1/maintenance/photos/${p.id}`} onClick={e => { e.preventDefault(); fetch(`${API}/v1/maintenance/photos/${p.id}`, { headers: { authorization: `Bearer ${token.get()}` } }).then(r => r.blob()).then(b => window.open(URL.createObjectURL(b))); }}>{p.filename}</a></p>)}
            {operate && <label>Photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e => {
              const file = e.target.files?.[0]; if (!file) return;
              const data = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file); });
              await api(`/v1/maintenance/${sel.id}/photos`, { method: "POST", body: JSON.stringify({ data, filename: file.name }) });
              api<{ items: Photo[] }>(`/v1/maintenance/${sel.id}/photos`).then(r => setPhotos(r.items));
              load();
            }} /></label>}
          </article>
        )}
      </div>
      {reporting && <ReportFault onClose={() => setReporting(false)} onDone={() => { setReporting(false); load(); }} />}
    </>
  );
}
