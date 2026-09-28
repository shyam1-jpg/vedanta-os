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
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
