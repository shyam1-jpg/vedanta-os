"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Item = {
  id: string; name: string; group_name: string; status: string; status_label: string; room: string | null;
  checked_in_at: string | null; arrived_at: string | null; keys_at: string | null;
};
type Board = { enabled: boolean; note?: string; items: Item[] };

export default function ArrivalsPocket() {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<Board>("/v1/arrivals").then(setBoard).catch(e => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  const mark = async (id: string, status: string) => {
    setErr(null);
    try { await api(`/v1/arrivals/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  if (!board) return <p>{err ?? "Loading arrivals…"}</p>;
  if (!board.enabled) return <div className="card" data-testid="pocket-arrivals"><h2>Arrivals</h2><p>{board.note}</p></div>;
  return (
    <div className="card" data-testid="pocket-arrivals">
      <h2>Arrivals</h2>
      {err && <p role="alert">{err}</p>}
      {board.items.map(item => (
        <div key={item.id} className="row" style={{ display: "block", marginTop: 10 }}>
          <b>{item.name}</b>
          <div className="m">{item.group_name} · {item.status_label}{item.room ? ` · room ${item.room}` : ""}</div>
          {(item.status === "arrived" || item.status === "checked_in_digitally") && <button className="btn" type="button" onClick={() => mark(item.id, "keys_issued")}>Keys issued</button>}
          {item.status !== "arrived" && item.status !== "keys_issued" && <button className="btn" type="button" onClick={() => mark(item.id, "arrived")}>Arrived</button>}
        </div>
      ))}
      {board.items.length === 0 && <p className="m">Nobody is due in on the board yet.</p>}
    </div>
  );
}
