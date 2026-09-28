"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
type U = { id: string; email: string; name: string; status: string; role: string | null; role_name: string | null; department: string | null; section: string | null; section_name: string | null; last_sign_in: string | null };
type Ref = { code: string; name: string };
type Section = { code: string; name: string; department: string };

export default function Users() {
  const { user } = useStore();
  const [items, setItems] = useState<U[]>([]); const [roles, setRoles] = useState<Ref[]>([]); const [depts, setDepts] = useState<Ref[]>([]); const [sections, setSections] = useState<Section[]>([]);
  const [add, setAdd] = useState({ email: "", name: "", role: "RECEPTIONIST", department: "", section: "" });
  const [edit, setEdit] = useState<U | null>(null);
  const [form, setForm] = useState({ name: "", role: "", department: "", section: "" });
  const [sectionName, setSectionName] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const load = () => api<{ items: U[]; roles: Ref[]; departments: Ref[]; sections: Section[] }>("/v1/users").then(r => {
    setItems(r.items); setRoles(r.roles); setDepts(r.departments); setSections(r.sections);
    setSectionName(Object.fromEntries(r.sections.map(s => [s.department + ":" + s.code, s.name])));
  }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not load"));
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); say(ok); await load(); } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Something went wrong"); } finally { setBusy(false); } };
  const active = items.filter(u => u.status === "ACTIVE"), gone = items.filter(u => u.status !== "ACTIVE");
  const forDept = (code: string) => sections.filter(s => s.department === code);
  const openEdit = (u: U) => { setEdit(u); setForm({ name: u.name, role: u.role ?? "", department: u.department ?? "", section: u.section ?? "" }); };
  const saveEdit = () => {
    if (!edit) return;
    run(async () => {
      await api(`/v1/users/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: form.name, role: form.role || undefined, department: form.department || undefined, section: form.section || null }),
      });
      setEdit(null);
    }, `${form.name} saved — household, duty, room board and tips now show the new name and position`);
  };
  const place = (u: U) => [u.department ? (depts.find(d => d.code === u.department)?.name ?? u.department) : "", u.section_name, u.role_name].filter(Boolean).join(" · ");

  const Row = ({ u }: { u: U }) => (
    <div className="urow">
      <div><div className="t">{u.name}{u.email === user?.email ? <span className="m"> · you</span> : null}</div><div className="m">{u.email}{place(u) ? ` · ${place(u)}` : ""}{u.last_sign_in ? ` · last signed in ${new Date(u.last_sign_in).toLocaleDateString("en-GB")}` : ""}</div></div>
      {u.status === "ACTIVE" && <button className="btn" disabled={busy} onClick={() => openEdit(u)}>Correct name / move</button>}
      {u.status === "ACTIVE"
        ? <button className="btn danger" disabled={busy || u.email === user?.email} onClick={() => { if (confirm(`Remove access for ${u.name}? They will be signed out.`)) run(() => api(`/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: "LEFT" }) }), `${u.name} no longer has access`); }}>Remove access</button>
        : <button className="btn" disabled={busy} onClick={() => run(() => api(`/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) }), `${u.name} can sign in again`)}>Restore</button>}
    </div>);

  return (
    <>
      <div className="topbar"><div><h1>Names & positions</h1><p>Add each person with their department, sub-section and role. Gyms is a sub-section of Restaurant, not its own department — rename it below if that word is wrong. Real names stay in this database. Do not put them in git.</p></div></div>
      <div className="panel">
        <h3>Add a person</h3>
        <div className="frow" style={{ flexWrap: "wrap", gap: 8 }}>
          <input placeholder="name@thevedanta.org" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} style={{ flex: 2, minWidth: 200 }} />
          <input placeholder="Display name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <select className="btn" value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}>{roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
          <select className="btn" value={add.department} onChange={e => setAdd({ ...add, department: e.target.value, section: "" })}><option value="">Department…</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select>
          <select className="btn" value={add.section} onChange={e => setAdd({ ...add, section: e.target.value })} disabled={!forDept(add.department).length}><option value="">Sub-section…</option>{forDept(add.department).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
          <button className="btn primary" disabled={busy || !add.email.includes("@") || !add.name} onClick={() => run(() => api("/v1/users", { method: "POST", body: JSON.stringify({ ...add, department: add.department || undefined, section: add.section || undefined }) }), `Added ${add.name}`).then(() => setAdd({ email: "", name: "", role: "RECEPTIONIST", department: "", section: "" }))}>Add</button>
        </div>
      </div>
      {sections.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Sub-sections</h3>
          <p className="m">A sub-section belongs to one department. Restaurant starts with Gyms. Change the name if it was heard wrong.</p>
          {sections.map(s => (
            <div className="frow" key={s.department + s.code} style={{ marginTop: 8 }}>
              <span style={{ minWidth: 180 }}>{depts.find(d => d.code === s.department)?.name ?? s.department}</span>
              <input value={sectionName[s.department + ":" + s.code] ?? s.name} onChange={e => setSectionName(m => ({ ...m, [s.department + ":" + s.code]: e.target.value }))} />
              <button className="btn" disabled={busy} onClick={() => run(() => api(`/v1/departments/sections/${s.code}?department=${s.department}`, { method: "PATCH", body: JSON.stringify({ name: sectionName[s.department + ":" + s.code] }) }), "Sub-section renamed")}>Save name</button>
            </div>
          ))}
        </div>
      )}
      <div className="list" style={{ marginTop: 14 }}>{active.map(u => <Row key={u.id} u={u} />)}</div>
      {gone.length > 0 && <><h3 style={{ margin: "18px 0 8px", color: "var(--ink-2)" }}>No longer have access</h3><div className="list">{gone.map(u => <Row key={u.id} u={u} />)}</div></>}
      {edit && (
        <div className="modal-backdrop" onClick={() => setEdit(null)}><div className="modal" onClick={e => e.stopPropagation()} role="dialog">
          <header><h2>Correct name or move</h2><button className="btn" onClick={() => setEdit(null)}>✕</button></header>
          <p className="m" style={{ marginBottom: 12 }}>Fix the spelling, then choose their department, sub-section and role.</p>
          <div className="fgrid">
            <label className="span2">Name as it should appear<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label>Position / role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
            <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value, section: "" })}><option value="">—</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
            <label className="span2">Sub-section<select value={form.section} onChange={e => setForm({ ...form, section: e.target.value })}><option value="">—</option>{forDept(form.department).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
          </div>
          <div className="actions"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy || !form.name.trim()} onClick={saveEdit}>Save and move</button></div>
        </div></div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
