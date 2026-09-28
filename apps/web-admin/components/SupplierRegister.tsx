"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Delivery = { status: string; note: string | null; has_photo: boolean; by_name: string | null; created_at: string };
type Supplier = {
  id: string; name: string; categories: string[]; contact_name: string | null; phone: string | null; email: string | null;
  address: string | null; account_number: string | null; days: string[]; every_n: number | null; every_unit: string | null;
  next_delivery: string | null; lead_time_days: number | null; notes: string | null; active: boolean; example: boolean;
  alert: string | null; deliveries: Delivery[];
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("Attach a photo as an image")); el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
    if (data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function SupplierRegister() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [cats, setCats] = useState<{ code: string; label: string }[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState({ name: "", categories: ["food"], contact_name: "", phone: "", email: "", address: "", account_number: "", days: ["mon"], next_delivery: "", lead_time_days: "2", notes: "", active: true });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const load = () => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (category) qs.set("category", category);
    api<{ items: Supplier[]; categories: { code: string; label: string }[] }>(`/v1/supplier-register?${qs}`)
      .then(r => { setItems(r.items); setCats(r.categories); })
      .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open suppliers"));
  };
  useEffect(() => { load(); }, [category]);
  const log = async (id: string, status: string, photo = "") => {
    try {
      await api(`/v1/supplier-register/${id}/deliveries`, { method: "POST", body: JSON.stringify({ status, photo }) });
      say(status === "missed" ? "Marked missed" : "Delivery logged");
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not log the delivery"); }
  };
  return (
    <>
      <div className="topbar"><div><h1>Suppliers</h1><p>Who brings what, when the next delivery is due, and whether it arrived. Examples are not real businesses.</p></div></div>
      <div className="panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Search suppliers" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(); }} />
          <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{cats.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        </div>
        <h3 style={{ marginTop: 16 }}>Add a supplier</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Supplier name" placeholder="Name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
          <select aria-label="What they supply" value={add.categories[0]} onChange={e => setAdd({ ...add, categories: [e.target.value] })}>{(cats.length ? cats : [{ code: "food", label: "Food" }]).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <input aria-label="Contact name" placeholder="Contact name" value={add.contact_name} onChange={e => setAdd({ ...add, contact_name: e.target.value })} />
          <input aria-label="Phone" placeholder="Phone" value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} />
          <input aria-label="Email" placeholder="Email" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} />
          <input aria-label="Address" placeholder="Address" value={add.address} onChange={e => setAdd({ ...add, address: e.target.value })} />
          <input aria-label="Account number" placeholder="Account number" value={add.account_number} onChange={e => setAdd({ ...add, account_number: e.target.value })} />
          <label>Next delivery<input type="date" value={add.next_delivery} onChange={e => setAdd({ ...add, next_delivery: e.target.value })} /></label>
          <label>Lead time in days<input type="number" min={0} value={add.lead_time_days} onChange={e => setAdd({ ...add, lead_time_days: e.target.value })} /></label>
          <button className="btn primary" type="button" onClick={async () => {
            try {
              await api("/v1/supplier-register", { method: "POST", body: JSON.stringify({ ...add, lead_time_days: Number(add.lead_time_days) }) });
              setAdd({ ...add, name: "" });
              say("Added");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add"); }
          }}>Add</button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {items.map(item => (
          <div className="ops-card" key={item.id}>
            <div className="ops-card-top">
              <b>{item.name}{item.example ? " · example" : ""}{!item.active ? " · inactive" : ""}</b>
              <span className="m">{item.alert === "today" ? "Due today" : item.alert === "overdue" ? "Overdue" : item.next_delivery ? `Next ${item.next_delivery}` : "No date"}</span>
            </div>
            <div className="m">{item.categories.join(", ")}{item.contact_name ? ` · ${item.contact_name}` : ""}{item.phone ? ` · ${item.phone}` : ""}{item.email ? ` · ${item.email}` : ""}</div>
            <div className="m">{item.days.length ? `Delivers ${item.days.join(", ")}` : "No weekly days"}{item.lead_time_days != null ? ` · ${item.lead_time_days} day lead` : ""}{item.account_number ? ` · account ${item.account_number}` : ""}</div>
            <div className="tabs">
              <button className="btn" type="button" onClick={() => log(item.id, "received")}>Received</button>
              <button className="btn" type="button" onClick={() => log(item.id, "partial")}>Partial</button>
              <button className="btn" type="button" onClick={() => log(item.id, "missed")}>Missed</button>
              <button className="btn" type="button" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? "Hide" : "Edit"}</button>
            </div>
            {open === item.id && (
              <Edit item={item} cats={cats} onSaved={() => { say("Saved"); setOpen(null); load(); }} onError={say} />
            )}
            <label className="m">Delivery note photo
              <input type="file" accept="image/*" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { await log(item.id, "received", await shrink(file)); } catch (err) { say((err as Error).message); } }} />
            </label>
            {(item.deliveries ?? []).map((d, i) => <div className="m" key={i}>{d.status}{d.note ? ` · ${d.note}` : ""}{d.has_photo ? " · photo" : ""} · {d.by_name ?? "Staff"}</div>)}
          </div>
        ))}
        {items.length === 0 && <p className="m">No suppliers for this search.</p>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Edit({ item, cats, onSaved, onError }: { item: Supplier; cats: { code: string; label: string }[]; onSaved: () => void; onError: (t: string) => void }) {
  const [form, setForm] = useState({ ...item, categories: item.categories.length ? item.categories : ["food"], days: item.days, lead_time_days: item.lead_time_days ?? "", next_delivery: item.next_delivery ?? "" });
  return (
    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
      <input aria-label="Edit name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <select aria-label="Edit category" value={form.categories[0]} onChange={e => setForm({ ...form, categories: [e.target.value] })}>{cats.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
      <input aria-label="Edit phone" value={form.phone ?? ""} onChange={e => setForm({ ...form, phone: e.target.value })} />
      <input aria-label="Edit email" value={form.email ?? ""} onChange={e => setForm({ ...form, email: e.target.value })} />
      <div>{DAYS.map(day => <label key={day} style={{ marginRight: 8 }}><input type="checkbox" checked={form.days.includes(day)} onChange={e => setForm({ ...form, days: e.target.checked ? [...form.days, day] : form.days.filter(d => d !== day) })} /> {day}</label>)}</div>
      <label>Next delivery<input type="date" value={form.next_delivery ?? ""} onChange={e => setForm({ ...form, next_delivery: e.target.value })} /></label>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active</label>
      <button className="btn primary" type="button" onClick={async () => {
        try { await api(`/v1/supplier-register/${item.id}`, { method: "PATCH", body: JSON.stringify(form) }); onSaved(); }
        catch (e) { onError(e instanceof ApiError ? e.problem.detail : "Could not save"); }
      }}>Save</button>
    </div>
  );
}
