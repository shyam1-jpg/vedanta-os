import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OPS_DEPARTMENTS } from "../ops/board.ts";
import { HOUSE_MANUALS } from "../ops/manual.ts";
import { HOUSE_DEPARTMENTS } from "./organogram.ts";
import { isKnownTrainingDepartment, staffTrainingSections, trainingDepartments } from "./training.ts";

describe("staff training", () => {
  it("uses only departments the house already names", () => {
    const known = new Set([
      ...OPS_DEPARTMENTS.map(d => d.code),
      ...HOUSE_DEPARTMENTS.map(d => d.code),
    ]);
    const sections = trainingDepartments();
    assert.equal(new Set(sections.map(d => d.code)).size, sections.length);
    for (const dept of sections) {
      assert.ok(known.has(dept.code), dept.code);
      assert.equal(isKnownTrainingDepartment(dept.code), true);
    }
    assert.equal(sections.some(d => d.name === "Reception"), false);
    assert.equal(sections.some(d => d.code === "KITCHEN_PORTER"), false);
  });

  it("teaches from the written manual and leaves the rest unwritten", () => {
    const sections = staffTrainingSections();
    const byCode = Object.fromEntries(sections.map(s => [s.code, s]));
    assert.deepEqual(
      byCode.KITCHEN.items.map(item => item.slug),
      ["kitchen-brigade", "kitchen-safety", "kitchen-allergen-plate", "kitchen-open-close"],
    );
    assert.equal(byCode.KITCHEN.items[0].summary, HOUSE_MANUALS.find(c => c.slug === "kitchen-brigade")!.summary);
    assert.equal(byCode.HK.items[0].slug, "hk-room");
    assert.equal(byCode.FRONT.items[0].slug, "front-desk-day");
    assert.equal(byCode.GROUNDS.items[0].slug, "grounds-estate");
    assert.equal(byCode.NIGHT.items[0].slug, "night-porter");
    assert.equal(byCode.KITCHEN.empty, null);
    for (const code of ["SALES", "PROGRAMME", "PURCHASING", "FINANCE"]) {
      assert.deepEqual(byCode[code].items, []);
      assert.equal(byCode[code].empty, `Training for ${byCode[code].name} is not written yet.`);
    }
  });

  it("drops a withdrawn chapter instead of teaching it", () => {
    const sections = staffTrainingSections([
      { ...HOUSE_MANUALS.find(c => c.slug === "hk-room")!, status: "withdrawn" },
    ]);
    const housekeeping = sections.find(s => s.code === "HK")!;
    assert.deepEqual(housekeeping.items, []);
    assert.equal(housekeeping.empty, "Training for Housekeeping is not written yet.");
  });
});
