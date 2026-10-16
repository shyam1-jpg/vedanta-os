import { slotMinutes } from './smart-rota.ts';
export type SheetShift = { id: string; user_id: string; name: string; department: string; date: string; start_time: string; end_time: string; break_minutes: number };
export type SheetPunch = { source?: 'phone_history'; id: string; user_id: string; name: string; department: string; clocked_in_at: string | Date; clocked_out_at: string | Date | null; break_minutes: number; approved_at: string | Date | null };
export function londonDate(at: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  const part = (t: string) => parts.find(p => p.type === t)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function punchMinutes(p: SheetPunch, now = Date.now()): number {
  const start = +new Date(p.clocked_in_at), end = p.clocked_out_at ? +new Date(p.clocked_out_at) : now;
  return Math.max(0, Math.round((end - start) / 60000) - Math.max(0, Number(p.break_minutes) || 0));
}
export function dailyTimesheets(shifts: SheetShift[], punches: SheetPunch[], now = Date.now()) {
  const groups = new Map<string, { user_id: string; date: string; name: string; departments: Set<string>; shifts: SheetShift[]; punches: SheetPunch[] }>();
  function group(user_id: string, date: string, name: string, department: string) {
    const key = user_id + ':' + date;
    let row = groups.get(key);
    if (!row) { row = { user_id, date, name, departments: new Set(), shifts: [], punches: [] }; groups.set(key, row); }
    if (department) row.departments.add(department);
    return row;
  }
  for (const s of shifts) group(s.user_id, s.date, s.name, s.department).shifts.push(s);
  for (const p of punches) group(p.user_id, londonDate(p.clocked_in_at), p.name, p.department).punches.push(p);
  return [...groups.values()].map(g => {
    const scheduled_minutes = g.shifts.reduce((n, s) => n + slotMinutes({ date: s.date, start: s.start_time, end: s.end_time, breakMinutes: s.break_minutes }), 0);
    const ordered = [...g.punches].sort((a, b) => +new Date(a.clocked_in_at) - +new Date(b.clocked_in_at));
    let overlap = false;
    for (let i = 1; i < ordered.length; i++) {
      const last = ordered.slice(0, i).some(p => +new Date(p.clocked_out_at ?? now) > +new Date(ordered[i].clocked_in_at));
      if (last) overlap = true;
    }
    const still_in = g.punches.some(p => !p.clocked_out_at);
    const invalid = g.punches.some(p => p.clocked_out_at && +new Date(p.clocked_out_at) < +new Date(p.clocked_in_at));
    const actual_minutes = g.punches.reduce((n, p) => n + punchMinutes(p, now), 0);
    const approved_minutes = g.punches.filter(p => p.approved_at && p.clocked_out_at).reduce((n, p) => n + punchMinutes(p, now), 0);
    const issues: string[] = [];
    const today = londonDate(new Date(now));
    if (scheduled_minutes && !g.punches.length && g.date < today) issues.push('missing_clock');
    if (!g.shifts.length) issues.push('unscheduled');
    if (still_in) issues.push('still_clocked_in');
    if (overlap) issues.push('overlapping_punches');
    if (invalid) issues.push('invalid_clock_pair');
    if (g.punches.some(p => p.source === 'phone_history')) issues.push('phone_history');
    if (g.punches.length && !still_in && Math.abs(actual_minutes - scheduled_minutes) >= 15) issues.push('hours_difference');
    return { id: g.user_id + ':' + g.date, user_id: g.user_id, date: g.date, name: g.name, departments: [...g.departments], scheduled_minutes, actual_minutes, approved_minutes, variance_minutes: actual_minutes - scheduled_minutes, break_minutes: g.punches.reduce((n,p) => n + Math.max(0,Number(p.break_minutes)||0),0), still_in, approved: !!g.punches.length && !still_in && g.punches.every(p => !!p.approved_at), issues, shifts: g.shifts, punches: ordered.map(p => ({ ...p, net_minutes: punchMinutes(p, now) })) };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}
