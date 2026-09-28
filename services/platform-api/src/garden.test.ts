import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "garden.ts"), "utf8");
const sustain = readFileSync(join(here, "sustainability.ts"), "utf8");
const server = readFileSync(join(here, "server.ts"), "utf8");
const migration = readFileSync(join(here, "../../../db/migrations/0070_garden.sql"), "utf8");

describe("garden wiring", () => {
  it("keeps the log off, records garden stock, and does not add a timer", () => {
    assert.match(api, /The garden log is off/);
    assert.match(api, /source: "garden"/);
    assert.match(api, /From the garden/);
    assert.match(api, /gardenDashboard/);
    assert.match(sustain, /gardenDashboard/);
    assert.equal(api.includes("setInterval"), false);
    assert.equal((server.match(/setInterval\(runComms/g) ?? []).length, 1);
    assert.match(server, /gardenRoutes/);
  });

  it("seeds placeholder beds only, and refuses catering waste for the cows", () => {
    assert.match(migration, /Example kale/);
    assert.match(migration, /Example bed/);
    assert.match(migration, /source text/);
    assert.match(migration, /'garden'/);
    assert.match(migration, /destination IS DISTINCT FROM 'cows'/);
    assert.match(migration, /origin = 'plot'/);
    assert.equal(/\b(milk|milking|dairy)\b/i.test(migration), false);
    assert.equal(migration.includes("@"), false);
  });
});
