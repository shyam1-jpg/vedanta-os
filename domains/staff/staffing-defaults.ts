/**
 * Starting staffing levels. The database is what the house edits.
 * domains/staff/staffing-example.json is the research-backed example (28 Sep 2026).
 * Kitchen 16–35 guests is the owner's pilot, not that suggestion.
 * Every other department is an example default the house can change.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DayWhen, DepartmentStaffing, GuestBand, ShiftRule } from "./auto-rota.ts";

export const EXAMPLE_BANNER = "Example default: edit to match your team";
export const STAFFING_SEED = "2026-09-28-research";
export const KITCHEN_PILOT_NOTE = "Owner's pilot for 30–35 guests (the 16–35 band): morning chef 07:00–16:00, late chef 12:00–21:00, KA/KP 07:00–15:00 and 15:00–22:00, plus relief/float 10:00–19:00. Other kitchen bands are a research suggestion. Below 36 guests the late KA/KP also washes the restaurant crockery. A 21:00 finish is not followed by a 07:00 start.";

const CHEFS = ["HEAD_CHEF", "SOUS_CHEF", "CHEF_DE_PARTIE", "SENIOR_CHEF_DE_PARTIE", "KITCHEN_MANAGER"];
const WASH = ["KITCHEN_PORTER", "KITCHEN_ASSISTANT"];
const KITCHEN_ANY = [...CHEFS, ...WASH, "KITCHEN"];
const REST = ["RESTAURANT_STAFF", "RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"];
const REST_LEAD = ["RESTAURANT_SUPERVISOR", "RESTAURANT_MANAGER"];
const HK = ["HK_ATTENDANT", "HK_SUPERVISOR"];
const FRONT = ["RECEPTIONIST", "FRONT_OFFICE_MANAGER", "NIGHT_PORTER"];
const GROUNDS = ["GROUNDS", "GROUNDS_ASSISTANT", "GROUNDS_MANAGER", "ESTATE_MANAGER", "ESTATE_ASSISTANT", "ESTATE_MGMT_ASSISTANT"];
const MAINT = ["MAINTENANCE"];
const PROGRAMME = ["PROGRAMME", "RETREAT_MANAGER"];
const PURCHASING = ["PURCHASING"];
const FINANCE = ["FINANCE_HR"];
const SALES = ["SALES_MANAGER", "SALES_ASSISTANT"];
const MGMT = ["GENERAL_MANAGER", "OPERATIONS_MANAGER", "ROTA_MANAGER"];

type RawShift = { name: string; start: string; end: string; count: number };
type RawBand = { min: number; max: number | null; shifts: RawShift[] };
type RawDept = { label: string; bands: RawBand[]; basis: string; notes?: string; sources?: string[] };

const DEPT: Record<string, { code: string; weekdayOffice?: boolean }> = {
  restaurant: { code: "RESTAURANT" },
  housekeeping: { code: "HK" },
  front_of_house: { code: "FRONT" },
  maintenance: { code: "MAINT" },
  estate_grounds: { code: "GROUNDS" },
  programmes_events: { code: "PROGRAMME" },
  purchasing_stores: { code: "PURCHASING", weekdayOffice: true },
  finance_hr: { code: "FINANCE", weekdayOffice: true },
  sales: { code: "SALES", weekdayOffice: true },
  management: { code: "MGMT" },
  kitchen_SUGGESTION: { code: "KITCHEN" },
};

function shift(partial: Partial<ShiftRule> & Pick<ShiftRule, "code" | "label" | "start" | "end" | "count" | "roleCodes">): ShiftRule {
  return { when: "always", breakMinutes: 30, kp: false, opener: false, ...partial };
}

function classify(name: string, band: RawBand): Partial<ShiftRule> & Pick<ShiftRule, "code" | "roleCodes"> {
  const below36 = band.max != null && band.max < 36;
  if (name.startsWith("Morning chef")) return { code: "MORNING_CHEF", roleCodes: CHEFS, opener: true, note: "Breakfast and lunch. Head chef or sous chef opens." };
  if (name.startsWith("Late chef")) return { code: "LATE_CHEF", roleCodes: CHEFS, note: "Lunch overlap, dinner and close." };
  if (name.startsWith("KA/KP early")) return { code: "KP_EARLY", roleCodes: WASH, kp: true };
  if (name.startsWith("KA/KP late")) return {
    code: "KP_LATE",
    roleCodes: WASH,
    kp: true,
    note: below36
      ? "Below 36 guests this shift also washes the restaurant crockery. Restaurant plate-wash starts at 36 guests."
      : "Kitchen wash-up. From 36 guests the restaurant washes its own crockery.",
  };
  if (name.startsWith("Relief")) return { code: "RELIEF", roleCodes: KITCHEN_ANY, note: "Relief / float. On the 30–35 pilot this is the extra pair of hands, 10:00–19:00." };
  if (name.startsWith("Head chef")) return { code: "HEAD_OFFICE", roleCodes: ["HEAD_CHEF"], when: "weekday", note: "Menus, ordering and HACCP. Weekdays only. The 07:00 opener is the morning chef shift." };
  if (name.startsWith("Early FOH")) return { code: "REST_EARLY", roleCodes: REST, note: "Breakfast and lunch buffet, and the tea and coffee station." };
  if (name.startsWith("Late FOH")) return { code: "REST_LATE", roleCodes: REST, note: "Afternoon tea, dinner buffet and clear-down." };
  if (name.startsWith("Plate-wash")) return { code: "REST_WASH", roleCodes: REST, note: "Restaurant crockery and cutlery. Count stays 0 below 36 guests; the kitchen late KA/KP helps." };
  if (name.startsWith("Dining supervisor")) return { code: "REST_SUP", roleCodes: REST_LEAD, note: "Dedicated supervisor from 101 guests." };
  if (name.includes("changeover day")) return { code: "HK_CHANGE", roleCodes: HK, when: "changeover", note: "Mostly departures. Used on a changeover or arrival day." };
  if (name.includes("mid-retreat")) return { code: "HK_STAY", roleCodes: HK, when: "midstay", note: "Stayovers and public areas. Used on a mid-retreat day." };
  if (name.startsWith("Housekeeping supervisor")) return { code: "HK_SUP", roleCodes: ["HK_SUPERVISOR", "HK_ATTENDANT"], note: "Inspector. Below about three attendants a working lead can cover this." };
  if (name.startsWith("Reception early")) return { code: "REC_EARLY", roleCodes: FRONT, when: band.max === 0 ? "weekday" : "always", note: band.max === 0 ? "No guests: one weekday person for phones and bookings." : "Morning reception." };
  if (name.startsWith("Reception late")) return { code: "REC_LATE", roleCodes: FRONT, note: "Desk until 22:30. Overnight cover is the sleep-in duty manager, not a night receptionist." };
  if (name.startsWith("Changeover-day arrivals")) return { code: "REC_ARRIVE", roleCodes: FRONT, when: "changeover", note: "Extra hands for a group check-in. Changeover days only." };
  if (name.startsWith("Maintenance technician")) return { code: "MAINT_DAY", roleCodes: MAINT, when: "weekday", note: "Weekday technician. Largely fixed, not guest-driven." };
  if (name.startsWith("Changeover / weekend")) return { code: "MAINT_EXTRA", roleCodes: MAINT, when: "changeover_or_weekend", note: "Part-time cover on a changeover day or a weekend, from 61 guests." };
  if (name.startsWith("Gardener")) return { code: "GROUNDS_DAY", roleCodes: GROUNDS, when: "weekday", note: "One full-time weekday post. Acreage sets this, not the guest count. The example assumes 15–20 acres." };
  if (name.startsWith("Seasonal grounds")) return { code: "GROUNDS_SEASON", roleCodes: GROUNDS, months: [4, 5, 6, 7, 8, 9, 10], note: "April to October, and at high occupancy for paths, the car park and event set-up." };
  if (name.startsWith("Programme coordinator")) return { code: "PROG_OFFICE", roleCodes: PROGRAMME, when: "weekday", note: "Weekday office: bookings and group liaison. Not driven by who is on site today." };
  if (name.startsWith("Retreat host, day")) return { code: "PROG_DAY", roleCodes: PROGRAMME, note: "Room set-up, AV and session changeovers." };
  if (name.startsWith("Retreat host, evening")) return { code: "PROG_EVE", roleCodes: PROGRAMME, note: "Evening sessions." };
  if (name.startsWith("Purchaser")) return { code: "PURCH", roleCodes: PURCHASING, when: "weekday", note: "Fixed weekday hours. Ordering, goods-in and stock. Not guest-driven." };
  if (name.startsWith("Finance")) return { code: "FIN_BOOK", roleCodes: FINANCE, when: "weekday", note: "Fixed weekday hours. Not guest-driven." };
  if (name.startsWith("HR")) return { code: "FIN_HR", roleCodes: FINANCE, when: "weekday", note: "Fixed weekday hours. Part-time is viable. Not guest-driven." };
  if (name.startsWith("Sales")) return { code: "SALES_DAY", roleCodes: SALES, when: "weekday", note: "Fixed weekday hours. Forward bookings, not today's guests." };
  if (name.startsWith("General manager")) return { code: "GM", roleCodes: ["GENERAL_MANAGER", "OPERATIONS_MANAGER"], when: "weekday", note: "Weekday general manager." };
  if (name.startsWith("Duty manager, early")) return { code: "DUTY_EARLY", roleCodes: MGMT, note: "Below 36 guests the general manager or a head of department covers the early slot." };
  if (name.startsWith("Duty manager, late")) return { code: "DUTY_LATE", roleCodes: MGMT, note: "Named person in charge while guests are on site." };
  if (name.startsWith("Sleep-in")) return { code: "DUTY_SLEEP", roleCodes: MGMT, note: "On call in the staff room, 22:30–07:30, when guests are in. Not a 24-hour desk." };
  return { code: "SHIFT", roleCodes: [] };
}

function bandLabel(min: number, max: number | null): string {
  if (max == null) return `${min}+`;
  if (min === max) return String(min);
  return `${min}–${max}`;
}

function build(): DepartmentStaffing[] {
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "staffing-example.json"), "utf8")) as Record<string, RawDept>;
  return Object.entries(raw).map(([key, dept]) => {
    const meta = DEPT[key];
    if (!meta) throw new Error("Unknown staffing department " + key);
    const kitchen = meta.code === "KITCHEN";
    const bands: GuestBand[] = dept.bands.map(band => ({
      label: bandLabel(band.min, band.max),
      minGuests: band.min,
      maxGuests: band.max,
      example: kitchen && !(band.min === 16 && band.max === 35),
      shifts: band.shifts.map(row => shift({
        ...classify(row.name, band),
        label: row.name,
        start: row.start,
        end: row.end,
        count: row.count,
      })),
    }));
    const officeNote = meta.weekdayOffice ? " Fixed weekday hours. Guest numbers do not change this department." : "";
    const ownership = meta.code === "RESTAURANT"
      ? " Restaurant owns buffet setup, clearing, the tea and coffee station, and washing that crockery."
      : "";
    const acreage = meta.code === "GROUNDS"
      ? " The default assumes 15–20 acres. Change the acreage in Staffing settings, then edit the grounds headcount to match."
      : "";
    return {
      department: meta.code,
      placeholder: !kitchen,
      example: !kitchen,
      weekdayOffice: !!meta.weekdayOffice,
      basis: dept.basis,
      sources: dept.sources ?? [],
      note: kitchen
        ? KITCHEN_PILOT_NOTE
        : `${EXAMPLE_BANNER}. ${dept.notes ?? ""}${ownership}${officeNote}${acreage}`.replace(/\s+/g, " ").trim(),
      bands,
    };
  });
}

export const DEFAULT_STAFFING: DepartmentStaffing[] = build();

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
  { role: "KITCHEN_ASSISTANT", neverKp: false, canDoKp: true, opensKitchen: false },
  { role: "KITCHEN_PORTER", neverKp: false, canDoKp: true, opensKitchen: false },
];

export function activeShifts(band: GuestBand, when?: DayWhen): ShiftRule[] {
  return band.shifts.filter(s => s.count > 0 && (when == null || (s.when ?? "always") === when));
}
