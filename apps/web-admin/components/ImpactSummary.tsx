"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Carbon = { label: string; kgCo2e: number; factorText: string; source: string };
type Summary = {
  enabled: boolean;
  period?: string | null;
  waste_composted_kg?: number | null;
  plate_waste_kg?: number | null;
  prep_waste_kg?: number | null;
  seva_hours?: number | null;
  local_share?: number | null;
  organic_share?: number | null;
  goshala?: string;
  carbon?: Carbon[];
};

export default function ImpactSummary({ heading = true }: { heading?: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    fetch(`${API}/public/sustainability`)
      .then(res => res.ok ? res.json() : { enabled: false })
      .then(body => setSummary(body?.enabled ? body : { enabled: false }))
      .catch(() => setSummary({ enabled: false }));
  }, []);
  if (!summary?.enabled) return heading ? <p>This summary is not published.</p> : null;
  return (
    <section data-testid="impact-summary" aria-label="House sustainability summary">
      {heading && <h1>How the house is doing</h1>}
      {!heading && <h2>How the house is doing</h2>}
      {summary.period && <p>Figures for {summary.period}. These are house records, not a certified audit.</p>}
      <ul>
        {summary.plate_waste_kg != null && <li>Plate waste {summary.plate_waste_kg} kg</li>}
        {summary.prep_waste_kg != null && <li>Prep waste {summary.prep_waste_kg} kg</li>}
        {summary.waste_composted_kg != null && <li>Composted {summary.waste_composted_kg} kg</li>}
        {summary.seva_hours != null && <li>Seva hours {summary.seva_hours}</li>}
        {summary.local_share != null && <li>Local sourcing {summary.local_share}%</li>}
        {summary.organic_share != null && <li>Organic sourcing {summary.organic_share}%</li>}
      </ul>
      {summary.goshala && <p>{summary.goshala}</p>}
      {(summary.carbon ?? []).map(row => (
        <p key={row.factorText}>{row.label}: {row.kgCo2e} kg CO2e. Factor {row.factorText}. {row.source}</p>
      ))}
    </section>
  );
}
