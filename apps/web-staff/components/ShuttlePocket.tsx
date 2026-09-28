"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Run = { id: string; direction: string; pickupTime: string; meetingPoint: string; manifest: string[]; seats: { personKey: string; firstName: string; mark: string }[] };

export default function ShuttlePocket({ onError }: { onError: (msg: string | null) => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [date, setDate] = useState("");
  const load = async () => {
    const board = await api<{ date: string; runs: Run[] }>("/v1/shuttles");
    setRuns(board.runs);
    setDate(board.date);
  };
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = async (runId: string, personKey: string, value: "picked_up" | "no_show") => {
    try {
      await api(`/v1/shuttles/runs/${runId}/mark`, { method: "POST", body: JSON.stringify({ person_key: personKey, mark: value, date }) });
      await load();
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div data-testid="pocket-shuttle">
      <h2>Shuttle manifest</h2>
      <p className="m">First names, party size, and access needs. No payment.</p>
      {runs.map(run => (
        <div className="card" key={run.id}>
          <p>{run.direction} · {run.pickupTime} · {run.meetingPoint}</p>
          <ul>{run.manifest.map(line => <li key={line}>{line}</li>)}</ul>
          {run.seats.map(seat => (
            <div key={seat.personKey}>
              <span>{seat.firstName} · {seat.mark}</span>
              <button type="button" onClick={() => mark(run.id, seat.personKey, "picked_up")}>Picked up</button>
              <button type="button" onClick={() => mark(run.id, seat.personKey, "no_show")}>No-show</button>
            </div>
          ))}
        </div>
      ))}
      {!runs.length && <p>No shuttle today.</p>}
    </div>
  );
}
