"use client";
import { useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function download(path: string, filename: string) {
  const res = await fetch(API + path, { headers: token.get() ? { authorization: `Bearer ${token.get()}` } : {} });
  if (!res.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
}

export default function ScheduleTools({ from, to, department, people, shiftIds, canManage, hidden, onHide, onChanged }: {
  from: string; to: string; department: string; people: { id: string; name: string }[]; shiftIds: string[];
  canManage: boolean; hidden: { from: string; to: string } | null; onHide: (range: { from: string; to: string } | null) => void; onChanged: () => void;
}) {
  const [panel, setPanel] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(from);
  const [hideFrom, setHideFrom] = useState(from);
  const [hideTo, setHideTo] = useState(from);
  const [picked, setPicked] = useState<string[]>([]);
  const [tool, setTool] = useState<any>(null);
  const [auto, setAuto] = useState({ weeks: 1, exclude_user_ids: [] as string[], exclude_dates: "", use_contracted: true, use_availability: true, use_rules: true, use_patterns: true });

  async function openTemplates() {
    setPanel("templates");
    setTemplates((await api<any>("/v1/workforce-desk/templates")).templates ?? []);
  }
  async function openView(view: string) {
    setPanel(view);
    setTool(await api(`/v1/workforce-desk/schedule/tools?view=${view}&from=${from}&to=${to}${department ? `&department=${department}` : ""}`));
  }

  if (!canManage) return null;
  return (
    <div className="wf-tools">
      <div className="kit-pagehead-actions">
        <button type="button" className="kit-outline" onClick={openTemplates}>Templates</button>
        <button type="button" className="kit-outline" onClick={() => setPanel(panel === "tools" ? "" : "tools")}>Tools</button>
        <button type="button" className="kit-outline" onClick={() => setPanel("auto")}>Auto-schedule</button>
      </div>
      {err && <div className="note">{err}</div>}
      {note && <p className="wf-warn">{note}</p>}
      {panel === "templates" && (
        <article className="kit-card">
          <h2>Schedule templates</h2>
          <form onSubmit={async event => { event.preventDefault(); try { const saved = await api<any>("/v1/workforce-desk/templates/from-week", { method: "POST", body: JSON.stringify({ title, from, to, department: department || "KITCHEN" }) }); setNote(`Saved ${saved.lines} lines.`); setTitle(""); openTemplates(); } catch (e) { setErr(errText(e)); } }}>
            <label>Save this week as<input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Kitchen service week" /></label>
            <button className="kit-add" type="submit">Save week</button>
          </form>
          {templates.map(item => (
            <div key={item.id} className="kit-row" style={{ height: "auto", alignItems: "flex-start" }}>
              <strong>{item.title}</strong>
              <span className="m">{item.department} · {(item.lines ?? []).map((line: any) => `${DAYS[line.weekday] ?? line.weekday} ${String(line.start_time).slice(0, 5)}`).join(", ") || "No lines yet"}</span>
              <div className="kit-pagehead-actions">
                <button type="button" className="kit-outline" onClick={async () => { const next = window.prompt("Template name", item.title); if (!next) return; await api(`/v1/workforce-desk/templates/${item.id}`, { method: "PATCH", body: JSON.stringify({ title: next, lines: item.lines }) }); openTemplates(); }}>Edit name</button>
                <button type="button" className="kit-add" onClick={async () => { try { const r = await api<any>(`/v1/workforce-desk/templates/${item.id}/apply`, { method: "POST", body: JSON.stringify({ week: from }) }); setNote(`Applied ${r.created} draft shifts.`); onChanged(); } catch (e) { setErr(errText(e)); } }}>Apply</button>
              </div>
            </div>
          ))}
          <form onSubmit={async event => { event.preventDefault(); try { const r = await api<any>("/v1/workforce-desk/shifts/copy-week", { method: "POST", body: JSON.stringify({ from, to, target, department }) }); setNote(`Copied ${r.created} shifts as drafts.`); onChanged(); } catch (e) { setErr(errText(e)); } }}>
            <label>Copy this week onto<input type="date" value={target} onChange={e => setTarget(e.target.value)} /></label>
            <button className="kit-outline" type="submit">Copy week</button>
          </form>
        </article>
      )}
      {panel === "tools" && (
        <article className="kit-card">
          <h2>Schedule tools</h2>
          <div className="kit-pagehead-actions">
            <button type="button" className="kit-outline" onClick={async () => { try { const r = await api<any>("/v1/workforce-desk/shifts/approve", { method: "POST", body: JSON.stringify({ ids: shiftIds }) }); setNote(`Approved ${r.approved}.`); onChanged(); } catch (e) { setErr(errText(e)); } }}>Approve shifts in view</button>
            <button type="button" className="kit-outline" onClick={async () => { if (!window.confirm("Delete every shift in this week for the rota you are looking at?")) return; try { const r = await api<any>("/v1/workforce-desk/shifts/clear", { method: "POST", body: JSON.stringify({ from, to, department }) }); setNote(`Deleted ${r.deleted}.`); onChanged(); } catch (e) { setErr(errText(e)); } }}>Delete this week</button>
            <button type="button" className="kit-outline" onClick={() => download(`/v1/workforce-desk/schedule/export?format=csv&from=${from}&to=${to}&department=${department}`, "rota.csv").catch(e => setErr(String(e)))}>Export CSV</button>
            <button type="button" className="kit-outline" onClick={() => download(`/v1/workforce-desk/schedule/export?format=xls&from=${from}&to=${to}&department=${department}`, "rota.xls").catch(e => setErr(String(e)))}>Export Excel</button>
            <button type="button" className="kit-outline" onClick={() => window.print()}>Print</button>
            <button type="button" className="kit-outline" onClick={() => openView("rules")}>Working time rules</button>
            <button type="button" className="kit-outline" onClick={() => openView("contracted")}>Contracted hours</button>
            <button type="button" className="kit-outline" onClick={() => openView("history")}>Schedule history</button>
            <button type="button" className="kit-outline" onClick={() => openView("overview")}>Shifts overview</button>
          </div>
          <form onSubmit={event => { event.preventDefault(); onHide({ from: hideFrom, to: hideTo }); setNote(`Hid ${hideFrom} to ${hideTo}.`); }}>
            <label>Hide from<input type="date" value={hideFrom} onChange={e => setHideFrom(e.target.value)} /></label>
            <label>Until<input type="date" value={hideTo} onChange={e => setHideTo(e.target.value)} /></label>
            <button className="kit-outline" type="submit">{hidden ? "Hide another period" : "Hide period"}</button>
            {hidden && <button type="button" className="kit-text" onClick={() => { onHide(null); setNote("Period shown again."); }}>Show period</button>}
          </form>
        </article>
      )}
      {panel === "auto" && (
        <article className="kit-card">
          <h2>Smart auto-schedule</h2>
          <p className="m">Fills open shifts for the period and leaves them as drafts. Nothing is published.</p>
          <label>Weeks<input type="number" min={1} max={8} value={auto.weeks} onChange={e => setAuto({ ...auto, weeks: Number(e.target.value) })} /></label>
          <p className="m">Period starts {from}. People and dates below are left out.</p>
          <div className="kit-people">{people.map(p => <label key={p.id} className="kit-check"><input type="checkbox" checked={auto.exclude_user_ids.includes(p.id)} onChange={e => setAuto({ ...auto, exclude_user_ids: e.target.checked ? [...auto.exclude_user_ids, p.id] : auto.exclude_user_ids.filter(id => id !== p.id) })} />Exclude {p.name}</label>)}</div>
          <label>Exclude dates, comma separated<input value={auto.exclude_dates} onChange={e => setAuto({ ...auto, exclude_dates: e.target.value })} placeholder="2026-10-19, 2026-10-20" /></label>
          <label className="kit-check"><input type="checkbox" checked={auto.use_contracted} onChange={e => setAuto({ ...auto, use_contracted: e.target.checked })} />Contracted hours</label>
          <label className="kit-check"><input type="checkbox" checked={auto.use_availability} onChange={e => setAuto({ ...auto, use_availability: e.target.checked })} />Contracted and employee availability</label>
          <label className="kit-check"><input type="checkbox" checked={auto.use_rules} onChange={e => setAuto({ ...auto, use_rules: e.target.checked })} />Working time rules (48h)</label>
          <label className="kit-check"><input type="checkbox" checked={auto.use_patterns} onChange={e => setAuto({ ...auto, use_patterns: e.target.checked })} />Past patterns</label>
          <button type="button" className="kit-add" onClick={async () => { try { const r = await api<any>("/v1/workforce-desk/shifts/auto", { method: "POST", body: JSON.stringify({ ...auto, from, department, exclude_dates: auto.exclude_dates.split(",").map(s => s.trim()).filter(Boolean) }) }); setNote(`Created ${r.suggested} drafts. ${r.skipped} stayed open.`); onChanged(); } catch (e) { setErr(errText(e)); } }}>Create drafts</button>
        </article>
      )}
      {tool?.rows && (
        <article className="kit-card">
          <h2>{panel === "rules" ? "Working time rule report" : "Contracted hours"}</h2>
          {tool.rows.map((row: any) => <p key={row.id}>{row.name}: {row.hours}h scheduled{row.contracted ? ` · contracted ${row.contracted}h` : ""}{row.over_cap ? " · over the cap" : ""}{row.over_contract ? " · over contract" : ""}</p>)}
          {!tool.rows.length && <p className="m">Nobody is over.</p>}
        </article>
      )}
      {tool?.items && (
        <article className="kit-card">
          <h2>Schedule history</h2>
          {tool.items.map((item: any, i: number) => <p key={i}><strong>{item.action}</strong> · {item.name} · {item.detail}</p>)}
          {!tool.items.length && <p className="m">No rota changes have been recorded yet.</p>}
        </article>
      )}
      {tool?.shifts && (
        <article className="kit-card">
          <h2>Shifts overview</h2>
          {tool.shifts.map((shift: any) => (
            <label key={shift.id} className="kit-check">
              <input type="checkbox" checked={picked.includes(shift.id)} onChange={e => setPicked(cur => e.target.checked ? [...cur, shift.id] : cur.filter(id => id !== shift.id))} />
              {shift.date} {String(shift.start_time).slice(0, 5)}–{String(shift.end_time).slice(0, 5)} · {shift.name || "Open"} · {shift.department} · {shift.published ? "published" : "draft"}
            </label>
          ))}
          <button type="button" className="kit-add" disabled={!picked.length} onClick={async () => { const r = await api<any>("/v1/workforce-desk/shifts/approve", { method: "POST", body: JSON.stringify({ ids: picked }) }); setNote(`Approved ${r.approved}.`); setPicked([]); onChanged(); }}>Approve selected</button>
        </article>
      )}
    </div>
  );
}
