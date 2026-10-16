import { weekRange, MAX_WEEK_HOURS } from './workforce.ts';

export type RotaSlot = { id: string; userId: string | null; department: string; date: string; start: string; end: string; breakMinutes: number; position?: string };
export type RotaPerson = { id: string; name: string; departments: string[]; positions?: string[] };
export type TimeOff = { userId: string; from: string; to: string };
export type PlacementReason = 'overlap' | 'rest' | 'hours' | 'availability' | 'leave';
export const REST_HOURS = 11; // Planning guardrail, not an assessment of contractual/legal exceptions.

export function slotInterval(slot: Pick<RotaSlot, 'date' | 'start' | 'end'>): [number, number] {
  // Local wall-clock minutes: scheduling comparisons do not depend on the server timezone.
  const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const midnight = Date.parse(slot.date + 'T00:00:00Z') / 60000;
  const start = midnight + clock(slot.start);
  let end = midnight + clock(slot.end);
  if (end <= start) end += 1440;
  return [start, end];
}
export function slotMinutes(slot: Pick<RotaSlot, 'date' | 'start' | 'end' | 'breakMinutes'>): number {
  const [a, b] = slotInterval(slot);
  return Math.max(0, b - a - Math.max(0, slot.breakMinutes));
}

export function placementIssues(slot: RotaSlot, userId: string, assigned: RotaSlot[], unavailable: TimeOff[], leave: TimeOff[], options: { maxHours?: number; restHours?: number } = {}): PlacementReason[] {
  const issues: PlacementReason[] = [];
  const [start, end] = slotInterval(slot);
  // Overnight work also checks the second calendar day.
  const lastDay = new Date((end - 1) * 60000).toISOString().slice(0, 10);
  if (unavailable.some(x => x.userId === userId && x.from <= lastDay && x.to >= slot.date)) issues.push('availability');
  if (leave.some(x => x.userId === userId && x.from <= lastDay && x.to >= slot.date)) issues.push('leave');
  const own = assigned.filter(x => x.userId === userId && x.id !== slot.id);
  let overlap = false, rest = false;
  for (const other of own) {
    const [a, b] = slotInterval(other);
    if (start < b && end > a) overlap = true;
    else if (Math.min(Math.abs(start - b), Math.abs(a - end)) < (options.restHours ?? REST_HOURS) * 60) rest = true;
  }
  if (overlap) issues.push('overlap');
  if (rest) issues.push('rest');
  const week = weekRange(slot.date);
  const minutes = own.filter(x => x.date >= week.from && x.date <= week.to).reduce((n, x) => n + slotMinutes(x), 0) + slotMinutes(slot);
  if (minutes > (options.maxHours ?? MAX_WEEK_HOURS) * 60) issues.push('hours');
  return issues;
}

export function planOpenRota(open: RotaSlot[], people: RotaPerson[], assigned: RotaSlot[], unavailable: TimeOff[], leave: TimeOff[]) {
  const working = [...assigned];
  const assignments: { shiftId: string; userId: string; name: string; date: string; start: string; end: string; department: string; weekHours: number; reason: string }[] = [];
  const skipped: { shiftId: string; date: string; department: string; reasons: string[] }[] = [];
  const normalise = (s:string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const candidates = (slot: RotaSlot) => people.filter(p => p.departments.includes(slot.department) && (!slot.position?.trim() || (p.positions ?? []).some(title => normalise(title) === normalise(slot.position!))));
  // Prioritise the shifts with fewer eligible people, then date/time. Keep ties deterministic.
  const ordered = [...open].sort((a, b) => {
    const count = (s: RotaSlot) => candidates(s).filter(p => placementIssues(s, p.id, assigned, unavailable, leave).length === 0).length;
    return count(a) - count(b) || a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id);
  });
  for (const slot of ordered) {
    const pool = candidates(slot);
    const week = weekRange(slot.date);
    const minutes = (id: string) => working.filter(s => s.userId === id && s.date >= week.from && s.date <= week.to).reduce((n, s) => n + slotMinutes(s), 0);
    const eligible = pool.filter(p => placementIssues(slot, p.id, working, unavailable, leave).length === 0)
      .sort((a, b) => minutes(a.id) - minutes(b.id) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const pick = eligible[0];
    if (!pick) {
      const reasons = pool.length ? [...new Set(pool.flatMap(p => placementIssues(slot, p.id, working, unavailable, leave)))] : [people.some(p=>p.departments.includes(slot.department)) && slot.position?.trim() ? 'no_matching_position' : 'no_department_staff'];
      skipped.push({ shiftId: slot.id, date: slot.date, department: slot.department, reasons });
      continue;
    }
    working.push({ ...slot, userId: pick.id });
    assignments.push({ shiftId: slot.id, userId: pick.id, name: pick.name, date: slot.date, start: slot.start, end: slot.end, department: slot.department, weekHours: Math.round(minutes(pick.id) / 6) / 10, reason: 'Available, no clash, rest gap met; lowest planned weekly hours among eligible staff.' });
  }
  return { assignments, skipped };
}
