import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_COMPLIANCE,
  addInterval,
  complianceNotices,
  itemStatus,
  parseComplianceItem,
  parseComplianceSettings,
  pendingAlerts,
  rollDue,
} from "./compliance.ts";

describe("compliance status", () => {
  it("marks upcoming, due, overdue, and a finished one-off", () => {
    assert.equal(itemStatus("2026-10-01", "2026-09-28"), "upcoming");
    assert.equal(itemStatus("2026-09-28", "2026-09-28"), "due");
    assert.equal(itemStatus("2026-09-01", "2026-09-28"), "overdue");
    assert.equal(itemStatus(null, "2026-09-28"), "completed");
  });
});

describe("compliance schedule", () => {
  it("rolls a weekly item forward past today", () => {
    assert.equal(rollDue("2026-09-01", 1, "week", "2026-09-28", true), "2026-09-29");
  });

  it("leaves a one-off finished", () => {
    assert.equal(rollDue("2026-09-01", null, null, "2026-09-28", false), null);
  });

  it("adds months without losing the calendar date when it fits", () => {
    assert.equal(addInterval("2026-01-15", 6, "month"), "2026-07-15");
  });
});

describe("compliance reminders", () => {
  it("sends each lead once before the date, and overdue once after", () => {
    assert.deepEqual(pendingAlerts("2026-10-03", "2026-09-28", [30, 7, 1], []), ["30", "7"]);
    assert.deepEqual(pendingAlerts("2026-10-03", "2026-09-28", [30, 7, 1], ["30"]), ["7"]);
    assert.deepEqual(pendingAlerts("2026-09-01", "2026-09-28", [30, 7, 1], []), ["overdue"]);
    assert.deepEqual(pendingAlerts("2026-09-01", "2026-09-28", [30, 7, 1], ["overdue"]), []);
    assert.deepEqual(pendingAlerts(null, "2026-09-28", [30], []), []);
  });

  it("copies the general manager and skips a repeated address", () => {
    const notes = complianceNotices(
      { title: "Fire alarm test", due: "2026-10-01", kind: "7" },
      { responsible: "lead@example.invalid", manager: "lead@example.invalid" },
    );
    assert.equal(notes.length, 1);
    assert.equal(notes[0].audience, "responsible");
    const both = complianceNotices(
      { title: "Fire alarm test", due: "2026-09-01", kind: "overdue" },
      { responsible: "lead@example.invalid", manager: "gm@example.invalid" },
    );
    assert.deepEqual(both.map(n => n.audience), ["responsible", "manager"]);
    assert.match(both[0].body, /still open/);
  });

  it("drops a blank manager address", () => {
    const settings = parseComplianceSettings({ leads: [14, 14, 400, 1], manager: "not an email" });
    assert.deepEqual(settings.leads, [14, 1]);
    assert.equal(settings.manager, "");
    assert.deepEqual(parseComplianceSettings({}).leads, [30, 7, 1]);
  });
});

describe("compliance item", () => {
  it("requires a title, a category, and a date", () => {
    assert.equal(parseComplianceItem({ title: "Alarm", category: "nope", next_due: "2026-10-01" }).ok, false);
    const once = parseComplianceItem({ title: "Gas safety", category: "health_safety", next_due: "2026-11-01", schedule: "once" });
    assert.equal(once.ok, true);
    if (once.ok) assert.equal(once.repeating, false);
    const weekly = parseComplianceItem({ title: "Fire alarm test", category: "fire_safety", schedule: "recurring", every: 1, unit: "week", next_due: "2026-10-05" });
    assert.equal(weekly.ok, true);
    if (weekly.ok) assert.equal(weekly.unit, "week");
  });

  it("lists the example duties", () => {
    const titles = EXAMPLE_COMPLIANCE.map(item => item.title);
    for (const name of ["Fire suppression and extinguisher service", "Fire alarm test", "Food hygiene inspection", "GDPR review", "Insurance renewal", "PAT testing", "Gas safety", "Legionella risk assessment", "Fridge and freezer calibration"]) {
      assert.equal(titles.includes(name), true);
    }
  });
});
