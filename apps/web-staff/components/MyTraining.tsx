"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Step = { id: string; label: string; ticked: boolean };
type Item = {
  id: string; title: string; category_label: string; required: boolean; status: string;
  signed_off_at: string | null; signed_off_name: string | null; expires_on: string | null; sop_title: string | null; link: string | null; tone: string;
  checks: Step[];
};

export default function MyTraining({ onError }: { onError: (msg: string | null) => void }) {
  const [cleared, setCleared] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const load = () => api<{ cleared: boolean; items: Item[] }>("/v1/induction/mine").then(r => { setCleared(r.cleared); setItems(r.items); });
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  return (
    <div>
      <div className="note"><b>{cleared ? "Cleared for unsupervised work." : "Not cleared for unsupervised work."}</b> A manager signs off each required item.</div>
      {items.map(item => {
        const steps = item.checks ?? [];
        const finished = steps.length > 0 && steps.every(step => step.ticked);
        const started = steps.some(step => step.ticked);
        const state = item.tone === "cleared" ? "Signed off" : item.tone === "expired" ? "Expired" : finished || item.tone === "in_progress" ? "Waiting for sign-off" : started ? "In progress" : "Not started";
        return (
        <div className="card" key={item.id}>
          <h2>{item.title}{item.required ? " · required" : ""}</h2>
          <p className="m">{item.category_label} · {state}{item.expires_on ? ` · expires ${item.expires_on}` : ""}{item.signed_off_name ? ` · ${item.signed_off_name}` : ""}</p>
          {steps.map(step => (
            <label key={step.id} className="m" style={{ display: "block" }}>
              <input type="checkbox" checked={step.ticked} disabled={item.tone === "cleared"} onChange={async () => {
                try {
                  await api(`/v1/induction/assignments/${item.id}/ticks`, { method: "POST", body: JSON.stringify({ check_id: step.id, ticked: !step.ticked }) });
                  onError(null);
                  await load();
                } catch (e) { onError((e as Error).message); }
              }} /> {step.label}
            </label>
          ))}
          {item.sop_title && <p className="m">SOP: {item.sop_title}</p>}
          {item.link && <p className="m"><a href={item.link}>Open the link</a></p>}
          {steps.length === 0 && item.tone !== "cleared" && item.tone !== "expired" && (
            <button className="btn" type="button" onClick={async () => {
              try { await api(`/v1/induction/assignments/${item.id}/done`, { method: "POST", body: JSON.stringify({}) }); onError(null); await load(); }
              catch (e) { onError((e as Error).message); }
            }}>I've done this</button>
          )}
          {finished && item.tone !== "cleared" && <p className="m">A manager signs this off.</p>}
        </div>
        );
      })}
      {items.length === 0 && <p className="m">Nothing is on your list yet.</p>}
    </div>
  );
}
