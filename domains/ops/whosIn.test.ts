import assert from "node:assert/strict";
import test from "node:test";
import { cardHasAllergen, filterWho, fireRoll, fireRollCsv, onSite, projectWho, whoRole, type WhoSource } from "./whosIn.ts";

function row(over: Partial<WhoSource> = {}): WhoSource {
  return {
    id: "g1:in",
    firstName: "Test",
    room: "12",
    group: "Example Autumn Retreat",
    building: "House",
    movement: "in_house",
    checkIn: "",
    accessNote: "step-free room",
    dietFlag: true,
    allergens: ["peanut"],
    ...over,
  };
}

test("roles see names and rooms, or a dietary flag, and never the allergen code", () => {
  assert.equal(whoRole({ role: "RECEPTIONIST" }), "front");
  assert.equal(whoRole({ role: "HK_ATTENDANT" }), "housekeeping");
  assert.equal(whoRole({ role: "GENERAL_MANAGER" }), "manager");
  assert.equal(whoRole({ role: "HEAD_CHEF" }), "kitchen");
  assert.equal(whoRole({ role: "KITCHEN_PORTER", department: "FRONT" }), "kitchen");
  const front = projectWho(row(), "front");
  assert.equal(front.name, "Test");
  assert.equal(front.room, "12");
  assert.equal(front.access, "step-free room");
  assert.equal(front.diet, null);
  assert.equal(cardHasAllergen(front, ["peanut"]), false);
  const kitchen = projectWho(row(), "kitchen");
  assert.equal(kitchen.diet, "dietary flag");
  assert.equal(kitchen.room, null);
  assert.equal(cardHasAllergen(kitchen, ["peanut"]), false);
  const other = projectWho(row(), "other");
  assert.equal(other.name, "Guest");
  assert.equal(other.room, null);
  assert.equal(other.diet, null);
  assert.equal(cardHasAllergen(other, ["peanut"]), false);
});

test("search and filters use the briefing rows, and the fire roll is who is on site", () => {
  const rows = [
    row(),
    row({ id: "g2:arrival", firstName: "Other", group: "Other group", building: "Annex", movement: "arrival", checkIn: "expected", dietFlag: false, allergens: [], accessNote: "" }),
    row({ id: "g3:arrival", firstName: "Late", movement: "arrival", checkIn: "en route", room: "4" }),
    row({ id: "g4:arrival", firstName: "Here", movement: "arrival", checkIn: "checked in digitally", room: "8", building: "Annex" }),
  ];
  const found = filterWho(rows, "manager", { q: "test", building: "House", group: "Autumn", status: "in house" });
  assert.equal(found.length, 1);
  assert.equal(found[0].room, "12");
  assert.equal(onSite(rows[1]), false);
  assert.equal(onSite(rows[2]), false);
  assert.equal(onSite(rows[3]), true);
  const roll = fireRoll(rows);
  assert.equal(roll.some(line => line.name === "Other"), false);
  assert.equal(roll.some(line => line.name === "Late"), false);
  assert.equal(roll.some(line => line.name === "Here" && line.room === "8"), true);
  assert.equal(fireRollCsv(rows).toLowerCase().includes("peanut"), false);
  assert.match(fireRollCsv(rows), /step-free/);
});
