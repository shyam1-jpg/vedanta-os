"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Plot = { id: string; name: string; crop: string; variety: string; plantedOn: string; dueOn: string; due: boolean };
type Board = {
  enabled: boolean;
  ready?: boolean;
  date?: string;
  growing?: Plot[];
  due?: Plot[];
  waste_types?: { code: string; label: string }[];
  destinations?: { code: string; label: string }[];
  cows_rule?: string;
};

export default function GardenPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [kg, setKg] = useState("1");
  const [wasteType, setWasteType] = useState("prep");
  const [destination, setDestination] = useState("compost");
  const [straight, setStraight] = useState(false);

  const load = async () => setBoard(await api<Board>("/v1/garden"));
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (path: string, body: object) => {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      onError(null);
      await load();
    } catch (e) { onError((e as Error).message); }
  };

  if (!board) return null;
  if (!board.enabled) return <div data-testid="pocket-garden"><h2>Garden</h2><p>The garden log is off.</p></div>;
  if (board.ready === false) return <div data-testid="pocket-garden"><h2>Garden</h2><p>The garden log is not ready yet.</p></div>;

  const cowsBlocked = destination === "cows" && (!straight || !!wasteType);
  const plots = board.growing ?? [];

  return (
    <div data-testid="pocket-garden">
      <h2>Garden</h2>
      <p className="m">Today is {board.date}. A harvest goes onto kitchen stock. Kitchen waste is never fed to the cows.</p>
      <label>Kg<input aria-label="Kilograms" value={kg} onChange={e => setKg(e.target.value)} inputMode="decimal" /></label>
      {plots.map(plot => (
        <div className="card" key={plot.id} data-testid={plot.due ? "pocket-garden-due" : "pocket-garden-growing"}>
          <h2>{plot.name}</h2>
          <p>{plot.crop}{plot.variety ? ` · ${plot.variety}` : ""}</p>
          <p>{plot.due ? `Due ${plot.dueOn}` : `Expected ${plot.dueOn}`}</p>
          <button className="btn" type="button" onClick={() => save("/v1/garden/harvests", { plot_id: plot.id, kg: Number(kg) })}>Harvest</button>
          <button className="btn" type="button" onClick={() => save("/v1/garden/use", { crop: plot.crop, variety: plot.variety, kg: Number(kg) })}>Used</button>
        </div>
      ))}
      <div className="card">
        <h2>Waste</h2>
        {(board.waste_types ?? []).map(row => (
          <button key={row.code} className="btn" type="button" onClick={() => { setWasteType(row.code); setStraight(false); if (destination === "cows") setDestination("compost"); }}>{wasteType === row.code && !straight ? `● ${row.label}` : row.label}</button>
        ))}
        {(board.destinations ?? []).map(row => (
          <button key={row.code} className="btn" type="button" onClick={() => setDestination(row.code)}>{destination === row.code ? `● ${row.label}` : row.label}</button>
        ))}
        <label className="m"><input type="checkbox" checked={straight} onChange={e => { setStraight(e.target.checked); if (e.target.checked) setWasteType(""); }} /> Straight from the plot</label>
        {cowsBlocked && <p data-testid="pocket-cows-block">{board.cows_rule}</p>}
        <button className="btn" type="button" disabled={cowsBlocked} onClick={() => save("/v1/garden/waste", { crop: plots[0]?.crop || "Garden produce", variety: plots[0]?.variety || "", kg: Number(kg), waste_type: straight ? "" : wasteType, destination, straight_from_plot: straight })}>Save waste</button>
      </div>
    </div>
  );
}
