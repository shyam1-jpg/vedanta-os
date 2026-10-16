"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Avatar, kitStamp, useKitBus } from "@/components/OpsChrome";
import { useStore } from "@/lib/store";
import { PageIcon } from "@/components/icons";
import "./HomeFeed.css";

type Activity = { id: string; kind: string; title: string; body: string; actor_name: string | null; created_at: string };
type Moment = { id: string; body: string; author_name: string | null; created_at: string };
type Note = { id: string; title: string; body: string; read: boolean; created_at?: string };
type Birthday = { name: string; on: string; days: number };

type Tutorial = { id: string; title: string; category: string; is_new: boolean; video_url: string | null; has_file: boolean };

function picture(text: string) {
  const match = text.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)/i);
  return match?.[0] ?? null;
}

export default function HomeFeed() {
  const { user, can } = useStore();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"activity" | "notifications" | "moments">("activity");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [q, setQ] = useState("");
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    api<{ activity: Activity[]; moments: Moment[]; notifications: Note[]; birthdays: Birthday[]; can_publish: boolean }>("/v1/feed").then(r => {
      setActivity(r.activity); setMoments(r.moments); setNotes(r.notifications); setBirthdays(r.birthdays); setCanPublish(r.can_publish);
    }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the feed")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); api<{ items: Tutorial[] }>("/v1/tutorials").then(r => setTutorials(r.items)).catch(() => {}); }, []);
  useEffect(() => {
    const followHash = () => { if (window.location.hash === "#notifications") setTab("notifications"); };
    followHash(); window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, []);
  useKitBus({
    onAdd: () => { if (!canPublish) return false; setTab("moments"); setAdding(true); },
    onSearch: setQ,
  });

  const needle = q.trim().toLowerCase();
  const hit = (...parts: (string | null | undefined)[]) => parts.join(" ").toLowerCase().includes(needle);

  async function publishMoment(text: string) {
    await api("/v1/feed/moments", { method: "POST", body: JSON.stringify({ body: text }) });
    setBody(""); setReply(""); setReplyFor(null); setAdding(false); setTab("moments"); load();
  }

  return (
    <div className="digital-feed">
      <section className="feed-welcome">
        <div><span className="feed-eyebrow">THE VEDANTA · TEAM SPACE</span><h1>A connected team.<br /><em>A better day at the house.</em></h1><p>Welcome back, {user?.name?.split(" ")[0] ?? "team"}. Your people, updates and next steps, together.</p></div>
        <div className="feed-welcome-actions"><span className="feed-date">{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span><button type="button" className="feed-refresh" onClick={load} disabled={loading}><FeedIcon name="refresh" />{loading ? "Refreshing…" : "Refresh feed"}</button></div>
      </section>
      <nav className="feed-shortcuts" aria-label="Quick access">
        {[
          { href: "/tasks/", label: "Tasks & handovers", detail: "Keep the day moving", tone: "purple", perm: "group.read" },
          { href: "/groups/", label: "Retreats & groups", detail: "Plan every arrival", tone: "blue", perm: "group.read" },
          { href: "/kitchen/", label: "Kitchen & covers", detail: "Prepare with confidence", tone: "orange", perm: "covers.read" },
          { href: "/housekeeping/", label: "Housekeeping", detail: "Care for every space", tone: "teal", perm: "group.read" },
        ].filter(item => can(item.perm)).map(item => <Link className={`feed-shortcut ${item.tone}`} key={item.href} href={item.href}><span className="feed-tile-icon"><PageIcon href={item.href} size={23} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="feed-arrow">↗</span></Link>)}
      </nav>
    <div className="kit-home">
      <aside className="kit-col">
        <article className="kit-card kit-profile">
          <Avatar name={user?.name} />
          <div>
            <strong>{user?.name ?? "House"}</strong>
            <span className="feed-profile-label">Your Vedanta workspace</span><p>Every small detail makes a meaningful stay.</p>
          </div>
        </article>
        <article className="kit-card feed-connect"><span className="feed-eyebrow">BETTER, TOGETHER</span><h2>Leave the next shift a clear picture.</h2><p>Share what matters, celebrate good work and keep everyone in the loop.</p><Link href="/handovers/">Open handovers <span>↗</span></Link></article>
        {birthdays.map(b => (
          <article className="kit-card" key={b.name + b.on}>
            <strong>{b.name}</strong>
            <p className="m">{b.days === 0 ? "Birthday today" : `Birthday ${b.on}`}</p>
          </article>
        ))}
      </aside>
      <section className="kit-col">
        <div className="feed-section-head"><div><span className="feed-eyebrow">YOUR HOUSE, CONNECTED</span><h2>Team feed</h2></div>{canPublish && <button className="kit-add" type="button" onClick={() => { setTab("moments"); setAdding(true); }}><FeedIcon name="add" />Share a moment</button>}</div>
        <div className="kit-seg" role="tablist" aria-label="Feed views">
          {(["activity", "notifications", "moments"] as const).map(id => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              <FeedIcon name={id} />{id === "activity" ? "Activity" : id === "notifications" ? "Notifications" : "Moments"}{id === "notifications" && notes.some(n => !n.read) && <span className="feed-count">{notes.filter(n => !n.read).length}</span>}
            </button>
          ))}
        </div>
        {err && <div className="note" role="alert">{err} <button type="button" className="kit-text" onClick={load}>Try again</button></div>}
        {loading && <p className="feed-loading" role="status">Fetching the latest house updates…</p>}
        {!canPublish && <p className="m">You can read the feed. Only the owner or a general manager posts.</p>}
        {tab === "moments" && canPublish && adding && (
          <form className="kit-card" onSubmit={async e => {
            e.preventDefault();
            try { await publishMoment(body); }
            catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not post"); }
          }}>
            <label>Moment<textarea required rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder="Share a note with the house" /></label>
            <button className="kit-add" type="submit">Publish</button>
          </form>
        )}
        {tab === "activity" && activity.filter(a => hit(a.title, a.body, a.actor_name)).map(a => (
          <Post key={a.id} id={a.id} name={a.actor_name || "House"} when={a.created_at} text={`${a.title}${a.body ? `\n${a.body}` : ""}`} liked={!!likes[a.id]} canComment={canPublish}
            onLike={() => setLikes(s => ({ ...s, [a.id]: !s[a.id] }))}
            replying={replyFor === a.id} reply={reply} onReply={setReply}
            onComment={() => { setReplyFor(replyFor === a.id ? null : a.id); setReply(""); }}
            onSend={async () => { try { await publishMoment(`Re: ${a.title}\n${reply}`); } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not comment"); } }}
          />
        ))}
        {tab === "notifications" && notes.filter(n => hit(n.title, n.body)).map(n => (
          <article className="kit-card kit-post" key={n.id}>
            <header><Avatar name="House" /><div><strong>{n.title}</strong><div className="m">{n.read ? "Read" : "New"}</div></div></header>
            <p>{n.body}</p>
            {!n.read && <button type="button" className="kit-text" onClick={async () => { await api(`/v1/feed/notifications/${n.id}/read`, { method: "POST", body: "{}" }); load(); }}>Mark read</button>}
          </article>
        ))}
        {tab === "moments" && moments.filter(m => hit(m.body, m.author_name)).map(m => (
          <Post key={m.id} id={m.id} name={m.author_name || "House"} when={m.created_at} text={m.body} image={picture(m.body)} liked={!!likes[m.id]} canComment={canPublish}
            onLike={() => setLikes(s => ({ ...s, [m.id]: !s[m.id] }))}
            replying={replyFor === m.id} reply={reply} onReply={setReply}
            onComment={() => { setReplyFor(replyFor === m.id ? null : m.id); setReply(""); }}
            onSend={async () => { try { await publishMoment(reply); } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not comment"); } }}
          />
        ))}
        {!loading && !err && tab === "activity" && activity.length === 0 && <article className="kit-card"><strong>The feed is quiet</strong><p className="m">Published news, handbook changes and moments show up here.</p></article>}
        {!loading && !err && tab === "notifications" && notes.length === 0 && <article className="kit-card"><strong>No notifications</strong><p className="m">When the house sends one, it lands here.</p></article>}
        {!loading && !err && tab === "moments" && moments.length === 0 && !adding && <article className="kit-card"><strong>No moments yet</strong><p className="m">The owner or a general manager can post one.</p></article>}
      </section>
      <aside className="kit-col">
        <article className="kit-card kit-tutorials">
          <header><h2>Tutorials</h2><Link href="/tutorials/">See all</Link></header>
          {tutorials.slice(0, 6).map(item => (
            <Link key={item.id} href={`/tutorials/?id=${item.id}`} className="kit-tutorial">
              <span className="feed-tutorial-icon"><FeedIcon name={item.video_url || item.has_file ? "play" : "book"} /></span>
              <span><strong>{item.title}</strong><small>{item.category || "House"}</small>{item.is_new && <em>NEW</em>}</span>
            </Link>
          ))}
          {tutorials.length === 0 && <p className="m">Tutorials the owner publishes show up here.</p>}
        </article>
      </aside>
    </div>
    </div>
  );
}

function Post({
  name, when, text, image, liked, canComment, replying, reply, onLike, onComment, onReply, onSend,
}: {
  id: string; name: string; when?: string; text: string; image?: string | null; liked: boolean; canComment: boolean;
  replying: boolean; reply: string; onLike: () => void; onComment: () => void; onReply: (v: string) => void; onSend: () => void;
}) {
  return (
    <article className="kit-card kit-post">
      <header>
        <Avatar name={name} />
        <div><strong>{name}</strong><div className="m">{kitStamp(when)}</div></div>
      </header>
      <p>{text}</p>
      {image && <img src={image} alt="" />}
      <div className="kit-react">
        <button type="button" className={liked ? "on" : ""} onClick={onLike}><FeedIcon name="like" />{liked ? "Liked" : "Like"}</button>
        <button type="button" onClick={onComment} disabled={!canComment} title={canComment ? "Comment" : "Only the owner or a general manager can comment"}><FeedIcon name="comment" />Comment</button>
      </div>
      {replying && canComment && (
        <form onSubmit={e => { e.preventDefault(); onSend(); }}>
          <input required value={reply} onChange={e => onReply(e.target.value)} placeholder="Write a comment" aria-label="Comment" />
          <button className="kit-add" type="submit">Post</button>
        </form>
      )}
    </article>
  );
}

function FeedIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    refresh: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17",
    add: "M12 5v14M5 12h14",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    notifications: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4",
    moments: "M4 5h16v14H4zM4 15l5-5 5 5 3-3 3 3M16 8h.01",
    play: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8l6 4-6 4z",
    book: "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zM12 6v14",
    like: "M7 10v11H3V10zM7 10l5-8c2 0 3 2 2 5l-1 3h6c2 0 2 2 1 5l-2 6H7",
    comment: "M4 4h16v13H9l-5 4z",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.activity} /></svg>;
}
