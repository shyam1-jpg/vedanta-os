import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capaStatusOk,
  feedbackDueAt,
  feedbackNotices,
  firstNameOnly,
  guestEmail,
  isKind,
  parseFeedbackSettings,
  parseSubmission,
  phoneOk,
  readFeedbackToken,
  readyToInvite,
  shouldAnonymise,
  signFeedbackToken,
  smsConfigured,
  smsInvite,
  wantsMaintenance,
} from "./feedback.ts";

const secret = "test-secret";

describe("feedback timing", () => {
  it("sends the morning after departure, at 08:00 London", () => {
    const summer = feedbackDueAt("2026-07-15", parseFeedbackSettings({}));
    assert.equal(summer?.toISOString(), "2026-07-16T07:00:00.000Z");
    const winter = feedbackDueAt("2026-01-15", parseFeedbackSettings({}));
    assert.equal(winter?.toISOString(), "2026-01-16T08:00:00.000Z");
    assert.equal(readyToInvite("2026-07-15", parseFeedbackSettings({}), new Date("2026-07-16T06:59:00.000Z")), false);
    assert.equal(readyToInvite("2026-07-15", parseFeedbackSettings({}), new Date("2026-07-16T07:00:00.000Z")), true);
  });

  it("accepts a delay in hours after checkout", () => {
    const due = feedbackDueAt("2026-09-28", parseFeedbackSettings({ delay: 2 }));
    assert.equal(due?.toISOString(), "2026-09-28T12:00:00.000Z");
  });
});

describe("feedback token", () => {
  it("accepts a signed token and refuses a changed one or an old one", () => {
    const exp = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);
    const token = signFeedbackToken("11111111-1111-4111-8111-111111111111", exp, secret);
    const now = new Date("2026-09-28T08:00:00Z");
    assert.equal(readFeedbackToken(token, secret, now).ok, true);
    assert.equal(readFeedbackToken(token.slice(0, -2) + "aa", secret, now).ok, false);
    assert.equal(readFeedbackToken(token, secret, new Date("2026-10-02T00:00:00Z")).ok, false);
  });
});

describe("feedback form", () => {
  it("requires three scores, and a category when something went wrong", () => {
    const good = parseSubmission({ food: 5, room: 4, overall: 5, comment: "Quiet and kind." });
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(isKind(good.overall, good.problem), true);
    assert.equal(parseSubmission({ food: 5, room: 0, overall: 5 }).ok, false);
    const flagged = parseSubmission({ food: 2, room: 5, overall: 3, problem: true, category: "food", detail: "The rice was cold" });
    assert.equal(flagged.ok, true);
    if (flagged.ok) assert.equal(isKind(flagged.overall, flagged.problem), false);
    assert.equal(parseSubmission({ food: 2, room: 2, overall: 2, problem: true }).ok, false);
  });

  it("shows a comment by first name only", () => {
    assert.equal(firstNameOnly("Priya Nair"), "Priya");
    assert.equal(firstNameOnly(""), "Guest");
  });
});

describe("feedback routing", () => {
  const settings = parseFeedbackSettings({
    emails: {
      kitchen: "kitchen@example.invalid",
      front: "front@example.invalid",
      housekeeping: "rooms@example.invalid",
      manager: "gm@example.invalid",
    },
  });

  it("sends food to the kitchen and the general manager", () => {
    const notes = feedbackNotices({ category: "food", firstName: "Priya", detail: "The rice was cold" }, settings);
    assert.deepEqual(notes.map(n => n.audience), ["kitchen", "manager"]);
  });

  it("sends a room problem to front of house, housekeeping and the general manager, and can open a ticket", () => {
    const notes = feedbackNotices({ category: "room", firstName: "Priya", detail: "The lamp flickered" }, settings);
    assert.deepEqual(notes.map(n => n.audience), ["front", "housekeeping", "manager"]);
    assert.equal(wantsMaintenance("room", settings), true);
    assert.equal(wantsMaintenance("room", parseFeedbackSettings({ open_maintenance: false })), false);
  });

  it("sends a staff note only to the general manager", () => {
    const notes = feedbackNotices({ category: "staff", firstName: "Priya", detail: "A sharp word at breakfast" }, settings);
    assert.deepEqual(notes.map(n => n.audience), ["manager"]);
    assert.equal(notes.some(n => n.audience === "kitchen"), false);
  });

  it("drops a blank or invalid address and does not invent one", () => {
    const notes = feedbackNotices(
      { category: "food", firstName: "Priya", detail: "Cold rice" },
      parseFeedbackSettings({ emails: { kitchen: "not an email", manager: "GM@Example.invalid" } }),
    );
    assert.deepEqual(notes.map(n => n.to), ["gm@example.invalid"]);
  });
});

describe("feedback privacy", () => {
  it("keeps the text message free of health information", () => {
    const sms = smsInvite("https://house.example/feedback/?t=abc");
    assert.equal(sms.ok, true);
    if (!sms.ok) return;
    assert.equal(HEALTHY(sms.body), false);
    assert.equal(sms.body.includes("https://house.example/feedback/?t=abc"), true);
    const letter = guestEmail("Priya", "https://house.example/feedback/?t=abc", "The Vedanta");
    assert.equal(letter.body.includes("Priya"), true);
    assert.equal(HEALTHY(letter.body), false);
  });

  it("leaves the text service off until it is configured", () => {
    assert.equal(smsConfigured({}), false);
    assert.equal(smsConfigured({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+440000000000" }), true);
    assert.equal(phoneOk("07123 456789"), "07123456789");
    assert.equal(phoneOk("123"), "");
  });

  it("forgets free text after the retention window", () => {
    const created = new Date("2025-01-01T00:00:00Z");
    assert.equal(shouldAnonymise(created, 365, new Date("2026-01-02T00:00:00Z")), true);
    assert.equal(shouldAnonymise(created, 365, new Date("2025-06-01T00:00:00Z")), false);
    assert.equal(capaStatusOk("action_taken"), true);
    assert.equal(capaStatusOk("done"), false);
  });
});

function HEALTHY(text: string): boolean {
  return /\b(allerg|anaphyla|diet|medical|illness|medication|disability|pregnan|health)\b/i.test(text);
}
