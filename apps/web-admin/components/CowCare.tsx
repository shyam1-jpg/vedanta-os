"use client";
import { useEffect, useState } from "react";
import { api, API, ApiError, token } from "@/lib/api";

type Animal = { id: string; name: string; kind: "cow" | "bull"; guest_facing: boolean; note: string };
type Card = { animal_id: string; name: string; guest_facing: boolean; done: string[]; missing: string[]; follow_up: string | null };
type Line = { date: string; animal: string; guestFacing: boolean; duty: string; feedWhat: string; feedWhen: string; feedAmount: string; health: string; vet: string; reason: string; outcome: string; followUp: string };
type Board = { enabled: boolean; ready?: boolean; date?: string; animals?: Animal[]; today?: Card[]; history?: Line[]; note?: string };

export default function CowCare() {
  const [board, setBoard] = useState<Board | null>(null);
  const [duty, setDuty] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<Record<string, { what: string; when: string; amount: string }>>({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [vet, setVet] = useState({ animal_id: "", date: "", vet: "", reason: "", outcome: "", follow_up: "" });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  const load = () => api<Board>("/v1/cow-care")
    .then(row => {
      setBoard(row);
      if (row.animals?.[0] && !vet.animal_id) setVet(current => ({ ...current, animal_id: row.animals![0].id }));
    })
    .catch(e => say(e instanceof ApiError ? e.problem.detail : "Could not open cow care"));

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDay = async (animalId: string, body: Record<string, string>) => {
    try {
      await api("/v1/cow-care/days", { method: "PUT", body: JSON.stringify({ animal_id: animalId, date: board?.date, ...body }) });
      say("Saved");
      await load();
    } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save"); }
  };

  const download = async () => {
    const headers: Record<string, string> = {};
    const t = token.get();
    if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(`${API}/v1/cow-care/export.csv`, { headers });
    if (!res.ok) { say("The export is not available"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cow-care.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="cow-care">
      <div className="topbar"><div><h1>Cow care</h1><p>A daily note for the two animals. Guests visit only with staff. The bull is staff only. The cows are never milked.</p></div></div>
      {toast && <div className="note" role="status">{toast}</div>}
      {board && !board.enabled && <div className="note">Cow care is off. Turn it on in settings before the daily log is kept.</div>}
      {board?.enabled && board.ready === false && <div className="note">Cow care is not ready yet. The daily log tables are not in place.</div>}
      {board?.enabled && board.ready !== false && (
        <>
          <p className="m">{board.note} Today is {board.date}.</p>
          {(board.today ?? []).map(card => {
            const animal = (board.animals ?? []).find(item => item.id === card.animal_id);
            const meal = feed[card.animal_id] ?? { what: "", when: "", amount: "" };
            return (
              <section className="panel" key={card.animal_id} data-testid={card.guest_facing ? "cow-guest" : "cow-staff-only"} style={{ marginTop: 14 }}>
                <h2>{card.name} · {card.guest_facing ? "Guest-suitable" : "STAFF ONLY"}</h2>
                <p className="m">{animal?.note}</p>
                {card.done.map(line => <p key={line}>{line}</p>)}
                {card.missing.length > 0 && <p><strong>Still to do:</strong> {card.missing.join(" · ")}</p>}
                {card.follow_up && <p>{card.follow_up}</p>}
                <label style={{ display: "block", marginTop: 8 }}>Who is with them
                  <input aria-label={`Who is with ${card.name}`} value={duty[card.animal_id] ?? ""} onChange={e => setDuty({ ...duty, [card.animal_id]: e.target.value })} />
                </label>
                <button className="btn" type="button" onClick={() => saveDay(card.animal_id, { duty: duty[card.animal_id] ?? "" })}>Save duty</button>
                <label style={{ display: "block", marginTop: 8 }}>Feed
                  <input aria-label={`Feed for ${card.name}`} placeholder="Hay" value={meal.what} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, what: e.target.value } })} />
                </label>
                <label style={{ display: "block" }}>When
                  <input aria-label={`Feed time for ${card.name}`} placeholder="07:30" value={meal.when} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, when: e.target.value } })} />
                </label>
                <label style={{ display: "block" }}>Amount
                  <input aria-label={`Feed amount for ${card.name}`} placeholder="2 kg" value={meal.amount} onChange={e => setFeed({ ...feed, [card.animal_id]: { ...meal, amount: e.target.value } })} />
                </label>
                <button className="btn" type="button" onClick={() => saveDay(card.animal_id, { feed_what: meal.what, feed_when: meal.when, feed_amount: meal.amount })}>Save feed</button>
                <label style={{ display: "block", marginTop: 8 }}>Health note
                  <input aria-label={`Health note for ${card.name}`} value={health[card.animal_id] ?? ""} onChange={e => setHealth({ ...health, [card.animal_id]: e.target.value })} />
                </label>
                <button className="btn" type="button" onClick={() => saveDay(card.animal_id, { health: health[card.animal_id] ?? "" })}>Save health note</button>
                <label style={{ display: "block", marginTop: 8 }}>Name
                  <input aria-label={`Name for ${card.name}`} value={names[card.animal_id] ?? card.name} onChange={e => setNames({ ...names, [card.animal_id]: e.target.value })} />
                </label>
                <button className="btn" type="button" onClick={async () => {
                  try {
                    await api(`/v1/cow-care/animals/${card.animal_id}`, { method: "PATCH", body: JSON.stringify({ name: names[card.animal_id] ?? card.name }) });
                    say("Name saved");
                    await load();
                  } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not rename"); }
                }}>Save name</button>
              </section>
            );
          })}
          <section className="panel" style={{ marginTop: 14 }}>
            <h2>Vet visit</h2>
            <label style={{ display: "block" }}>Animal
              <select aria-label="Vet animal" value={vet.animal_id} onChange={e => setVet({ ...vet, animal_id: e.target.value })}>
                {(board.animals ?? []).map(animal => <option key={animal.id} value={animal.id}>{animal.name}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>Date<input aria-label="Vet date" type="date" value={vet.date} onChange={e => setVet({ ...vet, date: e.target.value })} /></label>
            <label style={{ display: "block" }}>Vet<input aria-label="Vet name" value={vet.vet} onChange={e => setVet({ ...vet, vet: e.target.value })} /></label>
            <label style={{ display: "block" }}>Reason<input aria-label="Vet reason" value={vet.reason} onChange={e => setVet({ ...vet, reason: e.target.value })} /></label>
            <label style={{ display: "block" }}>Outcome<input aria-label="Vet outcome" value={vet.outcome} onChange={e => setVet({ ...vet, outcome: e.target.value })} /></label>
            <label style={{ display: "block" }}>Follow-up<input aria-label="Follow-up date" type="date" value={vet.follow_up} onChange={e => setVet({ ...vet, follow_up: e.target.value })} /></label>
            <button className="btn" type="button" onClick={async () => {
              try {
                await api("/v1/cow-care/visits", { method: "POST", body: JSON.stringify({ ...vet, follow_up: vet.follow_up || undefined }) });
                say("Visit saved");
                await load();
              } catch (e) { say(e instanceof ApiError ? e.problem.detail : "Could not save the visit"); }
            }}>Save visit</button>
          </section>
          <section className="panel" style={{ marginTop: 14 }}>
            <h2>History</h2>
            <button className="btn" type="button" onClick={download}>Download CSV</button>
            <ul>
              {(board.history ?? []).map((line, index) => (
                <li key={`${line.date}-${line.animal}-${index}`}>
                  {line.date} · {line.animal}{line.guestFacing ? "" : " · staff only"}
                  {line.duty ? ` · ${line.duty}` : ""}
                  {line.feedWhat ? ` · ${line.feedWhat} ${line.feedAmount} ${line.feedWhen}` : ""}
                  {line.health ? ` · ${line.health}` : ""}
                  {line.vet ? ` · ${line.vet}: ${line.reason}` : ""}
                </li>
              ))}
            </ul>
            {(board.history ?? []).length === 0 && <p className="m">Nothing logged yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}
