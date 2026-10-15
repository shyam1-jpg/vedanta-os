"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Article = { id: string; title: string; signed: boolean; version: number; chapter_id: string };
type Chapter = { id: string; title: string };
type News = { id: string; title: string; body: string; read: boolean };
type Idea = { id: string; title: string; body: string; category: string; status: string };
type Retreat = { id: string; name: string; arrival: string; departure: string; status: string };
type Appt = { id: string; title: string; starts_at: string; location: string };
type Feed = { activity: { id: string; kind: string; title: string; body: string }[]; moments: { id: string; body: string; author_name: string | null }[]; birthdays: { name: string; on: string; days: number }[]; notifications: { id: string; title: string; body: string; read: boolean }[]; can_publish: boolean };
type Ticket = { id: string; number: number; title: string; status: string; priority: string; room: string | null; location: string | null };

export default function StaffSuite({ mode }: { mode: "home" | "handbook" | "news" | "ideas" | "calendar" | "repairs" }) {
  const [err, setErr] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [open, setOpen] = useState<{ title: string; body_html: string; signed: boolean; id: string } | null>(null);
  const [news, setNews] = useState<News[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [retreats, setRetreats] = useState<Retreat[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    setErr("");
    const run = async () => {
      if (mode === "home") setFeed(await api("/v1/feed"));
      if (mode === "handbook") { const r = await api<{ chapters: Chapter[]; articles: Article[] }>("/v1/handbook"); setChapters(r.chapters); setArticles(r.articles); }
      if (mode === "news") setNews((await api<{ items: News[] }>("/v1/news")).items);
      if (mode === "ideas") setIdeas((await api<{ items: Idea[] }>("/v1/ideas")).items);
      if (mode === "calendar") { const r = await api<{ retreats: Retreat[]; appointments: Appt[] }>("/v1/calendar"); setRetreats(r.retreats); setAppts(r.appointments); }
      if (mode === "repairs") setTickets((await api<{ items: Ticket[] }>("/v1/maintenance")).items);
    };
    run().catch(e => setErr((e as Error).message));
  }, [mode]);

  return (
    <div>
      {err && <p className="note">{err}</p>}
      <p className="m">The house publishes this. You can read it{mode === "handbook" || mode === "news" ? " and confirm" : ""}.</p>
      {mode === "home" && feed && (
        <div>
          {feed.birthdays.map(b => <div className="card" key={b.name}><h2>{b.name}</h2><p className="m">{b.days === 0 ? "Birthday today" : `Birthday ${b.on}`}</p></div>)}
          {feed.notifications.map(n => <div className="card" key={n.id}><h2>{n.title}</h2><p>{n.body}</p>{!n.read && <button className="btn" onClick={async () => { await api(`/v1/feed/notifications/${n.id}/read`, { method: "POST", body: "{}" }); setFeed(await api("/v1/feed")); }}>Mark read</button>}</div>)}
          {feed.moments.map(m => <div className="card" key={m.id}><p>{m.body}</p><p className="m">{m.author_name}</p></div>)}
          {feed.activity.map(a => <div className="card" key={a.id}><h2>{a.title}</h2><p className="m">{a.kind}</p><p>{a.body}</p></div>)}
        </div>
      )}
      {mode === "handbook" && chapters.map(ch => (
        <div key={ch.id}>
          <h2>{ch.title}</h2>
          {articles.filter(a => a.chapter_id === ch.id).map(a => (
            <div className="card" key={a.id}>
              <h2>{a.title}</h2>
              <p className="m">Version {a.version}{a.signed ? " · signed" : ""}</p>
              <button className="btn" onClick={async () => setOpen(await api(`/v1/handbook/articles/${a.id}`))}>Open</button>
            </div>
          ))}
        </div>
      ))}
      {mode === "handbook" && open && (
        <div className="card">
          <h2>{open.title}</h2>
          <div dangerouslySetInnerHTML={{ __html: open.body_html }} />
          {!open.signed && <button className="btn" onClick={async () => { await api(`/v1/handbook/articles/${open.id}/sign`, { method: "POST", body: "{}" }); setOpen({ ...open, signed: true }); }}>I have read this</button>}
        </div>
      )}
      {mode === "news" && news.map(n => (
        <div className="card" key={n.id}><h2>{n.title}</h2><p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>{!n.read && <button className="btn" onClick={async () => { await api(`/v1/news/${n.id}/read`, { method: "POST", body: "{}" }); setNews((await api<{ items: News[] }>("/v1/news")).items); }}>Mark as read</button>}</div>
      ))}
      {mode === "ideas" && ideas.map(i => <div className="card" key={i.id}><h2>{i.title}</h2><p className="m">{i.category} · {i.status}</p><p>{i.body}</p></div>)}
      {mode === "calendar" && <>
        {retreats.map(r => <div className="card" key={r.id}><h2>{r.name}</h2><p className="m">{r.arrival} to {r.departure} · {r.status}</p></div>)}
        {appts.map(a => <div className="card" key={a.id}><h2>{a.title}</h2><p className="m">{new Date(a.starts_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}{a.location ? ` · ${a.location}` : ""}</p></div>)}
      </>}
      {mode === "repairs" && tickets.map(t => <div className="card" key={t.id}><h2>M-{t.number} · {t.title}</h2><p className="m">{t.priority} · {t.status} · {t.room ?? t.location ?? ""}</p></div>)}
    </div>
  );
}
