import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "sustainability.ts"), "utf8");
const server = readFileSync(join(here, "server.ts"), "utf8");
const migration = readFileSync(join(here, "../../../db/migrations/0068_sustainability.sql"), "utf8");

describe("sustainability wiring", () => {
  it("hides the public summary until the flag is on, and does not add a second timer", () => {
    assert.match(api, /publicSummary/);
    assert.match(api, /if \(!settings\.enabled\) return reply\.code\(404\)/);
    assert.match(api, /The cows are cared for and are never milked/);
    assert.equal(api.includes("setInterval"), false);
    assert.equal((server.match(/setInterval\(runComms/g) ?? []).length, 1);
  });

  it("seeds example figures only, with no dairy production", () => {
    assert.match(migration, /Example reading/);
    assert.match(migration, /waste_plate/);
    assert.match(migration, /goshala_care/);
    assert.equal(/\b(milk|milking|dairy)\b/i.test(migration), false);
    assert.equal(migration.includes("@"), false);
  });
});
