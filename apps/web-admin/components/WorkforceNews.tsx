"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

function errText(e: unknown) { return e instanceof ApiError ? e.problem.detail : "Something went wrong"; }
const empty = { title: "", body: "", department: "", staff_group: "", location: "", starts_at: "" };

export default function WorkforceNews() {
  const [data, setData] = useState<any>(null);
  const [news, setNews] = useState({ ...empty });
  const [event, setEvent] = useState({ ...empty });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = () => api("/v1/workforce-desk/news").then(setData);
  useEffect(() => { load().catch(e => setErr(errText(e))); }, []);
  if (!data) return <p className="m">{err || "Opening news…"}</p>;
  const depts = data.departments ?? [];
  const target = (value: typeof empty, set: (v: typeof empty) => void) => (
    <>
      <label>Department<select value={value.department} onChange={e => set({ ...value, department: e.target.value })}><option value="">Whole house</option>{depts.map((d: any) => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
      <label>Group<select value={value.staff_group} onChange={e => set({ ...value, staff_group: e.target.value })}><option value="">Every group</option>{(data.groups ?? []).map((g: any) => <option key={g.code} value={g.code}>{g.name}</option>)}</select></label>
    </>
  );
  return (
    <>
      {err && <div className="note">{err}</div>}
      <div className="wf-home">
        <article className="kit-card">
          <h2>News</h2>
          {(data.news ?? []).map((item: any) => (
            <p key={item.id}><strong>{item.title}</strong> <span className="m">{item.department || "House"}{item.staff_group ? ` · ${item.staff_group}` : ""}</span>
              <button type="button" className="kit-text" onClick={() => setEdit(item)}>Edit</button>
            </p>
          ))}
          <form onSubmit={async e => { e.preventDefault(); try { await api("/v1/workforce-desk/news", { method: "POST", body: JSON.stringify(news) }); setNews({ ...empty }); load(); } catch (e2) { setErr(errText(e2)); } }}>
            <label>Title<input value={news.title} onChange={e => setNews({ ...news, title: e.target.value })} required /></label>
            <label>Body<textarea value={news.body} onChange={e => setNews({ ...news, body: e.target.value })} rows={3} /></label>
            {target(news, setNews)}
            <button className="kit-add" type="submit">Post news</button>
          </form>
        </article>
        <article className="kit-card">
          <h2>Events</h2>
          {(data.events ?? []).map((item: any) => <p key={item.id}><strong>{item.title}</strong> <span className="m">{item.location} · {item.department || "House"}{item.staff_group ? ` · ${item.staff_group}` : ""}</span></p>)}
          <form onSubmit={async e => { e.preventDefault(); try { await api("/v1/workforce-desk/events", { method: "POST", body: JSON.stringify({ ...event, starts_at: event.starts_at.length === 16 ? `${event.starts_at}:00` : event.starts_at }) }); setEvent({ ...empty }); load(); } catch (e2) { setErr(errText(e2)); } }}>
            <label>Title<input value={event.title} onChange={e => setEvent({ ...event, title: e.target.value })} required /></label>
            <label>When<input type="datetime-local" value={event.starts_at} onChange={e => setEvent({ ...event, starts_at: e.target.value })} required /></label>
            <label>Where<input value={event.location} onChange={e => setEvent({ ...event, location: e.target.value })} /></label>
            {target(event, setEvent)}
            <button className="kit-add" type="submit">Add event</button>
          </form>
        </article>
      </div>
      {edit && (
        <form className="kit-card" onSubmit={async e => { e.preventDefault(); try { await api(`/v1/workforce-desk/news/${edit.id}`, { method: "PATCH", body: JSON.stringify(edit) }); setEdit(null); load(); } catch (e2) { setErr(errText(e2)); } }}>
          <h2>Edit news</h2>
          <label>Title<input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
          <label>Body<textarea value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} rows={4} /></label>
          <label>Department<select value={edit.department ?? ""} onChange={e => setEdit({ ...edit, department: e.target.value })}><option value="">Whole house</option>{depts.map((d: any) => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
          <label>Group<select value={edit.staff_group ?? ""} onChange={e => setEdit({ ...edit, staff_group: e.target.value })}><option value="">Every group</option>{(data.groups ?? []).map((g: any) => <option key={g.code} value={g.code}>{g.name}</option>)}</select></label>
          <button className="kit-add" type="submit">Save</button>
        </form>
      )}
    </>
  );
}
