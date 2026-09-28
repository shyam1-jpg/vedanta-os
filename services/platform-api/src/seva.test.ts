import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const briefing = readFileSync(new URL("./briefing.ts", import.meta.url), "utf8");
const seva = readFileSync(new URL("./seva.ts", import.meta.url), "utf8");

test("seva is a roster on the existing stay link, not a second scheduler", () => {
  assert.match(server, /sevaRoutes/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.equal(seva.includes("setInterval"), false);
  assert.match(briefing, /sevaBriefing/);
  assert.match(seva, /unsupervised: not bookable/);
  assert.equal(seva.includes("ALLOW_UNVERIFIED_GUEST_BOOTSTRAP"), false);
});
