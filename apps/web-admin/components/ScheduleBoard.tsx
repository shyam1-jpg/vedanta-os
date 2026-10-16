"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { assessDrop, dateInRange, ROTA_DEPARTMENTS } from "../../../domains/ops/workforce.ts";
import ScheduleTools from "@/components/ScheduleTools";

type Shift = {
  id: string;
  user_id: string | null;
  name?: string | null;
  department: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  published: boolean;
  notes?: string | null;
  position?: string | null;
};
type Person = { id: string; name: string; departments: string[]; hours: number };
type Undo = { action: "delete"; id: string } | { action: "restore"; id: string; user_id: string | null; date: string; published: boolean };
type Drag = { shift: Shift; x: number; y: number; copy: boolean; pointerId: number; over: { userId: string | null; date: string; department: string } | null };

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
function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
function clock(t: string) { return String(t).slice(0, 5); }
function deptName(code: string, list: { code: string; name: string }[]) {
  return list.find(d => d.code === code)?.name ?? code;
}

export default function ScheduleBoard() {
  const [week, setWeek] = useState(monday());
  const [department, setDepartment] = useState("KITCHEN");
  const [mode, setMode] = useState<"week" | "day">("week");
  const [day, setDay] = useState(iso(new Date()));
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [undo, setUndo] = useState<Undo[]>([]);
  const [copyOn, setCopyOn] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [form, setForm] = useState({ user_id: "", date: iso(new Date()), start_time: "09:00", end_time: "17:00", notes: "", department: "KITCHEN" });
  const [hidden, setHidden] = useState<{ from: string; to: string } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ shift: Shift; x: number; y: number; pointerId: number; type: string; copy: boolean; armed: boolean } | null>(null);
  const timer = useRef(0);
  const copyRef = useRef(false);
  copyRef.current = copyOn;

  const from = mode === "day" ? day : week;
  const to = mode === "day" ? day : addDays(week, 6);
  const load = () => api<any>(`/v1/workforce-desk/schedule?from=${from}&to=${to}${department ? `&department=${department}` : ""}`).then(setData).catch(e => setErr(errText(e)));
  useEffect(() => { load(); }, [from, to, department]);

  const allDays = mode === "day" ? [day] : Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const days = hidden ? allDays.filter(d => d < hidden.from || d > hidden.to) : allDays;
  const people: Person[] = data?.people ?? [];
  const shifts: Shift[] = data?.shifts ?? [];
  const departments: { code: string; name: string }[] = data?.departments ?? ROTA_DEPARTMENTS;
  const dragDepartments: string[] = data?.drag_departments ?? [];
  const sections = department
    ? departments.filter(d => d.code === department)
    : [...departments, ...shifts.filter(s => !departments.some(d => d.code === s.department)).map(s => ({ code: s.department, name: s.department }))];

  function clashes(userId: string | null, date: string) {
    if (!userId) return { unavailable: false, onLeave: false };
    const unavailable = (data?.unavailable ?? []).some((row: any) => row.user_id === userId && row.date === date);
    const onLeave = (data?.leave ?? []).some((row: any) => row.user_id === userId && dateInRange(date, row.from_date, row.to_date));
    return { unavailable, onLeave };
  }

  function preview(shift: Shift, userId: string | null, date: string, copy: boolean, section: string) {
    if (section !== shift.department) return { allowed: false, warnings: [{ code: "hours" as const, message: `This shift stays on the ${deptName(shift.department, departments)} rota.` }] };
    const person = people.find(p => p.id === userId);
    const own = shift.user_id === userId ? shift.hours : 0;
    const rest = Math.max(0, Math.round(((person?.hours ?? 0) - own) * 10) / 10);
    const weekShifts = [
      { id: "rest", userId: userId ?? "", hours: rest },
      ...(own ? [{ id: shift.id, userId: userId ?? "", hours: shift.hours }] : []),
    ];
    const clash = clashes(userId, date);
    return assessDrop({ shiftId: shift.id, hours: shift.hours, toUserId: userId, copy, weekShifts, ...clash });
  }

  function putDrag(next: Drag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  function cellAt(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null;
    if (!el?.dataset.date || !el.dataset.dept) return null;
    return { userId: el.dataset.user || null, date: el.dataset.date, department: el.dataset.dept };
  }

  function onDown(e: React.PointerEvent, shift: Shift) {
    if (!dragDepartments.includes(shift.department)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pending.current = { shift, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, copy: e.ctrlKey || e.altKey || copyRef.current, armed: false };
    if (e.pointerType === "mouse") return;
    timer.current = window.setTimeout(() => {
      const p = pending.current;
      if (!p) return;
      p.armed = true;
      putDrag({ shift: p.shift, x: p.x, y: p.y, copy: p.copy, pointerId: p.pointerId, over: cellAt(p.x, p.y) });
    }, 420);
  }

  function onMove(e: React.PointerEvent) {
    const p = pending.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.type !== "mouse" && !p.armed && dist > 14) {
      window.clearTimeout(timer.current);
      pending.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
      return;
    }
    if (p.type === "mouse" && !dragRef.current && dist > 6) {
      putDrag({ shift: p.shift, x: e.clientX, y: e.clientY, copy: e.ctrlKey || e.altKey || copyRef.current, pointerId: p.pointerId, over: cellAt(e.clientX, e.clientY) });
      return;
    }
    if (dragRef.current?.pointerId === e.pointerId) {
      putDrag({ ...dragRef.current, x: e.clientX, y: e.clientY, copy: e.ctrlKey || e.altKey || copyRef.current, over: cellAt(e.clientX, e.clientY) });
    }
  }

  async function onUp(e: React.PointerEvent) {
    window.clearTimeout(timer.current);
    const current = dragRef.current;
    pending.current = null;
    putDrag(null);
    if (!current || current.pointerId !== e.pointerId || !current.over) return;
    const same = current.shift.user_id === current.over.userId && current.shift.date === current.over.date;
    if (same && !current.copy) return;
    const look = preview(current.shift, current.over.userId, current.over.date, current.copy, current.over.department);
    if (!look.allowed) { setWarn(""); setErr(look.warnings[0]?.message ?? "That drop is not on this rota."); return; }
    try {
      const result = await api<any>(`/v1/workforce-desk/shifts/${current.shift.id}/place`, {
        method: "POST",
        body: JSON.stringify({ user_id: current.over.userId, date: current.over.date, copy: current.copy }),
      });
      if (result.undo) setUndo(stack => [result.undo, ...stack].slice(0, 12));
      setErr("");
      setWarn((result.warnings ?? []).map((w: { message: string }) => w.message).join(" "));
      await load();
    } catch (e2) { setWarn(""); setErr(errText(e2)); }
  }

  const live = drag?.over ? preview(drag.shift, drag.over.userId, drag.over.date, drag.copy, drag.over.department) : null;

  return (
    <>
      <div className="wf-switch" role="tablist" aria-label="Department rota">
        <button type="button" className={department === "" ? "on" : ""} onClick={() => setDepartment("")}>All departments</button>
        {departments.map(d => <button type="button" key={d.code} className={department === d.code ? "on" : ""} onClick={() => setDepartment(d.code)}>{d.name}</button>)}
      </div>
      <p className="m">Each department has its own open shifts and its own publish. Someone on two rotas, such as Shreyas in housekeeping and the kitchen, shows on both, and the hours add up to one 48-hour week. Drag a shift to another person or day. It stays a draft until you publish. On a phone, press and hold. Hold Ctrl or Alt, or turn Copy on, to duplicate it.</p>
      {err && <div className="note" role="alert">{err}</div>}
      {warn && <div className="wf-warn" role="status">{warn}</div>}
      <div className="kit-pagehead">
        <div className="kit-seg">
          <button type="button" className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</button>
          <button type="button" className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</button>
        </div>
        <button type="button" className="kit-outline" onClick={() => mode === "day" ? setDay(addDays(day, -1)) : setWeek(addDays(week, -7))}>Previous</button>
        <button type="button" className="kit-outline" onClick={() => mode === "day" ? setDay(addDays(day, 1)) : setWeek(addDays(week, 7))}>Next</button>
        <button type="button" className={copyOn ? "kit-add" : "kit-outline"} aria-pressed={copyOn} onClick={() => setCopyOn(v => !v)}>Copy</button>
        <button type="button" className="kit-outline" disabled={!undo.length} onClick={async () => {
          const item = undo[0];
          if (!item) return;
          try {
            await api("/v1/workforce-desk/shifts/undo", { method: "POST", body: JSON.stringify(item) });
            setUndo(stack => stack.slice(1));
            setWarn(""); setErr("");
            await load();
          } catch (e2) { setErr(errText(e2)); }
        }}>Undo</button>
        {data?.can_publish && <button type="button" className="kit-add" onClick={async () => { await api("/v1/workforce-desk/shifts/publish", { method: "POST", body: JSON.stringify({ from, to, department }) }); setWarn(""); await load(); }}>{department ? `Publish ${deptName(department, departments)}` : "Publish all departments"}</button>}
      </div>
      <ScheduleTools from={from} to={to} department={department} people={people} shiftIds={shifts.map(s => s.id)} canManage={!!dragDepartments.length || !!data?.can_publish} hidden={hidden} onHide={setHidden} onChanged={load} />
      {hidden && <p className="m">Hiding {hidden.from} to {hidden.to}.</p>}
      {!days.length && <p className="m">That period is hidden. Show it again from Tools.</p>}
      {sections.map(section => {
        const rows = people.filter(p => p.departments.includes(section.code));
        const mine = shifts.filter(s => s.department === section.code);
        return (
          <section key={section.code} className="wf-rota">
            {!department && <h2>{section.name}</h2>}
            <div className="kit-sheet wf-grid" style={{ gridTemplateColumns: `180px repeat(${days.length}, minmax(96px, 1fr))` }}>
              <div className="wf-h">Person</div>
              {days.map(d => <div key={d} className="wf-h">{d.slice(5)} <span className="m">{mine.filter(s => s.date === d).reduce((n, s) => n + s.hours, 0).toFixed(1)}h</span></div>)}
              <div className="wf-name">Open shifts</div>
              {days.map(d => <Cell key={"open" + d} date={d} userId={null} section={section.code} items={mine.filter(s => !s.user_id && s.date === d)} drag={drag} preview={preview} canDrag={dragDepartments} onDown={onDown} onMove={onMove} onUp={onUp} />)}
              {rows.map(p => (
                <div className="wf-person" key={p.id}>
                  <div className="wf-name">{p.name}<span className="m">{p.hours.toFixed(1)}h this week{p.departments.length > 1 ? ` · ${p.departments.map(code => deptName(code, departments)).join(" + ")}` : ""} · {mine.filter(s => s.user_id === p.id).length} here</span></div>
                  {days.map(d => <Cell key={p.id + d} date={d} userId={p.id} section={section.code} items={mine.filter(s => s.user_id === p.id && s.date === d)} drag={drag} preview={preview} canDrag={dragDepartments} onDown={onDown} onMove={onMove} onUp={onUp} />)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {!!dragDepartments.length && (
        <form className="kit-card" onSubmit={async e => { e.preventDefault(); try { await api("/v1/workforce-desk/shifts", { method: "POST", body: JSON.stringify({ ...form, department: department || form.department }) }); setErr(""); await load(); } catch (e2) { setErr(errText(e2)); } }}>
          <h2>Add a draft shift</h2>
          <div className="frow">
            <label>Person<select value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}><option value="">Open shift</option>{people.filter(p => p.departments.includes(department || form.department)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {!department && <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{departments.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>}
            <label>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>From<input value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></label>
            <label>To<input value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></label>
          </div>
          <label>Note<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="kit-add" type="submit">Save draft</button>
        </form>
      )}
      {drag && (
        <div className="wf-ghost" style={{ left: drag.x, top: drag.y }}>
          <strong>{clock(drag.shift.start_time)}–{clock(drag.shift.end_time)}</strong>
          <span>{drag.copy ? "Copy" : "Move"} · {deptName(drag.shift.department, departments)}</span>
          {live && !live.allowed && <span>{live.warnings[0]?.message}</span>}
          {live && live.allowed && live.warnings.length > 0 && <span>{live.warnings.map(w => w.message).join(" ")}</span>}
        </div>
      )}
    </>
  );
}

function Cell({ date, userId, section, items, drag, preview, canDrag, onDown, onMove, onUp }: {
  date: string;
  userId: string | null;
  section: string;
  items: Shift[];
  drag: Drag | null;
  preview: (shift: Shift, userId: string | null, date: string, copy: boolean, section: string) => { allowed: boolean; warnings: { message: string }[] };
  canDrag: string[];
  onDown: (e: React.PointerEvent, shift: Shift) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
}) {
  const hot = !!drag && drag.over?.date === date && drag.over.userId === userId && drag.over.department === section;
  const look = hot && drag ? preview(drag.shift, userId, date, drag.copy, section) : null;
  return (
    <div className={`wf-cell${hot ? " over" : ""}${look && !look.allowed ? " block" : ""}${look?.warnings.length ? " warn" : ""}`} data-drop="1" data-date={date} data-user={userId ?? ""} data-dept={section}>
      {items.map(s => (
        <div key={s.id} className={`wf-shift${s.published ? "" : " draft"}${canDrag.includes(s.department) ? " can" : ""}${drag?.shift.id === s.id ? " dragging" : ""}`}
          onPointerDown={e => onDown(e, s)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <strong>{clock(s.start_time)}–{clock(s.end_time)}</strong>
          <span>{s.published ? (s.position || s.department) : "Draft"}</span>
          {s.notes && <span className="m">{s.notes}</span>}
        </div>
      ))}
    </div>
  );
}
