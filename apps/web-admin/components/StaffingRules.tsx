"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { HOUSE_DEPARTMENTS } from "../../../domains/finance/back-office.ts";

type Line = { code: string; name: string; planFor: number | null; required: number | null };
type Data = { today: string; guests: number | null; guestsKnown: boolean; canSave: boolean; lines: Line[]; plans: { guestCount: number; department: string; required: number }[] };

export default function StaffingRules() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ guest_count: "", department: "KITCHEN", required: "" });

  const load = () => api<Data>("/v1/labour/staffing").then(setData).catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not load staffing rules."));
  useEffect(() => { load(); }, []);

  return (
    <section className="house-panel" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Staffing for the guest count</h2>
      <p className="m">A number appears only when a manager has saved a rule. Nothing here invents a headcount.</p>
      {error && <div className="note" role="alert">{error}</div>}
      {data && (
        <>
          <p>{data.guestsKnown ? `${data.guests} guests in house on ${data.today}.` : `Guest count is not recorded for everyone in house on ${data.today}.`}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 12 }}>
            <thead><tr>{["Department", "Required", "Rule used"].map(h => <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.lines.map(line => (
                <tr key={line.code} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: 8 }}>{line.name}</td>
                  <td style={{ padding: 8 }}>{line.required == null ? "—" : line.required}</td>
                  <td style={{ padding: 8 }}>{line.planFor == null ? "—" : `Saved for ${line.planFor} guests`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.canSave && (
            <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async e => {
              e.preventDefault();
              setError("");
              try {
                await api("/v1/labour/staffing", { method: "POST", body: JSON.stringify(form) });
                setForm(f => ({ ...f, required: "" }));
                load();
              } catch (err) { setError(err instanceof ApiError ? err.problem.detail : "Could not save the rule."); }
            }}>
              <label>Guest count<input required inputMode="numeric" value={form.guest_count} onChange={e => setForm({ ...form, guest_count: e.target.value })} /></label>
              <label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{HOUSE_DEPARTMENTS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
              <label>People required<input required inputMode="numeric" value={form.required} onChange={e => setForm({ ...form, required: e.target.value })} /></label>
              <button className="btn primary" type="submit">Save rule</button>
            </form>
          )}
          {data.plans.length > 0 && <p className="m" style={{ marginTop: 8 }}>Saved rules: {data.plans.map(p => `${p.guestCount} guests · ${p.department} · ${p.required}`).join("; ")}</p>}
        </>
      )}
    </section>
  );
}
