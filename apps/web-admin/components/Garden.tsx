"use client";
import { useEffect, useState } from "react";
import { api, API, ApiError, token } from "@/lib/api";

type Plot = { id: string; name: string; crop: string; variety: string; plantedOn: string; dueOn: string; due: boolean };
type Dest = { code: string; label: string; kg?: number; carbon?: { label: string; kgCo2e: number; factorText: string; year: number; source: string } | null };
type Impact = { period: string; composted_kg: number; local_share: number | null; garden_kg: number; other_incoming_kg: number; by_destination: Dest[]; carbon_note: string };
type Board = {
  enabled: boolean;
  ready?: boolean;
  date?: string;
  growing?: Plot[];
  due?: Plot[];
  history?: { date: string; plot: string; crop: string; kind: string; kg: number; waste_type: string; destination: string; origin: string }[];
  impact?: Impact | null;
  waste_types?: { code: string; label: string }[];
  destinations?: { code: string; label: string }[];
  cows_rule?: string;
};

const emptyPlant = { name: "Example bed", crop: "", variety: "", planted_on: "2026-04-12", due_on: "2026-09-20" };

export default function Garden() {
  const [board, setBoard] = useState<Board | null>(null);
  const [plant, setPlant] = useState(emptyPlant);
  const [kg, setKg] = useState("1");
  const [wasteType, setWasteType] = useState("prep");
  const [destination, setDestination] = useState("compost");
  const [straight, setStraight] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 5000); };

  const load = () => api<Board>("/v1/garden").then(setBoard).catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open the garden"));
  useEffect(() => { load(); }, []);

  const post = async (path: string, body: object) => {
    const saved = await api<{ note?: string }>(path, { method: "POST", body: JSON.stringify(body) });
    say(saved.note || "Saved");
    await load();
  };

  const cowsBlocked = destination === "cows" && (!straight || !!wasteType);
  if (!board) return null;
  if (!board.enabled) return <><div className="topbar"><div><h1>Garden</h1></div></div><div className="note" data-testid="garden-off">The garden log is off. Turn it on in settings before plantings are stored.</div></>;
  if (board.ready === false) return <><div className="topbar"><div><h1>Garden</h1></div></div><div className="note">The garden log is not ready yet.</div></>;

  const plots = board.growing ?? [];

  return (
    <div data-testid="garden">
      <div className="topbar"><div><h1>Garden</h1><p>What is in the beds, what came into the kitchen, and where the waste went. A harvest is added to kitchen stock from the garden. The cows are never fed catering waste.</p></div></div>
      <div className="hkgrid">
        {plots.map(plot => (
          <div className="hk" key={plot.id} data-testid={plot.due ? "garden-due" : "garden-growing"}>
            <div className="hk-top"><b>{plot.name}</b>{plot.due && <span className="chip sev-high">Due</span>}</div>
            <div>{plot.crop}{plot.variety ? ` · ${plot.variety}` : ""}</div>
            <div className="m">Planted {plot.plantedOn}. Expected harvest {plot.dueOn}.</div>
            <button className="btn primary" type="button" onClick={async () => {
              try { await post("/v1/garden/harvests", { plot_id: plot.id, kg: Number(kg) }); }
              catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the harvest"); }
            }}>Harvest {kg || "0"} kg</button>
            <button className="btn" type="button" style={{ marginLeft: 8 }} onClick={async () => {
              try { await api(`/v1/garden/plots/${plot.id}/clear`, { method: "POST", body: "{}" }); say("Plot cleared"); await load(); }
              catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not clear the plot"); }
            }}>Cleared</button>
          </div>
        ))}
        {plots.length === 0 && <div className="note">Nothing is growing.</div>}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Kilograms</h3>
        <label>Kg<input aria-label="Kilograms" value={kg} onChange={e => setKg(e.target.value)} inputMode="decimal" style={{ maxWidth: 120 }} /></label>
        <div style={{ marginTop: 8 }}>
          <button className="btn" type="button" onClick={async () => {
            const plot = (board.due ?? [])[0] ?? plots[0];
            if (!plot) { say("Plant a crop first"); return; }
            try { await post("/v1/garden/use", { crop: plot.crop, variety: plot.variety, kg: Number(kg) }); }
            catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the use"); }
          }}>Used in the kitchen</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Waste</h3>
        <div>
          {(board.waste_types ?? []).map(row => (
            <button key={row.code} className={wasteType === row.code && !straight ? "btn primary" : "btn"} type="button" style={{ margin: "0 8px 8px 0" }} onClick={() => { setWasteType(row.code); setStraight(false); if (destination === "cows") setDestination("compost"); }}>{row.label}</button>
          ))}
        </div>
        <div>
          {(board.destinations ?? []).map(row => (
            <button key={row.code} className={destination === row.code ? "btn primary" : "btn"} type="button" style={{ margin: "0 8px 8px 0" }} onClick={() => setDestination(row.code)}>{row.label}</button>
          ))}
        </div>
        <label className="m"><input type="checkbox" checked={straight} onChange={e => { setStraight(e.target.checked); if (e.target.checked) setWasteType(""); }} /> Straight from the plot. It has not entered the kitchen.</label>
        {cowsBlocked && <div className="note" data-testid="garden-cows-block">{board.cows_rule}</div>}
        <button className="btn primary" type="button" disabled={cowsBlocked} onClick={async () => {
          const plot = plots[0];
          try {
            await post("/v1/garden/waste", {
              crop: plot?.crop || "Garden produce",
              variety: plot?.variety || "",
              kg: Number(kg),
              waste_type: straight ? "" : wasteType,
              destination,
              straight_from_plot: straight,
            });
          } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the waste"); }
        }}>Save waste</button>
      </div>
      {board.impact && (
        <div className="panel" style={{ marginTop: 16 }} data-testid="garden-impact">
          <h3>This month, {board.impact.period}</h3>
          <p>Composted {board.impact.composted_kg} kg. Garden to kitchen {board.impact.local_share == null ? "has no incoming stock yet" : `${board.impact.local_share}%`} ({board.impact.garden_kg} kg from the garden, {board.impact.other_incoming_kg} kg bought in).</p>
          {board.impact.by_destination.map(row => (
            <p key={row.code}>{row.label}: {row.kg} kg.{row.carbon ? ` Estimate: ${row.carbon.kgCo2e} kg CO2e. Factor ${row.carbon.factorText}. ${row.carbon.source}` : ""}</p>
          ))}
          <p className="m">{board.impact.carbon_note}</p>
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Plant a bed</h3>
        <div className="fgrid">
          <label>Plot<input aria-label="Plot name" value={plant.name} onChange={e => setPlant({ ...plant, name: e.target.value })} /></label>
          <label>Crop<input aria-label="Crop" value={plant.crop} onChange={e => setPlant({ ...plant, crop: e.target.value })} /></label>
          <label>Variety<input aria-label="Variety" value={plant.variety} onChange={e => setPlant({ ...plant, variety: e.target.value })} /></label>
          <label>Planted<input aria-label="Planting date" value={plant.planted_on} onChange={e => setPlant({ ...plant, planted_on: e.target.value })} /></label>
          <label>Expected harvest<input aria-label="Expected harvest" value={plant.due_on} onChange={e => setPlant({ ...plant, due_on: e.target.value })} /></label>
        </div>
        <button className="btn primary" type="button" onClick={async () => {
          try { await post("/v1/garden/plots", plant); }
          catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the planting"); }
        }}>Save planting</button>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>History</h3>
        {(board.history ?? []).map((row, i) => (
          <div className="m" key={i}>{row.date} · {row.crop} · {row.kind} {row.kg} kg{row.waste_type ? ` · ${row.waste_type}` : ""}{row.destination ? ` · ${row.destination}` : ""}{row.origin === "plot" ? " · straight from the plot" : ""}</div>
        ))}
        <button className="btn" type="button" onClick={async () => {
          const headers: Record<string, string> = {};
          const t = token.get();
          if (t) headers.authorization = `Bearer ${t}`;
          const res = await fetch(`${API}/v1/garden/export.csv`, { headers });
          if (!res.ok) { say("The export is not available"); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "garden.csv";
          link.click();
          URL.revokeObjectURL(url);
        }}>Download CSV</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
