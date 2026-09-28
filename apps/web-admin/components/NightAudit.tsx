"use client";
import { useEffect, useState } from "react";
import { API, api, ApiError, token } from "@/lib/api";

type Tone = "red" | "amber" | "green";
type Headline = { label: string; value: string; tone: Tone };
type Section = { key: string; title: string; tone: Tone; summary: string; lines: string[] };
type Report = { auditDate: string; tomorrow: string; headline: Headline[]; sections: Section[] };
type Item = { id: string; audit_date: string; generated_at: string; source: string; emailed_at: string | null; headline: Headline[] | null };

function ReportView({ report }: { report: Report }) {
  return (
    <div data-testid="night-audit-report">
      <p className="m">For the morning of {report.tomorrow}. Food is not counted.</p>
      <ul className="audit-counts" data-testid="night-audit-counts">
        {report.headline.map(item => (
          <li key={item.label}><i className={`audit-dot ${item.tone}`} aria-hidden="true" /><b>{item.value}</b><span>{item.label}</span></li>
        ))}
      </ul>
      {report.sections.map(section => (
        <section className="panel" key={section.key} data-testid="night-audit-section" data-tone={section.tone} style={{ marginTop: 12 }}>
          <h3><i className={`audit-dot ${section.tone}`} aria-hidden="true" /> {section.title}</h3>
          <p className="m">{section.summary}</p>
          <ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

export default function NightAudit() {
  const [items, setItems] = useState<Item[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

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
      .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the night audit"));
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const saved = await api<{ audit_date: string; report: Report }>("/v1/night-audit/generate", { method: "POST", body: "{}" });
      setDate(saved.audit_date);
      setReport(saved.report);
      await loadList();
      say("Tonight's report is ready");
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not generate the report"); }
    finally { setBusy(false); }
  };

  const email = async () => {
    if (!date) return;
    setBusy(true);
    try {
      const sent = await api<{ status: string }>(`/v1/night-audit/${date}/email`, { method: "POST", body: "{}" });
      say(sent.status === "LOGGED" ? "Logged for the general manager. It sends once SMTP is set." : "Emailed the general manager.");
      await loadList();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not email the report"); }
    finally { setBusy(false); }
  };

  const pdf = async () => {
    if (!date) return;
    const headers: Record<string, string> = {};
    const t = token.get(); if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/night-audit/${date}/pdf`, { headers });
    if (!res.ok) { say("Could not download the PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `night-audit-${date}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Night audit</h1>
          <p>A short report for the morning. One snapshot is kept for each night.</p>
        </div>
      </div>
      <div className="audit-actions">
        <button className="btn primary" type="button" data-testid="night-audit-generate" disabled={busy} onClick={generate}>Generate tonight</button>
        <button className="btn" type="button" data-testid="night-audit-pdf" disabled={!date || busy} onClick={pdf}>Download PDF</button>
        <button className="btn" type="button" data-testid="night-audit-email" disabled={!date || busy} onClick={email}>Email to GM</button>
      </div>
      {report ? <ReportView report={report} /> : <div className="empty" data-testid="night-audit-empty">No night audit yet. Generate tonight&apos;s report when you are ready.</div>}
      <div className="panel" style={{ marginTop: 16 }} data-testid="night-audit-history">
        <h3>Past reports</h3>
        {items.length === 0 && <p className="m">None yet.</p>}
        <ul>
          {items.map(item => (
            <li key={item.id}>
              <button className="linkbtn" type="button" onClick={() => openDate(item.audit_date).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open that night"))}>
                {item.audit_date}
              </button>
              {" · "}{item.source === "demand" ? "on demand" : "scheduled"}{item.emailed_at ? " · emailed" : ""}
            </li>
          ))}
        </ul>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
