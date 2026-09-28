import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORGANISER_NAME_SQL, plannedComms, PROPERTY_WEBSITE_SQL, staffAlertAddresses, staffNewEnquiryLetter } from "./auto.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("planned comms", () => {
  it("queues a confirmation now and skips reminders that are already past", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const arrival = new Date("2026-09-10T15:00:00Z");
    const departure = new Date("2026-09-12T09:00:00Z");
    const kinds = plannedComms({ now, arrival, departure }).map(item => item.kind);
    assert.deepEqual(kinds, ["booking_confirmed", "pre_arrival", "checkout_reminder"]);
  });
});

describe("staff new enquiry", () => {
  it("writes to the front desk and the general manager once each", () => {
    const addresses = staffAlertAddresses({
      booking_routing: { front: { email: "front@example.invalid" } },
      fault_routing: { manager: "gm@example.invalid" },
    });
    assert.deepEqual(addresses, ["front@example.invalid", "gm@example.invalid"]);
    const letter = staffNewEnquiryLetter({ name: "A Guest", email: "guest@example.invalid", arrival: "2026-10-01", departure: "2026-10-03", people: 2 });
    assert.match(letter.subject, /New enquiry/);
    assert.match(letter.body, /Food is not billed/);
  });
});

describe("email query alignment", () => {
  it("reads the organiser from the person record and the website from settings", () => {
    const src = read("../../services/platform-api/src/autocomms.ts");
    const mail = read("../../services/platform-api/src/email.ts");
    assert.match(ORGANISER_NAME_SQL, /given_name/);
    assert.match(PROPERTY_WEBSITE_SQL, /settings->>'website'/);
    assert.match(src, /organiser_person_id/);
    assert.match(src, /ORGANISER_NAME_SQL/);
    assert.match(src, /PROPERTY_WEBSITE_SQL/);
    assert.doesNotMatch(src, /g\.contact_name/);
    assert.doesNotMatch(src, /SELECT name, check_in_from::text, check_out_by::text, website/);
    assert.match(src, /staff_new_enquiry/);
    assert.match(src, /console\.error/);
    assert.match(src, /queueStaffNewEnquiry/);
    assert.match(mail, /LOGGED/);
    assert.match(src, /sendEmail/);
  });

  it("does not swallow a scheduler failure", () => {
    const server = read("../../services/platform-api/src/server.ts");
    const groups = read("../../services/platform-api/src/groups.ts");
    const guest = read("../../services/platform-api/src/guestPortal.ts");
    assert.match(guest, /queueStaffNewEnquiry/);
    assert.doesNotMatch(server, /catch \{\}/);
    assert.match(server, /reportSchedulerError/);
    assert.match(groups, /reportSchedulerError/);
    assert.doesNotMatch(groups, /scheduleAutoComms\([\s\S]*catch \{\}/);
  });
});
