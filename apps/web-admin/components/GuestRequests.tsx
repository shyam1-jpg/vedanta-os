"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Item = { id: string; guest_name: string | null; room_label: string | null; department: string; department_label: string; request_text: string; status: string };
const DEPTS = ["", "FRONT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "NIGHT", "MGMT"];

export default function GuestRequests() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("open");
  const [department, setDepartment] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ guest_name: "", room_label: "", department: "FRONT", request_text: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (department) p.set("department", department);
    if (q) p.set("q", q);
    api<{ items: Item[] }>(`/v1/ops/guest-requests?${p}`).then(r => setItems(r.items)).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open requests"));
  };
  useEffect(() => { load(); }, [status, department, q]);
  return (
    <>
      <div className="topbar"><div><h1>Guest requests</h1><p>Asks from the house, separate from complaints. Open, in progress, or done.</p></div></div>
      {err && <div className="note">{err}</div>}
      <div className="seg" style={{ marginBottom: 12 }}>
        {["", "open", "doing", "done"].map(s => <button key={s || "all"} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s || "All"}</button>)}
        {DEPTS.filter(Boolean).map(d => <button key={d} className={department === d ? "on" : ""} onClick={() => setDepartment(department === d ? "" : d)}>{d}</button>)}
      </div>
      <input aria-label="Search requests" placeholder="Search guest, room or request" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 360 }} />
      <div className="split">
        <div className="list">
          {items.map(r => (
            <article key={r.id} className="row" style={{ display: "block" }}>
              <b>{r.guest_name || "Guest"}{r.room_label ? ` · ${r.room_label}` : ""}</b>
              <div>{r.request_text}</div>
              <p className="m">{r.department_label} · {r.status}</p>
              {r.status !== "done" && <button className="btn" onClick={async () => { await api(`/v1/ops/guest-requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: r.status === "open" ? "doing" : "done" }) }); load(); }}>{r.status === "open" ? "Start" : "Mark done"}</button>}
            </article>
          ))}
          {items.length === 0 && <div className="empty">No requests in this view.</div>}
        </div>
        <form className="detail" onSubmit={async e => {
          e.preventDefault();
          try { await api("/v1/ops/guest-requests", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, request_text: "" }); load(); }
          catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
        }}>
          <h2>Record a request</h2>
          <label>Guest<input value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} /></label>
          <label>Room<input value={form.room_label} onChange={e => setForm({ ...form, room_label: e.target.value })} /></label>
          <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{DEPTS.filter(Boolean).map(d => <option key={d}>{d}</option>)}</select></label>
          <label>What is needed?<textarea required rows={3} value={form.request_text} onChange={e => setForm({ ...form, request_text: e.target.value })} /></label>
          <button className="btn primary">Save request</button>
        </form>
      </div>
    </>
  );
}
