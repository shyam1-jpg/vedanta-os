import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alertText,
  canCheckSpend,
  canLogSpend,
  canSetBudget,
  categoryAllowed,
  colourBand,
  copyBudgets,
  daysInMonth,
  formatGbp,
  monthOfDate,
  monthOfInstant,
  paceIndicator,
  parsePoundsToPence,
  spendCsv,
  spendPdf,
  spendScope,
  thresholdsToSend,
} from "./spend.ts";

describe("spend thresholds", () => {
  it("fires 80 and 100 once, and stays quiet without a budget", () => {
    assert.deepEqual(thresholdsToSend(7999, 10000, []), []);
    assert.deepEqual(thresholdsToSend(8000, 10000, []), ["80"]);
    assert.deepEqual(thresholdsToSend(10000, 10000, []), ["80", "100"]);
    assert.deepEqual(thresholdsToSend(12000, 10000, ["80", "100"]), []);
    assert.deepEqual(thresholdsToSend(5000, 0, []), []);
    const note = alertText({ department: "Kitchen", spent: 8000, budget: 10000, month: "2026-04", threshold: "80" });
    assert.match(note.body, /Kitchen used £80\.00 of £100\.00 for April 2026 \(80%\)/);
  });
});

describe("spend colour and pace", () => {
  it("bands green under 80, amber from 80, and red at the budget", () => {
    assert.equal(colourBand(7999, 10000), "green");
    assert.equal(colourBand(8000, 10000), "amber");
    assert.equal(colourBand(9999, 10000), "amber");
    assert.equal(colourBand(10000, 10000), "red");
    assert.equal(colourBand(15000, 10000), "red");
    assert.equal(colourBand(0, 0), "green");
    assert.equal(colourBand(1, 0), "red");
  });

  it("shows days left and whether spend is ahead of a straight line", () => {
    assert.deepEqual(paceIndicator(1000, 3000, 10, 30), { daysLeft: 20, pace: "under" });
    assert.deepEqual(paceIndicator(2000, 3000, 10, 30), { daysLeft: 20, pace: "ahead" });
    assert.deepEqual(paceIndicator(3000, 3000, 10, 30), { daysLeft: 20, pace: "over" });
    assert.equal(daysInMonth("2026-04"), 30);
    assert.equal(daysInMonth("2026-03"), 31);
  });
});

describe("London month boundaries", () => {
  it("puts the spring clock change into April and keeps a January evening in January", () => {
    assert.equal(monthOfInstant(new Date("2026-03-31T23:30:00Z")), "2026-04");
    assert.equal(monthOfInstant(new Date("2026-01-31T23:30:00Z")), "2026-01");
    assert.equal(monthOfDate("2026-03-31"), "2026-03");
    assert.equal(monthOfDate("2026-04-01"), "2026-04");
  });
});

describe("spend permissions", () => {
  const kitchen = { role: "KITCHEN_PORTER", department: "KITCHEN", perms: ["spend.log"] };
  const head = { role: "KITCHEN_PORTER", department: "KITCHEN", perms: ["spend.log"], headOf: "KITCHEN" };
  const supervisor = { role: "HK_SUPERVISOR", department: "HK", perms: ["spend.log"] };
  const gm = { role: "GENERAL_MANAGER", department: "MGMT", perms: ["spend.log", "spend.manage"] };
  const owner = { role: "SYSTEM_OWNER", department: null, perms: ["spend.manage"] };
  const ops = { role: "OPERATIONS_MANAGER", department: "MGMT", perms: ["spend.log"] };
  const loose = { role: "RECEPTIONIST", department: null, perms: ["spend.log"] };

  it("lets staff and heads see their department, and the GM and admin see every department", () => {
    assert.deepEqual(spendScope(kitchen), { all: false, department: "KITCHEN" });
    assert.deepEqual(spendScope(head), { all: false, department: "KITCHEN" });
    assert.deepEqual(spendScope(gm), { all: true, department: null });
    assert.deepEqual(spendScope(owner), { all: true, department: null });
    assert.deepEqual(spendScope(ops), { all: false, department: "MGMT" });
    assert.equal(canSetBudget(kitchen), false);
    assert.equal(canSetBudget(gm), true);
    assert.equal(canSetBudget(owner), true);
    assert.equal(canLogSpend(kitchen).ok, true);
    assert.equal(canLogSpend(loose).ok, false);
    assert.equal(canCheckSpend(kitchen, "KITCHEN"), false);
    assert.equal(canCheckSpend(head, "KITCHEN"), true);
    assert.equal(canCheckSpend(head, "HK"), false);
    assert.equal(canCheckSpend(supervisor, "HK"), true);
    assert.equal(canCheckSpend(supervisor, "KITCHEN"), false);
    assert.equal(canCheckSpend(ops, "KITCHEN"), false);
    assert.equal(canCheckSpend(gm, "KITCHEN"), true);
  });

  it("copies last month without overwriting a figure already set", () => {
    const copied = copyBudgets(
      [{ departmentId: "kit", amountPence: 10000 }, { departmentId: "hk", amountPence: 5000 }],
      [{ departmentId: "kit" }],
    );
    assert.deepEqual(copied, [{ departmentId: "hk", amountPence: 5000 }]);
  });

  it("keeps a removed category on an old expense and stores pounds as pence", () => {
    assert.equal(categoryAllowed("linen", [{ code: "supplies", name: "Supplies" }], "linen"), true);
    assert.equal(categoryAllowed("linen", [{ code: "supplies", name: "Supplies" }]), false);
    assert.deepEqual(parsePoundsToPence("12.50"), { ok: true, pence: 1250 });
    assert.equal(parsePoundsToPence("12.555").ok, false);
    assert.equal(parsePoundsToPence("-1").ok, false);
    assert.equal(parsePoundsToPence("0").ok, false);
    assert.deepEqual(parsePoundsToPence("0", { allowZero: true }), { ok: true, pence: 0 });
    assert.equal(formatGbp(1250), "£12.50");
    const csv = spendCsv([{ department: "Kitchen", category: "supplies", spentOn: "2026-04-02", amountPence: 1250, spentBy: "Harper Example", supplier: "", description: "Tea, towels", review: "open" }]);
    assert.match(csv, /amount_pence,amount_gbp/);
    assert.match(csv, /1250,12\.50/);
    assert.match(spendPdf(["Spend report"]), /^%PDF-1\.4/);
  });
});
