"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Log = { action: string; quantity_before: number | null; quantity_after: number | null; delta: number | null; note: string | null; by_name: string | null; created_at: string };
type Item = {
  id: string; name: string; unit: string; quantity: number; low_threshold: number; supplier: string | null;
  notes: string | null; example: boolean; low: boolean; log: Log[];
};

const ACTION: Record<string, string> = { use: "Used", restock: "Restocked", set: "Counted", edit: "Updated" };

export default function KitchenStock() {
  const [items, setItems] = useState<Item[]>([]);
  const [low, setLow] = useState<{ id: string; name: string; quantity: number; unit: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { amount: string; low: string; supplier: string; notes: string }>>({});
  const [add, setAdd] = useState({ name: "", unit: "", quantity: "", low: "", supplier: "", notes: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => api<{ items: Item[]; low: { id: string; name: string; quantity: number; unit: string }[] }>("/v1/kitchen-stock")
    .then(r => { setItems(r.items); setLow(r.low); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the stock list"));
  useEffect(() => { load(); }, []);

  const count = async (item: Item, op: "use" | "restock" | "set") => {
    const raw = draft[item.id]?.amount ?? "1";
    const amount = op === "set" ? Number(raw) : Number(raw || 1);
    try {
      await api(`/v1/kitchen-stock/${item.id}/count`, { method: "POST", body: JSON.stringify({ op, amount }) });
      say(op === "use" ? `Used ${item.name}` : op === "restock" ? `Restocked ${item.name}` : `Counted ${item.name}`);
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not update the count"); }
  };

  const save = async (item: Item) => {
    const d = draft[item.id];
    try {
      await api(`/v1/kitchen-stock/${item.id}`, { method: "PATCH", body: JSON.stringify({ low_threshold: d?.low ?? item.low_threshold, supplier: d?.supplier ?? item.supplier ?? "", notes: d?.notes ?? item.notes ?? "", example: false }) });
      say(`Saved ${item.name}`);
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
  };

  return (
    <>
      <div className="topbar"><div><h1>Kitchen stock</h1><p>Key ingredients and consumables. A low item is emailed once, then again only after it is restocked.</p></div></div>
      {low.length > 0 && <div className="note" style={{ marginBottom: 14 }}><b>{low.length} below the line.</b> {low.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(" · ")}</div>}
      <div className="hkgrid">{items.map(item => {
        const d = draft[item.id] ?? { amount: "1", low: String(item.low_threshold), supplier: item.supplier ?? "", notes: item.notes ?? "" };
        const setD = (patch: Partial<typeof d>) => setDraft(s => ({ ...s, [item.id]: { ...d, ...patch } }));
        return (
          <div key={item.id} className={"hk " + (item.low ? "VACANT_DIRTY" : "VACANT_CLEAN")}>
            <div className="hk-top"><b>{item.name}</b>{item.low && <span className="chip sev-high">Low</span>}{item.example && <span className="chip PROVISIONAL">Example</span>}</div>
            <div style={{ fontSize: 28, margin: "8px 0" }}>{item.quantity} <span className="m">{item.unit}</span></div>
            <div className="m">Order more below {item.low_threshold} {item.unit}{item.supplier ? ` · ${item.supplier}` : ""}</div>
            <div className="hk-actions">
              <button className="btn" onClick={() => count(item, "use")}>Use</button>
              <button className="btn primary" onClick={() => count(item, "restock")}>Restock</button>
              <input value={d.amount} onChange={e => setD({ amount: e.target.value })} style={{ width: 72, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6 }} aria-label={`Amount for ${item.name}`} />
              <button className="btn" onClick={() => count(item, "set")}>Set count</button>
            </div>
            <button className="btn" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? "Hide" : "Details and history"}</button>
            {open === item.id && (
              <div style={{ marginTop: 8 }}>
                <label className="m">Low-stock line<input value={d.low} onChange={e => setD({ low: e.target.value })} /></label>
                <label className="m">Supplier<input value={d.supplier} onChange={e => setD({ supplier: e.target.value })} placeholder="Optional" /></label>
                <label className="m">Notes<textarea rows={2} value={d.notes} onChange={e => setD({ notes: e.target.value })} /></label>
                <button className="btn" onClick={() => save(item)}>Save details</button>
                {(item.log ?? []).map((entry, i) => (
                  <div className="m" key={i} style={{ marginTop: 6 }}>{ACTION[entry.action] ?? entry.action}{entry.delta != null && entry.action !== "edit" ? ` ${entry.delta > 0 ? "+" : ""}${entry.delta}` : ""}{entry.quantity_after != null ? ` → ${entry.quantity_after} ${item.unit}` : ""} · {entry.by_name ?? "Staff"} · {new Date(entry.created_at).toLocaleString("en-GB")}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}</div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Add an item</h3>
        <div className="fgrid">
          <label>Name<input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} /></label>
          <label>Unit<input value={add.unit} onChange={e => setAdd({ ...add, unit: e.target.value })} placeholder="kg, litres, packs" /></label>
          <label>Count now<input value={add.quantity} onChange={e => setAdd({ ...add, quantity: e.target.value })} /></label>
          <label>Low-stock line<input value={add.low} onChange={e => setAdd({ ...add, low: e.target.value })} /></label>
          <label>Supplier<input value={add.supplier} onChange={e => setAdd({ ...add, supplier: e.target.value })} /></label>
          <label>Notes<input value={add.notes} onChange={e => setAdd({ ...add, notes: e.target.value })} /></label>
        </div>
        <button className="btn primary" disabled={!add.name.trim() || !add.unit.trim()} onClick={async () => {
          try {
            await api("/v1/kitchen-stock", { method: "POST", body: JSON.stringify({ ...add, quantity: Number(add.quantity || 0), low_threshold: Number(add.low || 0) }) });
            setAdd({ name: "", unit: "", quantity: "", low: "", supplier: "", notes: "" });
            say("Added");
            load();
          } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add"); }
        }}>Add</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
