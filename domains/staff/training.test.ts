import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTMENT_MODULES,
  EXAMPLE_TEMPLATES,
  EXAMPLE_TRAINING,
  addMonths,
  cellTone,
  clearedForWork,
  detachModule,
  inductionItemIds,
  modulesInScope,
  nextShare,
  parseTrainingItem,
  parseTrainingSettings,
  pendingTrainingAlerts,
  placeDefaultModules,
  planChecklistEdit,
  signoffAfterEdit,
  staffProgress,
  ticksAfterEdit,
  trainingNotices,
  trainingScope,
} from "./training.ts";

describe("cleared for unsupervised work", () => {
  it("stays closed until every required item is signed off and in date", () => {
    const today = "2026-09-28";
    assert.equal(clearedForWork([], today), false);
    assert.equal(clearedForWork([{ required: true, signedOff: false }], today), false);
    assert.equal(clearedForWork([{ required: true, signedOff: true, expiresOn: "2026-01-01" }], today), false);
    assert.equal(clearedForWork([
      { required: true, signedOff: true, expiresOn: "2027-01-01" },
      { required: false, signedOff: false },
    ], today), true);
  });

  it("lets staff mark progress and keeps sign-off for a manager", () => {
    assert.equal(staffProgress("not_started"), "in_progress");
    assert.equal(staffProgress("completed"), null);
    assert.equal(cellTone(true, "completed", true, "2026-01-01", "2026-09-28"), "expired");
    assert.equal(cellTone(true, "in_progress", false, null, "2026-09-28"), "in_progress");
    assert.equal(cellTone(false, "not_started", false, null, "2026-09-28"), "none");
  });
});

describe("training reminders", () => {
  it("sends each lead once, then expired once", () => {
    assert.deepEqual(pendingTrainingAlerts("2026-10-20", "2026-09-28", [60, 30, 7], []), ["60", "30"]);
    assert.deepEqual(pendingTrainingAlerts("2026-08-01", "2026-09-28", [60], ["expired"]), []);
    assert.equal(addMonths("2026-09-01", 36), "2029-09-01");
    const notes = trainingNotices(
      { title: "Example food hygiene level 2", person: "A new chef", expiresOn: "2026-10-01", kind: "30" },
      { staff: "chef@example.invalid", manager: "chef@example.invalid" },
    );
    assert.equal(notes.length, 1);
  });

  it("drops a manager address that is not an email", () => {
    assert.deepEqual(parseTrainingSettings({ leads: [30], manager: "not an email" }).manager, "");
    assert.deepEqual(parseTrainingSettings({}).leads, [60, 30, 7]);
  });
});

describe("training library", () => {
  it("asks for a validity period on a certificate and keeps examples generic", () => {
    assert.equal(parseTrainingItem({ title: "Fire", category: "fire_safety", certificate: true }).ok, false);
    const item = parseTrainingItem({ title: "Food hygiene level 2", category: "food_hygiene", certificate: true, valid_years: 3, required: true });
    assert.equal(item.ok, true);
    if (item.ok) assert.equal(item.validMonths, 36);
    assert.equal(EXAMPLE_TRAINING.every(row => row.title.startsWith("Example ")), true);
    assert.equal(EXAMPLE_TEMPLATES.some(row => row.name === "Example chef induction"), true);
    assert.equal(EXAMPLE_TEMPLATES.some(row => /priya|shyam|nair/i.test(row.name)), false);
  });
});

const HOUSE = ["KITCHEN", "FRONT", "MAINT", "HK", "GROUNDS", "RESTAURANT"];

function catalog() {
  return placeDefaultModules(HOUSE).map(mod => ({
    id: mod.key,
    title: mod.title,
    share: mod.share,
    departments: mod.placements.map(row => row.department),
  }));
}

describe("department training modules", () => {
  it("seeds one fire module for every department and shares chemical safety with maintenance and housekeeping", () => {
    const placed = placeDefaultModules(HOUSE);
    const fire = placed.find(mod => mod.key === "fire");
    assert.equal(fire?.locked, true);
    assert.equal(fire?.share, "all");
    assert.deepEqual(fire?.placements.map(row => row.department).sort(), [...HOUSE].sort());
    assert.equal(DEPARTMENT_MODULES.filter(mod => mod.title === "Fire safety").length, 1);
    const kitchen = placed.filter(mod => mod.placements.some(row => row.department === "KITCHEN")).map(mod => mod.title).sort();
    assert.deepEqual(kitchen, ["Allergen awareness", "Fire safety", "Food safety", "Hygiene", "Knife skills"]);
    assert.deepEqual(
      placed.filter(mod => mod.placements.some(row => row.department === "FRONT")).map(mod => mod.title).sort(),
      ["Accessibility awareness", "Fire safety", "Guest service"],
    );
    assert.deepEqual(
      placed.filter(mod => mod.placements.some(row => row.department === "MAINT")).map(mod => mod.title).sort(),
      ["Chemical safety (COSHH)", "Equipment handling", "Fire safety"],
    );
    assert.deepEqual(
      placed.filter(mod => mod.placements.some(row => row.department === "HK")).map(mod => mod.title).sort(),
      ["Chemical safety (COSHH)", "Cleaning standards", "Fire safety"],
    );
    const chemical = placed.find(mod => mod.key === "coshh");
    assert.deepEqual(chemical?.placements.map(row => row.department).sort(), ["HK", "MAINT"]);
    assert.equal(placed.filter(mod => mod.placements.some(row => row.department === "GROUNDS")).every(mod => mod.key === "fire"), true);
    assert.equal(DEPARTMENT_MODULES.every(mod => mod.checks.length >= 3), true);
  });

  it("shows staff their departments, a union when they work in two, and the whole house to the general manager", () => {
    const mods = catalog();
    const kitchen = modulesInScope(mods, trainingScope({ role: "HEAD_CHEF", departments: ["KITCHEN"] })).map(mod => mod.id).sort();
    assert.deepEqual(kitchen, ["allergen", "fire", "food", "hygiene", "knife"]);
    const both = modulesInScope(mods, trainingScope({ role: "KITCHEN_PORTER", departments: ["KITCHEN", "HK"] }));
    assert.equal(both.filter(mod => mod.id === "coshh").length, 1);
    assert.equal(both.some(mod => mod.id === "cleaning"), true);
    assert.equal(both.some(mod => mod.id === "knife"), true);
    assert.equal(both.some(mod => mod.id === "guest"), false);
    const gm = modulesInScope(mods, trainingScope({ role: "GENERAL_MANAGER", departments: ["MGMT"] }));
    assert.equal(gm.length, mods.length);
    assert.equal(trainingScope({ role: "SYSTEM_OWNER", departments: [] }).all, true);
    assert.equal(trainingScope({ role: "FRONT_OFFICE_MANAGER", departments: ["FRONT"] }).all, false);
  });

  it("keeps fire safety on every department and lets chemical safety leave one of its two", () => {
    const fire = detachModule({ share: "all", locked: true, departments: ["KITCHEN", "HK"] }, "KITCHEN");
    assert.equal(fire.ok, false);
    const chemical = detachModule({ share: "selected", locked: false, departments: ["MAINT", "HK"] }, "HK");
    assert.equal(chemical.ok, true);
    if (chemical.ok) assert.deepEqual(chemical.departments, ["MAINT"]);
    assert.equal(nextShare({ share: "all", locked: true }, { mandatoryAll: false }).ok, false);
    const shared = nextShare({ share: "department", locked: false }, { shared: true });
    assert.equal(shared.ok, true);
    if (shared.ok) assert.equal(shared.share, "selected");
  });

  it("builds a role induction from the department set", () => {
    const ids = inductionItemIds({ department: "KITCHEN", itemIds: ["extra-gdpr"] }, catalog());
    assert.equal(ids.includes("fire"), true);
    assert.equal(ids.includes("knife"), true);
    assert.equal(ids.includes("extra-gdpr"), true);
    assert.equal(ids.includes("cleaning"), false);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("versions a checklist without dropping finished ticks or a sign-off, unless the edit asks for training again", () => {
    const current = [
      { id: "a", label: "Wash hands before handling food" },
      { id: "b", label: "Keep hot food hot and cold food cold" },
    ];
    const kept = planChecklistEdit(current, [
      { id: "a", label: "Wash hands before handling food" },
      { id: "c", label: "Keep allergens away from the food they do not belong in" },
    ], false);
    assert.equal(kept.ok, true);
    if (!kept.ok) return;
    assert.equal(kept.changed, true);
    assert.equal(kept.clearSignoff, false);
    assert.deepEqual(kept.removeIds, ["b"]);
    assert.deepEqual(ticksAfterEdit(["a", "b"], kept.removeIds), ["a"]);
    assert.equal(signoffAfterEdit(true, kept), true);
    const again = planChecklistEdit(current, [{ id: "a", label: "Wash hands, including wrists" }], true);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.clearSignoff, true);
    assert.equal(signoffAfterEdit(true, again), false);
    const same = planChecklistEdit(current, current, true);
    assert.equal(same.ok, true);
    if (same.ok) assert.equal(same.clearSignoff, false);
  });
});
