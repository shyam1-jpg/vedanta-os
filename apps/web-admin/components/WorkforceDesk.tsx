"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

type View = "home" | "schedule" | "timesheets" | "leave" | "people" | "reports" | "messages";
const LINKS: [View, string, string][] = [
  ["home", "/workforce/", "Home"],
  ["schedule", "/workforce/schedule/", "Schedule"],
  ["timesheets", "/workforce/timesheets/", "Timesheets"],
  ["leave", "/workforce/leave/", "Leave"],
  ["people", "/workforce/people/", "People"],
  ["reports", "/workforce/reports/", "Reports"],
  ["messages", "/workforce/messages/", "Messages"],
];
const DEPTS = ["", "KITCHEN", "HK", "FRONT", "RESTAURANT", "MAINT", "GROUNDS", "MGMT", "HOUSE", "NIGHT"];

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function monday(base = new Date()) {
  const x = new Date(base);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return iso(x);
}
function addDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}
function pounds(pence: number) { return `£${(pence / 100).toFixed(2)}`; }
function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }

export default function WorkforceDesk({ view }: { view: View }) {
  return (
    <div className="kit-page">
      <div className="kit-pagehead">
        <h1>Workforce</h1>
        <nav className="kit-filters" aria-label="Workforce">
          {LINKS.map(([id, href, label]) => <Link key={id} href={href} className={view === id ? "on" : ""}>{label}</Link>)}
        </nav>
      </div>
      {view === "home" && <Home />}
      {view === "schedule" && <Schedule />}
      {view === "timesheets" && <Timesheets />}
      {view === "leave" && <Leave />}
      {view === "people" && <People />}
      {view === "reports" && <Reports />}
      {view === "messages" && <Messages />}
    </div>
  );
}

function Home() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/v1/workforce-desk").then(setData).catch(e => setErr(errText(e))); }, []);
  if (!data) return <p className="m">{err || "Opening the house…"}</p>;
  const late = new Map<string, string[]>();
  for (const row of data.late ?? []) late.set(row.department, [...(late.get(row.department) ?? []), `${row.name} (${String(row.start_time).slice(0, 5)})`]);
  return (
    <div className="wf-home">
      <article className="kit-card"><h2>Pending</h2>
        <p>{data.swaps?.length ?? 0} shift requests · {data.leave?.length ?? 0} leave requests · {data.punches?.length ?? 0} punches to check</p>
        {data.pinned?.map((m: any) => <p key={m.id}><Link href="/workforce/messages/">{m.subject}</Link> needs a reply</p>)}
        {(data.swaps ?? []).slice(0, 4).map((s: any) => <p key={s.id} className="m">{s.requester} · {s.kind} · {s.department} {s.date}</p>)}
      </article>
      <article className="kit-card"><h2>News</h2>{(data.news ?? []).map((n: any) => <p key={n.id}><strong>{n.title}</strong><span className="m"> {n.body}</span></p>)}{!data.news?.length && <p className="m">No news yet.</p>}</article>
      <article className="kit-card"><h2>Events</h2>{(data.events ?? []).map((e: any) => <p key={e.id}>{e.title} · {e.location}</p>)}{!data.events?.length && <p className="m">Nothing on the diary this week.</p>}</article>
      <article className="kit-card"><h2>Birthdays this week</h2>{(data.birthdays ?? []).map((b: any) => <p key={b.id}>{b.name}</p>)}{!data.birthdays?.length && <p className="m">None this week.</p>}</article>
      <article className="kit-card"><h2>Late to punch in</h2>{[...late.entries()].map(([department, names]) => <p key={department}><strong>{department}</strong> · {names.join(", ")}</p>)}{late.size === 0 && <p className="m">Everyone expected so far has punched in.</p>}</article>
    </div>
  );
}

function Schedule() {
  const [week, setWeek] = useState(monday());
  const [department, setDepartment] = useState("");
  const [mode, setMode] = useState<"week" | "day">("week");
  const [day, setDay] = useState(iso(new Date()));
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ user_id: "", date: iso(new Date()), start_time: "09:00", end_time: "17:00", notes: "", department: "KITCHEN" });
  const from = mode === "day" ? day : week;
  const to = mode === "day" ? day : addDays(week, 6);
  const load = () => api<any>(`/v1/workforce-desk/schedule?from=${from}&to=${to}${department ? `&department=${department}` : ""}`).then(setData).catch(e => setErr(errText(e)));
  useEffect(() => { load(); }, [from, to, department]);
  const days = mode === "day" ? [day] : Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const people = data?.people ?? [];
  const shifts = data?.shifts ?? [];
  const hoursFor = (id: string | null) => shifts.filter((s: any) => (id ? s.user_id === id : !s.user_id)).reduce((n: number, s: any) => n + s.hours, 0);
  return (
    <>
      {err && <div className="note">{err}</div>}
      <div className="kit-pagehead">
        <div className="kit-seg">
          <button type="button" className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</button>
          <button type="button" className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</button>
        </div>
        <label>Department<select value={department} onChange={e => setDepartment(e.target.value)}><option value="">All</option>{DEPTS.filter(Boolean).map(d => <option key={d}>{d}</option>)}</select></label>
        <button type="button" className="kit-outline" onClick={() => mode === "day" ? setDay(addDays(day, -1)) : setWeek(addDays(week, -7))}>Previous</button>
        <button type="button" className="kit-outline" onClick={() => mode === "day" ? setDay(addDays(day, 1)) : setWeek(addDays(week, 7))}>Next</button>
        {data?.can_publish && <button type="button" className="kit-add" onClick={async () => { await api("/v1/workforce-desk/shifts/publish", { method: "POST", body: JSON.stringify({ from, to, department }) }); load(); }}>Publish</button>}
        {data?.can_approve && <button type="button" className="kit-outline" onClick={async () => { const r = await api<any>("/v1/workforce-desk/shifts/suggest", { method: "POST", body: JSON.stringify({ from, to, department }) }); setErr(`Suggested ${r.suggested}, left ${r.skipped} open so nobody goes over 48 hours.`); load(); }}>Suggest rota</button>}
      </div>
      <div className="kit-sheet wf-grid" style={{ gridTemplateColumns: `160px repeat(${days.length}, minmax(90px, 1fr))` }}>
        <div className="wf-h">Person</div>
        {days.map(d => <div key={d} className="wf-h">{d.slice(5)} <span className="m">{shifts.filter((s: any) => s.date === d).reduce((n: number, s: any) => n + s.hours, 0).toFixed(1)}h</span></div>)}
        <div className="wf-name">Open shifts</div>
        {days.map(d => <Cell key={d} items={shifts.filter((s: any) => !s.user_id && s.date === d)} />)}
        {people.filter((p: any) => !department || p.department === department).map((p: any) => (
          <div className="wf-person" key={p.id}>
            <div className="wf-name">{p.name}<span className="m">{hoursFor(p.id).toFixed(1)}h · {shifts.filter((s: any) => s.user_id === p.id).length} shifts</span></div>
            {days.map(d => <Cell key={p.id + d} items={shifts.filter((s: any) => s.user_id === p.id && s.date === d)} />)}
          </div>
        ))}
      </div>
      {data?.can_approve && (
        <form className="kit-card" onSubmit={async e => { e.preventDefault(); try { await api("/v1/workforce-desk/shifts", { method: "POST", body: JSON.stringify(form) }); load(); } catch (e2) { setErr(errText(e2)); } }}>
          <h2>Add shift</h2>
          <div className="frow">
            <label>Person<select value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}><option value="">Open shift</option>{people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{DEPTS.filter(Boolean).map(d => <option key={d}>{d}</option>)}</select></label>
            <label>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>From<input value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></label>
            <label>To<input value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></label>
          </div>
          <label>Note<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="kit-add" type="submit">{data.can_publish ? "Add draft" : "Save draft"}</button>
          <p className="m">Drafts stay off the phone until Publish. Templates: {(data.templates ?? []).map((t: any) => t.title).join(", ") || "none yet"}.</p>
          {data.can_publish && data.templates?.[0] && <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/templates/${data.templates[0].id}/apply`, { method: "POST", body: JSON.stringify({ week }) }); load(); }}>Apply {data.templates[0].title}</button>}
        </form>
      )}
    </>
  );
}

function Cell({ items }: { items: any[] }) {
  return <div className="wf-cell">{items.map(s => <div key={s.id} className={s.published ? "wf-shift" : "wf-shift draft"}><strong>{String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}</strong><span>{s.published ? s.position || s.department : "Draft"}</span>{s.notes && <span className="m">{s.notes}</span>}</div>)}</div>;
}

function Timesheets() {
  const [week, setWeek] = useState(monday());
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/v1/workforce-desk/timesheets?from=${week}&to=${addDays(week, 6)}`).then(setData).catch(() => setData({ lines: [] })); }, [week]);
  return (
    <div className="kit-sheet">
      <div className="kit-pagehead" style={{ padding: 10 }}><button type="button" className="kit-outline" onClick={() => setWeek(addDays(week, -7))}>Previous</button><span>{week}</span><button type="button" className="kit-outline" onClick={() => setWeek(addDays(week, 7))}>Next</button></div>
      {(data?.lines ?? []).map((line: any) => (
        <div className="kit-row" key={line.id} style={{ height: "auto", padding: "8px 10px" }}>
          <strong>{line.name}</strong>
          <span className="m">{line.date} · scheduled {line.scheduled}h · punched {line.punched}h{line.still_in ? " (still in)" : ""} · break {line.break_minutes}m · {line.approved ? "Approved" : "Open"}</span>
          {data?.can_approve && line.punch_id && !line.still_in && !line.approved && <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/timesheets/${line.punch_id}/approve`, { method: "POST", body: "{}" }); setData(await api(`/v1/workforce-desk/timesheets?from=${week}&to=${addDays(week, 6)}`)); }}>Approve</button>}
        </div>
      ))}
      {data && data.lines?.length === 0 && <p className="kit-empty">No published shifts in this week.</p>}
    </div>
  );
}

function Leave() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ from: "", to: "", note: "", kind: "holiday" });
  const [err, setErr] = useState<string | null>(null);
  const load = () => api("/v1/workforce-desk/leave").then(setData);
  useEffect(() => { load().catch(e => setErr(errText(e))); }, []);
  return (
    <>
      {err && <div className="note">{err}</div>}
      <form className="kit-card" onSubmit={async e => { e.preventDefault(); try { await api("/v1/workforce-desk/leave", { method: "POST", body: JSON.stringify(form) }); setForm({ from: "", to: "", note: "", kind: "holiday" }); load(); } catch (e2) { setErr(errText(e2)); } }}>
        <h2>Request leave</h2>
        <div className="frow">
          <label>From<input type="date" required value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
          <label>To<input type="date" required value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
          <label>Kind<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option>holiday</option><option>sickness</option><option>unpaid</option></select></label>
        </div>
        <label>Note<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        <button className="kit-add" type="submit">Send request</button>
        {data?.can_approve && <button type="button" className="kit-outline" onClick={async () => {
          const res = await fetch(API + "/v1/workforce-desk/leave/export", { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "leave.csv"; a.click();
          URL.revokeObjectURL(url);
        }}>Export register</button>}
      </form>
      <div className="kit-sheet">
        {(data?.accounts ?? []).map((a: any) => <div className="kit-row" key={a.user_id}><strong>{a.name}</strong><span className="m">{a.allowance_days} days allowance · {a.used_days} used · {Number(a.allowance_days) + Number(a.carried_days) - Number(a.used_days)} left</span></div>)}
        {(data?.items ?? []).map((item: any) => (
          <div className="kit-row" key={item.id} style={{ height: "auto" }}>
            <strong>{item.name}</strong>
            <span className="m">{item.kind} {item.from_date} → {item.to_date} · {item.status}</span>
            {data?.can_approve && item.status === "pending" && <>
              <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/leave/${item.id}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) }); load(); }}>Approve</button>
              <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/leave/${item.id}/decide`, { method: "POST", body: JSON.stringify({ approve: false }) }); load(); }}>Decline</button>
            </>}
          </div>
        ))}
      </div>
    </>
  );
}

function People() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api("/v1/workforce-desk/people").then(setData).catch(() => {}); }, []);
  const docs = (id: string) => (data?.documents ?? []).filter((d: any) => d.user_id === id);
  return (
    <div className="kit-sheet">
      {(data?.people ?? []).map((p: any) => (
        <div className="kit-row" key={p.id} style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
          <strong>{p.name}</strong>
          <span className="m">{p.department_name || p.department || "House"} · {p.role_name}{p.designation ? ` · ${p.designation}` : ""}{p.contracted_hours ? ` · ${p.contracted_hours}h` : ""}</span>
          <span className="m">{docs(p.id).map((d: any) => d.title).join(", ") || "No documents"}</span>
        </div>
      ))}
    </div>
  );
}

function Reports() {
  const [week, setWeek] = useState(monday());
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/v1/workforce-desk/reports?from=${week}&to=${addDays(week, 6)}`).then(setData).catch(e => setErr(errText(e))); }, [week]);
  if (err) return <div className="note">{err}</div>;
  if (!data) return <p className="m">Opening reports…</p>;
  return (
    <div className="wf-home">
      <article className="kit-card"><h2>Schedule</h2>{data.schedule.map((row: any) => <p key={row.department}>{row.department}: {row.shifts} shifts, {row.hours}h</p>)}</article>
      <article className="kit-card"><h2>Shift types</h2>{data.shift_types.map((row: any) => <p key={row.shift_type}>{row.shift_type}: {row.count}</p>)}</article>
      <article className="kit-card"><h2>Timesheets</h2><p>Scheduled {data.timesheet.scheduled}h · punched {data.timesheet.punched}h · approved {data.timesheet.approved}h</p></article>
      <article className="kit-card"><h2>Labour and revenue</h2><p>{data.labour.scheduled_hours}h · {pounds(data.labour.cost_pence)} at {pounds(data.labour.rate_pence)}/h</p><p className="m">{data.labour.revenue_note}</p></article>
    </div>
  );
}

function Messages() {
  const [box, setBox] = useState("inbox");
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState({ subject: "", body_html: "", department: "", require_reply: false, show_on_clock: false });
  const [reply, setReply] = useState("");
  const load = () => api<any>(`/v1/workforce-desk/messages?box=${box}&q=${encodeURIComponent(q)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`).then(r => { setItems(r.items); setCanPublish(r.can_publish); });
  useEffect(() => { load().catch(e => setErr(errText(e))); }, [box, q, folder]);
  useEffect(() => { api<any>("/v1/workforce-desk/people").then(r => setPeople(r.people ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!open?.id) return;
    const tick = () => api(`/v1/workforce-desk/messages/${open.id}`).then(setOpen).catch(() => {});
    const timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, [open?.id]);
  return (
    <>
      {err && <div className="note">{err}</div>}
      <div className="kit-pagehead">
        <div className="kit-seg">
          {["inbox", "sent"].map(id => <button type="button" key={id} className={box === id ? "on" : ""} onClick={() => setBox(id)}>{id}</button>)}
        </div>
        <input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search messages" />
        <input placeholder="Folder" value={folder} onChange={e => setFolder(e.target.value)} aria-label="Folder" />
      </div>
      <div className="kit-sheet">
        {items.map(item => <button type="button" key={item.id} className="kit-row" onClick={async () => setOpen(await api(`/v1/workforce-desk/messages/${item.id}`))}><strong>{item.subject}</strong><span className="m">{item.author}{item.require_reply && !item.acknowledged_at ? " · reply needed" : ""}{item.read_at ? "" : " · unread"}</span></button>)}
        {items.length === 0 && <p className="kit-empty">Nothing in this box.</p>}
      </div>
      {open && (
        <article className="kit-card">
          <h2>{open.subject}</h2>
          <div className="kit-prose" dangerouslySetInnerHTML={{ __html: open.body_html }} />
          {(open.thread ?? []).slice(1).map((m: any) => <p key={m.id}><strong>{m.author}</strong> <span dangerouslySetInnerHTML={{ __html: m.body_html }} /></p>)}
          {open.can_see_receipts && <p className="m">Read receipts: {(open.receipts ?? []).map((r: any) => `${r.name} ${r.read_at ? "read" : "unread"}${r.acknowledged_at ? ", replied" : ""}`).join(" · ") || "none"}</p>}
          {open.require_reply && <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/messages/${open.id}/ack`, { method: "POST", body: "{}" }); setOpen(await api(`/v1/workforce-desk/messages/${open.id}`)); }}>I have read this</button>}
          <button type="button" className="kit-text" onClick={async () => { const name = window.prompt("Folder name", "Follow up") || ""; if (name) await api(`/v1/workforce-desk/messages/${open.id}/file`, { method: "POST", body: JSON.stringify({ folder: name }) }); }}>File it</button>
          <form onSubmit={async e => { e.preventDefault(); await api("/v1/workforce-desk/messages", { method: "POST", body: JSON.stringify({ parent_id: open.id, body_html: `<p>${reply}</p>` }) }); setReply(""); setOpen(await api(`/v1/workforce-desk/messages/${open.id}`)); }}>
            <label>Reply<textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} /></label>
            <button className="kit-add" type="submit">Send reply</button>
          </form>
        </article>
      )}
      <form className="kit-card" onSubmit={async e => {
        e.preventDefault();
        try {
          await api("/v1/workforce-desk/messages", { method: "POST", body: JSON.stringify({ ...draft, body_html: `<p>${draft.body_html}</p>`, department: canPublish ? draft.department : "", recipient_ids: picked }) });
          setDraft({ subject: "", body_html: "", department: "", require_reply: false, show_on_clock: false });
          load();
        } catch (e2) { setErr(errText(e2)); }
      }}>
        <h2>{canPublish ? "Message the house" : "Message a manager"}</h2>
        <label>Subject<input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label>
        <label>Message<textarea required rows={4} value={draft.body_html} onChange={e => setDraft({ ...draft, body_html: e.target.value })} /></label>
        <div className="kit-people">{people.map(p => <label key={p.id} className="kit-check"><input type="checkbox" checked={picked.includes(p.id)} onChange={e => setPicked(cur => e.target.checked ? [...cur, p.id] : cur.filter(id => id !== p.id))} />{p.name}</label>)}</div>
        {canPublish && <>
          <label>Department, or leave blank and it stays a direct note<select value={draft.department} onChange={e => setDraft({ ...draft, department: e.target.value })}><option value="">Choose people later</option>{DEPTS.filter(Boolean).map(d => <option key={d}>{d}</option>)}</select></label>
          <label className="kit-check"><input type="checkbox" checked={draft.require_reply} onChange={e => setDraft({ ...draft, require_reply: e.target.checked })} />Require a reply. It stays pinned until they answer.</label>
          <label className="kit-check"><input type="checkbox" checked={draft.show_on_clock} onChange={e => setDraft({ ...draft, show_on_clock: e.target.checked })} />Show on the punch clock</label>
        </>}
        <button className="kit-add" type="submit">Send</button>
        <button type="button" className="kit-outline" onClick={async () => { const r = await api<any>("/v1/workforce-desk/digest", { method: "POST", body: "{}" }); setErr(`Digest emailed (${r.email}), ${r.unread} unread.`); }}>Email me a digest</button>
        {canPublish && <button type="button" className="kit-outline" onClick={async () => { await api("/v1/workforce-desk/sms", { method: "POST", body: JSON.stringify({ to: "+440000000000", body: draft.body_html || "House message" }) }); setErr("SMS is hooked and was not sent."); }}>SMS hook</button>}
      </form>
    </>
  );
}
