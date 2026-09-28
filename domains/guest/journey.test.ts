import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  arrivalStatusLabel,
  checkInReady,
  checkInSummary,
  checkInWindowOpen,
  claimSend,
  defaultTemplate,
  emergencyDueForRemoval,
  emergencyUntil,
  mayPlaceWalkUp,
  maySend,
  ownsFeedbackLetter,
  ownsLegacyPreArrival,
  parseJourneySettings,
  planGuestMessages,
  previewFields,
  readJourneyToken,
  renderMerge,
  retreatList,
  roomForGuest,
  signJourneyToken,
  transitionArrival,
  type JourneyKind,
  type JourneySettings,
  type PlanInput,
} from "./journey.ts";

const PERSON = "55555555-5555-4555-8555-555555555551";
const GROUP = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-journey-secret";

function settings(patch: Partial<JourneySettings> = {}): JourneySettings {
  return { ...parseJourneySettings({}), ...patch, sequences: { ...parseJourneySettings({}).sequences, ...patch.sequences } };
}

function plan(patch: Partial<PlanInput> = {}) {
  const base: PlanInput = {
    today: "2026-10-07",
    arrival: "2026-10-12",
    departure: "2026-10-16",
    settings: settings(),
    sent: [],
    detailsComplete: false,
    marketingConsent: false,
    unsubscribed: false,
    rebooked: false,
    openComplaint: false,
    feedbackReady: false,
  };
  return planGuestMessages({ ...base, ...patch, settings: patch.settings ?? base.settings });
}

test("defaults keep check-in off and the other sequences on", () => {
  const parsed = parseJourneySettings({});
  assert.equal(parsed.pre_arrival_days, 5);
  assert.equal(parsed.check_in_time, "08:00");
  assert.equal(parsed.rebook_days, 30);
  assert.equal(parsed.sequences.check_in, false);
  assert.equal(parsed.sequences.pre_arrival, true);
  assert.equal(parsed.sequences.post_stay, true);
  assert.equal(parsed.id_required, false);
  assert.match(parsed.house_rules, /pure vegetarian/);
  assert.match(parsed.house_rules, /only visit the cows with staff/);
  assert.equal(ownsLegacyPreArrival(parsed), true);
  assert.equal(ownsFeedbackLetter(parsed), true);
});

test("pre-arrival is due five days before and not six", () => {
  assert.deepEqual(plan({ today: "2026-10-07" }).map(item => item.kind), ["pre_arrival"]);
  assert.deepEqual(plan({ today: "2026-10-06" }), []);
  assert.equal(plan({ today: "2026-10-07", detailsComplete: true })[0].variant, "confirm");
  assert.equal(plan({ today: "2026-10-07", detailsComplete: false })[0].variant, "collect");
});

test("the day before sends see you tomorrow, not a second pre-arrival", () => {
  const kinds = plan({ today: "2026-10-11", sent: [] }).map(item => item.kind);
  assert.deepEqual(kinds, ["see_you_tomorrow"]);
  const after = plan({ today: "2026-10-11", sent: ["pre_arrival"] }).map(item => item.kind);
  assert.deepEqual(after, ["see_you_tomorrow"]);
});

test("a sent letter is not due again", () => {
  assert.equal(claimSend([{ kind: "pre_arrival" }], "pre_arrival"), false);
  assert.equal(claimSend([], "pre_arrival"), true);
  assert.deepEqual(plan({ today: "2026-10-07", sent: ["pre_arrival"] }), []);
});

test("service mail still goes when marketing is refused", () => {
  assert.deepEqual(maySend("pre_arrival", { marketingConsent: false, unsubscribed: true }, true), { ok: true });
  assert.deepEqual(maySend("thank_you", { marketingConsent: false, unsubscribed: true }, true), { ok: true });
  const letter = plan({
    today: "2026-10-17",
    feedbackReady: true,
    unsubscribed: true,
    marketingConsent: false,
  });
  assert.deepEqual(letter.map(item => item.kind), ["thank_you"]);
});

test("rebook needs consent, a clear complaint, and no later booking", () => {
  const day = addDays("2026-10-16", 30);
  const common = { today: day, feedbackReady: false, sent: ["thank_you"] as JourneyKind[] };
  assert.deepEqual(plan({ ...common, marketingConsent: false }).map(item => item.kind), []);
  assert.deepEqual(plan({ ...common, marketingConsent: true, unsubscribed: true }).map(item => item.kind), []);
  assert.deepEqual(plan({ ...common, marketingConsent: true, openComplaint: true }).map(item => item.kind), []);
  assert.deepEqual(plan({ ...common, marketingConsent: true, rebooked: true }).map(item => item.kind), []);
  assert.deepEqual(plan({ ...common, marketingConsent: true }).map(item => item.kind), ["rebook"]);
  assert.deepEqual(maySend("rebook", { marketingConsent: false, unsubscribed: false }, true), { ok: false, reason: "Marketing needs opt-in consent" });
});

test("thank-you waits for the feedback moment and is not paired with a second invite", () => {
  assert.deepEqual(plan({ today: "2026-10-16", feedbackReady: false }).map(item => item.kind), []);
  assert.deepEqual(plan({ today: "2026-10-17", feedbackReady: true }).map(item => item.kind), ["thank_you"]);
  assert.equal(defaultTemplate("thank_you").body.includes("{{feedback_link}}"), true);
});

test("journey tokens fail when tampered, expired, or signed for someone else", () => {
  const exp = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000) + 14 * 24 * 60 * 60;
  const now = new Date("2026-10-02T00:00:00Z");
  const token = signJourneyToken({ personId: PERSON, groupId: GROUP, purpose: "stay" }, exp, SECRET);
  const read = readJourneyToken(token, SECRET, now);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.personId, PERSON);
    assert.equal(read.purpose, "stay");
  }
  const tampered = `${token.slice(0, -2)}aa`;
  assert.equal(readJourneyToken(tampered, SECRET, now).ok, false);
  assert.equal(readJourneyToken(token, "other-secret", now).ok, false);
  const stale = signJourneyToken({ personId: PERSON, groupId: GROUP, purpose: "details" }, Math.floor(now.getTime() / 1000) - 10, SECRET);
  const expired = readJourneyToken(stale, SECRET, now);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.match(expired.error, /expired/);
  const other = "55555555-5555-4555-8555-555555555552";
  const foreign = signJourneyToken({ personId: other, groupId: GROUP, purpose: "stay" }, exp, SECRET);
  const foreignRead = readJourneyToken(foreign, SECRET, now);
  assert.equal(foreignRead.ok && foreignRead.personId, other);
  assert.notEqual(foreignRead.ok && foreignRead.personId, PERSON);
});

test("arrivals move forward only", () => {
  assert.equal(transitionArrival("expected", "en_route").ok, true);
  assert.equal(transitionArrival("expected", "checked_in_digitally").ok, true);
  assert.equal(transitionArrival("expected", "arrived").ok, true);
  assert.equal(transitionArrival("checked_in_digitally", "arrived").ok, true);
  assert.equal(transitionArrival("arrived", "keys_issued").ok, true);
  assert.equal(transitionArrival("keys_issued", "expected").ok, false);
  assert.equal(transitionArrival("expected", "keys_issued").ok, false);
  assert.equal(arrivalStatusLabel("checked_in_digitally"), "checked in digitally");
  assert.equal(checkInSummary(["expected", "checked_in_digitally", "keys_issued"]), "1 checked in digitally, 1 keys issued");
});

test("digital check-in stays shut until the flag and the arrival morning", () => {
  assert.equal(checkInWindowOpen({ flag: false, today: "2026-10-12", arrival: "2026-10-12", minutes: 9 * 60, from: "08:00" }), false);
  assert.equal(checkInWindowOpen({ flag: true, today: "2026-10-11", arrival: "2026-10-12", minutes: 12 * 60, from: "08:00" }), false);
  assert.equal(checkInWindowOpen({ flag: true, today: "2026-10-12", arrival: "2026-10-12", minutes: 7 * 60, from: "08:00" }), false);
  assert.equal(checkInWindowOpen({ flag: true, today: "2026-10-12", arrival: "2026-10-12", minutes: 8 * 60, from: "08:00" }), true);
  const shut = checkInReady({
    flag: false, today: "2026-10-12", arrival: "2026-10-12", minutes: 9 * 60, from: "08:00",
    rulesAck: true, detailsConfirmed: true, idRequired: false, idSeen: false,
  });
  assert.equal(shut.ok, false);
  const open = checkInReady({
    flag: true, today: "2026-10-12", arrival: "2026-10-12", minutes: 9 * 60, from: "08:00",
    rulesAck: true, detailsConfirmed: true, idRequired: true, idSeen: false,
  });
  assert.equal(open.ok, false);
  if (!open.ok) assert.match(open.error, /Identification/);
});

test("a room is shown only when it is assigned and released, and a lock blocks a walk-up", () => {
  assert.equal(roomForGuest({ assigned: null, released: true }).show, null);
  assert.equal(roomForGuest({ assigned: "102", released: false }).show, null);
  assert.equal(roomForGuest({ assigned: "102", released: true }).show, "102");
  assert.equal(mayPlaceWalkUp({ occupantLocked: true }).ok, false);
  assert.equal(mayPlaceWalkUp({ occupantLocked: false }).ok, true);
});

test("merge fields and retreat lines stay on the placeholder copy", () => {
  const rendered = renderMerge(defaultTemplate("pre_arrival").body, previewFields());
  assert.match(rendered.text, /Test/);
  assert.match(rendered.text, /pure vegetarian/);
  assert.equal(rendered.missing.length, 0);
  assert.match(renderMerge("Hello {{missing}}", {}).text, /Hello\s*$/);
  assert.deepEqual(retreatList([]).includes("website"), true);
  assert.match(retreatList([{ name: "Example Spring Retreat", arrival: "2 November 2026" }]), /Example Spring Retreat/);
});

test("emergency contacts are kept only until the retention date", () => {
  assert.equal(emergencyUntil("2026-10-16", 30), "2026-11-15");
  assert.equal(emergencyDueForRemoval("2026-11-15", "2026-11-15"), false);
  assert.equal(emergencyDueForRemoval("2026-11-15", "2026-11-16"), true);
});
