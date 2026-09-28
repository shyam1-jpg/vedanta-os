/**
 * Guest booking capture, department slices, and the emails each team receives.
 * Pure functions — the API stores and sends; this module decides what is valid,
 * what would be lost on accept, and what each department is allowed to see.
 */
import { allergenLabel, dietFlags, dietLabel, UK_ALLERGENS } from "./diet.ts";

export const SEVERITIES = ["PREFERENCE", "INTOLERANCE", "ALLERGY", "ANAPHYLAXIS"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DIET_TYPES = ["vegetarian", "vegan", "jain", "gluten_free", "dairy_free", "nut_free", "halal", "kosher"] as const;
export const PLATES = ["buffet", "prepared", "table_service"] as const;
export type Plate = (typeof PLATES)[number];

export const ROUTING_DEPARTMENTS = ["KITCHEN", "RESTAURANT", "FRONT"] as const;
export type RoutingDepartment = (typeof ROUTING_DEPARTMENTS)[number];

const SEVERITY_RANK: Record<Severity, number> = { PREFERENCE: 1, INTOLERANCE: 2, ALLERGY: 3, ANAPHYLAXIS: 4 };
const ALLERGEN_SET = new Set<string>(UK_ALLERGENS);
const DIET_SET = new Set<string>(DIET_TYPES);
const MEAL_ORDER = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEAL_ORDER)[number];

export type AllergenTick = { code: string; severity: Severity };
export type PartyGuest = {
  given_name: string;
  family_name: string;
  diet: string[];
  allergens: AllergenTick[];
  other: string | null;
  accessibility: string | null;
  plate: Plate;
};

export type StayCapture = {
  people: number;
  name: string;
  email: string;
  arrival: string;
  departure: string;
  arrival_slot: "AM" | "PM";
  departure_slot: "AM" | "PM";
  party: PartyGuest[];
  accessibility_notes: string | null;
  arrival_time_note: string | null;
  room_preference: string | null;
  travel_notes: string | null;
  notes: string | null;
};

export type KitchenPerson = {
  name: string;
  diet: { code: string; label: string }[];
  allergens: { code: string; label: string; severity: Severity; severe: boolean }[];
  other: string | null;
  days: { date: string; meals: Meal[] }[];
};

export type KitchenSlice = {
  department: "KITCHEN";
  guest: string;
  arrival: string;
  departure: string;
  severe: boolean;
  people: KitchenPerson[];
};

export type RestaurantSlice = {
  department: "RESTAURANT";
  guest: string;
  arrival: string;
  departure: string;
  days: {
    date: string;
    meals: {
      meal: Meal;
      covers: number;
      diets: { code: string; label: string; count: number }[];
      allergens: { code: string; label: string; count: number; severe: number }[];
    }[];
  }[];
  plates: { name: string; plate: "prepared" | "table_service"; detail: string; severe: boolean }[];
  seating: { name: string; need: string }[];
};

export type FrontSlice = {
  department: "FRONT";
  guest: string;
  email: string;
  people: number;
  arrival: string;
  departure: string;
  arrival_time: string | null;
  room_preference: string | null;
  accessibility: string | null;
  notes: string | null;
  travel_notes: string | null;
  party: { name: string; accessibility: string | null }[];
};

export type DepartmentSlice = KitchenSlice | RestaurantSlice | FrontSlice;

export type RoutingRules = {
  kitchen: { enabled: boolean; email: string };
  restaurant: { enabled: boolean; email: string };
  front: { enabled: boolean; email: string };
};

export const DEFAULT_ROUTING_RULES: RoutingRules = {
  kitchen: { enabled: true, email: "" },
  restaurant: { enabled: true, email: "" },
  front: { enabled: true, email: "" },
};

export type OutboundNote = {
  to: string;
  audience: "GUEST" | RoutingDepartment;
  subject: string;
  body: string;
  kind: string;
};

export type RoutedTask = { department: RoutingDepartment; status: string };

const text = (v: unknown, max = 2000): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
};

export function splitName(name: string): { given_name: string; family_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { given_name: "", family_name: "" };
  if (parts.length === 1) return { given_name: parts[0], family_name: "Guest" };
  return { given_name: parts[0], family_name: parts.slice(1).join(" ") };
}

export function highestSeverity(values: string[]): Severity | null {
  let best: Severity | null = null;
  for (const raw of values) {
    if (!SEVERITIES.includes(raw as Severity)) continue;
    const sev = raw as Severity;
    if (!best || SEVERITY_RANK[sev] > SEVERITY_RANK[best]) best = sev;
  }
  return best;
}

export function severityPhrase(severity: string): string {
  if (severity === "ANAPHYLAXIS") return "ANAPHYLAXIS — severe";
  if (severity === "ALLERGY") return "allergy";
  if (severity === "INTOLERANCE") return "intolerance";
  return "preference";
}

export function isSevere(severity: string): boolean {
  return severity === "ANAPHYLAXIS" || severity === "ALLERGY";
}

function asSlot(v: unknown, fallback: "AM" | "PM"): "AM" | "PM" {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "AM" || s === "PM" ? s : fallback;
}

function parseGuest(raw: unknown, index: number): { guest?: PartyGuest; error?: string } {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const given = text(row.given_name, 80) ?? "";
  const family = text(row.family_name, 80) ?? "";
  if (!given || !family) return { error: `Person ${index + 1} needs a first and last name` };
  const diet = Array.isArray(row.diet)
    ? [...new Set(row.diet.map(x => String(x).trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(x => DIET_SET.has(x)))]
    : [];
  const allergens: AllergenTick[] = [];
  const seen = new Set<string>();
  const listed = Array.isArray(row.allergens) ? row.allergens : [];
  for (const item of listed) {
    const code = typeof item === "string" ? item : (item && typeof item === "object" ? String((item as { code?: string }).code ?? "") : "");
    const severity = typeof item === "object" && item ? String((item as { severity?: string }).severity ?? "") : String(row.severity ?? "");
    const normalised = code.trim().toLowerCase();
    if (!normalised || seen.has(normalised)) continue;
    if (!ALLERGEN_SET.has(normalised)) return { error: `${given}: ${normalised.replace(/_/g, " ")} is not one of the 14 UK allergens` };
    if (!SEVERITIES.includes(severity as Severity)) return { error: `Say how serious ${given}'s ${allergenLabel(normalised)} is` };
    seen.add(normalised);
    allergens.push({ code: normalised, severity: severity as Severity });
  }
  const plateRaw = String(row.plate ?? "buffet").trim().toLowerCase();
  if (!PLATES.includes(plateRaw as Plate)) return { error: `${given}: plate must be buffet, prepared, or table service` };
  return {
    guest: {
      given_name: given,
      family_name: family,
      diet,
      allergens,
      other: text(row.other ?? row.diet_notes, 2000),
      accessibility: text(row.accessibility, 2000),
      plate: plateRaw as Plate,
    },
  };
}

export type CaptureInput = {
  people?: unknown;
  name?: unknown;
  email?: unknown;
  arrival?: unknown;
  departure?: unknown;
  arrival_slot?: unknown;
  departure_slot?: unknown;
  party?: unknown;
  dietary_notes?: unknown;
  accessibility_notes?: unknown;
  arrival_time_note?: unknown;
  room_preference?: unknown;
  travel_notes?: unknown;
  notes?: unknown;
};

/** Validate a public booking. Party length must match the number of people. */
export function validateCapture(input: CaptureInput): { ok: true; capture: StayCapture } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = text(input.name, 120) ?? "";
  const email = text(input.email, 200)?.toLowerCase() ?? "";
  if (!name) errors.push("Name is required");
  if (!email.includes("@")) errors.push("Email is required");
  const arrival = text(input.arrival, 10) ?? "";
  const departure = text(input.departure, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) errors.push("Choose arrival and departure dates");
  else if (departure < arrival) errors.push("Departure must be on or after arrival");
  if (!Array.isArray(input.party) || input.party.length === 0) errors.push("Add each person in the party");
  const party: PartyGuest[] = [];
  if (Array.isArray(input.party)) {
    if (input.party.length > 200) errors.push("Too many people in one booking");
    for (const [i, row] of input.party.entries()) {
      const parsed = parseGuest(row, i);
      if (parsed.error) errors.push(parsed.error);
      else if (parsed.guest) party.push(parsed.guest);
    }
  }
  const people = Number(input.people);
  const count = party.length || (Number.isFinite(people) ? people : 0);
  if (!(count > 0)) errors.push("Say how many people are coming");
  if (Array.isArray(input.party) && party.length && Number.isFinite(people) && people !== party.length) {
    errors.push("Diet and allergen details are needed for every person in the party");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    capture: {
      people: party.length,
      name,
      email,
      arrival,
      departure,
      arrival_slot: asSlot(input.arrival_slot, "PM"),
      departure_slot: asSlot(input.departure_slot, "AM"),
      party,
      accessibility_notes: text(input.accessibility_notes),
      arrival_time_note: text(input.arrival_time_note, 200),
      room_preference: text(input.room_preference, 200),
      travel_notes: text(input.travel_notes),
      notes: text(input.notes),
    },
  };
}

/**
 * Older enquiries stored one free-text diet note and no party.
 * Build the best capture we can, and list anything accept cannot attach to a person.
 */
export function captureFromStored(input: CaptureInput): { capture: StayCapture; loss: string[] } {
  const validated = validateCapture(input);
  if (validated.ok) return { capture: validated.capture, loss: [] };
  const name = text(input.name, 120) ?? "Guest";
  const email = text(input.email, 200)?.toLowerCase() ?? "";
  const arrival = text(input.arrival, 10) ?? "1970-01-01";
  const departure = text(input.departure, 10) ?? arrival;
  const split = splitName(name);
  const dietary = text(input.dietary_notes);
  const people = Math.max(1, Math.min(200, Number(input.people) || 1));
  let party: PartyGuest[] = [];
  if (Array.isArray(input.party)) {
    for (const [i, row] of input.party.entries()) {
      const parsed = parseGuest(row, i);
      if (parsed.guest) party.push(parsed.guest);
    }
  }
  if (!party.length) {
    party = [{
      given_name: split.given_name || "Guest",
      family_name: split.family_name || "Guest",
      diet: [],
      allergens: [],
      other: dietary,
      accessibility: null,
      plate: "buffet",
    }];
  }
  const loss: string[] = [];
  if (people > party.length) loss.push(`${people - party.length} ${people - party.length === 1 ? "person has" : "people have"} no named diet or allergen record`);
  const namedNotes = party.map(p => p.other ?? "").join("\n");
  if (dietary && !namedNotes.includes(dietary)) loss.push("The free-text diet note is not attached to a named person");
  return {
    capture: {
      people,
      name,
      email,
      arrival,
      departure,
      arrival_slot: asSlot(input.arrival_slot, "PM"),
      departure_slot: asSlot(input.departure_slot, "AM"),
      party,
      accessibility_notes: text(input.accessibility_notes),
      arrival_time_note: text(input.arrival_time_note, 200),
      room_preference: text(input.room_preference, 200),
      travel_notes: text(input.travel_notes),
      notes: text(input.notes),
    },
    loss,
  };
}

export function acceptWarning(loss: string[]): string | null {
  if (!loss.length) return null;
  return `Accepting this booking would leave gaps the kitchen cannot see: ${loss.join("; ")}. Take it only if you have read that and still want to continue.`;
}

export function eachStayDate(arrival: string, departure: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure) || departure < arrival) return [];
  const out: string[] = [];
  const d = new Date(arrival + "T00:00:00Z");
  const end = new Date(departure + "T00:00:00Z");
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Meal sittings for one date. Guest-book stays arrive in the evening and leave in the morning. */
export function mealsOn(stay: { arrival: string; departure: string; arrival_slot?: "AM" | "PM"; departure_slot?: "AM" | "PM" }, iso: string): Meal[] {
  if (iso < stay.arrival || iso > stay.departure) return [];
  if (stay.arrival === stay.departure) return ["lunch"];
  let meals: Meal[] = [...MEAL_ORDER];
  if (iso === stay.arrival) {
    const from = (stay.arrival_slot ?? "PM") === "AM" ? "lunch" : "dinner";
    meals = meals.slice(MEAL_ORDER.indexOf(from));
  }
  if (iso === stay.departure) {
    const to = (stay.departure_slot ?? "AM") === "AM" ? "breakfast" : "lunch";
    const idx = MEAL_ORDER.indexOf(to);
    meals = meals.filter(m => MEAL_ORDER.indexOf(m) <= idx);
  }
  return meals;
}

function personName(p: PartyGuest): string {
  return `${p.given_name} ${p.family_name}`.trim();
}

function kitchenPerson(stay: StayCapture, person: PartyGuest): KitchenPerson | null {
  const flags = dietFlags({ diet: person.diet, allergens: person.allergens.map(a => a.code), notes: person.other });
  const diet = flags.filter(f => f.code !== "notes" && !person.allergens.some(a => a.code === f.code)).map(f => ({ code: f.code, label: f.label }));
  const allergens = person.allergens.map(a => ({
    code: a.code,
    label: allergenLabel(a.code),
    severity: a.severity,
    severe: isSevere(a.severity),
  }));
  if (!diet.length && !allergens.length && !person.other) return null;
  const days = eachStayDate(stay.arrival, stay.departure)
    .map(date => ({ date, meals: mealsOn(stay, date) }))
    .filter(d => d.meals.length);
  return { name: personName(person), diet, allergens, other: person.other, days };
}

export function kitchenSlice(stay: StayCapture): KitchenSlice | null {
  const people = stay.party.map(p => kitchenPerson(stay, p)).filter((p): p is KitchenPerson => !!p);
  if (!people.length) return null;
  const severe = people.some(p => p.allergens.some(a => a.severity === "ANAPHYLAXIS"));
  return { department: "KITCHEN", guest: stay.name, arrival: stay.arrival, departure: stay.departure, severe, people };
}

export function restaurantSlice(stay: StayCapture): RestaurantSlice {
  const days = eachStayDate(stay.arrival, stay.departure).map(date => {
    const meals = mealsOn(stay, date).map(meal => {
      const diets = new Map<string, number>();
      const allergens = new Map<string, { count: number; severe: number }>();
      for (const person of stay.party) {
        for (const code of person.diet) {
          if (dietFlags({ diet: [code] }).length === 0) continue;
          diets.set(code, (diets.get(code) ?? 0) + 1);
        }
        for (const a of person.allergens) {
          const cur = allergens.get(a.code) ?? { count: 0, severe: 0 };
          cur.count += 1;
          if (isSevere(a.severity)) cur.severe += 1;
          allergens.set(a.code, cur);
        }
      }
      return {
        meal,
        covers: stay.party.length,
        diets: [...diets.entries()].map(([code, count]) => ({ code, label: dietLabel(code), count })),
        allergens: [...allergens.entries()].map(([code, v]) => ({ code, label: allergenLabel(code), count: v.count, severe: v.severe })),
      };
    });
    return { date, meals };
  }).filter(d => d.meals.length);
  const plates = stay.party.filter(p => p.plate !== "buffet").map(p => ({
    name: personName(p),
    plate: p.plate as "prepared" | "table_service",
    detail: [
      ...p.diet.map(dietLabel),
      ...p.allergens.map(a => `${allergenLabel(a.code)} (${severityPhrase(a.severity)})`),
      p.other,
    ].filter(Boolean).join("; "),
    severe: p.allergens.some(a => a.severity === "ANAPHYLAXIS"),
  }));
  const seating: { name: string; need: string }[] = [];
  for (const person of stay.party) {
    if (person.accessibility) seating.push({ name: personName(person), need: person.accessibility });
  }
  if (stay.accessibility_notes) seating.push({ name: stay.name, need: stay.accessibility_notes });
  return { department: "RESTAURANT", guest: stay.name, arrival: stay.arrival, departure: stay.departure, days, plates, seating };
}

export function frontSlice(stay: StayCapture): FrontSlice {
  const access = [stay.accessibility_notes, ...stay.party.map(p => p.accessibility ? `${personName(p)}: ${p.accessibility}` : null)].filter(Boolean).join("\n");
  return {
    department: "FRONT",
    guest: stay.name,
    email: stay.email,
    people: stay.party.length || stay.people,
    arrival: stay.arrival,
    departure: stay.departure,
    arrival_time: stay.arrival_time_note,
    room_preference: stay.room_preference,
    accessibility: access || null,
    notes: stay.notes,
    travel_notes: stay.travel_notes,
    party: stay.party.map(p => ({ name: personName(p), accessibility: p.accessibility })),
  };
}

export function departmentSlices(stay: StayCapture, rules: RoutingRules = DEFAULT_ROUTING_RULES): DepartmentSlice[] {
  const slices: DepartmentSlice[] = [];
  if (rules.kitchen.enabled) {
    const kitchen = kitchenSlice(stay);
    if (kitchen) slices.push(kitchen);
  }
  if (rules.restaurant.enabled) slices.push(restaurantSlice(stay));
  if (rules.front.enabled) slices.push(frontSlice(stay));
  return slices;
}

function mealLine(meals: Meal[]): string {
  return meals.join(", ");
}

export function formatSlice(slice: DepartmentSlice): string {
  if (slice.department === "KITCHEN") {
    const lines = [`Kitchen — ${slice.guest}`, `${slice.arrival} to ${slice.departure}`, ""];
    if (slice.severe) lines.push("SEVERE — anaphylaxis in this party. Read every line before service.", "");
    for (const person of slice.people) {
      lines.push(person.name);
      if (person.diet.length) lines.push(`  Diet: ${person.diet.map(d => d.label).join(", ")}`);
      for (const a of person.allergens) {
        const flag = a.severity === "ANAPHYLAXIS" ? "SEVERE — " : a.severe ? "Allergy — " : "";
        lines.push(`  ${flag}${a.label}: ${severityPhrase(a.severity)}`);
      }
      if (person.other) lines.push(`  Other: ${person.other}`);
      for (const day of person.days) lines.push(`  ${day.date}: ${mealLine(day.meals)}`);
      lines.push("");
    }
    return lines.join("\n").trim();
  }
  if (slice.department === "RESTAURANT") {
    const lines = [`Restaurant — ${slice.guest}`, `${slice.arrival} to ${slice.departure}`, "Buffet. Food is not billed. Prepare a plate only where noted.", ""];
    for (const day of slice.days) {
      for (const meal of day.meals) {
        const diets = meal.diets.map(d => `${d.count} ${d.label}`).join(", ");
        const allergens = meal.allergens.map(a => `${a.count} ${a.label}${a.severe ? ` (${a.severe} severe)` : ""}`).join(", ");
        lines.push(`${day.date} ${meal.meal}: ${meal.covers} covers${diets ? ` · ${diets}` : ""}${allergens ? ` · ${allergens}` : ""}`);
      }
    }
    if (slice.plates.length) {
      lines.push("", "Plates to prepare");
      for (const plate of slice.plates) {
        const how = plate.plate === "table_service" ? "table service" : "prepared plate";
        lines.push(`- ${plate.severe ? "SEVERE — " : ""}${plate.name}: ${how}${plate.detail ? ` · ${plate.detail}` : ""}`);
      }
    }
    if (slice.seating.length) {
      lines.push("", "Seating and assistance");
      for (const seat of slice.seating) lines.push(`- ${seat.name}: ${seat.need}`);
    }
    return lines.join("\n").trim();
  }
  const lines = [
    `Front of house — ${slice.guest}`,
    `${slice.people} ${slice.people === 1 ? "person" : "people"}`,
    `Arrive: ${slice.arrival}${slice.arrival_time ? ` · ${slice.arrival_time}` : ""}`,
    `Depart: ${slice.departure}`,
  ];
  if (slice.room_preference) lines.push(`Room preference: ${slice.room_preference}`);
  if (slice.accessibility) lines.push(`Accessibility: ${slice.accessibility}`);
  if (slice.travel_notes) lines.push(`Travel: ${slice.travel_notes}`);
  if (slice.notes) lines.push(`Notes: ${slice.notes}`);
  if (slice.party.length) lines.push("", "Party", ...slice.party.map(p => `- ${p.name}${p.accessibility ? ` · ${p.accessibility}` : ""}`));
  return lines.join("\n").trim();
}

export function taskPriority(slice: DepartmentSlice): { priority: "urgent" | "high" | "normal"; severity: "critical" | "major" | "none" } {
  if (slice.department === "KITCHEN" && slice.severe) return { priority: "urgent", severity: "critical" };
  if (slice.department === "KITCHEN" && slice.people.some(p => p.allergens.some(a => a.severe))) return { priority: "high", severity: "major" };
  if (slice.department === "RESTAURANT" && slice.plates.some(p => p.severe)) return { priority: "high", severity: "major" };
  return { priority: "normal", severity: "none" };
}

export function dietarySummary(stay: StayCapture): string | null {
  const lines = stay.party.map(person => {
    const bits = [
      ...dietFlags({ diet: person.diet, allergens: [] }).map(f => f.label),
      ...person.allergens.map(a => `${allergenLabel(a.code)} (${severityPhrase(a.severity)})`),
      person.other,
    ].filter(Boolean);
    if (!bits.length && person.plate === "buffet") return null;
    const plate = person.plate === "buffet" ? "" : person.plate === "prepared" ? "prepared plate" : "table service";
    return `${personName(person)}: ${[...bits, plate].filter(Boolean).join("; ")}`;
  }).filter((line): line is string => !!line);
  return lines.length ? lines.join("\n") : null;
}

function emailOrNull(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return null;
  return email;
}

export function parseRoutingRules(raw: unknown): RoutingRules {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const one = (key: keyof RoutingRules): { enabled: boolean; email: string } => {
    const row = (src[key] && typeof src[key] === "object" ? src[key] : {}) as Record<string, unknown>;
    const enabled = row.enabled === undefined ? DEFAULT_ROUTING_RULES[key].enabled : !!row.enabled;
    const email = emailOrNull(String(row.email ?? "")) ?? "";
    return { enabled, email };
  };
  return { kitchen: one("kitchen"), restaurant: one("restaurant"), front: one("front") };
}

export function guestEmail(stay: StayCapture, houseName: string): OutboundNote {
  const lines = stay.party.map(person => {
    const allergens = person.allergens.length
      ? person.allergens.map(a => `${allergenLabel(a.code)} — ${severityPhrase(a.severity)}`).join("; ")
      : "none declared";
    const diet = person.diet.length ? person.diet.map(dietLabel).join(", ") : "house vegetarian";
    const plate = person.plate === "buffet" ? "buffet" : person.plate === "prepared" ? "a plate prepared for them" : "table service";
    return [
      personName(person),
      `  Diet: ${diet}`,
      `  Allergens: ${allergens}`,
      person.other ? `  Other: ${person.other}` : null,
      `  Service: ${plate}`,
    ].filter(Boolean).join("\n");
  });
  const body = [
    `Dear ${stay.name},`,
    "",
    `Thank you. We have your place at ${houseName}.`,
    "",
    `Arrive: ${stay.arrival}${stay.arrival_time_note ? ` · ${stay.arrival_time_note}` : ""}`,
    `Depart: ${stay.departure}`,
    stay.room_preference ? `Room preference: ${stay.room_preference}` : null,
    stay.accessibility_notes ? `Accessibility: ${stay.accessibility_notes}` : null,
    "",
    "Please check the diet and allergen record below. The kitchen is vegetarian: no eggs, and no onion or garlic. If anything is wrong, reply to this email before you travel.",
    "",
    ...lines,
    "",
    "Food is not billed. Meals are the buffet unless we have noted a prepared plate or table service.",
    "",
    houseName,
  ].filter(line => line !== null).join("\n");
  return {
    to: stay.email,
    audience: "GUEST",
    subject: `Your place at ${houseName} — please check allergens`,
    body,
    kind: "guest_booking",
  };
}

export function departmentEmail(stay: StayCapture, slice: DepartmentSlice, to: string, houseName: string, kind: "submitted" | "accepted" | "amended" | "cancelled"): OutboundNote | null {
  const email = emailOrNull(to);
  if (!email) return null;
  const when = kind === "cancelled" ? "cancelled" : kind === "accepted" ? "accepted into the house book" : kind === "amended" ? "amended" : "received";
  const subject = kind === "cancelled"
    ? `Cancelled — ${stay.name} · ${slice.department.toLowerCase()}`
    : `${slice.department === "KITCHEN" ? "Kitchen" : slice.department === "RESTAURANT" ? "Restaurant" : "Front of house"} — ${stay.name}`;
  const intro = kind === "cancelled"
    ? `The stay for ${stay.name} (${stay.arrival} to ${stay.departure}) is cancelled. Withdraw the earlier note for your department.`
    : `${houseName} booking ${when}. This note is only for your department.`;
  const body = kind === "cancelled" ? `${intro}\n` : `${intro}\n\n${formatSlice(slice)}\n`;
  return { to: email, audience: slice.department, subject, body, kind: `guest_booking_${kind}` };
}

export function bookingEmails(stay: StayCapture, rules: RoutingRules, houseName: string, kind: "submitted" | "accepted" | "amended" = "submitted"): OutboundNote[] {
  const notes: OutboundNote[] = [guestEmail(stay, houseName)];
  const slices = departmentSlices(stay, rules);
  const address: Record<RoutingDepartment, string> = {
    KITCHEN: rules.kitchen.email,
    RESTAURANT: rules.restaurant.email,
    FRONT: rules.front.email,
  };
  for (const slice of slices) {
    const note = departmentEmail(stay, slice, address[slice.department], houseName, kind);
    if (note) notes.push(note);
  }
  return notes;
}

export function cancellationEmails(stay: StayCapture, rules: RoutingRules, houseName: string): OutboundNote[] {
  const guest: OutboundNote = {
    to: stay.email,
    audience: "GUEST",
    subject: `Your place at ${houseName} is cancelled`,
    body: `Dear ${stay.name},\n\nYour place from ${stay.arrival} to ${stay.departure} is cancelled. The kitchen, restaurant and front desk have been told to stand down.\n\n${houseName}\n`,
    kind: "guest_booking_cancelled",
  };
  const notes = [guest];
  for (const slice of departmentSlices(stay, rules)) {
    const address = slice.department === "KITCHEN" ? rules.kitchen.email : slice.department === "RESTAURANT" ? rules.restaurant.email : rules.front.email;
    const note = departmentEmail(stay, slice, address, houseName, "cancelled");
    if (note) notes.push(note);
  }
  return notes;
}

/** Which existing department tasks to update, open, or withdraw after an amend or cancel. */
export function reconcileRoutes(existing: RoutedTask[], desired: RoutingDepartment[]): { update: RoutingDepartment[]; create: RoutingDepartment[]; withdraw: RoutingDepartment[] } {
  const open = existing.filter(t => t.status !== "cancelled" && t.status !== "verified");
  const have = new Set(open.map(t => t.department));
  const want = new Set(desired);
  return {
    update: [...want].filter(d => have.has(d)),
    create: [...want].filter(d => !have.has(d)),
    withdraw: [...have].filter(d => !want.has(d)),
  };
}

export type RoomPerson = { id: string; label: string };
export type RoomLink = { room: string; personId: string | null; label: string };

/** Link guest-book room rows to person records so kitchen flags can fire. */
export function roomPersonPlan(rooms: string[], people: RoomPerson[], fallbackLabel: string): RoomLink[] {
  const cleanRooms = rooms.map(r => r.trim()).filter(Boolean);
  if (!people.length) return cleanRooms.map(room => ({ room, personId: null, label: fallbackLabel }));
  if (cleanRooms.length === 1) return people.map(p => ({ room: cleanRooms[0], personId: p.id, label: p.label }));
  if (people.length === 1) return cleanRooms.map(room => ({ room, personId: people[0].id, label: people[0].label }));
  return cleanRooms.map((room, i) => {
    const person = people[i];
    return person ? { room, personId: person.id, label: person.label } : { room, personId: null, label: fallbackLabel };
  });
}

/** Resend must never open an account or rewrite a name. Unknown emails get the same reply. */
export function resendAccessCode(existing: { id: string; display_name: string } | null): { action: "ignore" | "reissue"; create_account: false; overwrite_name: false; guest_id: string | null } {
  if (!existing) return { action: "ignore", create_account: false, overwrite_name: false, guest_id: null };
  return { action: "reissue", create_account: false, overwrite_name: false, guest_id: existing.id };
}

/** A card-page failure must not submit the enquiry again. */
export function depositFollowUp(saved: { id?: string | null } | null): "checkout" | "stop" {
  return saved?.id ? "checkout" : "stop";
}
