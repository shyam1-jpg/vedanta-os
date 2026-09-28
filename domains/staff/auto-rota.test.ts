import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOUSE_RULES,
  bandFor,
  generateRota,
  guestDays,
  resolvePerson,
  rotaToCsv,
  rosteredHours,
  shiftApplies,
  type DepartmentStaffing,
  type HouseRules,
  type RotaPerson,
} from "./auto-rota.ts";
import { DEFAULT_STAFFING, EXAMPLE_BANNER, KITCHEN_PILOT_NOTE } from "./staffing-defaults.ts";

const house: HouseRules = { ...DEFAULT_HOUSE_RULES, maxDaysPerWeek: 5, maxConsecutiveDays: 6 };

function person(partial: Partial<RotaPerson> & Pick<RotaPerson, "userId" | "name" | "role" | "department">): RotaPerson {
  return resolvePerson({
    ...partial,
    house,
    saved: {
      earliestStart: partial.earliestStart,
      earliestByWeekday: partial.earliestByWeekday,
      latesOnly: partial.latesOnly,
      latesFrom: partial.latesFrom,
      neverKp: partial.neverKp,
      canDoKp: partial.canDoKp,
      opensKitchen: partial.opensKitchen,
      maxHoursWeek: partial.maxHoursWeek,
      maxHoursMonth: partial.maxHoursMonth,
      normalWeekHours: partial.normalWeekHours,
      maxDaysWeek: partial.maxDaysWeek,
      unavailableWeekdays: partial.unavailableWeekdays,
      unavailableDates: partial.unavailableDates,
    },
    monthHoursAlready: partial.monthHoursAlready,
    weekHoursAlready: partial.weekHoursAlready,
    workedDates: partial.workedDates,
    previousShift: partial.previousShift,
  });
}

const team = (): RotaPerson[] => [
  person({ userId: "hc", name: "Head Example", role: "HEAD_CHEF", department: "KITCHEN", opensKitchen: true, neverKp: true, canDoKp: false }),
  person({ userId: "sc", name: "Sous Example", role: "SOUS_CHEF", department: "KITCHEN", opensKitchen: true, neverKp: true, canDoKp: false }),
  person({ userId: "cdp", name: "CDP Example", role: "CHEF_DE_PARTIE", department: "KITCHEN", neverKp: true, canDoKp: false }),
  person({ userId: "cdp2", name: "CDP Late Example", role: "CHEF_DE_PARTIE", department: "KITCHEN", neverKp: true, canDoKp: false, earliestByWeekday: { "1": "18:00", "2": "18:00" } }),
  person({ userId: "kp10", name: "Porter Ten", role: "KITCHEN_PORTER", department: "KITCHEN", earliestStart: "10:00", canDoKp: true, neverKp: false }),
  person({ userId: "kplate", name: "Porter Late", role: "KITCHEN_PORTER", department: "KITCHEN", latesOnly: true, latesFrom: "12:00", canDoKp: true, neverKp: false }),
  person({ userId: "kpstu", name: "Porter Student", role: "KITCHEN_PORTER", department: "KITCHEN", maxHoursMonth: 80, canDoKp: true, neverKp: false }),
];

const kitchen = (): DepartmentStaffing[] => DEFAULT_STAFFING.filter(d => d.department === "KITCHEN");

function on(date: string, rules = kitchen(), people = team(), guests = 32) {
  return generateRota({ days: [{ date, guests }], rules, people, house }).shifts.filter(s => s.department === "KITCHEN");
}

function counted(band: { shifts: { code: string; start: string; end: string; count: number }[] }) {
  return band.shifts.filter(s => s.count > 0).map(s => `${s.code} ${s.start}-${s.end} x${s.count}`).sort();
}

describe("kitchen pilot bands", () => {
  it("uses the proposal times for 30–35 guests, plus relief", () => {
    const band = bandFor(kitchen()[0].bands, 32)!;
    assert.equal(band.label, "16–35");
    assert.equal(band.example, false);
    assert.deepEqual(counted(band), [
      "KP_EARLY 07:00-15:00 x1",
      "KP_LATE 15:00-22:00 x1",
      "LATE_CHEF 12:00-21:00 x1",
      "MORNING_CHEF 07:00-16:00 x1",
      "RELIEF 10:00-19:00 x1",
    ]);
    const lateKp = band.shifts.find(s => s.code === "KP_LATE")!;
    assert.match(lateKp.note ?? "", /restaurant crockery/);
    assert.match(KITCHEN_PILOT_NOTE, /07:00–16:00/);
    assert.equal(kitchen()[0].placeholder, false);
    assert.equal(kitchen()[0].example, false);
  });

  it("keeps other kitchen bands as the research suggestion", () => {
    const zero = bandFor(kitchen()[0].bands, 0)!;
    assert.equal(zero.shifts.filter(s => s.count > 0).length, 0);
    const low = bandFor(kitchen()[0].bands, 10)!;
    assert.equal(low.example, true);
    assert.equal(low.shifts.find(s => s.code === "RELIEF")!.count, 0);
    assert.equal(low.shifts.find(s => s.code === "LATE_CHEF")!.count, 1);
    const mid = bandFor(kitchen()[0].bands, 40)!;
    assert.equal(mid.shifts.find(s => s.code === "MORNING_CHEF")!.count, 2);
    assert.equal(mid.shifts.find(s => s.code === "RELIEF")!.count, 1);
    assert.equal(mid.shifts.find(s => s.code === "HEAD_OFFICE")!.count, 0);
    const high = bandFor(kitchen()[0].bands, 100)!;
    assert.equal(high.label, "61–100");
    assert.equal(high.shifts.find(s => s.code === "MORNING_CHEF")!.count, 3);
    const top = bandFor(kitchen()[0].bands, 120)!;
    assert.equal(top.label, "101–130");
    assert.equal(top.shifts.find(s => s.code === "MORNING_CHEF")!.count, 4);
    assert.equal(top.shifts.find(s => s.code === "KP_LATE")!.count, 3);
    assert.equal(top.shifts.find(s => s.code === "RELIEF")!.count, 2);
    assert.equal(top.shifts.find(s => s.code === "HEAD_OFFICE")!.when, "weekday");
  });

  it("flags every non-kitchen department as an example the house can edit", () => {
    const others = DEFAULT_STAFFING.filter(d => d.department !== "KITCHEN");
    assert.ok(others.length >= 10);
    for (const dept of others) {
      assert.equal(dept.example, true, dept.department);
      assert.equal(dept.placeholder, true, dept.department);
      assert.match(dept.note ?? "", new RegExp(EXAMPLE_BANNER));
      assert.ok((dept.basis ?? "").length > 20, dept.department);
      assert.ok((dept.sources ?? []).length > 0, dept.department);
    }
    for (const code of ["PURCHASING", "FINANCE", "SALES"]) {
      assert.equal(DEFAULT_STAFFING.find(d => d.department === code)!.weekdayOffice, true);
    }
    const restaurant = DEFAULT_STAFFING.find(d => d.department === "RESTAURANT")!;
    const at30 = bandFor(restaurant.bands, 30)!;
    const evening = at30.shifts.find(s => s.code === "REST_LATE")!;
    assert.equal(evening.start, "14:00");
    assert.equal(evening.end, "22:00");
    assert.equal(evening.count, 2);
    assert.equal(at30.shifts.find(s => s.code === "REST_WASH")!.count, 0);
    assert.equal(bandFor(restaurant.bands, 40)!.shifts.find(s => s.code === "REST_WASH")!.count, 1);
    assert.match(restaurant.note ?? "", /buffet/);
  });

  it("uses a changeover variant for housekeeping and reception", () => {
    const hk = DEFAULT_STAFFING.find(d => d.department === "HK")!;
    const band = bandFor(hk.bands, 32)!;
    assert.equal(band.shifts.find(s => s.code === "HK_CHANGE")!.count, 3);
    assert.equal(band.shifts.find(s => s.code === "HK_STAY")!.count, 2);
    const change = generateRota({ days: [{ date: "2026-09-28", guests: 32, dayType: "changeover" }], rules: [hk], people: [], house }).shifts;
    const stay = generateRota({ days: [{ date: "2026-09-29", guests: 32, dayType: "midstay" }], rules: [hk], people: [], house }).shifts;
    assert.equal(change.filter(s => s.code === "HK_CHANGE").length, 3);
    assert.equal(change.filter(s => s.code === "HK_STAY").length, 0);
    assert.equal(stay.filter(s => s.code === "HK_STAY").length, 2);
    assert.equal(stay.filter(s => s.code === "HK_CHANGE").length, 0);
    const front = DEFAULT_STAFFING.find(d => d.department === "FRONT")!;
    const arrival = generateRota({ days: [{ date: "2026-09-28", guests: 80, dayType: "changeover" }], rules: [front], people: [], house }).shifts;
    const mid = generateRota({ days: [{ date: "2026-09-30", guests: 80, dayType: "midstay" }], rules: [front], people: [], house }).shifts;
    assert.equal(arrival.filter(s => s.code === "REC_ARRIVE").length, 2);
    assert.equal(mid.filter(s => s.code === "REC_ARRIVE").length, 0);
  });

  it("keeps office departments on weekdays only", () => {
    const purchasing = DEFAULT_STAFFING.find(d => d.department === "PURCHASING")!;
    const monday = generateRota({ days: [{ date: "2026-09-28", guests: 0 }], rules: [purchasing], people: [], house }).shifts;
    const saturday = generateRota({ days: [{ date: "2026-10-03", guests: 80 }], rules: [purchasing], people: [], house }).shifts;
    assert.equal(monday.length, 1);
    assert.equal(monday[0].start, "07:30");
    assert.equal(saturday.length, 0);
    const grounds = DEFAULT_STAFFING.find(d => d.department === "GROUNDS")!;
    assert.match(grounds.note ?? "", /15–20 acres/);
    assert.equal(DEFAULT_HOUSE_RULES.groundsAcresMin, 15);
    assert.equal(DEFAULT_HOUSE_RULES.groundsAcresMax, 20);
    const april = generateRota({ days: [{ date: "2026-04-06", guests: 80 }], rules: [grounds], people: [], house }).shifts;
    const january = generateRota({ days: [{ date: "2026-01-05", guests: 80 }], rules: [grounds], people: [], house }).shifts;
    assert.equal(april.filter(s => s.code === "GROUNDS_SEASON").length, 1);
    assert.equal(january.filter(s => s.code === "GROUNDS_SEASON").length, 0);
    assert.equal(shiftApplies({ code: "X", label: "X", start: "08:00", end: "16:00", count: 1, roleCodes: [], kp: false, opener: false, when: "weekday" }, { date: "2026-10-03" }), false);
  });
});

describe("assigning people", () => {
  it("opens with the head chef or sous chef and never puts them on KP", () => {
    const shifts = on("2026-09-28");
    const open = shifts.find(s => s.code === "MORNING_CHEF")!;
    assert.equal(open.gap, false);
    assert.ok(["HEAD_CHEF", "SOUS_CHEF"].includes(open.role!));
    for (const kp of shifts.filter(s => s.code.startsWith("KP_"))) {
      if (!kp.gap) assert.equal(kp.role, "KITCHEN_PORTER");
    }
    assert.equal(shifts.some(s => s.role === "HEAD_CHEF" && s.code.startsWith("KP_")), false);
  });

  it("keeps a lates-only porter off the early shift and a 10:00 porter off 07:00", () => {
    const shifts = on("2026-09-28");
    const early = shifts.find(s => s.code === "KP_EARLY")!;
    assert.notEqual(early.name, "Porter Late");
    assert.notEqual(early.name, "Porter Ten");
    assert.equal(early.name, "Porter Student");
    const late = shifts.find(s => s.code === "KP_LATE")!;
    assert.equal(late.name, "Porter Late");
  });

  it("does not start the Monday-Tuesday chef de partie before 18:00", () => {
    const shifts = on("2026-09-28");
    assert.equal(shifts.some(s => s.name === "CDP Late Example"), false);
    const wednesday = on("2026-09-30");
    assert.equal(wednesday.some(s => s.gap && s.code === "MORNING_CHEF"), false);
  });

  it("leaves a gap when neither opener can work", () => {
    const people = team().map(p => p.userId === "hc" || p.userId === "sc" ? { ...p, unavailableDates: ["2026-09-28"] } : p);
    const open = on("2026-09-28", kitchen(), people).find(s => s.code === "MORNING_CHEF")!;
    assert.equal(open.gap, true);
    assert.match(open.gapReason ?? "", /Head chef or sous chef/);
    const late = on("2026-09-28", kitchen(), people).find(s => s.code === "LATE_CHEF")!;
    assert.equal(late.gap, false);
    assert.equal(late.role, "CHEF_DE_PARTIE");
  });

  it("will not put a 07:00 start after a 21:00 finish", () => {
    const people = team().map(p => p.userId === "hc" ? { ...p, previousShift: { date: "2026-09-27", end: "21:00" }, unavailableDates: [] } : p);
    const open = on("2026-09-28", kitchen(), people).find(s => s.code === "MORNING_CHEF")!;
    assert.notEqual(open.userId, "hc");
    assert.equal(open.role, "SOUS_CHEF");
  });

  it("banks hours over 40 as lieu and still rosters them", () => {
    const rules: DepartmentStaffing[] = [{
      department: "KITCHEN",
      placeholder: false,
      bands: [{
        label: "16–35",
        minGuests: 16,
        maxGuests: 35,
        shifts: [{ code: "MORNING_CHEF", label: "Morning chef", start: "07:00", end: "16:00", count: 1, roleCodes: ["HEAD_CHEF"], kp: false, opener: true, breakMinutes: 0 }],
      }],
    }];
    const hc = person({ userId: "hc", name: "Head Example", role: "HEAD_CHEF", department: "KITCHEN", opensKitchen: true, neverKp: true, normalWeekHours: 40, weekHoursAlready: { "2026-09-28": 36 } });
    const shifts = generateRota({ days: [{ date: "2026-09-28", guests: 30 }], rules, people: [hc], house }).shifts;
    assert.equal(shifts[0].gap, false);
    assert.equal(shifts[0].hours, 9);
    assert.equal(shifts[0].lieuHours, 5);
  });

  it("caps the student porter at 80 hours in the month", () => {
    const student = person({
      userId: "kpstu", name: "Porter Student", role: "KITCHEN_PORTER", department: "KITCHEN",
      canDoKp: true, neverKp: false, maxHoursMonth: 80, monthHoursAlready: { "2026-09": 76 },
    });
    const shifts = on("2026-09-28", kitchen(), [student]);
    const early = shifts.find(s => s.code === "KP_EARLY")!;
    assert.equal(early.gap, true);
    assert.match(early.gapReason ?? "", /monthly|kitchen porter/i);
  });

  it("fills a week from one daily guest count and flags gaps", () => {
    const days = guestDays({ from: "2026-09-28", to: "2026-10-04", guests: 32 });
    assert.equal(days.length, 7);
    assert.equal(days.every(d => d.guests === 32), true);
    const { shifts } = generateRota({ days, rules: DEFAULT_STAFFING, people: team(), house });
    const kitchenShifts = shifts.filter(s => s.department === "KITCHEN");
    assert.equal(kitchenShifts.length, 7 * 5);
    assert.ok(kitchenShifts.some(s => s.gap), "early KP cannot be covered every day by one 07:00 porter");
    const hk = shifts.find(s => s.department === "HK")!;
    assert.equal(hk.placeholder, true);
    assert.equal(hk.gap, true);
    const csv = rotaToCsv(kitchenShifts);
    assert.match(csv, /GAP/);
    assert.match(csv, /2026-09-28/);
  });

  it("lets a single day override the range", () => {
    const days = guestDays({ from: "2026-09-28", to: "2026-09-29", guests: 10, days: [{ date: "2026-09-29", guests: 50 }] });
    assert.deepEqual(days.map(d => d.guests), [10, 50]);
    const { shifts } = generateRota({ days, rules: kitchen(), people: team(), house });
    assert.equal(shifts.filter(s => s.date === "2026-09-28" && s.code === "RELIEF").length, 0);
    assert.equal(shifts.filter(s => s.date === "2026-09-29" && s.code === "RELIEF").length, 1);
  });
});

describe("rostered hours", () => {
  it("counts the span, including the break, the way the kitchen sheet does", () => {
    assert.equal(rosteredHours("07:00", "16:00", 30, true), 9);
    assert.equal(rosteredHours("07:00", "16:00", 30, false), 8.5);
  });
});
