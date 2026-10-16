"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Comment = { id: string; body: string; author_name: string | null; created_at: string };
type Idea = { id: string; title: string; body: string; category: string; status: string; author_name: string | null; comments: Comment[] };
const STATUSES = ["new", "considering", "planned", "done", "declined"];

export default function IdeasBoard() {
  const [items, setItems] = useState<Idea[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", category: "Events" });
  const [comment, setComment] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const load = () => api<{ items: Idea[]; can_publish: boolean }>(`/v1/ideas${filter ? `?status=${filter}` : ""}`).then(r => { setItems(r.items); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open ideas"));
  useEffect(() => { load(); }, [filter]);
  const shown = items.filter(idea => `${idea.title} ${idea.body} ${idea.category}`.toLowerCase().includes(q.toLowerCase()));
  const open = shown.find(i => i.id === sel) ?? null;
  return (
    <>
      <div className="topbar"><div><h1>Ideas</h1><p>The house board for what we might do next. Staff can read. Only an admin adds an idea, a comment or a status.</p></div></div>
      {!canPublish && <p className="suite-banner">Read only. Idea submissions are not open to the team.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={q} onQuery={setQ} placeholder="Search ideas"
        onAdd={canPublish ? () => setAdding(v => !v) : undefined}
        addLabel={adding ? "Close" : "Add entry"}
        filters={<div className="seg">{["", ...STATUSES].map(s => <button key={s || "all"} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>{s || "All"}</button>)}</div>}
      />
      <div className="split">
        <div className="list">
          {shown.map(idea => (
            <EntryRow key={idea.id} selected={sel === idea.id} onClick={() => setSel(idea.id)} name={idea.author_name} title={idea.title} meta={`${idea.category} · ${idea.comments.length} comments`} badge={idea.status} />
          ))}
          {shown.length === 0 && <EmptyState title="No ideas in this view" detail="Change the status filter, or an admin can add the next idea." />}
        </div>
        <div>
          {open && (
            <article className="detail">
              <header><h2>{open.title}</h2><span className="chip CONFIRMED">{open.status}</span></header>
              <p>{open.body}</p>
              <p className="m">{open.category} · {open.author_name ?? "House"}</p>
              {open.comments.map(c => <p key={c.id}><b>{c.author_name ?? "Admin"}.</b> {c.body}</p>)}
              {canPublish && (
                <>
                  <label>Status<select value={open.status} onChange={async e => { await api(`/v1/ideas/${open.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }); load(); }}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                  <form onSubmit={async e => { e.preventDefault(); await api(`/v1/ideas/${open.id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) }); setComment(""); load(); }}>
                    <label>Comment<textarea required value={comment} onChange={e => setComment(e.target.value)} rows={2} /></label>
                    <button className="btn">Add comment</button>
                  </form>
                </>
              )}
            </article>
          )}
          {canPublish && adding && (
            <form className="detail" style={{ position: "static", marginTop: 16 }} onSubmit={async e => {
              e.preventDefault();
              try { await api("/v1/ideas", { method: "POST", body: JSON.stringify(form) }); setForm({ title: "", body: "", category: "Events" }); load(); }
              catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
            }}>
              <h3>Add entry</h3>
              <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
              <label>Category<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
              <label>Detail<textarea rows={3} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
              <button className="btn primary">Add idea</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
