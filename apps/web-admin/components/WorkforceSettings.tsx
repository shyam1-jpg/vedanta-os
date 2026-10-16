"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }

export default function WorkforceSettings() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { api("/v1/workforce-desk/leave/policies").then(setData).catch(e => setErr(errText(e))); }, []);
  if (!data) return <p className="m">{err || "Opening settings…"}</p>;
  return (
    <form className="kit-card" onSubmit={async event => {
      event.preventDefault();
      try {
        await api("/v1/workforce-desk/settings", { method: "PUT", body: JSON.stringify({ weekly_cap: Number(data.contract.weekly_cap), default_contracted: Number(data.contract.default_contracted), after_hours: Number(data.overtime.after_hours), multiplier: Number(data.overtime.multiplier), policies: data.policies }) });
        setNote("Saved."); setErr("");
      } catch (e) { setErr(errText(e)); }
    }}>
      <h2>Contract rules</h2>
      {err && <div className="note">{err}</div>}
      {note && <p className="wf-warn">{note}</p>}
      <p className="m">The working-time cap stops the rota. The default contracted hours are what auto-schedule uses when a person has none of their own.</p>
      <label>Weekly cap, hours<input disabled={!data.can_edit} value={data.contract.weekly_cap} onChange={e => setData({ ...data, contract: { ...data.contract, weekly_cap: e.target.value } })} /></label>
      <label>Default contracted hours<input disabled={!data.can_edit} value={data.contract.default_contracted} onChange={e => setData({ ...data, contract: { ...data.contract, default_contracted: e.target.value } })} /></label>
      <h2>Overtime rules</h2>
      <label>Overtime starts after, hours<input disabled={!data.can_edit} value={data.overtime.after_hours} onChange={e => setData({ ...data, overtime: { ...data.overtime, after_hours: e.target.value } })} /></label>
      <label>Multiplier<input disabled={!data.can_edit} value={data.overtime.multiplier} onChange={e => setData({ ...data, overtime: { ...data.overtime, multiplier: e.target.value } })} /></label>
      <h2>Leave policies</h2>
      <p className="m">The leave year runs {data.year.from} to {data.year.until}.</p>
      {(data.policies ?? []).map((policy: any) => (
        <div key={policy.id} className="frow">
          <strong>{policy.name}</strong>
          <label>{policy.method === "fixed" ? "Days" : "Percent"}<input disabled={!data.can_edit} value={policy.method === "fixed" ? policy.days : policy.accrual_percent} onChange={e => setData({ ...data, policies: data.policies.map((item: any) => item.id === policy.id ? { ...item, [policy.method === "fixed" ? "days" : "accrual_percent"]: Number(e.target.value) } : item) })} /></label>
        </div>
      ))}
      {data.can_edit && <button className="kit-add" type="submit">Save settings</button>}
      {!data.can_edit && <p className="m">The owner or a general manager edits these rules.</p>}
    </form>
  );
}
