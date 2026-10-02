"use client";
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { DEPARTMENT_PACK, type WorkflowDraft } from '../../../domains/retreat/readiness';
import { londonDay } from '../../../domains/ops/task-command';
type Task = { id:string; title:string; status:string; department:string; assigned_name:string|null; overdue:boolean; workflow_run_id:string|null; expected_minutes:number|null };
type Data = {
 booking:{ id:string; name:string; version:number; status:string; arrival:string; departure:string; expected_guests:number|null; expected_rooms:number|null; dietary_notes:string|null };
 rooms:{id:string;number:string;status:string}[];tasks:Task[];
 changes:{field:string;before:string|number|null;after:string|number|null}[];
 readiness:{state:string;blockers:number;verified:number;active:number;rooms_inspected:number;rooms_total:number;allocation_known:boolean;missing_departments:string[]};
 runs:{id:string;kind:string;source_version:number;review_note:string;reviewer:string;created_at:string}[];
 has_baseline:boolean;can_create:boolean;preview:WorkflowDraft[];
};
type Covers = { days:{date:string;groups:{id:string;guests:number;meals:string[]}[]}[] };
export default function RetreatReadiness(){
 const {groups,can}=useStore();
 const [id,setId]=useState(''),[data,setData]=useState<Data|null>(null),[drafts,setDrafts]=useState<WorkflowDraft[]>([]),[note,setNote]=useState(''),[people,setPeople]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[covers,setCovers]=useState<Covers|null>(null);
 const request=useRef(0);
 const choices=groups.filter(g=>['CONFIRMED','IN_HOUSE'].includes(g.status)&&g.departure>=londonDay(new Date()));
 useEffect(()=>{const chosen=new URLSearchParams(window.location.search).get('booking');if(chosen)setId(chosen);},[]);
 useEffect(()=>{if(!id&&choices.length)setId(choices[0].id);},[groups,id]);
 const load=async()=>{
  if(!id)return;const version=++request.current;setBusy(true);setError('');setData(null);setCovers(null);setMessage('');setNote('');
  try{const d=await api<Data>(`/v1/retreat-readiness/${id}`);if(version!==request.current)return;setData(d);setDrafts(d.preview);
   if(can('covers.read')){const result=await api<Covers>(`/v1/covers?from=${d.booking.arrival}&to=${d.booking.departure}`);if(version===request.current)setCovers(result);}
  }catch(e){if(version===request.current)setError(e instanceof ApiError?e.problem.detail:'Could not load retreat readiness.');}finally{if(version===request.current)setBusy(false);}
 };
 useEffect(()=>{load();return()=>{request.current++;};},[id]);
 useEffect(()=>{api<{items:{id:string;name:string}[]}>('/v1/ops/tasks/people').then(r=>setPeople(r.items)).catch(()=>{});},[]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(!data)return;setBusy(true);setError('');
  try{const r=await api<{already_created:boolean}>(`/v1/retreat-readiness/${id}/workflows`,{method:'POST',body:JSON.stringify({source_version:data.booking.version,kind:data.changes.length?'change':'readiness',tasks:drafts,review_note:note})});await load();setMessage(r.already_created?'This workflow pack was already created. No duplicate tasks added.':'Eight reviewed department tasks created. Assignments and history are recorded.');}
  catch(e){setError(e instanceof ApiError?e.problem.detail:'Could not create the workflow.');}finally{setBusy(false);}
 };
 return <>
 <div className="task-command-hero"><div><div className="k">The Vedanta Way · Connected retreat operations</div><h1>Retreat readiness</h1><p>One booking, eight department plans. Review source changes before approving new work. The day-before check is separate: <a href="/pre-retreat/">Pre-retreat readiness</a>.</p></div><button className="btn" disabled={busy||!id} onClick={load}>Refresh</button></div>
 <label>Retreat<select className="readiness-select" value={id} onChange={e=>setId(e.target.value)}><option value="">Choose a confirmed retreat</option>{choices.map(g=><option key={g.id} value={g.id}>{g.name} · {g.arrival} → {g.departure}</option>)}</select></label>
 {!choices.length&&<p>No upcoming confirmed retreats are available.</p>}
 {error&&<div className="note" role="alert">{error}</div>}{message&&<div className="note" role="status">{message}</div>}
 {busy&&!data&&<p>Loading the current booking…</p>}
 {data&&<>
 <div className="house-panel" style={{marginTop:16}}><div className="k">Source booking version {data.booking.version} · {data.booking.status}</div><h2>{data.booking.name}</h2><p>{data.booking.arrival} → {data.booking.departure}</p><h3>{data.readiness.state}</h3><p>Recorded operational checks; this does not certify safety or allergen clearance. Room states describe current conditions.</p>
 <div className="task-command-stats"><div><strong>{data.booking.expected_guests??'Unknown'}</strong><span>Expected guests</span></div><div><strong>{data.rooms.length} / {data.booking.expected_rooms??'?'}</strong><span>Rooms allocated / requested</span></div><div><strong>{data.readiness.verified} / {data.readiness.active}</strong><span>Linked tasks verified</span></div><div><strong>{data.readiness.blockers}</strong><span>Linked task blockers</span></div></div>
 {!data.has_baseline&&<p className="note">No reviewed plan yet. Preview and create the first department pack below.</p>}
 {data.readiness.missing_departments.length>0&&<p>Departments without a current pack task: {data.readiness.missing_departments.join(', ')}.</p>}
 <div className="task-command-workspaces"><a href={`/tasks/?booking=${id}`}>Linked tasks</a><a href="/rooms/">Room board</a><a href="/kitchen/">Kitchen planning</a><a href="/hr/">Staff rota</a><a href="/purchasing/">Supplier orders</a><a href="/assets/">Equipment records</a>{can("guest.read")&&<a href="/guest-changes/">Guest detail reviews</a>}</div>
 </div>
 {data.changes.length>0&&<section className="house-panel" style={{marginTop:16}}><div className="k">Change impact review</div><h2>The booking changed since the last reviewed pack</h2><div className="readiness-table"><table><thead><tr><th>Field</th><th>Previously reviewed</th><th>Current booking</th></tr></thead><tbody>{data.changes.map(c=><tr key={c.field}><td>{c.field.replace(/_/g,' ')}</td><td>{c.before??'Not recorded'}</td><td>{c.after??'Not recorded'}</td></tr>)}</tbody></table></div><p>Review rooms, meal services, preparation work, shifts and orders. Creating review tasks does not change the booking, rota or purchases.</p></section>}
 <div className="split readiness-split" style={{marginTop:16}}><section className="house-panel"><div className="k">Kitchen service plan</div><h2>Meal covers for this retreat</h2>
 {covers?<div className="readiness-table"><table><thead><tr><th>Date</th><th>Breakfast</th><th>Lunch</th><th>Dinner</th></tr></thead><tbody>{covers.days.map(day=>{const g=day.groups.find(g=>g.id===id);if(!g)return null;return <tr key={day.date}><td>{day.date}</td>{['breakfast','lunch','dinner'].map(m=><td key={m}>{data.booking.expected_guests==null?'Unknown':g.meals.includes(m)?g.guests:0}</td>)}</tr>;})}</tbody></table></div>:<p>Meal counts require kitchen access. Open Kitchen to review service-specific covers.</p>}
 <p>Booking dietary notes: {data.booking.dietary_notes||'Not recorded — confirm with the organiser.'}</p><p className="m">Counts use the existing meal rules. Guest declarations and recipe/supplier allergens need a kitchen review. Recipe scaling and stock deductions remain in Parslia.</p>
 </section><section className="house-panel"><div className="k">Current room conditions</div><h2>{data.readiness.rooms_inspected} of {data.rooms.length} allocated rooms inspected</h2>{data.rooms.map(r=><div key={r.id} className="ops-line"><b>{r.number}</b><span>{r.status.replace(/_/g,' ')}</span></div>)}{!data.rooms.length&&<p>No rooms allocated yet.</p>}</section></div>
 <section className="house-panel" style={{marginTop:16}}><div className="k">Department work</div><h2>Booking-linked tasks</h2>{DEPARTMENT_PACK.map(dept=>{const tasks=data.tasks.filter(t=>t.department===dept.code);return <div key={dept.code} className="readiness-department"><h3>{dept.code}</h3>{tasks.length?tasks.map(t=><div key={t.id} className="ops-line"><span>{t.title}<small className="m"> · {t.assigned_name||'No individual owner'}</small></span><b>{t.status.replace(/_/g,' ')}{t.overdue?' · overdue':''}</b></div>):<p className="m">No linked tasks.</p>}</div>;})}</section>
 {data.can_create&&<form className="house-panel" style={{marginTop:16}} onSubmit={save}><div className="k">Manager review required</div><h2>{data.changes.length?'Preview change-review pack':'Preview readiness pack'}</h2><p>Review all eight task drafts. Estimates are editable starter values. Deadlines use your device’s local timezone.</p>
 <div className="readiness-drafts">{drafts.map((d,i)=><section key={d.department}><h3>{d.department}</h3><div className="ops-form"><label>Task title<input required maxLength={200} value={d.title} onChange={e=>setDrafts(drafts.map((x,j)=>j===i?{...x,title:e.target.value}:x))}/></label><label>Instructions<textarea rows={4} maxLength={8000} value={d.notes} onChange={e=>setDrafts(drafts.map((x,j)=>j===i?{...x,notes:e.target.value}:x))}/></label><label>Owner<select value={d.assigned_staff_id??''} onChange={e=>setDrafts(drafts.map((x,j)=>j===i?{...x,assigned_staff_id:e.target.value||null}:x))}><option value="">Assign later</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Estimated minutes<input type="number" min={0} max={20000} required value={d.expected_minutes} onChange={e=>setDrafts(drafts.map((x,j)=>j===i?{...x,expected_minutes:Number(e.target.value)}:x))}/></label><label>Deadline<input type="datetime-local" onChange={e=>setDrafts(drafts.map((x,j)=>j===i?{...x,due_at:e.target.value?new Date(e.target.value).toISOString():null}:x))}/></label></div></section>)}</div>
 <div className="ops-form"><label>Review note<textarea required maxLength={800} value={note} onChange={e=>setNote(e.target.value)} placeholder="What was checked, and what requires follow-up?"/></label><button disabled={busy} className="btn primary">{busy?'Saving…':'Create reviewed department tasks'}</button></div></form>}
 <section className="house-panel" style={{marginTop:16}}><h2>Reviewed plan history</h2>{data.runs.map(r=><div className="ops-card" key={r.id}><b>Version {r.source_version} · {r.kind} · {r.reviewer}</b><p>{r.review_note}</p><p className="m">{new Date(r.created_at).toLocaleString('en-GB',{timeZone:'Europe/London'})}</p></div>)}</section>
 </>}
 </>;
}
