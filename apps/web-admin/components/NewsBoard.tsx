"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Item = { id: string; title: string; body: string; audience: string[]; author_name: string | null; created_at: string; read: boolean };
const DEPTS = ["HOUSE", "FRONT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

export default function NewsBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", audience: "" });
  const load = () => api<{ items: Item[]; can_publish: boolean }>("/v1/news").then(r => { setItems(r.items); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open news"));
  useEffect(() => { load(); }, []);
  const shown = items.filter(n => (!onlyUnread || !n.read) && `${n.title} ${n.body} ${n.author_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const open = shown.find(n => n.id === sel) ?? shown[0] ?? null;
  return (
    <>
      <div className="topbar"><div><h1>News</h1><p>Announcements to the house or to one group. Staff can mark them read. Only an admin publishes.</p></div></div>
      {!canPublish && <p className="suite-banner">Read only. The owner or an admin posts news.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={q} onQuery={setQ} placeholder="Search announcements"
        onAdd={canPublish ? () => setAdding(v => !v) : undefined}
        addLabel={adding ? "Close" : "Add entry"}
        filters={<div className="seg"><button className={!onlyUnread ? "on" : ""} onClick={() => setOnlyUnread(false)}>All</button><button className={onlyUnread ? "on" : ""} onClick={() => setOnlyUnread(true)}>Unread</button></div>}
      />
      <div className="split">
        <div className="list">
          {shown.map(n => (
            <EntryRow key={n.id} selected={open?.id === n.id} onClick={() => setSel(n.id)} name={n.author_name} title={n.title} meta={`${n.author_name ?? "House"} · ${n.audience.length ? n.audience.join(", ") : "Whole house"}`} badge={n.read ? "Read" : "Unread"} />
          ))}
          {shown.length === 0 && <EmptyState title="No announcements" detail={q || onlyUnread ? "Nothing matches this search." : "When an admin publishes news, it appears here."} />}
        </div>
        <div>
          {open && (
            <article className="detail">
              <header><h2>{open.title}</h2><span className={"badge b-" + (open.read ? "good" : "warn")}>{open.read ? "Read" : "Unread"}</span></header>
              <p style={{ whiteSpace: "pre-wrap" }}>{open.body}</p>
              <p className="m">{open.author_name ?? "House"} · {open.audience.length ? open.audience.join(", ") : "Whole house"}</p>
              {!open.read && <button className="btn" onClick={async () => { await api(`/v1/news/${open.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark as read</button>}
            </article>
          )}
          {canPublish && adding && (
            <form className="detail" style={{ marginTop: 12 }} onSubmit={async e => {
              e.preventDefault();
              try {
                await api("/v1/news", { method: "POST", body: JSON.stringify({ ...form, audience: form.audience ? [form.audience] : [] }) });
                setForm({ title: "", body: "", audience: "" }); setAdding(false); load();
              } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not publish"); }
            }}>
              <h2>Add entry</h2>
              <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
              <label>For<select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option value="">Whole house</option>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>
              <label>Message<textarea required rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
              <button className="btn primary">Publish</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
