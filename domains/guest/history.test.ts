import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allergenCard,
  allergenDue,
  canEditNote,
  matchGuest,
  parseRetentionSettings,
  profileDue,
  profileView,
  projectProfile,
  projectSearch,
  retentionMarker,
  textDue,
  textPdf,
  viewFor,
  type ProfileBundle,
} from "./history.ts";

const known = [
  { id: "a", givenName: "Asha", familyName: "Patel", email: "Asha@Example.invalid", phone: "+44 7700 900123", dateOfBirth: "1980-04-02", postcode: "SW1A 1AA" },
  { id: "b", givenName: "Jon", familyName: "Smith", email: "jon@example.invalid", phone: "07700900456", dateOfBirth: "1975-01-01", postcode: "E1 6AN" },
  { id: "c", givenName: "Merged", familyName: "Away", email: "merged@example.invalid", phone: "07700900999", mergedInto: "a" },
];

describe("returning guest matching", () => {
  it("auto-links an exact email after normalising it", () => {
    const hits = matchGuest({ givenName: "Asha", familyName: "Patel", email: " asha@example.invalid " }, known);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, "a");
    assert.equal(hits[0].strength, "email");
    assert.equal(hits[0].autoLink, true);
  });

  it("offers a phone match to confirm, and ignores a merged profile", () => {
    const hits = matchGuest({ givenName: "Someone", familyName: "Else", phone: "07700 900456" }, known);
    assert.deepEqual(hits, [{ id: "b", strength: "phone", autoLink: false }]);
    assert.equal(matchGuest({ givenName: "Merged", familyName: "Away", phone: "07700900999" }, known).length, 0);
  });

  it("uses a fuzzy name only with date of birth or postcode", () => {
    const dob = matchGuest({ givenName: "John", familyName: "Smith", dateOfBirth: "1975-01-01" }, known);
    assert.equal(dob[0]?.id, "b");
    assert.equal(dob[0]?.strength, "name_dob");
    assert.equal(dob[0]?.autoLink, false);
    const postcode = matchGuest({ givenName: "John", familyName: "Smith", postcode: "e1 6an" }, known);
    assert.equal(postcode[0]?.strength, "name_postcode");
    assert.equal(matchGuest({ givenName: "John", familyName: "Smith" }, known).length, 0);
  });

  it("prefers email over a weaker phone or name match", () => {
    const hits = matchGuest({
      givenName: "John", familyName: "Smith", email: "asha@example.invalid", phone: "07700900456", dateOfBirth: "1975-01-01",
    }, known);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].strength, "email");
  });
});

describe("role visibility", () => {
  it("keeps kitchen on diet, front of house on contact, and managers on the whole profile", () => {
    assert.equal(profileView("HEAD_CHEF", ["guest.read", "diet.read", "guest.profile.kitchen"]), "kitchen");
    assert.equal(profileView("RECEPTIONIST", ["guest.read", "guest.profile.front"]), "front");
    assert.equal(profileView("GENERAL_MANAGER", ["guest.read"]), "manager");
    assert.equal(profileView("FRONT_OFFICE_MANAGER", []), "manager");
    const bundle = {
      id: "a", name: "Asha Patel", email: "asha@example.invalid", phone: "07700900123", organisation: null,
      dateOfBirth: "1980-04-02", postcode: "SW1A1AA", vip: true, preferences: "quiet room", accessibility: "ground floor",
      roomPreference: "ground floor", specialRequests: null, notes: [{ id: "n", body: "private", authorId: "u", author: "Sam", at: "2026-01-01" }],
      allergens: [{ code: "nuts", severity: "ALLERGY" }], diet: ["vegan"], allergenLine: "nuts (allergy)", thisStay: null,
      previousStays: 2, lastVisit: "2026-08-01", pastIssues: ["room complaint"], compliments: ["kind word"],
      feedback: [], stays: [], consent: true, consentAt: "2026-01-01", withdrawnAt: null, marker: null,
    } satisfies ProfileBundle;
    const kitchen = projectProfile(bundle, "kitchen");
    assert.equal("email" in kitchen, false);
    assert.equal("notes" in kitchen, false);
    assert.equal(kitchen.allergen_line, "nuts (allergy)");
    const front = projectProfile(bundle, "front");
    assert.equal(front.email, "asha@example.invalid");
    assert.equal("allergens" in front, false);
    assert.equal("notes" in front, false);
    const search = projectSearch({
      id: "a", name: "Asha Patel", email: "asha@example.invalid", phone: "1", diet: ["vegan"], allergenLine: "nuts (allergy)", roomPreference: "quiet", vip: true,
    }, "kitchen");
    assert.equal("email" in search, false);
    assert.equal(search.allergen_line, "nuts (allergy)");
    assert.equal(viewFor("manager", "kitchen"), "kitchen");
    assert.equal(viewFor("kitchen", "front"), "none");
    assert.equal(viewFor("front", "profile"), "front");
  });
});

describe("consent and purge", () => {
  it("shows old allergens only when the guest has asked us to keep them", () => {
    const history = [{ code: "nuts", severity: "ANAPHYLAXIS" }];
    const kept = allergenCard({ consent: true, history, thisStay: [] });
    assert.match(kept.line, /nuts \(anaphylaxis\)/);
    const ask = allergenCard({ consent: false, history, thisStay: [] });
    assert.equal(ask.line, "allergens: ask again");
    const current = allergenCard({ consent: false, history, thisStay: [{ code: "milk", severity: "INTOLERANCE" }] });
    assert.equal(current.line, "milk (intolerance)");
    assert.equal(current.line.includes("nuts"), false);
  });

  it("purges allergen history 30 days after departure unless consent is in force", () => {
    const today = "2026-09-28";
    assert.equal(allergenDue({ departure: "2026-08-01", today, days: 30, consent: false, alreadyMarked: false, profileDue: false }), true);
    assert.equal(allergenDue({ departure: "2026-09-10", today, days: 30, consent: false, alreadyMarked: false, profileDue: false }), false);
    assert.equal(allergenDue({ departure: "2026-01-01", today, days: 30, consent: true, alreadyMarked: false, profileDue: false }), false);
    assert.equal(allergenDue({ departure: "2026-01-01", today, days: 30, consent: true, alreadyMarked: false, profileDue: true }), true);
    assert.equal(allergenDue({ departure: "2026-01-01", today, days: 30, consent: false, alreadyMarked: true, profileDue: false }), false);
  });

  it("purges feedback text, staff notes, and an inactive profile, and leaves a marker once", () => {
    const today = "2026-09-28";
    assert.equal(textDue("2024-09-27", today, 730, false), true);
    assert.equal(textDue("2026-09-01", today, 730, false), false);
    assert.equal(textDue("2020-01-01", today, 30, true), false);
    assert.equal(profileDue("2023-09-27", today, 36, false), true);
    assert.equal(profileDue("2024-01-01", today, 36, false), false);
    assert.equal(profileDue("2020-01-01", today, 36, true), false);
    assert.equal(retentionMarker("2026-09-28"), "deleted per retention policy on 2026-09-28");
    assert.equal(parseRetentionSettings({}).allergen_days_after_departure, 30);
    assert.equal(parseRetentionSettings({ allergen_days_after_departure: 14 }).allergen_days_after_departure, 14);
    assert.equal(parseRetentionSettings({ allergen_days_after_departure: 0 }).allergen_days_after_departure, 1);
  });

  it("lets the author or a manager edit a note", () => {
    assert.equal(canEditNote("author", "author", false), true);
    assert.equal(canEditNote("author", "other", false), false);
    assert.equal(canEditNote("author", "other", true), true);
  });

  it("builds a subject-access PDF and wires the purge job", () => {
    const pdf = textPdf("Guest profile", ["Asha Patel", "nuts (allergy)"]);
    assert.match(pdf, /^%PDF-1.4/);
    assert.match(pdf, /Asha Patel/);
    const server = readFileSync(new URL("../../services/platform-api/src/server.ts", import.meta.url), "utf8");
    const api = readFileSync(new URL("../../services/platform-api/src/guestHistory.ts", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../../db/migrations/0048_guest_history.sql", import.meta.url), "utf8");
    assert.match(server, /purgeGuestHistory/);
    assert.match(api, /guest-history\/search/);
    assert.match(api, /right-to-erasure|erase/);
    assert.match(migration, /diet_history/);
    assert.match(migration, /guest_staff_note/);
    assert.match(migration, /guest_access_log/);
  });
});
