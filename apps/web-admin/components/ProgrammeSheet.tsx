"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";

type Programme = {
  id: string; name: string; lead_teacher: string | null; style: string | null;
  arrival: string; departure: string; guests: number | null; status: string;
  group_name: string | null; items: Item[]; dept_work: DeptWork[];
};
type Item = {
  id: string; day_offset: number; start_time: string; end_time: string | null;
  kind: string; title: string; location: string | null; teacher: string | null;
  covers: number | null; notes: string | null; departments: string[];
};
type DeptWork = {
  id: string; department: string; work_date: string; work_time: string | null;
  title: string; description: string | null; status: string; assignee_name: string | null;
};

const KIND_ICON: Record<string, string> = {
  meal: "🍽", session: "🧘", activity: "✨", transfer: "🚗", free: "☀️", ceremony: "🪔"
};
const DEPT_COLOUR: Record<string, string> = {
  kitchen: "CONFIRMED", halls: "PROVISIONAL", housekeeping: "IN_HOUSE",
  transport: "ENQUIRY", maintenance: "CANCELLED",
};

export default function ProgrammeSheet() {
  const { can } = useStore();
  const [programmes, setProgrammes] = useState<{ id: string; name: string; arrival: string; departure: string; status: string; group_name: string | null }[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [prog, setProg] = useState<Programme | null>(null);
  const [tab, setTab] = useState<"schedule" | "dept_work">("schedule");
  const [deptFilter, setDeptFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ day_offset: 0, start_time: "09:00", end_time: "", kind: "session", title: "", location: "", teacher: "", covers: "", notes: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api<{ items: typeof programmes }>("/v1/programmes").then(r => setProgrammes(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selId) return;
    api<Programme>(`/v1/programmes/${selId}`).then(setProg).catch(() => {});
  }, [selId]);

  const reload = () => { if (selId) api<Programme>(`/v1/programmes/${selId}`).then(setProg).catch(() => {}); };

  const addItem = async () => {
    if (!selId || !draft.title || !draft.start_time) return;
    try {
      await api(`/v1/programmes/${selId}/items`, {
        method: "POST",
        body: JSON.stringify({ ...draft, day_offset: Number(draft.day_offset), covers: draft.covers ? Number(draft.covers) : null, end_time: draft.end_time || null }),
      });
      setAdding(false);
      setDraft({ day_offset: 0, start_time: "09:00", end_time: "", kind: "session", title: "", location: "", teacher: "", covers: "", notes: "" });
      reload(); say("Added to schedule — dept work regenerated");
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Failed to add"); }
  };

  const deleteItem = async (itemId: string) => {
    if (!selId || !confirm("Remove this item and regenerate dept work?")) return;
    await api(`/v1/programmes/${selId}/items/${itemId}`, { method: "DELETE" });
    reload(); say("Removed");
  };

  const updateDeptWork = async (id: string, status: string) => {
    await api(`/v1/dept-work/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    reload();
  };

  // Group items by day
  const days = prog ? [...new Set(prog.items.map(i => i.day_offset))].sort((a, b) => a - b) : [];
  const itemsByDay: Record<number, Item[]> = {};
  for (const item of prog?.items ?? []) {
    if (!itemsByDay[item.day_offset]) itemsByDay[item.day_offset] = [];
    itemsByDay[item.day_offset].push(item);
  }

  const filteredWork = (prog?.dept_work ?? []).filter(w => deptFilter === "all" || w.department === deptFilter);
  const depts = [...new Set((prog?.dept_work ?? []).map(w => w.department))].sort();

  const dayLabel = (offset: number) => {
    if (!prog) return `Day ${offset + 1}`;
    const d = new Date(prog.arrival + "T12:00:00");
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", height: "100%", overflow: "hidden" }}>
      {/* Programme list */}
      <div style={{ borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 16px 12px" }}>
          <h1>Programmes</h1>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {programmes.length === 0 && <p className="m" style={{ color: "var(--ink-2)", padding: "0 8px" }}>No programme sheets yet.</p>}
          {programmes.map(p => (
            <div key={p.id} className={selId === p.id ? "list-row active" : "list-row"}
              onClick={() => setSelId(p.id)}
              style={{ padding: "10px 12px", cursor: "pointer", borderRadius: 8, marginBottom: 2 }}>
              <b style={{ fontSize: 14 }}>{p.name}</b>
              {p.group_name && <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{p.group_name}</div>}
              <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>
                {p.arrival} → {p.departure}
                <span className={`chip ${p.status === "published" ? "CONFIRMED" : "ENQUIRY"}`} style={{ fontSize: 10, marginLeft: 6 }}>{p.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Programme detail */}
      {!prog ? (
        <div className="empty">Select a programme to view its operating sheet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid var(--rule)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0 }}>{prog.name}</h2>
                <div className="m" style={{ color: "var(--ink-2)", marginTop: 4 }}>
                  {prog.arrival} → {prog.departure}
                  {prog.lead_teacher ? ` · ${prog.lead_teacher}` : ""}
                  {prog.guests ? ` · ${prog.guests} guests` : ""}
                  {prog.group_name ? ` · ${prog.group_name}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {can("group.update") && (
                  <button className="btn" style={{ fontSize: 12 }}
                    onClick={() => api(`/v1/programmes/${selId}/generate`, { method: "POST" }).then(() => { reload(); say("Dept work regenerated"); })}>
                    ↻ Regenerate dept work
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              {[
                { label: "Schedule items", value: prog.items.length },
                { label: "Dept work items", value: prog.dept_work.length },
                { label: "Done", value: prog.dept_work.filter(w => w.status === "done").length },
                { label: "Pending", value: prog.dept_work.filter(w => w.status === "pending").length },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{s.value}</div>
                  <div className="m" style={{ color: "var(--ink-2)", fontSize: 11 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="seg" style={{ margin: "0 24px", paddingTop: 12 }}>
            {(["schedule", "dept_work"] as const).map(t => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "schedule" ? "Daily schedule" : "Dept work board"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 28px" }}>

            {tab === "schedule" && (
              <>
                {days.map(day => (
                  <div key={day} style={{ marginBottom: 28 }}>
                    <h3 style={{ marginBottom: 12, color: "var(--forest)" }}>Day {day + 1} — {dayLabel(day)}</h3>
                    {(itemsByDay[day] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time)).map(item => (
                      <div key={item.id} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: "1px solid var(--rule)", alignItems: "flex-start" }}>
                        <div style={{ width: 52, color: "var(--ink-2)", fontSize: 13, paddingTop: 2, flexShrink: 0 }}>
                          {item.start_time.slice(0, 5)}
                        </div>
                        <div style={{ fontSize: 18, width: 24, flexShrink: 0 }}>{KIND_ICON[item.kind] ?? "•"}</div>
                        <div style={{ flex: 1 }}>
                          <b style={{ fontSize: 14 }}>{item.title}</b>
                          <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>
                            {item.kind}{item.location ? ` · ${item.location}` : ""}{item.teacher ? ` · ${item.teacher}` : ""}{item.covers ? ` · ${item.covers} covers` : ""}
                          </div>
                          {item.notes && <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>{item.notes}</div>}
                        </div>
                        {can("group.update") && (
                          <button className="btn" style={{ fontSize: 11, padding: "2px 8px", color: "var(--danger)" }} onClick={() => deleteItem(item.id)}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {/* Add item */}
                {can("group.update") && (
                  adding ? (
                    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 16, marginTop: 8 }}>
                      <b style={{ fontSize: 14 }}>Add schedule item</b>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
                        <label>Day<input type="number" min={0} value={draft.day_offset} onChange={e => setDraft(d => ({ ...d, day_offset: Number(e.target.value) }))} /></label>
                        <label>Start<input type="time" value={draft.start_time} onChange={e => setDraft(d => ({ ...d, start_time: e.target.value }))} /></label>
                        <label>End<input type="time" value={draft.end_time} onChange={e => setDraft(d => ({ ...d, end_time: e.target.value }))} /></label>
                        <label>Kind
                          <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}>
                            {["session", "meal", "activity", "transfer", "ceremony", "free"].map(k => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </label>
                        <label style={{ gridColumn: "span 2" }}>Title<input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
                        <label>Location<input value={draft.location} onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} /></label>
                        <label>Teacher<input value={draft.teacher} onChange={e => setDraft(d => ({ ...d, teacher: e.target.value }))} /></label>
                        <label>Covers<input type="number" value={draft.covers} onChange={e => setDraft(d => ({ ...d, covers: e.target.value }))} /></label>
                        <label style={{ gridColumn: "span 3" }}>Notes<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} /></label>
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                        <button className="btn primary" disabled={!draft.title} onClick={addItem}>Add item</button>
                        <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>+ Add schedule item</button>
                  )
                )}
              </>
            )}

            {tab === "dept_work" && (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <button className={deptFilter === "all" ? "btn primary" : "btn"} onClick={() => setDeptFilter("all")}>All</button>
                  {depts.map(d => (
                    <button key={d} className={deptFilter === d ? "btn primary" : "btn"} onClick={() => setDeptFilter(d)}>{d}</button>
                  ))}
                </div>
                {filteredWork.length === 0
                  ? <p className="m" style={{ color: "var(--ink-2)" }}>No dept work items. Add schedule items first, then click "Regenerate dept work".</p>
                  : filteredWork.map(w => (
                    <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span className={`chip ${DEPT_COLOUR[w.department] ?? "ENQUIRY"}`} style={{ fontSize: 11, minWidth: 80, textAlign: "center" }}>{w.department}</span>
                        <div>
                          <div style={{ fontSize: 14 }}><b>{w.title}</b></div>
                          <div className="m" style={{ color: "var(--ink-2)", fontSize: 12 }}>
                            {w.work_date}{w.work_time ? " " + w.work_time.slice(0, 5) : ""}
                            {w.assignee_name ? ` · ${w.assignee_name}` : ""}
                            {w.description ? ` · ${w.description}` : ""}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className={`chip ${w.status === "done" ? "CONFIRMED" : w.status === "in_progress" ? "IN_HOUSE" : "ENQUIRY"}`} style={{ fontSize: 11 }}>
                          {w.status}
                        </span>
                        {w.status !== "done" && (
                          <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }}
                            onClick={() => updateDeptWork(w.id, w.status === "pending" ? "in_progress" : "done")}>
                            {w.status === "pending" ? "Start" : "Done ✓"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
