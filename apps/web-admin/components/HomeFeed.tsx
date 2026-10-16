"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { PageIcon } from "@/components/icons";
import { Avatar, Badge, DeskBar, EmptyState } from "@/components/OpsChrome";

type Activity = { id: string; kind: string; title: string; body: string; actor_name: string | null; created_at: string };
type Moment = { id: string; body: string; author_name: string | null; created_at: string };
type Note = { id: string; title: string; body: string; read: boolean };
type Birthday = { name: string; on: string; days: number };
type Counts = { tasks: number; news: number; repairs: number; requests: number; complaints: number; ideas: number; handovers: number; handbook: number; people: number; diary: number };

const CARDS: { key: keyof Counts; href: string; label: string; hint: string }[] = [
  { key: "tasks", href: "/tasks/", label: "Open tasks", hint: "Assigned work" },
  { key: "news", href: "/news/", label: "Unread news", hint: "Announcements" },
  { key: "repairs", href: "/repairs/", label: "Open repairs", hint: "Faults" },
  { key: "requests", href: "/requests/", label: "Guest requests", hint: "Still open" },
  { key: "complaints", href: "/complaints/", label: "Complaints", hint: "Not closed" },
  { key: "ideas", href: "/ideas/", label: "Live ideas", hint: "On the board" },
  { key: "handovers", href: "/handovers/", label: "Recent handovers", hint: "Last 36 hours" },
  { key: "handbook", href: "/handbook/", label: "Handbook", hint: "Live articles" },
  { key: "diary", href: "/calendar/", label: "Diary", hint: "Next two weeks" },
  { key: "people", href: "/people/", label: "Employees", hint: "In the directory" },
];

export default function HomeFeed() {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api<{ activity: Activity[]; moments: Moment[]; notifications: Note[]; birthdays: Birthday[]; can_publish: boolean }>("/v1/feed").then(r => {
      setActivity(r.activity); setMoments(r.moments); setNotes(r.notifications); setBirthdays(r.birthdays); setCanPublish(r.can_publish);
    }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the feed"));
    api<{ counts: Counts; can_publish: boolean }>("/v1/ops/desk").then(r => setCounts(r.counts)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="topbar"><div><h1>Home</h1><p>The house desk. Counts are live. Staff can read the feed. Only the owner or an admin posts a moment.</p></div></div>
      {!canPublish && <p className="suite-banner">Read only. Moments are written by the owner or an admin, not by the team.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar onAdd={canPublish ? () => setAdding(v => !v) : undefined} addLabel={adding ? "Close" : "Add entry"} />
      <div className="ops-cards">
        {CARDS.map(card => (
          <Link key={card.href} href={card.href} className="ops-card-link">
            <small><PageIcon href={card.href} size={16} /> {card.hint}</small>
            <strong>{counts ? counts[card.key] : "–"}</strong>
            <span>{card.label}</span>
          </Link>
        ))}
      </div>
      <div className="split">
        <div className="list">
          {birthdays.map(b => <p key={b.name + b.on} className="note">{b.days === 0 ? "Today" : `In ${b.days} days`} · {b.name}&apos;s birthday ({b.on})</p>)}
          {notes.map(n => (
            <article className="entry" key={n.id}>
              <Avatar name="House" />
              <span className="entry-copy"><span className="t">{n.title}</span><span className="m">{n.body}</span></span>
              {n.read ? <Badge tone="good">Read</Badge> : <button className="btn" onClick={async () => { await api(`/v1/feed/notifications/${n.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark read</button>}
            </article>
          ))}
          {activity.map(a => (
            <article className="entry" key={a.id}>
              <Avatar name={a.actor_name} />
              <span className="entry-copy"><span className="t">{a.title}</span><span className="m">{a.body}</span></span>
              <Badge>{a.kind}</Badge>
            </article>
          ))}
          {activity.length === 0 && notes.length === 0 && <EmptyState title="The feed is quiet" detail="Published news, handbook changes and moments show up here." />}
        </div>
        <div>
          {moments.map(m => (
            <article className="detail" key={m.id} style={{ position: "static", marginBottom: 10 }}>
              <header><Avatar name={m.author_name} /><h2 style={{ fontSize: 20 }}>Moment</h2></header>
              <p>{m.body}</p>
              <p className="m">{m.author_name ?? "House"}</p>
            </article>
          ))}
          {canPublish && adding && (
            <form className="detail" onSubmit={async e => {
              e.preventDefault();
              try { await api("/v1/feed/moments", { method: "POST", body: JSON.stringify({ body }) }); setBody(""); setAdding(false); load(); }
              catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not post"); }
            }}>
              <h2>Add entry</h2>
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
