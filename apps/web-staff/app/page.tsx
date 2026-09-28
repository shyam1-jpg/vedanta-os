"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const tok = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("vedanta.staff.token")),
  set: (t: string | null) => { if (t) sessionStorage.setItem("vedanta.staff.token", t); else sessionStorage.removeItem("vedanta.staff.token"); },
};
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
  const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(API + path, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? res.statusText);
  return body as T;
}

type Me = { name: string; email: string; role: string; role_name?: string; permissions?: string[]; property_name?: string | null; property_kicker?: string | null };
type Prop = { name: string; kicker: string };

type FaultCat = {
  rooms: string[];
  areas: string[];
  assets: { id: string; name: string; category: string | null; qr_code: string | null }[];
  categories: { code: string; label: string }[];
  urgencies: { code: string; label: string }[];
  reporter: string;
};
type FaultItem = {
  id: string; number: number; title: string; description: string | null; status: string; status_label?: string;
  priority: string; urgency_label?: string; room: string | null; location: string | null;
  asset_name: string | null; equipment_label: string | null; food_safety: boolean; has_photo: boolean;
  reported_by: string | null; created_at: string;
};

async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Attach a photo as an image"));
      el.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) {
      quality -= 0.08;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (!data.startsWith("data:image/") || data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FaultPocket({ me, canWork, onError }: { me: Me; canWork: boolean; onError: (msg: string | null) => void }) {
  const [cat, setCat] = useState<FaultCat | null>(null);
  const [mine, setMine] = useState<FaultItem[]>([]);
  const [queue, setQueue] = useState<FaultItem[]>([]);
  const [place, setPlace] = useState<"room" | "area">("room");
  const [room, setRoom] = useState("");
  const [area, setArea] = useState("");
  const [assetId, setAssetId] = useState("");
  const [category, setCategory] = useState("");
  const [equipment, setEquipment] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("NORMAL");
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    setMine((await api<{ items: FaultItem[] }>("/v1/maintenance?mine=1&status=all")).items);
    if (canWork) setQueue((await api<{ items: FaultItem[] }>("/v1/maintenance?status=open")).items);
  };
  useEffect(() => {
    api<FaultCat>("/v1/maintenance/catalogue").then(setCat).catch(e => onError((e as Error).message));
    refresh().catch(e => onError((e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const asset = cat?.assets.find(a => a.id === assetId);
  const foodish = /fridge|freezer|walk-?in|cold room|cold-room|chiller/i.test([asset?.name, asset?.category, equipment, category].filter(Boolean).join(" "));

  const send = async () => {
    setBusy(true); onError(null);
    try {
      const r = await api<{ number: number; food_safety: boolean }>("/v1/maintenance", {
        method: "POST",
        body: JSON.stringify({
          description: description.trim(),
          room: place === "room" ? room : undefined,
          area: place === "area" ? area : undefined,
          asset_id: assetId || undefined,
          equipment_category: category || undefined,
          equipment_label: equipment.trim() || undefined,
          urgency,
          photo: photo || undefined,
        }),
      });
      setDescription(""); setEquipment(""); setPhoto(null); setAssetId(""); setCategory("");
      await refresh();
      setMsg(`Sent as M-${r.number}${r.food_safety ? ". The kitchen is copied." : ""}`);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const act = async (id: string, cmd: string) => {
    onError(null);
    try {
      await api(`/v1/maintenance/${id}/commands/${cmd}`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) { onError((e as Error).message); }
  };

  const placeLine = (t: FaultItem) => t.room ? `Room ${t.room}` : (t.location || "House");
  const gear = (t: FaultItem) => [t.asset_name, t.equipment_label].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="card">
        <h2>Report a fault</h2>
        <p className="m">Goes straight to maintenance. The general manager is copied. Reported by {cat?.reporter || me.name}.</p>
        <label>Where</label>
        <select value={place} onChange={e => setPlace(e.target.value === "area" ? "area" : "room")}><option value="room">A room</option><option value="area">An area</option></select>
        {place === "room" ? (<>
          <label>Room</label>
          <select value={room} onChange={e => setRoom(e.target.value)}><option value="">Choose a room…</option>{(cat?.rooms ?? []).map(n => <option key={n} value={n}>{n}</option>)}</select>
        </>) : (<>
          <label>Area</label>
          <select value={area} onChange={e => setArea(e.target.value)}><option value="">Choose an area…</option>{(cat?.areas ?? []).map(a => <option key={a} value={a}>{a}</option>)}</select>
        </>)}
        <label>Equipment on the register</label>
        <select value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">Not on the list</option>{(cat?.assets ?? []).map(a => <option key={a.id} value={a.id}>{a.name}{a.qr_code ? ` · ${a.qr_code}` : ""}</option>)}</select>
        <label>Or a category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}><option value="">None</option>{(cat?.categories ?? []).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        <label>Or say what it is</label>
        <input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="Fridge 2, banquet chair" />
        <label>What is wrong?</label>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="toilet not flushing, overflowing, furniture broken" />
        <label>How urgent</label>
        <select value={urgency} onChange={e => setUrgency(e.target.value)}>{(cat?.urgencies ?? []).map(u => <option key={u.code} value={u.code}>{u.label}</option>)}</select>
        <label>Photo, if you have one</label>
        <input type="file" accept="image/*" onChange={async e => {
          const file = e.target.files?.[0];
          if (!file) { setPhoto(null); return; }
          try { setPhoto(await shrinkPhoto(file)); onError(null); }
          catch (ex) { setPhoto(null); onError((ex as Error).message); }
        }} />
        {foodish && <div className="note">This looks like a fridge or freezer. The kitchen will be told as well.</div>}
        {msg && <div className="note">{msg}</div>}
        <button className="btn" disabled={busy || !description.trim() || (place === "room" ? !room : !area)} onClick={send}>{busy ? "Sending…" : "Send to maintenance"}</button>
      </div>
      <div className="card">
        <h2>Your reports</h2>
        {mine.length === 0 && <p className="m">You have not reported a fault yet.</p>}
        {mine.map(t => (
          <div className="row" key={t.id} style={{ display: "block" }}>
            <b>M-{t.number} · {placeLine(t)}</b>
            <div>{t.title}</div>
            <div className="m">{t.status_label || t.status} · {t.urgency_label || t.priority}{gear(t) ? ` · ${gear(t)}` : ""}{t.food_safety ? " · kitchen copied" : ""}{t.has_photo ? " · photo" : ""}</div>
            <input value={note[t.id] ?? ""} onChange={e => setNote(s => ({ ...s, [t.id]: e.target.value }))} placeholder="Add a note" />
            <button className="btn ghost" onClick={async () => {
              const body = (note[t.id] ?? "").trim();
              if (!body) return;
              try {
                await api(`/v1/maintenance/${t.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
                setNote(s => ({ ...s, [t.id]: "" }));
                setMsg("Note added");
              } catch (e) { onError((e as Error).message); }
            }}>Add note</button>
          </div>
        ))}
      </div>
      {canWork && (
        <div className="card">
          <h2>Maintenance queue</h2>
          {queue.length === 0 && <p className="m">Nothing open.</p>}
          {queue.map(t => (
            <div className="row" key={t.id} style={{ display: "block" }}>
              <b>M-{t.number} · {placeLine(t)}</b>
              <div>{t.title}</div>
              <div className="m">{t.status_label || t.status} · {t.reported_by ?? "Staff"}{gear(t) ? ` · ${gear(t)}` : ""}{t.food_safety ? " · food safety" : ""}</div>
              <div className="tabs">
                {t.status === "OPEN" && <button onClick={() => act(t.id, "acknowledge")}>Acknowledge</button>}
                {["OPEN", "ACKNOWLEDGED", "WAITING_PARTS"].includes(t.status) && <button onClick={() => act(t.id, "start")}>In progress</button>}
                {["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(t.status) && <button onClick={() => act(t.id, "wait")}>Waiting parts</button>}
                {!["DONE", "CANCELLED"].includes(t.status) && <button onClick={() => act(t.id, "done")}>Fixed</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StockItem = { id: string; name: string; unit: string; quantity: number; low_threshold: number; example: boolean; low: boolean };
type HandoverTag = { code: string; label: string };
type HandoverNote = { id: string; department?: string; department_label?: string; shift?: string; shift_label?: string; body: string; author_name: string | null; created_at?: string; tags?: string[]; acked?: boolean };

function deptFromTags(tags: string[]): string {
  if (tags.includes("kitchen")) return "KITCHEN";
  if (tags.includes("front")) return "FRONT";
  if (tags.includes("maintenance")) return "MAINT";
  return "HOUSE";
}

function StockPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [low, setLow] = useState<{ name: string; quantity: number; unit: string }[]>([]);
  const [amount, setAmount] = useState<Record<string, string>>({});
  const load = () => api<{ items: StockItem[]; low: { name: string; quantity: number; unit: string }[] }>("/v1/kitchen-stock").then(r => { setItems(r.items); setLow(r.low); });
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  const count = async (item: StockItem, op: "use" | "restock" | "set") => {
    try {
      await api(`/v1/kitchen-stock/${item.id}/count`, { method: "POST", body: JSON.stringify({ op, amount: Number(amount[item.id] ?? "1") }) });
      onError(null);
      await load();
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div>
      {low.length > 0 && <div className="note"><b>Below the line.</b> {low.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(" · ")}</div>}
      {items.map(item => (
        <div className="card" key={item.id}>
          <h2>{item.name}{item.example ? " · example" : ""}{item.low ? " · low" : ""}</h2>
          <p>{item.quantity} {item.unit}</p>
          <p className="m">Order more below {item.low_threshold} {item.unit}</p>
          <input value={amount[item.id] ?? "1"} onChange={e => setAmount(s => ({ ...s, [item.id]: e.target.value }))} aria-label={`Amount for ${item.name}`} />
          <div className="tabs">
            <button className="btn" onClick={() => count(item, "use")}>Use</button>
            <button className="btn" onClick={() => count(item, "restock")}>Restock</button>
            <button className="btn" onClick={() => count(item, "set")}>Set count</button>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="m">No stock items yet.</p>}
    </div>
  );
}

export default function Pocket() {
  const [me, setMe] = useState<Me | null>(null);
  const [prop, setProp] = useState<Prop>({ name: "The Vedanta Way", kicker: "Retreat Center" });
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [providers, setProviders] = useState<{ microsoft: boolean; dev: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"clock" | "leave" | "duty" | "sop" | "log" | "desk" | "night" | "manual" | "tasks" | "fault" | "stock">("clock");
  const [desk, setDesk] = useState<{
    today: { weekday: string; title: string; method: string; ingredients: { name: string; qty: string }[] };
    tomorrow: { weekday: string; title: string; method: string; ingredients: { name: string; qty: string }[] };
    stock: { id: string; name: string; par_note: string | null }[];
  } | null>(null);
  const [pay, setPay] = useState<{ hours: number; shifts: { in_at: string; out_at: string | null; hours: number }[] } | null>(null);
  const [ops, setOps] = useState<{
    progress: { done: number; total: number };
    handover: HandoverNote[];
    handover_tags?: HandoverTag[];
    checklists: { id: string; department: string; department_label: string; title: string; due_time?: string | null; done: boolean }[];
    guest_requests: { id: string; guest_name: string | null; room_label: string | null; department_label: string; request_text: string; status: string }[];
    notices: { id: string; title: string; body: string }[];
  } | null>(null);
  const [note, setNote] = useState("");
  const [noteShift, setNoteShift] = useState("am");
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [inbox, setInbox] = useState<{ label: string; unread: HandoverNote[]; tags: HandoverTag[] } | null>(null);
  const [histOn, setHistOn] = useState(false);
  const [histItems, setHistItems] = useState<HandoverNote[]>([]);
  const [hf, setHf] = useState({ tag: "", shift: "", unread: false });
  const [clock, setClock] = useState<{ last: string | null; hours_this_week: number } | null>(null);
  const [leave, setLeave] = useState<{ items: { id: string; kind: string; starts_on: string; ends_on: string; status: string }[] } | null>(null);
  const [form, setForm] = useState({ kind: "HOLIDAY", starts_on: "", ends_on: "", note: "" });
  const [sops, setSops] = useState<{ id: string; title: string; body: string; read_at: string | null }[]>([]);
  const [duty, setDuty] = useState<{ id: string; on_date: string; slot: string; kind: string; note: string | null }[]>([]);
  const [manuals, setManuals] = useState<{ slug: string; title: string; department_label: string; kind_label: string; summary: string; body: string; steps: { title: string; look: string; act: string }[]; diagram: { title: string; caption: string }[] }[]>([]);
  const [manualSlug, setManualSlug] = useState("app-how-to-use");
  const [nightNote, setNightNote] = useState("");
  const [tasks, setTasks] = useState<{
    items: { id: string; title: string; department_label: string; status: string; status_label: string; overdue: boolean; room_label: string; next: { status: string; label: string }[] }[];
    counts: { open: number; overdue: number };
  } | null>(null);
  const [taskTitle, setTaskTitle] = useState("");

  const load = async () => {
    const u = await api<Me>("/me"); setMe(u);
    setClock(await api("/staff/clock"));
    setLeave(await api("/staff/leave"));
    setSops((await api<{ items: typeof sops }>("/staff/sop")).items);
    setDuty((await api<{ items: typeof duty }>("/staff/duty")).items);
    try { setOps(await api("/v1/ops/board")); } catch { setOps(null); }
    try { setInbox(await api("/v1/ops/handover/inbox")); } catch { setInbox(null); }
    try { setDesk(await api("/v1/service/front-desk")); } catch { setDesk(null); }
    try { setPay(await api("/staff/payroll")); } catch { setPay(null); }
    try { setManuals((await api<{ items: typeof manuals }>("/v1/manuals")).items); } catch { setManuals([]); }
    try { setTasks(await api("/v1/ops/tasks")); } catch { setTasks(null); }
  };
  useEffect(() => {
    api<Prop>("/guest/property").then(p => setProp({ name: p.name, kicker: p.kicker })).catch(() => {});
    api<{ microsoft: boolean; dev: boolean }>("/auth/providers").then(p => setProviders({ microsoft: !!p.microsoft, dev: !!p.dev })).catch(() => {});
    const hash = window.location.hash.match(/token=([^&]+)/);
    if (hash) {
      tok.set(decodeURIComponent(hash[1]));
      history.replaceState(null, "", window.location.pathname + window.location.search);
      load().catch(() => tok.set(null));
      return;
    }
    if (tok.get()) load().catch(() => tok.set(null));
  }, []);

  const enter = async () => {
    setErr(null);
    try {
      const r = await api<{ token: string }>("/auth/dev-login", { method: "POST", body: JSON.stringify({ email, secret, surface: "staff" }) });
      tok.set(r.token); await load();
    } catch (e) { setErr((e as Error).message); }
  };

  async function orderWater(which: "today" | "tomorrow") {
    const recipe = which === "today" ? desk?.today : desk?.tomorrow;
    try {
      await api("/v1/service/orders", {
        method: "POST",
        body: JSON.stringify({
          needed_for: "Front of house",
          items: (recipe?.ingredients ?? []).map(i => ({ name: i.name, qty: i.qty })),
        }),
      });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!me) return (
    <>
      <div className="hero"><div className="kicker">{prop.kicker}</div><h1>{prop.name}</h1><p>Luxury retreat centre</p></div>
      <div className="wrap">
        <div className="card">
          <h2>Staff pocket</h2>
          {providers?.microsoft && <a className="btn" href={`${API}/auth/microsoft?surface=staff`}>Sign in with Microsoft</a>}
          {providers?.dev && (<>
            <p className="m">Development door. Example addresses only. This stays shut in production.</p>
            <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Development secret" autoComplete="off" />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="dev.front@example.invalid" autoComplete="off" />
            <button className="btn" onClick={enter}>Enter the pocket</button>
          </>)}
          {providers && !providers.microsoft && !providers.dev && <p className="m">No sign-in method is configured.</p>}
          {err && <div className="note">{err}</div>}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="hero"><div className="kicker">{me.role_name ?? me.role.replace(/_/g, " ")}</div><h1>{me.name}</h1></div>
      <div className="wrap">
        {!!inbox?.unread.length && (
          <div className="note">
            <b>{inbox.label}</b>
            {inbox.unread.map(n => (
              <div key={n.id} style={{ marginTop: 8 }}>
                <div className="m">{n.author_name ?? "Staff"}{n.created_at ? ` · ${new Date(n.created_at).toLocaleString("en-GB")}` : ""}{(n.tags ?? []).map(code => ` · ${inbox.tags.find(t => t.code === code)?.label ?? code}`).join("")}</div>
                <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
                <button className="btn" onClick={async () => { setErr(null); try { await api(`/v1/ops/handover/${n.id}/ack`, { method: "POST", body: "{}" }); setInbox(await api("/v1/ops/handover/inbox")); } catch (e) { setErr((e as Error).message); } }}>Mark as read</button>
              </div>
            ))}
          </div>
        )}
        <div className="tabs">
          <button className={tab === "clock" ? "on" : ""} onClick={() => setTab("clock")}>Clock</button>
          <button className={tab === "leave" ? "on" : ""} onClick={() => setTab("leave")}>Holiday</button>
          <button className={tab === "duty" ? "on" : ""} onClick={() => setTab("duty")}>Duty</button>
          <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>House log</button>
          <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>Tasks</button>
          <button className={tab === "fault" ? "on" : ""} onClick={() => setTab("fault")}>Fault</button>
          {(me.permissions ?? []).includes("kitchen.stock") && <button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>Stock</button>}
          <button className={tab === "desk" ? "on" : ""} onClick={() => setTab("desk")}>Front desk</button>
          <button className={tab === "night" ? "on" : ""} onClick={() => setTab("night")}>Night</button>
          <button className={tab === "manual" ? "on" : ""} onClick={() => setTab("manual")}>Manual</button>
          <button className={tab === "sop" ? "on" : ""} onClick={() => setTab("sop")}>SOP</button>
        </div>
        {tab === "clock" && (
          <div className="card">
            <h2>This week · {pay?.hours ?? clock?.hours_this_week ?? 0} hours</h2>
            <p className="m">{clock?.last === "IN" ? "You are on the clock. Hours count until you clock out." : "You are clocked out."}</p>
            <button className="btn" onClick={async () => { setErr(null); try { await api("/staff/clock", { method: "POST", body: JSON.stringify({ kind: clock?.last === "IN" ? "OUT" : "IN" }) }); setClock(await api("/staff/clock")); setPay(await api("/staff/payroll")); } catch (e) { setErr((e as Error).message); } }}>{clock?.last === "IN" ? "Clock out" : "Clock in"}</button>
            {(pay?.shifts ?? []).map((s, i) => <div className="row" key={i}><span>{new Date(s.in_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} → {s.out_at ? new Date(s.out_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "still on"}</span><span className="m">{s.hours} hrs</span></div>)}
          </div>
        )}
        {tab === "leave" && (
          <div className="card">
            <h2>Request holiday</h2>
            <p className="m">Head of department signs first. Their own leave is signed by the general manager.</p>
            <label>Kind</label>
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option>HOLIDAY</option><option>DAY_OFF</option><option>SICK</option><option>UNPAID</option></select>
            <label>From</label><input type="date" value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} />
            <label>To</label><input type="date" value={form.ends_on} onChange={e => setForm({ ...form, ends_on: e.target.value })} />
            <label>Note</label><textarea rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <button className="btn" onClick={async () => { setErr(null); try { await api("/staff/leave", { method: "POST", body: JSON.stringify(form) }); setLeave(await api("/staff/leave")); } catch (e) { setErr((e as Error).message); } }}>Send request</button>
            {(leave?.items ?? []).map(l => <div className="row" key={l.id}><span>{l.kind.toLowerCase()} · {l.starts_on} → {l.ends_on}</span><span className="m">{l.status.replace(/_/g, " ").toLowerCase()}</span></div>)}
          </div>
        )}
        {tab === "duty" && (
          <div className="card">
            <h2>Your board</h2>
            <p className="m">The house places you here. Tips, pay and the rota stay in the house.</p>
            {duty.length === 0 && <p className="m">No shifts on the board yet.</p>}
            {duty.map(d => <div className="row" key={d.id}><span>{d.on_date} · {d.slot}</span><span className="m">{d.kind.toLowerCase()}{d.note ? ` · ${d.note}` : ""}</span></div>)}
          </div>
        )}
        {tab === "log" && (
          <div>
            <div className="card">
              <h2>Today · {ops?.progress.done ?? 0}/{ops?.progress.total ?? 0} checks</h2>
              <p className="m">Tick the round. Leave a note for the next shift. Guest asks land here instead of WhatsApp.</p>
              {(ops?.guest_requests ?? []).map(r => (
                <div className="row" key={r.id} style={{ display: "block" }}>
                  <b>{r.department_label}</b>
                  <div>{r.guest_name ? `${r.guest_name}${r.room_label ? ` · ${r.room_label}` : ""} — ` : ""}{r.request_text}</div>
                  {r.status !== "done" && <button className="btn" onClick={async () => { await api(`/v1/ops/guest-requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: r.status === "open" ? "doing" : "done" }) }); setOps(await api("/v1/ops/board")); }}>{r.status === "open" ? "Take it" : "Mark done"}</button>}
                </div>
              ))}
            </div>
            {(ops?.checklists ?? []).map(c => (
              <label key={c.id} className="row" style={{ alignItems: "center" }}>
                <input type="checkbox" checked={c.done} onChange={async e => { await api(`/v1/ops/checklists/${c.id}/tick`, { method: "POST", body: JSON.stringify({ done: e.target.checked }) }); setOps(await api("/v1/ops/board")); }} />
                <span>{c.title}<div className="m">{c.department_label}</div></span>
              </label>
            ))}
            <div className="card">
              <h2>Handover</h2>
              <div className="tabs">
                <button className={!histOn ? "on" : ""} onClick={() => setHistOn(false)}>Today</button>
                <button className={histOn ? "on" : ""} onClick={async () => {
                  setHistOn(true);
                  const q = new URLSearchParams();
                  if (hf.tag) q.set("tag", hf.tag);
                  if (hf.shift) q.set("shift", hf.shift);
                  if (hf.unread) q.set("unread", "1");
                  setHistItems((await api<{ items: HandoverNote[] }>(`/v1/ops/handover?${q}`)).items);
                }}>History</button>
              </div>
              {histOn && (
                <div>
                  <select aria-label="Filter by tag" value={hf.tag} onChange={async e => {
                    const next = { ...hf, tag: e.target.value }; setHf(next);
                    const q = new URLSearchParams(); if (next.tag) q.set("tag", next.tag); if (next.shift) q.set("shift", next.shift); if (next.unread) q.set("unread", "1");
                    setHistItems((await api<{ items: HandoverNote[] }>(`/v1/ops/handover?${q}`)).items);
                  }}>
                    <option value="">All tags</option>
                    {(inbox?.tags ?? ops?.handover_tags ?? []).map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                  </select>
                  <select aria-label="Filter by shift" value={hf.shift} onChange={async e => {
                    const next = { ...hf, shift: e.target.value }; setHf(next);
                    const q = new URLSearchParams(); if (next.tag) q.set("tag", next.tag); if (next.shift) q.set("shift", next.shift); if (next.unread) q.set("unread", "1");
                    setHistItems((await api<{ items: HandoverNote[] }>(`/v1/ops/handover?${q}`)).items);
                  }}>
                    <option value="">All shifts</option>
                    <option value="am">Morning</option>
                    <option value="pm">Evening</option>
                    <option value="night">Night</option>
                  </select>
                  <label className="m"><input type="checkbox" checked={hf.unread} onChange={async e => {
                    const next = { ...hf, unread: e.target.checked }; setHf(next);
                    const q = new URLSearchParams(); if (next.tag) q.set("tag", next.tag); if (next.shift) q.set("shift", next.shift); if (next.unread) q.set("unread", "1");
                    setHistItems((await api<{ items: HandoverNote[] }>(`/v1/ops/handover?${q}`)).items);
                  }} /> Unread only</label>
                </div>
              )}
              {(histOn ? histItems : (ops?.handover ?? []).slice(0, 5)).map(h => (
                <div className="row" key={h.id} style={{ display: "block" }}>
                  <b>{h.department_label} · {h.shift_label}</b>
                  <div className="m">{h.author_name ?? "Staff"}{h.created_at ? ` · ${new Date(h.created_at).toLocaleString("en-GB")}` : ""}{(h.tags ?? []).length ? ` · ${(h.tags ?? []).join(", ")}` : ""}</div>
                  <div>{h.body}</div>
                  {h.acked ? <span className="m">Read</span> : <button className="btn" onClick={async () => { await api(`/v1/ops/handover/${h.id}/ack`, { method: "POST", body: "{}" }); setOps(await api("/v1/ops/board")); setInbox(await api("/v1/ops/handover/inbox")); }}>Mark as read</button>}
                </div>
              ))}
              <select value={noteShift} onChange={e => setNoteShift(e.target.value)} aria-label="Shift">
                <option value="am">Morning</option>
                <option value="pm">Evening</option>
                <option value="night">Night</option>
              </select>
              <div>
                {(inbox?.tags ?? ops?.handover_tags ?? []).map(t => (
                  <label key={t.code} className="m" style={{ marginRight: 10 }}>
                    <input type="checkbox" checked={noteTags.includes(t.code)} onChange={e => setNoteTags(e.target.checked ? [...noteTags, t.code] : noteTags.filter(c => c !== t.code))} /> {t.label}
                  </label>
                ))}
              </div>
              <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What's running, any issues, and anything a guest needs the next shift to know" />
              <button className="btn" onClick={async () => { setErr(null); try { await api("/v1/ops/handover", { method: "POST", body: JSON.stringify({ department: deptFromTags(noteTags), shift: noteShift, body: note, tags: noteTags }) }); setNote(""); setOps(await api("/v1/ops/board")); setInbox(await api("/v1/ops/handover/inbox")); } catch (e) { setErr((e as Error).message); } }}>Leave the note</button>
            </div>
            {(ops?.notices ?? []).map(n => <div className="card" key={n.id}><h2>{n.title}</h2><p>{n.body}</p></div>)}
          </div>
        )}
        {tab === "tasks" && (
          <div>
            <div className="card">
              <h2>Tasks · {tasks?.counts.open ?? 0} open</h2>
              <p className="m">Acknowledge, start, pause, finish. History stays even if the wording is edited later.</p>
              <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="New task for the house" />
              <button className="btn" onClick={async () => {
                setErr(null);
                try {
                  await api("/v1/ops/tasks", { method: "POST", body: JSON.stringify({ title: taskTitle, assigned_staff_id: undefined }) });
                  setTaskTitle("");
                  setTasks(await api("/v1/ops/tasks"));
                } catch (e) { setErr((e as Error).message); }
              }}>Open task</button>
            </div>
            {(tasks?.items ?? []).map(t => (
              <div className="card" key={t.id}>
                <h2>{t.title}</h2>
                <p className="m">{t.department_label}{t.room_label ? ` · ${t.room_label}` : ""} · {t.status_label}{t.overdue ? " · overdue" : ""}</p>
                <div className="tabs">
                  {t.next.map(a => (
                    <button key={a.status} className="btn" onClick={async () => {
                      try {
                        await api(`/v1/ops/tasks/${t.id}/status`, { method: "POST", body: JSON.stringify({ status: a.status }) });
                        setTasks(await api("/v1/ops/tasks"));
                      } catch (e) { setErr((e as Error).message); }
                    }}>{a.label}</button>
                  ))}
                </div>
              </div>
            ))}
            {(!tasks || tasks.items.length === 0) && <p className="m">No tasks on your list.</p>}
          </div>
        )}
        {tab === "fault" && <FaultPocket me={me} canWork={(me.permissions ?? []).includes("maintenance.work")} onError={setErr} />}
        {tab === "stock" && (me.permissions ?? []).includes("kitchen.stock") && <StockPocket onError={setErr} />}
        {tab === "desk" && (
          <div>
            <div className="card">
              <h2>Today · {desk?.today.weekday} · {desk?.today.title}</h2>
              <p>{desk?.today.method}</p>
              <p className="m">{desk?.today.ingredients.map(i => `${i.qty} ${i.name}`).join(" · ")}</p>
              <button className="btn" onClick={() => void orderWater("today")}>Order today&apos;s fruit</button>
            </div>
            <div className="card">
              <h2>Tomorrow · {desk?.tomorrow.weekday} · {desk?.tomorrow.title}</h2>
              <p className="m">{desk?.tomorrow.ingredients.map(i => `${i.qty} ${i.name}`).join(" · ")}</p>
              <button className="btn" onClick={() => void orderWater("tomorrow")}>Order tomorrow ahead</button>
            </div>
            <div className="card">
              <h2>Always ready</h2>
              <p className="m">Walkers and Nairn&apos;s (gluten-free) biscuits. Plant milks. Suma herbals. Loose teas from organic wholesale. Dirty cups to the wash; clean cups back to the restaurant. Coffee machines at 09:00.</p>
              {(desk?.stock ?? []).map(s => <div className="row" key={s.id}><span>{s.name}</span></div>)}
            </div>
          </div>
        )}
        {tab === "night" && (
          <div>
            <div className="card">
              <h2>Night porter</h2>
              <p className="m">Two lock-ups. Front door — never leave the latch off. Dirty cups away. Fill teas and cups for morning. Write the night note before you go.</p>
            </div>
            {(ops?.checklists ?? []).filter(c => c.department === "NIGHT").map(c => (
              <label key={c.id} className="row" style={{ alignItems: "center" }}>
                <input type="checkbox" checked={c.done} onChange={async e => { await api(`/v1/ops/checklists/${c.id}/tick`, { method: "POST", body: JSON.stringify({ done: e.target.checked }) }); setOps(await api("/v1/ops/board")); }} />
                <span>{c.due_time ? `${c.due_time} · ` : ""}{c.title}</span>
              </label>
            ))}
            <div className="card">
              <h2>Handover to morning</h2>
              {(ops?.handover ?? []).filter(h => h.shift === "night" || h.department === "NIGHT").slice(0, 4).map(h => <div className="row" key={h.id} style={{ display: "block" }}><b>{h.shift_label}</b><div>{h.body}</div></div>)}
              <textarea rows={3} value={nightNote} onChange={e => setNightNote(e.target.value)} placeholder="Who arrived late, what was unlocked, what ran out" />
              <button className="btn" onClick={async () => { setErr(null); try { await api("/v1/ops/handover", { method: "POST", body: JSON.stringify({ department: "NIGHT", shift: "night", body: nightNote }) }); setNightNote(""); setOps(await api("/v1/ops/board")); } catch (e) { setErr((e as Error).message); } }}>Leave the night note</button>
            </div>
          </div>
        )}
        {tab === "manual" && (
          <div>
            <p className="m">What it should look like, and how to act. A sent SOP also lands under SOP — mark that one received.</p>
            <div className="tabs">
              {manuals.map(m => <button key={m.slug} className={manualSlug === m.slug ? "on" : ""} onClick={() => setManualSlug(m.slug)}>{m.title}</button>)}
            </div>
            {manuals.filter(m => m.slug === manualSlug).map(m => (
              <div key={m.slug}>
                <div className="card">
                  <h2>{m.title}</h2>
                  <p className="m">{m.department_label} · {m.kind_label}</p>
                  <p><b>Look.</b> {m.summary}</p>
                  <p style={{ whiteSpace: "pre-wrap" }}><b>Act.</b> {m.body}</p>
                </div>
                {m.diagram.length > 0 && <div className="card"><p className="m">{m.diagram.map(d => d.title).join(" → ")}</p></div>}
                {m.steps.map(s => (
                  <div className="card" key={s.title}>
                    <h2>{s.title}</h2>
                    <p><b>Look.</b> {s.look}</p>
                    <p><b>Act.</b> {s.act}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {tab === "sop" && (
          <div>
            <p className="m">Chapters sent to you. Read, then mark received — that is the house knowing you have it. The full book is under Manual.</p>
            {sops.length === 0 && <p className="m">No SOP has been sent to you yet. Open Manual for the live book.</p>}
            {sops.map(s => (
              <div className="card" key={s.id}>
                <h2>{s.title}</h2>
                <p style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>
                {!s.read_at && <button className="btn ghost" onClick={async () => { await api(`/staff/sop/${s.id}/read`, { method: "POST" }); setSops((await api<{ items: typeof sops }>("/staff/sop")).items); }}>Mark as read</button>}
              </div>
            ))}
          </div>
        )}
        {err && <div className="note">{err}</div>}
        <button className="btn ghost" onClick={() => { tok.set(null); setMe(null); }}>Sign out</button>
      </div>
    </>
  );
}
