/** A guest report becomes a maintenance ticket. Routing, the general-manager copy,
 *  and fridge or freezer kitchen copies stay on the existing fault rules.
 */

import { isFoodSafetyEquipment, type FaultNotice, type FaultView } from "./fault.ts";

export const GUEST_CATEGORIES = [
  { code: "water", label: "Water or leak", route: "maintenance" },
  { code: "heating", label: "Heating", route: "maintenance" },
  { code: "electrics", label: "Electrics or lights", route: "maintenance" },
  { code: "furniture", label: "Furniture", route: "maintenance" },
  { code: "cleanliness", label: "Cleanliness", route: "housekeeping" },
  { code: "noise", label: "Noise", route: "front" },
  { code: "other", label: "Other", route: "front" },
] as const;

export type GuestCategory = (typeof GUEST_CATEGORIES)[number]["code"];
export type GuestUrgency = "wait" | "urgent";
export type GuestWords = "received" | "on it" | "fixed";

const HOUR = 60 * 60 * 1000;
const LIMIT = 4;
const URGENT_WORDS = /leak|flood|no heating|without heating|fire|smoke|gas|unsafe|safety/i;

export function guestCategory(code: string) {
  return GUEST_CATEGORIES.find(item => item.code === code) ?? null;
}

export function screenGuestReport(input: {
  description: string;
  room: string;
  category: string;
  enter: boolean | null;
  recent: { at: number; text: string }[];
  now: number;
}): { ok: true; description: string } | { ok: false; error: string } {
  const room = input.room.trim();
  if (!room) return { ok: false, error: "The room is missing" };
  if (!guestCategory(input.category)) return { ok: false, error: "Choose what sort of problem it is" };
  if (input.enter == null) return { ok: false, error: "Say whether staff may enter the room" };
  const description = input.description.trim().slice(0, 2000);
  if (description.length < 8) return { ok: false, error: "Say a little more about the problem" };
  if (/https?:\/\//i.test(description)) return { ok: false, error: "Leave out links" };
  if (/(.)\1{12,}/.test(description) || /viagra|crypto wallet/i.test(description)) return { ok: false, error: "That report cannot be sent" };
  const recent = input.recent.filter(row => input.now - row.at < HOUR);
  if (recent.length >= LIMIT) return { ok: false, error: "Please wait before sending another report" };
  if (recent.some(row => row.text.trim().toLowerCase() === description.toLowerCase())) {
    return { ok: false, error: "That report is already with the house" };
  }
  return { ok: true, description };
}

export function guestFaultDraft(input: {
  category: string;
  urgency: GuestUrgency;
  description: string;
  room: string;
  enter: boolean;
}): {
  title: string;
  description: string;
  department: "MAINTENANCE" | "HOUSEKEEPING" | "FRONT";
  priority: "NORMAL" | "URGENT" | "SAFETY";
  equipmentCategory: string | null;
  equipmentLabel: string | null;
  foodSafety: boolean;
  pingOnShift: boolean;
} {
  const category = guestCategory(input.category)!;
  const blob = `${category.label} ${input.description}`;
  const foodSafety = isFoodSafetyEquipment({ label: blob, name: blob });
  const safety = URGENT_WORDS.test(blob);
  const priority = safety ? "SAFETY" : input.urgency === "urgent" ? "URGENT" : "NORMAL";
  const department = category.route === "housekeeping" ? "HOUSEKEEPING" : category.route === "front" ? "FRONT" : "MAINTENANCE";
  const equipmentCategory = input.category === "water" ? "plumbing" : input.category === "electrics" ? "electrical" : input.category === "furniture" ? "furniture" : null;
  return {
    title: `${category.label}: ${input.description}`.slice(0, 140),
    description: `${input.description}\n\nStaff may enter the room: ${input.enter ? "yes" : "no"}.`,
    department,
    priority,
    equipmentCategory,
    equipmentLabel: foodSafety ? "fridge or freezer" : null,
    foodSafety,
    pingOnShift: safety || input.urgency === "urgent",
  };
}

export function guestStatus(ticketStatus: string): GuestWords {
  if (ticketStatus === "DONE") return "fixed";
  if (ticketStatus === "IN_PROGRESS" || ticketStatus === "WAITING_PARTS") return "on it";
  return "received";
}

export function followUpCopy(): string {
  return "Was this sorted? A short reply helps the house close it properly.";
}

export function urgentPing(view: FaultView, onShift: string[]): FaultNotice[] {
  const subject = `Urgent now · M-${view.number} — ${view.location}`;
  const body = `A guest has reported something that needs someone on shift.\n\n${view.description}\n\nWhere: ${view.location}`;
  const seen = new Set<string>();
  const notes: FaultNotice[] = [];
  for (const to of onShift) {
    const email = to.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    notes.push({ to: email, audience: "maintenance", subject, body });
  }
  return notes;
}
