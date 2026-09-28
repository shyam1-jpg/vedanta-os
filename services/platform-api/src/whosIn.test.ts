import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("./whosIn.ts", import.meta.url), "utf8");

test("who's in reads the briefing facts and the check-in labels", () => {
  assert.match(server, /whosInRoutes/);
  assert.match(api, /factsFor/);
  assert.match(api, /checkInLabels/);
  assert.equal(api.includes("from booking_group"), false);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
});
