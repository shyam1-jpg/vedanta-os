"use client";
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
type Change = { id: string; guest_name: string; arrival: string; departure: string; changes: { field: string; before: string | null; after: string | null }[] };
export default function GuestNeedsReviews() {
  const { can } = useStore();
  const [items, setItems] = useState<Change[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api<{ items: Change[] }>('/v1/guest-needs-changes').then(r => setItems(r.items)).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  return <>
    <h1>Guest detail changes</h1>
    <p>Review guest updates with the relevant department. Recording a review does not certify an allergy request as safe.</p>
    {error && <p className="note" role="alert">{error}</p>}
    {!items.length && <p>No pending changes.</p>}
    {items.map(change => <form className="house-panel" style={{ marginTop: 16 }} key={change.id} onSubmit={async event => {
      event.preventDefault();
      const note = String(new FormData(event.currentTarget).get('note'));
      setBusy(true);
      try {
        await api(`/v1/guest-needs-changes/${change.id}/review`, { method: 'POST', body: JSON.stringify({ review_note: note }) });
        await load();
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <h2>{change.guest_name}</h2>
      <p>{change.arrival} → {change.departure}</p>
      {change.changes.map(delta => <div className="ops-card" key={delta.field}>
        <b>{delta.field.replace(/_/g, ' ')}</b>
        <p>Before: {delta.before || 'Not provided'}</p>
        <p>Now: {delta.after || 'Not provided'}</p>
      </div>)}
      {can('guest.write') && <div className="ops-form">
        <label>Review and follow-up<textarea name="note" required maxLength={800} /></label>
        <button className="btn primary" disabled={busy}>Record review</button>
      </div>}
    </form>)}
  </>;
}
