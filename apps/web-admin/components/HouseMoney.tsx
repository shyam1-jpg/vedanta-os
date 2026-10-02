"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { HOUSE_DEPARTMENTS } from "../../../domains/finance/back-office.ts";

type Dept = { code: string; name: string; supplier: number | null; labour: number | null; spend: number | null; budget: number | null; variance: number | null };
type House = {
  note: string; today: string; anchor: string; period: string; from: string; to: string; canSetBudget: boolean;
  guestsKnown: boolean; guestsInHouse: number | null; guestNights: number | null; peakGuests: number | null;
  moneyIn: number | null; moneyOut: number | null; supplierSpend: number | null; foodSpend: number | null; otherSpend: number | null;
  labourCost: number | null; pettySpent: number | null; unratedHours: number | null; openShiftsCapped: number;
  costPerGuest: number | null; profit: number | null; breakEvenRevenue: number | null; shortOfBreakEven: number | null;
  aboveBreakEven: boolean | null; breakEvenGuests: number | null;
  departments: Dept[];
  income: { id: string; date: string; amount: number; note: string | null }[];
  petty: { id: string; date: string; amount: number; note: string | null; signedOutBy: string }[];
  signers: { id: string; name: string }[];
};
const gbp = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const num = (n: number | null) => n == null ? "—" : String(n);

export default function HouseMoney() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [anchor, setAnchor] = useState("");
  const [house, setHouse] = useState<House | null>(null);
  const [error, setError] = useState("");
  const [income, setIncome] = useState({ received_on: "", amount: "", note: "" });
  const [petty, setPetty] = useState({ on_date: "", amount: "", signed_out_by: "", note: "" });
  const [budget, setBudget] = useState({ department: "KITCHEN", year: "", month: "", amount: "" });

  const load = (nextAnchor = anchor, nextPeriod = period) => {
    const q = new URLSearchParams({ period: nextPeriod });
    if (nextAnchor) q.set("anchor", nextAnchor);
    api<House>(`/v1/finance/house?${q}`).then(h => {
      setHouse(h);
      if (!nextAnchor) setAnchor(h.anchor);
      setIncome(f => ({ ...f, received_on: f.received_on || h.today }));
      setPetty(f => ({ ...f, on_date: f.on_date || h.today }));
      setBudget(f => ({ ...f, year: f.year || h.today.slice(0, 4), month: f.month || String(Number(h.today.slice(5, 7))) }));
    }).catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not load house money."));
  };
  useEffect(() => { load(); }, [period]); // eslint-disable-line

  const send = async (path: string, body: unknown) => {
    setError("");
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); load(); }
    catch (e) { setError(e instanceof ApiError ? e.problem.detail : "Could not save."); }
  };

  return (
    <div>
      <p>{house?.note ?? "Guests do not pay for food. The restaurant is buffet only."}</p>
      {error && <div className="note" role="alert">{error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "end", margin: "12px 0" }}>
        <div className="seg">
          {(["day", "week", "month"] as const).map(p => (
            <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
        <label>Date<input type="date" value={anchor} onChange={e => { setAnchor(e.target.value); load(e.target.value, period); }} /></label>
        {house && <span className="m">{house.from} → {house.to}</span>}
      </div>
      {house && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 16 }}>
            {[
              ["Money in", gbp(house.moneyIn)],
              ["Money out", gbp(house.moneyOut)],
              ["Supplier bills", gbp(house.supplierSpend)],
              ["Food", gbp(house.foodSpend)],
              ["Other purchases", gbp(house.otherSpend)],
              ["Labour", gbp(house.labourCost)],
              ["Petty cash", gbp(house.pettySpent)],
              ["Guests", house.guestsKnown ? num(house.period === "day" ? house.guestsInHouse : house.guestNights) : "—"],
              ["Cost per guest", gbp(house.costPerGuest)],
              ["Profit", gbp(house.profit)],
              ["Break-even", gbp(house.breakEvenRevenue)],
              ["Break-even guests", num(house.breakEvenGuests)],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px" }}>
                <div className="m">{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
          {house.unratedHours != null && <p className="m">Hours with no rate saved: {house.unratedHours}. Those hours are not turned into a cost.</p>}
          {house.openShiftsCapped > 0 && <p className="m">{house.openShiftsCapped} open clock-in{house.openShiftsCapped === 1 ? " is" : "s are"} capped at 16 hours.</p>}
          {!house.guestsKnown && <p className="m">A booking in this period has no guest count, so guests, cost per guest and staffing stay blank.</p>}

          <h3>Department budgets</h3>
          <p className="m">The general manager sets the monthly budget. A logged bill updates that department’s spend once. A blank cell has never been entered.</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 16 }}>
            <thead><tr>{["Department", "Budget", "Bills", "Labour", "Spend", "Left"].map(h => <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>)}</tr></thead>
            <tbody>
              {house.departments.map(d => (
                <tr key={d.code} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: 8 }}>{d.name}</td>
                  <td style={{ padding: 8 }}>{gbp(d.budget)}</td>
                  <td style={{ padding: 8 }}>{gbp(d.supplier)}</td>
                  <td style={{ padding: 8 }}>{gbp(d.labour)}</td>
                  <td style={{ padding: 8 }}>{gbp(d.spend)}</td>
                  <td style={{ padding: 8 }}>{gbp(d.variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {house.canSetBudget && (
            <form className="house-panel" style={{ marginBottom: 16 }} onSubmit={e => { e.preventDefault(); send("/v1/finance/department-budget", budget); }}>
              <h3>Set a department budget</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label>Department<select value={budget.department} onChange={e => setBudget({ ...budget, department: e.target.value })}>{HOUSE_DEPARTMENTS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
                <label>Year<input value={budget.year} onChange={e => setBudget({ ...budget, year: e.target.value })} inputMode="numeric" /></label>
                <label>Month<input value={budget.month} onChange={e => setBudget({ ...budget, month: e.target.value })} inputMode="numeric" /></label>
                <label>Amount<input value={budget.amount} onChange={e => setBudget({ ...budget, amount: e.target.value })} inputMode="decimal" placeholder="Blank to clear" /></label>
                <button className="btn primary" type="submit">Save budget</button>
              </div>
            </form>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <form className="house-panel" onSubmit={e => { e.preventDefault(); send("/v1/finance/income", income); }}>
              <h3>Guest or retreat revenue</h3>
              <p className="m">Not a meal ticket. Guests never pay for food.</p>
              <label>Date<input type="date" required value={income.received_on} onChange={e => setIncome({ ...income, received_on: e.target.value })} /></label>
              <label>Amount<input required inputMode="decimal" value={income.amount} onChange={e => setIncome({ ...income, amount: e.target.value })} /></label>
              <label>Note<input value={income.note} onChange={e => setIncome({ ...income, note: e.target.value })} /></label>
              <button className="btn primary" type="submit">Save income</button>
              {house.income.length === 0 && <p className="m">No revenue entered for this period.</p>}
              {house.income.map(row => <p key={row.id} className="m">{row.date} · {gbp(row.amount)}{row.note ? ` · ${row.note}` : ""}</p>)}
            </form>
            <form className="house-panel" onSubmit={e => { e.preventDefault(); send("/v1/finance/petty", petty); }}>
              <h3>Petty cash signed out</h3>
              <p className="m">The amount signed out today. There is no opening balance.</p>
              <label>Date<input type="date" required value={petty.on_date} onChange={e => setPetty({ ...petty, on_date: e.target.value })} /></label>
              <label>Amount<input required inputMode="decimal" value={petty.amount} onChange={e => setPetty({ ...petty, amount: e.target.value })} /></label>
              <label>Signed out by
                <select required value={petty.signed_out_by} onChange={e => setPetty({ ...petty, signed_out_by: e.target.value })}>
                  <option value="">Choose a person</option>
                  {house.signers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label>Note<input value={petty.note} onChange={e => setPetty({ ...petty, note: e.target.value })} /></label>
              <button className="btn primary" type="submit">Save float</button>
              {house.petty.length === 0 && <p className="m">No float signed out in this period.</p>}
              {house.petty.map(row => <p key={row.id} className="m">{row.date} · {gbp(row.amount)} · {row.signedOutBy}</p>)}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
