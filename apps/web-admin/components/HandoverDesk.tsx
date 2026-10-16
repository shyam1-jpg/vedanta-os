"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow, useKitBus } from "@/components/OpsChrome";
import { useStore } from "@/lib/store";
import { mayOperate } from "../../../domains/ops/suite";

type Note = { id: string; department_label: string; shift_label: string; body: string; author_name: string | null; audience: string; recipient_name: string | null; audience_group: string | null; acknowledged: boolean; created_at: string };
type Person = { id: string; name: string };
const DEPTS = ["HOUSE", "FRONT", "NIGHT", "HK", "KITCHEN", "RESTAURANT", "MAINT", "GROUNDS", "MGMT"];

export default function HandoverDesk() {
  const { user } = useStore();
  const operate = mayOperate(user?.permissions ?? []);
  const [items, setItems] = useState<Note[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState({ department: "", shift: "", audience: "", q: "" });
  const [form, setForm] = useState({ department: "HOUSE", shift: "am", audience: "shift", recipient_user_id: "", audience_group: "HK", body: "" });
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = new URLSearchParams();
  if (filter.department) query.set("department", filter.department);
  if (filter.shift) query.set("shift", filter.shift);
  if (filter.audience) query.set("audience", filter.audience);
  if (filter.q) query.set("q", filter.q);
  const load = () => api<{ items: Note[] }>(`/v1/ops/handovers?${query}`).then(r => setItems(r.items)).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open handovers"));
  useEffect(() => { load(); }, [filter.department, filter.shift, filter.audience, filter.q]);
  useEffect(() => { api<{ items: Person[] }>("/v1/ops/tasks/people").then(r => setPeople(r.items)).catch(() => {}); }, []);
  useKitBus({ onSearch: q => setFilter(f => ({ ...f, q })) });
  return (
    <>
      <div className="topbar"><div><h1>Handovers</h1><p>Shift notes for the next team, a person, or a department. The house log still shows the latest ones.</p></div></div>
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={filter.q} onQuery={q => setFilter({ ...filter, q })} placeholder="Search notes"
        onAdd={operate ? () => setAdding(v => !v) : undefined} addLabel={adding ? "Close" : "Add entry"}
        filters={<div className="seg">
          <button className={filter.shift === "" ? "on" : ""} onClick={() => setFilter({ ...filter, shift: "" })}>Any shift</button>
          {["am", "pm", "night"].map(s => <button key={s} className={filter.shift === s ? "on" : ""} onClick={() => setFilter({ ...filter, shift: s })}>{s}</button>)}
          {["", "shift", "person", "group"].map(s => <button key={s || "any"} className={filter.audience === s ? "on" : ""} onClick={() => setFilter({ ...filter, audience: s })}>{s || "Any audience"}</button>)}
        </div>}
      />
      <div className="split">
        <div className="list">
          {items.map(h => (
            <div key={h.id}>
              <EntryRow name={h.author_name} title={`${h.department_label} · ${h.shift_label}`} meta={h.body} badge={h.acknowledged ? "Read" : "Unread"} />
              {!h.acknowledged && <button className="btn" style={{ margin: "0 14px 10px" }} onClick={async () => { await api(`/v1/ops/handover/${h.id}/acknowledge`, { method: "POST", body: "{}" }); load(); }}>Mark as read</button>}
            </div>
          ))}
          {items.length === 0 && <EmptyState title="No notes match" detail="Try another shift, or leave a note for the next team." />}
        </div>
        {adding && <form className="detail" onSubmit={async e => {
          e.preventDefault();
          try {
            await api("/v1/ops/handover", { method: "POST", body: JSON.stringify(form) });
            setForm({ ...form, body: "" }); load();
          } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
        }}>
          <h2>Add entry</h2>
          <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>
          <label>Shift<select value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}><option value="am">Morning</option><option value="pm">Evening</option><option value="night">Night</option></select></label>
          <label>For<select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option value="shift">The shift</option><option value="person">A person</option><option value="group">A department</option></select></label>
          {form.audience === "person" && <label>Person<select value={form.recipient_user_id} onChange={e => setForm({ ...form, recipient_user_id: e.target.value })}><option value="">Choose</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          {form.audience === "group" && <label>Department<select value={form.audience_group} onChange={e => setForm({ ...form, audience_group: e.target.value })}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></label>}
          <label>Note<textarea required rows={4} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
          <button className="btn primary">Save handover</button>
        </form>}
      </div>
    </>
  );
}
