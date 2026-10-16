"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Avatar, kitStamp, useKitBus } from "@/components/OpsChrome";

type Item = { id: string; title: string; body: string; audience: string[]; author_name: string | null; created_at: string; read: boolean };
const DEPTS = ["HOUSE", "FRONT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

export default function NewsBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"az" | "za">("az");
  const [filtersOn, setFiltersOn] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [reminder, setReminder] = useState("");
  const [remindOn, setRemindOn] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "" });

  const load = () => api<{ items: Item[]; can_publish: boolean }>("/v1/news").then(r => { setItems(r.items); setCanPublish(r.can_publish); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open news"));
  useEffect(() => { load(); }, []);
  useKitBus({ onAdd: () => { if (!canPublish) return false; setAdding(true); }, onSearch: setQ });
  useEffect(() => {
    if (!sel) return;
    setBookmarked(localStorage.getItem("vedanta.bookmark." + sel) === "1");
    setReminder(localStorage.getItem("vedanta.reminder." + sel) ?? "");
  }, [sel]);

  const shown = items
    .filter(n => (!onlyUnread || !n.read) && `${n.title} ${n.body} ${n.author_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title) * (order === "az" ? 1 : -1));
  const open = items.find(n => n.id === sel) ?? null;

  return (
    <div className="kit-page">
      <div className="kit-pagehead">
        <h1>News</h1>
        <div className="kit-pagehead-actions">
          {canPublish && <button type="button" className="kit-add" onClick={() => setAdding(v => !v)}>{adding ? "Close" : "Add news"}</button>}
          <button type="button" className="kit-outline" onClick={() => setOrder(o => o === "az" ? "za" : "az")}><span className="material-icons">sort_by_alpha</span>Order: alphabetically {order === "az" ? "A-Z" : "Z-A"}</button>
          <button type="button" className="kit-outline" onClick={() => setFiltersOn(v => !v)}><span className="material-icons">filter_list</span>Filters</button>
        </div>
      </div>
      {!canPublish && <p className="m">Read only. The owner or a general manager posts news.</p>}
      {filtersOn && (
        <div className="kit-filters">
          <button type="button" className={!onlyUnread ? "on" : ""} onClick={() => setOnlyUnread(false)}>All</button>
          <button type="button" className={onlyUnread ? "on" : ""} onClick={() => setOnlyUnread(true)}>Unread</button>
        </div>
      )}
      {err && <div className="note">{err}</div>}
      <div className="kit-crumb">{open ? <button type="button" onClick={() => setSel(null)}>The Vedanta</button> : "The Vedanta"} » News{open ? ` » ${open.title}` : ""}</div>
      {!open && (
        <div className="kit-sheet">
          {shown.map(n => (
            <button type="button" key={n.id} className="kit-row" onClick={() => setSel(n.id)}>
              <span className="material-icons">description</span>
              <strong>{n.title}</strong>
              <span className="kit-row-side">
                <span className="m">{n.author_name ?? "House"}, {kitStamp(n.created_at)}</span>
                {!n.read && <em>Unread</em>}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="kit-empty">{q || onlyUnread ? "Nothing matches." : "When an admin publishes news, it appears here."}</p>}
        </div>
      )}
      {open && (
        <article className="kit-card kit-entry">
          <h1>{open.title}</h1>
          <div className="kit-by">
            <Avatar name={open.author_name} />
            <div>
              <strong>{open.author_name ?? "House"} → {open.audience.length ? open.audience.join(", ") : "All"}</strong>
              <div className="m">Created: {kitStamp(open.created_at)}</div>
            </div>
          </div>
          <div className="kit-entry-actions">
            <button type="button" className="kit-outline" disabled title="News is a single post">Compare to previous version</button>
            <button type="button" className="kit-icon" aria-label="Bookmark" onClick={() => {
              const next = !bookmarked; setBookmarked(next);
              if (next) localStorage.setItem("vedanta.bookmark." + open.id, "1"); else localStorage.removeItem("vedanta.bookmark." + open.id);
            }}><span className="material-icons">{bookmarked ? "bookmark" : "bookmark_border"}</span></button>
            <button type="button" className="kit-outline" onClick={() => setRemindOn(v => !v)}><span className="material-icons">alarm</span>Reminder</button>
          </div>
          {remindOn && <label className="kit-remind">Remind me<input type="date" value={reminder} onChange={e => { setReminder(e.target.value); localStorage.setItem("vedanta.reminder." + open.id, e.target.value); }} /></label>}
          {reminder && <p className="m">Reminder set for {reminder}.</p>}
          <div className="kit-prose">{open.body}</div>
          {!open.read && <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/news/${open.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark as read</button>}
        </article>
      )}
      {canPublish && adding && (
        <form className="kit-card" onSubmit={async e => {
          e.preventDefault();
          try {
            await api("/v1/news", { method: "POST", body: JSON.stringify({ ...form, audience: form.audience ? [form.audience] : [] }) });
            setForm({ title: "", body: "", audience: "" }); setAdding(false); load();
          } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not publish"); }
        }}>
          <h2>Add news</h2>
          <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>For<select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option value="">Whole house</option>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>
          <label>Message<textarea required rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
          <button className="kit-add" type="submit">Publish</button>
        </form>
      )}
    </div>
  );
}
