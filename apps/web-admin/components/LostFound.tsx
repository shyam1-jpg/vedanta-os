"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Event = { from_status: string | null; to_status: string | null; note: string | null; by_name: string | null; created_at: string };
type Item = {
  id: string; description: string; category: string; place: string; found_on: string; found_by_name: string | null;
  storage: string | null; status: string; claimant_name: string | null; return_method: string | null;
  handled_by_name: string | null; held_long: boolean; has_photo: boolean; events: Event[];
};
type Report = {
  id: string; description: string | null; category: string; place: string | null; happened_on: string | null;
  contact_name: string | null; contact_email: string | null; status: string;
  suggestions: { id: string; description: string; place: string; found_on: string }[];
};
type Board = { items: Item[]; reports: Report[]; rooms: string[]; areas: string[]; categories: { code: string; label: string }[]; hold_days: number };

const STATUS: Record<string, string> = { logged: "Logged", matched: "Matched", claimed: "Claimed", returned: "Returned", disposed: "Disposed", donated: "Donated" };

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("Attach a photo as an image")); el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
    if (data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export default function LostFound() {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState({ q: "", category: "", status: "", place: "" });
  const [found, setFound] = useState({ description: "", category: "other", place: "", found_on: "", storage: "", photo: "" });
  const [missing, setMissing] = useState({ description: "", category: "other", place: "", happened_on: "", contact_name: "", contact_email: "", contact_phone: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const load = () => {
    const qs = new URLSearchParams();
    if (filter.q) qs.set("q", filter.q);
    if (filter.category) qs.set("category", filter.category);
    if (filter.status) qs.set("status", filter.status);
    if (filter.place) qs.set("place", filter.place);
    api<Board>(`/v1/lost-found?${qs}`).then(setBoard).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open lost and found"));
  };
  useEffect(() => { load(); }, [filter.category, filter.status, filter.place]);
  if (!board) return <div className="empty">Opening lost and found…</div>;
  const places = [...board.rooms.map(n => `Room ${n}`), ...board.areas];
  const move = async (item: Item, status: string, extra: Record<string, string> = {}) => {
    try {
      await api(`/v1/lost-found/${item.id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) });
      say("Updated");
      load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not update it"); }
  };
  return (
    <>
      <div className="topbar"><div><h1>Lost and found</h1><p>What was found, what a guest is missing, and what should not be held past {board.hold_days} days.</p></div></div>
      <div className="panel">
        <h3>Log a found item</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Description" placeholder="What was found" value={found.description} onChange={e => setFound({ ...found, description: e.target.value })} />
          <select aria-label="Category" value={found.category} onChange={e => setFound({ ...found, category: e.target.value })}>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Where it was found" value={found.place} onChange={e => setFound({ ...found, place: e.target.value })}>
            <option value="">Where</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <label>Date found<input type="date" value={found.found_on} onChange={e => setFound({ ...found, found_on: e.target.value })} /></label>
          <input aria-label="Storage" placeholder="Where it is kept" value={found.storage} onChange={e => setFound({ ...found, storage: e.target.value })} />
          <input type="file" accept="image/*" aria-label="Photo" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setFound({ ...found, photo: await shrink(file) }); } catch (err) { say((err as Error).message); } }} />
          <button className="btn primary" type="button" onClick={async () => {
            try {
              await api("/v1/lost-found", { method: "POST", body: JSON.stringify(found) });
              setFound({ description: "", category: "other", place: "", found_on: "", storage: "", photo: "" });
              say("Logged");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not log it"); }
          }}>Log found item</button>
        </div>
        <h3 style={{ marginTop: 18 }}>A guest reports something missing</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
          <input aria-label="Missing item" placeholder="What is missing" value={missing.description} onChange={e => setMissing({ ...missing, description: e.target.value })} />
          <select aria-label="Missing category" value={missing.category} onChange={e => setMissing({ ...missing, category: e.target.value })}>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Where it was missed" value={missing.place} onChange={e => setMissing({ ...missing, place: e.target.value })}>
            <option value="">Where they last had it</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <label>Around this date<input type="date" value={missing.happened_on} onChange={e => setMissing({ ...missing, happened_on: e.target.value })} /></label>
          <input aria-label="Contact name" placeholder="Name" value={missing.contact_name} onChange={e => setMissing({ ...missing, contact_name: e.target.value })} />
          <input aria-label="Contact email" placeholder="Email" value={missing.contact_email} onChange={e => setMissing({ ...missing, contact_email: e.target.value })} />
          <input aria-label="Contact phone" placeholder="Phone" value={missing.contact_phone} onChange={e => setMissing({ ...missing, contact_phone: e.target.value })} />
          <button className="btn" type="button" onClick={async () => {
            try {
              await api("/v1/lost-found/reports", { method: "POST", body: JSON.stringify(missing) });
              setMissing({ description: "", category: "other", place: "", happened_on: "", contact_name: "", contact_email: "", contact_phone: "" });
              say("Report saved");
              load();
            } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the report"); }
          }}>Save missing report</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Found</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Search found items" placeholder="Search" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") load(); }} />
          <select aria-label="Filter category" value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}><option value="">All categories</option>{board.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <select aria-label="Filter status" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select aria-label="Filter place" value={filter.place} onChange={e => setFilter({ ...filter, place: e.target.value })}><option value="">All places</option>{places.map(p => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        {board.items.map(item => (
          <div className="ops-card" key={item.id}>
            <div className="ops-card-top"><b>{item.description}</b><span className="m">{STATUS[item.status] ?? item.status}{item.held_long ? " · held too long" : ""}</span></div>
            <div className="m">{item.place} · found {item.found_on} by {item.found_by_name ?? "staff"}{item.storage ? ` · kept in ${item.storage}` : ""}{item.has_photo ? " · photo" : ""}</div>
            {item.claimant_name && <div className="m">Claimed by {item.claimant_name}{item.return_method ? ` · ${item.return_method}` : ""}{item.handled_by_name ? ` · handled by ${item.handled_by_name}` : ""}</div>}
            <div className="tabs">
              {item.status === "logged" && <button className="btn" type="button" onClick={() => move(item, "matched")}>Mark matched</button>}
              {(item.status === "logged" || item.status === "matched") && <button className="btn" type="button" onClick={() => { const name = window.prompt("Who claimed it?") ?? ""; if (name.trim()) move(item, "claimed", { claimant_name: name.trim() }); }}>Claimed</button>}
              {item.status === "claimed" && <button className="btn" type="button" onClick={() => move(item, "returned", { claimant_name: item.claimant_name ?? "", return_method: "collected" })}>Collected</button>}
              {item.status === "claimed" && <button className="btn" type="button" onClick={() => move(item, "returned", { claimant_name: item.claimant_name ?? "", return_method: "posted" })}>Posted</button>}
              {!["returned", "disposed", "donated"].includes(item.status) && <button className="btn" type="button" onClick={() => move(item, "disposed")}>Dispose</button>}
              {!["returned", "disposed", "donated", "claimed"].includes(item.status) && <button className="btn" type="button" onClick={() => move(item, "donated")}>Donate</button>}
            </div>
            {(item.events ?? []).length > 0 && <ul className="m">{item.events.map((ev, i) => <li key={i}>{ev.to_status}{ev.by_name ? ` · ${ev.by_name}` : ""}{ev.note ? ` · ${ev.note}` : ""}</li>)}</ul>}
          </div>
        ))}
        {board.items.length === 0 && <p className="m">Nothing in the log for this filter.</p>}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Missing</h3>
        {board.reports.map(report => (
          <div className="ops-card" key={report.id}>
            <div className="ops-card-top"><b>{report.description}</b><span className="m">{report.status}</span></div>
            <div className="m">{report.place || "Place not given"}{report.happened_on ? ` · ${report.happened_on}` : ""}{report.contact_name ? ` · ${report.contact_name}` : ""}</div>
            {report.suggestions.length > 0 && <div className="m">Possible matches: {report.suggestions.map(s => `${s.description} (${s.place}, ${s.found_on})`).join(" · ")}</div>}
            {report.suggestions[0] && report.status === "open" && <button className="btn" type="button" onClick={() => move({ id: report.suggestions[0].id } as Item, "matched", { report_id: report.id })}>Link the closest match</button>}
          </div>
        ))}
        {board.reports.length === 0 && <p className="m">No missing reports.</p>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
