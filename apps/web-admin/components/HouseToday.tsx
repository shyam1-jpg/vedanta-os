"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import OpsBoard from "@/components/OpsBoard";
import { useStore } from "@/lib/store";

type Estate = {
  today: string;
  property: { name: string; legal_entity: string; check_in_from: string; check_out_by: string; guest_rooms: number; dining: { name: string; seats: number; max_covers: number } | null };
  pulse: {
    in_house: number; arriving: number; departing: number; rooms_tonight: number; guest_rooms: number; dinner: number;
    in_house_guests?: number; rooms_ready?: number; rooms_dirty?: number; rooms_inspected?: number;
    out_of_order?: number; open_tasks?: number; critical_issues?: number; payments_due?: number | null;
  };
  arriving: { id: string; name: string; organisation: string | null; expected_guests: number | null; arrival_slot: string }[];
  departing: { id: string; name: string; organisation: string | null; expected_guests: number | null; departure_slot: string }[];
  in_house: { id: string; name: string; organisation: string | null; expected_guests: number | null }[];
  next: { name: string; organisation: string | null; arrival: string; arrival_slot: string; expected_guests: number | null } | null;
  timeline?: { time: string; label: string }[];
};

export default function HouseToday() {
  const { user, ready, can } = useStore();
  const [e, setE] = useState<Estate | null>(null);
  const [book, setBook] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [payments, setPayments] = useState<{ total_due: number; total_due_fmt: string; overdue: number } | null>(null);
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api<Estate>("/v1/estate").then(setE).catch(() => setErr("The house ledger could not be opened. Check the API is running."));
    api<{ items: unknown[] }>("/v1/guest-enquiries").then(r => setBook(r.items.length)).catch(() => {});
    api<{ total_due: number; total_due_fmt: string; overdue: number }>("/v1/estate/payments-due").then(setPayments).catch(() => {});
    // Load AI morning briefing silently — only if configured
    api<{ briefing: string }>("/v1/duty-manager/morning-briefing").then(r => setAiBriefing(r.briefing)).catch(() => {});
  };

  // Wait until the store has resolved the user session before calling the API.
  // Without this, HouseToday fires immediately on mount — before the auth token
  // is in place — which causes a 401 and a blank screen.
  useEffect(() => {
    if (ready && user) load();
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || (!e && !err)) return <div className="empty">Opening the house…</div>;
  if (err) return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div className="note">{err}</div>
      <button className="btn" style={{ marginTop: 12 }} onClick={load}>Try again</button>
    </div>
  );
  if (!e) return <div className="empty">Opening the house…</div>;
  const d = fmt(e.today, { weekday: "long", day: "numeric", month: "long" });
  const p = e.pulse;
  const nowHm = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
  const tasks = p.open_tasks ?? 0;
  const first = (user?.name ?? "").split(" ")[0];
  const hour = Number(nowHm.slice(0, 2));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const headline = p.arriving && p.departing
    ? `${plural(p.departing, "group leaves", "groups leave")}, ${plural(p.arriving, "arrives", "arrive")}.`
    : p.arriving ? `${plural(p.arriving, "group arrives", "groups arrive")} today.`
    : p.departing ? `${plural(p.departing, "group leaves", "groups leave")} today.`
    : "A quiet day at the house.";
  // House rule from the kitchen: per 35 guests, 1 chef + 1 assistant + 1 porter; restaurant 1–2.
  const teams = p.dinner > 0 ? Math.ceil(p.dinner / 35) : 0;
  const quick = [
    { href: "/front/", title: "Check in a guest", sub: "Find the booking, give out the key" },
    { href: "/groups/", title: "New booking", sub: "For a group or one person" },
    { href: "/maintenance/", title: "Report a problem", sub: "In a room, the kitchen or garden" },
    { href: "/rooms/", title: "Today\u2019s rooms", sub: "See who is in each room" },
    { href: "/training/", title: "Staff training", sub: "Each department, from the house book" },
  ];
  const attention = [
    { title: plural(tasks, "open job", "open jobs"), body: "Give each job an owner and see it through.", href: "/tasks/", action: "Review jobs" },
    { title: `${p.rooms_dirty ?? "—"} rooms to clean`, body: "Arrival rooms first, then check before marking ready.", href: "/housekeeping/", action: "Open housekeeping" },
    { title: "House log & handover", body: "Guest requests, decisions and unfinished work for the next shift.", href: "/ops/", action: "Open house log" },
    { title: "Procedures & cover", body: "Steps for each department, and what to do if someone is off.", href: "/manual/", action: "Open manual" },
  ];
  const stats: { k: string; v: string; pct?: number; danger?: boolean }[] = [
    { k: "Rooms in use tonight", v: `${p.rooms_tonight} / ${p.guest_rooms}`, pct: p.guest_rooms ? p.rooms_tonight / p.guest_rooms : 0 },
    { k: "Guests in the house", v: p.in_house_guests == null ? "—" : String(p.in_house_guests) },
    { k: "Rooms ready", v: p.rooms_ready == null ? "—" : String(p.rooms_ready) },
    { k: "Checked today", v: p.rooms_inspected == null ? "—" : String(p.rooms_inspected) },
    { k: "Out of use", v: String(p.out_of_order ?? 0) },
    { k: "Payments due", v: payments?.total_due_fmt ?? "—", danger: !!payments?.overdue },
  ];
  return (
    <div className="ht">
      <section className="ht-hero">
        <div className="ht-hero-copy">
          <span className="ht-date">{d}</span>
          <h1>{hello}{first ? `, ${first}` : ""}.<br /><em>{headline}</em></h1>
          <p>Check-in from {e.property.check_in_from}, departure by {e.property.check_out_by}.{e.next ? ` Next arrival: ${e.next.name}, ${fmt(e.next.arrival, { weekday: "short", day: "numeric", month: "short" })}.` : ""}</p>
        </div>
        <div className="ht-hero-nums">
          <div><b>{p.arriving}</b><span>arriving</span></div>
          <div><b>{p.departing}</b><span>leaving</span></div>
          <div><b>{p.dinner}</b><span>for dinner</span></div>
        </div>
      </section>

      {(p.critical_issues ?? 0) > 0 && (
        <Link href="/maintenance/" className="ht-alert">{plural(p.critical_issues ?? 0, "critical issue needs", "critical issues need")} a manager now →</Link>
      )}

      <nav className="ht-quick" aria-label="Quick actions">
        {quick.map(q => <Link key={q.href} href={q.href}><b>{q.title}</b><span>{q.sub}</span></Link>)}
        {book > 0 && <Link href="/groups/" className="hot"><b>{plural(book, "new enquiry", "new enquiries")}</b><span>From the guest website</span></Link>}
      </nav>

      {aiBriefing && (
        <section className="ht-ai">
          <div className="ht-ai-head"><h2>Ask Parslia · morning briefing</h2><Link href="/duty-manager/">Full briefing &amp; questions →</Link></div>
          <p>{aiBriefing.slice(0, 600)}{aiBriefing.length > 600 ? "…" : ""}</p>
        </section>
      )}

      <div className="ht-grid">
        <section className="ht-card">
          <h2>Up next</h2>
          <ol className="ht-beats">
            {(e.timeline ?? []).map(b => (
              <li key={b.time + b.label} className={b.time <= nowHm ? "done" : ""}><span className="t">{b.time}</span><span>{b.label}</span></li>
            ))}
          </ol>
        </section>
        <section className="ht-card">
          <h2>Coming in</h2>
          {e.arriving.length === 0 ? <p className="ht-muted">No arrivals today.</p> : (
            <ul className="ht-list">{e.arriving.map(g => (
              <li key={g.id}><span><b>{g.name}</b><small>{g.organisation || "Private"} · {g.expected_guests ?? "—"} guests</small></span><em>{g.arrival_slot}</em></li>
            ))}</ul>
          )}
          <h2 style={{ marginTop: 18 }}>Leaving</h2>
          {e.departing.length === 0 ? <p className="ht-muted">No departures today.</p> : (
            <ul className="ht-list">{e.departing.map(g => (
              <li key={g.id}><span><b>{g.name}</b><small>{g.organisation || "Private"} · {g.expected_guests ?? "—"} guests</small></span><em className="out">{g.departure_slot}</em></li>
            ))}</ul>
          )}
        </section>
        <section className="ht-card">
          <h2>Who we need tonight</h2>
          <p className="ht-muted">Worked out from {p.dinner} dinner guests: 3 kitchen staff per 35 guests.</p>
          <div className="ht-staff">
            <div><b>{teams * 3}</b><span>Kitchen · {teams} chef, {teams} assistant, {teams} porter</span></div>
            <div className="warm"><b>{teams}–{teams * 2}</b><span>Restaurant staff</span></div>
          </div>
          <Link href="/labour/" className="ht-link">Open labour forecast →</Link>
        </section>
      </div>

      <h2 className="ht-h2">Needs attention</h2>
      <div className="ht-attn">
        {attention.map(a => (
          <div key={a.href} className="ht-card">
            <b>{a.title}</b><p className="ht-muted">{a.body}</p>
            {can("group.read") && <Link className="ht-link" href={a.href}>{a.action} →</Link>}
          </div>
        ))}
      </div>

      <h2 className="ht-h2">House details</h2>
      <div className="ht-stats">
        {stats.map(s => (
          <div key={s.k} className="ht-stat"><span>{s.k}</span><b className={s.danger ? "danger" : ""}>{s.v}</b>{s.pct != null && <i><s style={{ width: `${Math.round(s.pct * 100)}%` }} /></i>}</div>
        ))}
      </div>
      <OpsBoard compact />
    </div>
  );
}
