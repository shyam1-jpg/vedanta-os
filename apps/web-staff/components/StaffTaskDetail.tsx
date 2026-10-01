"use client";
import { useEffect,useRef,useState } from 'react';
import { api } from '../lib/api';
type Detail={id:string;notes:string;status:string;sop_slug:string;event_label:string;blocked_reason:string;next:{status:string;label:string}[];events:{id:string;kind:string;body:string;actor_name:string|null;created_at:string}[]};
type Manual={title:string;body:string;status:string;steps:{title:string;look:string;act:string}[]};
export default function StaffTaskDetail({id,onUpdated}:{id:string;onUpdated:()=>Promise<void>}){
 const [detail,setDetail]=useState<Detail|null>(null),[manual,setManual]=useState<Manual|null>(null),[error,setError]=useState(''),[comment,setComment]=useState(''),[reason,setReason]=useState(''),[blocking,setBlocking]=useState(false),[busy,setBusy]=useState(false);const request=useRef(0);
 const load=async()=>{const v=++request.current;const d=await api<Detail>(`/v1/ops/tasks/${id}`);if(v!==request.current)return;setDetail(d);setManual(null);if(d.sop_slug){try{const m=await api<Manual>(`/v1/manuals/${encodeURIComponent(d.sop_slug)}`);if(v===request.current&&m.status==='live')setManual(m);}catch{}}};
 useEffect(()=>{load().catch(e=>setError(e.message));return()=>{request.current++;};},[id]);
 const run=async(path:string,payload:object)=>{setBusy(true);setError('');try{await api(`/v1/ops/tasks/${id}/${path}`,{method:'POST',body:JSON.stringify(payload)});await load();await onUpdated();return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}};
 return <section className="pocket-task-detail">{error&&<p className="note" role="alert">{error}</p>}{detail&&<>
 {detail.event_label&&<p className="m">Retreat: {detail.event_label}</p>}<p style={{whiteSpace:'pre-wrap'}}>{detail.notes||'No additional instructions.'}</p>
 {detail.status==='blocked'&&<p className="note">Blocker: {detail.blocked_reason||'No reason recorded.'}</p>}
 {manual&&<details><summary>Approved instructions: {manual.title}</summary><p style={{whiteSpace:'pre-wrap'}}>{manual.body}</p>{manual.steps.map((s,i)=><div key={i}><h3>{i+1}. {s.title}</h3><p>{s.look}</p><p>{s.act}</p></div>)}</details>}
 {detail.sop_slug&&!manual&&<p className="m">Referenced instructions are unavailable or withdrawn. Ask the department lead.</p>}
 <div className="tabs">{detail.next.map(a=><button key={a.status} className="btn" disabled={busy} onClick={()=>a.status==='blocked'?setBlocking(true):run('status',{status:a.status})}>{a.label}</button>)}</div>
 {blocking&&<form onSubmit={async e=>{e.preventDefault();if(await run('status',{status:'blocked',blocked_reason:reason}))setBlocking(false);}}><label>What is preventing completion?<textarea required maxLength={400} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy} className="btn">Record blocker</button><button type="button" className="btn" onClick={()=>setBlocking(false)}>Keep working</button></form>}
 <form onSubmit={async e=>{e.preventDefault();if(await run('comment',{body:comment}))setComment('');}}><label>Progress or handover note<textarea required maxLength={8000} rows={2} value={comment} onChange={e=>setComment(e.target.value)}/></label><button className="btn" disabled={busy}>Add note</button></form>
 <label>Photo evidence<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>450000){setError('Use a photo smaller than 450 KB.');return;}try{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read photo.'));reader.readAsDataURL(file);});await run('attachment',{kind:'photo',data});}catch(e){setError((e as Error).message);}e.target.value='';}}/></label>
 <details><summary>Task history · {detail.events.length} entries</summary>{detail.events.map(ev=><div className="card" key={ev.id}><p className="m">{ev.kind} · {ev.actor_name} · {new Date(ev.created_at).toLocaleString('en-GB',{timeZone:'Europe/London'})}</p>{ev.body.startsWith('data:image/')?<img src={ev.body} alt="Task completion evidence" style={{maxWidth:'100%'}}/>:<p style={{whiteSpace:'pre-wrap'}}>{ev.body}</p>}</div>)}</details>
 </>}</section>;
}
