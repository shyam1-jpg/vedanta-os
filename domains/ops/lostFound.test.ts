import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  disposalDue,
  heldTooLong,
  lostGuestMessage,
  matchScore,
  nextLostStatus,
  parseFoundItem,
  parseKeep,
  parseLostSettings,
  parseMissingReport,
  parseReturnChoice,
  parseSignature,
  parseStatusChange,
  rankMatches,
  renderSlipPdf,
  slipLines,
  suggestMatches,
} from "./lostFound.ts";

describe("lost and found status", () => {
  it("allows a claim and a return, and refuses a jump", () => {
    assert.equal(nextLostStatus("logged", "claimed"), "claimed");
    assert.equal(nextLostStatus("logged", "returned"), null);
    const returned = parseStatusChange({ status: "returned", claimant_name: "A Guest", return_method: "posted" }, "claimed");
    assert.equal(returned.ok, true);
    if (returned.ok) assert.equal(returned.method, "posted");
    assert.equal(parseStatusChange({ status: "returned", claimant_name: "A Guest" }, "claimed").ok, false);
  });
});

describe("lost and found matches", () => {
  it("prefers the same words, category, place, and a close date", () => {
    const report = { description: "Black wool scarf", category: "clothing", place: "Room 12", happened_on: "2026-09-20" };
    const close = { id: "a", description: "Black scarf on the chair", category: "clothing", place: "Room 12", found_on: "2026-09-21", status: "logged" };
    const far = { id: "b", description: "Phone charger", category: "electronics", place: "Halls", found_on: "2026-01-01", status: "logged" };
    const gone = { ...close, id: "c", status: "returned" };
    assert.equal(matchScore(report, close) > matchScore(report, far), true);
    assert.equal(matchScore(report, gone), 0);
    assert.deepEqual(suggestMatches(report, [far, close, gone]).map(item => item.id), ["a"]);
  });
});

describe("lost and found retention", () => {
  it("flags an item held past the limit and clears the setting of a bad email", () => {
    assert.equal(heldTooLong("2026-06-01", "2026-09-28", 90, "logged"), true);
    assert.equal(heldTooLong("2026-09-01", "2026-09-28", 90, "logged"), false);
    assert.equal(heldTooLong("2026-01-01", "2026-09-28", 90, "returned"), false);
    assert.equal(parseLostSettings({ hold_days: 2, manager: "not an email" }).hold_days, 7);
    assert.equal(parseLostSettings({}).hold_days, 90);
  });

  it("asks for a description and a place", () => {
    assert.equal(parseFoundItem({ description: "Scarf", category: "clothing", found_on: "2026-09-01" }).ok, false);
    const found = parseFoundItem({ description: "Black scarf", category: "clothing", place: "Room 12", found_on: "2026-09-01", storage: "Front desk drawer" });
    assert.equal(found.ok, true);
    assert.equal(parseMissingReport({ description: "Scarf", category: "clothing", contact_email: "not-an-email" }).ok, false);
    const report = parseMissingReport({ description: "Black scarf", category: "clothing", contact_email: "guest@example.invalid" });
    assert.equal(report.ok, true);
  });

  it("uses a 30 day disposal clock, a postage note, and a guest link that lasts 14 days", () => {
    const settings = parseLostSettings({});
    assert.equal(settings.disposal_days, 30);
    assert.equal(settings.postage_note, "Postage cost TBC");
    assert.equal(settings.link_days, 14);
    assert.equal(parseLostSettings({ disposal_days: 0, postage_note: "  Postage £4  ", link_days: 90 }).disposal_days, 1);
    assert.equal(parseLostSettings({ postage_note: "Postage £4", link_days: 90 }).postage_note, "Postage £4");
    assert.equal(parseLostSettings({ link_days: 90 }).link_days, 60);
  });

  it("requires a reason to dispose and a recipient to donate", () => {
    assert.equal(parseStatusChange({ status: "disposed" }, "logged").ok, false);
    assert.equal(parseStatusChange({ status: "donated", recipient: "Oxfam" }, "logged").ok, false);
    const donated = parseStatusChange({ status: "donated", recipient: "Oxfam", note: "Unclaimed after the hold" }, "logged");
    assert.equal(donated.ok, true);
    if (donated.ok) assert.equal(donated.recipient, "Oxfam");
    const disposed = parseStatusChange({ status: "disposed", note: "Damaged beyond use" }, "matched");
    assert.equal(disposed.ok, true);
  });
});

describe("lost and found ranking", () => {
  it("explains the match and ranks a room from the stay above the same item elsewhere", () => {
    const report = { description: "blue umbrella", category: "other", rooms: ["12"], stay_from: "2026-09-01", stay_to: "2026-09-08" };
    const inRoom = { id: "room", description: "blue umbrella", category: "other", place: "Room 12", found_on: "2026-09-04", status: "logged" };
    const hall = { id: "hall", description: "blue umbrella", category: "other", place: "Hall", found_on: "2026-09-04", status: "logged" };
    const ranked = rankMatches(report, [hall, inRoom]);
    assert.equal(ranked[0].item.id, "room");
    assert.equal(ranked[0].reasons.includes("Found in a room from the stay"), true);
    assert.equal(ranked[0].reasons.some(reason => reason.startsWith("Same words:")), true);
    assert.deepEqual(rankMatches(report, [hall, inRoom], ["room"]).map(row => row.item.id), ["hall"]);
  });

  it("accepts a close wording when the words are not exact", () => {
    const ranked = rankMatches(
      { description: "charger cable" },
      [{ id: "c", description: "chargers left in the lounge", status: "logged", found_on: "2026-09-01" }],
    );
    assert.equal(ranked[0].reasons.includes("Similar wording"), true);
  });
});

describe("lost property return", () => {
  it("flags disposal from the found date, or from the notification, unless it is kept longer", () => {
    assert.equal(disposalDue({ foundOn: "2026-08-01", today: "2026-09-28", disposalDays: 30, status: "logged" }), true);
    assert.equal(disposalDue({ foundOn: "2026-09-10", today: "2026-09-28", disposalDays: 30, status: "logged" }), false);
    assert.equal(disposalDue({ foundOn: "2026-08-01", notifiedOn: "2026-09-20", today: "2026-09-28", disposalDays: 30, status: "matched" }), false);
    assert.equal(disposalDue({ foundOn: "2026-08-01", holdUntil: "2026-10-01", today: "2026-09-28", disposalDays: 30, status: "logged" }), false);
    assert.equal(disposalDue({ foundOn: "2026-01-01", today: "2026-09-28", disposalDays: 30, status: "returned" }), false);
  });

  it("writes a guest message with the link and no payment", () => {
    const message = lostGuestMessage({ house: "The Vedanta", item: "Black scarf", link: "https://example.invalid/lost-return/?t=abc" });
    assert.match(message.body, /https:\/\/example\.invalid\/lost-return\/\?t=abc/);
    assert.match(message.body, /No payment is taken/);
    assert.match(message.sms, /no payment/);
    assert.match(message.subject, /The Vedanta/);
  });

  it("accepts collection with a date and time, or postage with an address", () => {
    const collection = parseReturnChoice({ choice: "collection", date: "2026-10-02", time: "14:30" });
    assert.equal(collection.ok, true);
    if (collection.ok) assert.equal(collection.detail, "Collection on 2026-10-02 at 14:30");
    assert.equal(parseReturnChoice({ choice: "collection", date: "2026-10-02" }).ok, false);
    const postage = parseReturnChoice({ choice: "postage", address: "1 Example Lane, Testtown" });
    assert.equal(postage.ok, true);
    if (postage.ok) assert.match(postage.detail, /^Postage to /);
    assert.equal(parseReturnChoice({ choice: "postage", address: "short" }).ok, false);
    assert.equal(parseKeep({ until: "2026-09-28", reason: "Owner is travelling" }, "2026-09-28").ok, false);
    assert.equal(parseKeep({ until: "2026-10-20", reason: "Owner is travelling" }, "2026-09-28").ok, true);
  });

  it("stores a drawn signature and prints an A5 or A4 slip", () => {
    assert.equal(parseSignature({ signature: "not-an-image" }).ok, false);
    const signature = parseSignature({ signature: `data:image/png;base64,${"A".repeat(40)}` });
    assert.equal(signature.ok, true);
    const lines = slipLines({
      reference: "LF-ABCDEF12",
      description: "Black scarf",
      foundPlace: "Room 12",
      foundOn: "2026-09-21",
      guestName: "A Guest",
      bookingRef: "VG10001",
      method: "Collected",
      handler: "Front desk",
      hasPhoto: true,
    });
    assert.equal(lines.includes("Reference LF-ABCDEF12"), true);
    assert.equal(lines.includes("Guest signature"), true);
    const a4 = Buffer.from(renderSlipPdf(lines, "a4")).toString("latin1");
    assert.match(a4, /^%PDF-1\.4/);
    assert.match(a4, /0 0 595 842/);
    assert.match(a4, /LF-ABCDEF12/);
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
    ]);
    const a5 = Buffer.from(renderSlipPdf(lines, "a5", jpeg)).toString("latin1");
    assert.match(a5, /0 0 420 595/);
    assert.match(a5, /DCTDecode/);
  });
});
