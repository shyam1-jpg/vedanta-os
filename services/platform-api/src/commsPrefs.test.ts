import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
const sms = readFileSync(new URL("./sms.ts", import.meta.url), "utf8");
const journey = readFileSync(new URL("./journey.ts", import.meta.url), "utf8");
const feedback = readFileSync(new URL("./feedback.ts", import.meta.url), "utf8");
const lost = readFileSync(new URL("./lostFound.ts", import.meta.url), "utf8");
const portal = readFileSync(new URL("./guestPortal.ts", import.meta.url), "utf8");
const workforce = readFileSync(new URL("./workforce.ts", import.meta.url), "utf8");
const prefs = readFileSync(new URL("./commsPrefs.ts", import.meta.url), "utf8");

test("every outgoing letter and text checks communication preferences, on the existing mail job", () => {
  assert.match(server, /commsPrefsRoutes/);
  assert.match(server, /releaseDeferredGuestMail/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.equal(prefs.includes("setInterval"), false);
  assert.match(email, /gateOutbound/);
  assert.match(sms, /gateOutbound/);
  assert.match(journey, /kind: `journey_\$\{plan\.kind\}`/);
  assert.match(feedback, /kind: "feedback_invite"/);
  assert.match(lost, /kind: "lost_found_guest"/);
  assert.match(portal, /kind: "guest_verify_email"/);
  assert.equal(portal.includes("INSERT INTO outbound_email"), false);
  assert.match(workforce, /kind: "staff_contract"/);
  assert.equal(workforce.includes("insert into outbound_email"), false);
  assert.match(prefs, /unsubscribe/);
  assert.equal(prefs.includes("ALLOW_UNVERIFIED_GUEST_BOOTSTRAP"), false);
});
