"use client";
import { useEffect, useState } from "react";
import { api, API, ApiError, token } from "@/lib/api";

type Point = { period: string; value: number; baseline: number | null; delta: number | null };
type Carbon = { label: string; kgCo2e: number; factorText: string; source: string } | null;
type Series = { code: string; label: string; unit: string; baseline: number | null; points: Point[]; carbon: Carbon };
type Metric = { code: string; label: string; unit: string };
type GardenCarbon = { label: string; kgCo2e: number; factorText: string; year: number; source: string } | null;
type GardenImpact = {
  period: string;
  composted_kg: number;
  local_share: number | null;
  garden_kg: number;
  other_incoming_kg: number;
  by_destination: { code: string; label: string; kg: number; carbon: GardenCarbon }[];
  carbon_note: string;
};

export default function Sustainability() {
  const [enabled, setEnabled] = useState(false);
  const [isPublic, setPublic] = useState(false);
  const [series, setSeries] = useState<Series[]>([]);
  const [garden, setGarden] = useState<GardenImpact | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [form, setForm] = useState({ period: "2026-09", metric: "waste_plate", value: "", note: "" });
  const [baseline, setBaseline] = useState({ metric: "waste_plate", value: "" });
  const [csv, setCsv] = useState("period,metric,value,note\n2026-09,waste_prep,1.5,Example prep waste");
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => api<{ enabled: boolean; public?: boolean; metrics?: Metric[]; series?: Series[]; goshala?: string; garden?: GardenImpact | null }>("/v1/sustainability")
    .then(row => {
      setEnabled(row.enabled);
      setPublic(row.public === true);
      setMetrics(row.metrics ?? []);
      setSeries(row.series ?? []);
      setGarden(row.garden ?? null);
    })
    .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the tracker"));

  useEffect(() => { load(); }, []);

  const download = async (path: string, name: string) => {
    const headers: Record<string, string> = {};
    const t = token.get();
    if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) { say("The export is not available"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="topbar"><div><h1>Sustainability</h1><p>Kitchen waste, the goshala, and the utilities. The cows are cared for and are never milked. Carbon figures are estimates and show the factor they used.</p></div></div>
      {!enabled && <div className="note">The tracker is off. Turn it on in settings before readings are stored. The public summary stays off as well.</div>}
      {enabled && (
        <>
          <p className="m">{isPublic ? "A short public summary is on." : "The public summary is off."} The goshala does not produce milk.</p>
          <div className="hkgrid">
            {series.filter(row => row.points.length).map(row => (
              <div className="hk" key={row.code}>
                <div className="hk-top"><b>{row.label}</b></div>
                {row.points.map(point => (
                  <div className="m" key={point.period}>{point.period}: {point.value} {row.unit}{point.baseline != null ? ` · baseline ${point.baseline} · ${point.delta != null && point.delta > 0 ? "+" : ""}${point.delta ?? ""}` : ""}</div>
                ))}
                {row.carbon && <div className="m">Estimate: {row.carbon.kgCo2e} kg CO2e. Factor {row.carbon.factorText}. {row.carbon.source}</div>}
              </div>
            ))}
          </div>
          {garden && (
            <div className="panel" style={{ marginTop: 16 }} data-testid="sustain-garden">
              <h3>From the garden log, {garden.period}</h3>
              <p>Composted waste {garden.composted_kg} kg. Garden-to-kitchen local share {garden.local_share == null ? "is not available yet" : `${garden.local_share}%`} ({garden.garden_kg} kg from the garden, {garden.other_incoming_kg} kg bought in).</p>
              {garden.by_destination.map(row => (
                <p key={row.code}>{row.label}: {row.kg} kg.{row.carbon ? ` Estimate: ${row.carbon.kgCo2e} kg CO2e. Factor ${row.carbon.factorText}, ${row.carbon.year}. ${row.carbon.source}` : ""}</p>
              ))}
              <p className="m">{garden.carbon_note}</p>
            </div>
          )}
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Add a reading</h3>
            <div className="fgrid">
              <label>Month<input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="2026-09" /></label>
              <label>Metric
                <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}>
                  {metrics.map(metric => <option key={metric.code} value={metric.code}>{metric.label} ({metric.unit})</option>)}
                </select>
              </label>
              <label>Value<input value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
              <label>Note<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Plate or prep, vegetable or cooked" /></label>
            </div>
            <button className="btn primary" type="button" onClick={async () => {
              try {
                await api("/v1/sustainability/readings", { method: "POST", body: JSON.stringify({ ...form, value: Number(form.value) }) });
                say("Reading saved");
                load();
              } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
            }}>Save reading</button>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Baseline</h3>
            <div className="fgrid">
              <label>Metric
                <select value={baseline.metric} onChange={e => setBaseline({ ...baseline, metric: e.target.value })}>
                  {metrics.map(metric => <option key={metric.code} value={metric.code}>{metric.label}</option>)}
                </select>
              </label>
              <label>Baseline<input value={baseline.value} onChange={e => setBaseline({ ...baseline, value: e.target.value })} /></label>
            </div>
            <button className="btn" type="button" onClick={async () => {
              try {
                await api("/v1/sustainability/baseline", { method: "PUT", body: JSON.stringify({ metric: baseline.metric, value: Number(baseline.value), note: "Baseline" }) });
                say("Baseline saved");
                load();
              } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the baseline"); }
            }}>Save baseline</button>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Import a CSV</h3>
            <p className="m">Columns: period, metric, value, note. A dairy or milking figure for the goshala is refused.</p>
            <textarea rows={5} value={csv} onChange={e => setCsv(e.target.value)} style={{ width: "100%", maxWidth: 720 }} />
            <button className="btn" type="button" onClick={async () => {
              try {
                const saved = await api<{ saved: number; errors: string[] }>("/v1/sustainability/import", { method: "POST", body: JSON.stringify({ csv }) });
                say(saved.errors.length ? `Imported ${saved.saved}. ${saved.errors[0]}` : `Imported ${saved.saved}`);
                load();
              } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not import"); }
            }}>Import</button>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Report</h3>
            <p className="m">A simple file for guests and funders. Carbon rows say Estimate and name the conversion factor.</p>
            <button className="btn" type="button" onClick={() => download("/v1/sustainability/export.csv", "sustainability.csv")}>Download CSV</button>
            <button className="btn" type="button" onClick={() => download("/v1/sustainability/export.pdf", "sustainability.pdf")}>Download PDF</button>
          </div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
