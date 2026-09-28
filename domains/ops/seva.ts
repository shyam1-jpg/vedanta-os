/** Seva and volunteer slots. Guests book from the stay link. A slot with no named supervisor is not bookable.
 *  Cow care never offers a staff-only animal. Kitchen help stays off food handling unless the house turns that on.
 */

import { animalForSlot, isGuestFacing, seedCows, slotVisibleToGuest, type CowKind } from "./cowCare.ts";

export type SevaKind = "kitchen_help" | "gardening" | "cow_care" | "other";

export type SevaActivity = {
  id: string;
  name: string;
  kind: SevaKind;
  description: string;
  location: string;
  durationMinutes: number;
  capacity: number;
  minAge: number;
  supervisorRole: string;
  safetyNotes: string;
  waiverRequired: boolean;
  waiverText: string;
  tasks: string[];
  active: boolean;
};

export type SevaAnimal = {
  id: string;
  name: string;
  audience: "guest" | "staff";
  note: string;
  guestFacing?: boolean;
  kind?: CowKind;
};

export type SevaSafety = {
  guestsVisitCowsWithStaff: boolean;
  kitchenFoodHandling: boolean;
  hygieneBriefingRequired: boolean;
};

export type SevaSlot = {
  id: string;
  activityId: string;
  date: string;
  start: string;
  end: string;
  capacity: number;
  supervisorName: string | null;
  animalId?: string | null;
};

export type SevaBooking = {
  personKey: string;
  slotId: string;
  firstName: string;
  status: "booked" | "waitlist" | "cancelled";
  date: string;
  start: string;
  end: string;
  animalId: string | null;
};

export const DEFAULT_SAFETY: SevaSafety = {
  guestsVisitCowsWithStaff: true,
  kitchenFoodHandling: false,
  hygieneBriefingRequired: true,
};

const FOOD_TASK = /cook|prep|chop|serv(e|ing) food|food handling|tasting/i;

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function minutes(clock: string): number {
  const match = String(clock).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockFrom(total: number): string {
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseSevaSafety(raw: unknown): SevaSafety {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const on = (value: unknown, fallback: boolean) => value === true || value === "true" ? true : value === false || value === "false" ? false : fallback;
  return {
    guestsVisitCowsWithStaff: on(src.guests_visit_cows_with_staff ?? src.guestsVisitCowsWithStaff, true),
    kitchenFoodHandling: on(src.kitchen_food_handling ?? src.kitchenFoodHandling, false),
    hygieneBriefingRequired: on(src.hygiene_briefing_required ?? src.hygieneBriefingRequired, true),
  };
}

export function seedActivities(): SevaActivity[] {
  return [
    {
      id: "kitchen-help",
      name: "Kitchen help",
      kind: "kitchen_help",
      description: "Help the kitchen without handling food.",
      location: "Kitchen",
      durationMinutes: 90,
      capacity: 4,
      minAge: 16,
      supervisorRole: "KITCHEN",
      safetyNotes: "Washing up and laying the buffet only. No food handling. Acknowledge the food hygiene briefing before the slot.",
      waiverRequired: false,
      waiverText: "",
      tasks: ["Washing up", "Laying the buffet"],
      active: true,
    },
    {
      id: "gardening",
      name: "Gardening",
      kind: "gardening",
      description: "Light work in the grounds with a member of staff.",
      location: "Grounds",
      durationMinutes: 90,
      capacity: 8,
      minAge: 16,
      supervisorRole: "GROUNDS",
      safetyNotes: "Closed shoes. Stay with the supervisor. Tools stay with staff.",
      waiverRequired: false,
      waiverText: "",
      tasks: ["Weeding", "Sweeping paths"],
      active: true,
    },
    {
      id: "cow-care",
      name: "Cow care",
      kind: "cow_care",
      description: "A supervised visit in the goshala.",
      location: "Goshala",
      durationMinutes: 45,
      capacity: 6,
      minAge: 18,
      supervisorRole: "GROUNDS",
      safetyNotes: "Guests only visit the cows with staff. Staff-only animals are never on the guest list.",
      waiverRequired: true,
      waiverText: "I will stay with the member of staff and I will not approach an animal that is marked staff only.",
      tasks: ["Visit with staff"],
      active: true,
    },
    {
      id: "hall-tidy",
      name: "Hall tidy",
      kind: "other",
      description: "An example activity the house can rename.",
      location: "Hall",
      durationMinutes: 45,
      capacity: 6,
      minAge: 16,
      supervisorRole: "FRONT",
      safetyNotes: "Stay in the hall. Ask staff before moving furniture.",
      waiverRequired: false,
      waiverText: "",
      tasks: ["Straighten chairs"],
      active: true,
    },
  ];
}

/** Placeholder names only. Real animal names belong in the local seed, not this repo. */
export function seedAnimals(): SevaAnimal[] {
  return seedCows().map(animal => ({
    id: animal.id,
    name: animal.name,
    audience: isGuestFacing(animal) ? "guest" as const : "staff" as const,
    note: animal.note,
    guestFacing: animal.guestFacing,
    kind: animal.kind,
  }));
}

export function animalGuestFacing(animal: SevaAnimal): boolean {
  return isGuestFacing({
    guestFacing: animal.guestFacing === true || (animal.guestFacing == null && animal.audience === "guest"),
    kind: animal.kind === "bull" ? "bull" : "cow",
  });
}

export function guestAnimals(animals: SevaAnimal[]): SevaAnimal[] {
  return animals.filter(animalGuestFacing);
}

export function sevaAnimalForSlot(kind: string, animals: SevaAnimal[], chosenId: string | null) {
  return animalForSlot(kind, animals.map(animal => ({
    id: animal.id,
    guestFacing: animalGuestFacing(animal),
    kind: animal.kind === "bull" || !animalGuestFacing(animal) && animal.audience === "staff" ? "bull" as const : "cow" as const,
  })), chosenId);
}

export function sevaSlotForGuest(animalId: string | null | undefined, animals: SevaAnimal[]): boolean {
  return slotVisibleToGuest(animalId, animals.map(animal => ({
    id: animal.id,
    guestFacing: animalGuestFacing(animal),
    kind: animal.kind === "bull" ? "bull" : animalGuestFacing(animal) ? "cow" : "bull",
  })));
}

export function kitchenTasks(activity: SevaActivity, safety: SevaSafety): string[] {
  const tasks = activity.tasks.length ? activity.tasks : ["Washing up", "Laying the buffet"];
  if (activity.kind !== "kitchen_help" || safety.kitchenFoodHandling) return tasks;
  return tasks.filter(task => !FOOD_TASK.test(task));
}

export function generateDailySlots(input: {
  activityId: string;
  from: string;
  to: string;
  start: string;
  durationMinutes: number;
  capacity: number;
}): Omit<SevaSlot, "supervisorName">[] {
  const startMin = minutes(input.start);
  if (startMin < 0) return [];
  const end = clockFrom(startMin + Math.max(15, input.durationMinutes));
  const slots: Omit<SevaSlot, "supervisorName">[] = [];
  let date = input.from;
  let guard = 0;
  while (date <= input.to && guard < 62) {
    slots.push({
      id: `${input.activityId}:${date}:${input.start}`,
      activityId: input.activityId,
      date,
      start: clockFrom(startMin),
      end,
      capacity: Math.max(1, input.capacity),
    });
    date = addDays(date, 1);
    guard += 1;
  }
  return slots;
}

function overlaps(a: { date: string; start: string; end: string }, b: { date: string; start: string; end: string }): boolean {
  if (a.date !== b.date) return false;
  return minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

export function slotBookable(supervisorName: string | null): { ok: true } | { ok: false; error: string } {
  if (!text(supervisorName, 80)) return { ok: false, error: "Unsupervised: not bookable" };
  return { ok: true };
}

export function bookSeva(input: {
  personKey: string;
  firstName: string;
  age: number | null;
  slot: SevaSlot;
  activity: SevaActivity;
  animals: SevaAnimal[];
  chosenAnimalId: string | null;
  existing: SevaBooking[];
  waiverAck: boolean;
  hygieneAck: boolean;
  safety: SevaSafety;
}): { ok: true; status: "booked" | "waitlist"; animalId: string | null } | { ok: false; error: string } {
  const open = slotBookable(input.slot.supervisorName);
  if (!open.ok) return open;
  if (input.activity.kind === "cow_care" && input.safety.guestsVisitCowsWithStaff && !text(input.slot.supervisorName, 80)) {
    return { ok: false, error: "Unsupervised: not bookable" };
  }
  const age = input.age == null ? null : Math.floor(Number(input.age));
  if (input.activity.minAge > 0 && (age == null || !Number.isFinite(age) || age < input.activity.minAge)) {
    return { ok: false, error: `This activity is from age ${input.activity.minAge}` };
  }
  if (input.activity.waiverRequired && !input.waiverAck) return { ok: false, error: "Please acknowledge the safety note" };
  if (input.activity.kind === "kitchen_help" && input.safety.hygieneBriefingRequired && !input.hygieneAck) {
    return { ok: false, error: "Please acknowledge the food hygiene briefing" };
  }
  if (input.activity.kind === "kitchen_help" && !input.safety.kitchenFoodHandling) {
    const blocked = input.activity.tasks.find(task => FOOD_TASK.test(task));
    if (blocked) return { ok: false, error: "Kitchen help is washing up and laying the buffet, not food handling" };
  }
  let animalId: string | null = null;
  if (input.slot.animalId && !sevaSlotForGuest(input.slot.animalId, input.animals)) {
    return { ok: false, error: "That animal is staff only and is never offered to guests" };
  }
  if (input.activity.kind === "cow_care") {
    const chosen = input.animals.find(animal => animal.id === input.chosenAnimalId);
    if (!chosen || !animalGuestFacing(chosen)) {
      return { ok: false, error: "That animal is staff only and is never offered to guests" };
    }
    animalId = chosen.id;
  }
  const mine = input.existing.filter(row => row.personKey === input.personKey && row.status !== "cancelled");
  const same = mine.find(row => row.slotId === input.slot.id);
  if (same) return { ok: true, status: same.status === "waitlist" ? "waitlist" : "booked", animalId: same.animalId };
  if (mine.some(row => overlaps(row, input.slot))) return { ok: false, error: "You already have a seva at that time" };
  const taken = input.existing.filter(row => row.slotId === input.slot.id && row.status === "booked").length;
  const status = taken >= input.slot.capacity ? "waitlist" : "booked";
  return { ok: true, status, animalId };
}

export function cancelSeva(existing: SevaBooking[], personKey: string, slotId: string): { bookings: SevaBooking[]; promoted: string | null } {
  const bookings = existing.map(row => ({ ...row }));
  const mine = bookings.find(row => row.personKey === personKey && row.slotId === slotId && row.status !== "cancelled");
  if (!mine) return { bookings, promoted: null };
  const wasBooked = mine.status === "booked";
  mine.status = "cancelled";
  if (!wasBooked) return { bookings, promoted: null };
  const next = bookings.find(row => row.slotId === slotId && row.status === "waitlist");
  if (!next) return { bookings, promoted: null };
  next.status = "booked";
  return { bookings, promoted: next.personKey };
}

export function sevaBriefingText(activity: SevaActivity, slot: SevaSlot, bookings: SevaBooking[]): string {
  const open = slotBookable(slot.supervisorName);
  if (!open.ok) return `${activity.name} · ${slot.start} · unsupervised: not bookable`;
  const count = bookings.filter(row => row.slotId === slot.id && row.status === "booked").length;
  const waiting = bookings.filter(row => row.slotId === slot.id && row.status === "waitlist").length;
  const tail = waiting ? ` · ${waiting} waiting` : "";
  return `${activity.name} · ${slot.start} · ${count} of ${slot.capacity} · ${slot.supervisorName}${tail}`;
}

export function welcomeSevaLines(activities: SevaActivity[], slots: SevaSlot[], bookings: SevaBooking[], personKey: string): string[] {
  return bookings
    .filter(row => row.personKey === personKey && row.status === "booked")
    .map(row => {
      const activity = activities.find(item => item.id === slots.find(slot => slot.id === row.slotId)?.activityId);
      return `${activity?.name ?? "Seva"} · ${row.date} · ${row.start}`;
    });
}
