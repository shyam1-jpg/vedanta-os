"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Avatar, kitStamp, useKitBus } from "@/components/OpsChrome";
import { useStore } from "@/lib/store";

type Activity = { id: string; kind: string; title: string; body: string; actor_name: string | null; created_at: string };
type Moment = { id: string; body: string; author_name: string | null; created_at: string };
type Note = { id: string; title: string; body: string; read: boolean; created_at?: string };
type Birthday = { name: string; on: string; days: number };

const TUTORIALS: { href: string; title: string; fresh?: boolean }[] = [
  { href: "/handbook/", title: "Kitchen risk assessments and training", fresh: true },
  { href: "/news/", title: "Read the house news" },
  { href: "/tasks/", title: "How tasks move through the house" },
  { href: "/handovers/", title: "Leave a shift handover" },
  { href: "/housekeeping/", title: "Housekeeping daily plan" },
  { href: "/repairs/", title: "Report a repair" },
];

function picture(text: string) {
  const match = text.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)/i);
  return match?.[0] ?? null;
}

export default function HomeFeed() {
  const { user } = useStore();
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
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api<{ activity: Activity[]; moments: Moment[]; notifications: Note[]; birthdays: Birthday[]; can_publish: boolean }>("/v1/feed").then(r => {
      setActivity(r.activity); setMoments(r.moments); setNotes(r.notifications); setBirthdays(r.birthdays); setCanPublish(r.can_publish);
    }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the feed"));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (window.location.hash === "#notifications") setTab("notifications"); }, []);
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
    <div className="kit-home">
      <aside className="kit-col">
        <article className="kit-card kit-profile">
          <Avatar name={user?.name} />
          <div>
            <strong>{user?.name ?? "House"}</strong>
            <p>Welcome online, let&apos;s make great things happen today.</p>
          </div>
        </article>
        {birthdays.map(b => (
          <article className="kit-card" key={b.name + b.on}>
            <strong>{b.name}</strong>
            <p className="m">{b.days === 0 ? "Birthday today" : `Birthday ${b.on}`}</p>
          </article>
        ))}
      </aside>
      <section className="kit-col">
        <div className="kit-seg" role="tablist">
          {(["activity", "notifications", "moments"] as const).map(id => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {id === "activity" ? "Activities" : id === "notifications" ? "Notifications" : "Moments"}
            </button>
          ))}
        </div>
        {err && <div className="note">{err}</div>}
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
        {tab === "activity" && activity.length === 0 && <article className="kit-card"><strong>The feed is quiet</strong><p className="m">Published news, handbook changes and moments show up here.</p></article>}
        {tab === "notifications" && notes.length === 0 && <article className="kit-card"><strong>No notifications</strong><p className="m">When the house sends one, it lands here.</p></article>}
        {tab === "moments" && moments.length === 0 && !adding && <article className="kit-card"><strong>No moments yet</strong><p className="m">The owner or a general manager can post one.</p></article>}
      </section>
      <aside className="kit-col">
        <article className="kit-card kit-tutorials">
          <header><h2>Tutorials</h2><Link href="/handbook/">See all</Link></header>
          {TUTORIALS.map(item => (
            <Link key={item.href + item.title} href={item.href} className="kit-tutorial">
              <span className="material-icons">school</span>
              <span>{item.title}{item.fresh && <em>NEW</em>}</span>
            </Link>
          ))}
        </article>
      </aside>
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
        <button type="button" className={liked ? "on" : ""} onClick={onLike}><span className="material-icons">thumb_up</span>{liked ? "Liked" : "Like"}</button>
        <button type="button" onClick={onComment} disabled={!canComment} title={canComment ? "Comment" : "Only the owner or a general manager can comment"}><span className="material-icons">chat_bubble_outline</span>Comment</button>
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
