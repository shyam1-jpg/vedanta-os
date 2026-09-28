/**
 * Starting staffing levels. The database is what the house edits.
 * These values are written once when the staffing table is empty.
 * Kitchen 16–35 guests follows the kitchen operating proposal.
 * Every other department is marked PLACEHOLDER for the head chef to change.
 */
import type { DepartmentStaffing, ShiftRule } from "./auto-rota.ts";

const CHEFS = ["HEAD_CHEF", "SOUS_CHEF", "CHEF_DE_PARTIE", "SENIOR_CHEF_DE_PARTIE", "KITCHEN_MANAGER"];
const PORTERS = ["KITCHEN_PORTER"];

function shift(code: string, label: string, start: string, end: string, count: number, roleCodes: string[], extra: Partial<ShiftRule> = {}): ShiftRule {
  return { code, label, start, end, count, roleCodes, kp: false, opener: false, breakMinutes: 30, ...extra };
}

const morning = shift("MORNING_CHEF", "Morning chef", "07:00", "16:00", 1, CHEFS, { opener: true, note: "Breakfast and lunch. Head chef or sous chef opens." });
const late = shift("LATE_CHEF", "Late chef", "12:00", "21:00", 1, CHEFS, { note: "Lunch overlap, dinner and close." });
const third = shift("THIRD_CHEF", "Third chef", "10:00", "18:00", 1, CHEFS, { note: "Added at 100 guests or more." });
const kpEarly = shift("KP_EARLY", "KP early", "07:00", "15:00", 1, PORTERS, { kp: true });
const kpLate = shift("KP_LATE", "KP late", "15:00", "22:00", 1, PORTERS, { kp: true });
const kpFloat = shift("KP_FLOAT", "KP float", "10:00", "18:00", 1, PORTERS, { kp: true, note: "The written rule adds a float above 40 guests." });

export const KITCHEN_PILOT_NOTE = "Kitchen operating proposal. 16–35 guests is the 4-week pilot: morning chef 07:00–16:00, late chef 12:00–21:00, KP early 07:00–15:00, KP late 15:00–22:00. A 21:00 finish is not followed by a 07:00 start.";

export const DEFAULT_STAFFING: DepartmentStaffing[] = [
  {
    department: "KITCHEN",
    placeholder: false,
    note: KITCHEN_PILOT_NOTE,
    bands: [
      { label: "0", minGuests: 0, maxGuests: 0, shifts: [] },
      { label: "1–15", minGuests: 1, maxGuests: 15, shifts: [morning, kpEarly] },
      { label: "16–35", minGuests: 16, maxGuests: 35, shifts: [morning, late, kpEarly, kpLate] },
      { label: "36–60", minGuests: 36, maxGuests: 60, shifts: [morning, late, kpEarly, kpLate, kpFloat] },
      { label: "61–100", minGuests: 61, maxGuests: 100, shifts: [morning, late, kpEarly, kpLate, kpFloat] },
      { label: "100+", minGuests: 100, maxGuests: null, shifts: [morning, late, third, kpEarly, kpLate, kpFloat] },
    ],
  },
  placeholder("HK", "Housekeeping", "PLACEHOLDER — confirm how many housekeepers per guest band.", [
    [0, 0, []],
    [1, 15, [n("HK_AM", "Housekeeping", "08:00", "16:00", 1, ["HK_ATTENDANT", "HK_SUPERVISOR"])]],
    [16, 35, [n("HK_AM", "Housekeeping", "08:00", "16:00", 2, ["HK_ATTENDANT", "HK_SUPERVISOR"])]],
    [36, 60, [n("HK_AM", "Housekeeping", "08:00", "16:00", 3, ["HK_ATTENDANT", "HK_SUPERVISOR"])]],
    [61, 100, [n("HK_AM", "Housekeeping", "08:00", "16:00", 4, ["HK_ATTENDANT", "HK_SUPERVISOR"])]],
    [100, null, [n("HK_AM", "Housekeeping", "08:00", "16:00", 5, ["HK_ATTENDANT", "HK_SUPERVISOR"])]],
  ]),
  placeholder("RESTAURANT", "Restaurant", "PLACEHOLDER — buffet only, food is never billed. Confirm service cover.", [
    [0, 0, []],
    [1, 15, [n("REST_DAY", "Restaurant day", "07:00", "16:00", 1, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"])]],
    [16, 35, [
      n("REST_DAY", "Restaurant day", "07:00", "16:00", 1, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
      n("REST_EVE", "Restaurant evening", "16:00", "22:00", 1, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
    ]],
    [36, 60, [
      n("REST_DAY", "Restaurant day", "07:00", "16:00", 2, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
      n("REST_EVE", "Restaurant evening", "16:00", "22:00", 2, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
    ]],
    [61, 100, [
      n("REST_DAY", "Restaurant day", "07:00", "16:00", 3, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
      n("REST_EVE", "Restaurant evening", "16:00", "22:00", 3, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
    ]],
    [100, null, [
      n("REST_DAY", "Restaurant day", "07:00", "16:00", 4, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
      n("REST_EVE", "Restaurant evening", "16:00", "22:00", 4, ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"]),
    ]],
  ]),
  placeholder("FRONT", "Front of house", "PLACEHOLDER — confirm reception cover per guest band.", [
    [0, 0, [n("FOH_DAY", "Reception", "07:00", "16:00", 1, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"])]],
    [1, 15, [n("FOH_DAY", "Reception", "07:00", "16:00", 1, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"])]],
    [16, 35, [
      n("FOH_DAY", "Reception", "07:00", "16:00", 1, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"]),
      n("FOH_EVE", "Reception evening", "16:00", "22:00", 1, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER", "NIGHT_PORTER"]),
    ]],
    [36, 60, [
      n("FOH_DAY", "Reception", "07:00", "16:00", 2, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"]),
      n("FOH_EVE", "Reception evening", "16:00", "22:00", 1, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER", "NIGHT_PORTER"]),
    ]],
    [61, 100, [
      n("FOH_DAY", "Reception", "07:00", "16:00", 2, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"]),
      n("FOH_EVE", "Reception evening", "16:00", "22:00", 2, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER", "NIGHT_PORTER"]),
    ]],
    [100, null, [
      n("FOH_DAY", "Reception", "07:00", "16:00", 3, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER"]),
      n("FOH_EVE", "Reception evening", "16:00", "22:00", 2, ["RECEPTIONIST", "FRONT_OFFICE_MANAGER", "NIGHT_PORTER"]),
    ]],
  ]),
  placeholder("GROUNDS", "Estate and grounds", "PLACEHOLDER — grounds work does not scale only with guests. Confirm the levels.", [
    [0, 0, [n("ESTATE", "Estate", "08:00", "16:00", 1, ["GROUNDS", "GROUNDS_ASSISTANT", "ESTATE_MANAGER", "ESTATE_ASSISTANT"])]],
    [1, 35, [n("ESTATE", "Estate", "08:00", "16:00", 2, ["GROUNDS", "GROUNDS_ASSISTANT", "ESTATE_MANAGER", "ESTATE_ASSISTANT"])]],
    [36, 100, [n("ESTATE", "Estate", "08:00", "16:00", 3, ["GROUNDS", "GROUNDS_ASSISTANT", "ESTATE_MANAGER", "ESTATE_ASSISTANT"])]],
    [100, null, [n("ESTATE", "Estate", "08:00", "16:00", 3, ["GROUNDS", "GROUNDS_ASSISTANT", "ESTATE_MANAGER", "ESTATE_ASSISTANT"])]],
  ]),
  placeholder("MAINT", "Maintenance", "PLACEHOLDER — confirm maintenance cover.", [
    [0, 60, [n("MAINT", "Maintenance", "08:00", "16:00", 1, ["MAINTENANCE"])]],
    [61, null, [n("MAINT", "Maintenance", "08:00", "16:00", 2, ["MAINTENANCE"])]],
  ]),
  placeholder("PROGRAMME", "Programmes and events", "PLACEHOLDER — confirm programme cover when guests are in.", [
    [0, 0, []],
    [1, null, [n("PROG", "Programmes", "10:00", "18:00", 1, ["PROGRAMME", "RETREAT_MANAGER"])]],
  ]),
];

function n(code: string, label: string, start: string, end: string, count: number, roleCodes: string[]): ShiftRule {
  return shift(code, label, start, end, count, roleCodes);
}

function placeholder(department: string, _name: string, note: string, rows: [number, number | null, ShiftRule[]][]): DepartmentStaffing {
  return {
    department,
    placeholder: true,
    note,
    bands: rows.map(([minGuests, maxGuests, shifts]) => ({
      label: maxGuests == null ? `${minGuests}+` : minGuests === maxGuests ? String(minGuests) : `${minGuests}–${maxGuests}`,
      minGuests,
      maxGuests,
      shifts,
    })),
  };
}

export const CONSTRAINT_TEMPLATES: { code: string; label: string; detail: string; body: Record<string, unknown> }[] = [
  { code: "never_kp", label: "Never KP", detail: "Head chef, sous chef and chefs de partie do not work kitchen porter shifts.", body: { neverKp: true, canDoKp: false } },
  { code: "opens_0700", label: "Opens at 07:00", detail: "Can open the kitchen. Head chef or sous chef.", body: { opensKitchen: true } },
  { code: "kp_earliest_1000", label: "KP earliest start 10:00", detail: "This kitchen porter does not start before 10:00.", body: { earliestStart: "10:00", canDoKp: true, neverKp: false } },
  { code: "kp_lates_only", label: "KP lates only", detail: "Afternoon and evening only. No early start.", body: { latesOnly: true, latesFrom: "12:00", canDoKp: true, neverKp: false } },
  { code: "cdp_mon_tue_from_1800", label: "From 18:00 on Monday and Tuesday", detail: "This chef de partie cannot start before 18:00 on Monday or Tuesday.", body: { earliestByWeekday: { "1": "18:00", "2": "18:00" }, neverKp: true, canDoKp: false } },
  { code: "student_kp_80h_month", label: "Student KP, 80 hours a month", detail: "Capped at 80 rostered hours in a calendar month.", body: { maxHoursMonth: 80, canDoKp: true, neverKp: false } },
];

export const ROLE_DEFAULTS: { role: string; neverKp: boolean; canDoKp: boolean; opensKitchen: boolean }[] = [
  { role: "HEAD_CHEF", neverKp: true, canDoKp: false, opensKitchen: true },
  { role: "SOUS_CHEF", neverKp: true, canDoKp: false, opensKitchen: true },
  { role: "KITCHEN_MANAGER", neverKp: true, canDoKp: false, opensKitchen: true },
  { role: "CHEF_DE_PARTIE", neverKp: true, canDoKp: false, opensKitchen: false },
  { role: "SENIOR_CHEF_DE_PARTIE", neverKp: true, canDoKp: false, opensKitchen: false },
  { role: "KITCHEN_ASSISTANT", neverKp: true, canDoKp: false, opensKitchen: false },
  { role: "KITCHEN_PORTER", neverKp: false, canDoKp: true, opensKitchen: false },
];
