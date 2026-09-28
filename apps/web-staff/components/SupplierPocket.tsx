"use client";
import { useEffect, useState } from "react";
import { api, shrinkPhoto } from "@/lib/client";

type Supplier = { id: string; name: string; categories: string[]; phone: string | null; next_delivery: string | null; alert: string | null; example: boolean };

export default function SupplierPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [items, setItems] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const load = (query = q) => api<{ items: Supplier[] }>(`/v1/supplier-register?active=active&q=${encodeURIComponent(query)}`).then(r => setItems(r.items));
  useEffect(() => { load("").catch(e => onError((e as Error).message)); }, []);
  const log = async (id: string, status: string, photo = "") => {
    try {
      await api(`/v1/supplier-register/${id}/deliveries`, { method: "POST", body: JSON.stringify({ status, photo }) });
      onError(null);
      await load();
    } catch (e) { onError((e as Error).message); }
  };
  const due = items.filter(i => i.alert);
  return (
    <div>
      {due.length > 0 && <div className="note"><b>Deliveries.</b> {due.map(i => `${i.name} (${i.alert})`).join(" · ")}</div>}
      <input aria-label="Search suppliers" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load().catch(err => onError((err as Error).message)); }} />
      {items.map(item => (
        <div className="card" key={item.id}>
          <h2>{item.name}{item.example ? " · example" : ""}</h2>
          <p className="m">{item.categories.join(", ")}{item.phone ? ` · ${item.phone}` : ""}{item.next_delivery ? ` · ${item.next_delivery}` : ""}{item.alert ? ` · ${item.alert}` : ""}</p>
          <div className="tabs">
            <button className="btn" type="button" onClick={() => log(item.id, "received")}>Received</button>
            <button className="btn" type="button" onClick={() => log(item.id, "partial")}>Partial</button>
            <button className="btn" type="button" onClick={() => log(item.id, "missed")}>Missed</button>
          </div>
          <input type="file" accept="image/*" aria-label={`Photo for ${item.name}`} onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            try { await log(item.id, "received", await shrinkPhoto(file)); } catch (err) { onError((err as Error).message); }
          }} />
        </div>
      ))}
      {items.length === 0 && <p className="m">No suppliers yet.</p>}
    </div>
  );
}
