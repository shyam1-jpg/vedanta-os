"use client";
import { useEffect, useRef, useState } from "react";
import { londonDate } from "../../../domains/ops/timesheet.ts";
import "./SmartWorkforce.css";
import { api, ApiError } from "@/lib/api";
import { assessDrop, dateInRange, ROTA_DEPARTMENTS } from "../../../domains/ops/workforce.ts";

type Shift = {
  id: string;
  user_id: string | null;
  name?: string | null;
  department: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  break_minutes: number;
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
function weekRangeStart(day:string) { const x=new Date(day+"T12:00:00Z");x.setUTCDate(x.getUTCDate()-((x.getUTCDay()+6)%7));return iso(x); }
function clock(t: string) { return String(t).slice(0, 5); }
function deptName(code: string, list: { code: string; name: string }[]) {
  return list.find(d => d.code === code)?.name ?? code;
}

export default function ScheduleBoard() {
  const [week, setWeek] = useState(() => weekRangeStart(londonDate(new Date())));
  const [department, setDepartment] = useState("KITCHEN");
  const [mode, setMode] = useState<"week" | "day">("week");
  const [day, setDay] = useState(londonDate(new Date()));
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<{ preview_token: string; assignments: {shiftId:string;userId:string;name:string;date:string;start:string;end:string;department:string;weekHours:number;reason:string}[]; skipped:{shiftId:string;date:string;department:string;reasons:string[]}[] } | null>(null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [placement, setPlacement] = useState({ user_id:"", date:"", copy:false });
  const loadSeq=useRef(0);
  const [warn, setWarn] = useState("");
  const [undo, setUndo] = useState<Undo[]>([]);
  const [copyOn, setCopyOn] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [form, setForm] = useState({ user_id: "", date: londonDate(new Date()), start_time: "09:00", end_time: "17:00", notes: "", department: "KITCHEN", break_minutes: 30, position: "" });
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ shift: Shift; x: number; y: number; pointerId: number; type: string; copy: boolean; armed: boolean } | null>(null);
  const timer = useRef(0);
  const copyRef = useRef(false);
  copyRef.current = copyOn;

  const from = mode === "day" ? day : week;
  const to = mode === "day" ? day : addDays(week, 6);
  const load = async () => {
    const seq=++loadSeq.current; setLoading(true); setErr("");
    try { const result=await api<any>(`/v1/workforce-desk/schedule?from=${from}&to=${to}${department ? `&department=${department}` : ""}`); if(seq===loadSeq.current)setData(result); }
    catch(e) { if(seq===loadSeq.current){setData(null);setErr(errText(e));} }
    finally { if(seq===loadSeq.current)setLoading(false); }
  };
  useEffect(() => { setPlan(null);setData(null);load();return()=>{loadSeq.current++}; }, [from, to, department]);
  async function smartPreview() { setBusy(true);setErr("");setPlan(null);try {const r=await api<any>("/v1/workforce-desk/shifts/suggest",{method:"POST",body:JSON.stringify({from,to,department,preview:true})});setPlan(r);}catch(e){setErr(errText(e));}finally{setBusy(false);} }
  async function applyPreview() { if(!plan)return;setBusy(true);setErr("");try {const r=await api<any>("/v1/workforce-desk/shifts/suggest",{method:"POST",body:JSON.stringify({from,to,department,preview_token:plan.preview_token})});setPlan(null);setWarn(`Assigned ${r.suggested} draft shifts. ${r.skipped_count} left open. Review the rota, then publish separately.`);await load();}catch(e){setErr(errText(e));setPlan(null);}finally{setBusy(false);} }
  async function savePlacement() { if(!editing)return;setBusy(true);try{const r=await api<any>(`/v1/workforce-desk/shifts/${editing.id}/place`,{method:"POST",body:JSON.stringify(placement)});if(r.undo)setUndo(x=>[r.undo,...x].slice(0,12));setEditing(null);setPlan(null);setWarn((r.warnings??[]).map((w:any)=>w.message).join(" "));await load();}catch(e){setErr(errText(e));}finally{setBusy(false);} }
  const editShift=(shift:Shift)=>{setEditing(shift);setPlacement({user_id:shift.user_id??"",date:shift.date,copy:false});};


  const days = mode === "day" ? [day] : Array.from({ length: 7 }, (_, i) => addDays(week, i));
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
    if (busy || loading || !dragDepartments.includes(shift.department)) return;
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
      setPlan(null);await load();
    } catch (e2) { setWarn(""); setErr(errText(e2)); }
  }

  const live = drag?.over ? preview(drag.shift, drag.over.userId, drag.over.date, drag.copy, drag.over.department) : null;

  return (
    <div className="smart-workforce">
      <section className="sw-hero"><div><span className="sw-kicker">WORKFORCE · SMART SCHEDULE</span><h2>A clearer week. A fairer rota.</h2><p>Preview open-shift assignments with cross-department clash checks, leave, availability and balanced weekly hours.</p></div><span className="sw-release">DRAFT → REVIEW → PUBLISH</span></section>
      <div className="sw-toolbar no-print"><label>{mode === "week" ? "Week of" : "Day"}<input type="date" value={from} disabled={busy} onChange={e=>{if(e.target.value){if(mode==="week")setWeek(weekRangeStart(e.target.value));else setDay(e.target.value);}}} /></label><input type="search" placeholder="Find a staff member…" aria-label="Find a staff member" value={search} onChange={e=>setSearch(e.target.value)} /><button className="kit-outline" onClick={()=>{setDay(londonDate(new Date()));setWeek(weekRangeStart(londonDate(new Date())));}} disabled={busy}>Today / this week</button><button className="kit-outline" onClick={()=>window.print()}>Print rota</button></div>
      <div className="sw-stats"><article><span>PLANNED HOURS · VIEW</span><strong>{shifts.reduce((n,s)=>n+s.hours,0).toFixed(1)}h</strong></article><article><span>OPEN SHIFTS</span><strong>{shifts.filter(s=>!s.user_id).length}</strong></article><article><span>DRAFT SHIFTS</span><strong>{shifts.filter(s=>!s.published).length}</strong></article><article><span>STAFF OVER 40H · WEEK</span><strong>{people.filter(p=>p.hours>40).length}</strong></article></div>
      <div className="wf-switch" role="tablist" aria-label="Department rota">
        <button type="button" className={department === "" ? "on" : ""} onClick={() => setDepartment("")}>All departments</button>
        {departments.map(d => <button type="button" key={d.code} className={department === d.code ? "on" : ""} onClick={() => setDepartment(d.code)}>{d.name}</button>)}
      </div>
      <p className="m">Hours add across departments. A named shift position requires a matching staff HR designation. Smart preview uses a 48-hour weekly planning cap and an 11-hour gap between shifts; it leaves conflicts open. Manual placements still check clashes and the weekly cap. Drag a shift, or use its Move / copy button. All suggestions stay draft until a manager publishes.</p>
      {err && <div className="note" role="alert">{err}</div>}
      {loading && <p role="status">Loading the rota…</p>}
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
        {data?.can_publish && <button type="button" className="kit-add" disabled={busy||loading} onClick={async () => { setBusy(true);try{const r=await api<any>("/v1/workforce-desk/shifts/publish", { method: "POST", body: JSON.stringify({ from, to, department }) }); setWarn(`Published ${r.published} draft shifts.`);setPlan(null); await load();}catch(e){setErr(errText(e));}finally{setBusy(false);} }}>{department ? `Publish ${deptName(department, departments)}` : "Publish all departments"}</button>}
        {!!dragDepartments.length && <button type="button" className="kit-add" disabled={busy||loading||!data?.can_publish} onClick={smartPreview}>{busy?"Working…":"Preview smart rota"}</button>}
      </div>
      {plan && <section className="kit-card sw-plan" aria-label="Rota suggestion preview"><div className="kit-pagehead"><h3>Review suggestions before applying</h3><button type="button" className="kit-outline" disabled={busy} onClick={()=>setPlan(null)}>Close preview</button></div><p>{plan.assignments.length} assignments proposed · {plan.skipped.length} shifts left open. Nothing has changed yet.</p><div className="sw-plan-list">{plan.assignments.map(p=><article key={p.shiftId}><strong>{p.name}</strong><span>{p.date} · {clock(p.start)}–{clock(p.end)} · {deptName(p.department,departments)}</span><small>{p.weekHours.toFixed(1)}h planned in that week after this assignment. {p.reason}</small></article>)}{plan.skipped.map(p=><article key={p.shiftId} className="sw-plan-skipped"><strong>Left open · {p.date} · {deptName(p.department,departments)}</strong><small>{p.reasons.map(r=>({overlap:"Overlapping shift",rest:"Less than 11 hours between shifts",hours:"Weekly planning cap",availability:"Unavailable",leave:"Leave requested or approved",no_department_staff:"No active department staff",no_matching_position:"No matching staff designation for this shift position"}[r]??r)).join(" · ")}</small></article>)}</div><button type="button" className="kit-add" disabled={busy||!plan.assignments.length} onClick={applyPreview}>{busy?"Applying…":"Apply these draft assignments"}</button><p className="m">If shifts or availability change, a new preview is required. Apply does not publish.</p></section>}
      {editing && <section className="kit-card no-print" aria-label="Move or copy shift"><h3>Move or copy · {clock(editing.start_time)}–{clock(editing.end_time)}</h3><div className="sw-toolbar"><label>Person<select value={placement.user_id} onChange={e=>setPlacement({...placement,user_id:e.target.value})}><option value="">Open shift</option>{people.filter(p=>p.departments.includes(editing.department)).map(p=><option value={p.id} key={p.id}>{p.name} · {p.hours.toFixed(1)}h</option>)}</select></label><label>Date<input type="date" required value={placement.date} onChange={e=>setPlacement({...placement,date:e.target.value})} /></label><label className="sw-inline"><input type="checkbox" checked={placement.copy} onChange={e=>setPlacement({...placement,copy:e.target.checked})} />Create a copy</label><button type="button" className="kit-add" disabled={busy||!placement.date} onClick={savePlacement}>Save as draft</button><button type="button" className="kit-outline" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div></section>}
      {sections.map(section => {
        const rows = people.filter(p => p.departments.includes(section.code) && p.name.toLowerCase().includes(search.toLowerCase()));
        const mine = shifts.filter(s => s.department === section.code);
        return (
          <section key={section.code} className="wf-rota">
            {!department && <h2>{section.name}</h2>}
            <div className="kit-sheet wf-grid" style={{ gridTemplateColumns: `180px repeat(${days.length}, minmax(96px, 1fr))` }}>
              <div className="wf-h">Person</div>
              {days.map(d => <div key={d} className="wf-h">{d.slice(5)} <span className="m">{mine.filter(s => s.date === d).reduce((n, s) => n + s.hours, 0).toFixed(1)}h</span></div>)}
              <div className="wf-name">Open shifts</div>
              {days.map(d => <Cell key={"open" + d} date={d} userId={null} section={section.code} items={mine.filter(s => !s.user_id && s.date === d)} drag={drag} preview={preview} canDrag={dragDepartments} onDown={onDown} onMove={onMove} onUp={onUp} onEdit={editShift} onCancel={()=>{window.clearTimeout(timer.current);pending.current=null;putDrag(null);}} />)}
              {rows.map(p => (
                <div className="wf-person" key={p.id}>
                  <div className="wf-name">{p.name}<span className={p.hours>40?"m sw-variance":"m"}>{p.hours.toFixed(1)}h this week{p.departments.length > 1 ? ` · ${p.departments.map(code => deptName(code, departments)).join(" + ")}` : ""} · {mine.filter(s => s.user_id === p.id).length} here</span></div>
                  {days.map(d => <Cell key={p.id + d} date={d} userId={p.id} section={section.code} items={mine.filter(s => s.user_id === p.id && s.date === d)} drag={drag} preview={preview} canDrag={dragDepartments} onDown={onDown} onMove={onMove} onUp={onUp} onEdit={editShift} onCancel={()=>{window.clearTimeout(timer.current);pending.current=null;putDrag(null);}} />)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {!!dragDepartments.length && (
        <form className="kit-card" onSubmit={async e => { e.preventDefault(); if(busy)return;setBusy(true);try { await api("/v1/workforce-desk/shifts", { method: "POST", body: JSON.stringify({ ...form, department: department || form.department }) }); setErr("");setPlan(null); await load(); } catch (e2) { setErr(errText(e2)); } finally {setBusy(false);} }}>
          <h2>Add a draft shift</h2>
          <div className="frow">
            <label>Person<select value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}><option value="">Open shift</option>{people.filter(p => p.departments.includes(department || form.department)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {!department && <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{departments.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>}
            <label>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>From<input required type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></label>
            <label>To<input required type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></label>
          </div>
          <div className="frow"><label>Unpaid break (minutes)<input type="number" min="0" max="720" step="1" required value={form.break_minutes} onChange={e=>setForm({...form,break_minutes:Number(e.target.value)})} /></label><label>Role / position<input value={form.position} onChange={e=>setForm({...form,position:e.target.value})} placeholder="Chef, kitchen assistant, KP…" /></label></div>
          <label>Note<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="kit-add" type="submit" disabled={busy||loading}>Save draft</button>
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
    </div>
  );
}

function Cell({ date, userId, section, items, drag, preview, canDrag, onDown, onMove, onUp, onEdit, onCancel }: {
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
  onEdit: (shift:Shift) => void;
  onCancel: () => void;
}) {
  const hot = !!drag && drag.over?.date === date && drag.over.userId === userId && drag.over.department === section;
  const look = hot && drag ? preview(drag.shift, userId, date, drag.copy, section) : null;
  return (
    <div className={`wf-cell${hot ? " over" : ""}${look && !look.allowed ? " block" : ""}${look?.warnings.length ? " warn" : ""}`} data-drop="1" data-date={date} data-user={userId ?? ""} data-dept={section}>
      {items.map(s => (
        <div key={s.id} className={`wf-shift${s.published ? "" : " draft"}${canDrag.includes(s.department) ? " can" : ""}${drag?.shift.id === s.id ? " dragging" : ""}`}
          onPointerDown={e => onDown(e, s)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
          <strong>{clock(s.start_time)}–{clock(s.end_time)}</strong>
          <span>{s.published ? (s.position || s.department) : "Draft"}</span>
          <span className="m">{s.hours.toFixed(1)}h net · {s.break_minutes}m break</span>
          {s.notes && <span className="m">{s.notes}</span>}
          {canDrag.includes(s.department)&&<button type="button" className="sw-move no-print" onPointerDown={e=>e.stopPropagation()} onClick={()=>onEdit(s)} aria-label={`Move or copy ${clock(s.start_time)} shift on ${date}`}>Move / copy</button>}
        </div>
      ))}
    </div>
  );
}
