import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chapterToPocketBody,
  defaultManual,
  HOUSE_MANUALS,
  MANUAL_KINDS,
  MANUAL_PLACEHOLDER_NOTE,
  manualsForDepartment,
  missingManualChapters,
  parseManualCatalogue,
  parseManualStatus,
} from "./manual.ts";
import { LEGACY_HOUSE_MANUALS, legacyManual } from "./manual-legacy.ts";

const SECTIONS = [
  "Welcome and how to use this manual",
  "Organisation and roles",
  "Arrival and departure procedures",
  "Guest services",
  "Housekeeping",
  "Kitchen and food safety",
  "Allergen and special diet management",
  "Health, safety and fire",
  "Security and emergency procedures",
  "Maintenance and reporting faults",
  "Accessibility",
  "Data protection and confidentiality",
  "Staff conduct and wellbeing",
  "Rotas, leave and timekeeping",
  "Suppliers and deliveries",
  "Sustainability",
  "Contacts",
];

describe("placeholder house manual", () => {
  it("lists generic sections and nothing property-specific", () => {
    assert.deepEqual(HOUSE_MANUALS.map(c => c.title), SECTIONS);
    assert.equal(new Set(HOUSE_MANUALS.map(c => c.slug)).size, HOUSE_MANUALS.length);
    assert.ok(HOUSE_MANUALS.every(c => c.steps.length === 0 && c.diagram.length === 0));
    assert.equal(defaultManual("welcome")?.title, SECTIONS[0]);
    assert.equal(manualsForDepartment("HOUSE").length, HOUSE_MANUALS.length);
    const banned = /\b(vedanta|kiteline|parslia|oway|walkers|nairn|suma|kyoto|paris|london|lincoln|branston|ritz|omotenashi|whatsapp)\b/i;
    const american = /\b(organization|color|behavior|center|labeled)\b/i;
    for (const ch of HOUSE_MANUALS) {
      const blob = `${ch.title}\n${ch.summary}\n${ch.body}`;
      assert.doesNotMatch(blob, banned, ch.slug);
      assert.doesNotMatch(blob, american, ch.slug);
      assert.match(ch.summary, /\.$/);
      assert.match(ch.body, /\.$/);
      assert.ok(ch.summary.split(/[.!?]/).filter(s => s.trim()).length <= 2, ch.slug);
      assert.ok(ch.body.split(/[.!?]/).filter(s => s.trim()).length <= 2, ch.slug);
    }
    assert.match(chapterToPocketBody(defaultManual("welcome")!), new RegExp(MANUAL_PLACEHOLDER_NOTE));
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    assert.match(readFileSync(join(root, "apps/web-admin/components/HouseManual.tsx"), "utf8"), new RegExp(MANUAL_PLACEHOLDER_NOTE));
    assert.match(readFileSync(join(root, "apps/web-staff/app/page.tsx"), "utf8"), new RegExp(MANUAL_PLACEHOLDER_NOTE));
  });

  it("inserts only missing slugs and does not touch chapters already stored", () => {
    const existing = ["welcome", "housekeeping"];
    const missing = missingManualChapters(existing);
    assert.ok(missing.every(c => !existing.includes(c.slug)));
    assert.equal(missing.length, HOUSE_MANUALS.length - 2);
    assert.equal(missingManualChapters(HOUSE_MANUALS.map(c => c.slug)).length, 0);
  });

  it("keeps the earlier chapters in the repo, off the default list", () => {
    assert.ok(LEGACY_HOUSE_MANUALS.length >= 10);
    assert.equal(legacyManual("night-porter")?.department, "NIGHT");
    assert.match(legacyManual("kitchen-brigade")?.body ?? "", /brigade/i);
    assert.match(chapterToPocketBody(legacyManual("app-receive-and-act")!), /Look:/);
    const legacySlugs = new Set(LEGACY_HOUSE_MANUALS.map(c => c.slug));
    for (const ch of HOUSE_MANUALS) assert.equal(legacySlugs.has(ch.slug), false, ch.slug);
    assert.equal(parseManualStatus("withdrawn"), "withdrawn");
    assert.equal(parseManualStatus("live"), "live");
    assert.equal(parseManualCatalogue("archive"), "archive");
    assert.equal(parseManualCatalogue("current"), "current");
    assert.ok(MANUAL_KINDS.includes("APP"));
  });

  it("archives earlier slugs in a migration that does not delete or rewrite them", () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations/0045_manual_placeholders.sql"), "utf8");
    for (const ch of LEGACY_HOUSE_MANUALS) assert.match(sql, new RegExp(`'${ch.slug}'`));
    assert.match(sql, /catalogue = 'archive'/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS catalogue/);
    assert.doesNotMatch(sql, /delete\s+from\s+house_manual/i);
    assert.doesNotMatch(sql, /set\s+(title|summary|body|steps|diagram|status)\s*=/i);
  });
});
