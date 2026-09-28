"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";

const DEPARTMENTS = [
  ["HK", "Housekeeping"],
  ["KITCHEN", "Kitchen"],
  ["RESTAURANT", "Restaurant"],
  ["FRONT", "Front of house"],
  ["GROUNDS", "Estate and grounds"],
  ["MAINT", "Maintenance"],
  ["MGMT", "Management"],
  ["HOUSE", "House"],
];

type Catalogue = {
  rooms: string[];
  areas: string[];
  assets: { id: string; name: string; category: string | null; qr_code: string | null }[];
  categories: { code: string; label: string }[];
  urgencies: { code: string; label: string }[];
  reporter: string;
};

type Note = { body: string; created_at: string; author: string | null };
type Hist = { id: string; number: number; title: string; status: string; created_at: string };
type T = {
  id: string; number: number; title: string; description: string | null; priority: string; status: string;
  location: string | null; department: string | null; room: string | null; room_id?: string | null;
  takes_room_out: boolean; resolution: string | null; created_at: string; reported_by: string | null;
  assigned_to: string | null; assigned_to_user_id: string | null;
  asset_id: string | null; asset_name: string | null; asset_code?: string | null;
  equipment_label: string | null; equipment_category: string | null;
  food_safety: boolean; has_photo: boolean;
  urgency_label?: string; status_label?: string;
  notes?: Note[]; earlier_room?: number; earlier_asset?: number;
};

const PRI: Record<string, string> = { SAFETY: "Urgent / safety", URGENT: "Today", NORMAL: "When possible", LOW: "Low" };
const ST: Record<string, string> = { OPEN: "Open", ACKNOWLEDGED: "Acknowledged", IN_PROGRESS: "In progress", WAITING_PARTS: "Waiting for parts", DONE: "Fixed", CANCELLED: "Cancelled" };
const STATUSES = [
  ["open", "Open"],
  ["ACKNOWLEDGED", "Acknowledged"],
  ["IN_PROGRESS", "In progress"],
  ["WAITING_PARTS", "Waiting for parts"],
  ["DONE", "Fixed"],
  ["CANCELLED", "Cancelled"],
  ["closed", "Closed"],
  ["all", "All"],
];

function gearOf(t: { asset_name?: string | null; equipment_label?: string | null; equipment_category?: string | null; asset_code?: string | null }) {
  const bits = [t.asset_name, t.asset_code, t.equipment_label, t.equipment_category].filter(Boolean);
  return [...new Set(bits)].join(" · ");
}

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

export function ReportFault({ room, onClose, onDone }: { room?: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { user } = useStore();
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [place, setPlace] = useState<"room" | "area">(room ? "room" : "room");
  const [roomNo, setRoomNo] = useState(room ?? "");
  const [area, setArea] = useState("");
  const [assetId, setAssetId] = useState("");
  const [category, setCategory] = useState("");
  const [equipment, setEquipment] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("NORMAL");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [out, setOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Catalogue>("/v1/maintenance/catalogue").then(setCat).catch(() => setCat(null));
  }, []);

  const rooms = cat?.rooms?.length ? (room && !cat.rooms.includes(room) ? [room, ...cat.rooms] : cat.rooms) : [];
  const asset = cat?.assets.find(a => a.id === assetId);
  const foodish = /fridge|freezer|walk-?in|cold room|cold-room|chiller/i.test([asset?.name, asset?.category, equipment, category].filter(Boolean).join(" "));
  const placeOk = place === "room" ? !!roomNo.trim() : !!area.trim();

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ number: number; food_safety: boolean }>("/v1/maintenance", {
        method: "POST",
        body: JSON.stringify({
          description: description.trim(),
          room: place === "room" ? roomNo.trim() : undefined,
          area: place === "area" ? area.trim() : undefined,
          asset_id: assetId || undefined,
          equipment_category: category || undefined,
          equipment_label: equipment.trim() || undefined,
          urgency,
          photo: photo || undefined,
          takes_room_out: place === "room" && out,
          department: user?.department || undefined,
        }),
      });
      const where = place === "room" ? `room ${roomNo.trim()}` : area.trim();
      onDone(`Reported as M-${r.number} · ${where}${r.food_safety ? " · kitchen copied" : ""}${out && place === "room" ? " · room is out of order" : ""}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.problem.detail : "Could not report");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="fault-title">
      <header><h2 id="fault-title">Report a fault</h2><button className="btn" onClick={onClose}>Close</button></header>
      <p className="m">This goes to maintenance. The general manager is copied. A fridge or freezer is also copied to the kitchen.</p>
      <div className="fgrid">
        <label className="span2">Reported by<input value={cat?.reporter || user?.name || "You"} readOnly /></label>
        <label>Where<select value={place} onChange={e => setPlace(e.target.value === "area" ? "area" : "room")}><option value="room">A room</option><option value="area">An area</option></select></label>
        {place === "room" ? (
          <label>Room number{rooms.length > 0
            ? <select value={roomNo} onChange={e => setRoomNo(e.target.value)}><option value="">Choose a room…</option>{rooms.map(n => <option key={n} value={n}>{n}</option>)}</select>
            : <input value={roomNo} onChange={e => setRoomNo(e.target.value)} placeholder="e.g. 12" />}</label>
        ) : (
          <label>Area{(cat?.areas.length ?? 0) > 0
            ? <select value={area} onChange={e => setArea(e.target.value)}><option value="">Choose an area…</option>{cat!.areas.map(a => <option key={a} value={a}>{a}</option>)}</select>
            : <input value={area} onChange={e => setArea(e.target.value)} placeholder="Kitchen, halls, grounds…" />}</label>
        )}
        <label className="span2">Equipment on the register<select value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">Not on the list</option>{(cat?.assets ?? []).map(a => <option key={a.id} value={a.id}>{a.name}{a.qr_code ? ` · ${a.qr_code}` : ""}</option>)}</select></label>
        <label>Or a category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">None</option>{(cat?.categories ?? [{ code: "furniture", label: "Furniture" }, { code: "plumbing", label: "Plumbing" }, { code: "electrical", label: "Electrical" }, { code: "appliance", label: "Appliance" }]).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
        <label>Or say what it is<input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="e.g. Fridge 2, banquet chair" /></label>
        <label>How urgent<select value={urgency} onChange={e => setUrgency(e.target.value)}>{(cat?.urgencies ?? [{ code: "SAFETY", label: "Urgent / safety" }, { code: "URGENT", label: "Today" }, { code: "NORMAL", label: "When possible" }]).map(u => <option key={u.code} value={u.code}>{u.label}</option>)}</select></label>
        <label>Photo, if you have one<input type="file" accept="image/*" onChange={async e => {
          const file = e.target.files?.[0];
          setErr(null);
          if (!file) { setPhoto(null); setPhotoName(""); return; }
          try { setPhoto(await shrinkPhoto(file)); setPhotoName(file.name); }
          catch (ex) { setPhoto(null); setPhotoName(""); setErr(ex instanceof Error ? ex.message : "Could not read the photo"); }
        }} />{photoName && <span className="m">{photoName} attached</span>}</label>
        {place === "room" && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}><input type="checkbox" checked={out} onChange={e => setOut(e.target.checked)} disabled={!roomNo.trim()} />Room can&apos;t be used until fixed</label>}
        <label className="span2">What is wrong?<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. toilet not flushing, overflowing, furniture broken" /></label>
      </div>
      {foodish && <div className="note">This looks like a fridge or freezer. The kitchen will be told as well.</div>}
      {err && <div className="note">{err}</div>}
      <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !description.trim() || !placeOk} onClick={submit}>{busy ? "Sending…" : "Report"}</button></div>
    </div></div>);
}

export default function Maintenance() {
  const { can } = useStore();
  const work = can("maintenance.work");
  const seeAll = can("maintenance.read");
  const [items, setItems] = useState<T[]>([]);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [status, setStatus] = useState("open");
  const [room, setRoom] = useState("");
  const [area, setArea] = useState("");
  const [equipment, setEquipment] = useState("");
  const [reporting, setReporting] = useState(false);
  const [noteFor, setNoteFor] = useState<Record<string, string>>({});
  const [photoFor, setPhotoFor] = useState<{ id: string; photo: string | null; history: Hist[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => {
    const q = new URLSearchParams({ status });
    if (!seeAll) q.set("mine", "1");
    if (room.trim()) q.set("room", room.trim());
    if (area.trim()) q.set("area", area.trim());
    if (equipment.trim()) q.set("equipment", equipment.trim());
    api<{ items: T[]; assignees: { id: string; name: string }[] }>(`/v1/maintenance?${q}`).then(r => { setItems(r.items); setAssignees(r.assignees); }).catch(() => {});
  };
  useEffect(() => { load(); }, [status, room, area, equipment, seeAll]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<{ areas: string[] }>("/v1/maintenance/catalogue").then(r => setAreas(r.areas)).catch(() => {}); }, []);

  const cmd = async (t: T, c: string) => {
    const body: Record<string, unknown> = {};
    if (c === "done") { body.resolution = prompt("What was fixed?") ?? ""; if (t.takes_room_out && t.room) body.room_back_in_service = confirm(`Put room ${t.room} back in service? Only if a safety check has been done.`); }
    if (c === "cancel") body.resolution = prompt("Why cancel?") ?? "";
    try {
      await api(`/v1/maintenance/${t.id}/commands/${c}`, { method: "POST", body: JSON.stringify(body) });
      say(`M-${t.number} ${c === "done" ? "fixed" : c === "acknowledge" ? "acknowledged" : c === "start" ? "in progress" : c === "wait" ? "waiting for parts" : c}`);
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not update"); }
  };
  const addNote = async (t: T) => {
    const body = (noteFor[t.id] ?? "").trim();
    if (!body) return;
    try {
      await api(`/v1/maintenance/${t.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
      setNoteFor(s => ({ ...s, [t.id]: "" }));
      say(`Note added on M-${t.number}`);
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not add the note"); }
  };
  const showMore = async (t: T) => {
    if (photoFor?.id === t.id) { setPhotoFor(null); return; }
    try {
      const d = await api<{ photo: string | null; history: Hist[] }>(`/v1/maintenance/${t.id}`);
      setPhotoFor({ id: t.id, photo: d.photo, history: d.history ?? [] });
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not open the ticket"); }
  };
  const deptName = (c: string | null) => DEPARTMENTS.find(([d]) => d === c)?.[1] ?? c ?? "—";
  const urgent = items.filter(t => t.priority === "SAFETY" || t.priority === "URGENT").length;

  return (
    <>
      <div className="topbar"><div><h1>Maintenance</h1><p>{seeAll ? `${items.length} on this list · ${urgent} urgent or safety` : "Your reports. Maintenance and the general manager see the same updates."}</p></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{can("maintenance.report") && <button className="btn primary" onClick={() => setReporting(true)}>Report a fault</button>}</div></div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="fgrid">
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Room<input value={room} onChange={e => setRoom(e.target.value)} placeholder="Room number" /></label>
          <label>Area<select value={area} onChange={e => setArea(e.target.value)}><option value="">Any area</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
          <label>Equipment<input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="Fridge, plumbing…" /></label>
        </div>
      </div>
      {items.length === 0 && <div className="empty" style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 10 }}>Nothing on this list.</div>}
      <div className="hkgrid">{items.map(t => {
        const gear = gearOf(t);
        const open = photoFor?.id === t.id;
        return (
        <div key={t.id} className={"hk " + (t.priority === "SAFETY" || t.priority === "URGENT" ? "VACANT_DIRTY" : t.status === "IN_PROGRESS" || t.status === "ACKNOWLEDGED" ? "CLEANING" : t.status === "DONE" ? "INSPECTED" : "VACANT_CLEAN")}>
          <div className="hk-top"><b>M-{t.number} · {t.room ? `Room ${t.room}` : t.location ?? "—"}</b><span className={"chip " + (t.priority === "SAFETY" ? "sev-high" : t.priority === "URGENT" ? "sev-mid" : "PROVISIONAL")}>{t.urgency_label || PRI[t.priority] || t.priority}</span></div>
          <div style={{ fontWeight: 500, marginTop: 4 }}>{t.title}</div>
          {t.description && t.description !== t.title && <div className="m">{t.description}</div>}
          {gear && <div className="m">Equipment: {gear}</div>}
          <div className="m" style={{ marginTop: 4 }}>{t.status_label || ST[t.status] || t.status} · {deptName(t.department)} · reported by {t.reported_by ?? "—"} {new Date(t.created_at).toLocaleDateString("en-GB")}{t.takes_room_out ? " · room out of order" : ""}{t.assigned_to ? ` · ${t.assigned_to}` : ""}</div>
          {t.food_safety && <div style={{ marginTop: 6 }}><span className="chip sev-high">Food safety · kitchen copied</span></div>}
          {(t.earlier_room ?? 0) > 0 && t.room && <button className="btn" style={{ marginTop: 8 }} onClick={() => { setRoom(t.room!); setArea(""); setStatus("all"); }}>Earlier faults in room {t.room}: {t.earlier_room}</button>}
          {(t.earlier_asset ?? 0) > 0 && <button className="btn" style={{ marginTop: 8 }} onClick={() => { setEquipment(t.asset_name || t.equipment_label || ""); setStatus("all"); }}>Earlier faults on this equipment: {t.earlier_asset}</button>}
          {(t.notes ?? []).map((n, i) => <div className="m" key={i} style={{ marginTop: 4 }}>{n.author ?? "Staff"}: {n.body}</div>)}
          {t.resolution && <div className="m" style={{ marginTop: 2 }}>Resolution: {t.resolution}</div>}
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <input value={noteFor[t.id] ?? ""} onChange={e => setNoteFor(s => ({ ...s, [t.id]: e.target.value }))} placeholder="Add a note" style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6 }} />
            <button className="btn" onClick={() => addNote(t)}>Add note</button>
          </div>
          <button className="btn" onClick={() => showMore(t)}>{open ? "Hide history" : "Photo and history"}</button>
          {open && photoFor?.photo && <img alt={`Photo on M-${t.number}`} src={photoFor.photo} style={{ marginTop: 8, maxWidth: "100%", borderRadius: 6 }} />}
          {open && <div className="m" style={{ marginTop: 6 }}>{(photoFor?.history ?? []).length === 0 ? "No earlier fault in this room or on this equipment." : (photoFor?.history ?? []).map(h => <div key={h.id}>M-{h.number} · {ST[h.status] || h.status} · {h.title} · {new Date(h.created_at).toLocaleDateString("en-GB")}</div>)}</div>}
          {work && seeAll && !["DONE", "CANCELLED"].includes(t.status) && <div style={{ marginTop: 8 }}><select className="btn" value={t.assigned_to_user_id ?? ""} onChange={e => api(`/v1/maintenance/${t.id}`, { method: "PATCH", body: JSON.stringify({ assigned_to_user_id: e.target.value || null }) }).then(load)}><option value="">Unassigned</option>{assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
          {work && <div className="hk-actions">
            {t.status === "OPEN" && <button className="btn" onClick={() => cmd(t, "acknowledge")}>Acknowledge</button>}
            {["OPEN", "ACKNOWLEDGED", "WAITING_PARTS"].includes(t.status) && <button className="btn primary" onClick={() => cmd(t, "start")}>Start</button>}
            {["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(t.status) && <button className="btn" onClick={() => cmd(t, "wait")}>Waiting for parts</button>}
            {!["DONE", "CANCELLED"].includes(t.status) && <><button className="btn primary" onClick={() => cmd(t, "done")}>Fixed</button><button className="btn danger" onClick={() => cmd(t, "cancel")}>Cancel</button></>}
            {["DONE", "CANCELLED"].includes(t.status) && <button className="btn" onClick={() => cmd(t, "reopen")}>Reopen</button>}
          </div>}
        </div>);
      })}</div>
      {reporting && <ReportFault onClose={() => setReporting(false)} onDone={m => { setReporting(false); say(m); load(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
