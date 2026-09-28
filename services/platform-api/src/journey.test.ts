import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const journey = readFileSync(new URL("./journey.ts", import.meta.url), "utf8");
const auto = readFileSync(new URL("./autocomms.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const feedback = readFileSync(new URL("./feedback.ts", import.meta.url), "utf8");

test("guest journey reuses the mail scheduler, the shared mail helper, and the text adapter", () => {
  assert.match(auto, /runGuestJourney/);
  assert.match(auto, /guest_journey/);
  assert.equal(journey.includes("setInterval"), false);
  assert.match(journey, /sendEmail/);
  assert.match(journey, /deliverSms/);
  assert.match(server, /journeyRoutes/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.match(feedback, /ownsFeedbackLetter/);
  assert.equal(journey.includes("ALLOW_UNVERIFIED_GUEST_BOOTSTRAP"), false);
  assert.equal(journey.includes("decideBookingGate"), false);
});
