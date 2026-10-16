import { mayPublish } from "./suite.ts";

/** Weekly cap used by auto-schedule. A suggestion never places someone over this. */
export const MAX_WEEK_HOURS = 48;

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

/** Fill open shifts with the person in that department who has the fewest hours and stays under the cap. */
export function suggestOpenShifts(shifts: OpenShift[], people: SchedulePerson[], maxHours = MAX_WEEK_HOURS): { shiftId: string; userId: string }[] {
  const loads = people.map(p => ({ ...p, hours: p.hours, off: new Set(p.unavailable) }));
  const placed: { shiftId: string; userId: string }[] = [];
  for (const shift of shifts) {
    const pick = loads
      .filter(p => p.department === shift.department && !p.off.has(shift.date) && p.hours + shift.hours <= maxHours + 0.001)
      .sort((a, b) => a.hours - b.hours || a.id.localeCompare(b.id))[0];
    if (!pick) continue;
    pick.hours = Math.round((pick.hours + shift.hours) * 10) / 10;
    placed.push({ shiftId: shift.id, userId: pick.id });
  }
  return placed;
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

export function mayBroadcast(perms: Iterable<string>): boolean {
  return mayPublish(perms);
}

/** Staff may write to a manager, or reply on a thread they already belong to. */
export function maySendMessage(perms: Iterable<string>, opts: { broadcast: boolean; reply: boolean; targetsAreManagers: boolean }): boolean {
  if (mayBroadcast(perms)) return true;
  if (opts.broadcast) return false;
  return opts.reply || opts.targetsAreManagers;
}
