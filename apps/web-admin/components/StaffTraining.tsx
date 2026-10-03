"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { staffTrainingSections, type TrainingSource } from "../../../domains/staff/training.ts";

type Chapter = TrainingSource & { id?: string };

export default function StaffTraining() {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<{ items: Chapter[] }>("/v1/manuals")
      .then(r => setChapters(r.items))
      .catch(e => setError(e instanceof ApiError ? e.problem.detail : "Could not open training. Try again."));
  };

  useEffect(() => { load(); }, []);

  if (!chapters && error) {
    return (
      <div className="empty" role="alert">
        <p>{error}</p>
        <button className="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!chapters) return <div className="empty">Opening staff training…</div>;

  const sections = staffTrainingSections(chapters);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Staff training</h1>
          <p>One section for each department the house already uses. A lesson is a chapter already in the manual. Where nothing is written, the section stays empty.</p>
        </div>
      </div>
      {error && <div className="note" role="alert">{error} <button className="btn" onClick={load}>Try again</button></div>}
      {sections.map(section => (
        <section key={section.code} className="house-panel training-section" aria-labelledby={`training-${section.code}`}>
          <div className="k">Department</div>
          <h2 id={`training-${section.code}`}>{section.name}</h2>
          {section.empty && <p className="training-empty">{section.empty}</p>}
          {section.items.map(item => (
            <article key={item.slug} className="training-item">
              <h3>{item.title}</h3>
              <p className="m">{item.kind_label}</p>
              <p>{item.summary}</p>
              <a className="btn" href={`/manual/?slug=${encodeURIComponent(item.slug)}`}>Open in the manual</a>
            </article>
          ))}
        </section>
      ))}
    </>
  );
}
