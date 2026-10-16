"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function PocketWork() {
  const [mine, setMine] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [thread, setThread] = useState<any>(null);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [leave, setLeave] = useState({ from: "", to: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    setMine(await api("/v1/workforce-desk/mine"));
    setMessages((await api<{ items: any[] }>("/v1/workforce-desk/messages?box=inbox")).items);
  };
  useEffect(() => { load().catch(e => setErr((e as Error).message)); }, []);
  useEffect(() => {
    if (!thread?.id) return;
    const timer = window.setInterval(() => api(`/v1/workforce-desk/messages/${thread.id}`).then(setThread).catch(() => {}), 4000);
    return () => window.clearInterval(timer);
  }, [thread?.id]);
  if (!mine) return <p className="m">{err || "Opening your week…"}</p>;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const avail = (date: string) => (mine.availability ?? []).find((a: any) => a.date === date);
  return (
    <div>
      {err && <div className="note">{err}</div>}
      {(mine.pinned ?? []).map((m: any) => (
        <div className="card" key={m.id}>
          <h2>On the punch clock</h2>
          <p><strong>{m.subject}</strong></p>
          <div dangerouslySetInnerHTML={{ __html: m.body_html }} />
          <button className="btn" onClick={async () => { await api(`/v1/workforce-desk/messages/${m.id}/ack`, { method: "POST", body: "{}" }); load(); }}>I have read this</button>
        </div>
      ))}
      <div className="card">
        <h2>Punch clock</h2>
        <p className="m">{mine.clock ? `Clocked in at ${new Date(mine.clock.clocked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "You are clocked out."}</p>
        <button className="btn" onClick={async () => { try { await api("/v1/workforce-desk/clock", { method: "POST", body: JSON.stringify({ kind: mine.clock ? "OUT" : "IN" }) }); setErr(null); load(); } catch (e) { setErr((e as Error).message); } }}>{mine.clock ? "Clock out" : "Clock in"}</button>
      </div>
      <div className="card">
        <h2>My schedule</h2>
        {(mine.shifts ?? []).map((s: any) => <p key={s.id}><strong>{s.date}</strong> {String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)} · {s.department}{s.notes ? ` · ${s.notes}` : ""}</p>)}
        {(mine.shifts ?? []).length === 0 && <p className="m">No published shifts on your name.</p>}
        <button className="btn ghost" onClick={async () => { const shift = mine.shifts?.[0]; if (!shift) return; await api("/v1/workforce-desk/swaps", { method: "POST", body: JSON.stringify({ shift_id: shift.id, note: "Please can someone cover this?" }) }); setErr("Swap sent to your manager."); }}>Request a swap</button>
      </div>
      <div className="card">
        <h2>Open shifts</h2>
        {(mine.open ?? []).map((s: any) => <p key={s.id}>{s.date} {String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)} · {s.department} <button className="btn ghost" onClick={async () => { await api("/v1/workforce-desk/claims", { method: "POST", body: JSON.stringify({ shift_id: s.id }) }); setErr("Request sent."); }}>Request</button></p>)}
        {(mine.open ?? []).length === 0 && <p className="m">No open shifts.</p>}
      </div>
      <div className="card">
        <h2>Availability</h2>
        {days.map(date => {
          const row = avail(date);
          return (
            <div key={date} className="row">
              <span>{date.slice(5)} {row?.locked ? "· locked" : ""}</span>
              <button className="btn ghost" disabled={row?.locked} onClick={async () => { await api("/v1/workforce-desk/availability", { method: "PUT", body: JSON.stringify({ date, available: row ? !row.available : false, note }) }); load(); }}>{row && row.available === false ? "Unavailable" : "Available"}</button>
            </div>
          );
        })}
        <label>Note<input value={note} onChange={e => setNote(e.target.value)} placeholder="School run, cannot do evenings" /></label>
      </div>
      <div className="card">
        <h2>Leave</h2>
        <p className="m">{mine.leave.allowance_days} days this year · {mine.leave.used_days} used</p>
        <label>From<input type="date" value={leave.from} onChange={e => setLeave({ ...leave, from: e.target.value })} /></label>
        <label>To<input type="date" value={leave.to} onChange={e => setLeave({ ...leave, to: e.target.value })} /></label>
        <label>Note<input value={leave.note} onChange={e => setLeave({ ...leave, note: e.target.value })} /></label>
        <button className="btn" onClick={async () => { try { await api("/v1/workforce-desk/leave", { method: "POST", body: JSON.stringify(leave) }); setErr("Leave request sent."); } catch (e) { setErr((e as Error).message); } }}>Request leave</button>
      </div>
      <div className="card">
        <h2>Payslips</h2>
        {(mine.payslips ?? []).map((p: any) => <p key={p.id}><strong>{p.period_label}</strong> · £{(p.net_pence / 100).toFixed(2)} net<p className="m">{p.summary}</p></p>)}
        {(mine.payslips ?? []).length === 0 && <p className="m">No payslip has been filed for you.</p>}
      </div>
      <div className="card">
        <h2>Messages</h2>
        {messages.map(m => <button key={m.id} className="btn ghost" onClick={async () => setThread(await api(`/v1/workforce-desk/messages/${m.id}`))}>{m.subject}{m.require_reply && !m.acknowledged_at ? " · reply needed" : ""}</button>)}
        {thread && (
          <div>
            <p><strong>{thread.subject}</strong></p>
            {(thread.thread ?? []).map((m: any) => <p key={m.id}><b>{m.author}</b> <span dangerouslySetInnerHTML={{ __html: m.body_html }} /></p>)}
            {thread.can_see_receipts && <p className="m">{(thread.receipts ?? []).map((r: any) => `${r.name}: ${r.read_at ? "read" : "not yet"}`).join(", ")}</p>}
            <label>Reply<textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} /></label>
            <button className="btn" onClick={async () => { await api("/v1/workforce-desk/messages", { method: "POST", body: JSON.stringify({ parent_id: thread.id, body_html: `<p>${reply}</p>` }) }); setReply(""); setThread(await api(`/v1/workforce-desk/messages/${thread.id}`)); }}>Send</button>
          </div>
        )}
        <button className="btn ghost" onClick={async () => {
          const reg = await navigator.serviceWorker?.register("/pocket/sw.js").catch(() => null);
          const ready = await navigator.serviceWorker?.ready.catch(() => null);
          const sub = ready && Notification.permission !== "denied" ? await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: undefined as unknown as BufferSource }).catch(() => null) : null;
          if (!sub) { setErr(reg ? "Phone alerts need a push key from the house. The request is ready." : "This phone cannot take push alerts yet."); return; }
          const json = sub.toJSON();
          await api("/v1/workforce-desk/push", { method: "POST", body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }) });
          setErr("Phone alerts are on.");
        }}>Turn on phone alerts</button>
      </div>
    </div>
  );
}
