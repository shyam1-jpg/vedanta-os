"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Card = { id: string; name: string; room: string | null; group: string; status: string; access: string | null; diet: string | null };
type Board = { generatedAt: string; items: Card[] };
const STORE = "vedanta.whos-in.pocket";

export default function WhosInPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [stale, setStale] = useState(false);
  const load = async () => {
    try {
      const next = await api<Board>("/v1/whos-in");
      setBoard(next);
      setStale(false);
      sessionStorage.setItem(STORE, JSON.stringify(next));
    } catch (e) {
      const saved = sessionStorage.getItem(STORE);
      if (saved) { setBoard(JSON.parse(saved) as Board); setStale(true); }
      onError((e as Error).message);
    }
  };
  useEffect(() => {
    const saved = sessionStorage.getItem(STORE);
    if (saved) setBoard(JSON.parse(saved) as Board);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const when = board ? new Date(board.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <div data-testid="pocket-whos-in">
      <h2>Who&apos;s in</h2>
      <p className="m">{stale ? "Offline · last updated " : "Updated "}{when}</p>
      {(board?.items ?? []).map(item => (
        <div className="card" key={item.id}>
          <strong>{item.name}</strong>
          <div>{[item.room && `Room ${item.room}`, item.group, item.status, item.access, item.diet].filter(Boolean).join(" · ")}</div>
        </div>
      ))}
    </div>
  );
}
