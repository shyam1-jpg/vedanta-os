import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "cowCare.ts"), "utf8");
const seva = readFileSync(join(here, "seva.ts"), "utf8");
const gallery = readFileSync(join(here, "gallery.ts"), "utf8");
const server = readFileSync(join(here, "server.ts"), "utf8");
const migration = readFileSync(join(here, "../../../db/migrations/0069_cow_care.sql"), "utf8");

describe("cow care wiring", () => {
  it("stays off, keeps the bull off guest paths, and does not add a second timer", () => {
    assert.match(api, /Cow care is off/);
    assert.match(api, /The cows are cared for and are never milked/);
    assert.match(api, /guest_facing/);
    assert.match(seva, /sevaAnimalForSlot/);
    assert.match(seva, /sevaSlotForGuest/);
    assert.match(gallery, /staffOnlyAnimalNames|shieldGuestPhoto/);
    assert.equal(api.includes("setInterval"), false);
    assert.equal((server.match(/setInterval\(runComms/g) ?? []).length, 1);
    assert.match(server, /cowCareRoutes/);
  });

  it("seeds placeholder names only, with the bull hidden and no dairy fields", () => {
    assert.match(migration, /example-daisy/);
    assert.match(migration, /example-bull/);
    assert.match(migration, /guest_facing = false/);
    assert.match(migration, /seva_animal_bull_hidden/);
    assert.match(migration, /Example Keeper/);
    assert.match(migration, /Example Vet/);
    assert.equal(/\b(milk|milking|dairy)\b/i.test(migration), false);
    assert.equal(migration.includes("@"), false);
  });
});
