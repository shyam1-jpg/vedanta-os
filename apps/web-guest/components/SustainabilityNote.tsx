"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Carbon = { label: string; kgCo2e: number; factorText: string; source: string };
type Summary = {
  enabled: boolean;
  period?: string | null;
  waste_composted_kg?: number | null;
  seva_hours?: number | null;
  goshala?: string;
  carbon?: Carbon[];
};

export default function SustainabilityNote() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    fetch(`${API}/public/sustainability`)
      .then(res => res.ok ? res.json() : { enabled: false })
      .then(body => { if (body?.enabled) setSummary(body); })
      .catch(() => {});
  }, []);
  if (!summary?.enabled) return null;
  return (
    <section className="impact" data-testid="guest-impact" aria-label="House sustainability summary">
      <h2>How the house is doing</h2>
      <p className="lead">{summary.period ? `Figures for ${summary.period}. ` : ""}The cows are cared for and are never milked.</p>
      <ul>
        {summary.waste_composted_kg != null && <li>Food waste composted: {summary.waste_composted_kg} kg</li>}
        {summary.seva_hours != null && <li>Seva hours: {summary.seva_hours}</li>}
      </ul>
      {(summary.carbon ?? []).map(row => (
        <p key={row.factorText}>{row.label}: {row.kgCo2e} kg CO2e. Factor {row.factorText}. {row.source}</p>
      ))}
    </section>
  );
}
