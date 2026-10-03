"use client";
import { useEffect, useRef, useState } from "react";
import { closed, matchesTask, sortTasks, taskLane, taskSignals } from "../../../domains/ops/task-command";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";

type Dept = { code: string; label: string };
type Action = { status: string; label: string };
type Task = {
  id: string;
  title: string;
  notes: string;
  department: string;
  department_label: string;
  team: string;
  location_label: string;
  asset_label: string;
  room_label: string;
  guest_name: string;
  event_label: string;
  sop_slug: string;
  parent_id: string | null;
  priority: string;
  priority_label: string;
  severity: string;
  severity_label: string;
  status: string;
  status_label: string;
  overdue: boolean;
  due_at: string | null;
  start_at: string | null;
  expected_minutes: number | null;
  actual_minutes: number | null;
  blocked_reason: string;
  assigned_staff_id: string | null;
  assigned_staff_ids: string[];
  assigned_label: string;
  assigned_name: string | null;
  created_by_name: string | null;
  created_at: string;
  next: Action[];
};
type Event = {
  id: string;
  kind: string;
  actor_name: string | null;
  from_status: string | null;
  to_status: string | null;
  field_name: string | null;
  previous_value: string | null;
  new_value: string | null;
  body: string;
  attachment_kind: string | null;
  created_at: string;
};
type Detail = Task & { events: Event[]; children: Task[]; can_assign: boolean; can_approve: boolean };
type Board = {
  items: Task[];
  matched_total: number;
  counts: { total: number; open: number; done: number; overdue: number };
  departments: Dept[];
  statuses: { code: string; label: string }[];
  priorities: { code: string; label: string }[];
  severities: { code: string; label: string }[];
  can_assign: boolean;
  can_approve: boolean;
};
type Person = { id: string; name: string; role_name: string };

const emptyForm = {
  title: "", notes: "", department: "HOUSE", priority: "normal", severity: "none",
  due_at: "", assigned_staff_id: "", assigned_label: "", room_label: "", guest_name: "",
  location_label: "", asset_label: "", event_label: "", sop_slug: "", expected_minutes: "",
};

const templates = [
  { title: "Retreat arrival readiness", department: "FRONT", minutes: "30", priority: "high", notes: "Confirm the latest arrival list and timings. Check room readiness with housekeeping, dietary handover with kitchen and the welcome arrangements. Record unresolved items and owners." },
  { title: "Kitchen service readiness", department: "KITCHEN", minutes: "30", priority: "high", notes: "Confirm covers for each meal and the latest dietary requirements. Review recipes and supplier labels; confirm allergen information before service. Vegetarian: no eggs, onion, garlic, leeks, spring onions or chives. Check Jain/Ekadashi requests where applicable, portion plan and food waste log." },
  { title: "Room turnover and inspection", department: "HK", minutes: "30", priority: "normal", notes: "Confirm checkout and next arrival. Complete the approved room cleaning SOP, linen and supplies checks. Report defects and obtain inspection sign-off before marking the room ready." },
  { title: "Restaurant service preparation", department: "RESTAURANT", minutes: "25", priority: "normal", notes: "Confirm meal covers and service time with kitchen. Check dining setup, dietary service instructions and buffet labels. Agree replenishment and closing duties." },
  { title: "Equipment fault follow-up", department: "MAINT", minutes: "20", priority: "high", notes: "Identify the equipment and fault. Record the safe operating restriction, responsible service contact, parts or visit status and next follow-up. Follow the approved equipment SOP; only authorised personnel restore service." },
  { title: "Grounds and access check", department: "GROUNDS", minutes: "25", priority: "normal", notes: "Check guest paths, arrival access and outdoor areas using the approved grounds checklist. Record any hazard, action and owner." },
  { title: "Night shift handover", department: "NIGHT", minutes: "20", priority: "normal", notes: "Confirm late arrivals and outstanding requests. Review emergency contacts, access arrangements and unresolved faults. Record exceptions and handover to the morning team." },
  { title: "Retreat change impact review", department: "MGMT", minutes: "30", priority: "high", notes: "Compare confirmed guest numbers and dates with the previous plan. Review room preparation, meal covers, dietary requirements, rota workload and supplier orders. Record proposed changes for the responsible managers to approve." },
  { title: "Supplier order and value review", department: "HOUSE", minutes: "30", priority: "normal", notes: "Check available stock and confirmed demand first. Compare like-for-like pack sizes, unit prices, VAT, delivery and expiry. Check dietary suitability and supplier substitutions. Record the chosen option for purchasing approval." },
];

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

export default function TaskBoard() {
  const { user } = useStore();
  const [board, setBoard] = useState<Board | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("triage");
  const [view, setView] = useState("list");
  const [focus, setFocus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blocking, setBlocking] = useState(false);
  const requestVersion = useRef(0);
  const detailVersion = useRef(0);
  const [dept, setDept] = useState("all");
  const [filter, setFilter] = useState("open");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("");
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3000); };

  const query = () => {
    const p = new URLSearchParams({ limit: "100" });
    if (typeof window !== "undefined") { const booking = new URLSearchParams(window.location.search).get("booking"); if (booking) p.set("booking_id", booking); }
    if (dept !== "all") p.set("department", dept);
    if (filter === "mine") p.set("mine", "1");
    if (filter === "overdue") p.set("overdue", "1");
    if (filter === "done") p.set("status", "done");
    else if (filter !== "all") p.set("status", "open");
    return p.toString();
  };
  const load = async (append = false) => {
    const version = ++requestVersion.current;
    const p = new URLSearchParams(query());
    if (append) p.set("offset", String(board?.items.length ?? 0));
    setBusy(true);
    try {
      const next = await api<Board>(`/v1/ops/tasks?${p}`);
      if (version !== requestVersion.current) return;
      setBoard(previous => append && previous ? { ...next, items: [...previous.items, ...next.items].filter((t, i, all) => all.findIndex(x => x.id === t.id) === i) } : next);
      setErr(null);
    } catch (e) {
      if (version === requestVersion.current) setErr(e instanceof ApiError ? e.problem.detail : "Tasks could not be opened.");
    } finally { if (version === requestVersion.current) setBusy(false); }
  };
  const loadOne = async (id: string) => {
    const version = ++detailVersion.current;
    setDetail(null);
    try {
      const next = await api<Detail>(`/v1/ops/tasks/${id}`);
      if (version === detailVersion.current) setDetail(next);
    } catch (e) { if (version === detailVersion.current) say(e instanceof ApiError ? e.problem.detail : "Could not open the task"); }
  };

  useEffect(() => { setBoard(null); load(); return () => { requestVersion.current++; }; }, [dept, filter]);
  useEffect(() => { api<{ items: Person[] }>("/v1/ops/tasks/people").then(r => setPeople(r.items)).catch(() => {}); }, []);
  useEffect(() => { setBlocking(false); setBlockReason(""); if (sel) loadOne(sel); else setDetail(null); return () => { detailVersion.current++; }; }, [sel]);

  if (err && !board) return <div className="note">{err}<button className="btn" onClick={() => { setErr(null); load(); }}>Try again</button></div>;
  if (!board) return <div className="empty">Opening the operations centre…</div>;

  const now = new Date();
  const items = sortTasks(board.items.filter(t => matchesTask(t, search) && (
    focus === "all" || (focus === "blocked" && taskLane(t) === "held") ||
    (focus === "approval" && t.status === "awaiting_approval") ||
    (focus === "unassigned" && taskSignals(t, now).includes("No owner")) ||
    (focus === "today" && taskSignals(t, now).includes("Due today")) ||
    (focus === "critical" && !closed(t) && t.severity === "critical")
  )), sort, now);
  const openItems = board.items.filter(t => !closed(t));
  const estimated = openItems.reduce((n, t) => n + (t.expected_minutes ?? 0), 0);
  const missingEstimates = openItems.filter(t => t.expected_minutes == null).length;
  const lanes = [
    { code: "planned", label: "Ready & scheduled" }, { code: "working", label: "In progress" },
    { code: "held", label: "Blocked & waiting" }, { code: "approval", label: "Approval" },
    { code: "closed", label: "Closed" },
  ];
  const taskCard = (t: Task) => (
    <button key={t.id} className={"task-command-card" + (sel === t.id ? " selected" : "")} onClick={() => setSel(t.id)}>
      <span className="task-command-card-top"><span>{t.department_label}</span><span>{t.priority_label}</span></span>
      <strong>{t.title}</strong>
      <span>{[t.room_label, t.location_label, t.assigned_name || t.assigned_label || "No owner"].filter(Boolean).join(" · ")}</span>
      <span className="task-command-card-top"><span>{t.status.replace(/_/g, " ")}</span><span>{t.due_at ? when(t.due_at) : "No deadline"}</span></span>
      {taskSignals(t, now).length > 0 && <span className="task-signals">{taskSignals(t, now).map(signal => <span key={signal} className={signal === "Overdue" || signal === "Critical severity" ? "risk" : ""}>{signal}</span>)}</span>}
      {t.blocked_reason && t.status === "blocked" && <span className="task-blocker">{t.blocked_reason}</span>}
    </button>
  );

  const move = async (id: string, status: string, extra: Record<string, string> = {}) => {
    try {
      await api(`/v1/ops/tasks/${id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) });
      say("Updated");
      load();
      if (sel === id) loadOne(id);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not update"); }
  };

  return (
    <>
      <div className="task-command-hero">
        <div><div className="k">The Vedanta Way · House operations</div><h1>Operations command centre</h1>
          <p>Every department, one accountable flow. See what needs attention, who owns it and what is holding it up.</p>
          <p className="m">{user?.name ? `Signed in as ${user.name}. ` : ""}Deadlines display in London time.</p>
        </div>
        <div className="task-command-tools"><button className="btn" disabled={busy} onClick={() => load()}>Refresh</button><button className="btn" onClick={() => window.print()}>Print handover</button></div>
      </div>
      <div className="task-command-workspaces" aria-label="Connected department workspaces">
        {[{ href: "/readiness/", label: "Retreat readiness" }, { href: "/groups/", label: "Retreat bookings" }, { href: "/kitchen/", label: "Kitchen & covers" }, { href: "/housekeeping/", label: "Room readiness" }, { href: "/maintenance/", label: "Maintenance" }, { href: "/labour/", label: "Staffing" }, { href: "/purchasing/", label: "Purchasing" }, { href: "/manual/", label: "SOPs & training" }, { href: "/training/", label: "Staff training" }, { href: "/reports/", label: "Reports" }].map(link => <a key={link.href} href={link.href}>{link.label} <span aria-hidden="true">↗</span></a>)}
      </div>
      <div className="task-command-stats" aria-label="Whole house task totals">
        {[{ label: "Open across the house", value: board.counts.open }, { label: "Overdue across the house", value: board.counts.overdue }, { label: "Completed or verified", value: board.counts.done }, { label: "All recorded tasks", value: board.counts.total }].map(stat => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
      </div>
      {err && <div role="alert" className="note">{err}</div>}
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={dept === "all" ? "on" : ""} onClick={() => setDept("all")}>All</button>
        {board.departments.map(d => <button key={d.code} className={dept === d.code ? "on" : ""} onClick={() => setDept(d.code)}>{d.label}</button>)}
      </div>
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>Open</button>
        <button className={filter === "mine" ? "on" : ""} onClick={() => setFilter("mine")}>Mine</button>
        <button className={filter === "overdue" ? "on" : ""} onClick={() => setFilter("overdue")}>Overdue</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All statuses</button>
        <button className={filter === "done" ? "on" : ""} onClick={() => setFilter("done")}>Done</button>
      </div>

      <div className="task-command-toolbar">
        <input aria-label="Search loaded tasks" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, owner, room, equipment or retreat…" />
        <select aria-label="Focus" value={focus} onChange={e => setFocus(e.target.value)}>
          <option value="all">All attention</option><option value="today">Due today</option><option value="blocked">Blocked / waiting</option><option value="approval">Needs approval</option><option value="unassigned">No owner</option><option value="critical">Critical severity</option>
        </select>
        <select aria-label="Sort tasks" value={sort} onChange={e => setSort(e.target.value)}><option value="triage">Attention first</option><option value="due">Deadline first</option><option value="newest">Newest first</option></select>
        <div className="seg"><button aria-pressed={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button><button aria-pressed={view === "board"} className={view === "board" ? "on" : ""} onClick={() => setView("board")}>Board</button></div>
      </div>
      <p className="m task-command-scope">Showing {items.length} of {board.items.length} loaded tasks · {board.matched_total} match the department and status filters. Search, attention sorting and workload below cover loaded tasks. Attention order uses severity, overdue status, blockers and priority.</p>
      <div className="task-command-departments" aria-label="Department workload in loaded tasks">
        {board.departments.map(d => {
          const tasks = openItems.filter(t => t.department === d.code);
          if (!tasks.length) return null;
          return <button key={d.code} onClick={() => setDept(d.code)}><b>{d.label}</b><span>{tasks.length} open · {tasks.filter(t => t.overdue).length} overdue</span><span>{tasks.reduce((n, t) => n + (t.expected_minutes ?? 0), 0)} estimated min · {tasks.filter(t => !t.assigned_staff_id && !t.assigned_label).length} without owner</span></button>;
        })}
      </div>
      <p className="m">Loaded open work: {estimated} estimated minutes; {missingEstimates} tasks have no estimate. This is work volume, not a staffing capacity forecast.</p>
      <div className="split task-command-split">
        <div>
          {view === "list" ? <div className="task-command-list">{items.map(taskCard)}</div> : <div className="task-command-board">{lanes.filter(l => l.code !== "closed" || filter === "done" || filter === "all").map(l => <section key={l.code}><h3>{l.label} <span>{items.filter(t => taskLane(t) === l.code).length}</span></h3>{items.filter(t => taskLane(t) === l.code).map(taskCard)}</section>)}</div>}
          {items.length === 0 && <div className="empty">No tasks match this view. Change the focus or search.</div>}
          {board.items.length < board.matched_total && <button className="btn" disabled={busy} onClick={() => load(true)}>{busy ? "Loading…" : "Load more tasks"}</button>}

          <form className="house-panel" style={{ marginTop: 16 }} onSubmit={async e => {
            e.preventDefault();
            try {
              const created = await api<Task>("/v1/ops/tasks", {
                method: "POST",
                body: JSON.stringify({
                  ...form,
                  due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
                  expected_minutes: form.expected_minutes || null,
                  assigned_staff_id: form.assigned_staff_id || null,
                }),
              });
              setForm(emptyForm);
              say("Task opened");
              setSel(created.id);
              load();
            } catch (e2) { say(e2 instanceof ApiError ? e2.problem.detail : "Could not open the task"); }
          }}>
            <div className="k">New task</div>
            <h2>Add work</h2>
            <div className="ops-form">
              <label>Start from a department template
                <select aria-label="Task template" defaultValue="" onChange={e => {
                  const template = templates.find(t => t.title === e.target.value);
                  if (template) setForm({ ...emptyForm, title: template.title, department: template.department, notes: template.notes, expected_minutes: template.minutes, priority: template.priority });
                  e.target.value = "";
                }}><option value="">Choose a template (review before saving)</option>{templates.map(t => <option key={t.title} value={t.title}>{t.title}</option>)}</select>
              </label>
              <input required aria-label="Task title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What needs doing" />
              <div className="frow">
                <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                  {board.departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                </select>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  {board.priorities.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                </select>
              </div>
              <div className="frow">
                <input aria-label="Deadline (your device local time)" type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} />
                <input value={form.room_label} onChange={e => setForm({ ...form, room_label: e.target.value })} placeholder="Room" />
              </div>
              <div className="frow">
                <input value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} placeholder="Guest" />
                <input value={form.location_label} onChange={e => setForm({ ...form, location_label: e.target.value })} placeholder="Location" />
              </div>
              <div className="frow">
                <select aria-label="Assign task owner" disabled={!board.can_assign} value={form.assigned_staff_id} onChange={e => setForm({ ...form, assigned_staff_id: e.target.value })}>
                  <option value="">Assign later</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input value={form.assigned_label} onChange={e => setForm({ ...form, assigned_label: e.target.value })} placeholder="Team or name" />
              </div>
              <div className="frow"><select aria-label="Severity" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>{board.severities.map(s => <option key={s.code} value={s.code}>{s.label} severity</option>)}</select><input aria-label="Estimated minutes" type="number" min="0" max="20000" value={form.expected_minutes} onChange={e => setForm({ ...form, expected_minutes: e.target.value })} placeholder="Estimated minutes" /></div>
              <div className="frow"><input aria-label="Equipment or asset" value={form.asset_label} onChange={e => setForm({ ...form, asset_label: e.target.value })} placeholder="Equipment / asset" /><input aria-label="Retreat or event" value={form.event_label} onChange={e => setForm({ ...form, event_label: e.target.value })} placeholder="Retreat / event" /></div>
              <input aria-label="SOP reference" value={form.sop_slug} onChange={e => setForm({ ...form, sop_slug: e.target.value })} placeholder="SOP reference" />
              <p className="m">Enter the deadline in your device’s local time. Templates are drafts; check the estimate and requirements before creating a task.</p>
              <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
              <button className="btn primary" type="submit">Open task</button>
            </div>
          </form>
        </div>

        <div className="detail">
          {!detail && <p className="m">Choose a task, or open a new one.</p>}
          {detail && (
            <>
              <header>
                <div>
                  <div className="k">{detail.department_label}</div>
                  <h2>{detail.title}</h2>
                  <p className="m" style={{ marginTop: 6 }}>
                    {detail.created_by_name ? `Opened by ${detail.created_by_name}` : "Opened"}
                    {detail.assigned_name ? ` · ${detail.assigned_name}` : detail.assigned_label ? ` · ${detail.assigned_label}` : ""}
                    {detail.room_label ? ` · ${detail.room_label}` : ""}
                    {detail.guest_name ? ` · ${detail.guest_name}` : ""}
                  </p>
                </div>
                <span className={"chip " + (detail.overdue ? "CANCELLED" : "CONFIRMED")}>{detail.status_label}</span>
              </header>
              {detail.notes && <p style={{ whiteSpace: "pre-wrap" }}>{detail.notes}</p>}
              <div className="facts">
                <div><span>Priority</span><b>{detail.priority_label}</b></div>
                <div><span>Due</span><b>{detail.due_at ? when(detail.due_at) : "—"}</b></div>
                <div><span>Time</span><b>{detail.actual_minutes != null ? `${detail.actual_minutes} min` : "—"}{detail.expected_minutes ? ` / ${detail.expected_minutes}` : ""}</b></div>
              </div>
              {(detail.location_label || detail.asset_label || detail.event_label || detail.sop_slug) && (
                <p className="m">
                  {[detail.location_label, detail.asset_label, detail.event_label, detail.sop_slug && `SOP ${detail.sop_slug}`].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="actions" style={{ flexWrap: "wrap", gap: 8 }}>
                {detail.next.map(a => (
                  <button key={a.status} className="btn primary" onClick={() => a.status === "blocked" ? setBlocking(true) : move(detail.id, a.status)}>{a.label}</button>
                ))}
                {board.can_approve && detail.status === "completed" && (
                  <button className="btn" onClick={() => api(`/v1/ops/tasks/${detail.id}/verify`, { method: "POST", body: JSON.stringify({}) }).then(() => { say("Verified"); load(); loadOne(detail.id); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not verify"))}>Verify</button>
                )}
                {board.can_approve && ["completed", "verified", "cancelled"].includes(detail.status) && (
                  <button className="btn" onClick={() => api(`/v1/ops/tasks/${detail.id}/reopen`, { method: "POST", body: JSON.stringify({}) }).then(() => { say("Reopened"); load(); loadOne(detail.id); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not reopen"))}>Reopen</button>
                )}
                {board.can_approve && !["completed", "verified", "cancelled"].includes(detail.status) && (
                  <button className="btn danger" onClick={() => move(detail.id, "cancelled")}>Cancel</button>
                )}
              </div>

              {detail.status === "blocked" && <div className="note"><b>Blocker</b><p>{detail.blocked_reason || "No reason recorded. Add the cause in a comment."}</p></div>}
              {blocking && <form className="ops-form" onSubmit={e => { e.preventDefault(); move(detail.id, "blocked", { blocked_reason: blockReason }); setBlocking(false); }}><label>What is preventing completion?<textarea required maxLength={400} value={blockReason} onChange={e => setBlockReason(e.target.value)} /></label><div className="actions"><button className="btn primary" type="submit">Record blocker</button><button className="btn" type="button" onClick={() => setBlocking(false)}>Keep working</button></div></form>}
              {detail.can_assign && <form className="ops-form" key={detail.id + detail.assigned_staff_id} onSubmit={async e => {
                e.preventDefault(); const data = new FormData(e.currentTarget);
                try { await api(`/v1/ops/tasks/${detail.id}`, { method: "PATCH", body: JSON.stringify({ assigned_staff_id: data.get("owner") || null, assigned_staff_ids: [...new Set([...(detail.assigned_staff_ids ?? []).filter(id => id !== detail.assigned_staff_id), ...(data.get("owner") ? [String(data.get("owner"))] : [])])] }) }); say("Owner updated"); load(); loadOne(detail.id); }
                catch (e2) { say(e2 instanceof ApiError ? e2.problem.detail : "Could not assign"); }
              }}><label>Accountable owner<select name="owner" defaultValue={detail.assigned_staff_id ?? ""}><option value="">No individual owner</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="btn" type="submit">Save owner</button></form>}
              {detail.children.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="k">Subtasks</div>
                  {detail.children.map(c => (
                    <button key={c.id} className="ops-line" style={{ width: "100%", background: "transparent", borderLeft: 0, borderRight: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setSel(c.id)}>
                      <b>{c.status_label}</b>
                      <span>{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
              <form className="ops-form" onSubmit={async e => {
                e.preventDefault();
                if (!sub.trim()) return;
                try {
                  await api("/v1/ops/tasks", { method: "POST", body: JSON.stringify({ title: sub, department: detail.department, parent_id: detail.id }) });
                  setSub("");
                  say("Subtask added");
                  load();
                  loadOne(detail.id);
                } catch (e2) { say(e2 instanceof ApiError ? e2.problem.detail : "Could not add"); }
              }}>
                <input value={sub} onChange={e => setSub(e.target.value)} placeholder="Add a subtask" />
              </form>

              <form className="ops-form" onSubmit={async e => {
                e.preventDefault();
                try {
                  await api(`/v1/ops/tasks/${detail.id}/comment`, { method: "POST", body: JSON.stringify({ body: comment }) });
                  setComment("");
                  loadOne(detail.id);
                } catch (e2) { say(e2 instanceof ApiError ? e2.problem.detail : "Could not comment"); }
              }}>
                <textarea required rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Comment — this is kept even if the task is edited" />
                <button className="btn" type="submit">Add comment</button>
              </form>

              <label className="btn" style={{ marginTop: 8, display: "inline-block" }}>
                Add photo
                <input type="file" accept="image/*" hidden onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      await api(`/v1/ops/tasks/${detail.id}/attachment`, { method: "POST", body: JSON.stringify({ kind: "photo", data: String(reader.result) }) });
                      say("Photo added");
                      loadOne(detail.id);
                    } catch (err) { say(err instanceof ApiError ? err.problem.detail : "Could not attach"); }
                  };
                  reader.readAsDataURL(file);
                }} />
              </label>

              <div style={{ marginTop: 22 }}>
                <div className="k">History</div>
                {(detail.events ?? []).length === 0 && <p className="m">No events yet.</p>}
                {(detail.events ?? []).map(ev => (
                  <div key={ev.id} className="ops-card">
                    <div className="ops-card-top">
                      <b>{ev.kind === "status" ? `${ev.from_status ?? "—"} → ${ev.to_status}` : ev.kind}</b>
                      <span className="m">{ev.actor_name} · {when(ev.created_at)}</span>
                    </div>
                    {ev.kind === "field" && <p className="m">{ev.field_name}: {ev.previous_value || "—"} → {ev.new_value || "—"}</p>}
                    {ev.kind === "comment" && <p style={{ whiteSpace: "pre-wrap" }}>{ev.body}</p>}
                    {ev.kind === "attachment" && ev.body.startsWith("data:image/") && <img src={ev.body} alt="" style={{ maxWidth: "100%", marginTop: 8 }} />}
                    {ev.body && ev.kind !== "comment" && ev.kind !== "field" && !ev.body.startsWith("data:") && <p>{ev.body}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
