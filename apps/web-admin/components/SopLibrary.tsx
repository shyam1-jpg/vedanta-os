"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Sop = { id: string; title: string; body?: string; department: string | null; slug: string | null; status: string; assigned: number };
type Dept = { code: string; name: string };
type Person = { id: string; name: string };

export default function SopLibrary() {
  const [items, setItems] = useState<Sop[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState<(Sop & { body: string; people: { id: string; name: string }[] }) | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", department: "", user_ids: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => api<{ items: Sop[]; can_manage: boolean; departments: Dept[]; people: Person[] }>("/v1/sops").then(r => {
    setItems(r.items); setCanManage(r.can_manage); setDepts(r.departments); setPeople(r.people ?? []);
  }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open SOPs"));
  useEffect(() => {
    load();
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (slug) {
      api<{ items: Sop[] }>(`/v1/sops?slug=${encodeURIComponent(slug)}`).then(async r => {
        const hit = r.items[0];
        if (hit) {
          const full = await api<Sop & { body: string; people: { id: string; name: string }[] }>(`/v1/sops/${hit.id}`);
          setOpen(full);
        }
      }).catch(() => {});
    }
  }, []);

  const deptName = (code: string | null) => depts.find(d => d.code === code)?.name ?? (code || "Whole house");
  const groups = new Map<string, Sop[]>();
  for (const sop of items) {
    const key = sop.department || "HOUSE";
    groups.set(key, [...(groups.get(key) ?? []), sop]);
  }

  const openOne = async (id: string) => {
    const full = await api<Sop & { body: string; people: { id: string; name: string }[] }>(`/v1/sops/${id}`);
    setOpen(full);
    setCreating(false);
  };

  const saveNew = async () => {
    try {
      const created = await api<{ id: string }>("/v1/sops", { method: "POST", body: JSON.stringify({ ...draft, department: draft.department || null, user_ids: draft.user_ids }) });
      setDraft({ title: "", body: "", department: "", user_ids: [] });
      setCreating(false);
      say("SOP saved");
      await load();
      await openOne(created.id);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
  };

  const saveEdit = async () => {
    if (!open) return;
    try {
      await api(`/v1/sops/${open.id}`, { method: "PATCH", body: JSON.stringify({ title: open.title, body: open.body, department: open.department, user_ids: open.people.map(p => p.id), assign_department: open.department }) });
      say("SOP updated");
      await load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this SOP? People will no longer see it in the pocket.")) return;
    try {
      await api(`/v1/sops/${id}`, { method: "DELETE" });
      setOpen(null);
      say("SOP deleted");
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not delete"); }
  };

  const togglePerson = (id: string) => {
    if (!open) return;
    const has = open.people.some(p => p.id === id);
    const person = people.find(p => p.id === id);
    setOpen({ ...open, people: has ? open.people.filter(p => p.id !== id) : [...open.people, { id, name: person?.name ?? id }] });
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>SOPs</h1>
          <p>Procedures for the house, grouped by department. Anyone with access can read them here. Heads of department can write, assign and remove them. The pocket still marks a copy as read.</p>
        </div>
        {canManage && <button className="btn primary" onClick={() => { setCreating(true); setOpen(null); }}>New SOP</button>}
      </div>
      <div className="split">
        <div>
          {[...groups.entries()].map(([code, list]) => (
            <section key={code} style={{ marginBottom: 16 }}>
              <h2>{deptName(code === "HOUSE" ? null : code)}</h2>
              <div className="list">
                {list.map(sop => (
                  <button key={sop.id} className={"row" + (open?.id === sop.id ? " sel" : "")} onClick={() => openOne(sop.id)}>
                    <span className="bar" style={{ background: "var(--gold)" }} />
                    <span><span className="t">{sop.title}</span><span className="m">{sop.slug} · {sop.assigned} assigned</span></span>
                    <span className="r">{sop.status}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {items.length === 0 && <p className="m">No SOPs yet.</p>}
        </div>
        <div className="detail">
          {creating && (
            <>
              <h2>New SOP</h2>
              <div className="fgrid">
                <label className="span2">Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
                <label>Department<select value={draft.department} onChange={e => setDraft({ ...draft, department: e.target.value })}><option value="">Whole house</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
                <label className="span2">Procedure<textarea rows={10} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
              </div>
              <div className="chips" style={{ margin: "8px 0" }}>{people.map(p => <button type="button" key={p.id} className={"chipbtn" + (draft.user_ids.includes(p.id) ? " on" : "")} onClick={() => setDraft(s => ({ ...s, user_ids: s.user_ids.includes(p.id) ? s.user_ids.filter(i => i !== p.id) : [...s.user_ids, p.id] }))}>{p.name}</button>)}</div>
              <div className="actions"><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={!draft.title.trim() || !draft.body.trim()} onClick={saveNew}>Save</button></div>
            </>
          )}
          {!creating && open && (
            <>
              <header>
                <div>
                  <div className="k">{deptName(open.department)}</div>
                  {canManage ? <input value={open.title} onChange={e => setOpen({ ...open, title: e.target.value })} style={{ font: "inherit", fontFamily: "var(--serif)", fontSize: 24, width: "100%", border: 0, background: "transparent" }} /> : <h2>{open.title}</h2>}
                  <p className="m">{open.slug}</p>
                </div>
              </header>
              {canManage ? <textarea rows={12} value={open.body} onChange={e => setOpen({ ...open, body: e.target.value })} style={{ width: "100%" }} /> : <p style={{ whiteSpace: "pre-wrap" }}>{open.body}</p>}
              {canManage && (
                <label className="lbl" style={{ marginTop: 10 }}>Department
                  <select className="btn" value={open.department ?? ""} onChange={e => setOpen({ ...open, department: e.target.value || null })} style={{ display: "block", marginTop: 4 }}>
                    <option value="">Whole house</option>
                    {depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
                  </select>
                </label>
              )}
              <h3 style={{ marginTop: 16 }}>Assigned</h3>
              {canManage ? (
                <div className="chips">{people.map(p => <button type="button" key={p.id} className={"chipbtn" + (open.people.some(x => x.id === p.id) ? " on" : "")} onClick={() => togglePerson(p.id)}>{p.name}</button>)}</div>
              ) : <p className="m">{open.people.map(p => p.name).join(", ") || "Not assigned to anyone yet."}</p>}
              {canManage && (
                <div className="actions">
                  <button className="btn primary" onClick={saveEdit}>Save</button>
                  <button className="btn danger" onClick={() => remove(open.id)}>Delete</button>
                </div>
              )}
            </>
          )}
          {!creating && !open && <p className="m">Choose an SOP to read it.</p>}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
