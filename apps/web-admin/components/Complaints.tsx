"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Item = { id: string; title: string; description: string; status: string; severity: string; department: string | null; guest_name: string; room_label: string; resolution: string | null };
const NEXT: Record<string, string[]> = { open: ["acknowledged", "resolving", "closed"], acknowledged: ["resolving", "resolved", "closed"], resolving: ["resolved", "closed"], resolved: ["closed"], closed: [] };

export default function Complaints() {
  const [items, setItems] = useState<Item[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", severity: "minor", guest_name: "", room_label: "", department: "FRONT" });
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const load = () => api<{ items: Item[]; can_write: boolean }>(`/v1/complaints${status ? `?status=${status}` : ""}`).then(r => { setItems(r.items); setCanWrite(r.can_write); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open complaints"));
  useEffect(() => { load(); }, [status]);
  return (
    <>
      <div className="topbar"><div><h1>Complaints</h1><p>A separate tracker from guest requests. Record what happened, then move it through the states.</p></div></div>
      {!canWrite && <p className="suite-banner">You can read complaints. The desk or an admin records and updates them.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={q} onQuery={setQ} placeholder="Search complaints"
        onAdd={canWrite ? () => setAdding(v => !v) : undefined}
        addLabel={adding ? "Close" : "Add entry"}
        filters={<div className="seg">{["", "open", "acknowledged", "resolving", "resolved", "closed"].map(s => <button key={s || "all"} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s || "All"}</button>)}</div>}
      />
      <div className="split">
        <div className="list">
          {items.filter(c => `${c.title} ${c.description} ${c.guest_name} ${c.room_label}`.toLowerCase().includes(q.toLowerCase())).map(c => (
            <div key={c.id}>
              <EntryRow name={c.guest_name || "Guest"} title={c.title || c.description.slice(0, 80)} meta={`${c.guest_name || "Guest"}${c.room_label ? ` · ${c.room_label}` : ""} · ${c.severity}${c.resolution ? ` · ${c.resolution}` : ""}`} badge={c.status} />
              {canWrite && (NEXT[c.status] ?? []).map(next => <button key={next} className="btn" style={{ margin: "0 8px 8px 14px" }} onClick={async () => { await api(`/v1/complaints/${c.id}/status`, { method: "POST", body: JSON.stringify({ status: next }) }); load(); }}>{next}</button>)}
            </div>
          ))}
          {items.length === 0 && <EmptyState title="No complaints in this view" detail="Complaints are separate from guest requests." />}
        </div>
        {canWrite && adding && (
          <form className="detail" onSubmit={async e => {
            e.preventDefault();
            try { await api("/v1/complaints", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, title: "", description: "" }); load(); }
            catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
          }}>
            <h2>Add entry</h2>
            <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Guest<input value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} /></label>
            <label>Room<input value={form.room_label} onChange={e => setForm({ ...form, room_label: e.target.value })} /></label>
            <label>Severity<select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}><option>minor</option><option>moderate</option><option>serious</option><option>critical</option></select></label>
            <label>What happened?<textarea required rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
            <button className="btn primary">Save complaint</button>
          </form>
        )}
      </div>
    </>
  );
}
