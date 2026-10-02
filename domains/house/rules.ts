/** House-desk rules. These functions do not invent readings, stays, prices, or messages. */

export const ONION_FAMILY = ["onion", "garlic", "spring onion", "leek", "chives", "shallot", "scallion"];
export const HARI_REMINDER = "Guests and visitors must never go near Hari (male, the bull). Staff only. Lakshmi is female, the gentle cow. Visits and seva stay supervised. Neither animal is milked and there is no dairy.";
export const FORAGE_WARNING = "This log does not identify plants or mushrooms and does not mean they are safe to eat.";
export const MOBILE_KEY = "Mobile key is unavailable. The house has no lock hardware connected.";
export const CHANNELS_NOT_CONNECTED = "Nothing is connected to Booking.com or Airbnb. This list is not sent anywhere. A connection appears here only after real account credentials are added later.";

const FORBIDDEN = [...ONION_FAMILY, "egg", "eggs"];

export function breaksDiet(text: string): string | null {
  const hay = text.toLowerCase();
  for (const word of FORBIDDEN) {
    const re = new RegExp(`\\b${word.replace(" ", "\\s+")}\\b`, "i");
    if (re.test(hay)) return word;
  }
  return null;
}

export function isOnionFamilyCrop(name: string): boolean {
  return ONION_FAMILY.some(word => new RegExp(`\\b${word.replace(" ", "\\s+")}\\b`, "i").test(name));
}

export type NightHold = { exclusive: boolean; rooms: number };

export function nightFill(sellable: number, holds: NightHold[]): "free" | "part" | "blocked" | "unknown" {
  if (!(sellable > 0)) return "unknown";
  if (holds.some(h => h.exclusive)) return "blocked";
  const rooms = holds.reduce((n, h) => n + Math.max(0, h.rooms), 0);
  if (rooms >= sellable) return "blocked";
  if (rooms > 0) return "part";
  return "free";
}

export function canHoldDate(sellable: number, existing: NightHold[], incoming: NightHold): boolean {
  if (!(sellable > 0)) return false;
  return nightFill(sellable, [...existing, incoming]) !== "blocked";
}

export function photoForDay(picks: { on: string; photoId: string }[], day: string): string | null {
  return picks.find(p => p.on === day)?.photoId ?? null;
}

export type JournalEntry = { ownerId: string; shareStaff: boolean; shareGuests: boolean; bookingId: string };

export function canReadJournal(entry: JournalEntry, viewer: { kind: "guest" | "staff"; id?: string; bookingId?: string }): boolean {
  if (viewer.bookingId && viewer.bookingId !== entry.bookingId) return false;
  if (viewer.kind === "guest" && viewer.id === entry.ownerId) return true;
  if (!entry.shareStaff && !entry.shareGuests) return false;
  if (viewer.kind === "staff") return entry.shareStaff;
  if (viewer.kind === "guest" && viewer.id !== entry.ownerId) return entry.shareGuests;
  return false;
}

export function carbonTotal(input: { amount: number; factor: number | null }[]): { total: number | null; labelled: "manager factor" | null } {
  if (input.some(row => row.factor == null)) return { total: null, labelled: null };
  if (!input.length) return { total: null, labelled: null };
  const total = Math.round(input.reduce((n, row) => n + row.amount * (row.factor as number), 0) * 1000) / 1000;
  return { total, labelled: "manager factor" };
}

export function laterIsLower(earlier: number | null, later: number | null): boolean {
  return earlier != null && later != null && later < earlier;
}

export function nextDueFrom(lastCompleted: string | null, everyMonths: number): string | null {
  if (!lastCompleted || !(everyMonths > 0)) return null;
  const [y, m, d] = lastCompleted.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + everyMonths, d));
  return dt.toISOString().slice(0, 10);
}

export function firstAidNext(lastSignOff: string | null): string | null {
  if (!lastSignOff) return null;
  const [y, m, d] = lastSignOff.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 7));
  return dt.toISOString().slice(0, 10);
}

export function renewalDue(expiry: string, today: string): boolean {
  const [y, m, d] = expiry.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const now = new Date(today + "T00:00:00Z");
  return (+end - +now) / 86400000 <= 30;
}

export function rateNudge(input: { occupancyPct: number; threshold: number | null; currentRate: number | null; nudge: number | null }): { suggest: number | null; reason: string } {
  if (input.threshold == null) return { suggest: null, reason: "No occupancy threshold has been set" };
  if (input.currentRate == null) return { suggest: null, reason: "No rate is stored for this date" };
  if (input.nudge == null) return { suggest: null, reason: "No nudge has been set" };
  if (input.occupancyPct < input.threshold) return { suggest: null, reason: "Occupancy is under the threshold" };
  return { suggest: Math.round((input.currentRate + input.nudge) * 100) / 100, reason: "Occupancy crossed the threshold a manager set" };
}

export function buyNeedsApproval(amount: number, limit: number | null): boolean {
  return limit != null && amount > limit;
}

export function moneyOutOnce(parts: { supplier: number; labour: number; pettySpent: number; placedOrders: number }): number {
  return Math.round((parts.supplier + parts.labour + parts.pettySpent + parts.placedOrders) * 100) / 100;
}

export function loyaltyBalance(entries: number[]): number | null {
  if (!entries.length) return null;
  return entries.reduce((n, x) => n + x, 0);
}

export function gapDays(departure: string, nextArrival: string | null): string[] {
  if (!nextArrival || nextArrival <= departure) return [];
  const out: string[] = [];
  for (let d = departure; d < nextArrival; d = addDay(d)) out.push(d);
  return out;
}

export function outdoorRequest(text: string): boolean {
  return /\b(bonfire|outside|outdoor|garden|grounds|lake|walk|fire|field|farm)\b/i.test(text);
}

export function herdSeed(): { name: string; sex: "male" | "female"; kind: string }[] {
  return [
    { name: "Hari", sex: "male", kind: "bull" },
    { name: "Lakshmi", sex: "female", kind: "cow" },
  ];
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
