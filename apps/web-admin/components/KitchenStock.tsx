"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Log = { action: string; quantity_before: number | null; quantity_after: number | null; delta: number | null; note: string | null; by_name: string | null; created_at: string };
type Item = {
  id: string; name: string; unit: string; quantity: number; low_threshold: number; par_level?: number; reorder_at?: number | null; pack_size?: number;
  supplier: string | null; supplier_id: string | null;
  supplier_name?: string | null; supplier_phone?: string | null; supplier_email?: string | null;
  notes: string | null; example: boolean; source?: string; low: boolean; log: Log[];
};
type OrderLine = { name: string; unit: string; packs: number; pack_size: number; quantity: number };
type Order = {
  id: string; supplier_name: string; status: string; auto_sent: boolean; approved_name: string | null; approved_at: string | null;
  sent_at: string | null; sent_to: string | null; supplier_response: string | null; delivered_at: string | null; lines: OrderLine[];
};
type SupplierOpt = { id: string; name: string; phone: string | null; email: string | null };

const ACTION: Record<string, string> = { use: "Used", restock: "Restocked", set: "Counted", edit: "Updated" };

export default function KitchenStock() {
  const [items, setItems] = useState<Item[]>([]);
  const [low, setLow] = useState<{ id: string; name: string; quantity: number; unit: string; supplier_name?: string | null; supplier_phone?: string | null; supplier_email?: string | null }[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reorderOn, setReorderOn] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [draft, setDraft] = useState<Record<string, { amount: string; low: string; par: string; reorder: string; pack: string; supplier: string; supplier_id: string; notes: string }>>({});
  const [add, setAdd] = useState({ name: "", unit: "", quantity: "", low: "", par: "", reorder: "", pack: "", supplier: "", notes: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => {
    api<{ items: Item[]; low: { id: string; name: string; quantity: number; unit: string; supplier_name?: string | null; supplier_phone?: string | null; supplier_email?: string | null }[] }>("/v1/kitchen-stock")
      .then(r => { setItems(r.items); setLow(r.low); }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the stock list"));
    api<{ enabled: boolean; can_approve: boolean; items: Order[] }>("/v1/kitchen-stock/orders")
      .then(r => { setReorderOn(r.enabled); setCanApprove(r.can_approve); setOrders(r.items); }).catch(() => {});
  };
  useEffect(() => {
    load();
    api<{ items: SupplierOpt[] }>("/v1/supplier-register?active=active").then(r => setSuppliers(r.items)).catch(() => {});
  }, []);

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
      await api(`/v1/kitchen-stock/${item.id}`, { method: "PATCH", body: JSON.stringify({ low_threshold: d?.low ?? item.low_threshold, par_level: d?.par ?? item.par_level ?? 0, reorder_at: d?.reorder ?? item.reorder_at ?? "", pack_size: d?.pack ?? item.pack_size ?? 1, supplier: d?.supplier ?? item.supplier ?? "", supplier_id: d?.supplier_id ?? item.supplier_id ?? "", notes: d?.notes ?? item.notes ?? "", example: false }) });
      say(`Saved ${item.name}`);
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
  };

  return (
    <>
      <div className="topbar"><div><h1>Kitchen stock</h1><p>Key ingredients and consumables. A low item is emailed once, then again only after it is restocked. The menu is vegetarian: no eggs, and no onion family. {reorderOn ? "A draft order is grouped by supplier when stock falls below the reorder line. A manager approves it before it is sent." : "Reorder drafts stay off until they are switched on in settings."}</p></div></div>
      {low.length > 0 && <div className="note" style={{ marginBottom: 14 }}><b>{low.length} below the line.</b> {low.map(i => `${i.name} (${i.quantity} ${i.unit})${i.supplier_name ? ` · ${i.supplier_name}${i.supplier_phone ? ` ${i.supplier_phone}` : ""}` : ""}`).join(" · ")}</div>}
      <div className="hkgrid">{items.map(item => {
        const d = draft[item.id] ?? { amount: "1", low: String(item.low_threshold), par: String(item.par_level ?? 0), reorder: item.reorder_at == null ? "" : String(item.reorder_at), pack: String(item.pack_size ?? 1), supplier: item.supplier ?? "", supplier_id: item.supplier_id ?? "", notes: item.notes ?? "" };
        const setD = (patch: Partial<typeof d>) => setDraft(s => ({ ...s, [item.id]: { ...d, ...patch } }));
        return (
          <div key={item.id} className={"hk " + (item.low ? "VACANT_DIRTY" : "VACANT_CLEAN")}>
            <div className="hk-top"><b>{item.name}</b>{item.low && <span className="chip sev-high">Low</span>}{item.source === "garden" && <span className="chip">Garden</span>}{item.example && <span className="chip PROVISIONAL">Example</span>}</div>
            <div style={{ fontSize: 28, margin: "8px 0" }}>{item.quantity} <span className="m">{item.unit}</span></div>
            <div className="m">Order more below {item.low_threshold} {item.unit}. Par {item.par_level ?? 0}, reorder {item.reorder_at ?? item.low_threshold}, pack {item.pack_size ?? 1}.{item.supplier_name ? ` ${item.supplier_name}${item.supplier_phone ? ` · ${item.supplier_phone}` : ""}${item.supplier_email ? ` · ${item.supplier_email}` : ""}` : item.supplier ? ` ${item.supplier}` : ""}</div>
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
                <label className="m">Par level<input value={d.par} onChange={e => setD({ par: e.target.value })} /></label>
                <label className="m">Reorder below<input value={d.reorder} onChange={e => setD({ reorder: e.target.value })} placeholder="Same as the low-stock line if empty" /></label>
                <label className="m">Pack size<input value={d.pack} onChange={e => setD({ pack: e.target.value })} /></label>
                <label className="m">Preferred supplier
                  <select value={d.supplier_id} onChange={e => { const chosen = suppliers.find(s => s.id === e.target.value); setD({ supplier_id: e.target.value, supplier: chosen?.name ?? d.supplier }); }}>
                    <option value="">None</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="m">Supplier note<input value={d.supplier} onChange={e => setD({ supplier: e.target.value })} placeholder="Optional" /></label>
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
          <label>Par level<input value={add.par} onChange={e => setAdd({ ...add, par: e.target.value })} /></label>
          <label>Reorder below<input value={add.reorder} onChange={e => setAdd({ ...add, reorder: e.target.value })} /></label>
          <label>Pack size<input value={add.pack} onChange={e => setAdd({ ...add, pack: e.target.value })} /></label>
          <label>Supplier<input value={add.supplier} onChange={e => setAdd({ ...add, supplier: e.target.value })} /></label>
          <label>Notes<input value={add.notes} onChange={e => setAdd({ ...add, notes: e.target.value })} /></label>
        </div>
        <button className="btn primary" disabled={!add.name.trim() || !add.unit.trim()} onClick={async () => {
          try {
            await api("/v1/kitchen-stock", { method: "POST", body: JSON.stringify({ ...add, quantity: Number(add.quantity || 0), low_threshold: Number(add.low || 0), par_level: Number(add.par || 0), reorder_at: add.reorder === "" ? null : Number(add.reorder), pack_size: Number(add.pack || 1) }) });
            setAdd({ name: "", unit: "", quantity: "", low: "", par: "", reorder: "", pack: "", supplier: "", notes: "" });
            say("Added");
            load();
          } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add"); }
        }}>Add</button>
      </div>
      <div className="panel" style={{ marginTop: 16 }} data-testid="kitchen-orders">
        <h3>Purchase drafts</h3>
        <p className="m">Grouped by supplier. Nothing is emailed until a manager approves, unless that supplier is set to send on its own. Every order keeps the lines, who approved it, when it was sent, and what the supplier said.</p>
        {orders.length === 0 && <p className="m">No orders yet.</p>}
        {orders.map(order => (
          <div key={order.id} style={{ marginTop: 10 }}>
            <b>{order.supplier_name}</b> <span className="chip">{order.status}</span>
            {order.auto_sent && <span className="chip">Sent automatically</span>}
            <div className="m">{order.lines.map(line => `${line.packs} × ${line.pack_size} ${line.unit} ${line.name}`).join(" · ")}</div>
            <div className="m">{order.approved_name ? `Approved by ${order.approved_name}` : "Not approved yet"}{order.sent_at ? ` · sent ${new Date(order.sent_at).toLocaleString("en-GB")}${order.sent_to ? ` to ${order.sent_to}` : ""}` : ""}{order.delivered_at ? ` · delivered ${new Date(order.delivered_at).toLocaleString("en-GB")}` : ""}</div>
            {order.supplier_response && <div className="m">{order.supplier_response}</div>}
            {order.status === "draft" && canApprove && <button className="btn primary" type="button" onClick={async () => { try { await api(`/v1/kitchen-stock/orders/${order.id}/approve`, { method: "POST", body: "{}" }); say("Order approved"); load(); } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not approve"); } }}>Approve and send</button>}
            {(order.status === "approved" || order.status === "sent") && <button className="btn" type="button" onClick={async () => { try { await api(`/v1/kitchen-stock/orders/${order.id}/deliver`, { method: "POST", body: "{}" }); say("Marked delivered"); load(); } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not mark delivered"); } }}>Mark delivered</button>}
          </div>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
