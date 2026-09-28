"use client";
import { useCallback, useEffect, useState } from "react";
import { api, API, token } from "@/lib/api";

type Card = { id: string; name: string; room: string | null; group: string; building: string; status: string; access: string | null; diet: string | null };
type Roll = { name: string; room: string; group: string; access: string };
type Board = { date: string; generatedAt: string; role: string; items: Card[]; roll: Roll[]; buildings: string[]; groups: string[] };

const STORE = "vedanta.whos-in";

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function WhosIn() {
  const [board, setBoard] = useState<Board | null>(null);
  const [stale, setStale] = useState(false);
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (building) params.set("building", building);
    if (group) params.set("group", group);
    if (status) params.set("status", status);
    try {
      const next = await api<Board>(`/v1/whos-in?${params.toString()}`);
      setBoard(next);
      setStale(false);
      setErr(null);
      sessionStorage.setItem(STORE, JSON.stringify(next));
    } catch (e) {
      const saved = sessionStorage.getItem(STORE);
      if (saved) { setBoard(JSON.parse(saved) as Board); setStale(true); }
      setErr((e as Error).message);
    }
  }, [q, building, group, status]);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORE);
    if (saved) setBoard(JSON.parse(saved) as Board);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const download = () => {
    const href = `${API}/v1/whos-in?format=csv`;
    fetch(href, { headers: { authorization: `Bearer ${token.get() ?? ""}` } })
      .then(res => res.text())
      .then(text => {
        const blob = new Blob([text], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "fire-roll.csv";
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch(e => setErr((e as Error).message));
  };

  return (
    <div data-testid="whos-in">
      <div className="topbar">
        <div>
          <h1>Who&apos;s in</h1>
          <p>{stale ? "Offline · last updated " : "Updated "}{board ? clock(board.generatedAt) : "—"}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => window.print()}>Print fire roll</button>
          <button className="btn" type="button" onClick={download}>Download fire roll</button>
        </div>
      </div>
      {err && <div className="note" role="alert">{err}</div>}
      <div className="panel">
        <label>Search<input aria-label="Search who's in" value={q} onChange={e => setQ(e.target.value)} /></label>
        <label>Building
          <select aria-label="Building" value={building} onChange={e => setBuilding(e.target.value)}>
            <option value="">All</option>
            {(board?.buildings ?? []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Group
          <select aria-label="Group" value={group} onChange={e => setGroup(e.target.value)}>
            <option value="">All</option>
            {(board?.groups ?? []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Status
          <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All</option>
            {["expected", "en route", "checked in digitally", "arrived", "keys issued", "in house", "departing"].map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <ul className="panel" data-testid="whos-in-list">
        {(board?.items ?? []).map(item => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            {item.room ? ` · room ${item.room}` : ""} · {item.group} · {item.status}
            {item.access ? ` · ${item.access}` : ""}
            {item.diet ? ` · ${item.diet}` : ""}
          </li>
        ))}
      </ul>
      <section className="panel" data-testid="fire-roll">
        <h2>Fire roll — on site now</h2>
        <table>
          <thead><tr><th>Name</th><th>Room</th><th>Group</th><th>Access</th></tr></thead>
          <tbody>
            {(board?.roll ?? []).map(line => (
              <tr key={`${line.name}-${line.room}`}><td>{line.name}</td><td>{line.room}</td><td>{line.group}</td><td>{line.access}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
