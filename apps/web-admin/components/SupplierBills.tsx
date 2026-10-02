"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DEFAULT_SUPPLIERS, EXPENSE_DEPARTMENTS, REGULAR_SUPPLIERS } from "../../../domains/finance/back-office.ts";

type Bill = {
  id: string; date: string; supplier_code: string; supplier_name: string; local_shop: boolean;
  kind: "food" | "other"; department: string; department_name: string; amount: number; note: string | null;
  delivered_at: string | null; quality: number | null; price_score: number | null; reliability: number | null;
};

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const blank = (n: number | null) => n == null ? "—" : String(n);

export default function SupplierBills() {
  const [items, setItems] = useState<Bill[]>([]);
  const [localShops, setLocalShops] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ spent_on: "", supplier_code: "BREAKS", local_name: "", kind: "food", department: "KITCHEN", amount: "", note: "" });

  const load = () => api<{ items: Bill[]; localShops: string[] }>("/v1/supplier-bills")
    .then(r => { setItems(r.items); setLocalShops(r.localShops); })
    .catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not load bills."));
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const supplier_code = form.supplier_code.startsWith("local:") ? "LOCAL" : form.supplier_code;
      const local_name = form.supplier_code.startsWith("local:") ? form.supplier_code.slice(6) : form.local_name;
      await api("/v1/supplier-bills", { method: "POST", body: JSON.stringify({ ...form, supplier_code, local_name }) });
      setForm(f => ({ ...f, amount: "", note: "", local_name: "" }));
      load();
    } catch (err) { setError(err instanceof ApiError ? err.problem.detail : "Could not save the bill."); }
  };

  const score = async (bill: Bill, patch: { quality?: string; price?: string; reliability?: string }) => {
    setError("");
    try {
      await api(`/v1/supplier-bills/${bill.id}/scores`, { method: "POST", body: JSON.stringify({
        quality: patch.quality ?? bill.quality ?? "",
        price: patch.price ?? bill.price_score ?? "",
        reliability: patch.reliability ?? bill.reliability ?? "",
      }) });
      load();
    } catch (err) { setError(err instanceof ApiError ? err.problem.detail : "Could not save the score."); }
  };

  return (
    <div>
      <p>Log a bill the house has. Regular shops are {REGULAR_SUPPLIERS.map(s => s.name).join(", ")}. A bill updates that department’s spend once. It does not score the shop. Scores come only after a delivery, and only if you enter them. Nothing here calls a shop.</p>
      {error && <div className="note" role="alert">{error}</div>}
      <form onSubmit={save} className="house-panel" style={{ margin: "12px 0" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>Date<input type="date" required value={form.spent_on} onChange={e => setForm({ ...form, spent_on: e.target.value })} /></label>
          <label>Shop
            <select value={form.supplier_code} onChange={e => setForm({ ...form, supplier_code: e.target.value })}>
              <optgroup label="Regular">
                {DEFAULT_SUPPLIERS.filter(s => s.regular).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </optgroup>
              <optgroup label="Also used">
                {DEFAULT_SUPPLIERS.filter(s => !s.regular).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </optgroup>
              {localShops.length > 0 && <optgroup label="Local shops already typed">
                {localShops.map(name => <option key={name} value={`local:${name}`}>{name}</option>)}
              </optgroup>}
              <option value="LOCAL">Another local shop</option>
            </select>
          </label>
          {(form.supplier_code === "LOCAL" || form.supplier_code.startsWith("local:")) && (
            <label>Local shop<input required={form.supplier_code === "LOCAL"} value={form.supplier_code.startsWith("local:") ? form.supplier_code.slice(6) : form.local_name} onChange={e => setForm({ ...form, supplier_code: "LOCAL", local_name: e.target.value })} /></label>
          )}
          <label>Kind
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              <option value="food">Food</option>
              <option value="other">Other / building</option>
            </select>
          </label>
          <label>Department
            <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
              {EXPENSE_DEPARTMENTS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          <label>Amount<input required inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
          <label>Note<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn primary" type="submit">Log bill</button>
        </div>
      </form>
      {items.length === 0 && <p className="m">No bills logged.</p>}
      {items.map(bill => (
        <div key={bill.id} className="panel" style={{ marginBottom: 8 }}>
          <div className="urow" style={{ border: 0 }}>
            <div>
              <div className="t">{bill.date} · {bill.supplier_name}{bill.local_shop ? " · local" : ""}</div>
              <div className="m">{bill.kind === "food" ? "Food" : "Other"} · {bill.department_name} · {gbp(bill.amount)}{bill.note ? ` · ${bill.note}` : ""}</div>
            </div>
            {!bill.delivered_at
              ? <button className="btn" onClick={() => api(`/v1/supplier-bills/${bill.id}/deliver`, { method: "POST", body: "{}" }).then(load).catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not mark the delivery."))}>Mark delivered</button>
              : <span className="m">Delivered</span>}
          </div>
          {bill.delivered_at && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <label>Quality <input style={{ width: 64 }} placeholder={blank(bill.quality)} onBlur={e => e.target.value && score(bill, { quality: e.target.value })} /></label>
              <label>Price <input style={{ width: 64 }} placeholder={blank(bill.price_score)} onBlur={e => e.target.value && score(bill, { price: e.target.value })} /></label>
              <label>Reliability <input style={{ width: 64 }} placeholder={blank(bill.reliability)} onBlur={e => e.target.value && score(bill, { reliability: e.target.value })} /></label>
              <span className="m">1 to 5, after delivery. Blank until you enter one. Quality {blank(bill.quality)} · price {blank(bill.price_score)} · reliability {blank(bill.reliability)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
