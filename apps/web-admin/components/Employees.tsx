"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DeskBar, EmptyState, EntryRow } from "@/components/OpsChrome";

type Person = { id: string; name: string; email: string; phone: string | null; job_title: string | null; birthday: string | null; role_name: string; department_name: string | null; department: string | null };

export default function Employees() {
  const [items, setItems] = useState<Person[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [sel, setSel] = useState<Person | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ items: Person[]; can_edit: boolean }>("/v1/staff/directory").then(r => { setItems(r.items); setCanEdit(r.can_edit); setSel(cur => cur ? r.items.find(p => p.id === cur.id) ?? null : null); }).catch(e => setErr(e instanceof ApiError ? e.problem.detail : "Could not open the directory"));
  useEffect(() => { load(); }, []);
  const depts = [...new Set(items.map(p => p.department_name).filter(Boolean))] as string[];
  const shown = items.filter(p => (!dept || p.department_name === dept) && `${p.name} ${p.email} ${p.job_title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="topbar"><div><h1>Employees</h1><p>The house directory: department, job title and how to reach someone. Pay stays on the payroll screen.</p></div></div>
      {err && <div className="note">{err}</div>}
      <DeskBar
        query={q} onQuery={setQ} placeholder="Search name or title"
        filters={<div className="seg"><button className={!dept ? "on" : ""} onClick={() => setDept("")}>All</button>{depts.map(d => <button key={d} className={dept === d ? "on" : ""} onClick={() => setDept(d)}>{d}</button>)}</div>}
      />
      <div className="split">
        <div className="list">
          {shown.map(p => (
            <EntryRow key={p.id} selected={sel?.id === p.id} onClick={() => setSel(p)} name={p.name} title={p.name} meta={`${p.job_title || p.role_name} · ${p.department_name ?? "House"}`} badge={p.department_name ?? "House"} tone="info" />
          ))}
          {shown.length === 0 && <EmptyState title="No one matches" detail="Try another department. New people are added from Names & positions." />}
        </div>
        {sel && (
          <form className="detail" onSubmit={async e => {
            e.preventDefault();
            if (!canEdit) return;
            try {
              await api(`/v1/staff/directory/${sel.id}`, { method: "PATCH", body: JSON.stringify({ phone: sel.phone, job_title: sel.job_title, birthday: sel.birthday }) });
              load();
            } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail : "Could not save"); }
          }}>
            <header><h2>{sel.name}</h2></header>
            <div className="facts">
              <div><span>Role</span><b>{sel.role_name}</b></div>
              <div><span>Department</span><b>{sel.department_name ?? "—"}</b></div>
              <div><span>Email</span><b>{sel.email}</b></div>
            </div>
            <label>Job title<input disabled={!canEdit} value={sel.job_title ?? ""} onChange={e => setSel({ ...sel, job_title: e.target.value })} /></label>
            <label>Phone<input disabled={!canEdit} value={sel.phone ?? ""} onChange={e => setSel({ ...sel, phone: e.target.value })} /></label>
            <label>Birthday<input disabled={!canEdit} type="date" value={sel.birthday ?? ""} onChange={e => setSel({ ...sel, birthday: e.target.value })} /></label>
            {canEdit && <button className="btn primary">Save contact</button>}
            {!canEdit && <p className="m">Contact details are edited by an admin. Names and roles stay on Names & positions.</p>}
          </form>
        )}
      </div>
    </>
  );
}
