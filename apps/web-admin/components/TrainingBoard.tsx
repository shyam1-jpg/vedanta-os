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

type Step = { id: string; label: string; sort_order: number };
type DeptLink = { code: string; sort_order: number };
type TrainingModule = {
  id: string; title: string; description: string | null; category: string; share: "department" | "selected" | "all";
  locked: boolean; example: boolean; required: boolean; certificate: boolean; valid_months: number | null;
  departments: DeptLink[]; checks: Step[]; can_edit: boolean;
};
type ModuleBoard = { scope: { all: boolean; departments: string[] }; departments: { code: string; name: string }[]; modules: TrainingModule[] };
type Draft = { title: string; required: boolean; certificate: boolean; months: string; checks: { id?: string; label: string }[]; retrain: boolean; shared: boolean; mandatory: boolean; departments: string[] };

const DEPT_LABEL: Record<string, string> = { KITCHEN: "Kitchen", FRONT: "Front of house", MAINT: "Maintenance", HK: "Housekeeping" };
function deptLabel(code: string, name?: string) { return DEPT_LABEL[code] ?? name ?? code; }

function ModuleEditor({ say }: { say: (t: string) => void }) {
  const [board, setBoard] = useState<ModuleBoard | null>(null);
  const [department, setDepartment] = useState("KITCHEN");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [add, setAdd] = useState({ title: "", category: "food_hygiene", checks: "" });
  const load = () => api<ModuleBoard>("/v1/induction/modules").then(data => {
    setBoard(data);
    const next: Record<string, Draft> = {};
    for (const mod of data.modules) {
      next[mod.id] = {
        title: mod.title,
        required: mod.required,
        certificate: mod.certificate,
        months: mod.valid_months ? String(mod.valid_months) : "",
        checks: mod.checks.map(step => ({ id: step.id, label: step.label })),
        retrain: false,
        shared: mod.share !== "department",
        mandatory: mod.share === "all" || mod.locked,
        departments: mod.departments.map(link => link.code),
      };
    }
    setDrafts(next);
    const allowed = data.scope.all ? data.departments.map(row => row.code) : data.scope.departments;
    if (!allowed.includes(department) && allowed[0]) setDepartment(allowed[0]);
  }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open modules"));
  useEffect(() => { load(); }, []);
  if (!board) return null;
  const order = ["KITCHEN", "FRONT", "MAINT", "HK"];
  const departments = [...board.departments]
    .filter(row => board.scope.all || board.scope.departments.includes(row.code))
    .sort((a, b) => (order.indexOf(a.code) + 1 || 9) - (order.indexOf(b.code) + 1 || 9) || a.name.localeCompare(b.name));
  const shown = board.modules
    .filter(mod => mod.departments.some(link => link.code === department))
    .sort((a, b) => (a.departments.find(link => link.code === department)?.sort_order ?? 0) - (b.departments.find(link => link.code === department)?.sort_order ?? 0));
  const patchDraft = (id: string, next: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...drafts[id], ...next } });
  const move = async (index: number, delta: number) => {
    const ids = shown.map(mod => mod.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const swap = ids[index];
    ids[index] = ids[target];
    ids[target] = swap;
    try { await api("/v1/induction/modules/reorder", { method: "POST", body: JSON.stringify({ department, ids }) }); load(); }
    catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not reorder"); }
  };
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Department modules</h3>
      <p className="m">Each department has its own list. Fire safety is one shared module and stays on every department. Chemical safety is shared by maintenance and housekeeping. The lists are examples until you edit them.</p>
      <select aria-label="Module department" value={department} onChange={e => setDepartment(e.target.value)}>
        {departments.map(row => <option key={row.code} value={row.code}>{deptLabel(row.code, row.name)}</option>)}
      </select>
      {shown.map((mod, index) => {
        const draft = drafts[mod.id];
        if (!draft) return null;
        return (
          <div className="ops-card" key={mod.id}>
            <div className="ops-card-top">
              <b>{mod.locked ? "Shared · every department" : mod.share === "selected" ? "Shared" : deptLabel(department)}</b>
              {mod.example && <span className="m">Editable example</span>}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <input aria-label={`${mod.title} name`} value={draft.title} disabled={!mod.can_edit} onChange={e => patchDraft(mod.id, { title: e.target.value })} />
              {mod.locked && <p className="m">You can edit this module. You cannot remove it from a department.</p>}
              <label className="m"><input type="checkbox" checked={draft.required} disabled={!mod.can_edit} onChange={e => patchDraft(mod.id, { required: e.target.checked })} /> Required before unsupervised work</label>
              <label className="m"><input type="checkbox" checked={draft.certificate} disabled={!mod.can_edit} onChange={e => patchDraft(mod.id, { certificate: e.target.checked })} /> Expires, and remind the person and their manager</label>
              {draft.certificate && <label className="m">Valid for months<input type="number" min={1} value={draft.months} disabled={!mod.can_edit} onChange={e => patchDraft(mod.id, { months: e.target.value })} /></label>}
              <div>
                {draft.checks.map((step, stepIndex) => (
                  <div key={step.id ?? stepIndex} style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input aria-label={`Step ${stepIndex + 1} for ${mod.title}`} value={step.label} disabled={!mod.can_edit} onChange={e => {
                      const checks = draft.checks.map((row, i) => i === stepIndex ? { ...row, label: e.target.value } : row);
                      patchDraft(mod.id, { checks });
                    }} />
                    {mod.can_edit && <button className="btn" type="button" onClick={() => patchDraft(mod.id, { checks: draft.checks.filter((_, i) => i !== stepIndex) })}>Remove step</button>}
                  </div>
                ))}
                {mod.can_edit && <button className="btn" type="button" onClick={() => patchDraft(mod.id, { checks: [...draft.checks, { label: "" }] })}>Add a step</button>}
              </div>
              {mod.can_edit && <label className="m"><input type="checkbox" checked={draft.retrain} onChange={e => patchDraft(mod.id, { retrain: e.target.checked })} /> This change needs training again</label>}
              {mod.can_edit && !mod.locked && <label className="m"><input type="checkbox" checked={draft.shared} onChange={e => patchDraft(mod.id, { shared: e.target.checked, mandatory: e.target.checked ? draft.mandatory : false, departments: e.target.checked ? draft.departments : [department] })} /> Shared with other departments</label>}
              {mod.can_edit && draft.shared && !draft.mandatory && departments.map(row => (
                <label className="m" key={row.code}><input type="checkbox" checked={draft.departments.includes(row.code)} onChange={e => {
                  const codes = e.target.checked ? [...draft.departments, row.code] : draft.departments.filter(code => code !== row.code);
                  patchDraft(mod.id, { departments: codes.length ? codes : [department] });
                }} /> {deptLabel(row.code, row.name)}</label>
              ))}
              {board.scope.all && !mod.locked && <label className="m"><input type="checkbox" checked={draft.mandatory} onChange={e => patchDraft(mod.id, { mandatory: e.target.checked, shared: e.target.checked || draft.shared })} /> Mandatory for every department</label>}
              {mod.can_edit && <div className="tabs">
                <button className="btn primary" type="button" onClick={async () => {
                  try {
                    await api(`/v1/induction/modules/${mod.id}`, { method: "PATCH", body: JSON.stringify({
                      title: draft.title,
                      category: mod.category,
                      required: draft.required,
                      certificate: draft.certificate,
                      valid_months: draft.certificate ? Number(draft.months) : null,
                      checks: draft.checks.filter(step => step.label.trim()),
                      requires_retraining: draft.retrain,
                      mandatory_all: mod.locked ? true : draft.mandatory,
                      shared: draft.shared || draft.mandatory,
                      departments: draft.mandatory ? undefined : draft.departments,
                    }) });
                    say(draft.retrain ? "Updated. Sign-offs for this module need training again." : "Module saved. Finished steps and sign-offs stay.");
                    load();
                  } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the module"); }
                }}>Save</button>
                <button className="btn" type="button" onClick={() => move(index, -1)}>Move up</button>
                <button className="btn" type="button" onClick={() => move(index, 1)}>Move down</button>
                {!mod.locked && <button className="btn" type="button" onClick={async () => {
                  try { await api(`/v1/induction/modules/${mod.id}/departments/${department}`, { method: "DELETE" }); say("Removed from this department"); load(); }
                  catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not remove it"); }
                }}>Remove from {deptLabel(department)}</button>}
              </div>}
            </div>
          </div>
        );
      })}
      {shown.length === 0 && <p className="m">Nothing on this department yet.</p>}
      <h3>Add a module</h3>
      <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
        <input aria-label="New module title" placeholder="Title" value={add.title} onChange={e => setAdd({ ...add, title: e.target.value })} />
        <select aria-label="New module category" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })}>
          <option value="food_hygiene">Food safety</option>
          <option value="allergen">Allergen awareness</option>
          <option value="hygiene">Hygiene</option>
          <option value="knife">Knife skills</option>
          <option value="fire_safety">Fire safety</option>
          <option value="guest_service">Guest service</option>
          <option value="accessibility">Accessibility awareness</option>
          <option value="equipment">Equipment handling</option>
          <option value="coshh">Chemical safety (COSHH)</option>
          <option value="cleaning">Cleaning standards</option>
          <option value="other">Other</option>
        </select>
        <textarea aria-label="Checklist steps" rows={3} placeholder="Checklist, one step on each line" value={add.checks} onChange={e => setAdd({ ...add, checks: e.target.value })} />
        <button className="btn primary" type="button" onClick={async () => {
          try {
            await api("/v1/induction/modules", { method: "POST", body: JSON.stringify({
              title: add.title,
              category: add.category,
              department,
              required: true,
              checks: add.checks.split("\n").map(label => ({ label: label.trim() })).filter(step => step.label),
            }) });
            setAdd({ title: "", category: add.category, checks: "" });
            say("Module added");
            load();
          } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add the module"); }
        }}>Add to {deptLabel(department)}</button>
      </div>
    </div>
  );
}

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
      <div className="topbar"><div><h1>Training and induction</h1><p>Who is cleared for unsupervised work, and what still needs a manager to sign it off. Department modules start as editable examples.</p></div></div>
      <ModuleEditor say={say} />
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
