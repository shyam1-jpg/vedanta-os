"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";

type Pulse = { arriving: number; departing: number; dinner: number; in_house_guests?: number; rooms_dirty?: number };
type Enquiry = { id: string; name: string; people: number | null; arrival: string | null; departure: string | null; programme_name: string | null; dietary_notes: string | null; created_at: string };
type Notice = { id: string; department: string | null; department_label: string; title: string; body: string; author_name: string; created_at: string };
type Task = { id: string; title: string; location_label: string | null; room_label: string | null; status: string; status_label: string; priority: string; created_by_name: string | null; assigned_name: string | null; created_at: string };

const CHANNELS = [
  { code: "", label: "Everyone" }, { code: "FRONT", label: "Front of house" }, { code: "HK", label: "Housekeeping" },
  { code: "KITCHEN", label: "Kitchen" }, { code: "RESTAURANT", label: "Restaurant" }, { code: "MAINT", label: "Maintenance" },
  { code: "GROUNDS", label: "Grounds" }, { code: "MGMT", label: "Management" },
];
const KINDS = [
  { id: "Water / plumbing", icon: "M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" },
  { id: "Electrics", icon: "M13 2L4 14h7l-1 8 9-12h-7z" },
  { id: "Heating", icon: "M12 3v10M8 9a4 4 0 1 0 8 0M9 21h6M10 17h4" },
  { id: "Furniture", icon: "M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 11h18v6H3zM5 17v3M19 17v3" },
  { id: "Kitchen equipment", icon: "M6 13a6 6 0 1 1 12 0v2H6zM4 19h16" },
  { id: "Something else", icon: "M12 8v4M12 16v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
];
const URGENCY = [
  { id: "urgent", label: "Right now", severity: "critical" },
  { id: "high", label: "Today", severity: "major" },
  { id: "normal", label: "This week", severity: "minor" },
];

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export default function StaffHub() {
  const { user, ready } = useStore();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [today, setToday] = useState<string>("");
  const [enq, setEnq] = useState<Enquiry[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [mine, setMine] = useState<Task[]>([]);
  const [ch, setCh] = useState("");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState(KINDS[0].id);
  const [where, setWhere] = useState("");
  const [detail, setDetail] = useState("");
  const [urg, setUrg] = useState("high");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadBoard = () => api<{ notices: Notice[] }>("/v1/ops/board").then(b => setNotices(b.notices ?? [])).catch(() => {});
  const loadMine = () => api<{ items: Task[] }>("/v1/ops/tasks?department=MAINT&limit=40").then(r => setMine((r.items ?? []).filter(t => t.created_by_name === user?.name).slice(0, 6))).catch(() => {});
  useEffect(() => {
    if (!ready || !user) return;
    api<{ today: string; pulse: Pulse }>("/v1/estate").then(e => { setPulse(e.pulse); setToday(e.today); }).catch(() => {});
    api<{ items: Enquiry[] }>("/v1/guest-enquiries").then(r => setEnq(r.items ?? [])).catch(() => {});
    loadBoard(); loadMine();
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const thread = notices.filter(n => (ch ? n.department === ch : true)).slice(0, 30).reverse();
  const send = async (text: string) => {
    const body = text.trim(); if (!body) return;
    try {
      await api("/v1/ops/notices", { method: "POST", body: JSON.stringify({ title: body.slice(0, 80), body, department: ch || undefined }) });
      setDraft(""); loadBoard();
    } catch { setMsg("That message could not be sent. Try again."); }
  };
  const report = async () => {
    if (!where.trim()) { setMsg("Say where the problem is."); return; }
    const u = URGENCY.find(x => x.id === urg)!;
    setBusy(true); setMsg(null);
    try {
      await api("/v1/ops/tasks", { method: "POST", body: JSON.stringify({
        title: `${kind} — ${where.trim()}`.slice(0, 200), notes: detail.trim() || undefined, department: "MAINT",
        location_label: where.trim(), priority: u.id, severity: u.severity,
      }) });
      setWhere(""); setDetail(""); setMsg("Sent to the General Manager and maintenance."); loadMine();
    } catch { setMsg("That report could not be sent. Try again."); }
    setBusy(false);
  };
  const first = (user?.name ?? "").split(" ")[0];
  const nums = pulse ? [
    { k: "Guests in the house", v: pulse.in_house_guests ?? "—", d: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5", dark: true },
    { k: "Groups arriving", v: pulse.arriving, d: "M5 12h14M13 6l6 6-6 6" },
    { k: "Groups leaving", v: pulse.departing, d: "M19 12H5M11 6l-6 6 6 6" },
    { k: "Rooms to clean", v: pulse.rooms_dirty ?? "—", d: "M4 20h16M6 20V10l6-6 6 6v10" },
    { k: "Dinner guests", v: pulse.dinner, d: "M6 13a6 6 0 1 1 12 0v2H6zM4 19h16" },
  ] : [];

  return (
    <div className="ht">
      <header className="sh-head">
        <div>
          <span className="sh-layer">● Staff side</span>
          <h1 className="sh-title">{first ? `Hello, ${first}` : "Staff hub"}</h1>
          <span className="ht-muted">{today ? fmt(today, { weekday: "long", day: "numeric", month: "long" }) : ""}</span>
        </div>
        <div className="sh-actions">
          <Link href="/rooms/" className="sh-btn">Rooms</Link>
          <Link href="/kitchen/" className="sh-btn">Kitchen</Link>
          <a href="#report" className="sh-btn hot">Report a problem</a>
        </div>
      </header>

      <div className="sh-nums">
        {nums.map(n => (
          <div key={n.k} className={n.dark ? "dark" : ""}><span className="ic"><Icon d={n.d} size={20} /></span><b>{n.v}</b><small>{n.k}</small></div>
        ))}
      </div>

      <div className="ht-grid">
        <section className="ht-card">
          <h2>Just booked <span className="sh-pill">{enq.length} new</span></h2>
          {enq.length === 0 ? <p className="ht-muted">No new bookings waiting.</p> : (
            <ul className="sh-feed">{enq.slice(0, 6).map(x => (
              <li key={x.id}>
                <span className="ic"><Icon d="M4 5h16v16H4zM4 10h16M9 3v4M15 3v4" /></span>
                <span className="txt"><b>{x.name}{x.people ? ` · ${x.people} ${x.people === 1 ? "guest" : "guests"}` : ""}</b>
                  <small>{x.arrival ? fmt(x.arrival, { day: "numeric", month: "short" }) : "Dates to confirm"}{x.departure ? ` – ${fmt(x.departure, { day: "numeric", month: "short" })}` : ""}{x.programme_name ? ` · ${x.programme_name}` : ""}</small>
                  {x.dietary_notes && <em>Diet: {x.dietary_notes}</em>}
                </span>
                <Link href="/groups/" className="sh-mini">Open</Link>
              </li>
            ))}</ul>
          )}
        </section>

        <section className="ht-card sh-chat">
          <h2>Team messages</h2>
          <div className="sh-chans" role="tablist" aria-label="Channel">
            {CHANNELS.map(c => <button key={c.code} type="button" role="tab" aria-selected={ch === c.code} className={ch === c.code ? "on" : ""} onClick={() => setCh(c.code)}>{c.label}</button>)}
          </div>
          <div className="sh-thread" aria-live="polite">
            {thread.length === 0 ? <p className="ht-muted">No messages here yet. Say hello.</p> : thread.map(n => {
              const me = n.author_name === user?.name;
              return (
                <div key={n.id} className={me ? "me" : ""}>
                  <small>{me ? "You" : n.author_name} · {new Date(n.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}{!ch && n.department ? ` · ${n.department_label}` : ""}</small>
                  <p>{n.body}</p>
                </div>
              );
            })}
          </div>
          <div className="sh-quick">{["On my way", "Room ready ✓", "Need a hand"].map(q => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>
          <form className="sh-send" onSubmit={ev => { ev.preventDefault(); send(draft); }}>
            <label className="sr">Write a message</label>
            <input value={draft} onChange={ev => setDraft(ev.target.value)} placeholder="Write a message…" aria-label="Write a message" />
            <button type="submit" aria-label="Send"><Icon d="M5 12h14M13 6l6 6-6 6" size={18} /></button>
          </form>
        </section>
      </div>

      <section id="report" className="ht-card sh-report">
        <h2>Report a problem</h2>
        <p className="ht-muted">Goes straight to the General Manager and maintenance.</p>
        <div className="sh-kinds">
          {KINDS.map(k => <button key={k.id} type="button" aria-pressed={kind === k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}><Icon d={k.icon} size={26} /><span>{k.id}</span></button>)}
        </div>
        <div className="sh-form">
          <label>Where?<input value={where} onChange={ev => setWhere(ev.target.value)} placeholder="e.g. Room 112 shower" /></label>
          <label>What's happening? (optional)<input value={detail} onChange={ev => setDetail(ev.target.value)} placeholder="e.g. water won't heat up" /></label>
          <div><span className="lbl">How urgent?</span><div className="sh-urg">{URGENCY.map(u => <button key={u.id} type="button" aria-pressed={urg === u.id} className={urg === u.id ? `on ${u.id}` : ""} onClick={() => setUrg(u.id)}>{u.label}</button>)}</div></div>
        </div>
        <div className="sh-row">
          {msg && <span className="sh-msg">{msg}</span>}
          <button type="button" className="sh-btn hot big" disabled={busy} onClick={report}>{busy ? "Sending…" : "Send report"}</button>
        </div>
        {mine.length > 0 && (<>
          <h3 className="sh-h3">Problems I've reported</h3>
          <ul className="ht-list">{mine.map(t => (
            <li key={t.id}><span><b>{t.title}</b><small>{t.assigned_name ? `With ${t.assigned_name}` : "Waiting for someone to take it"}</small></span><em className={/complet|verif/.test(t.status) ? "out" : ""}>{t.status_label}</em></li>
          ))}</ul>
        </>)}
      </section>
    </div>
  );
}
