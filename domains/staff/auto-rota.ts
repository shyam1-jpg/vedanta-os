/**
 * Build a rota from guest numbers and the editable staffing bands.
 * People are assigned with their own constraints. A shift nobody can take stays as a gap.
 */
import { addDaysIso, weekStartMonday } from "./payroll.ts";

/** When a shift is used. Office posts are weekdays. Housekeeping and reception also vary by day type. */
export type DayWhen = "always" | "weekday" | "weekend" | "changeover" | "midstay" | "changeover_or_weekend";

export type ShiftRule = {
  code: string;
  label: string;
  start: string;
  end: string;
  count: number;
  roleCodes: string[];
  kp: boolean;
  opener: boolean;
  breakMinutes?: number;
  note?: string;
  when?: DayWhen;
  /** Calendar months 1–12. Empty means the whole year. */
  months?: number[] | null;
};

export type GuestBand = {
  label: string;
  minGuests: number;
  maxGuests: number | null;
  /** Research suggestion, not the owner's pilot. */
  example?: boolean;
  shifts: ShiftRule[];
};

export type DepartmentStaffing = {
  department: string;
  placeholder: boolean;
  /** Non-kitchen defaults. The screen says "Example default: edit to match your team". */
  example?: boolean;
  /** Purchasing, finance/HR and sales: the same weekday hours whatever the guest count. */
  weekdayOffice?: boolean;
  basis?: string;
  sources?: string[];
  note?: string;
  bands: GuestBand[];
};

export type HouseRules = {
  normalWeekHours: number;
  hoursIncludeBreak: boolean;
  lateFinish: string;
  blockedNextStart: string;
  defaultBreakMinutes: number;
  maxConsecutiveDays: number;
  maxDaysPerWeek: number | null;
  groundsAcresMin: number;
  groundsAcresMax: number;
};

export const DEFAULT_HOUSE_RULES: HouseRules = {
  normalWeekHours: 40,
  hoursIncludeBreak: true,
  lateFinish: "21:00",
  blockedNextStart: "07:00",
  defaultBreakMinutes: 30,
  maxConsecutiveDays: 6,
  maxDaysPerWeek: 5,
  groundsAcresMin: 15,
  groundsAcresMax: 20,
};

export type RotaPerson = {
  userId: string;
  name: string;
  role: string;
  department: string;
  earliestStart: string | null;
  earliestByWeekday: Record<string, string>;
  latesOnly: boolean;
  latesFrom: string;
  neverKp: boolean;
  canDoKp: boolean;
  opensKitchen: boolean;
  maxHoursWeek: number | null;
  maxHoursMonth: number | null;
  normalWeekHours: number;
  maxDaysWeek: number | null;
  unavailableWeekdays: number[];
  unavailableDates: string[];
  monthHoursAlready: Record<string, number>;
  weekHoursAlready: Record<string, number>;
  workedDates: string[];
  previousShift: { date: string; end: string } | null;
};

export type PlannedShift = {
  date: string;
  department: string;
  code: string;
  label: string;
  start: string;
  end: string;
  breakMinutes: number;
  hours: number;
  userId: string | null;
  name: string | null;
  role: string | null;
  gap: boolean;
  gapReason: string | null;
  lieuHours: number;
  placeholder: boolean;
  note: string | null;
};

export function clockMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function rosteredHours(start: string, end: string, breakMinutes: number, includeBreak: boolean): number {
  let mins = clockMinutes(end) - clockMinutes(start);
  if (mins <= 0) mins += 24 * 60;
  if (!includeBreak) mins = Math.max(0, mins - breakMinutes);
  return Math.round((mins / 60) * 100) / 100;
}

export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function bandFor(bands: GuestBand[], guests: number): GuestBand | null {
  const matches = bands.filter(b => guests >= b.minGuests && (b.maxGuests == null || guests <= b.maxGuests));
  matches.sort((a, b) => b.minGuests - a.minGuests || ((a.maxGuests ?? 1e9) - (b.maxGuests ?? 1e9)));
  return matches[0] ?? null;
}

export type DayType = "changeover" | "midstay";

export function guestDays(input: {
  from: string;
  to: string;
  guests?: number;
  dayType?: DayType;
  days?: { date: string; guests: number; dayType?: DayType }[];
}): { date: string; guests: number; dayType: DayType }[] {
  const override = new Map((input.days ?? []).map(d => [d.date, d]));
  const out: { date: string; guests: number; dayType: DayType }[] = [];
  for (let date = input.from; date <= input.to; date = addDaysIso(date, 1)) {
    const day = override.get(date);
    out.push({
      date,
      guests: day ? Number(day.guests) : Number(input.guests ?? 0),
      dayType: day?.dayType ?? input.dayType ?? "midstay",
    });
  }
  return out;
}

export function shiftApplies(shift: ShiftRule, day: { date: string; dayType?: DayType }): boolean {
  const month = Number(day.date.slice(5, 7));
  if (shift.months && shift.months.length && !shift.months.includes(month)) return false;
  const when = shift.when ?? "always";
  const weekday = isoWeekday(day.date) <= 5;
  const changeover = day.dayType === "changeover";
  if (when === "weekday") return weekday;
  if (when === "weekend") return !weekday;
  if (when === "changeover") return changeover;
  if (when === "midstay") return !changeover;
  if (when === "changeover_or_weekend") return changeover || !weekday;
  return true;
}

export function resolvePerson(base: {
  userId: string;
  name: string;
  role: string;
  department: string;
  roleDefault?: { neverKp?: boolean; canDoKp?: boolean; opensKitchen?: boolean };
  saved?: {
    earliestStart?: string | null;
    earliestByWeekday?: Record<string, string>;
    latesOnly?: boolean;
    latesFrom?: string | null;
    neverKp?: boolean | null;
    canDoKp?: boolean | null;
    opensKitchen?: boolean | null;
    maxHoursWeek?: number | null;
    maxHoursMonth?: number | null;
    normalWeekHours?: number | null;
    maxDaysWeek?: number | null;
    unavailableWeekdays?: number[];
    unavailableDates?: string[];
  };
  house: HouseRules;
  monthHoursAlready?: Record<string, number>;
  weekHoursAlready?: Record<string, number>;
  workedDates?: string[];
  previousShift?: { date: string; end: string } | null;
}): RotaPerson {
  const roleDefault = base.roleDefault ?? {};
  const saved = base.saved ?? {};
  const porter = base.role === "KITCHEN_PORTER";
  return {
    userId: base.userId,
    name: base.name,
    role: base.role,
    department: base.department,
    earliestStart: saved.earliestStart ?? null,
    earliestByWeekday: saved.earliestByWeekday ?? {},
    latesOnly: !!saved.latesOnly,
    latesFrom: (saved.latesFrom || "12:00").slice(0, 5),
    neverKp: saved.neverKp ?? roleDefault.neverKp ?? !porter,
    canDoKp: saved.canDoKp ?? roleDefault.canDoKp ?? porter,
    opensKitchen: saved.opensKitchen ?? roleDefault.opensKitchen ?? false,
    maxHoursWeek: saved.maxHoursWeek ?? null,
    maxHoursMonth: saved.maxHoursMonth ?? null,
    normalWeekHours: saved.normalWeekHours ?? base.house.normalWeekHours,
    maxDaysWeek: saved.maxDaysWeek ?? base.house.maxDaysPerWeek,
    unavailableWeekdays: saved.unavailableWeekdays ?? [],
    unavailableDates: saved.unavailableDates ?? [],
    monthHoursAlready: base.monthHoursAlready ?? {},
    weekHoursAlready: base.weekHoursAlready ?? {},
    workedDates: base.workedDates ?? [],
    previousShift: base.previousShift ?? null,
  };
}

export function generateRota(input: {
  days: { date: string; guests: number; dayType?: DayType }[];
  rules: DepartmentStaffing[];
  people: RotaPerson[];
  house?: HouseRules;
}): { shifts: PlannedShift[]; warnings: string[] } {
  const house = input.house ?? DEFAULT_HOUSE_RULES;
  const warnings: string[] = [];
  const warned = new Set<string>();
  const weekHours = new Map<string, number>();
  const monthHours = new Map<string, number>();
  const worked = new Map<string, Set<string>>();
  const lastEnd = new Map<string, { date: string; end: string }>();
  const assigned = new Set<string>();
  for (const person of input.people) {
    worked.set(person.userId, new Set(person.workedDates));
    for (const [week, hours] of Object.entries(person.weekHoursAlready)) weekHours.set(`${person.userId}|${week}`, hours);
    for (const [month, hours] of Object.entries(person.monthHoursAlready)) monthHours.set(`${person.userId}|${month}`, hours);
    if (person.previousShift) lastEnd.set(person.userId, person.previousShift);
  }

  const shifts: PlannedShift[] = [];
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) {
    for (const rule of input.rules) {
      const band = bandFor(rule.bands, day.guests);
      if (!band) {
        warnings.push(`No guest band for ${rule.department} on ${day.date} (${day.guests} guests).`);
        continue;
      }
      if (band.example && !warned.has(`${rule.department}:band`)) {
        warnings.push(`${rule.department} ${band.label} is a research suggestion. Edit it to match your team.`);
        warned.add(`${rule.department}:band`);
      }
      for (const template of band.shifts) {
        if (!shiftApplies(template, day)) continue;
        const count = Math.max(0, template.count || 0);
        for (let i = 0; i < count; i++) {
          const breakMinutes = template.breakMinutes ?? house.defaultBreakMinutes;
          const hours = rosteredHours(template.start, template.end, breakMinutes, house.hoursIncludeBreak);
          const rejects = new Map<string, string>();
          const eligible = input.people.filter(person => {
            const reason = reject(person, rule.department, day.date, template, hours, house, weekHours, monthHours, worked, lastEnd, assigned);
            if (reason) { rejects.set(person.userId, reason); return false; }
            return true;
          });
          const weekKey = weekStartMonday(day.date);
          eligible.sort((a, b) => {
            const ah = weekHours.get(`${a.userId}|${weekKey}`) ?? 0;
            const bh = weekHours.get(`${b.userId}|${weekKey}`) ?? 0;
            return score(a, template, ah, worked) - score(b, template, bh, worked) || a.name.localeCompare(b.name);
          });
          const chosen = eligible[0] ?? null;
          let lieuHours = 0;
          if (chosen) {
            const week = weekStartMonday(day.date);
            const month = monthKey(day.date);
            const before = weekHours.get(`${chosen.userId}|${week}`) ?? 0;
            const after = Math.round((before + hours) * 100) / 100;
            const alreadyOver = Math.max(0, before - chosen.normalWeekHours);
            const nowOver = Math.max(0, after - chosen.normalWeekHours);
            lieuHours = Math.round((nowOver - alreadyOver) * 100) / 100;
            weekHours.set(`${chosen.userId}|${week}`, after);
            monthHours.set(`${chosen.userId}|${month}`, Math.round(((monthHours.get(`${chosen.userId}|${month}`) ?? 0) + hours) * 100) / 100);
            worked.get(chosen.userId)!.add(day.date);
            assigned.add(`${chosen.userId}|${day.date}`);
            const prev = lastEnd.get(chosen.userId);
            if (!prev || prev.date < day.date || (prev.date === day.date && clockMinutes(template.end) > clockMinutes(prev.end))) {
              lastEnd.set(chosen.userId, { date: day.date, end: template.end });
            }
          }
          if (rule.example && !warned.has(rule.department)) {
            warnings.push(`${rule.department}: Example default: edit to match your team.`);
            warned.add(rule.department);
          }
          shifts.push({
            date: day.date,
            department: rule.department,
            code: template.code,
            label: template.label,
            start: template.start.slice(0, 5),
            end: template.end.slice(0, 5),
            breakMinutes,
            hours,
            userId: chosen?.userId ?? null,
            name: chosen?.name ?? null,
            role: chosen?.role ?? null,
            gap: !chosen,
            gapReason: chosen ? null : gapReason(template, rule.department, input.people, rejects),
            lieuHours,
            placeholder: rule.placeholder,
            note: template.note ?? null,
          });
        }
      }
    }
  }
  return { shifts, warnings };
}

function reject(
  person: RotaPerson,
  department: string,
  date: string,
  shift: ShiftRule,
  hours: number,
  house: HouseRules,
  weekHours: Map<string, number>,
  monthHours: Map<string, number>,
  worked: Map<string, Set<string>>,
  lastEnd: Map<string, { date: string; end: string }>,
  assigned: Set<string>,
): string | null {
  if (person.department !== department) return "Different department";
  if (shift.kp && person.role !== "KITCHEN_PORTER" && person.role !== "KITCHEN_ASSISTANT") return "KA/KP shifts are for kitchen porters and kitchen assistants";
  if (shift.kp && (person.neverKp || !person.canDoKp)) return "This person does not do KP";
  if (shift.opener && !person.opensKitchen) return "Head chef or sous chef must open at 07:00";
  if (shift.roleCodes.length && !shift.roleCodes.includes(person.role)) return "This role does not cover the shift";
  const start = clockMinutes(shift.start);
  if (person.earliestStart && start < clockMinutes(person.earliestStart)) return "Starts before their earliest time";
  const dayEarliest = person.earliestByWeekday[String(isoWeekday(date))];
  if (dayEarliest && start < clockMinutes(dayEarliest)) return "Cannot start this early on this day of the week";
  if (person.latesOnly && start < clockMinutes(person.latesFrom)) return "Lates only";
  if (person.unavailableWeekdays.includes(isoWeekday(date))) return "Not available this day of the week";
  if (person.unavailableDates.includes(date)) return "Not available on this date";
  if (assigned.has(`${person.userId}|${date}`)) return "Already working that day";
  const prev = lastEnd.get(person.userId);
  if (prev && addDaysIso(prev.date, 1) === date && clockMinutes(prev.end) >= clockMinutes(house.lateFinish) && start <= clockMinutes(house.blockedNextStart)) {
    return "No 07:00 start after a late finish";
  }
  const week = weekStartMonday(date);
  const soFar = weekHours.get(`${person.userId}|${week}`) ?? 0;
  if (person.maxHoursWeek != null && soFar + hours > person.maxHoursWeek + 0.001) return "Over their weekly hour cap";
  const month = monthKey(date);
  const monthSoFar = monthHours.get(`${person.userId}|${month}`) ?? 0;
  if (person.maxHoursMonth != null && monthSoFar + hours > person.maxHoursMonth + 0.001) return "Over their monthly hour cap";
  const days = worked.get(person.userId) ?? new Set<string>();
  const weekCount = [...days].filter(d => weekStartMonday(d) === week).length;
  if (person.maxDaysWeek != null && !days.has(date) && weekCount >= person.maxDaysWeek) return "Already at their days this week";
  let streak = 0;
  for (let d = addDaysIso(date, -1); days.has(d); d = addDaysIso(d, -1)) streak += 1;
  if (streak >= house.maxConsecutiveDays) return "Would be more than 6 days in a row";
  return null;
}

function score(person: RotaPerson, shift: ShiftRule, weekHours: number, worked: Map<string, Set<string>>): number {
  let value = weekHours + (worked.get(person.userId)?.size ?? 0);
  if (shift.opener) {
    if (person.role === "HEAD_CHEF") value -= 40;
    else if (person.role === "SOUS_CHEF") value -= 30;
  } else if (!shift.kp && (person.role === "CHEF_DE_PARTIE" || person.role === "SENIOR_CHEF_DE_PARTIE")) value -= 8;
  if (shift.kp && person.latesOnly) value -= 20;
  if (shift.kp && person.earliestStart && clockMinutes(person.earliestStart) >= 600 && clockMinutes(shift.start) >= clockMinutes(person.earliestStart) && clockMinutes(shift.start) < clockMinutes(person.latesFrom || "12:00")) value -= 12;
  return value;
}

function gapReason(shift: ShiftRule, department: string, people: RotaPerson[], rejects: Map<string, string>): string {
  const inDept = people.filter(p => p.department === department);
  if (!inDept.length) return "No one in this department is on the rota yet";
  if (shift.kp && !inDept.some(p => (p.role === "KITCHEN_PORTER" || p.role === "KITCHEN_ASSISTANT") && !p.neverKp && p.canDoKp)) return "KA/KP shifts are for kitchen porters and kitchen assistants";
  if (shift.opener && !inDept.some(p => p.opensKitchen)) return "Head chef or sous chef must open at 07:00";
  const counts = new Map<string, number>();
  for (const person of inDept) {
    const reason = rejects.get(person.userId);
    if (!reason || reason === "Different department") continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? "No one fits this shift";
}

export function rotaToCsv(shifts: PlannedShift[]): string {
  const header = ["date", "department", "shift", "start", "end", "hours", "person", "gap", "gap_reason", "lieu_hours", "placeholder"];
  const lines = shifts.map(s => [
    s.date, s.department, s.label, s.start, s.end, s.hours, s.name ?? "", s.gap ? "GAP" : "", s.gapReason ?? "", s.lieuHours, s.placeholder ? "PLACEHOLDER" : "",
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\n") + "\n";
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function applyTemplate(current: Record<string, unknown>, template: Record<string, unknown>): Record<string, unknown> {
  return { ...current, ...template };
}
