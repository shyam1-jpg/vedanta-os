import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUPPLIERS,
  HOUSE_DEPARTMENTS,
  budgetForRange,
  buildMoneyView,
  departmentForStaff,
  guestsOnDate,
  labourFromPunches,
  periodBounds,
  planGuestCount,
  requiredFor,
  shiftHours,
  sortSuppliers,
} from "./back-office.ts";

const day = "2026-10-02";

describe("periodBounds", () => {
  it("keeps a day on that day", () => {
    assert.deepEqual(periodBounds(day, "day"), { from: day, to: day });
  });
  it("opens the week on Monday", () => {
    assert.deepEqual(periodBounds("2026-10-02", "week"), { from: "2026-09-28", to: "2026-10-04" });
  });
  it("covers the calendar month and year", () => {
    assert.deepEqual(periodBounds(day, "month"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(periodBounds(day, "year"), { from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("guestsOnDate", () => {
  const stays = [
    { arrival: "2026-10-01", departure: "2026-10-04", guests: 30, status: "CONFIRMED" },
    { arrival: "2026-10-02", departure: "2026-10-03", guests: 4, status: "CANCELLED" },
  ];
  it("counts guests in house and leaves on the departure morning", () => {
    assert.equal(guestsOnDate(stays, "2026-10-02"), 30);
    assert.equal(guestsOnDate(stays, "2026-10-04"), 0);
  });
});

describe("budgetForRange", () => {
  const budgets = [{ year: 2026, month: 10, department: "KITCHEN", amount: 3100 }];
  it("returns the monthly goal for a full month", () => {
    assert.equal(budgetForRange(budgets, "2026-10-01", "2026-10-31", "KITCHEN"), 3100);
  });
  it("spreads the goal across one day", () => {
    assert.equal(budgetForRange(budgets, "2026-10-02", "2026-10-02", "KITCHEN"), 100);
  });
  it("is empty when no goal is saved", () => {
    assert.equal(budgetForRange(budgets, "2026-10-01", "2026-10-31", "HK"), null);
  });
});

describe("staffing plan", () => {
  const plans = [
    { guestCount: 20, department: "KITCHEN", required: 2 },
    { guestCount: 30, department: "KITCHEN", required: 4 },
  ];
  it("uses the exact guest count, then the next plan up", () => {
    assert.equal(planGuestCount(plans, 30), 30);
    assert.equal(planGuestCount(plans, 25), 30);
    assert.equal(planGuestCount(plans, 40), 30);
    assert.deepEqual(requiredFor(plans, 25, "KITCHEN"), { planFor: 30, required: 4 });
  });
});

describe("departmentForStaff", () => {
  it("keeps porters and receptionists in their own buckets", () => {
    assert.equal(departmentForStaff("KITCHEN_PORTER", "KITCHEN"), "KITCHEN_PORTER");
    assert.equal(departmentForStaff("RECEPTIONIST", "FRONT"), "RECEPTION");
    assert.equal(departmentForStaff("HEAD_CHEF", "KITCHEN"), "KITCHEN");
    assert.equal(departmentForStaff("MAINTENANCE", "MAINT"), "OTHER");
  });
});

describe("shiftHours", () => {
  it("caps a forgotten clock-in at sixteen hours", () => {
    const inAt = new Date("2026-10-01T08:00:00Z");
    const now = new Date("2026-10-03T08:00:00Z");
    const open = shiftHours(inAt, null, now);
    assert.equal(open.hours, 16);
    assert.equal(open.capped, true);
    const closed = shiftHours(inAt, new Date("2026-10-01T16:00:00Z"), now);
    assert.equal(closed.hours, 8);
    assert.equal(closed.capped, false);
  });
});

describe("labourFromPunches", () => {
  it("prices a closed shift and leaves an unrated shift out of the pounds", () => {
    const lines = labourFromPunches(
      [
        { userId: "a", role: "HEAD_CHEF", department: "KITCHEN", hourlyRate: 12 },
        { userId: "b", role: "HK_ATTENDANT", department: "HK", hourlyRate: null },
      ],
      [
        { userId: "a", kind: "IN", at: new Date("2026-10-02T07:00:00Z") },
        { userId: "a", kind: "OUT", at: new Date("2026-10-02T15:00:00Z") },
        { userId: "b", kind: "IN", at: new Date("2026-10-02T08:00:00Z") },
        { userId: "b", kind: "OUT", at: new Date("2026-10-02T12:00:00Z") },
      ],
      new Date("2026-10-02T18:00:00Z"),
    );
    const kitchen = lines.find(l => l.userId === "a");
    const house = lines.find(l => l.userId === "b");
    assert.equal(kitchen?.hours, 8);
    assert.equal(kitchen?.cost, 96);
    assert.equal(kitchen?.department, "KITCHEN");
    assert.equal(house?.cost, null);
    assert.equal(house?.hours, 4);
  });
});

describe("buildMoneyView", () => {
  const view = buildMoneyView({
    anchor: day,
    period: "day",
    income: [{ date: day, amount: 1500 }],
    expenses: [
      { date: day, amount: 200, department: "KITCHEN", kind: "food" },
      { date: day, amount: 50, department: "BUILDING", kind: "other" },
      { date: "2026-10-03", amount: 999, department: "KITCHEN", kind: "food" },
    ],
    labour: [
      { userId: "a", department: "KITCHEN", date: day, hours: 8, cost: 96, open: false, capped: false },
      { userId: "b", department: "HK", date: day, hours: 4, cost: null, open: false, capped: false },
    ],
    stays: [{ arrival: "2026-10-01", departure: "2026-10-04", guests: 30, status: "IN_HOUSE" }],
    budgets: [{ year: 2026, month: 10, department: "KITCHEN", amount: 3100 }],
  });

  it("sums only the records inside the day", () => {
    assert.equal(view.moneyIn, 1500);
    assert.equal(view.supplierSpend, 250);
    assert.equal(view.foodSpend, 200);
    assert.equal(view.otherSpend, 50);
    assert.equal(view.labourCost, 96);
    assert.equal(view.moneyOut, 346);
    assert.equal(view.unratedHours, 4);
  });

  it("puts guests, cost per guest, profit and break-even on the same view", () => {
    assert.equal(view.guestsInHouse, 30);
    assert.equal(view.costPerGuest, 11.53);
    assert.equal(view.profit, 1154);
    assert.equal(view.breakEvenRevenue, 346);
    assert.equal(view.aboveBreakEven, true);
    assert.equal(view.shortOfBreakEven, 0);
    assert.equal(view.breakEvenGuests, 6.92);
  });

  it("shows kitchen spend against the day's share of the monthly goal", () => {
    const kitchen = view.departments.find(d => d.code === "KITCHEN");
    assert.equal(kitchen?.spend, 296);
    assert.equal(kitchen?.budget, 100);
    assert.equal(kitchen?.variance, -196);
  });

  it("does not invent a cost per guest when the house is empty", () => {
    const empty = buildMoneyView({
      anchor: day,
      period: "day",
      income: [],
      expenses: [{ date: day, amount: 10, department: "GROUNDS", kind: "other" }],
      labour: [],
      stays: [],
      budgets: [],
    });
    assert.equal(empty.costPerGuest, null);
    assert.equal(empty.breakEvenGuests, null);
    assert.equal(empty.profit, -10);
    assert.equal(empty.shortOfBreakEven, 10);
    assert.equal(empty.series.length, 1);
    assert.equal(empty.series[0].moneyOut, 10);
  });
});

describe("suppliers", () => {
  it("marks only the four named shops as regulars", () => {
    const regulars = DEFAULT_SUPPLIERS.filter(s => s.regular).map(s => s.name);
    assert.deepEqual(regulars, ["Breaks", "Pilgrims", "Suma", "Fresh from the Field"]);
    for (const name of ["Tesco", "Sainsbury's", "Amazon", "Screwfix", "B&Q"]) {
      assert.equal(DEFAULT_SUPPLIERS.find(s => s.name === name)?.regular, false);
    }
    assert.equal(DEFAULT_SUPPLIERS.some(s => /toolstation|wickes|selco/i.test(s.name)), false);
    assert.equal(HOUSE_DEPARTMENTS.length, 7);
  });
  it("lists regulars first, then scored shops, and does not invent a rank", () => {
    const sorted = sortSuppliers([
      { code: "LOCAL", name: "Lincoln wholefoods", regular: false, score: null },
      { code: "TESCO", name: "Tesco", regular: false, score: 4 },
      { code: "BQ", name: "B&Q", regular: false, score: null },
      { code: "SUMA", name: "Suma", regular: true, score: null },
      { code: "BREAKS", name: "Breaks", regular: true, score: null },
    ]);
    assert.deepEqual(sorted.map(s => s.code), ["BREAKS", "SUMA", "TESCO", "BQ", "LOCAL"]);
  });
});
