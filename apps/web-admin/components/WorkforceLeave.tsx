"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }

export default function WorkforceLeave() {
  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<any>(null);
  const [policies, setPolicies] = useState<any>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ from: "", to: "", note: "", kind: "holiday" });
  const load = async () => {
    setData(await api("/v1/workforce-desk/leave"));
    setAccounts(await api("/v1/workforce-desk/leave/accounts"));
    setPolicies(await api("/v1/workforce-desk/leave/policies"));
  };
  useEffect(() => { load().catch(e => setErr(errText(e))); }, []);
  const rows = (kind: string) => (accounts?.accounts ?? []).filter((row: any) => row.kind === kind);
  const table = (title: string, kind: string) => (
    <article className="kit-card">
      <h2>{title}</h2>
      <div className="kit-sheet">
        <div className="wf-account">
          <span>Person</span><span>Valid from</span><span>Until</span><span>Rate</span><span>Start</span><span>Accrued</span><span>Used</span><span>Available</span>
        </div>
        {rows(kind).map((row: any) => (
          <div className="wf-account" key={row.user_id + kind}>
            <strong>{row.name}</strong>
            <span>{row.valid_from}</span>
            <span>{row.valid_until}</span>
            <span>{kind === "hourly" ? `${row.accruing_rate}%` : kind === "annual" ? "28 days" : "TOIL"}</span>
            <span>{row.start_balance}</span>
            <span>{row.accrued}</span>
            <span>{row.used}</span>
            <span>{row.available}</span>
          </div>
        ))}
        {!rows(kind).length && <p className="kit-empty">No {title.toLowerCase()} yet.</p>}
      </div>
    </article>
  );
  if (!data || !accounts) return <p className="m">{err || "Opening leave…"}</p>;
  return (
    <>
      {err && <div className="note">{err}</div>}
      <p className="m">Leave year {accounts.year?.from} to {accounts.year?.until}. Annual leave is a fixed {policies?.annual_days ?? 28} days. Hourly accrual is {policies?.hourly_percent ?? 12.07}% of hours worked.</p>
      {table("Annual leave", "annual")}
      {table("Hourly accrual", "hourly")}
      {table("Time off in lieu", "toil")}
      {data.can_approve && <BalanceForm people={rows("annual")} onSaved={load} />}
      <article className="kit-card">
        <h2>Manage leave</h2>
        <form onSubmit={async event => { event.preventDefault(); try { await api("/v1/workforce-desk/leave", { method: "POST", body: JSON.stringify(form) }); setForm({ from: "", to: "", note: "", kind: "holiday" }); load(); } catch (e) { setErr(errText(e)); } }}>
          <div className="frow">
            <label>Kind<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="holiday">Annual leave</option><option value="toil">Time off in lieu</option><option value="hourly">Hourly leave</option><option value="sickness">Sickness</option></select></label>
            <label>From<input type="date" required value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
            <label>To<input type="date" required value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
            <label>Note<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          <button className="kit-add" type="submit">Request</button>
        </form>
        {data.can_approve && <button type="button" className="kit-outline" onClick={async () => {
          const res = await fetch(API + "/v1/workforce-desk/leave/export", { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement("a"); a.href = url; a.download = "leave.csv"; a.click();
        }}>Export CSV</button>}
        {(data.items ?? []).map((item: any) => (
          <p key={item.id}><strong>{item.name}</strong> · {item.kind} · {item.from_date} to {item.to_date} · {item.days} · {item.status}
            {data.can_approve && item.status === "pending" && <>
              <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/leave/${item.id}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) }); load(); }}>Approve</button>
              <button type="button" className="kit-outline" onClick={async () => { await api(`/v1/workforce-desk/leave/${item.id}/decide`, { method: "POST", body: JSON.stringify({ approve: false }) }); load(); }}>Decline</button>
            </>}
          </p>
        ))}
      </article>
    </>
  );
}

function BalanceForm({ people, onSaved }: { people: any[]; onSaved: () => void }) {
  const [form, setForm] = useState({ user_id: "", kind: "toil", start_balance: "0", accrued: "0", accruing_rate: "0" });
  return (
    <form className="kit-card" onSubmit={async event => { event.preventDefault(); await api("/v1/workforce-desk/leave/accounts", { method: "PUT", body: JSON.stringify({ ...form, start_balance: Number(form.start_balance), accrued: Number(form.accrued), accruing_rate: Number(form.accruing_rate) }) }); onSaved(); }}>
      <h2>Adjust an account</h2>
      <div className="frow">
        <label>Person<select required value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}><option value="">Choose</option>{people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></label>
        <label>Account<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="annual">Annual leave</option><option value="hourly">Hourly accrual</option><option value="toil">Time off in lieu</option></select></label>
        <label>Start balance<input value={form.start_balance} onChange={e => setForm({ ...form, start_balance: e.target.value })} /></label>
        <label>Accrued<input value={form.accrued} onChange={e => setForm({ ...form, accrued: e.target.value })} /></label>
        <label>Accruing rate<input value={form.accruing_rate} onChange={e => setForm({ ...form, accruing_rate: e.target.value })} /></label>
      </div>
      <button className="kit-add" type="submit">Save account</button>
    </form>
  );
}
