"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
type Pkg = { id: string; code: string; name: string; price_basis: string; price_twin: string | null; price_single: string | null; includes_spa: boolean; includes_meals: boolean; active: boolean; sort: number };
type Key = { id: string; name: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };
const BASIS: Record<string, string> = { PER_PERSON: "per person", PER_PERSON_PER_NIGHT: "per person per night", FIXED: "fixed price" };

export default function Settings() {
  const { can } = useStore();
  const [pkgs, setPkgs] = useState<Pkg[]>([]); const [keys, setKeys] = useState<Key[]>([]); const [newKey, setNewKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<Pkg>>>({}); const [add, setAdd] = useState({ code: "", name: "", price_basis: "PER_PERSON", price_twin: "", price_single: "" });
  const [newKeyName, setNewKeyName] = useState("");
  const [toast, setToast] = useState<string | null>(null); const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  type RouteBox = { enabled: boolean; email: string };
  const [routes, setRoutes] = useState<{ kitchen: RouteBox; restaurant: RouteBox; front: RouteBox } | null>(null);
  const [routeCopy, setRouteCopy] = useState<Record<string, string>>({});
  const [faultMail, setFaultMail] = useState<{ maintenance: string; manager: string; kitchen: string } | null>(null);
  const [faultAreas, setFaultAreas] = useState("");
  const [faultCopy, setFaultCopy] = useState<Record<string, string>>({});
  const [handoverTags, setHandoverTags] = useState<string | null>(null);
  const [stockMail, setStockMail] = useState<{ kitchen: string; buyer: string } | null>(null);
  const [stockCopy, setStockCopy] = useState<Record<string, string>>({});
  const [stay, setStay] = useState<{ delay_label: string; delay_hours: number | null; retention_days: number; open_maintenance: boolean; emails: { kitchen: string; front: string; housekeeping: string; manager: string } } | null>(null);
  const [comply, setComply] = useState<{ leads: number[]; manager: string } | null>(null);
  const [lostHold, setLostHold] = useState<{ hold_days: number; disposal_days: number; postage_note: string; link_days: number; manager: string; matcher: boolean; purge_days: number } | null>(null);
  const [train, setTrain] = useState<{ leads: number[]; manager: string } | null>(null);
  const [retain, setRetain] = useState<{ allergen_days_after_departure: number; feedback_text_days: number; staff_note_days: number; profile_inactive_months: number } | null>(null);
  const [deposit, setDeposit] = useState<{ amount_gbp: number; policy: string } | null>(null);
  const [audit, setAudit] = useState<{ time: string; gm_email: string; auto_email: boolean } | null>(null);
  const [swaps, setSwaps] = useState<{ min_rest_hours: number; standard_week_hours: number; expire_hours_before: number; board: boolean; approval: Record<string, boolean> } | null>(null);
  const [swapDepts, setSwapDepts] = useState("");
  const [brief, setBrief] = useState<{ severe: number; cold: number; vip: number; compliance: number; staffing: number; heads: Record<string, number> } | null>(null);
  const [orgSettings, setOrgSettings] = useState<{ allow_multiple_gm: boolean; staff_contact: "work" | "none" } | null>(null);
  const [spendSettings, setSpendSettings] = useState<{ gm_email: string; notify_heads: boolean; categories: { code: string; name: string }[] } | null>(null);
  const [roomSettings, setRoomSettings] = useState<{ cutoff_days: number; staff_email: string; reminder_days: number[] } | null>(null);
  const [roomReminders, setRoomReminders] = useState("14, 7, 2");
  const [journey, setJourney] = useState<Record<string, unknown> | null>(null);
  const [stayCopy, setStayCopy] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ rules: { kitchen: RouteBox; restaurant: RouteBox; front: RouteBox }; receives: Record<string, string> }>("/v1/settings/booking-routing")
      .then(r => { setRoutes(r.rules); setRouteCopy(r.receives); }).catch(() => {});
    api<{ areas: string[]; emails: { maintenance: string; manager: string; kitchen: string }; receives: Record<string, string> }>("/v1/settings/fault-routing")
      .then(r => { setFaultMail(r.emails); setFaultAreas(r.areas.join("\n")); setFaultCopy(r.receives); }).catch(() => {});
    api<{ tags: { label: string }[] }>("/v1/settings/handover-tags")
      .then(r => setHandoverTags(r.tags.map(t => t.label).join("\n"))).catch(() => {});
    api<{ emails: { kitchen: string; buyer: string }; receives: Record<string, string> }>("/v1/settings/stock-alerts")
      .then(r => { setStockMail(r.emails); setStockCopy(r.receives); }).catch(() => {});
    api<{ delay_label: string; delay_hours: number | null; retention_days: number; open_maintenance: boolean; emails: { kitchen: string; front: string; housekeeping: string; manager: string }; receives: Record<string, string> }>("/v1/settings/feedback")
      .then(r => { setStay(r); setStayCopy(r.receives); }).catch(() => {});
    api<{ leads: number[]; manager: string }>("/v1/settings/compliance").then(setComply).catch(() => {});
    api<{ hold_days: number; disposal_days: number; postage_note: string; link_days: number; manager: string; matcher?: boolean; purge_days?: number }>("/v1/settings/lost-found").then(row => setLostHold({ ...row, matcher: row.matcher === true, purge_days: row.purge_days ?? 90 })).catch(() => {});
    api<{ leads: number[]; manager: string }>("/v1/settings/training").then(setTrain).catch(() => {});
    api<{ allergen_days_after_departure: number; feedback_text_days: number; staff_note_days: number; profile_inactive_months: number }>("/v1/settings/guest-retention").then(setRetain).catch(() => {});
    api<{ amount_gbp: number; policy: string }>("/v1/settings/deposit").then(setDeposit).catch(() => {});
    api<{ time: string; gm_email: string; auto_email: boolean }>("/v1/settings/night-audit").then(setAudit).catch(() => {});
    api<{ min_rest_hours: number; standard_week_hours: number; expire_hours_before: number; board?: boolean; approval?: Record<string, boolean> }>("/v1/settings/shift-swap").then(row => {
      const approval = row.approval ?? {};
      setSwaps({ ...row, board: row.board === true, approval });
      setSwapDepts(Object.entries(approval).filter(([, on]) => on).map(([name]) => name).join(", "));
    }).catch(() => {});
    api<{ severe: number; cold: number; vip: number; compliance: number; staffing: number; heads: Record<string, number> }>("/v1/settings/briefing").then(setBrief).catch(() => {});
    api<{ allow_multiple_gm: boolean; staff_contact: "work" | "none" }>("/v1/org/settings").then(setOrgSettings).catch(() => {});
    api<{ gm_email: string; notify_heads: boolean; categories: { code: string; name: string }[] }>("/v1/spend/settings").then(setSpendSettings).catch(() => {});
    api<{ cutoff_days: number; staff_email: string; reminder_days?: number[] }>("/v1/room-assign/settings").then(next => { setRoomSettings({ ...next, reminder_days: next.reminder_days ?? [14, 7, 2] }); setRoomReminders((next.reminder_days ?? [14, 7, 2]).join(", ")); }).catch(() => {});
    api<Record<string, unknown>>("/v1/guest-journey/settings").then(setJourney).catch(() => {});
  }, []);
  const load = () => { api<{ items: Pkg[] }>("/v1/packages").then(r => setPkgs(r.items)); if (can("config.manage")) api<{ items: Key[] }>("/v1/integrations/keys").then(r => setKeys(r.items)).catch(() => {}); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); say(ok); load(); } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Something went wrong"); } };
  const d = (p: Pkg) => ({ ...p, ...draft[p.id] });
  const dirty = (p: Pkg) => !!draft[p.id] && Object.keys(draft[p.id]).length > 0;
  return (
    <>
      <div className="topbar"><div><h1>The estate</h1><p>Packages, prices, and keys for the systems that serve the house.</p></div></div>
      <div className="panel">
        <h3>Packages</h3>
        <p className="m" style={{ color: "var(--ink-2)" }}>Prices are per person unless the basis says otherwise. Twin = sharing; single = own room. Changing a price does not change bookings already priced.</p>
        <table className="rpt">
          <thead><tr><th>Package</th><th>Basis</th><th>Twin / price £</th><th>Single £</th><th>Spa</th><th>Meals</th><th>Active</th><th></th></tr></thead>
          <tbody>{pkgs.map(p => { const v = d(p); return (
            <tr key={p.id} style={{ opacity: v.active ? 1 : .5 }}>
              <td><input value={v.name} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], name: e.target.value } }))} style={{ width: "100%" }} /><div className="m" style={{ fontSize: 11, color: "var(--ink-2)" }}>{p.code}</div></td>
              <td><select value={v.price_basis} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], price_basis: e.target.value } }))}>{Object.entries(BASIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input type="number" step="0.01" value={v.price_twin ?? ""} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], price_twin: e.target.value || null } }))} style={{ width: 90 }} /></td>
              <td>{v.price_basis === "FIXED" ? <span className="m">—</span> : <input type="number" step="0.01" value={v.price_single ?? ""} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], price_single: e.target.value || null } }))} style={{ width: 90 }} />}</td>
              <td><input type="checkbox" checked={v.includes_spa} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], includes_spa: e.target.checked } }))} /></td>
              <td><input type="checkbox" checked={v.includes_meals} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], includes_meals: e.target.checked } }))} /></td>
              <td><input type="checkbox" checked={v.active} onChange={e => setDraft(s => ({ ...s, [p.id]: { ...s[p.id], active: e.target.checked } }))} /></td>
              <td>{dirty(p) && <button className="btn primary" onClick={() => run(() => api(`/v1/packages/${p.id}`, { method: "PATCH", body: JSON.stringify(draft[p.id]) }).then(() => setDraft(s => ({ ...s, [p.id]: {} }))), `Saved ${v.name}`)}>Save</button>}</td>
            </tr>); })}
            <tr>
              <td><input placeholder="New package name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value, code: e.target.value.toUpperCase().replace(/\W+/g, "_") })} style={{ width: "100%" }} /></td>
              <td><select value={add.price_basis} onChange={e => setAdd({ ...add, price_basis: e.target.value })}>{Object.entries(BASIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input type="number" step="0.01" value={add.price_twin} onChange={e => setAdd({ ...add, price_twin: e.target.value })} style={{ width: 90 }} /></td>
              <td><input type="number" step="0.01" value={add.price_single} onChange={e => setAdd({ ...add, price_single: e.target.value })} style={{ width: 90 }} /></td>
              <td colSpan={3} />
              <td><button className="btn" disabled={!add.name} onClick={() => run(() => api("/v1/packages", { method: "POST", body: JSON.stringify({ ...add, price_twin: add.price_twin || null, price_single: add.price_single || null }) }).then(() => setAdd({ code: "", name: "", price_basis: "PER_PERSON", price_twin: "", price_single: "" })), `Added ${add.name}`)}>Add</button></td>
            </tr></tbody>
        </table>
      </div>
      {can("config.manage") && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Connected systems</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Keys let another system (the kitchen's Parslia) read covers and dietary needs. A key is shown once when created.</p>
          {newKey && <div className="note" style={{ wordBreak: "break-all" }}><b>New key — copy it now, it will not be shown again:</b><br /><code>{newKey}</code></div>}
          <table className="rpt"><tbody>{keys.map(k => <tr key={k.id} style={{ opacity: k.revoked_at ? .5 : 1 }}><td>{k.name}</td><td className="m">{k.scopes.join(", ")}</td><td className="m">{k.revoked_at ? "revoked" : k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString("en-GB")}` : "never used"}</td><td>{!k.revoked_at && <button className="btn danger" onClick={() => { if (confirm(`Revoke ${k.name}? The other system will stop working immediately.`)) run(() => api(`/v1/integrations/keys/${k.id}`, { method: "DELETE" }), "Key revoked"); }}>Revoke</button>}</td></tr>)}</tbody></table>
          <div className="frow" style={{ marginTop: 10, maxWidth: 480 }}><input placeholder="Name, e.g. Parslia Kitchen OS" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} /><button className="btn primary" disabled={!newKeyName.trim()} onClick={() => { if (newKeyName.trim()) run(() => api<{ key: string }>("/v1/integrations/keys", { method: "POST", body: JSON.stringify({ name: newKeyName.trim(), scopes: ["kitchen.read"] }) }).then(r => { setNewKey(r.key); setNewKeyName(""); }), "Key created"); }}>Create key</button></div>
        </div>)}
      {routes && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Guest booking routing</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>When a guest saves a place, each team gets only its own note. Put the department inbox here. Do not commit a real address. If SMTP is not set, the note is logged for staff to copy.</p>
          {(["kitchen", "restaurant", "front"] as const).map(key => (
            <div key={key} style={{ marginTop: 14, maxWidth: 640 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={routes[key].enabled} onChange={e => setRoutes({ ...routes, [key]: { ...routes[key], enabled: e.target.checked } })} />
                <b>{key === "front" ? "Front of house" : key === "kitchen" ? "Kitchen" : "Restaurant"}</b>
              </label>
              <p className="m">{routeCopy[key]}</p>
              <input placeholder="team@example.invalid" value={routes[key].email} onChange={e => setRoutes({ ...routes, [key]: { ...routes[key], email: e.target.value } })} />
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(() => api("/v1/settings/booking-routing", { method: "PUT", body: JSON.stringify(routes) }), "Routing saved")}>Save routing</button>
        </div>
      )}
      {faultMail && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Fault reports</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Every fault goes to maintenance, and the general manager is copied. A fridge or freezer is also sent to the kitchen. Put the inboxes here. Do not commit a real address. If SMTP is not set, the note is logged for staff to copy.</p>
          {(["maintenance", "manager", "kitchen"] as const).map(key => (
            <div key={key} style={{ marginTop: 14, maxWidth: 640 }}>
              <b>{key === "manager" ? "General manager" : key === "kitchen" ? "Kitchen (cold stores only)" : "Maintenance"}</b>
              <p className="m">{faultCopy[key]}</p>
              <input placeholder="team@example.invalid" value={faultMail[key]} onChange={e => setFaultMail({ ...faultMail, [key]: e.target.value })} />
            </div>
          ))}
          <label style={{ display: "block", marginTop: 14, maxWidth: 640 }}>Areas, one per line<textarea rows={6} value={faultAreas} onChange={e => setFaultAreas(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, font: "inherit" }} /></label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const saved = await api<{ areas: string[]; emails: { maintenance: string; manager: string; kitchen: string } }>("/v1/settings/fault-routing", { method: "PUT", body: JSON.stringify({ areas: faultAreas.split("\n").map(s => s.trim()).filter(Boolean), emails: faultMail }) });
            setFaultAreas(saved.areas.join("\n"));
            setFaultMail(saved.emails);
          }, "Fault routing saved")}>Save fault routing</button>
        </div>
      )}
      {handoverTags != null && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Shift handover tags</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>One tag per line. The incoming shift sees unread notes that match their department, plus General. An empty list restores Kitchen, Front of house, Maintenance and General.</p>
          <textarea rows={6} value={handoverTags} onChange={e => setHandoverTags(e.target.value)} style={{ display: "block", width: "100%", maxWidth: 640, marginTop: 4, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, font: "inherit" }} />
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const saved = await api<{ tags: { label: string }[] }>("/v1/settings/handover-tags", { method: "PUT", body: JSON.stringify({ tags: handoverTags.split("\n").map(s => s.trim()).filter(Boolean) }) });
            setHandoverTags(saved.tags.map(t => t.label).join("\n"));
          }, "Handover tags saved")}>Save handover tags</button>
        </div>
      )}
      {stockMail && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Low stock</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>When an item drops below its line, the kitchen and the person who orders stock each get one note. It is not sent again until the item is restocked. Put the inboxes here. Do not commit a real address. If SMTP is not set, the note is logged for staff to copy.</p>
          {(["kitchen", "buyer"] as const).map(key => (
            <div key={key} style={{ marginTop: 14, maxWidth: 640 }}>
              <b>{key === "buyer" ? "Person who orders stock" : "Kitchen"}</b>
              <p className="m">{stockCopy[key]}</p>
              <input placeholder="team@example.invalid" value={stockMail[key]} onChange={e => setStockMail({ ...stockMail, [key]: e.target.value })} />
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const saved = await api<{ emails: { kitchen: string; buyer: string } }>("/v1/settings/stock-alerts", { method: "PUT", body: JSON.stringify({ emails: stockMail }) });
            setStockMail(saved.emails);
          }, "Stock alerts saved")}>Save stock alerts</button>
        </div>
      )}
      {stay && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>After the stay</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>The morning after departure, the guest gets one link. It works once, then it closes. A problem goes to the team named here, and the general manager is always copied. A note about the team goes only to the general manager. Leave an address blank to skip that copy. Do not commit a real address. If SMTP is not set, the note is logged. Text messages stay off until a text service is configured, and they never include health information.</p>
          <label style={{ display: "block", marginTop: 12 }}>When to send
            <select value={stay.delay_label} onChange={e => setStay({ ...stay, delay_label: e.target.value, delay_hours: e.target.value === "hours" ? (stay.delay_hours ?? 2) : stay.delay_hours })}>
              <option value="morning_after">The morning after they leave</option>
              <option value="hours">A number of hours after checkout</option>
            </select>
          </label>
          {stay.delay_label === "hours" && <label style={{ display: "block", marginTop: 8 }}>Hours after 11:00<input type="number" min={0} max={500} value={stay.delay_hours ?? 2} onChange={e => setStay({ ...stay, delay_hours: Number(e.target.value) })} /></label>}
          <label style={{ display: "block", marginTop: 8 }}>Keep the written note for this many days, then clear it<input type="number" min={30} max={3650} value={stay.retention_days} onChange={e => setStay({ ...stay, retention_days: Number(e.target.value) })} /></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input type="checkbox" checked={stay.open_maintenance} onChange={e => setStay({ ...stay, open_maintenance: e.target.checked })} />
            Open a maintenance ticket when the room is the problem
          </label>
          {(["kitchen", "front", "housekeeping", "manager"] as const).map(key => (
            <div key={key} style={{ marginTop: 14, maxWidth: 640 }}>
              <b>{key === "front" ? "Front of house" : key === "housekeeping" ? "Housekeeping" : key === "manager" ? "General manager" : "Kitchen"}</b>
              <p className="m">{stayCopy[key]}</p>
              <input placeholder="team@example.invalid" value={stay.emails[key]} onChange={e => setStay({ ...stay, emails: { ...stay.emails, [key]: e.target.value } })} />
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const saved = await api<NonNullable<typeof stay>>("/v1/settings/feedback", { method: "PUT", body: JSON.stringify({ delay: stay.delay_label, delay_hours: stay.delay_hours, retention_days: stay.retention_days, open_maintenance: stay.open_maintenance, emails: stay.emails }) });
            setStay({ ...stay, ...saved, delay_label: saved.delay_label ?? (typeof (saved as { delay?: unknown }).delay === "string" ? "morning_after" : "hours") });
          }, "Feedback settings saved")}>Save feedback settings</button>
        </div>
      )}
      {comply && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Compliance reminders</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>The responsible person and the general manager are told before each deadline, and once when an item is overdue. Leave the general manager blank to skip that copy. Do not commit a real address. If SMTP is not set, the note is logged.</p>
          <label style={{ display: "block", marginTop: 8 }}>Days before, separated by commas
            <input value={comply.leads.join(", ")} onChange={e => setComply({ ...comply, leads: e.target.value.split(",").map(n => Number(n.trim())).filter(n => Number.isFinite(n)) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>General manager
            <input placeholder="team@example.invalid" value={comply.manager} onChange={e => setComply({ ...comply, manager: e.target.value })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const saved = await api<{ leads: number[]; manager: string }>("/v1/settings/compliance", { method: "PUT", body: JSON.stringify(comply) });
            setComply(saved);
          }, "Compliance reminders saved")}>Save compliance reminders</button>
        </div>
      )}
      {lostHold && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Lost property</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Items still held after the hold are flagged, and the general manager is told once. Unclaimed items are also flagged for disposal after the disposal period, counted from the found date, or from the day the guest was told. Postage is a note only. No payment is taken. Guest contact and a postage address are removed when an item is returned, disposed of, or donated. Leave the address blank to skip the email. Do not commit a real address. The matcher stays off until you tick it. Then a confirmed match tells the guest, and personal details and photos are removed after the purge period.</p>
          <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={lostHold.matcher} onChange={e => setLostHold({ ...lostHold, matcher: e.target.checked })} /> Suggest matches and tell the guest when staff confirm</label>
          <label style={{ display: "block", marginTop: 8 }}>Days before personal details are removed<input type="number" min={7} max={3650} value={lostHold.purge_days} onChange={e => setLostHold({ ...lostHold, purge_days: Number(e.target.value) })} /></label>
          <label style={{ display: "block", marginTop: 8 }}>Days to hold<input type="number" min={7} max={3650} value={lostHold.hold_days} onChange={e => setLostHold({ ...lostHold, hold_days: Number(e.target.value) })} /></label>
          <label style={{ display: "block", marginTop: 8 }}>Days until disposal<input type="number" min={1} max={3650} value={lostHold.disposal_days} onChange={e => setLostHold({ ...lostHold, disposal_days: Number(e.target.value) })} /></label>
          <label style={{ display: "block", marginTop: 8 }}>Postage note<input value={lostHold.postage_note} onChange={e => setLostHold({ ...lostHold, postage_note: e.target.value })} /></label>
          <label style={{ display: "block", marginTop: 8 }}>Guest link days<input type="number" min={1} max={60} value={lostHold.link_days} onChange={e => setLostHold({ ...lostHold, link_days: Number(e.target.value) })} /></label>
          <label style={{ display: "block", marginTop: 8 }}>General manager<input placeholder="team@example.invalid" value={lostHold.manager} onChange={e => setLostHold({ ...lostHold, manager: e.target.value })} /></label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setLostHold(await api("/v1/settings/lost-found", { method: "PUT", body: JSON.stringify(lostHold) }));
          }, "Lost property settings saved")}>Save lost property settings</button>
        </div>
      )}
      {train && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Training expiry</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>The staff member and their manager are told before a certificate expires, and once when it has expired. Leave the manager blank to skip that copy. Do not commit a real address. If SMTP is not set, the note is logged.</p>
          <label style={{ display: "block", marginTop: 8 }}>Days before, separated by commas
            <input value={train.leads.join(", ")} onChange={e => setTrain({ ...train, leads: e.target.value.split(",").map(n => Number(n.trim())).filter(n => Number.isFinite(n)) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Manager
            <input placeholder="team@example.invalid" value={train.manager} onChange={e => setTrain({ ...train, manager: e.target.value })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setTrain(await api("/v1/settings/training", { method: "PUT", body: JSON.stringify(train) }));
          }, "Training reminders saved")}>Save training reminders</button>
        </div>
      )}
      {deposit && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Deposit</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Card payments stay off until the house turns them on. Food is never billed. This amount is the deposit a guest is asked for when card payments are on.</p>
          <label style={{ display: "block", marginTop: 8 }}>Deposit amount (£)
            <input type="number" min={0} step="0.01" value={deposit.amount_gbp} onChange={e => setDeposit({ ...deposit, amount_gbp: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Policy shown to the guest
            <textarea rows={3} value={deposit.policy} onChange={e => setDeposit({ ...deposit, policy: e.target.value })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setDeposit(await api("/v1/settings/deposit", { method: "PUT", body: JSON.stringify(deposit) }));
          }, "Deposit saved")}>Save deposit</button>
        </div>
      )}
      {audit && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Night audit</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>The house report runs once each night, London time. Food is never counted. Leave the address blank to use the fault-routing manager. Automatic email stays off until you turn it on. If SMTP is not set, the note is logged. Do not commit a real address.</p>
          <label style={{ display: "block", marginTop: 8 }}>Time
            <input aria-label="Night audit time" value={audit.time} onChange={e => setAudit({ ...audit, time: e.target.value })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>General manager
            <input placeholder="team@example.invalid" aria-label="Night audit general manager" value={audit.gm_email} onChange={e => setAudit({ ...audit, gm_email: e.target.value })} />
          </label>
          <label className="m" style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
            <input type="checkbox" checked={audit.auto_email} onChange={e => setAudit({ ...audit, auto_email: e.target.checked })} /> Email the general manager when the night job runs
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setAudit(await api("/v1/settings/night-audit", { method: "PUT", body: JSON.stringify(audit) }));
          }, "Night audit saved")}>Save night audit</button>
        </div>
      )}
      {swaps && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Shift swaps</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Rest is the gap between one shift ending and the next starting. Hours over the standard week are lieu. A personal cap, set on Shift swaps, is a hard block. Unanswered requests expire when the shift starts, or this many hours before it. Person-specific rules stay in the house record, not in the public code. The swap board stays off until you tick it. Then, once both people agree, the rota updates and managers are told. List a department here if that department should still wait for a manager.</p>
          <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={swaps.board} onChange={e => setSwaps({ ...swaps, board: e.target.checked })} /> Swap board: update the rota when both agree</label>
          <label style={{ display: "block", marginTop: 8 }}>Departments that still need a manager
            <input aria-label="Departments that need manager approval" value={swapDepts} onChange={e => setSwapDepts(e.target.value)} placeholder="Kitchen" />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Minimum rest, hours
            <input type="number" min={0} max={24} aria-label="Minimum rest hours" value={swaps.min_rest_hours} onChange={e => setSwaps({ ...swaps, min_rest_hours: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Standard week, hours
            <input type="number" min={1} max={80} aria-label="Standard week hours" value={swaps.standard_week_hours} onChange={e => setSwaps({ ...swaps, standard_week_hours: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Expire this many hours before the shift
            <input type="number" min={0} max={168} aria-label="Expire hours before shift" value={swaps.expire_hours_before} onChange={e => setSwaps({ ...swaps, expire_hours_before: Number(e.target.value) })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const approval: Record<string, boolean> = {};
            for (const name of swapDepts.split(",")) {
              const key = name.trim().toLowerCase();
              if (key) approval[key] = true;
            }
            const saved = await api<{ min_rest_hours: number; standard_week_hours: number; expire_hours_before: number; board?: boolean; approval?: Record<string, boolean> }>("/v1/settings/shift-swap", { method: "PUT", body: JSON.stringify({ ...swaps, board: swaps.board === true, approval }) });
            setSwaps({ ...saved, board: saved.board === true, approval: saved.approval ?? {} });
            setSwapDepts(Object.entries(saved.approval ?? {}).filter(([, on]) => on).map(([name]) => name).join(", "));
          }, "Shift swap settings saved")}>Save shift swaps</button>
        </div>
      )}
      {brief && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Morning briefing</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>The top of the morning board is the three highest scores. A pin stays in that three for today. Points are the rule, and the board says which rule it used. Kitchen and front are the minimum people on the rota.</p>
          <label style={{ display: "block", marginTop: 8 }}>Severe allergen
            <input type="number" min={0} aria-label="Severe allergen points" value={brief.severe} onChange={e => setBrief({ ...brief, severe: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Fridge or freezer fault
            <input type="number" min={0} aria-label="Cold fault points" value={brief.cold} onChange={e => setBrief({ ...brief, cold: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>VIP or flagged returning guest
            <input type="number" min={0} aria-label="VIP points" value={brief.vip} onChange={e => setBrief({ ...brief, vip: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Overdue compliance
            <input type="number" min={0} aria-label="Compliance points" value={brief.compliance} onChange={e => setBrief({ ...brief, compliance: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Understaffing
            <input type="number" min={0} aria-label="Understaffing points" value={brief.staffing} onChange={e => setBrief({ ...brief, staffing: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Kitchen on shift
            <input type="number" min={0} aria-label="Kitchen heads" value={brief.heads.KITCHEN ?? 2} onChange={e => setBrief({ ...brief, heads: { ...brief.heads, KITCHEN: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Front on shift
            <input type="number" min={0} aria-label="Front heads" value={brief.heads.FRONT ?? 1} onChange={e => setBrief({ ...brief, heads: { ...brief.heads, FRONT: Number(e.target.value) } })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setBrief(await api("/v1/settings/briefing", { method: "PUT", body: JSON.stringify(brief) }));
          }, "Briefing rules saved")}>Save briefing rules</button>
        </div>
      )}
      {orgSettings && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Organisation</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>One general manager sits at the top unless you allow more than one. Staff see a work email and work phone, or nothing. Managers and the general manager still see the personal phone.</p>
          <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={orgSettings.allow_multiple_gm} onChange={e => setOrgSettings({ ...orgSettings, allow_multiple_gm: e.target.checked })} /> Allow more than one general manager</label>
          <label style={{ display: "block", marginTop: 8 }}>What staff can see
            <select aria-label="Staff contact" value={orgSettings.staff_contact} onChange={e => setOrgSettings({ ...orgSettings, staff_contact: e.target.value === "none" ? "none" : "work" })}>
              <option value="work">Work email and work phone</option>
              <option value="none">No contact details</option>
            </select>
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setOrgSettings(await api("/v1/org/settings", { method: "PUT", body: JSON.stringify(orgSettings) }));
          }, "Organisation settings saved")}>Save organisation settings</button>
        </div>
      )}
      {spendSettings && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Spending alerts</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>When a department reaches 80% and 100% of its monthly budget, the note goes once. Add the general manager, or Shyam, and choose whether the department head is told as well.</p>
          <label style={{ display: "block", marginTop: 8 }}>General manager email
            <input aria-label="Spend alert email" type="email" value={spendSettings.gm_email} onChange={e => setSpendSettings({ ...spendSettings, gm_email: e.target.value })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={spendSettings.notify_heads} onChange={e => setSpendSettings({ ...spendSettings, notify_heads: e.target.checked })} /> Tell the department head as well</label>
          <label style={{ display: "block", marginTop: 8 }}>Categories, one name per line
            <textarea aria-label="Spend categories" value={spendSettings.categories.map(item => item.name).join("\n")} onChange={e => setSpendSettings({ ...spendSettings, categories: e.target.value.split("\n").map(name => name.trim()).filter(Boolean).map(name => ({ code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name })) })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setSpendSettings(await api("/v1/spend/settings", { method: "PUT", body: JSON.stringify(spendSettings) }));
          }, "Spending alerts saved")}>Save spending alerts</button>
        </div>
      )}
      {roomSettings && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Room assignment lock</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>An organiser can move their own guests until this many days before arrival. After that they write to the house. The address here is told when a room list is finished or changed.</p>
          <label style={{ display: "block", marginTop: 8 }}>Days before arrival
            <input type="number" min={0} max={60} aria-label="Room lock days" value={roomSettings.cutoff_days} onChange={e => setRoomSettings({ ...roomSettings, cutoff_days: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>House email
            <input type="email" aria-label="Room assignment email" value={roomSettings.staff_email} onChange={e => setRoomSettings({ ...roomSettings, staff_email: e.target.value })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Reminder days before the cut-off
            <input aria-label="Room reminder days" value={roomReminders} onChange={e => setRoomReminders(e.target.value)} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            const reminder_days = roomReminders.split(",").map(item => Number(item.trim())).filter(item => Number.isFinite(item));
            const saved = await api<{ cutoff_days: number; staff_email: string; reminder_days: number[] }>("/v1/room-assign/settings", { method: "PUT", body: JSON.stringify({ ...roomSettings, reminder_days }) });
            setRoomSettings(saved);
            setRoomReminders(saved.reminder_days.join(", "));
          }, "Room assignment lock saved")}>Save room assignment lock</button>
        </div>
      )}
      {journey && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Guest journey</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Pre-arrival, the thank-you, and a later rebook note share one mail job. Service letters go without marketing consent. Digital check-in stays off until it is ticked. Wording is edited on Guest journey.</p>
          <label style={{ display: "block", marginTop: 8 }}>Days before arrival
            <input type="number" min={1} max={30} aria-label="Journey pre-arrival days" value={Number(journey.pre_arrival_days ?? 5)} onChange={e => setJourney({ ...journey, pre_arrival_days: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Check-in opens
            <input aria-label="Journey check-in time" value={String(journey.check_in_time ?? "08:00")} onChange={e => setJourney({ ...journey, check_in_time: e.target.value })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Rebook delay, days
            <input type="number" min={1} aria-label="Journey rebook days" value={Number(journey.rebook_days ?? 30)} onChange={e => setJourney({ ...journey, rebook_days: Number(e.target.value) })} />
          </label>
          {([
            ["pre_arrival", "Pre-arrival"],
            ["see_you_tomorrow", "See you tomorrow"],
            ["check_in", "Digital check-in"],
            ["post_stay", "Thank-you"],
            ["rebook", "Rebook, marketing only"],
          ] as const).map(([key, label]) => {
            const sequences = (journey.sequences ?? {}) as Record<string, boolean>;
            return (
              <label key={key} className="assign-check">
                <input type="checkbox" checked={!!sequences[key]} onChange={e => setJourney({ ...journey, sequences: { ...sequences, [key]: e.target.checked } })} />
                {label}
              </label>
            );
          })}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setJourney(await api("/v1/guest-journey/settings", { method: "PUT", body: JSON.stringify(journey) }));
          }, "Guest journey saved")}>Save guest journey</button>
        </div>
      )}
      {retain && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Guest profile retention</h3>
          <p className="m" style={{ color: "var(--ink-2)" }}>Allergen and health details are removed 30 days after departure unless the guest has agreed to keep them for future stays. That agreement lasts until they withdraw it, or until the whole profile is removed after a long quiet period. Feedback free text and staff notes have their own clocks. A removed field is marked &quot;deleted per retention policy on&quot; the day it went.</p>
          <label style={{ display: "block", marginTop: 8 }}>Allergen and health data, days after departure
            <input type="number" min={1} value={retain.allergen_days_after_departure} onChange={e => setRetain({ ...retain, allergen_days_after_departure: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Feedback free text, days
            <input type="number" min={1} value={retain.feedback_text_days} onChange={e => setRetain({ ...retain, feedback_text_days: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Staff notes, days
            <input type="number" min={1} value={retain.staff_note_days} onChange={e => setRetain({ ...retain, staff_note_days: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Whole profile, months without a stay
            <input type="number" min={1} value={retain.profile_inactive_months} onChange={e => setRetain({ ...retain, profile_inactive_months: Number(e.target.value) })} />
          </label>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => run(async () => {
            setRetain(await api("/v1/settings/guest-retention", { method: "PUT", body: JSON.stringify(retain) }));
          }, "Guest retention saved")}>Save guest retention</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
