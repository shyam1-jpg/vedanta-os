import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countTowardCovers, isUnconfirmedStay } from "./forecast.ts";

describe("kitchen forecast", () => {
  it("does not count an enquiry as firm covers", () => {
    assert.equal(countTowardCovers("ENQUIRY"), false);
    assert.equal(countTowardCovers("CONFIRMED"), true);
    assert.equal(countTowardCovers("PROVISIONAL"), true);
    assert.equal(isUnconfirmedStay("ENQUIRY"), true);
    assert.equal(isUnconfirmedStay("PROVISIONAL"), false);
  });

  it("shows enquiries on the forecast and still copies diet when the house takes one", () => {
    const occupancy = readFileSync(new URL("../../services/platform-api/src/occupancy.ts", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../../services/platform-api/src/guestPortal.ts", import.meta.url), "utf8");
    const kitchen = readFileSync(new URL("../../apps/web-admin/components/Kitchen.tsx", import.meta.url), "utf8");
    assert.match(occupancy, /ENQUIRY/);
    assert.match(occupancy, /unconfirmed/);
    assert.match(occupancy, /countTowardCovers/);
    assert.match(occupancy, /guest_enquiry/);
    assert.match(portal, /carryOntoBooking/);
    assert.match(kitchen, /unconfirmed/);
  });
});