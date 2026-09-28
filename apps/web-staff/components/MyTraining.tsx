"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Item = {
  id: string; title: string; category_label: string; required: boolean; status: string;
  signed_off_at: string | null; signed_off_name: string | null; expires_on: string | null; sop_title: string | null; link: string | null; tone: string;
};

export default function MyTraining({ onError }: { onError: (msg: string | null) => void }) {
  const [cleared, setCleared] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const load = () => api<{ cleared: boolean; items: Item[] }>("/v1/induction/mine").then(r => { setCleared(r.cleared); setItems(r.items); });
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  return (
    <div>
      <div className="note"><b>{cleared ? "Cleared for unsupervised work." : "Not cleared for unsupervised work."}</b> A manager signs off each required item.</div>
      {items.map(item => (
        <div className="card" key={item.id}>
          <h2>{item.title}{item.required ? " · required" : ""}</h2>
          <p className="m">{item.category_label} · {item.tone === "cleared" ? "Signed off" : item.tone === "in_progress" ? "Waiting for sign-off" : item.tone === "expired" ? "Expired" : "Not started"}{item.expires_on ? ` · expires ${item.expires_on}` : ""}{item.signed_off_name ? ` · ${item.signed_off_name}` : ""}</p>
          {item.sop_title && <p className="m">SOP: {item.sop_title}</p>}
          {item.link && <p className="m"><a href={item.link}>Open the link</a></p>}
          {item.tone !== "cleared" && item.tone !== "expired" && (
            <button className="btn" type="button" onClick={async () => {
              try { await api(`/v1/induction/assignments/${item.id}/done`, { method: "POST", body: JSON.stringify({}) }); onError(null); await load(); }
              catch (e) { onError((e as Error).message); }
            }}>I've done this</button>
          )}
        </div>
      ))}
      {items.length === 0 && <p className="m">Nothing is on your list yet.</p>}
    </div>
  );
}
