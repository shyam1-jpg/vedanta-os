import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFS,
  decideDelivery,
  guestFooter,
  parseCommsFlag,
  readCommsToken,
  saveChoice,
  signCommsToken,
  unsubscribeChoice,
  WORDING_VERSION,
} from "./commsPrefs.ts";

const night = new Date("2026-10-12T22:30:00Z");
const morning = new Date("2026-10-12T10:00:00Z");
const links = { preferences: "https://house.example/hear/?t=prefs", unsubscribe: "https://house.example/hear/?t=stop" };

test("marketing starts unticked, and consent keeps the time, the source, and the wording", () => {
  assert.equal(parseCommsFlag({}), false);
  assert.equal(DEFAULT_PREFS.marketing, false);
  const blocked = decideDelivery({ flagOn: true, kind: "journey_rebook", channel: "email", prefs: null, now: morning, links });
  assert.equal(blocked.action, "skip");
  assert.equal(blocked.reason, "Marketing needs opt-in consent");
  const saved = saveChoice({
    operationalChannel: "email",
    marketing: true,
    marketingChannel: "email",
    quietFrom: "22:00",
    quietTo: "07:00",
    at: "2026-10-01T12:00:00.000Z",
    source: "my_stay",
    previous: null,
  });
  assert.equal(saved.ok, true);
  if (!saved.ok || !saved.event) return;
  assert.equal(saved.event.marketing, true);
  assert.equal(saved.event.at, "2026-10-01T12:00:00.000Z");
  assert.equal(saved.event.source, "my_stay");
  assert.equal(saved.event.wordingVersion, WORDING_VERSION);
  assert.match(saved.event.wording, /optional/i);
  const allowed = decideDelivery({ flagOn: true, kind: "journey_rebook", channel: "email", prefs: saved.prefs, now: morning, links });
  assert.equal(allowed.action, "send");
  assert.match(allowed.footer ?? "", /Unsubscribe from notes about future retreats/);
  assert.match(guestFooter("operational", links), /How you hear from The Vedanta/);
  assert.equal(guestFooter("operational", links).includes("Unsubscribe"), false);
});

test("channel choice and quiet hours hold a guest letter, and a time-critical note still goes", () => {
  const quiet = decideDelivery({ flagOn: true, kind: "journey_pre_arrival", channel: "email", prefs: DEFAULT_PREFS, now: night });
  assert.equal(quiet.action, "defer");
  assert.equal(quiet.reason, "Quiet hours");
  const urgent = decideDelivery({ flagOn: true, kind: "journey_check_in", channel: "email", prefs: DEFAULT_PREFS, now: night, links });
  assert.equal(urgent.action, "send");
  const none = decideDelivery({ flagOn: true, kind: "guest_access_code", channel: "email", prefs: { ...DEFAULT_PREFS, operationalChannel: "none" }, now: morning });
  assert.equal(none.action, "skip");
  const smsOnly = decideDelivery({ flagOn: true, kind: "journey_pre_arrival", channel: "email", prefs: { ...DEFAULT_PREFS, operationalChannel: "sms" }, now: morning });
  assert.equal(smsOnly.action, "skip");
  const text = decideDelivery({ flagOn: true, kind: "journey_pre_arrival", channel: "sms", prefs: { ...DEFAULT_PREFS, operationalChannel: "sms" }, now: morning });
  assert.equal(text.action, "send");
  const staff = decideDelivery({ flagOn: true, kind: "fault_maintenance", channel: "email", prefs: { ...DEFAULT_PREFS, operationalChannel: "none" }, now: night });
  assert.equal(staff.action, "send");
  assert.equal(staff.purpose, "staff");
  const off = decideDelivery({ flagOn: false, kind: "journey_rebook", channel: "email", prefs: null, now: night, links });
  assert.equal(off.action, "send");
  assert.equal(off.applied, false);
  assert.equal(off.footer, undefined);
});

test("one click unsubscribes, and a tampered link is refused", () => {
  const stopped = unsubscribeChoice({ ...DEFAULT_PREFS, marketing: true, marketingChannel: "email", consentAt: "2026-10-01T12:00:00.000Z", wordingVersion: WORDING_VERSION }, "2026-10-02T09:00:00.000Z");
  assert.equal(stopped.prefs.marketing, false);
  assert.equal(stopped.event.source, "unsubscribe_link");
  assert.equal(stopped.event.marketing, false);
  const token = signCommsToken("guest@example.invalid", "unsubscribe", Date.parse("2026-12-01T00:00:00Z"), "secret");
  const read = readCommsToken(token, "secret", Date.parse("2026-10-12T00:00:00Z"));
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.purpose, "unsubscribe");
  assert.equal(readCommsToken(token, "other", Date.parse("2026-10-12T00:00:00Z")).ok, false);
  assert.equal(readCommsToken(token, "secret", Date.parse("2027-01-01T00:00:00Z")).ok, false);
});
