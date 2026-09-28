"use client";

export type ReturningCardData = {
  person_id?: string;
  id?: string;
  name: string;
  view?: string;
  returning?: boolean;
  previous_stays?: number;
  previousStays?: number;
  last_visit?: string | null;
  lastVisit?: string | null;
  email?: string | null;
  phone?: string | null;
  preferences?: string | null;
  accessibility?: string | null;
  room_preference?: string | null;
  roomPreference?: string | null;
  allergen_line?: string;
  allergenLine?: string;
  this_stay?: string | null;
  thisStay?: string | null;
  diet?: string[];
  past_issues?: string[];
  pastIssues?: string[];
  notes?: { id?: string; body: string; author: string; at: string }[];
};

export type MatchPrompt = {
  id: string;
  strength: string;
  candidate_name: string;
  candidate_email?: string | null;
};

const STRENGTH: Record<string, string> = {
  email: "same email",
  phone: "same phone",
  name_dob: "similar name and date of birth",
  name_postcode: "similar name and postcode",
};

export function ReturningCards({ cards }: { cards: ReturningCardData[] }) {
  if (!cards.length) return null;
  return (
    <div>
      {cards.map(card => {
        const stays = card.previous_stays ?? card.previousStays;
        const last = card.last_visit ?? card.lastVisit;
        const prefs = card.preferences || card.room_preference || card.roomPreference;
        const line = card.allergen_line ?? card.allergenLine;
        const issues = card.past_issues ?? card.pastIssues ?? [];
        const severe = /anaphylaxis|allergy/i.test(line ?? "");
        return (
          <article key={card.person_id ?? card.id ?? card.name} className="note" data-testid="returning-card" style={{ borderColor: severe ? "var(--brick)" : undefined, marginTop: 8 }}>
            <b>{card.name}</b>
            {card.returning || (stays ?? 0) > 0 ? <span> · returning guest</span> : <span> · first stay on record</span>}
            {stays != null && <div className="m">{stays} previous stay{stays === 1 ? "" : "s"}{last ? ` · last visit ${last}` : ""}</div>}
            {(card.email || card.phone) && <div className="m">{[card.email, card.phone].filter(Boolean).join(" · ")}</div>}
            {prefs && <div className="m">Preferences: {prefs}</div>}
            {card.accessibility && <div className="m">Access: {card.accessibility}</div>}
            {line && <div style={{ fontWeight: 700, marginTop: 4 }}>{line === "allergens: ask again" ? line : `Allergens: ${line}`}</div>}
            {(card.this_stay ?? card.thisStay) && <div className="m">This stay: {card.this_stay ?? card.thisStay}</div>}
            {!!card.diet?.length && <div className="m">Diet: {card.diet.join(", ").replace(/_/g, " ")}</div>}
            {issues.length > 0 && <div className="m">Be aware: {issues.join("; ")}</div>}
            {(card.notes ?? []).slice(0, 3).map(note => (
              <div key={note.id ?? note.at} className="m">{note.author}: {note.body}</div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

export function MatchPrompts({ prompts, onDecide }: { prompts: MatchPrompt[]; onDecide: (id: string, action: "confirm" | "dismiss") => void }) {
  if (!prompts.length) return null;
  return (
    <div className="note" data-testid="possible-match">
      <b>Possible match</b>
      {prompts.map(prompt => (
        <div key={prompt.id} style={{ marginTop: 8 }}>
          <div>{prompt.candidate_name} · {STRENGTH[prompt.strength] ?? prompt.strength}</div>
          <button className="btn" style={{ marginRight: 8 }} onClick={() => onDecide(prompt.id, "confirm")}>Same guest</button>
          <button className="btn" onClick={() => onDecide(prompt.id, "dismiss")}>Not the same</button>
        </div>
      ))}
    </div>
  );
}
