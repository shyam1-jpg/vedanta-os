import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coversForBookings } from "./covers.ts";

const base = {
  id: "g1", name: "Phoenix", arrival: "2026-10-10", departure: "2026-10-12",
  arrivalSlot: "PM" as const, departureSlot: "AM" as const, guests: 30, status: "CONFIRMED",
};

describe("coversForBookings", () => {
  it("skips breakfast and lunch on an evening arrival", () => {
    const { days } = coversForBookings([base], "2026-10-10", "2026-10-10");
    assert.equal(days[0].breakfast, 0);
    assert.equal(days[0].lunch, 0);
    assert.equal(days[0].dinner, 30);
  });
  it("leaves a silent morning departure unclassified", () => {
    const { days, unclassified } = coversForBookings([base], "2026-10-12", "2026-10-12");
    assert.equal(days.find(d => d.date === "2026-10-12")?.breakfast ?? 0, 0);
    assert.equal(unclassified[0]?.meal, "breakfast");
  });
  it("counts breakfast when the clock time is through breakfast or the sheet says so", () => {
    const timed = coversForBookings([{ ...base, departureTime: "10:15" }], "2026-10-12", "2026-10-12");
    assert.equal(timed.days[0].breakfast, 30);
    const said = coversForBookings([{ ...base, notes: "leaving after breakfast" }], "2026-10-12", "2026-10-12");
    assert.equal(said.days[0].breakfast, 30);
    assert.equal(said.unclassified.length, 0);
  });
  it("ignores a booking with no headcount", () => {
    const { days } = coversForBookings([{ ...base, guests: 0 }], "2026-10-10", "2026-10-12");
    assert.equal(days.length, 0);
  });
});
