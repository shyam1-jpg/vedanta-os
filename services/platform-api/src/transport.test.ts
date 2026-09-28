import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const journey = readFileSync(new URL("./journey.ts", import.meta.url), "utf8");
const transport = readFileSync(new URL("./transport.ts", import.meta.url), "utf8");

test("shuttles reuse the stay link and do not take payment", () => {
  assert.match(server, /transportRoutes/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.equal(transport.includes("setInterval"), false);
  assert.equal(transport.toLowerCase().includes("payment"), false);
  assert.match(journey, /shuttleNote/);
  assert.match(transport, /\/travel/);
});
