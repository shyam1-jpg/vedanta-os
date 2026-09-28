"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";

type Shift = {
  id?: string;
  date: string;
  department: string;
  code: string;
  label: string;
  start: string;
  end: string;
  hours?: number;
  userId: string | null;
  name: string | null;
  role: string | null;
  gap: boolean;
  gapReason: string | null;
  lieuHours: number;
  placeholder: boolean;
  note?: string | null;
  breakMinutes?: number;
};
type Person = {
  userId: string;
  name: string;
  role: string;
  department: string;
  earliestStart: string | null;
  latesOnly: boolean;
  latesFrom: string;
  neverKp: boolean;
  canDoKp: boolean;
  opensKitchen: boolean;
  maxHoursWeek: number | null;
  maxHoursMonth: number | null;
  unavailableWeekdays: number[];
  earliestByWeekday: Record<string, string>;
};
type Band = { label: string; minGuests: number; maxGuests: number | null; shifts: { code: string; label: string; start: string; end: string; count: number; kp: boolean; opener: boolean; roleCodes: string[] }[] };
type Rule = { department: string; placeholder: boolean; note?: string; bands: Band[] };
type Dept = { code: string; name: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOf(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmt(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function AutoRota() {
  const { can } = useStore();
  const edit = can("clock.manage");
  const [week, setWeek] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const [guests, setGuests] = useState<Record<string, string>>({});
  const [rangeCount, setRangeCount] = useState("32");
  const [department, setDepartment] = useState("ALL");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

  const loadSetup = () => api<{ rules: Rule[]; people: Person[]; departments: Dept[] }>("/v1/rota/setup").then(r => {
    setRules(r.rules); setPeople(r.people); setDepts(r.departments);
  }).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the rota"));

  const loadPlan = (from: string) => {
    const to = addDays(from, 6);
    api<{ items: Shift[] }>(`/v1/rota/plan?from=${from}&to=${to}`).then(r => {
      if (r.items.length) setShifts(r.items);
    }).catch(() => {});
  };

  useEffect(() => { loadSetup(); }, []);
  useEffect(() => { loadPlan(week); }, [week]);

  const deptName = (code: string) => depts.find(d => d.code === code)?.name ?? code;
  const visible = shifts.filter(s => department === "ALL" || s.department === department);
  const deptCodes = [...new Set(shifts.map(s => s.department))];

  const fillWeek = () => {
    const n = rangeCount.trim();
    setGuests(Object.fromEntries(days.map(d => [d, n])));
  };

  const generate = async () => {
    setBusy(true);
    try {
      const body = {
        from: days[0],
        to: days[6],
        days: days.filter(d => guests[d] !== undefined && guests[d] !== "").map(d => ({ date: d, guests: Number(guests[d]) })),
        guests: rangeCount === "" ? undefined : Number(rangeCount),
      };
      const r = await api<{ shifts: Shift[]; warnings: string[] }>("/v1/rota/generate", { method: "POST", body: JSON.stringify(body) });
      setShifts(r.shifts);
      setWarnings(r.warnings ?? []);
      say(`Rota built. ${r.shifts.filter(s => s.gap).length} gap${r.shifts.filter(s => s.gap).length === 1 ? "" : "s"}. Save it as a draft when it looks right.`);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not build the rota"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const guest_counts = Object.fromEntries(days.filter(d => guests[d] !== undefined && guests[d] !== "").map(d => [d, Number(guests[d])]));
      await api("/v1/rota/draft", { method: "POST", body: JSON.stringify({ week_start: week, guest_counts, shifts }) });
      say("Draft saved");
      loadPlan(week);
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
    finally { setBusy(false); }
  };

  const assign = (index: number, userId: string) => {
    setShifts(list => list.map((s, i) => {
      if (i !== index) return s;
      const person = people.find(p => p.userId === userId);
      return { ...s, userId: userId || null, name: person?.name ?? null, role: person?.role ?? null, gap: !userId, gapReason: userId ? null : "Left open by hand" };
    }));
  };

  const csv = () => {
    const header = "date,department,shift,start,end,person,gap,gap_reason,lieu_hours,placeholder";
    const lines = visible.map(s => [s.date, deptName(s.department), s.label, s.start, s.end, s.name ?? "", s.gap ? "GAP" : "", s.gapReason ?? "", s.lieuHours ?? 0, s.placeholder ? "PLACEHOLDER" : ""].map(v => /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : v).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rota-${week}.csv`;
    a.click();
  };

  const shiftIndex = (s: Shift) => shifts.indexOf(s);

  return (
    <div className="rota-page">
      <div className="topbar">
        <div>
          <div className="kicker">People</div>
          <h1>Auto rota</h1>
          <p>Enter guest numbers for a day or a whole week. The house builds a rota for every department from the staffing settings. Kitchen levels follow the 30–35 guest pilot. Other departments are marked PLACEHOLDER until you change them.</p>
        </div>
      </div>

      <div className="panel no-print">
        <div className="frow" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn" onClick={() => setWeek(addDays(week, -7))}>‹ Prev week</button>
          <strong>{fmt(days[0])} – {fmt(days[6])}</strong>
          <button className="btn" onClick={() => setWeek(addDays(week, 7))}>Next week ›</button>
          <label className="m">Same count every day <input style={{ width: 80 }} value={rangeCount} onChange={e => setRangeCount(e.target.value)} /></label>
          <button className="btn" onClick={fillWeek}>Fill the week</button>
          <select className="btn" value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="ALL">All departments</option>
            {depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
          </select>
        </div>
        <div className="rota-guests">
          {days.map((d, i) => (
            <label key={d}>{WEEKDAYS[i]} {fmt(d).split(" ").slice(1).join(" ")}
              <input value={guests[d] ?? ""} placeholder={rangeCount || "0"} onChange={e => setGuests(g => ({ ...g, [d]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="actions" style={{ border: 0 }}>
          {edit && <button className="btn primary" disabled={busy} onClick={generate}>Build rota</button>}
          {edit && <button className="btn" disabled={busy || !shifts.length} onClick={save}>Save draft</button>}
          <button className="btn" disabled={!visible.length} onClick={csv}>Download CSV</button>
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn" onClick={() => setShowSettings(v => !v)}>{showSettings ? "Hide staffing settings" : "Staffing settings"}</button>
          <button className="btn" onClick={() => setShowPeople(v => !v)}>{showPeople ? "Hide people’s rules" : "People’s rules"}</button>
        </div>
      </div>

      {warnings.length > 0 && <div className="note no-print" style={{ marginTop: 12 }}>{warnings.slice(0, 6).join(" ")}</div>}

      <div className="rota-grid" style={{ marginTop: 16 }}>
        <div className="rota-row rota-labels">
          <div className="rota-dept">Department</div>
          {days.map(d => <div key={d} className="rota-head">{fmt(d)}<small>{guests[d] ? `${guests[d]} guests` : ""}</small></div>)}
        </div>
        {(department === "ALL" ? deptCodes : deptCodes.filter(c => c === department)).map(code => (
          <div key={code} className="rota-row">
            <div className="rota-dept">{deptName(code)}{rules.find(r => r.department === code)?.placeholder ? <em>PLACEHOLDER</em> : null}</div>
            {days.map(d => (
              <div key={d} className="rota-cell">
                {visible.filter(s => s.department === code && s.date === d).map(s => (
                  <div key={`${s.date}-${s.code}-${s.start}-${shiftIndex(s)}`} className={"rota-shift" + (s.gap ? " gap" : "")}>
                    <b>{s.start}–{s.end}</b>
                    <span>{s.label}</span>
                    {edit ? (
                      <select value={s.userId ?? ""} onChange={e => assign(shiftIndex(s), e.target.value)}>
                        <option value="">GAP</option>
                        {people.filter(p => p.department === s.department).map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                      </select>
                    ) : <strong>{s.gap ? "GAP" : s.name}</strong>}
                    {s.gap && <em>{s.gapReason}</em>}
                    {!s.gap && s.lieuHours > 0 && <em>{s.lieuHours}h lieu</em>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {!shifts.length && <p className="m" style={{ marginTop: 16 }}>No rota for this week yet. Put in guest numbers — 32 is the pilot baseline — and choose Build rota.</p>}

      {showSettings && <StaffingEditor rules={rules} canEdit={edit} onSaved={() => { say("Staffing settings saved"); loadSetup(); }} />}
      {showPeople && <PeopleRules people={people} canEdit={edit} onSaved={() => { say("Rules saved"); loadSetup(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function StaffingEditor({ rules, canEdit, onSaved }: { rules: Rule[]; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<Rule[]>(rules);
  const [dept, setDept] = useState(rules[0]?.department ?? "KITCHEN");
  useEffect(() => setDraft(rules), [rules]);
  const current = draft.find(r => r.department === dept);
  const save = async () => {
    await api("/v1/rota/staffing", { method: "PUT", body: JSON.stringify({ departments: draft }) });
    onSaved();
  };
  const patchShift = (bandIndex: number, shiftIndex: number, field: "start" | "end" | "count", value: string) => {
    setDraft(list => list.map(rule => rule.department !== dept ? rule : {
      ...rule,
      bands: rule.bands.map((band, bi) => bi !== bandIndex ? band : {
        ...band,
        shifts: band.shifts.map((shift, si) => si !== shiftIndex ? shift : { ...shift, [field]: field === "count" ? Number(value) : value }),
      }),
    }));
  };
  return (
    <section className="panel no-print" style={{ marginTop: 18 }}>
      <h2>Staffing settings</h2>
      <p className="m">These levels are stored for the house. Kitchen 16–35 is the pilot. Anything marked PLACEHOLDER is a starting guess for the head chef to edit. Food is buffet only and is never billed.</p>
      <div className="seg" style={{ margin: "10px 0" }}>
        {draft.map(r => <button key={r.department} className={dept === r.department ? "on" : ""} onClick={() => setDept(r.department)}>{r.department}{r.placeholder ? " · placeholder" : ""}</button>)}
      </div>
      {current?.note && <p className="note">{current.note}</p>}
      {current?.bands.map((band, bi) => (
        <div key={band.label} style={{ marginTop: 12 }}>
          <h3>{band.label} guests {band.shifts.length === 0 ? "· no shifts" : ""}</h3>
          {band.shifts.map((shift, si) => (
            <div className="frow" key={shift.code + si} style={{ marginTop: 6 }}>
              <span style={{ minWidth: 140 }}>{shift.label}{shift.opener ? " · opens" : ""}{shift.kp ? " · KP" : ""}</span>
              <input value={shift.start} onChange={e => patchShift(bi, si, "start", e.target.value)} style={{ width: 90 }} />
              <input value={shift.end} onChange={e => patchShift(bi, si, "end", e.target.value)} style={{ width: 90 }} />
              <input value={String(shift.count)} onChange={e => patchShift(bi, si, "count", e.target.value)} style={{ width: 60 }} title="How many" />
            </div>
          ))}
        </div>
      ))}
      {canEdit && <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>Save staffing settings</button>}
    </section>
  );
}

function PeopleRules({ people, canEdit, onSaved }: { people: Person[]; canEdit: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState(people);
  useEffect(() => setRows(people), [people]);
  const kitchen = rows.filter(p => p.department === "KITCHEN");
  const save = async (p: Person) => {
    await api(`/v1/rota/constraints/${p.userId}`, { method: "PUT", body: JSON.stringify(p) });
    onSaved();
  };
  const set = (id: string, patch: Partial<Person>) => setRows(list => list.map(p => p.userId === id ? { ...p, ...patch } : p));
  return (
    <section className="panel no-print" style={{ marginTop: 18 }}>
      <h2>People’s rules</h2>
      <p className="m">KP shifts can only be filled by kitchen porters. Head chef, sous chef and chefs de partie are never KP. Head chef or sous chef opens at 07:00. Hours over 40 in a week are marked as lieu. A 21:00 finish is not followed by a 07:00 start. Apply a template, then adjust.</p>
      {kitchen.map(p => (
        <div key={p.userId} className="rota-person">
          <strong>{p.name}</strong>
          <span className="m">{p.role}</span>
          <label>Earliest <input value={p.earliestStart ?? ""} placeholder="07:00" onChange={e => set(p.userId, { earliestStart: e.target.value || null })} /></label>
          <label><input type="checkbox" checked={p.latesOnly} onChange={e => set(p.userId, { latesOnly: e.target.checked })} /> Lates only</label>
          <label><input type="checkbox" checked={p.neverKp} onChange={e => set(p.userId, { neverKp: e.target.checked })} /> Never KP</label>
          <label>Month cap <input value={p.maxHoursMonth ?? ""} style={{ width: 70 }} onChange={e => set(p.userId, { maxHoursMonth: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label>Mon/Tue from <input value={p.earliestByWeekday?.["1"] ?? ""} placeholder="18:00" style={{ width: 80 }} onChange={e => set(p.userId, { earliestByWeekday: { ...p.earliestByWeekday, "1": e.target.value, "2": e.target.value } })} /></label>
          {canEdit && <button className="btn" onClick={() => save(p)}>Save</button>}
        </div>
      ))}
      {kitchen.length === 0 && <p className="m">No kitchen people yet. Add them on Names & positions.</p>}
    </section>
  );
}
