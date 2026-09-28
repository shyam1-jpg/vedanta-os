"use client";
import { useEffect, useState } from "react";
import { api, readAttachment } from "@/lib/client";

type Item = { id: string; title: string; category_label: string; status: string; next_due: string | null; example: boolean; schedule_label: string };

export default function CompliancePocket({ onError }: { onError: (msg: string | null) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [issues, setIssues] = useState(false);
  const [file, setFile] = useState("");
  const load = () => api<{ items: Item[] }>("/v1/compliance/items").then(r => setItems(r.items.filter(i => i.status !== "completed")));
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []);
  const due = items.filter(i => i.status === "due" || i.status === "overdue");
  return (
    <div>
      {due.length > 0 && <div className="note"><b>{due.length} need attention.</b> {due.map(i => i.title).join(" · ")}</div>}
      {items.map(item => (
        <div className="card" key={item.id}>
          <h2>{item.title}{item.example ? " · example" : ""}</h2>
          <p className="m">{item.category_label} · {item.status}{item.next_due ? ` · ${item.next_due}` : ""} · {item.schedule_label}</p>
          <button className="btn" type="button" onClick={() => { setOpen(open === item.id ? null : item.id); setNotes(""); setIssues(false); setFile(""); }}>Log completion</button>
          {open === item.id && (
            <div>
              <textarea rows={2} value={notes} aria-label="Completion notes" onChange={e => setNotes(e.target.value)} />
              <label className="m"><input type="checkbox" checked={issues} onChange={e => setIssues(e.target.checked)} /> Something needs a corrective action</label>
              <input type="file" accept="image/*,.pdf" aria-label="Photo or PDF" onChange={async e => {
                const picked = e.target.files?.[0];
                if (!picked) return;
                try { setFile(await readAttachment(picked)); onError(null); } catch (err) { onError((err as Error).message); }
              }} />
              <button className="btn" type="button" onClick={async () => {
                try {
                  await api(`/v1/compliance/items/${item.id}/complete`, { method: "POST", body: JSON.stringify({ notes, found_issues: issues, attachment: file }) });
                  onError(null);
                  setOpen(null);
                  await load();
                } catch (e) { onError((e as Error).message); }
              }}>Save</button>
            </div>
          )}
        </div>
      ))}
      {items.length === 0 && <p className="m">Nothing due.</p>}
    </div>
  );
}
