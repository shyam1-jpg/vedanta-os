"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Card = {
  person_id?: string;
  name: string;
  returning?: boolean;
  previous_stays?: number;
  last_visit?: string | null;
  email?: string | null;
  phone?: string | null;
  preferences?: string | null;
  accessibility?: string | null;
  allergen_line?: string;
  this_stay?: string | null;
  diet?: string[];
};

type Arrival = { group_id: string; name: string; cards: Card[] };

export default function ReturningGuests({ surface }: { surface: "front" | "kitchen" }) {
  const [items, setItems] = useState<Arrival[]>([]);
  useEffect(() => {
    api<{ items: Arrival[] }>(`/v1/guest-history/arrivals?surface=${surface}`).then(r => setItems(r.items)).catch(() => setItems([]));
  }, [surface]);
  const cards = items.flatMap(group => group.cards.map(card => ({ ...card, group: group.name })));
  if (!cards.length) return null;
  return (
    <div className="card" data-testid={`returning-${surface}`}>
      <h2>{surface === "kitchen" ? "Diet for today's arrivals" : "Returning guests arriving"}</h2>
      {cards.map(card => (
        <div key={(card.person_id ?? card.name) + card.group} className="row" style={{ display: "block" }}>
          <b>{card.name}</b>
          <span className="m"> · {card.group}</span>
          {surface === "front" && (
            <div className="m">
              {(card.previous_stays ?? 0) > 0 ? `${card.previous_stays} previous stays${card.last_visit ? `, last ${card.last_visit}` : ""}` : "No previous stay on record"}
              {card.email || card.phone ? ` · ${[card.email, card.phone].filter(Boolean).join(" · ")}` : ""}
              {card.preferences ? ` · ${card.preferences}` : ""}
              {card.accessibility ? ` · access: ${card.accessibility}` : ""}
            </div>
          )}
          {surface === "kitchen" && (
            <div>
              <b>{card.allergen_line === "allergens: ask again" ? "allergens: ask again" : card.allergen_line}</b>
              {card.this_stay ? <div className="m">This stay: {card.this_stay}</div> : null}
              {!!card.diet?.length && <div className="m">{card.diet.join(", ").replace(/_/g, " ")}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
