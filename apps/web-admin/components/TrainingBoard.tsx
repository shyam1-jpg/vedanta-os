"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Item = { id: string; title: string; category: string; category_label: string; required: boolean; certificate: boolean; valid_months: number | null; example: boolean };
type Cell = { item_id: string; assignment_id: string | null; tone: string; status: string | null; expires_on: string | null; signed_off_name: string | null };
type Person = { id: string; name: string; role_name: string | null; department_name: string | null; cleared: boolean; cells: Cell[] };
type Template = { id: string; name: string; role_code: string | null; department: string | null; example: boolean; items: { id: string; title: string }[] };
type Board = {
  items: Item[]; people: Person[]; categories: { code: string; label: string }[];
  templates: Template[]; sops: { id: string; title: string }[]; roles: { code: string; name: string }[]; departments: { code: string; name: string }[];
};

const TONE: Record<string, { label: string; color: string }> = {
  none: { label: "Not on the list", color: "transparent" },
  not_started: { label: "Not started", color: "#e7e2d8" },
  in_progress: { label: "Done, waiting for sign-off", color: "#f3d48a" },
  cleared: { label: "Signed off", color: "#b7d7c3" },
  expired: { label: "Expired", color: "#e7b2a8" },
};

export default function TrainingBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState({ q: "", category: "", role: "", department: "", cleared: "" });
  const [add, setAdd] = useState({ title: "", description: "", category: "fire_safety", required: true, certificate: false, valid_years: "3", sop_id: "", link: "" });
  const [assign, setAssign] = useState({ user_id: "", template_id: "" });
  const [person, setPerson] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const load = () => {
    const qs = new URLSearchParams();
    if (filter.q) qs.set("q", filter.q);
    if (filter.category) qs.set("category", filter.category);
    if (filter.role) qs.set("role", filter.role);
    if (filter.department) qs.set("department", filter.department);
    if (filter.cleared) qs.set("cleared", filter.cleared);
    api<Board>(`/v1/induction/matrix?${qs}`).then(setBoard).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open training"));
  };
  useEffect(() => { load(); }, [filter.category, filter.role, filter.department, filter.cleared]);
  if (!board) return <div className="empty">Opening training…</div>;
  const chosen = board.people.find(p => p.id === person);
  return (
    <>
      <div className="topbar"><div><h1>Training and induction</h1><p>Who is cleared for unsupervised work, and what still needs a manager to sign it off. Examples are not the house's real courses.</p></div></div>
      <div className="panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Search staff" placeholder="Search staff" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") load(); }} />
          <select aria-label="Category" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}><option value="">All training</option>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Role" value={filter.role} onChange={e => setFilter({ ...filter, role: e.target.value })}><option value="">All roles</option>{board.roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
          <select aria-label="Department" value={filter.department} onChange={e => setFilter({ ...filter, department: e.target.value })}><option value="">All departments</option>{board.departments.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select>
          <select aria-label="Cleared" value={filter.cleared} onChange={e => setFilter({ ...filter, cleared: e.target.value })}>
            <option value="">Cleared or not</option>
            <option value="yes">Cleared for unsupervised work</option>
            <option value="no">Not cleared</option>
          </select>
        </div>
        <div className="m" style={{ marginTop: 8 }}>{Object.entries(TONE).filter(([k]) => k !== "none").map(([k, v]) => <span key={k} style={{ marginRight: 12 }}><span style={{ display: "inline-block", width: 12, height: 12, background: v.color, border: "1px solid #ccc", marginRight: 4 }} />{v.label}</span>)}</div>
      </div>
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 6 }}>Person</th>
              {board.items.map(item => <th key={item.id} style={{ padding: 6, minWidth: 88, fontWeight: 500 }}>{item.title}{item.example ? " · example" : ""}{item.required ? " *" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {board.people.map(p => (
              <tr key={p.id}>
                <td style={{ padding: 6, whiteSpace: "nowrap" }}>
                  <button className="btn" type="button" onClick={() => setPerson(p.id)}>{p.name}</button>
                  <div className="m">{p.cleared ? "Cleared for unsupervised work" : "Not cleared"}{p.role_name ? ` · ${p.role_name}` : ""}</div>
                </td>
                {p.cells.map(cell => (
                  <td key={cell.item_id} title={TONE[cell.tone]?.label} style={{ background: TONE[cell.tone]?.color, textAlign: "center", padding: 6 }}>{cell.tone === "none" ? "" : cell.tone === "cleared" ? "Yes" : cell.tone === "expired" ? "Expired" : cell.tone === "in_progress" ? "Waiting" : "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {board.people.length === 0 && <p className="m">No one matches this filter.</p>}
      </div>
      {chosen && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>{chosen.name}</h3>
          <p className="m">{chosen.cleared ? "Cleared for unsupervised work." : "Not cleared for unsupervised work until every required item is signed off."}</p>
          {chosen.cells.filter(c => c.assignment_id).map(cell => {
            const item = board.items.find(i => i.id === cell.item_id);
            return (
              <div className="ops-card" key={cell.assignment_id}>
                <div className="ops-card-top"><b>{item?.title}</b><span className="m">{TONE[cell.tone]?.label}{cell.expires_on ? ` · expires ${cell.expires_on}` : ""}{cell.signed_off_name ? ` · ${cell.signed_off_name}` : ""}</span></div>
                <div className="tabs">
                  {cell.tone !== "cleared" && <button className="btn primary" type="button" onClick={async () => {
                    try { await api(`/v1/induction/assignments/${cell.assignment_id}/signoff`, { method: "POST", body: JSON.stringify({}) }); say("Signed off"); load(); }
                    catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not sign it off"); }
                  }}>Sign off</button>}
                  <button className="btn" type="button" onClick={async () => {
                    try { await api(`/v1/induction/assignments/${cell.assignment_id}`, { method: "DELETE" }); say("Removed"); load(); }
                    catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not remove it"); }
                  }}>Remove</button>
                </div>
              </div>
            );
          })}
          <label className="m">Add an item
            <select aria-label="Extra item" defaultValue="" onChange={async e => {
              if (!e.target.value) return;
              try { await api("/v1/induction/assignments", { method: "POST", body: JSON.stringify({ user_id: chosen.id, item_id: e.target.value }) }); say("Added"); load(); }
              catch (err) { say(err instanceof ApiError ? err.problem.detail : "Could not add it"); }
            }}>
              <option value="">Choose</option>
              {board.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Give someone an induction</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Person" value={assign.user_id} onChange={e => setAssign({ ...assign, user_id: e.target.value })}><option value="">Person</option>{board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select aria-label="Induction" value={assign.template_id} onChange={e => setAssign({ ...assign, template_id: e.target.value })}><option value="">Induction</option>{board.templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.example ? " · example" : ""}</option>)}</select>
          <button className="btn primary" type="button" onClick={async () => {
            try { await api("/v1/induction/assign", { method: "POST", body: JSON.stringify(assign) }); say("Checklist created"); load(); }
            catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not assign it"); }
          }}>Assign</button>
        </div>
        {board.templates.map(t => <p className="m" key={t.id}>{t.name}{t.example ? " · example" : ""} · {t.items.map(i => i.title).join(", ") || "No items"}{t.role_code ? ` · ${t.role_code}` : ""}{t.department ? ` · ${t.department}` : ""}</p>)}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Add a training item</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Title" placeholder="Title" value={add.title} onChange={e => setAdd({ ...add, title: e.target.value })} />
          <textarea aria-label="Description" rows={2} placeholder="What it covers" value={add.description} onChange={e => setAdd({ ...add, description: e.target.value })} />
          <select aria-label="Training category" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })}>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <label className="m"><input type="checkbox" checked={add.required} onChange={e => setAdd({ ...add, required: e.target.checked })} /> Required before unsupervised work</label>
          <label className="m"><input type="checkbox" checked={add.certificate} onChange={e => setAdd({ ...add, certificate: e.target.checked })} /> Certificate with an expiry</label>
          {add.certificate && <label>Valid for years<input type="number" min={1} value={add.valid_years} onChange={e => setAdd({ ...add, valid_years: e.target.value })} /></label>}
          <select aria-label="SOP" value={add.sop_id} onChange={e => setAdd({ ...add, sop_id: e.target.value })}><option value="">No SOP</option>{board.sops.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
          <input aria-label="Link" placeholder="https:// link, optional" value={add.link} onChange={e => setAdd({ ...add, link: e.target.value })} />
          <button className="btn primary" type="button" onClick={async () => {
            try {
              await api("/v1/induction/library", { method: "POST", body: JSON.stringify({ ...add, valid_years: Number(add.valid_years) }) });
              setAdd({ ...add, title: "", description: "" });
              say("Added");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add it"); }
          }}>Add to the library</button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
