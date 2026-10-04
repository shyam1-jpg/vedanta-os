"use client";
import { useEffect, useState } from 'react';
type State = { can_confirm: boolean; can_arrive: boolean; reason: string; today: string; details_version:string;details:{arrival:string;departure:string;people:number;arrival_time:string;dietary:string;accessibility:string;travel:string};details_confirmed_at: string | null; arrived_at: string | null; reception_seen_at: string | null };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export default function ArrivalCheckIn({id,detailsVersion,request}:{id:string;detailsVersion:string;request:Api}) {
  const [state,setState] = useState<State|null>(null),[error,setError] = useState(''),[busy,setBusy] = useState(false),[checked,setChecked] = useState(false);
  useEffect(()=>{let active=true;setState(null);setChecked(false);request<State>(`/guest/enquiries/${id}/arrival`).then(s=>{if(active){setState(s);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,detailsVersion,request]);
  const refresh=async()=>{setBusy(true);setError('');setChecked(false);try{setState(await request<State>(`/guest/enquiries/${id}/arrival`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const action=async(action:string)=>{setBusy(true);setError('');try{setState(await request<State>(`/guest/enquiries/${id}/arrival`,{method:'POST',body:JSON.stringify({action,confirmed:true,details_version:state?.details_version})}));setChecked(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="guest-checkin" aria-label="Pre-arrival check-in">
    <div className="section-kicker">A calmer arrival</div><h3>Pre-arrival check-in</h3>
    <p className="m">Review your saved arrival time, dietary and accessibility details below. This does not replace reception check-in or confirm room readiness.</p>
    {error&&<p role="alert" className="note">{error}</p>}
    {!state&&!error&&<p role="status">Opening your arrival details…</p>}
    {state&&<>
      <details className="arrival-saved-details" open={!state.details_confirmed_at&&state.can_confirm}><summary>Your saved stay details</summary><dl>
        <dt>Stay</dt><dd>{state.details.arrival} → {state.details.departure} · {state.details.people} guests</dd>
        <dt>Expected arrival</dt><dd>{state.details.arrival_time||'Not provided'}</dd><dt>Diet & allergies</dt><dd>{state.details.dietary||'No details provided'}</dd>
        <dt>Accessibility</dt><dd>{state.details.accessibility||'No details provided'}</dd><dt>Travel</dt><dd>{state.details.travel||'No details provided'}</dd>
      </dl><p className="m">Need to change anything? Use “Update diet, access & arrival” below, save, then confirm. Dietary requests still require kitchen review.</p></details>
      <ol className="arrival-steps">
        <li className={state.details_confirmed_at?'complete':''}><b>01 · Review your details</b><span>{state.details_confirmed_at?'Confirmed by you':'Review and confirm your saved information'}</span></li>
        <li className={state.arrived_at?'complete':''}><b>02 · Arrive at the house</b><span>{state.arrived_at?'Arrival notification saved':'Tell reception when you reach the house'}</span></li>
        <li className={state.reception_seen_at?'complete':''}><b>03 · Meet reception</b><span>{state.reception_seen_at?'Reception has acknowledged your arrival':'Staff confirm your room and hand over keys'}</span></li>
      </ol>
      <p role="status">{state.arrived_at?(state.reception_seen_at?'Reception has seen your notification. Please meet the team for check-in and keys.':'Your arrival is on the reception board. Please come to reception; keys are not released online.'):state.reason}</p>
      {state.can_confirm&&!state.details_confirmed_at&&<><label className="arrival-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>I have reviewed my saved stay details and they are up to date.</label><button type="button" className="btn" disabled={busy||!checked} onClick={()=>action('confirm_details')}>{busy?'Saving…':'Confirm my details'}</button></>}
      {state.can_arrive&&!state.arrived_at&&<button type="button" className="btn" disabled={busy} onClick={()=>action('arrive')}>{busy?'Sending…':"I’m at the house — notify reception"}</button>}
    </>}
    <button type="button" className="btn sec" disabled={busy} onClick={refresh}>Refresh arrival status</button>
  </section>;
}
