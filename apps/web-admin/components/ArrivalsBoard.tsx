"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Item = {
  id: string;
  group_id: string;
  group_name: string;
  name: string;
  status: string;
  status_label: string;
  room: string | null;
  locked: boolean;
  arrival_time: string | null;
  expected_at: string | null;
  en_route_at: string | null;
  checked_in_at: string | null;
  arrived_at: string | null;
  keys_at: string | null;
};

type Board = { enabled: boolean; date: string; note?: string; items: Item[] };

function when(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ArrivalList({ board, onChange, compact }: { board: Board; onChange: () => void; compact?: boolean }) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!board.enabled) return <p data-testid="arrivals-off">{board.note ?? "Digital check-in is switched off."}</p>;
  const groups = [...new Map(board.items.map(item => [item.group_id, item.group_name])).entries()];
  const act = async (path: string, body: object) => {
    setErr(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      onChange();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div data-testid="arrivals-board">
      {err && <div className="note" role="alert">{err}</div>}
      <ul className="roomalloc-conflicts" style={{ listStyle: "none", padding: 0 }}>
        {board.items.map(item => (
          <li key={item.id} className="panel" style={{ marginTop: 8 }}>
            <b>{item.name}</b>
            <span className="m"> · {item.group_name} · {item.status_label}</span>
            {item.room && <div>Room {item.room}{item.locked ? " · organiser lock kept" : ""}</div>}
            <div className="m">
              {[item.expected_at && `expected ${when(item.expected_at)}`, item.en_route_at && `en route ${when(item.en_route_at)}`, item.checked_in_at && `checked in ${when(item.checked_in_at)}`, item.arrived_at && `arrived ${when(item.arrived_at)}`, item.keys_at && `keys ${when(item.keys_at)}`].filter(Boolean).join(" · ")}
            </div>
            <div className="actions">
              {item.status !== "arrived" && item.status !== "keys_issued" && <button className="btn" type="button" onClick={() => act(`/v1/arrivals/${item.id}/status`, { status: "arrived" })}>Mark arrived</button>}
              {item.status !== "keys_issued" && <button className="btn" type="button" onClick={() => act(`/v1/arrivals/${item.id}/status`, { status: "keys_issued" })}>Keys issued</button>}
              <button className="btn" type="button" onClick={() => act(`/v1/arrivals/${item.id}/release`, { released: true })}>Release room</button>
            </div>
          </li>
        ))}
      </ul>
      {board.items.length === 0 && <p className="m">No arrivals on this date.</p>}
      {!compact && (
        <form className="panel" style={{ marginTop: 14 }} onSubmit={e => { e.preventDefault(); void act("/v1/arrivals/walk-up", { group_id: groupId, name }); }}>
          <h2>Walk-up</h2>
          <label>Booking
            <select aria-label="Walk-up booking" value={groupId} onChange={e => setGroupId(e.target.value)}>
              <option value="">choose…</option>
              {groups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>Name<input aria-label="Walk-up name" value={name} onChange={e => setName(e.target.value)} /></label>
          <button className="btn primary" type="submit">They have arrived</button>
        </form>
      )}
    </div>
  );
}

export default function ArrivalsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<Board>("/v1/arrivals").then(setBoard).catch(e => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  return (
    <>
      <div className="topbar"><div><h1>Arrivals</h1><p>{board?.date ?? "Today"} · expected, en route, checked in digitally, arrived, keys issued</p></div></div>
      {err && <div className="note" role="alert">{err}</div>}
      {board && <ArrivalList board={board} onChange={load} />}
    </>
  );
}
