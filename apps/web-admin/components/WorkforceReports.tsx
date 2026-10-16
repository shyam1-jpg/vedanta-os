"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function monday() { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); }
function addDays(day: string, n: number) { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); }

export default function WorkforceReports() {
  const [filters, setFilters] = useState({ kind: "hours", from: monday(), to: addDays(monday(), 6), user_id: "", department: "", group: "", shift_type: "", status: "all", days: "1,2,3,4,5,6,7", subtract_breaks: true });
  const [people, setPeople] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<any>("/v1/workforce-desk/people").then(r => setPeople(r.people ?? [])).catch(() => {}); }, []);
  const query = () => {
    const q = new URLSearchParams({ ...filters, subtract_breaks: filters.subtract_breaks ? "1" : "0" } as any);
    return q.toString();
  };
  useEffect(() => { api(`/v1/workforce-desk/reports/view?${query()}`).then(setData).catch(e => setErr(errText(e))); }, [filters.kind, filters.from, filters.to, filters.user_id, filters.department, filters.group, filters.shift_type, filters.status, filters.days, filters.subtract_breaks]);
  const groups = [...new Map(people.map(p => [p.role_name, p])).values()];
  async function download(format: "csv" | "xls") {
    const res = await fetch(`${API}/v1/workforce-desk/reports/view?${query()}&format=${format}`, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${filters.kind}.${format === "xls" ? "xls" : "csv"}`; a.click();
  }
  return (
    <>
      {err && <div className="note">{err}</div>}
      <div className="kit-pagehead">
        <div className="kit-seg">
          {[["hours", "Hours"], ["shifts", "Shifts"], ["types", "Shift types"], ["timesheet", "Timesheet"]].map(([id, label]) => <button type="button" key={id} className={filters.kind === id ? "on" : ""} onClick={() => setFilters({ ...filters, kind: id })}>{label}</button>)}
        </div>
        <button type="button" className="kit-outline" onClick={() => download("csv")}>CSV</button>
        <button type="button" className="kit-outline" onClick={() => download("xls")}>Excel</button>
      </div>
      <form className="kit-card frow" onSubmit={event => event.preventDefault()}>
        <label>From<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>To<input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
        <label>Employee<select value={filters.user_id} onChange={e => setFilters({ ...filters, user_id: e.target.value })}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Department<select value={filters.department} onChange={e => setFilters({ ...filters, department: e.target.value })}><option value="">All</option>{["KITCHEN", "HK", "FRONT", "RESTAURANT", "MAINT", "GROUNDS"].map(d => <option key={d}>{d}</option>)}</select></label>
        <label>Group<select value={filters.group} onChange={e => setFilters({ ...filters, group: e.target.value })}><option value="">All</option>{groups.map((p: any) => <option key={p.role_name} value={p.role_name}>{p.role_name}</option>)}</select></label>
        <label>Shift type<select value={filters.shift_type} onChange={e => setFilters({ ...filters, shift_type: e.target.value })}><option value="">All</option><option value="shift">shift</option><option value="open">open</option></select></label>
        <label>Status<select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="all">All</option><option value="draft">Draft</option><option value="published">Published</option><option value="approved">Approved</option></select></label>
        <label>Working days<input value={filters.days} onChange={e => setFilters({ ...filters, days: e.target.value })} aria-label="Working days, Monday is 1" /></label>
        <label className="kit-check"><input type="checkbox" checked={filters.subtract_breaks} onChange={e => setFilters({ ...filters, subtract_breaks: e.target.checked })} />Subtract breaks</label>
      </form>
      {!data && <p className="m">Opening the report…</p>}
      {data?.kind === "types" && <article className="kit-card">{data.types.map((row: any) => <p key={row.shift_type}><strong>{row.shift_type}</strong> · {row.count} shifts · {row.hours}h</p>)}{!data.types.length && <p className="m">No shifts in this range.</p>}</article>}
      {data && data.kind !== "types" && (
        <div className="kit-sheet">
          {(data.rows ?? []).map((row: any, i: number) => <p key={i} className="kit-row" style={{ height: "auto" }}><strong>{row.name}</strong><span className="m">{row.department} {row.group} · {row.shifts} shifts · {row.hours}h · previous period {row.compare_hours}h</span></p>)}
          {!data.rows?.length && <p className="kit-empty">Nothing in this range.</p>}
        </div>
      )}
    </>
  );
}
