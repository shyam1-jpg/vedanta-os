"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Run = { id: string; direction: string; pickupTime: string; meetingPoint: string; confirmed: boolean; overflow: boolean; manifest: string[] };
type Board = { date: string; service: { name: string; route: string; capacity: number; driver: string; travelMinutes: number; meetingPoint: string; windowMinutes: number }; runs: Run[] };

export default function ShuttleAdmin() {
  const [board, setBoard] = useState<Board | null>(null);
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = async (day?: string) => {
    const next = await api<Board>(`/v1/shuttles${day ? `?date=${day}` : ""}`);
    setBoard(next);
    setDate(next.date);
  };
  useEffect(() => { load().catch(e => setErr((e as Error).message)); }, []);
  return (
    <div data-testid="shuttle-admin">
      <h1>Shuttles</h1>
      <p className="m">Train times are grouped so nobody waits longer than the window, and the vehicle is not overfilled. Nothing is charged.</p>
      {err && <div className="note" role="alert">{err}</div>}
      {board && (
        <section className="panel">
          <p>{board.service.name} · {board.service.route} · {board.service.capacity} seats · {board.service.driver} · {board.service.travelMinutes} minutes · meet at {board.service.meetingPoint} · {board.service.windowMinutes}-minute window</p>
          <label>Date<input aria-label="Shuttle date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <button className="btn" type="button" onClick={() => api("/v1/shuttles/plan", { method: "POST", body: JSON.stringify({ date }) }).then(() => load(date)).catch(e => setErr((e as Error).message))}>Propose runs</button>
          <ul>
            {board.runs.map(run => (
              <li key={run.id} data-testid="shuttle-run">
                <strong>{run.direction}</strong> · pickup {run.pickupTime} · {run.meetingPoint}{run.overflow ? " · over capacity" : ""}{run.confirmed ? " · confirmed" : ""}
                <ul>{run.manifest.map(line => <li key={line}>{line}</li>)}</ul>
                {!run.confirmed && <button className="btn" type="button" onClick={() => api(`/v1/shuttles/runs/${run.id}/confirm`, { method: "POST", body: "{}" }).then(() => load(date)).catch(e => setErr((e as Error).message))}>Confirm</button>}
              </li>
            ))}
          </ul>
          {!board.runs.length && <p>No shuttle runs for this date yet.</p>}
        </section>
      )}
    </div>
  );
}
