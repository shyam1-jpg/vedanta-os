import { mayPublish } from "./suite.ts";

/** Weekly cap used by auto-schedule and by dragging a shift. A person never goes over this, across every department. */
export const MAX_WEEK_HOURS = 48;

/** The rotas the house publishes separately. A person can sit on more than one. */
export const ROTA_DEPARTMENTS = [
  { code: "KITCHEN", name: "Kitchen" },
  { code: "HK", name: "Housekeeping" },
  { code: "FRONT", name: "Front of house" },
  { code: "RESTAURANT", name: "Food and drink" },
  { code: "MAINT", name: "Maintenance" },
  { code: "GROUNDS", name: "Estate" },
] as const;

export function shiftHours(start: string, end: string, breakMinutes = 0): number {
  const mins = (t: string) => {
    const [h, m] = String(t ?? "0:0").slice(0, 5).split(":").map(n => Number(n) || 0);
    return h * 60 + m;
  };
  let span = mins(end) - mins(start);
  if (span <= 0) span += 24 * 60;
  const net = span - Math.max(0, breakMinutes || 0);
  return Math.max(0, Math.round(net / 6) / 10);
}

export type OpenShift = { id: string; department: string; date: string; hours: number };
export type SchedulePerson = { id: string; department: string; hours: number; unavailable: string[] };

/** Fill open shifts with the person in that department who has the fewest hours and stays under the cap.
 *  Hours are shared across departments, so someone on two rotas is not booked twice past the cap.
 */
export function suggestOpenShifts(shifts: OpenShift[], people: SchedulePerson[], maxHours = MAX_WEEK_HOURS): { shiftId: string; userId: string }[] {
  const hours = new Map<string, number>();
  for (const person of people) if (!hours.has(person.id)) hours.set(person.id, person.hours);
  const off = new Map<string, Set<string>>();
  for (const person of people) off.set(person.id, new Set(person.unavailable));
  const placed: { shiftId: string; userId: string }[] = [];
  for (const shift of shifts) {
    const pick = people
      .filter(p => p.department === shift.department && !off.get(p.id)?.has(shift.date) && (hours.get(p.id) ?? 0) + shift.hours <= maxHours + 0.001)
      .sort((a, b) => (hours.get(a.id) ?? 0) - (hours.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0];
    if (!pick) continue;
    hours.set(pick.id, Math.round(((hours.get(pick.id) ?? 0) + shift.hours) * 10) / 10);
    placed.push({ shiftId: shift.id, userId: pick.id });
  }
  return placed;
}

export type DropWarning = { code: "hours" | "availability" | "leave"; message: string };

/** A drag onto an open row is always fine. Over 48 hours is refused. Availability and leave still land, with a warning. */
export function assessDrop(input: {
  shiftId: string;
  hours: number;
  toUserId: string | null;
  copy: boolean;
  weekShifts: { id: string; userId: string; hours: number }[];
  unavailable: boolean;
  onLeave: boolean;
  maxHours?: number;
}): { allowed: boolean; warnings: DropWarning[] } {
  if (!input.toUserId) return { allowed: true, warnings: [] };
  const max = input.maxHours ?? MAX_WEEK_HOURS;
  const already = input.weekShifts
    .filter(s => s.userId === input.toUserId && (input.copy || s.id !== input.shiftId))
    .reduce((n, s) => n + s.hours, 0);
  const total = Math.round((already + input.hours) * 10) / 10;
  if (total > max + 0.001) {
    return { allowed: false, warnings: [{ code: "hours", message: `That is ${total} hours this week, across every department. The rota stops at ${max}.` }] };
  }
  const warnings: DropWarning[] = [];
  if (input.unavailable) warnings.push({ code: "availability", message: "They are marked unavailable this day." });
  if (input.onLeave) warnings.push({ code: "leave", message: "They have leave covering this day." });
  return { allowed: true, warnings };
}

export function weekRange(date: string): { from: string; to: string } {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

export function dateInRange(day: string, from: string, to: string): boolean {
  return day >= from.slice(0, 10) && day <= to.slice(0, 10);
}

export function mayPublishRota(perms: Iterable<string>): boolean {
  return mayPublish(perms);
}

/** Owner and GM approve any department. A head of department approves only their own. */
export function mayApproveDepartment(perms: Iterable<string>, actorDepartment: string | null, shiftDepartment: string): boolean {
  if (mayPublish(perms)) return true;
  const codes = new Set(perms);
  if (!codes.has("leave.approve_hod")) return false;
  return !!actorDepartment && actorDepartment === shiftDepartment;
}

/** Owner and GM publish every rota, including the all-departments overview. A head of department publishes only their own. */
export function mayPublishDepartment(perms: Iterable<string>, actorDepartment: string | null, department: string): boolean {
  if (mayPublish(perms)) return true;
  if (!department) return false;
  return mayApproveDepartment(perms, actorDepartment, department);
}

export function mayDragShift(perms: Iterable<string>, actorDepartment: string | null, shiftDepartment: string): boolean {
  return mayApproveDepartment(perms, actorDepartment, shiftDepartment);
}

export function mayBroadcast(perms: Iterable<string>): boolean {
  return mayPublish(perms);
}

/** Staff may write to a manager, or reply on a thread they already belong to. */
export function maySendMessage(perms: Iterable<string>, opts: { broadcast: boolean; reply: boolean; targetsAreManagers: boolean }): boolean {
  if (mayBroadcast(perms)) return true;
  if (opts.broadcast) return false;
  return opts.reply || opts.targetsAreManagers;
}
