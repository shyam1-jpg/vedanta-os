"use client";
import { useEffect, useState } from "react";
import { API, api, tok } from "@/lib/client";

type Tone = "red" | "amber" | "green";
type Headline = { label: string; value: string; tone: Tone };
type Section = { key: string; title: string; tone: Tone; summary: string; lines: string[] };
type Report = { auditDate: string; tomorrow: string; headline: Headline[]; sections: Section[] };
type Item = { id: string; audit_date: string; source: string; emailed_at: string | null };

export default function NightAuditPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = async () => {
    const list = await api<{ items: Item[] }>("/v1/night-audit");
    setItems(list.items);
    return list.items;
  };

  const openDate = async (auditDate: string) => {
    const row = await api<{ audit_date: string; report: Report }>(`/v1/night-audit/${auditDate}`);
    setDate(row.audit_date);
    setReport(row.report);
  };

  useEffect(() => {
    loadList()
      .then(list => { if (list[0]) return openDate(list[0].audit_date); })
      .catch(e => onError((e as Error).message));
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const saved = await api<{ audit_date: string; report: Report }>("/v1/night-audit/generate", { method: "POST", body: "{}" });
      setDate(saved.audit_date);
      setReport(saved.report);
      await loadList();
      onError(null);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const email = async () => {
    if (!date) return;
    setBusy(true);
    try {
      const sent = await api<{ status: string }>(`/v1/night-audit/${date}/email`, { method: "POST", body: "{}" });
      onError(sent.status === "LOGGED" ? "Logged for the general manager. It sends once SMTP is set." : null);
      await loadList();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const pdf = async () => {
    if (!date) return;
    const headers: Record<string, string> = {};
    const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/night-audit/${date}/pdf`, { headers });
    if (!res.ok) { onError("Could not download the PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `night-audit-${date}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="card">
        <h2>Night audit</h2>
        <p className="m">For the morning. Food is not counted. One snapshot each night.</p>
        <button className="btn" type="button" data-testid="night-audit-generate" disabled={busy} onClick={generate}>Generate tonight</button>
        <button className="btn ghost" type="button" data-testid="night-audit-pdf" disabled={!date || busy} onClick={pdf}>Download PDF</button>
        <button className="btn ghost" type="button" data-testid="night-audit-email" disabled={!date || busy} onClick={email}>Email to GM</button>
      </div>
      {report ? (
        <div data-testid="night-audit-report">
          <ul className="audit-counts" data-testid="night-audit-counts">
            {report.headline.map(item => (
              <li key={item.label}><i className={`audit-dot ${item.tone}`} aria-hidden="true" /><b>{item.value}</b><span>{item.label}</span></li>
            ))}
          </ul>
          {report.sections.map(section => (
            <div className="card" key={section.key} data-testid="night-audit-section" data-tone={section.tone}>
              <h2><i className={`audit-dot ${section.tone}`} aria-hidden="true" /> {section.title}</h2>
              <p className="m">{section.summary}</p>
              <ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : <p className="m" data-testid="night-audit-empty">No night audit yet.</p>}
      <div className="card" data-testid="night-audit-history">
        <h2>Past reports</h2>
        {items.length === 0 && <p className="m">None yet.</p>}
        {items.map(item => (
          <button className="btn ghost" type="button" key={item.id} onClick={() => openDate(item.audit_date).catch(e => onError((e as Error).message))}>
            {item.audit_date} · {item.source === "demand" ? "on demand" : "scheduled"}{item.emailed_at ? " · emailed" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
