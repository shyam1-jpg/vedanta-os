"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Animal = { id: string; name: string; audience: "guest" | "staff"; note: string };
type Activity = { id: string; name: string; kind: string; safetyNotes: string; tasks: string[]; minAge: number; capacity: number; location: string };
type Slot = { id: string; name: string; date: string; start: string; label: string; supervisorName: string | null; roster: { name: string; status: string }[] };
type Board = { activities: Activity[]; animals: Animal[]; slots: Slot[]; safety: { guestsVisitCowsWithStaff: boolean; kitchenFoodHandling: boolean } };

export default function SevaAdmin() {
  const [board, setBoard] = useState<Board | null>(null);
  const [activity, setActivity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const next = await api<Board>("/v1/seva");
    setBoard(next);
    if (!activity && next.activities[0]) setActivity(next.activities[0].id);
  };
  useEffect(() => { load().catch(e => setErr((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setErr(null);
    try {
      await api("/v1/seva/slots", { method: "POST", body: JSON.stringify({ activity_id: activity, from, to, start: "09:00" }) });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };
  const saveSupervisor = async (id: string) => {
    setErr(null);
    try {
      await api(`/v1/seva/slots/${id}/supervisor`, { method: "POST", body: JSON.stringify({ name: names[id] ?? "" }) });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div data-testid="seva-admin">
      <h1>Seva</h1>
      <p className="m">Guests book a slot from their stay link. A slot with no named supervisor shows as unsupervised and cannot be booked. Example Daisy may be visited with staff. Example Bull is staff only.</p>
      {err && <div className="note" role="alert">{err}</div>}
      {board && (
        <>
          <section className="panel">
            <h2>Activities</h2>
            <ul>
              {board.activities.map(item => (
                <li key={item.id}><strong>{item.name}</strong> · {item.location} · from age {item.minAge} · {item.capacity} places · {item.tasks.join(", ")}<div className="m">{item.safetyNotes}</div></li>
              ))}
            </ul>
            <p className="m">{board.safety.guestsVisitCowsWithStaff ? "Guests only visit the cows with staff." : "Cow visits are not limited to staff."} {board.safety.kitchenFoodHandling ? "Kitchen food handling is on." : "Kitchen help stays on washing up and laying the buffet."}</p>
          </section>
          <section className="panel">
            <h2>Animals</h2>
            <ul>
              {board.animals.map(animal => (
                <li key={animal.id} data-testid={animal.audience === "staff" ? "seva-staff-only" : "seva-guest-animal"}>
                  {animal.name} · {animal.audience === "staff" ? "STAFF ONLY" : "Guest-suitable"} · {animal.note}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Today&apos;s roster</h2>
            <label>Activity
              <select aria-label="Activity" value={activity} onChange={e => setActivity(e.target.value)}>
                {board.activities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>From<input aria-label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label>To<input aria-label="To" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="btn" type="button" onClick={generate}>Add daily slots</button>
            <ul>
              {board.slots.map(slot => (
                <li key={slot.id} data-testid="seva-slot">
                  <div>{slot.label}</div>
                  {!slot.supervisorName && <p data-testid="seva-unsupervised">Unsupervised: not bookable</p>}
                  <label>Supervisor
                    <input aria-label={`Supervisor for ${slot.name}`} value={names[slot.id] ?? slot.supervisorName ?? ""} onChange={e => setNames({ ...names, [slot.id]: e.target.value })} />
                  </label>
                  <button className="btn" type="button" onClick={() => saveSupervisor(slot.id)}>Save supervisor</button>
                  <div className="m">{slot.roster.map(person => `${person.name} (${person.status})`).join(", ") || "Nobody yet"}</div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
