"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

type Pulse = { rooms_tonight: number; guest_rooms: number; arriving: number; departing: number; dinner: number; critical_issues?: number };
type Task = { id: string; title: string; notes: string | null; location_label: string | null; status: string; status_label: string; priority: string; priority_label: string; severity: string; created_by_name: string | null; assigned_name: string | null; assigned_staff_id: string | null; created_at: string };
type Person = { id: string; name: string; role_name: string };
type Notice = { id: string; department_label: string; department: string | null; title: string; body: string; author_name: string; created_at: string };
type Enquiry = { id: string; name: string; people: number | null; arrival: string | null; departure: string | null; programme_name: string | null };

const OPEN_NEW = ["new", "assigned", "acknowledged", "accepted", "scheduled", "reopened"];
const OPEN_DOING = ["in_progress", "paused", "waiting", "blocked", "awaiting_approval"];
const DONE = ["completed", "verified"];
const URG: Record<string, [string, string]> = { urgent: ["Right now", "u1"], high: ["Today", "u2"], normal: ["This week", "u3"], low: ["When possible", "u3"] };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export default function ManagerDesk() {
  const { user, ready } = useStore();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [pay, setPay] = useState<{ total_due_fmt: string; overdue: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [enq, setEnq] = useState<Enquiry[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const loadTasks = () => api<{ items: Task[] }>("/v1/ops/tasks?department=MAINT&status=all&limit=80").then(r => setTasks(r.items ?? [])).catch(() => setErr("Problems could not be loaded."));
  const loadBoard = () => api<{ notices: Notice[] }>("/v1/ops/board").then(b => setNotices(b.notices ?? [])).catch(() => {});
  useEffect(() => {
    if (!ready || !user) return;
    api<{ pulse: Pulse }>("/v1/estate").then(e => setPulse(e.pulse)).catch(() => {});
    api<{ total_due_fmt: string; overdue: number }>("/v1/estate/payments-due").then(setPay).catch(() => {});
    api<{ items: Person[] }>("/v1/ops/tasks/people").then(r => setPeople(r.items ?? [])).catch(() => {});
    api<{ items: Enquiry[] }>("/v1/guest-enquiries").then(r => setEnq(r.items ?? [])).catch(() => {});
    loadTasks(); loadBoard();
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = [
    { label: "New", dot: "#B4540A", items: tasks.filter(t => OPEN_NEW.includes(t.status)) },
    { label: "Being fixed", dot: "#1E5A4F", items: tasks.filter(t => OPEN_DOING.includes(t.status)) },
    { label: "Fixed", dot: "#9AA59F", items: tasks.filter(t => DONE.includes(t.status)).slice(0, 8) },
  ];
  const current = tasks.find(t => t.id === sel) ?? cols[0].items[0] ?? cols[1].items[0] ?? null;
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await loadTasks(); } catch (e) { setErr(e instanceof Error ? e.message : "That change could not be saved."); } };
  const assign = (p: Person) => current && act(() => api(`/v1/ops/tasks/${current.id}`, { method: "PATCH", body: JSON.stringify({ assigned_staff_id: p.id }) }));
  const start = () => current && act(() => api(`/v1/ops/tasks/${current.id}/status`, { method: "POST", body: JSON.stringify({ status: "in_progress" }) }));
  const fixed = () => current && act(async () => {
    if (!OPEN_DOING.includes(current.status)) await api(`/v1/ops/tasks/${current.id}/status`, { method: "POST", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/v1/ops/tasks/${current.id}/status`, { method: "POST", body: JSON.stringify({ status: "completed" }) });
  });
  const sendReply = async (n: Notice) => {
    const text = (reply[n.id] ?? "").trim(); if (!text) return;
    try { await api("/v1/ops/notices", { method: "POST", body: JSON.stringify({ title: `Re: ${n.title}`.slice(0, 80), body: `@${n.author_name.split(" ")[0]} ${text}`, department: n.department ?? undefined }) }); setReply({ ...reply, [n.id]: "" }); loadBoard(); }
    catch { setErr("Reply could not be sent."); }
  };
  const openN = cols[0].items.length + cols[1].items.length;
  const first = (user?.name ?? "").split(" ")[0];
  const fixers = people.filter(p => /maint|engineer|ground|estate|manager|porter/i.test(p.role_name)).slice(0, 6);
  const staffMsgs = notices.filter(n => n.author_name !== user?.name).slice(0, 6);

  return (
    <div className="ht">
      <header className="sh-head">
        <div>
          <span className="sh-layer mgmt">● Management side</span>
          <h1 className="sh-title">{first ? `${first}, here's the house` : "Management"}</h1>
          <span className="ht-muted">Problems, messages and bookings — all in one place</span>
        </div>
        <div className="sh-actions"><Link href="/finance/" className="sh-btn">Finance</Link><Link href="/labour/" className="sh-btn">Labour</Link><Link href="/hub/" className="sh-btn">Staff hub</Link></div>
      </header>

      <div className="sh-nums">
        <div className="dark"><small>Rooms in use tonight</small><b>{pulse ? `${pulse.rooms_tonight} / ${pulse.guest_rooms}` : "—"}</b></div>
        <div className={openN ? "warm" : ""}><small>Open problems</small><b>{openN}</b></div>
        <div><small>Critical issues</small><b className={pulse?.critical_issues ? "danger" : ""}>{pulse?.critical_issues ?? 0}</b></div>
        <div><small>New bookings</small><b>{enq.length}</b></div>
        <div><small>Payments due</small><b className={pay?.overdue ? "danger" : ""}>{pay?.total_due_fmt ?? "—"}</b></div>
      </div>

      {err && <div className="note">{err}</div>}

      <h2 className="ht-h2">Problems reported by staff</h2>
      <div className="md-board">
        {cols.map(c => (
          <div key={c.label} className="md-col">
            <span className="md-colhead"><span><i style={{ background: c.dot }} />{c.label}</span><span>{c.items.length}</span></span>
            {c.items.length === 0 && <p className="ht-muted" style={{ padding: "0 6px" }}>Nothing here.</p>}
            {c.items.map(t => (
              <button key={t.id} type="button" className={`md-card ${current?.id === t.id ? "on" : ""}`} aria-pressed={current?.id === t.id} onClick={() => setSel(t.id)}>
                <span className="top"><b>{t.title}</b><em className={(URG[t.priority] ?? URG.normal)[1]}>{(URG[t.priority] ?? URG.normal)[0]}</em></span>
                <small>{t.created_by_name ? `Reported by ${t.created_by_name}` : "Reported"} · {ago(t.created_at)}</small>
                <small className="own">{t.assigned_name ? `With ${t.assigned_name}` : "Not assigned yet"}</small>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="ht-grid">
        <section className="md-detail">
          {!current ? <p>No open problems. Nice.</p> : (<>
            <small>{current.status_label}{current.assigned_name ? ` · with ${current.assigned_name}` : ""}</small>
            <h2>{current.title}</h2>
            <p>{current.notes || "No extra details."}</p>
            <span className="lbl">Give this job to</span>
            <div className="md-people">
              {(fixers.length ? fixers : people.slice(0, 6)).map(p => <button key={p.id} type="button" className={current.assigned_staff_id === p.id ? "on" : ""} onClick={() => assign(p)}>{p.name}<small>{p.role_name}</small></button>)}
            </div>
            <div className="md-btns">
              {!OPEN_DOING.includes(current.status) && !DONE.includes(current.status) && <button type="button" className="ghost" onClick={start}>Start work</button>}
              {!DONE.includes(current.status) && <button type="button" className="go" onClick={fixed}>Mark fixed</button>}
              <Link href="/tasks/" className="ghost">Open full task</Link>
            </div>
          </>)}
        </section>

        <section className="ht-card">
          <h2>Messages from staff</h2>
          {staffMsgs.length === 0 ? <p className="ht-muted">No messages today.</p> : staffMsgs.map(n => (
            <div key={n.id} className="md-msg">
              <span className="top"><b>{n.author_name}{n.department ? ` · ${n.department_label}` : ""}</b><small>{ago(n.created_at)}</small></span>
              <p>{n.body}</p>
              <form onSubmit={ev => { ev.preventDefault(); sendReply(n); }}>
                <input aria-label={`Reply to ${n.author_name}`} placeholder="Reply…" value={reply[n.id] ?? ""} onChange={ev => setReply({ ...reply, [n.id]: ev.target.value })} />
                <button type="submit">Send</button>
              </form>
            </div>
          ))}
        </section>

        <section className="ht-card">
          <h2>New bookings</h2>
          {enq.length === 0 ? <p className="ht-muted">No new bookings waiting.</p> : (
            <ul className="ht-list">{enq.slice(0, 6).map(x => (
              <li key={x.id}><span><b>{x.name}</b><small>{x.people ?? "—"} guests · {x.arrival ?? "dates to confirm"}{x.programme_name ? ` · ${x.programme_name}` : ""}</small></span><Link href="/groups/" className="sh-mini">Review</Link></li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
