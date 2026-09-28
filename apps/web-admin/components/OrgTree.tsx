"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Node = {
  id: string; name: string; vacant: boolean; title: string; department: string; departmentName: string;
  level: string; levelLabel: string; reports: number; training: string; trainingLabel: string; children: Node[];
};
type Person = Node & { department_name: string; training_label: string; dotted_names?: string[] };
type Dept = { code: string; name: string; parent: string | null };
type Shift = { date: string; start: string; end: string; department: string };
type Detail = Omit<Person, "children" | "dotted_names"> & {
  manager: { id: string; name: string; title: string } | null;
  dotted: { id: string; name: string; title: string }[];
  reports_to_them: { id: string; name: string; title: string; vacant: boolean }[];
  contact: { email: string | null; phone: string | null; workPhone: string | null };
  rota: { this_week: Shift[]; next_week: Shift[] };
  can_edit: boolean;
};
type Board = {
  can_edit: boolean;
  allow_multiple_gm: boolean;
  staff_contact: "work" | "none";
  departments: Dept[];
  tree: Node[];
  people: Person[];
  history: { id: string; effective_on: string; summary: string; actor: string | null; undone: boolean }[];
};

const LEVELS = [["gm", "General manager"], ["head", "Department head"], ["lead", "Team lead"], ["staff", "Staff"]];

function today(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function shifts(list: Shift[]) {
  if (!list.length) return <p className="m">Nothing on the rota.</p>;
  return list.map(shift => <div className="m" key={`${shift.date}${shift.start}`}>{shift.date} · {shift.start.slice(0, 5)}–{shift.end.slice(0, 5)} · {shift.department}</div>);
}

export default function OrgTree() {
  const [board, setBoard] = useState<Board | null>(null);
  const [dept, setDept] = useState("");
  const [zoom, setZoom] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ manager_id: "", department: "", level: "staff", effective_on: today(), dotted_ids: [] as string[] });
  const [adding, setAdding] = useState(false);
  const [seat, setSeat] = useState({ title: "", department: "KITCHEN", level: "staff", manager_id: "", name: "", email: "", effective_on: today() });
  const [deptForm, setDeptForm] = useState({ code: "", name: "", parent: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };
  const fail = (e: unknown) => say(e instanceof ApiError ? e.problem.detail : "Could not save");

  const load = (department = dept) => {
    const q = department ? `?department=${encodeURIComponent(department)}` : "";
    api<Board>(`/v1/org${q}`).then(setBoard).catch(fail);
  };
  useEffect(load, []); // eslint-disable-line

  const open = async (id: string) => {
    try {
      const row = await api<Detail>(`/v1/org/positions/${id}`);
      setDetail(row);
      setForm({
        manager_id: row.manager?.id ?? "",
        department: row.department,
        level: row.level,
        effective_on: today(),
        dotted_ids: row.dotted.map(item => item.id),
      });
    } catch (e) { fail(e); }
  };

  const reassign = async (body: Record<string, unknown>) => {
    const saved = await api<{ summary: string }>("/v1/org/reassign", { method: "POST", body: JSON.stringify(body) });
    say(saved.summary);
    setDetail(null);
    load();
  };

  const dropManager = (positionId: string, managerId: string) => {
    if (!board?.can_edit || !positionId || positionId === managerId) return;
    reassign({ position_id: positionId, manager_id: managerId, effective_on: today() }).catch(fail);
  };
  const dropDept = (positionId: string, department: string) => {
    if (!board?.can_edit || !positionId || !department) return;
    reassign({ position_id: positionId, department, effective_on: today() }).catch(fail);
  };

  const Branch = ({ node }: { node: Node }) => (
    <div className="org-branch">
      <button
        type="button"
        className={"org-node" + (node.vacant ? " vacant" : "")}
        draggable={!!board?.can_edit}
        onDragStart={e => e.dataTransfer.setData("text/plain", node.id)}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); dropManager(e.dataTransfer.getData("text/plain"), node.id); }}
        onClick={() => open(node.id)}
      >
        <strong>{node.name}</strong>
        <span>{node.title}</span>
        <span className="m">{node.departmentName}</span>
        <span className="org-badges"><em>{node.reports} direct</em><em>{node.trainingLabel}</em></span>
      </button>
      {node.children.length > 0 && <div className="org-kids">{node.children.map(child => <Branch key={child.id} node={child} />)}</div>}
    </div>
  );

  const Rung = ({ node, depth }: { node: Node; depth: number }) => (
    <details className="org-rung" style={{ marginLeft: depth * 16 }} open={depth < 1}>
      <summary>
        <button type="button" className="org-rung-name" onClick={e => { e.preventDefault(); open(node.id); }}>{node.name}</button>
        <span className="m"> {node.title} · {node.departmentName} · {node.reports} direct · {node.trainingLabel}</span>
      </summary>
      {board?.can_edit && <button type="button" className="btn" onClick={() => open(node.id)}>Reassign</button>}
      {node.children.map(child => <Rung key={child.id} node={child} depth={depth + 1} />)}
    </details>
  );

  if (!board) return <p className="m">Opening the organisation…</p>;
  const dottedOf = (id: string) => board.people.find(person => person.id === id)?.dotted_names ?? [];

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Organisation</h1>
          <p>Who reports to whom. The names on a fresh database are examples. Real people are added here, or imported from a file that stays off git.</p>
        </div>
      </div>
      {toast && <div className="note">{toast}</div>}
      <div className="org-filters">
        <button type="button" className={!dept ? "on" : ""} onClick={() => { setDept(""); load(""); }}>Whole house</button>
        {board.departments.map(item => (
          <button
            type="button"
            key={item.code}
            className={dept === item.code ? "on" : ""}
            onClick={() => { setDept(item.code); load(item.code); }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); dropDept(e.dataTransfer.getData("text/plain"), item.code); }}
          >{item.name}</button>
        ))}
      </div>
      {board.can_edit && (
        <div className="audit-actions">
          <button type="button" className="btn" onClick={() => api<{ summary: string }>("/v1/org/undo", { method: "POST", body: "{}" }).then(r => { say(r.summary); load(); }).catch(fail)}>Undo</button>
          <button type="button" className="btn" onClick={() => setAdding(v => !v)}>{adding ? "Close the form" : "Add a position"}</button>
          <button type="button" className="btn" onClick={() => api<{ imported: number }>("/v1/org/import", { method: "POST", body: "{}" }).then(r => { say(`Imported ${r.imported} people`); load(); }).catch(fail)}>Import local file</button>
        </div>
      )}
      {adding && board.can_edit && (
        <div className="panel org-form" style={{ margin: "12px 0" }}>
          <h3>New seat</h3>
          <p className="m">Leave the name blank and the seat stays vacant. A person entered here is not written into git.</p>
          <label>Title<input aria-label="Position title" value={seat.title} onChange={e => setSeat({ ...seat, title: e.target.value })} /></label>
          <label>Department
            <select aria-label="New position department" value={seat.department} onChange={e => setSeat({ ...seat, department: e.target.value })}>
              {board.departments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label>Level
            <select aria-label="New position level" value={seat.level} onChange={e => setSeat({ ...seat, level: e.target.value })}>
              {LEVELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <label>Reports to
            <select aria-label="New position manager" value={seat.manager_id} onChange={e => setSeat({ ...seat, manager_id: e.target.value })}>
              <option value="">Nobody</option>
              {board.people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.title}</option>)}
            </select>
          </label>
          <label>Name<input aria-label="Person name" value={seat.name} onChange={e => setSeat({ ...seat, name: e.target.value })} /></label>
          <label>Email<input aria-label="Person email" value={seat.email} onChange={e => setSeat({ ...seat, email: e.target.value })} placeholder="person@example.invalid" /></label>
          <label>Effective from<input type="date" aria-label="Effective date" value={seat.effective_on} onChange={e => setSeat({ ...seat, effective_on: e.target.value })} /></label>
          <button type="button" className="btn primary" onClick={() => api("/v1/org/positions", { method: "POST", body: JSON.stringify(seat) }).then(() => { say("Position added"); setAdding(false); load(); }).catch(fail)}>Save position</button>
          <h3 style={{ marginTop: 18 }}>Department</h3>
          <label>Code<input aria-label="Department code" value={deptForm.code} onChange={e => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })} /></label>
          <label>Name<input aria-label="Department name" value={deptForm.name} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} /></label>
          <label>Sits under
            <select aria-label="Parent department" value={deptForm.parent} onChange={e => setDeptForm({ ...deptForm, parent: e.target.value })}>
              <option value="">The top</option>
              {board.departments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => api("/v1/org/departments", { method: "POST", body: JSON.stringify(deptForm) }).then(() => { say("Department saved"); load(); }).catch(fail)}>Save department</button>
        </div>
      )}
      <div className="org-zoom">
        <div className="audit-actions">
          <button type="button" className="btn" onClick={() => setZoom(z => Math.min(1.8, Math.round((z + 0.1) * 10) / 10))}>Zoom in</button>
          <button type="button" className="btn" onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}>Zoom out</button>
          <button type="button" className="btn" onClick={() => setZoom(1)}>Reset</button>
        </div>
        <div className="org-scroll">
          <div className="org-canvas" style={{ transform: `scale(${zoom})` }}>
            {board.tree.length === 0 && <p className="m">Nobody is on this ladder yet.</p>}
            {board.tree.map(node => <Branch key={node.id} node={node} />)}
          </div>
        </div>
        {board.can_edit && <p className="m">Drag a person onto a manager, or onto a department above.</p>}
      </div>
      <div className="org-acc">
        {board.tree.map(node => <Rung key={node.id} node={node} depth={0} />)}
      </div>
      {board.history.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Changes</h3>
          {board.history.map(row => (
            <div className="m" key={row.id} style={{ opacity: row.undone ? 0.55 : 1 }}>{row.effective_on} · {row.summary}{row.actor ? ` · ${row.actor}` : ""}{row.undone ? " · undone" : ""}</div>
          ))}
        </div>
      )}
      {detail && (
        <aside className="org-sheet" aria-label="Person">
          <button type="button" className="btn" onClick={() => setDetail(null)}>Close</button>
          <h2 style={{ marginTop: 12 }}>{detail.name}</h2>
          <p className="m">{detail.title} · {detail.department_name || detail.departmentName} · {detail.levelLabel}</p>
          <p>{detail.reports} direct · {detail.training_label || detail.trainingLabel}</p>
          {!!dottedOf(detail.id).length && <p className="m">Dotted line to {dottedOf(detail.id).join(", ")}</p>}
          <h3>Reports to</h3>
          <p>{detail.manager ? `${detail.manager.name} · ${detail.manager.title}` : "Nobody. This seat is at the top."}</p>
          <h3>Direct reports</h3>
          {detail.reports_to_them.length === 0 && <p className="m">Nobody reports here.</p>}
          {detail.reports_to_them.map(person => <button type="button" className="org-rung-name" key={person.id} onClick={() => open(person.id)}>{person.name} · {person.title}</button>)}
          <h3>Contact</h3>
          <p className="m">{detail.contact.email || "No email on this view"}</p>
          <p className="m">{detail.contact.workPhone ? `Work ${detail.contact.workPhone}` : "No work phone on this view"}</p>
          <p className="m">{detail.contact.phone ? `Phone ${detail.contact.phone}` : "No personal phone on this view"}</p>
          <h3>This week</h3>
          {shifts(detail.rota.this_week)}
          <h3>Next week</h3>
          {shifts(detail.rota.next_week)}
          {detail.can_edit && (
            <form onSubmit={e => { e.preventDefault(); reassign({ position_id: detail.id, manager_id: form.manager_id, department: form.department, level: form.level, dotted_ids: form.dotted_ids, effective_on: form.effective_on }).catch(fail); }}>
              <h3>Reassign</h3>
              <label>Manager
                <select aria-label="Manager" value={form.manager_id} onChange={e => setForm({ ...form, manager_id: e.target.value })}>
                  <option value="">Nobody</option>
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
                  {LEVELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label>Dotted line
                <select aria-label="Dotted line" value="" onChange={e => { if (e.target.value) setForm({ ...form, dotted_ids: [...new Set([...form.dotted_ids, e.target.value])] }); }}>
                  <option value="">Add a dotted line</option>
                  {board.people.filter(person => person.id !== detail.id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              {!!form.dotted_ids.length && <p className="m">{form.dotted_ids.length} dotted line{form.dotted_ids.length === 1 ? "" : "s"}</p>}
              <label>Effective from<input type="date" aria-label="Change date" value={form.effective_on} onChange={e => setForm({ ...form, effective_on: e.target.value })} /></label>
              <button type="submit" className="btn primary">Save reporting line</button>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
