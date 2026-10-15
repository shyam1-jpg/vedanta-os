"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Activity = { id: string; kind: string; title: string; body: string; actor_name: string | null; created_at: string };
type Moment = { id: string; body: string; author_name: string | null; created_at: string };
type Note = { id: string; title: string; body: string; read: boolean };
type Birthday = { name: string; on: string; days: number };

export default function HomeFeed() {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ activity: Activity[]; moments: Moment[]; notifications: Note[]; birthdays: Birthday[]; can_publish: boolean }>("/v1/feed").then(r => {
    setActivity(r.activity); setMoments(r.moments); setNotes(r.notifications); setBirthdays(r.birthdays); setCanPublish(r.can_publish);
  }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the feed"));
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="topbar"><div><h1>Home</h1><p>What the house has published: activity, notices, birthdays and moments. Staff read. Only an admin posts.</p></div></div>
      {!canPublish && <p className="suite-banner">Read only. Moments are written by the owner or an admin, not by the team.</p>}
      {err && <div className="note">{err}</div>}
      <div className="split">
        <div>
          <div className="stats">{[{ label: "Notices", value: notes.filter(n => !n.read).length }, { label: "Birthdays", value: birthdays.length }, { label: "Moments", value: moments.length }].map(s => <div key={s.label}><b>{s.value}</b>{s.label}</div>)}</div>
          {birthdays.map(b => <p key={b.name + b.on} className="note">{b.days === 0 ? "Today" : `In ${b.days} days`} · {b.name}&apos;s birthday ({b.on})</p>)}
          {notes.map(n => (
            <article className="detail" key={n.id} style={{ position: "static", marginBottom: 10 }}>
              <h3>{n.title}</h3><p>{n.body}</p>
              {!n.read && <button className="btn" onClick={async () => { await api(`/v1/feed/notifications/${n.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark read</button>}
            </article>
          ))}
          {activity.map(a => (
            <article key={a.id} className="row" style={{ display: "block" }}>
              <b>{a.kind} · {a.title}</b>
              <div>{a.body}</div>
              <p className="m">{a.actor_name} · {new Date(a.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</p>
            </article>
          ))}
        </div>
        <div>
          {moments.map(m => <article className="detail" key={m.id} style={{ position: "static", marginBottom: 10 }}><p>{m.body}</p><p className="m">{m.author_name}</p></article>)}
          {canPublish && (
            <form className="detail" onSubmit={async e => {
              e.preventDefault();
              try { await api("/v1/feed/moments", { method: "POST", body: JSON.stringify({ body }) }); setBody(""); load(); }
              catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not post"); }
            }}>
              <h2>Moment</h2>
              <p className="m">A short note for the house feed. The team cannot post these.</p>
              <textarea required rows={4} value={body} onChange={e => setBody(e.target.value)} />
              <button className="btn primary">Publish moment</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
