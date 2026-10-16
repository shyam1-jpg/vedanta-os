"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, DeskBar, EmptyState, useKitBus } from "@/components/OpsChrome";

type Appt = { id: string; title: string; body: string; location: string; starts_at: string; ends_at: string | null; audience: string[] };
type Retreat = { id: string; name: string; organisation: string | null; status: string; arrival: string; departure: string; expected_guests: number | null };

function dayKey(iso: string) { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" }); }

export default function HouseCalendar() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [retreats, setRetreats] = useState<Retreat[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", location: "", starts_at: "", ends_at: "", body: "" });
  const load = () => {
    const to = new Date(from + "T12:00:00Z"); to.setUTCDate(to.getUTCDate() + 21);
    api<{ appointments: Appt[]; retreats: Retreat[]; can_publish: boolean }>(`/v1/calendar?from=${from}&to=${to.toISOString().slice(0, 10)}`).then(r => {
      setAppointments(r.appointments); setRetreats(r.retreats); setCanPublish(r.can_publish);
    }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the calendar"));
  };
  useEffect(() => { load(); }, [from]);
  useKitBus({ onAdd: () => { if (!canPublish) return false; setAdding(true); }, onSearch: setQ });
  const days = new Map<string, { appointments: Appt[]; retreats: Retreat[] }>();
  for (const r of retreats) {
    const key = r.arrival;
    const bucket = days.get(key) ?? { appointments: [], retreats: [] };
    bucket.retreats.push(r); days.set(key, bucket);
  }
  for (const a of appointments) {
    const key = dayKey(a.starts_at);
    const bucket = days.get(key) ?? { appointments: [], retreats: [] };
    bucket.appointments.push(a); days.set(key, bucket);
  }
  const keys = [...days.keys()].sort();
  return (
    <>
      <div className="topbar">
        <div><h1>Calendar</h1><p>Appointments beside the group bookings and retreats already in the house.</p></div>
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      </div>
      {!canPublish && <p className="suite-banner">You can see the diary. Only an admin adds or changes an event.</p>}
      {err && <div className="note">{err}</div>}
      <DeskBar query={q} onQuery={setQ} placeholder="Search the diary" onAdd={canPublish ? () => setAdding(v => !v) : undefined} addLabel={adding ? "Close" : "Add entry"} />
      <div className="split">
        <div className="list">
          {keys.length === 0 && <EmptyState title="Nothing in the next three weeks" detail="Retreats already booked still appear here, beside any events an admin adds." />}
          {keys.map(key => {
            const bucket = days.get(key)!;
            const retreatsShown = bucket.retreats.filter(r => `${r.name} ${r.status}`.toLowerCase().includes(q.toLowerCase()));
            const apptsShown = bucket.appointments.filter(a => `${a.title} ${a.location} ${a.body}`.toLowerCase().includes(q.toLowerCase()));
            if (!retreatsShown.length && !apptsShown.length) return null;
            return (
            <section className="cal-day" key={key}>
              <h3>{new Date(key + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>
              {retreatsShown.map(r => <p key={r.id}><Badge tone="info">Retreat</Badge> <b>{r.name}</b> · {r.arrival} to {r.departure} · <Badge>{r.status}</Badge>{r.expected_guests ? ` · ${r.expected_guests} guests` : ""}</p>)}
              {apptsShown.map(a => <p key={a.id}><Badge tone="warn">Event</Badge> {new Date(a.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} · <b>{a.title}</b>{a.location ? ` · ${a.location}` : ""}{a.body ? ` — ${a.body}` : ""}</p>)}
            </section>
            );
          })}
        </div>
        {canPublish && adding && (
          <form className="detail" onSubmit={async e => {
            e.preventDefault();
            try {
              await api("/v1/calendar", { method: "POST", body: JSON.stringify({ ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null }) });
              setForm({ title: "", location: "", starts_at: "", ends_at: "", body: "" }); load();
            } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
          }}>
            <h2>Add entry</h2>
            <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Where<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></label>
            <label>Starts<input required type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></label>
            <label>Ends<input type="datetime-local" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></label>
            <label>Note<textarea rows={3} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
            <button className="btn primary">Add to the diary</button>
          </form>
        )}
      </div>
    </>
  );
}
