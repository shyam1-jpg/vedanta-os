import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_TEMPLATES,
  EXAMPLE_TRAINING,
  addMonths,
  cellTone,
  clearedForWork,
  parseTrainingItem,
  parseTrainingSettings,
  pendingTrainingAlerts,
  staffProgress,
  trainingNotices,
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
