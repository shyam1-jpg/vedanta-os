import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const fault = readFileSync(new URL("./guestFault.ts", import.meta.url), "utf8");
const maintenance = readFileSync(new URL("./maintenance.ts", import.meta.url), "utf8");

test("a guest problem opens a maintenance ticket and follows the existing notices", () => {
  assert.match(server, /guestFaultRoutes/);
  assert.match(fault, /reportNotices/);
  assert.match(fault, /maintenance_ticket/);
  assert.match(maintenance, /notifyGuestFollowUp/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.equal(fault.includes("setInterval"), false);
});
