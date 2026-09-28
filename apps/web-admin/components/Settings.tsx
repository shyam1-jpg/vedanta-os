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
  useEffect(() => {
    api<{ rules: { kitchen: RouteBox; restaurant: RouteBox; front: RouteBox }; receives: Record<string, string> }>("/v1/settings/booking-routing")
      .then(r => { setRoutes(r.rules); setRouteCopy(r.receives); }).catch(() => {});
    api<{ areas: string[]; emails: { maintenance: string; manager: string; kitchen: string }; receives: Record<string, string> }>("/v1/settings/fault-routing")
      .then(r => { setFaultMail(r.emails); setFaultAreas(r.areas.join("\n")); setFaultCopy(r.receives); }).catch(() => {});
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
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
