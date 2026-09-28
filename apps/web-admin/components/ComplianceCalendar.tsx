"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Hist = { id: string; due_on: string | null; notes: string | null; has_attachment: boolean; found_issues: boolean; capa_id: string | null; capa_status: string | null; by_name: string | null; completed_at: string };
type Item = {
  id: string; title: string; category: string; category_label: string; schedule_label: string; repeating: boolean;
  every_n: number | null; every_unit: string | null; next_due: string | null; status: string;
  responsible_user_id: string | null; responsible_name: string | null; example: boolean; history: Hist[];
};
type Cat = { code: string; label: string };
type Person = { id: string; name: string };

const STATUS: Record<string, string> = { upcoming: "Upcoming", due: "Due", overdue: "Overdue", completed: "Completed" };

async function readFile(file: File): Promise<string> {
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Attach a photo as an image"));
        el.src = url;
      });
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not read the photo");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
      if (data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
      return data;
    } finally { URL.revokeObjectURL(url); }
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  if (!data.startsWith("data:application/pdf") || data.length > 700_000) throw new Error("Attach a photo or a PDF under the size limit");
  return data;
}

export default function ComplianceCalendar() {
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState({ status: "", category: "", q: "" });
  const [add, setAdd] = useState({ title: "", category: "fire_safety", schedule: "recurring", every: "1", unit: "year", next_due: "", responsible_user_id: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, { notes: string; found_issues: boolean; attachment: string }>>({});
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => {
    const qs = new URLSearchParams();
    if (filter.status) qs.set("status", filter.status);
    if (filter.category) qs.set("category", filter.category);
    if (filter.q) qs.set("q", filter.q);
    api<{ items: Item[]; categories: Cat[]; people: Person[] }>(`/v1/compliance/items?${qs}`)
      .then(r => { setItems(r.items); setCats(r.categories); setPeople(r.people); })
      .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the calendar"));
  };
  useEffect(() => { load(); }, [filter.status, filter.category]);

  const draft = (item: Item) => note[item.id] ?? { notes: "", found_issues: false, attachment: "" };

  return (
    <>
      <div className="topbar"><div><h1>Compliance calendar</h1><p>What the house must do, when it is due, and who logs that it was done.</p></div></div>
      <div className="panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Search compliance items" placeholder="Search" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") load(); }} />
          <select aria-label="Status" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Category" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All categories</option>
            {cats.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <h3 style={{ marginTop: 16 }}>Add an item</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Title" placeholder="Title" value={add.title} onChange={e => setAdd({ ...add, title: e.target.value })} />
          <select aria-label="New category" value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })}>{(cats.length ? cats : [{ code: "other", label: "Other" }]).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Schedule" value={add.schedule} onChange={e => setAdd({ ...add, schedule: e.target.value })}>
            <option value="recurring">Repeats</option>
            <option value="once">One-off</option>
          </select>
          {add.schedule === "recurring" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input aria-label="Every" type="number" min={1} value={add.every} onChange={e => setAdd({ ...add, every: e.target.value })} />
              <select aria-label="Unit" value={add.unit} onChange={e => setAdd({ ...add, unit: e.target.value })}>
                <option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option>
              </select>
            </div>
          )}
          <label>Next due<input type="date" value={add.next_due} onChange={e => setAdd({ ...add, next_due: e.target.value })} /></label>
          <label>Responsible person
            <select value={add.responsible_user_id} onChange={e => setAdd({ ...add, responsible_user_id: e.target.value })}>
              <option value="">Unassigned</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="btn primary" type="button" onClick={async () => {
            try {
              await api("/v1/compliance/items", { method: "POST", body: JSON.stringify({ ...add, repeating: add.schedule === "recurring", every: Number(add.every) }) });
              setAdd({ ...add, title: "", next_due: "" });
              say("Added");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add it"); }
          }}>Add</button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {items.map(item => {
          const d = draft(item);
          return (
            <div className="ops-card" key={item.id}>
              <div className="ops-card-top">
                <b>{item.title}{item.example ? " · example" : ""}</b>
                <span className="m">{STATUS[item.status] ?? item.status}{item.next_due ? ` · ${item.next_due}` : ""}</span>
              </div>
              <div className="m">{item.category_label} · {item.schedule_label}{item.responsible_name ? ` · ${item.responsible_name}` : ""}</div>
              <button className="btn" type="button" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? "Hide" : "Log completion"}</button>
              {open === item.id && (
                <div style={{ marginTop: 8 }}>
                  <label className="m">Notes<textarea rows={2} value={d.notes} onChange={e => setNote(s => ({ ...s, [item.id]: { ...d, notes: e.target.value } }))} /></label>
                  <label className="m" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={d.found_issues} onChange={e => setNote(s => ({ ...s, [item.id]: { ...d, found_issues: e.target.checked } }))} />
                    This found something that needs a corrective action
                  </label>
                  <label className="m">Photo or PDF
                    <input type="file" accept="image/*,.pdf" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const attachment = await readFile(file);
                        setNote(s => ({ ...s, [item.id]: { ...d, attachment } }));
                      }
                      catch (err) { say((err as Error).message); }
                    }} />
                  </label>
                  <button className="btn primary" type="button" onClick={async () => {
                    try {
                      const saved = await api<{ capa_id: string | null }>(`/v1/compliance/items/${item.id}/complete`, { method: "POST", body: JSON.stringify(d) });
                      say(saved.capa_id ? "Logged, and a corrective action is open" : "Logged");
                      setOpen(null);
                      load();
                    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not log it"); }
                  }}>Save completion</button>
                  {item.history.length > 0 && (
                    <ul className="m">
                      {item.history.map(h => (
                        <li key={h.id}>{h.by_name ?? "Staff"} · {h.completed_at?.slice(0, 10)}{h.notes ? ` · ${h.notes}` : ""}{h.has_attachment ? " · file attached" : ""}{h.found_issues ? ` · corrective action ${h.capa_status ?? "open"}` : ""}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="m">Nothing on the calendar for this filter.</p>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
