"use client";
import { useCallback, useEffect, useState } from 'react';
import './MorningDashboard.css';
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Handover = {id:string;body:string;department_label:string;shift_label:string;author_name:string|null;acknowledged:boolean};
type Log = {date:string;handover:Handover[];progress:{done:number;total:number};checklists:{id:string;title:string;due_time:string|null;department_label:string;done:boolean}[]};
type Task = {id:string;title:string;assigned_name:string|null;assigned_label:string;due_at:string|null;status_label:string;status:string;overdue:boolean;room_label:string;department_label:string};
type Tasks = {items:Task[];matched_total:number;counts:{open:number;overdue:number};can_assign:boolean};
type Morning = {date:string;can_acknowledge:boolean;arrivals:{id:string;name:string;expected_guests:number|null;arrival_time:string|null}[];departures:{id:string;name:string;expected_guests:number|null}[];
  rooms:{status:string;count:number}[];guests:{id:string;name:string;people:number;arrival_time_note:string|null;details_confirmed_at:string|null;arrived_at:string|null;reception_seen_at:string|null;rooms:{number:string;status:string}[]}[]};
const label=(v:string)=>v.replaceAll('_',' ').toLowerCase();
const time=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
export default function MorningDashboard({request,canViewArrivals,onTasks}:{request:Api;canViewArrivals:boolean;onTasks:()=>void}){
  const [log,setLog]=useState<Log|null>(null),[tasks,setTasks]=useState<Tasks|null>(null),[morning,setMorning]=useState<Morning|null>(null);
  const [errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(''),[filter,setFilter]=useState('priority'),[note,setNote]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    setBusy(true);setErrors([]);
    const results=await Promise.allSettled([request<Log>('/v1/ops/board'),request<Tasks>('/v1/ops/tasks?status=open&limit=100'),canViewArrivals?request<Morning>('/v1/ops/morning'):Promise.resolve(null)]);
    setLog(results[0].status==='fulfilled'?results[0].value:null);setTasks(results[1].status==='fulfilled'?results[1].value:null);setMorning(results[2].status==='fulfilled'?results[2].value:null);
    setErrors(results.flatMap((r,i)=>r.status==='rejected'?[`${['Handovers','Tasks','Arrivals'][i]} could not be loaded: ${r.reason?.message??'Please retry.'}`]:[]));
    setLoaded(new Date().toISOString());setBusy(false);
  },[request,canViewArrivals]);
  useEffect(()=>{void load();},[load]);
  const run=async(path:string,payload:object,message:string)=>{
    setBusy(true);setNotice('');try{await request(path,{method:'POST',body:JSON.stringify(payload)});setNotice(message);await load();return true;}catch(e){setErrors([(e as Error).message]);return false;}finally{setBusy(false);}
  };
  const shown=(tasks?.items??[]).filter(t=>filter==='all'||t.overdue||t.status==='blocked'||!t.assigned_name&&!t.assigned_label);
  const unread=log?.handover.filter(h=>!h.acknowledged)??[];
  const waiting=morning?.guests.filter(g=>g.arrived_at&&!g.reception_seen_at)??[];
  return <section className="morning-board" aria-label="Morning staff dashboard">
    <div className="morning-heading"><div><span className="morning-eyebrow">The house, together</span><h2>Ready for the day.</h2><p>Arrivals, people and priorities — one shared morning view.</p></div><button type="button" disabled={busy} onClick={load}>{busy?'Refreshing…':'Refresh board'}</button></div>
    <p className="morning-caption">{morning?.date??log?.date??'Today'} · House time: Europe/London{loaded?` · Last refresh ${time(loaded)}`:''}. Refresh for the latest updates.</p>
    {errors.map(e=><p className="morning-warning" role="alert" key={e}>{e}</p>)}{notice&&<p className="morning-notice" role="status">{notice}</p>}
    <div className="morning-metrics">
      <div><b>{morning?morning.arrivals.length:'—'}</b><span>Arriving bookings</span></div><div><b>{morning?waiting.length:'—'}</b><span>Arrivals awaiting reception</span></div><div><b>{tasks?tasks.counts.overdue:'—'}</b><span>Overdue house tasks</span></div><div><b>{log?`${log.progress.done}/${log.progress.total}`:'—'}</b><span>Daily checks complete</span></div>
    </div>
    <div className="morning-grid">
      <section className="morning-panel"><div className="morning-panel-title"><h3>Reception & arrivals</h3><span>01</span></div>
        {!canViewArrivals&&<p>Guest arrival information is restricted to authorised reception roles. Your handovers and tasks are below.</p>}
        {morning&&<><p className="morning-caption">{morning.arrivals.length} arriving bookings · {morning.departures.length} departing bookings. Guest notifications are shown separately.</p>
          {morning.guests.length===0&&<p>No guest arrival registrations to display today.</p>}
          {morning.guests.map(g=><article className="morning-item" key={g.id}>
            <span className={`morning-badge ${g.arrived_at&&!g.reception_seen_at?'attention':''}`}>{g.reception_seen_at?'Reception acknowledged':g.arrived_at?'Guest reports arrival':g.details_confirmed_at?'Details confirmed':'Pre-arrival details pending'}</span>
            <h4>{g.name} <small>· {g.people} guests</small></h4>{g.arrival_time_note&&<p>Expected arrival: {g.arrival_time_note}</p>}
            <p className="morning-caption">{g.rooms.length?g.rooms.map(r=>`${r.number}: ${label(r.status)}`).join(' · '):'No rooms allocated for today.'}</p>
            {g.arrived_at&&!g.reception_seen_at&&morning.can_acknowledge&&<button disabled={busy} onClick={()=>run(`/v1/ops/arrivals/${g.id}/acknowledge`,{},'Arrival acknowledged. Complete reception checks and room handover separately.')}>Acknowledge arrival</button>}
          </article>)}
          <details><summary>Today’s arriving & departing bookings</summary>{morning.arrivals.map(g=><p key={`a${g.id}`}>Arrival · {g.name} · {g.expected_guests??'Unspecified'} guests{g.arrival_time?` · ${g.arrival_time}`:''}</p>)}{morning.departures.map(g=><p key={`d${g.id}`}>Departure · {g.name} · {g.expected_guests??'Unspecified'} guests</p>)}{!morning.arrivals.length&&!morning.departures.length&&<p>No confirmed arrivals or departures.</p>}</details>
          <p className="morning-warning">An arrival notification is not room check-in. Verify the guest, room readiness and any outstanding reception requirements before handing over keys.</p>
          <div className="morning-room-counts">{morning.rooms.map(r=><span key={r.status}><b>{r.count}</b> {label(r.status)}</span>)}</div>
        </>}
      </section>
      <section className="morning-panel"><div className="morning-panel-title"><h3>Team priorities</h3><span>02</span></div>
        <div className="morning-controls"><button aria-pressed={filter==='priority'} onClick={()=>setFilter('priority')}>Needs attention</button><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All open tasks</button></div>
        {tasks&&<><p className="morning-caption">Showing {shown.length} of {tasks.matched_total} open tasks. Attention includes overdue, blocked and unassigned work.</p>{shown.length===0&&<p>No tasks match this view.</p>}
          {shown.slice(0,8).map(t=><article className="morning-item" key={t.id}><span className={`morning-badge ${t.overdue||t.status==='blocked'?'attention':''}`}>{t.overdue?'Overdue · ':''}{t.status_label}</span><h4>{t.title}</h4><p>{t.assigned_name||t.assigned_label||'No owner assigned'} · {t.department_label}{t.room_label?` · Room ${t.room_label}`:''}</p><p className="morning-caption">{t.due_at?`Due ${time(t.due_at)}`:'No deadline set'}</p></article>)}
          {shown.length>8&&<p className="morning-caption">First 8 matching tasks shown. Open the full task board for the rest.</p>}
          <button onClick={onTasks}>{tasks.can_assign?'Open tasks & staff assignments':'Open my task workspace'}</button></>}
      </section>
      <section className="morning-panel"><div className="morning-panel-title"><h3>Shift handover</h3><span>03</span></div>
        {log&&<><p className="morning-caption">{unread.length} unread notes in the recent handover feed.</p>{log.handover.length===0&&<p>No handover notes in the recent feed.</p>}{log.handover.slice(0,6).map(h=><article className="morning-item" key={h.id}><span className="morning-badge">{h.department_label} · {h.shift_label}</span><p style={{whiteSpace:'pre-wrap'}}>{h.body}</p><p className="morning-caption">{h.author_name??'House team'}</p>{h.acknowledged?<span className="morning-caption">Read by you</span>:<button disabled={busy} onClick={()=>run(`/v1/ops/handover/${h.id}/acknowledge`,{},'Handover marked as read.')}>Mark as read</button>}</article>)}
          <form onSubmit={async e=>{e.preventDefault();if(await run('/v1/ops/handover',{department:'HOUSE',shift:'am',body:note},'Morning handover saved.'))setNote('');}}><label>Morning handover note<textarea required maxLength={2000} rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="What does the next shift need to know?"/></label><button disabled={busy||!note.trim()}>Save morning handover</button></form></>}
      </section>
      <section className="morning-panel"><div className="morning-panel-title"><h3>Daily checks</h3><span>04</span></div>{log&&<>{log.checklists.length===0&&<p>No daily checks configured.</p>}{log.checklists.map(c=><label className="morning-check" key={c.id}><input type="checkbox" checked={c.done} disabled={busy} onChange={e=>run(`/v1/ops/checklists/${c.id}/tick`,{done:e.target.checked},'Daily check updated.')}/><span><b>{c.title}</b><small>{c.department_label}{c.due_time?` · ${c.due_time}`:''}</small></span></label>)}</>}</section>
    </div>
  </section>;
}
