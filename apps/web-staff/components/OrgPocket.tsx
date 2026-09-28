"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Node = {
  id: string; name: string; vacant: boolean; title: string; departmentName: string;
  reports: number; trainingLabel: string; children: Node[]; department: string; level: string;
};
type Person = { id: string; name: string; title: string };
type Shift = { date: string; start: string; end: string; department: string };
type Detail = {
  id: string; name: string; title: string; department: string; department_name?: string; level: string; levelLabel?: string;
  reports: number; training_label?: string; trainingLabel?: string;
  manager: { name: string; title: string } | null;
  reports_to_them: { id: string; name: string; title: string }[];
  contact: { email: string | null; phone: string | null; workPhone: string | null };
  rota: { this_week: Shift[]; next_week: Shift[] };
  can_edit: boolean;
  dotted?: { name: string }[];
};
type Board = { can_edit: boolean; departments: { code: string; name: string }[]; tree: Node[]; people: Person[] };

function today(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export default function OrgPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [dept, setDept] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ manager_id: "", department: "", level: "staff", effective_on: today() });

  const load = (department = dept) => {
    const q = department ? `?department=${encodeURIComponent(department)}` : "";
    api<Board>(`/v1/org${q}`).then(setBoard).catch(e => onError((e as Error).message));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const open = (id: string) => {
    api<Detail>(`/v1/org/positions/${id}`).then(row => {
      setDetail(row);
      setForm({ manager_id: "", department: row.department, level: row.level, effective_on: today() });
    }).catch(e => onError((e as Error).message));
  };

  const Rung = ({ node, depth }: { node: Node; depth: number }) => (
    <details open={depth < 1} style={{ marginLeft: depth * 12, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <summary>
        <button type="button" className="briefing-line" onClick={e => { e.preventDefault(); open(node.id); }}>{node.vacant ? "Vacant" : node.name}</button>
      </summary>
      <p className="m">{node.title} · {node.departmentName} · {node.reports} direct · {node.trainingLabel}</p>
      {board?.can_edit && <button type="button" className="btn ghost" onClick={() => open(node.id)}>Reassign</button>}
      {node.children.map(child => <Rung key={child.id} node={child} depth={depth + 1} />)}
    </details>
  );

  if (!board) return <p className="m">Opening the organisation…</p>;
  return (
    <div className="card">
      <h2>Organisation</h2>
      <p className="m">Example names until real people are added. Phone numbers follow your role.</p>
      <label>Department
        <select aria-label="Department ladder" value={dept} onChange={e => { setDept(e.target.value); load(e.target.value); }}>
          <option value="">Whole house</option>
          {board.departments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
      </label>
      {board.tree.map(node => <Rung key={node.id} node={node} depth={0} />)}
      {detail && (
        <div className="card">
          <h2>{detail.name}</h2>
          <p className="m">{detail.title} · {detail.department_name} · {detail.training_label || detail.trainingLabel}</p>
          <p>{detail.manager ? `Reports to ${detail.manager.name}` : "At the top"}</p>
          {detail.reports_to_them.map(person => <p className="m" key={person.id}>{person.name} reports here</p>)}
          <p className="m">{detail.contact.email || "No email on this view"}</p>
          <p className="m">{detail.contact.workPhone ? `Work ${detail.contact.workPhone}` : "No work phone on this view"}</p>
          <p className="m">{detail.contact.phone ? `Phone ${detail.contact.phone}` : "No personal phone on this view"}</p>
          <h2>This week</h2>
          {(detail.rota.this_week.length ? detail.rota.this_week : [{ date: "", start: "", end: "", department: "" }]).map((shift, i) => shift.date ? <p className="m" key={shift.date + shift.start}>{shift.date} · {shift.start.slice(0, 5)}–{shift.end.slice(0, 5)}</p> : <p className="m" key={i}>Nothing on the rota.</p>)}
          <h2>Next week</h2>
          {detail.rota.next_week.length === 0 && <p className="m">Nothing on the rota.</p>}
          {detail.rota.next_week.map(shift => <p className="m" key={shift.date + shift.start}>{shift.date} · {shift.start.slice(0, 5)}–{shift.end.slice(0, 5)}</p>)}
          {detail.can_edit && (
            <form onSubmit={e => {
              e.preventDefault();
              api("/v1/org/reassign", { method: "POST", body: JSON.stringify({ position_id: detail.id, department: form.department, level: form.level, effective_on: form.effective_on, ...(form.manager_id ? { manager_id: form.manager_id } : {}) }) })
                .then(() => { onError(null); setDetail(null); load(); })
                .catch(err => onError((err as Error).message));
            }}>
              <h2>Reassign</h2>
              <label>Manager
                <select aria-label="Manager" value={form.manager_id} onChange={e => setForm({ ...form, manager_id: e.target.value })}>
                  <option value="">Keep the current line</option>
                  {board.people.filter(person => person.id !== detail.id).map(person => <option key={person.id} value={person.id}>{person.name} · {person.title}</option>)}
                </select>
              </label>
              <label>Department
                <select aria-label="Department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                  {board.departments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
              </label>
              <label>Level
                <select aria-label="Level" value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}>
                  <option value="gm">General manager</option>
                  <option value="head">Department head</option>
                  <option value="lead">Team lead</option>
                  <option value="staff">Staff</option>
                </select>
              </label>
              <label>Effective from<input type="date" aria-label="Change date" value={form.effective_on} onChange={e => setForm({ ...form, effective_on: e.target.value })} /></label>
              <button className="btn" type="submit">Save reporting line</button>
            </form>
          )}
          <button type="button" className="btn ghost" onClick={() => setDetail(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
