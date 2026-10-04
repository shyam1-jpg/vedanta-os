import {test} from "node:test";
import assert from "node:assert/strict";
import {guestSignupCanProceed, guestEmailStatusMessage} from "../app/guest-email-status.ts";

test("new signups wait for a configured delivery service", () => {
  for (const status of ["checking", "unavailable", "unknown"]) assert.equal(guestSignupCanProceed(status, false), false);
  assert.equal(guestSignupCanProceed("available", false), true);
});
test("issued codes and existing signed-in guests remain usable during email outages", () => {
  for (const status of ["checking", "available", "unavailable", "unknown"]) {
    assert.equal(guestSignupCanProceed(status, true), true);
    assert.equal(guestSignupCanProceed(status, false, true), true);
  }
});
test("unconfigured and unknown states do not claim a code was emailed", () => {
  assert.match(guestEmailStatusMessage("unavailable"), /email service is not connected/);
  assert.match(guestEmailStatusMessage("unknown"), /could not check/);
  assert.match(guestEmailStatusMessage("checking"), /Checking/);
  assert.equal(guestEmailStatusMessage("available"), "");
});
