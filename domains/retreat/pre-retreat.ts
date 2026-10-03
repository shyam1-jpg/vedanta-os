/**
 * Day-before check for one existing retreat.
 * A line is done only from records passed in. A retreat name is not a record.
 */
import { HARI_REMINDER } from "../house/rules.ts";

export type LineState = "open" | "done";

export type CheckLine = {
  key: "rooms" | "meals" | "rota" | "suppliers" | "safety";
  label: string;
  state: LineState;
  detail: string;
};

export type SafetyPart = {
  key: "incident_note" | "pre_arrival" | "risk_assessment" | "first_aid" | "contact_tree";
  label: string;
  state: LineState;
  detail: string;
};

/** Existing staff page where a real record for this line can be saved. */
export const OPEN_HREF = {
  rooms: "/rooms/",
  meals: "/kitchen/",
  rota: "/hr/",
  suppliers: "/purchasing/",
  safety: "/emergency/",
  incident_note: "/emergency/",
  pre_arrival: "/emergency/",
  risk_assessment: "/emergency/",
  first_aid: "/emergency/",
  contact_tree: "/emergency/",
} as const;

export type OpenKey = keyof typeof OPEN_HREF;

/** Open lines go to the page that can close them. A done line has no control. */
export function openTarget(state: LineState, key: string): string | null {
  if (state !== "open" || !Object.prototype.hasOwnProperty.call(OPEN_HREF, key)) return null;
  return OPEN_HREF[key as OpenKey];
}

const PLACED = new Set([
  "ordered",
  "sent",
  "partially_delivered",
  "delivered",
  "invoiced",
  "SENT",
  "PART_RECEIVED",
  "RECEIVED",
  "CLOSED",
]);

const BLANK_RISK = new Set(["kitchen", "outdoor", "transport", "events"]);

export function purchaseMarkedPlaced(status: string | null | undefined): boolean {
  return !!status && PLACED.has(status);
}

export function dayBefore(arrival: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival)) return null;
  const [y, m, d] = arrival.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function stayDates(arrival: string, departure: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure) || departure < arrival) return [];
  const dates: string[] = [];
  let cursor = arrival;
  while (cursor <= departure && dates.length < 400) {
    dates.push(cursor);
    const [y, m, d] = cursor.split("-").map(Number);
    cursor = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return dates;
}

function textSaved(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function riskAssessmentSaved(body: string | null | undefined): boolean {
  if (!textSaved(body)) return false;
  const rest = body!.split(HARI_REMINDER).join("").trim().toLowerCase();
  if (!rest || BLANK_RISK.has(rest)) return false;
  return true;
}

export function contactTreeSaved(contacts: { name: string; phone: string }[]): boolean {
  return contacts.some(c => {
    const name = (c.name ?? "").trim();
    const phone = (c.phone ?? "").replace(/\s+/g, "");
    return name.length > 0 && phone.length > 0 && phone !== "999";
  });
}

export type SafetyRow = { kind: string; body: string | null; signedAt: string | null };

function parseContact(body: string): { name: string; phone: string } {
  const parts = body.split("|").map(s => s.trim());
  if (parts.length >= 2 && parts[1]) return { name: parts[0], phone: parts[1] };
  return { name: "", phone: body.trim() };
}

export function preRetreatReadiness(input: {
  bookingId: string;
  arrival: string;
  departure: string;
  roomAssignments: number;
  mealDates: string[];
  rotaDates: string[];
  purchases: { status: string; bookingId: string | null }[];
  safetyRows: SafetyRow[];
}): { dayBefore: string | null; lines: CheckLine[]; safetyParts: SafetyPart[]; ready: boolean } {
  const dates = stayDates(input.arrival, input.departure);
  const mealSet = new Set(input.mealDates);
  const rotaSet = new Set(input.rotaDates);
  const missingMeals = dates.filter(d => !mealSet.has(d));
  const missingRota = dates.filter(d => !rotaSet.has(d));
  const rooms = Math.max(0, input.roomAssignments || 0);
  const placed = input.purchases.filter(p => p.bookingId === input.bookingId && purchaseMarkedPlaced(p.status));

  const incident = input.safetyRows.some(r => r.kind === "incident_note" && textSaved(r.body));
  const preArrival = input.safetyRows.some(r => r.kind === "pre_arrival" && textSaved(r.body));
  const risk = input.safetyRows.some(r => r.kind === "risk_assessment" && riskAssessmentSaved(r.body));
  const firstAid = input.safetyRows.some(r => r.kind === "first_aid" && textSaved(r.body) && textSaved(r.signedAt));
  const contacts = contactTreeSaved(
    input.safetyRows.filter(r => r.kind === "contact" && textSaved(r.body)).map(r => parseContact(r.body!)),
  );

  const safetyParts: SafetyPart[] = [
    { key: "incident_note", label: "Incident-log note", state: incident ? "done" : "open", detail: incident ? "A note is saved for this retreat." : "Open until staff save the incident-log note they intend for this retreat." },
    { key: "pre_arrival", label: "Pre-arrival checklist", state: preArrival ? "done" : "open", detail: preArrival ? "A checklist is saved for this retreat." : "Open until staff save the pre-arrival checklist for this retreat." },
    { key: "risk_assessment", label: "Risk assessment", state: risk ? "done" : "open", detail: risk ? "A risk assessment is saved for this retreat." : "Open. A blank template is not a sign-off." },
    { key: "first_aid", label: "First aid sign-off", state: firstAid ? "done" : "open", detail: firstAid ? "A first aid sign-off is saved for this retreat." : "Open until a first aid sign-off is saved for this retreat." },
    { key: "contact_tree", label: "Contact tree", state: contacts ? "done" : "open", detail: contacts ? "A contact tree is saved for this retreat." : "Open. The public number 999 is not a saved contact tree." },
  ];

  const lines: CheckLine[] = [
    {
      key: "rooms",
      label: "Rooms assigned",
      state: rooms > 0 ? "done" : "open",
      detail: rooms > 0 ? `${rooms} room${rooms === 1 ? "" : "s"} assigned on the room board for this retreat.` : "Open. The room board has no assignment for this retreat.",
    },
    {
      key: "meals",
      label: "Meals planned",
      state: dates.length > 0 && missingMeals.length === 0 ? "done" : "open",
      detail: dates.length === 0
        ? "Open. This retreat has no dates to plan."
        : missingMeals.length === 0
          ? "A menu or meal-count record exists for each date of this retreat."
          : `Open. No menu or meal-count record for ${missingMeals.join(", ")}.`,
    },
    {
      key: "rota",
      label: "Staff rota filled",
      state: dates.length > 0 && missingRota.length === 0 ? "done" : "open",
      detail: dates.length === 0
        ? "Open. This retreat has no dates to cover."
        : missingRota.length === 0
          ? "The rota has a shift on each date of this retreat."
          : `Open. No rota shift on ${missingRota.join(", ")}.`,
    },
    {
      key: "suppliers",
      label: "Suppliers ordered",
      state: placed.length > 0 ? "done" : "open",
      detail: placed.length > 0
        ? `${placed.length} purchase${placed.length === 1 ? "" : "s"} for this retreat marked placed.`
        : "Open. No purchase for this retreat is marked placed.",
    },
    {
      key: "safety",
      label: "Health and safety signed off",
      state: safetyParts.every(p => p.state === "done") ? "done" : "open",
      detail: safetyParts.every(p => p.state === "done")
        ? "The incident note, checklist, risk assessment, first aid sign-off and contact tree are saved for this retreat."
        : "Open until each safety record is saved for this retreat. A blank template is not a sign-off.",
    },
  ];

  return { dayBefore: dayBefore(input.arrival), lines, safetyParts, ready: lines.every(l => l.state === "done") };
}
