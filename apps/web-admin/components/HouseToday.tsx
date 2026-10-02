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
  const attention = [
    { title: "House log & handover", body: "Record guest requests, decisions and unfinished work for the next shift.", href: "/ops/", action: "Open house log" },
    { title: `${tasks} open ${tasks === 1 ? "task" : "tasks"}`, body: "Give each job an owner and follow it through to completion.", href: "/tasks/", action: "Review tasks" },
    { title: `${p.rooms_dirty ?? "—"} rooms need a turn`, body: "Prioritise arrival rooms, then inspect before marking them ready.", href: "/housekeeping/", action: "Open housekeeping" },
    { title: "Procedures & cover", body: "See the steps for a department or decide what to protect if someone is absent.", href: "/manual/", action: "Open manual" },
  ];
  const metrics: { label: string; value: string; sub: string; danger?: boolean }[] = [
    { label: "Occupancy", value: `${p.rooms_tonight} / ${p.guest_rooms}`, sub: "rooms tonight" },
    { label: "Arrivals", value: String(p.arriving), sub: "groups due today" },
    { label: "Departures", value: String(p.departing), sub: "leaving today" },
    { label: "In-house guests", value: p.in_house_guests == null ? "—" : String(p.in_house_guests), sub: "from the book" },
    { label: "Rooms ready", value: p.rooms_ready == null ? "—" : String(p.rooms_ready), sub: "clean or inspected" },
    { label: "Rooms dirty", value: p.rooms_dirty == null ? "—" : String(p.rooms_dirty), sub: "need a turn" },
    { label: "Inspected", value: p.rooms_inspected == null ? "—" : String(p.rooms_inspected), sub: "passed today" },
    { label: "Out of order", value: String(p.out_of_order ?? 0), sub: "not sellable" },
    { label: "Payments due", value: payments?.total_due_fmt ?? "—", sub: payments?.overdue ? `£${payments.overdue.toLocaleString()} overdue` : "across open folios" },
    { label: "Open tasks", value: String(tasks), sub: "across the house" },
    { label: "Critical issues", value: String(p.critical_issues ?? 0), sub: "need a manager now", danger: (p.critical_issues ?? 0) > 0 },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <div className="kicker">The house</div>
          <h1 style={{ margin: 0 }}>Today</h1>
          <p className="m" style={{ color: "var(--ink-2)", margin: "8px 0 0" }}>{d}. Check-in from {e.property.check_in_from}, departure by {e.property.check_out_by}. {e.property.dining ? `${e.property.dining.name}, ${e.property.dining.max_covers} covers.` : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {book > 0 && <Link className="btn" href="/groups/">{book} guest portal {book === 1 ? "enquiry" : "enquiries"}</Link>}
          <Link className="btn" href="/front/">Front desk</Link>
          <Link className="btn" href="/night/">Night porter</Link>
          <Link className="btn" href="/manual/">Manual</Link>
          <Link className="btn primary" href="/groups/">Open the book</Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
        {metrics.map(k => (
          <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
            <div className="m" style={{ color: "var(--ink-2)", fontSize: 12, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: k.danger ? "var(--danger)" : undefined }}>{k.value}</div>
            <div className="m" style={{ color: "var(--ink-3)", fontSize: 11, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>What needs attention</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {attention.map(item => (
          <div key={item.href} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontWeight: 700 }}>{item.title}</div>
            <p className="m" style={{ color: "var(--ink-2)", marginTop: 8, fontSize: 13 }}>{item.body}</p>
            {can("group.read") && <div style={{ marginTop: 12 }}><Link className="btn" href={item.href}>{item.action}</Link></div>}
          </div>
        ))}
      </div>

      {aiBriefing && (
        <section className="house-panel" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div className="k">Morning briefing</div>
            <Link href="/duty-manager/">Full briefing</Link>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.65, margin: 0 }}>{aiBriefing.slice(0, 600)}{aiBriefing.length > 600 ? "…" : ""}</pre>
        </section>
      )}

      <div className="house-grid">
        <section className="house-panel">
          <div className="k">Today&apos;s timeline</div>
          <h2>The live pulse</h2>
          <ol className="day-beats">
            {(e.timeline ?? []).map(b => (
              <li key={b.time} className={b.time <= nowHm ? "done" : ""}>
                <span className="t">{b.time}</span>
                <span>{b.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="house-panel">
          <div className="k">Arrivals</div>
          <h2>Coming in</h2>
          {e.arriving.length === 0 ? <p className="m" style={{ color: "var(--ink-2)" }}>No arrivals today. A quiet morning.</p> : (
            <ul className="house-list">{e.arriving.map(g => (
              <li key={g.id}><span><div className="t">{g.name}</div><div className="m">{g.organisation || "Private"} · {g.expected_guests ?? "—"} guests</div></span><span className="chip CONFIRMED">{g.arrival_slot}</span></li>
            ))}</ul>
          )}
        </section>
        <section className="house-panel">
          <div className="k">Departures</div>
          <h2>Leaving</h2>
          {e.departing.length === 0 ? <p className="m" style={{ color: "var(--ink-2)" }}>No departures today.</p> : (
            <ul className="house-list">{e.departing.map(g => (
              <li key={g.id}><span><div className="t">{g.name}</div><div className="m">{g.organisation || "Private"} · {g.expected_guests ?? "—"} guests</div></span><span className="chip ENQUIRY">{g.departure_slot}</span></li>
            ))}</ul>
          )}
          {e.next && <div className="next-stay">Next: {e.next.name} · {fmt(e.next.arrival, { weekday: "short", day: "numeric", month: "short" })} {e.next.arrival_slot}{e.next.expected_guests ? ` · ${e.next.expected_guests} guests` : ""}</div>}
        </section>
        <OpsBoard compact />
      </div>
    </div>
  );
}
