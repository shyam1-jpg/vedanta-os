"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Item = { id: string; title: string; body: string; audience: string[]; author_name: string | null; created_at: string; read: boolean };
const DEPTS = ["", "HOUSE", "FRONT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

export default function NewsBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", audience: "" });
  const load = () => api<{ items: Item[]; can_publish: boolean }>("/v1/news").then(r => { setItems(r.items); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open news"));
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="topbar"><div><h1>News</h1><p>Announcements to the house or to one group. Staff can mark them read. Only an admin publishes.</p></div></div>
      {!canPublish && <p className="suite-banner">Read only. The owner or an admin posts news.</p>}
      {err && <div className="note">{err}</div>}
      <div className="split">
        <div className="list">
          {items.map(n => (
            <article key={n.id} className="row" style={{ display: "block" }}>
              <b>{n.title}</b>
              <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
              <p className="m">{n.author_name ?? "House"} · {n.audience.length ? n.audience.join(", ") : "Whole house"} · {n.read ? "Read" : "Unread"}</p>
              {!n.read && <button className="btn" onClick={async () => { await api(`/v1/news/${n.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark as read</button>}
            </article>
          ))}
          {items.length === 0 && <div className="empty">No announcements yet.</div>}
        </div>
        {canPublish && (
          <form className="detail" onSubmit={async e => {
            e.preventDefault();
            try {
              await api("/v1/news", { method: "POST", body: JSON.stringify({ ...form, audience: form.audience ? [form.audience] : [] }) });
              setForm({ title: "", body: "", audience: "" }); load();
            } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not publish"); }
          }}>
            <h2>New announcement</h2>
            <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>For<select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option value="">Whole house</option>{DEPTS.filter(Boolean).map(d => <option key={d}>{d}</option>)}</select></label>
            <label>Message<textarea required rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
            <button className="btn primary">Publish</button>
          </form>
        )}
      </div>
    </>
  );
}
