/**
 * Back-office money for the house.
 * Income, supplier lines, clocked labour and guest numbers are the only inputs.
 * Nothing here invents a rate, a guest or a budget.
 */
import { addDaysIso, payFromHours, shiftsFromPunches, weekStartMonday } from "../staff/payroll.ts";
import type { Punch } from "../staff/hours.ts";

export const HOUSE_DEPARTMENTS = [
  { code: "HK", name: "Housekeeping" },
  { code: "RESTAURANT", name: "Restaurant" },
  { code: "FRONT", name: "Front of house" },
  { code: "RECEPTION", name: "Reception" },
  { code: "KITCHEN", name: "Kitchen" },
  { code: "KITCHEN_PORTER", name: "Kitchen porter" },
  { code: "GROUNDS", name: "Grounds" },
] as const;

export const BUILDING_DEPARTMENT = { code: "BUILDING", name: "General / building" } as const;
export const OTHER_DEPARTMENT = { code: "OTHER", name: "Other" } as const;

export const EXPENSE_DEPARTMENTS = [...HOUSE_DEPARTMENTS, BUILDING_DEPARTMENT] as const;

/** Regulars are the four shops Shyam named. The others can be picked. No contacts or ratings are stored here. */
export const REGULAR_SUPPLIERS = [
  { code: "BREAKS", name: "Breaks", regular: true },
  { code: "PILGRIMS", name: "Pilgrims", regular: true },
  { code: "SUMA", name: "Suma", regular: true },
  { code: "FRESH_FIELD", name: "Fresh from the Field", regular: true },
] as const;

export const PICK_SUPPLIERS = [
  { code: "TESCO", name: "Tesco", regular: false },
  { code: "SAINSBURYS", name: "Sainsbury's", regular: false },
  { code: "AMAZON", name: "Amazon", regular: false },
  { code: "SCREWFIX", name: "Screwfix", regular: false },
  { code: "BQ", name: "B&Q", regular: false },
] as const;

export const DEFAULT_SUPPLIERS = [...REGULAR_SUPPLIERS, ...PICK_SUPPLIERS] as const;

export type Period = "day" | "week" | "month" | "year";
export type ExpenseKind = "food" | "other";

const HOUSE_CODES = new Set<string>(HOUSE_DEPARTMENTS.map(d => d.code));
const EXPENSE_CODES = new Set<string>(EXPENSE_DEPARTMENTS.map(d => d.code));
const IN_HOUSE = new Set(["CONFIRMED", "IN_HOUSE", "COMPLETED"]);

/** An open clock-in with no clock-out is not a blank cheque. Sixteen hours is the cap. */
export const MAX_OPEN_SHIFT_HOURS = 16;

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isExpenseDepartment(code: string): boolean {
  return EXPENSE_CODES.has(code);
}

export function isHouseDepartment(code: string): boolean {
  return HOUSE_CODES.has(code);
}

export function departmentName(code: string): string {
  return [...EXPENSE_DEPARTMENTS, OTHER_DEPARTMENT].find(d => d.code === code)?.name ?? code;
}

/** Receptionists and kitchen porters keep their own cost bucket even when the membership says Front or Kitchen. */
export function departmentForStaff(role: string, department: string | null | undefined): string {
  if (role === "KITCHEN_PORTER") return "KITCHEN_PORTER";
  if (role === "RECEPTIONIST") return "RECEPTION";
  if (department && (HOUSE_CODES.has(department) || department === "BUILDING")) return department;
  return "OTHER";
}

export function supplierCodeFromName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 16);
  return base || "SUPPLIER";
}

export function sortSuppliers<T extends { code: string; name: string; regular?: boolean; score?: number | null }>(items: T[]): T[] {
  const regularOrder = new Map(REGULAR_SUPPLIERS.map((s, i) => [s.code, i]));
  return [...items].sort((a, b) => {
    const ar = Boolean(a.regular) || regularOrder.has(a.code);
    const br = Boolean(b.regular) || regularOrder.has(b.code);
    if (ar !== br) return ar ? -1 : 1;
    if (ar && br) return (regularOrder.get(a.code) ?? 99) - (regularOrder.get(b.code) ?? 99);
    const as = a.score == null ? null : a.score;
    const bs = b.score == null ? null : b.score;
    if (as != null && bs != null && as !== bs) return bs - as;
    if (as != null && bs == null) return -1;
    if (as == null && bs != null) return 1;
    return a.name.localeCompare(b.name, "en-GB");
  });
}

export function periodBounds(anchor: string, period: Period): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error("anchor must be YYYY-MM-DD");
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") {
    const from = weekStartMonday(anchor);
    return { from, to: addDaysIso(from, 6) };
  }
  const [y, m] = anchor.split("-").map(Number);
  if (period === "month") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export function daysInMonth(isoMonth: string): number {
  const [y, m] = isoMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type Stay = { arrival: string; departure: string; guests: number; status?: string };

export function guestsOnDate(stays: Stay[], date: string): number {
  return stays.reduce((n, s) => {
    if (s.status && !IN_HOUSE.has(s.status)) return n;
    if (s.arrival <= date && s.departure > date) return n + Math.max(0, s.guests || 0);
    return n;
  }, 0);
}

export function guestNights(stays: Stay[], from: string, to: string): { nights: number; peak: number } {
  let nights = 0;
  let peak = 0;
  for (const date of datesInRange(from, to)) {
    const g = guestsOnDate(stays, date);
    nights += g;
    if (g > peak) peak = g;
  }
  return { nights, peak };
}

export type MonthBudget = { year: number; month: number; department: string; amount: number };

/** A monthly goal spread evenly across the days of that month which fall inside the range. */
export function budgetForRange(budgets: MonthBudget[], from: string, to: string, department: string): number | null {
  const daysByMonth = new Map<string, number>();
  for (const date of datesInRange(from, to)) {
    const key = date.slice(0, 7);
    daysByMonth.set(key, (daysByMonth.get(key) ?? 0) + 1);
  }
  let seen = false;
  let total = 0;
  for (const [key, days] of daysByMonth) {
    const [year, month] = key.split("-").map(Number);
    const row = budgets.find(b => b.year === year && b.month === month && b.department === department);
    if (!row) continue;
    seen = true;
    total += row.amount * (days / daysInMonth(key));
  }
  return seen ? money(total) : null;
}

export type StaffingPlan = { guestCount: number; department: string; required: number };

/**
 * Use the plan written for this exact guest count.
 * Otherwise the smallest plan at or above the house, or the largest plan if the house is fuller than every plan.
 */
export function planGuestCount(plans: { guestCount: number }[], guests: number): number | null {
  const counts = [...new Set(plans.map(p => p.guestCount))].sort((a, b) => a - b);
  if (!counts.length || !(guests >= 0)) return null;
  if (counts.includes(guests)) return guests;
  return counts.find(c => c >= guests) ?? counts[counts.length - 1];
}

export function requiredFor(plans: StaffingPlan[], guests: number, department: string): { planFor: number | null; required: number | null } {
  const planFor = planGuestCount(plans, guests);
  if (planFor == null) return { planFor: null, required: null };
  const row = plans.find(p => p.guestCount === planFor && p.department === department);
  return { planFor, required: row ? row.required : null };
}

export type ClosedHours = { hours: number; open: boolean; capped: boolean };

export function shiftHours(inAt: Date, outAt: Date | null, now: Date): ClosedHours {
  if (outAt) {
    const hours = Math.round(Math.max(0, +outAt - +inAt) / 36_000) / 100;
    return { hours, open: false, capped: false };
  }
  const raw = Math.max(0, (+now - +inAt) / 3_600_000);
  const capped = raw > MAX_OPEN_SHIFT_HOURS;
  return { hours: Math.round(Math.min(raw, MAX_OPEN_SHIFT_HOURS) * 100) / 100, open: true, capped };
}

export type LabourPerson = { userId: string; role: string; department: string | null; hourlyRate: number | null };

export type LabourLine = {
  userId: string;
  department: string;
  date: string;
  hours: number;
  cost: number | null;
  open: boolean;
  capped: boolean;
};

export function labourFromPunches(people: LabourPerson[], punches: (Punch & { userId: string })[], now = new Date()): LabourLine[] {
  const byUser = new Map<string, Punch[]>();
  for (const p of punches) {
    const list = byUser.get(p.userId) ?? [];
    list.push({ kind: p.kind, at: p.at });
    byUser.set(p.userId, list);
  }
  const lines: LabourLine[] = [];
  for (const person of people) {
    const shifts = shiftsFromPunches(byUser.get(person.userId) ?? [], now);
    const bucket = departmentForStaff(person.role, person.department);
    for (const shift of shifts) {
      const timed = shiftHours(shift.inAt, shift.outAt, now);
      const cost = person.hourlyRate == null ? null : payFromHours(timed.hours, person.hourlyRate);
      lines.push({
        userId: person.userId,
        department: bucket,
        date: londonDate(shift.inAt),
        hours: timed.hours,
        cost,
        open: timed.open,
        capped: timed.capped,
      });
    }
  }
  return lines;
}

export type IncomeLine = { date: string; amount: number };
export type ExpenseLine = { date: string; amount: number; department: string; kind: ExpenseKind };

export type MoneyPoint = { key: string; label: string; moneyIn: number; moneyOut: number };
export type DepartmentMoney = {
  code: string;
  name: string;
  supplier: number;
  labour: number;
  spend: number;
  budget: number | null;
  variance: number | null;
};

export type MoneyView = {
  from: string;
  to: string;
  period: Period;
  moneyIn: number;
  moneyOut: number;
  supplierSpend: number;
  foodSpend: number;
  otherSpend: number;
  labourCost: number;
  unratedHours: number;
  openShiftsCapped: number;
  guestNights: number;
  peakGuests: number;
  guestsInHouse: number;
  costPerGuest: number | null;
  profit: number;
  breakEvenRevenue: number;
  shortOfBreakEven: number;
  aboveBreakEven: boolean;
  breakEvenGuests: number | null;
  departments: DepartmentMoney[];
  series: MoneyPoint[];
};

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function monthLabel(key: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(key.slice(5, 7)) - 1] ?? key;
}

function dayLabel(period: Period, date: string): string {
  if (period === "day") return "This day";
  if (period === "week") {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  }
  return String(Number(date.slice(8, 10)));
}

export function buildMoneyView(input: {
  anchor: string;
  period: Period;
  income: IncomeLine[];
  expenses: ExpenseLine[];
  labour: LabourLine[];
  stays: Stay[];
  budgets: MonthBudget[];
}): MoneyView {
  const { from, to } = periodBounds(input.anchor, input.period);
  const income = input.income.filter(r => inRange(r.date, from, to));
  const expenses = input.expenses.filter(r => inRange(r.date, from, to));
  const labour = input.labour.filter(r => inRange(r.date, from, to));
  const moneyIn = money(income.reduce((n, r) => n + r.amount, 0));
  const supplierSpend = money(expenses.reduce((n, r) => n + r.amount, 0));
  const foodSpend = money(expenses.filter(r => r.kind === "food").reduce((n, r) => n + r.amount, 0));
  const otherSpend = money(expenses.filter(r => r.kind === "other").reduce((n, r) => n + r.amount, 0));
  const labourCost = money(labour.reduce((n, r) => n + (r.cost ?? 0), 0));
  const unratedHours = money(labour.filter(r => r.cost == null).reduce((n, r) => n + r.hours, 0));
  const openShiftsCapped = labour.filter(r => r.capped).length;
  const moneyOut = money(supplierSpend + labourCost);
  const guests = guestNights(input.stays, from, to);
  const guestsInHouse = input.period === "day" ? guestsOnDate(input.stays, from) : guests.peak;
  const denominator = input.period === "day" ? guestsInHouse : guests.nights;
  const costPerGuest = denominator > 0 ? money(moneyOut / denominator) : null;
  const profit = money(moneyIn - moneyOut);
  const incomePerGuest = denominator > 0 && moneyIn > 0 ? moneyIn / denominator : null;
  const codes = [...HOUSE_DEPARTMENTS.map(d => d.code), BUILDING_DEPARTMENT.code, OTHER_DEPARTMENT.code];
  const departments: DepartmentMoney[] = codes.map(code => {
    const supplier = money(expenses.filter(r => r.department === code).reduce((n, r) => n + r.amount, 0));
    const labourAmount = money(labour.filter(r => r.department === code).reduce((n, r) => n + (r.cost ?? 0), 0));
    const spend = money(supplier + labourAmount);
    const budget = code === "OTHER" ? null : budgetForRange(input.budgets, from, to, code);
    const keep = spend > 0 || budget != null || code !== "OTHER";
    return {
      code,
      name: departmentName(code),
      supplier,
      labour: labourAmount,
      spend,
      budget,
      variance: budget == null ? null : money(budget - spend),
      keep,
    };
  }).filter(d => d.keep).map(({ keep: _keep, ...d }) => d);

  const series: MoneyPoint[] = input.period === "year"
    ? Array.from({ length: 12 }, (_, i) => {
      const key = `${from.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`;
      const moneyInPoint = money(income.filter(r => r.date.startsWith(key)).reduce((n, r) => n + r.amount, 0));
      const supplierPoint = expenses.filter(r => r.date.startsWith(key)).reduce((n, r) => n + r.amount, 0);
      const labourPoint = labour.filter(r => r.date.startsWith(key)).reduce((n, r) => n + (r.cost ?? 0), 0);
      return { key, label: monthLabel(key), moneyIn: moneyInPoint, moneyOut: money(supplierPoint + labourPoint) };
    })
    : datesInRange(from, to).map(date => {
      const moneyInPoint = money(income.filter(r => r.date === date).reduce((n, r) => n + r.amount, 0));
      const supplierPoint = expenses.filter(r => r.date === date).reduce((n, r) => n + r.amount, 0);
      const labourPoint = labour.filter(r => r.date === date).reduce((n, r) => n + (r.cost ?? 0), 0);
      return { key: date, label: dayLabel(input.period, date), moneyIn: moneyInPoint, moneyOut: money(supplierPoint + labourPoint) };
    });

  return {
    from,
    to,
    period: input.period,
    moneyIn,
    moneyOut,
    supplierSpend,
    foodSpend,
    otherSpend,
    labourCost,
    unratedHours,
    openShiftsCapped,
    guestNights: guests.nights,
    peakGuests: guests.peak,
    guestsInHouse,
    costPerGuest,
    profit,
    breakEvenRevenue: moneyOut,
    shortOfBreakEven: money(Math.max(0, moneyOut - moneyIn)),
    aboveBreakEven: moneyIn >= moneyOut,
    breakEvenGuests: incomePerGuest ? money(moneyOut / incomePerGuest) : null,
    departments,
    series,
  };
}
