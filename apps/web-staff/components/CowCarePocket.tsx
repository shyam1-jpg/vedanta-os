"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Card = { animal_id: string; name: string; guest_facing: boolean; done: string[]; missing: string[]; follow_up: string | null };
type Board = { enabled: boolean; ready?: boolean; date?: string; today?: Card[]; note?: string };

export default function CowCarePocket({ staffName, onError }: { staffName: string; onError: (msg: string | null) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [feed, setFeed] = useState<Record<string, { what: string; when: string; amount: string }>>({});
  const [health, setHealth] = useState<Record<string, string>>({});

  const load = async () => {
    setBoard(await api<Board>("/v1/cow-care"));
  };
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (animalId: string, body: Record<string, string>) => {
    try {
      await api("/v1/cow-care/days", { method: "PUT", body: JSON.stringify({ animal_id: animalId, date: board?.date, ...body }) });
      onError(null);
      await load();
    } catch (e) { onError((e as Error).message); }
  };

  if (!board) return null;
  if (!board.enabled) return <div data-testid="pocket-cows"><h2>Cow care</h2><p>Cow care is off.</p></div>;
  if (board.ready === false) return <div data-testid="pocket-cows"><h2>Cow care</h2><p>Cow care is not ready yet.</p></div>;

  return (
    <div data-testid="pocket-cows">
      <h2>Cow care</h2>
      <p className="m">{board.note} Today is {board.date}. The bull is staff only.</p>
      {(board.today ?? []).map(card => {
        const meal = feed[card.animal_id] ?? { what: "Hay", when: "07:30", amount: "2 kg" };
        return (
          <div className="card" key={card.animal_id} data-testid={card.guest_facing ? "pocket-cow-guest" : "pocket-cow-staff"}>
            <h2>{card.name}</h2>
            <p>{card.guest_facing ? "Guest-suitable, with staff" : "STAFF ONLY"}</p>
            {card.done.map(line => <p key={line}>{line}</p>)}
            {card.missing.length > 0 && <p><b>Still to do.</b> {card.missing.join(" · ")}</p>}
            {card.follow_up && <p>{card.follow_up}</p>}
            <button className="btn" type="button" onClick={() => save(card.animal_id, { duty: staffName || "Example staff" })}>I&apos;m with them</button>
            <label>Feed<input aria-label={`Feed for ${card.name}`} value={meal.what} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, what: e.target.value } })} /></label>
            <label>When<input aria-label={`When for ${card.name}`} value={meal.when} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, when: e.target.value } })} /></label>
            <label>Amount<input aria-label={`Amount for ${card.name}`} value={meal.amount} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, amount: e.target.value } })} /></label>
            <button className="btn" type="button" onClick={() => save(card.animal_id, { feed_what: meal.what, feed_when: meal.when, feed_amount: meal.amount })}>Save feed</button>
            <label>Health<input aria-label={`Health for ${card.name}`} value={health[card.animal_id] ?? ""} onChange={e => setHealth({ ...health, [card.animal_id]: e.target.value })} /></label>
            <button className="btn" type="button" onClick={() => save(card.animal_id, { health: health[card.animal_id] ?? "" })}>Save health note</button>
          </div>
        );
      })}
    </div>
  );
}
