"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Slot = { id: string; label: string; supervisorName: string | null; roster: { name: string; status: string }[] };

export default function SevaPocket({ onError }: { onError: (msg: string | null) => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [name, setName] = useState<Record<string, string>>({});

  const load = async () => {
    const board = await api<{ slots: Slot[] }>("/v1/seva");
    setSlots(board.slots);
  };
  useEffect(() => { load().catch(e => onError((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="pocket-seva">
      <h2>Seva</h2>
      <p className="m">A slot needs a named supervisor before a guest can book it.</p>
      {slots.map(slot => (
        <div className="card" key={slot.id}>
          <p>{slot.label}</p>
          {!slot.supervisorName && <p>Unsupervised: not bookable</p>}
          <p>{slot.roster.map(person => `${person.name} · ${person.status}`).join(", ") || "Nobody yet"}</p>
          <input aria-label="Supervisor" value={name[slot.id] ?? slot.supervisorName ?? ""} onChange={e => setName({ ...name, [slot.id]: e.target.value })} />
          <button type="button" onClick={async () => {
            try {
              await api(`/v1/seva/slots/${slot.id}/supervisor`, { method: "POST", body: JSON.stringify({ name: name[slot.id] ?? "" }) });
              await load();
            } catch (e) { onError((e as Error).message); }
          }}>Save supervisor</button>
        </div>
      ))}
      {!slots.length && <p>No seva slots today.</p>}
    </div>
  );
}
