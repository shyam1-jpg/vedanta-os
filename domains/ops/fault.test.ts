import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AREAS,
  isFoodSafetyEquipment,
  nextFaultStatus,
  parseAreas,
  parseFaultRouting,
  reportNotices,
  statusNotices,
  validateFault,
} from "./fault.ts";

const rules = {
  maintenance: "maintenance@example.invalid",
  manager: "manager@example.invalid",
  kitchen: "kitchen@example.invalid",
};

describe("fault capture", () => {
  it("accepts a room, a plain description and an urgency, and fills the reporter's department", () => {
    const parsed = validateFault({
      description: "toilet not flushing",
      room: "12",
      urgency: "URGENT",
      reporterDepartment: "HK",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.title, "toilet not flushing");
    assert.equal(parsed.draft.room, "12");
    assert.equal(parsed.draft.priority, "URGENT");
    assert.equal(parsed.draft.department, "HK");
    assert.equal(parsed.draft.foodSafety, false);
  });

  it("accepts an area and a category when the thing is not on the asset list", () => {
    const parsed = validateFault({
      description: "chair leg loose",
      area: "Dining room",
      equipment_category: "furniture",
      equipment_label: "banquet chair",
      urgency: "NORMAL",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.area, "Dining room");
    assert.equal(parsed.draft.equipmentCategory, "furniture");
    assert.equal(parsed.draft.room, null);
  });

  it("rejects a report with nowhere to go", () => {
    const parsed = validateFault({ description: "overflowing" });
    assert.equal(parsed.ok, false);
  });

  it("flags a fridge or walk-in freezer as food safety", () => {
    assert.equal(isFoodSafetyEquipment({ name: "Fridge 2", category: "appliance" }), true);
    assert.equal(isFoodSafetyEquipment({ label: "Walk-in freezer" }), true);
    assert.equal(isFoodSafetyEquipment({ name: "Dining chair", category: "furniture" }), false);
    const parsed = validateFault({
      description: "warm",
      area: "Kitchen",
      equipment_label: "Walk-in freezer",
      assetName: "Walk-in freezer",
      assetCategory: "kitchen",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.foodSafety, true);
  });

  it("refuses a photo that is not an image", () => {
    const parsed = validateFault({ description: "drip", room: "1", photo: "not-a-picture" });
    assert.equal(parsed.ok, false);
  });

  it("still accepts the older low priority", () => {
    const parsed = validateFault({ title: "slow drip", room: "3", priority: "LOW" });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.priority, "LOW");
    assert.equal(parsed.draft.department, "HOUSE");
  });

  it("refuses a photo that is too large to store", () => {
    const parsed = validateFault({ description: "drip", room: "1", photo: "data:image/jpeg," + "a".repeat(700_000) });
    assert.equal(parsed.ok, false);
  });
});

describe("fault routing", () => {
  const chair = {
    number: 4,
    description: "chair leg loose",
    location: "Dining room",
    equipment: "banquet chair",
    urgency: "NORMAL",
    reporter: "Priya",
    foodSafety: false,
    photo: false,
  };

  it("sends every report to maintenance and copies the general manager", () => {
    const notes = reportNotices(chair, rules);
    assert.deepEqual(notes.map(n => n.audience), ["maintenance", "manager"]);
    assert.equal(notes[1].body.includes("chair leg loose"), true);
    assert.equal(notes[1].body.includes("Priya"), true);
    assert.equal(notes.every(n => !n.body.includes("peanuts")), true);
  });

  it("also copies the kitchen when the equipment is a fridge or freezer", () => {
    const notes = reportNotices({ ...chair, foodSafety: true, equipment: "Fridge 2", description: "not cold" }, rules);
    assert.deepEqual(notes.map(n => n.audience), ["maintenance", "manager", "kitchen"]);
    assert.equal(notes[2].body.includes("food-safety"), true);
  });

  it("does not invent an address when settings are blank", () => {
    const notes = reportNotices(chair, { maintenance: "", manager: "", kitchen: "" });
    assert.equal(notes.length, 0);
  });

  it("drops a badly formed address and still copies a valid manager", () => {
    const parsed = parseFaultRouting({ maintenance: "not an email", manager: "Manager@Example.invalid", kitchen: "kitchen @x" });
    assert.equal(parsed.maintenance, "");
    assert.equal(parsed.manager, "manager@example.invalid");
    const notes = reportNotices(chair, parsed);
    assert.deepEqual(notes.map(n => n.to), ["manager@example.invalid"]);
  });

  it("tells the reporter and the manager when the status changes, once each", () => {
    const notes = statusNotices(
      { ...chair, foodSafety: true, equipment: "Fridge 2" },
      { ...rules, manager: "maintenance@example.invalid" },
      "DONE",
      "maintenance@example.invalid",
      "Thermostat replaced",
    );
    assert.deepEqual(notes.map(n => n.audience), ["reporter", "kitchen"]);
    assert.equal(notes.filter(n => n.to === "maintenance@example.invalid").length, 1);
    assert.equal(notes[0].body.includes("Fixed"), true);
    assert.equal(notes[0].body.includes("Thermostat replaced"), true);
  });
});

describe("fault workflow and lists", () => {
  it("lets maintenance acknowledge, then mark in progress, waiting for parts, and fixed", () => {
    assert.equal(nextFaultStatus("OPEN", "acknowledge"), "ACKNOWLEDGED");
    assert.equal(nextFaultStatus("ACKNOWLEDGED", "start"), "IN_PROGRESS");
    assert.equal(nextFaultStatus("IN_PROGRESS", "wait"), "WAITING_PARTS");
    assert.equal(nextFaultStatus("WAITING_PARTS", "done"), "DONE");
    assert.equal(nextFaultStatus("DONE", "start"), null);
    assert.equal(nextFaultStatus("DONE", "reopen"), "OPEN");
  });

  it("keeps the house areas and replaces them when settings has a list", () => {
    assert.deepEqual(parseAreas(undefined), [...DEFAULT_AREAS]);
    assert.deepEqual(parseAreas(["Boiler room", "Boiler room", ""]), ["Boiler room"]);
  });
});
