import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "maintenance.ts"), "utf8");
const migration = readFileSync(join(here, "../../../db/migrations/0041_fault_report.sql"), "utf8");
const seed = readFileSync(join(here, "../../../db/seed/0024_fault_report_everyone.sql"), "utf8");

describe("fault report wiring", () => {
  it("records the signed-in person as the reporter and does not trust a name from the form", () => {
    const post = src.slice(src.indexOf('f.post("/maintenance"'), src.indexOf('"/maintenance/:id/notes"'));
    assert.match(post, /reported_by_user_id/);
    assert.match(post, /a\.userId/);
    assert.equal(post.includes("b.reported_by"), false);
    assert.equal(post.includes("body.reported_by"), false);
    assert.match(post, /reportNotices/);
  });

  it("accepts a pocket staff session and emails status changes", () => {
    assert.match(src, /\["ADMIN", "STAFF"\]/);
    assert.match(src, /statusNotices/);
    assert.match(src, /sendEmail/);
    assert.match(src, /maintenance\.report/);
  });

  it("extends the existing ticket instead of a second issues table", () => {
    assert.match(migration, /ALTER TABLE maintenance_ticket/);
    assert.match(migration, /ACKNOWLEDGED/);
    assert.match(migration, /food_safety/);
    assert.match(migration, /asset_id/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS maintenance_note/);
    assert.equal(migration.toLowerCase().includes("create table maintenance_ticket"), false);
    assert.match(seed, /maintenance\.report/);
    assert.match(seed, /FROM role r/);
  });
});
