"use client";
import { useEffect, useState } from "react";
import { api, shrinkPhoto } from "@/lib/client";

type Item = { id: string; description: string; place: string; found_on: string; status: string; held_long: boolean };
type Report = { id: string; description: string | null; suggestions: { description: string; place: string }[] };

export default function LostPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState("");
  const [foundOn, setFoundOn] = useState("");
  const [storage, setStorage] = useState("");
  const [photo, setPhoto] = useState("");
  const [missing, setMissing] = useState("");
  const load = () => api<{ items: Item[]; reports: Report[]; rooms: string[]; areas: string[] }>("/v1/lost-found").then(r => {
    setItems(r.items);
    setReports(r.reports);
    setPlaces([...r.rooms.map(n => `Room ${n}`), ...r.areas]);
  });
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  return (
    <div>
      {items.some(i => i.held_long) && <div className="note"><b>Held too long.</b> {items.filter(i => i.held_long).map(i => i.description).join(" · ")}</div>}
      <div className="card">
        <h2>Found</h2>
        <input aria-label="What was found" placeholder="What was found" value={description} onChange={e => setDescription(e.target.value)} />
        <select aria-label="Where found" value={place} onChange={e => setPlace(e.target.value)}><option value="">Where</option>{places.map(p => <option key={p}>{p}</option>)}</select>
        <input type="date" aria-label="Date found" value={foundOn} onChange={e => setFoundOn(e.target.value)} />
        <input aria-label="Storage" placeholder="Where it is kept" value={storage} onChange={e => setStorage(e.target.value)} />
        <input type="file" accept="image/*" aria-label="Photo" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setPhoto(await shrinkPhoto(file)); } catch (err) { onError((err as Error).message); } }} />
        <button className="btn" type="button" onClick={async () => {
          try {
            await api("/v1/lost-found", { method: "POST", body: JSON.stringify({ description, category: "other", place, found_on: foundOn, storage, photo }) });
            setDescription(""); setStorage(""); setPhoto("");
            onError(null);
            await load();
          } catch (e) { onError((e as Error).message); }
        }}>Log it</button>
      </div>
      {items.filter(i => !["returned", "disposed", "donated"].includes(i.status)).map(item => (
        <div className="card" key={item.id}>
          <h2>{item.description}</h2>
          <p className="m">{item.place} · {item.found_on} · {item.status}{item.held_long ? " · held too long" : ""}</p>
        </div>
      ))}
      <div className="card">
        <h2>Guest is missing something</h2>
        <textarea rows={2} aria-label="What is missing" value={missing} onChange={e => setMissing(e.target.value)} />
        <button className="btn" type="button" onClick={async () => {
          try {
            await api("/v1/lost-found/reports", { method: "POST", body: JSON.stringify({ description: missing, category: "other" }) });
            setMissing("");
            onError(null);
            await load();
          } catch (e) { onError((e as Error).message); }
        }}>Save report</button>
        {reports.filter(r => r.suggestions.length).map(r => <p className="m" key={r.id}>{r.description}: possible match {r.suggestions[0].description} ({r.suggestions[0].place})</p>)}
      </div>
    </div>
  );
}
