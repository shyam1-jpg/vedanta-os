/** A short daily note for the goshala's two animals. Not a livestock system.
 *  The bull is staff only. Guests never see that profile, and the cows are never milked.
 *  The log stays off until the house turns it on.
 */

export type CowKind = "cow" | "bull";

export type CowProfile = {
  id: string;
  name: string;
  kind: CowKind;
  guestFacing: boolean;
  note: string;
};

export type CowCareSettings = { enabled: boolean };

export type DayLog = {
  animalId: string;
  date: string;
  duty: string;
  feedWhat: string;
  feedWhen: string;
  feedAmount: string;
  health: string;
};

export type VetVisit = {
  animalId: string;
  date: string;
  vet: string;
  reason: string;
  outcome: string;
  followUp: string | null;
};

export type TodayCard = {
  animalId: string;
  name: string;
  guestFacing: boolean;
  done: string[];
  missing: string[];
  followUp: string | null;
};

export type HistoryLine = {
  date: string;
  animal: string;
  guestFacing: boolean;
  duty: string;
  feedWhat: string;
  feedWhen: string;
  feedAmount: string;
  health: string;
  vet: string;
  reason: string;
  outcome: string;
  followUp: string;
};

const DAIRY = /\b(milk|milking|milked|dairy|udder|lactation|yield)\b/i;
const DAIRY_KEY = /milk|dairy|yield|lactat|udder/i;

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function isoDate(value: unknown): string | null {
  const day = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function dairyKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, inner]) => DAIRY_KEY.test(key) || dairyKey(inner));
}

function dairyWords(...parts: string[]): boolean {
  return parts.some(part => DAIRY.test(part));
}

/** Placeholder names. The owner types the real names later. The bull stays staff only. */
export function seedCows(): CowProfile[] {
  return [
    {
      id: "example-daisy",
      name: "Example Daisy",
      kind: "cow",
      guestFacing: true,
      note: "A gentle cow. Guests visit only with staff.",
    },
    {
      id: "example-bull",
      name: "Example Bull",
      kind: "bull",
      guestFacing: false,
      note: "STAFF ONLY. Can be aggressive. Never offered to guests.",
    },
  ];
}

export function parseCowCareSettings(raw: unknown): CowCareSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { enabled: src.enabled === true || src.enabled === "true" };
}

export function isGuestFacing(animal: { guestFacing: boolean; kind: CowKind }): boolean {
  return animal.kind !== "bull" && animal.guestFacing === true;
}

export function guestCows(animals: CowProfile[]): CowProfile[] {
  return animals.filter(isGuestFacing);
}

export function hiddenNames(animals: { name: string; guestFacing: boolean; kind: CowKind }[]): string[] {
  return animals.filter(animal => !isGuestFacing(animal)).map(animal => animal.name);
}

export function mentionsHiddenAnimal(value: string, names: string[]): boolean {
  const blob = value.toLowerCase();
  return names.some(name => {
    const needle = name.trim().toLowerCase();
    return needle.length >= 3 && blob.includes(needle);
  });
}

export function renameCow(animal: CowProfile, raw: unknown): { ok: true; animal: CowProfile } | { ok: false; error: string } {
  if (dairyKey(raw)) return { ok: false, error: "The cows are never milked" };
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const wantsGuest = src.guest_facing === true || src.guestFacing === true || src.guest_facing === "true" || src.guestFacing === "true";
  if (animal.kind === "bull" && wantsGuest) return { ok: false, error: "The bull is staff only" };
  if (!isGuestFacing(animal) && wantsGuest) return { ok: false, error: "That animal is staff only" };
  const name = text(src.name ?? animal.name, 80);
  const note = text(src.note ?? animal.note, 240);
  if (!name) return { ok: false, error: "The animal needs a name" };
  if (dairyWords(name, note)) return { ok: false, error: "The cows are never milked" };
  return {
    ok: true,
    animal: {
      ...animal,
      name,
      note,
      guestFacing: animal.kind === "bull" ? false : animal.guestFacing,
    },
  };
}

export function animalForSlot(
  kind: string,
  animals: { id: string; guestFacing: boolean; kind: CowKind }[],
  chosenId: string | null,
): { ok: true; animalId: string | null } | { ok: false; error: string } {
  if (kind !== "cow_care") {
    if (chosenId) return { ok: false, error: "Only cow care is linked to an animal" };
    return { ok: true, animalId: null };
  }
  if (chosenId) {
    const chosen = animals.find(animal => animal.id === chosenId);
    if (!chosen || !isGuestFacing(chosen)) return { ok: false, error: "That animal is staff only and is never offered to guests" };
    return { ok: true, animalId: chosen.id };
  }
  const facing = animals.filter(isGuestFacing);
  if (facing.length === 1) return { ok: true, animalId: facing[0].id };
  return { ok: true, animalId: null };
}

export function slotVisibleToGuest(animalId: string | null | undefined, animals: { id: string; guestFacing: boolean; kind: CowKind }[]): boolean {
  if (!animalId) return true;
  const animal = animals.find(item => item.id === animalId);
  if (!animal) return false;
  return isGuestFacing(animal);
}

export function parseDay(raw: unknown): { ok: true; log: DayLog } | { ok: false; error: string } {
  if (dairyKey(raw)) return { ok: false, error: "The cows are never milked" };
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const date = isoDate(src.date);
  const animalId = text(src.animal_id ?? src.animalId, 80);
  if (!animalId) return { ok: false, error: "Choose the animal" };
  if (!date) return { ok: false, error: "Choose the day" };
  const log: DayLog = {
    animalId,
    date,
    duty: text(src.duty, 80),
    feedWhat: text(src.feed_what ?? src.feedWhat, 80),
    feedWhen: text(src.feed_when ?? src.feedWhen, 40),
    feedAmount: text(src.feed_amount ?? src.feedAmount, 40),
    health: text(src.health, 500),
  };
  if (dairyWords(log.duty, log.feedWhat, log.feedWhen, log.feedAmount, log.health)) {
    return { ok: false, error: "The cows are never milked" };
  }
  if (!log.duty && !log.feedWhat && !log.feedWhen && !log.feedAmount && !log.health) {
    return { ok: false, error: "Add who is with them, a feed, or a health note" };
  }
  return { ok: true, log };
}

export function parseVet(raw: unknown): { ok: true; visit: VetVisit } | { ok: false; error: string } {
  if (dairyKey(raw)) return { ok: false, error: "The cows are never milked" };
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const date = isoDate(src.date);
  const animalId = text(src.animal_id ?? src.animalId, 80);
  const vet = text(src.vet, 80);
  const reason = text(src.reason, 240);
  const outcome = text(src.outcome, 240);
  const followUp = src.follow_up == null && src.followUp == null ? null : isoDate(src.follow_up ?? src.followUp);
  if (!animalId) return { ok: false, error: "Choose the animal" };
  if (!date) return { ok: false, error: "Choose the day" };
  if (!vet) return { ok: false, error: "Name the vet" };
  if (!reason) return { ok: false, error: "Say why they came" };
  if ((src.follow_up || src.followUp) && !followUp) return { ok: false, error: "The follow-up date needs a day" };
  if (dairyWords(vet, reason, outcome)) return { ok: false, error: "The cows are never milked" };
  return { ok: true, visit: { animalId, date, vet, reason, outcome, followUp } };
}

function followUpLine(visits: VetVisit[], animalId: string, date: string): string | null {
  const pending = visits.filter(visit => {
    if (visit.animalId !== animalId || !visit.followUp || visit.followUp > date) return false;
    return !visits.some(other => other.animalId === animalId && other.date >= visit.followUp! && other.date !== visit.date);
  });
  if (!pending.length) return null;
  const next = [...pending].sort((a, b) => (a.followUp ?? "").localeCompare(b.followUp ?? ""))[0];
  return next.followUp === date ? "Follow-up due" : "Follow-up overdue";
}

export function todayBoard(input: { animals: CowProfile[]; days: DayLog[]; visits: VetVisit[]; date: string }): TodayCard[] {
  return input.animals.map(animal => {
    const day = input.days.find(row => row.animalId === animal.id && row.date === input.date);
    const done: string[] = [];
    const missing: string[] = [];
    if (day?.duty) done.push(`With them: ${day.duty}`);
    else missing.push("Who is with them");
    if (day?.feedWhat && day.feedWhen && day.feedAmount) done.push(`Fed: ${day.feedWhat}, ${day.feedAmount}, ${day.feedWhen}`);
    else missing.push("Feeding");
    if (day?.health) done.push(`Health: ${day.health}`);
    return {
      animalId: animal.id,
      name: animal.name,
      guestFacing: isGuestFacing(animal),
      done,
      missing,
      followUp: followUpLine(input.visits, animal.id, input.date),
    };
  });
}

function cell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

export function historyCsv(lines: HistoryLine[]): string {
  const header = ["date", "animal", "guest_facing", "duty", "feed_what", "feed_when", "feed_amount", "health", "vet", "reason", "outcome", "follow_up"];
  const rows = lines.map(line => [
    line.date,
    line.animal,
    line.guestFacing ? "yes" : "no",
    line.duty,
    line.feedWhat,
    line.feedWhen,
    line.feedAmount,
    line.health,
    line.vet,
    line.reason,
    line.outcome,
    line.followUp,
  ].map(cell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function historyLines(animals: CowProfile[], days: DayLog[], visits: VetVisit[]): HistoryLine[] {
  const nameOf = new Map(animals.map(animal => [animal.id, animal]));
  const fromDays: HistoryLine[] = days.map(day => {
    const animal = nameOf.get(day.animalId);
    return {
      date: day.date,
      animal: animal?.name ?? day.animalId,
      guestFacing: animal ? isGuestFacing(animal) : false,
      duty: day.duty,
      feedWhat: day.feedWhat,
      feedWhen: day.feedWhen,
      feedAmount: day.feedAmount,
      health: day.health,
      vet: "",
      reason: "",
      outcome: "",
      followUp: "",
    };
  });
  const fromVisits: HistoryLine[] = visits.map(visit => {
    const animal = nameOf.get(visit.animalId);
    return {
      date: visit.date,
      animal: animal?.name ?? visit.animalId,
      guestFacing: animal ? isGuestFacing(animal) : false,
      duty: "",
      feedWhat: "",
      feedWhen: "",
      feedAmount: "",
      health: "",
      vet: visit.vet,
      reason: visit.reason,
      outcome: visit.outcome,
      followUp: visit.followUp ?? "",
    };
  });
  return [...fromDays, ...fromVisits].sort((a, b) => b.date.localeCompare(a.date) || a.animal.localeCompare(b.animal));
}
