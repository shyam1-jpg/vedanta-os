import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const gallery = readFileSync(new URL("./gallery.ts", import.meta.url), "utf8");

test("the gallery is a managed list on the guest site, and it stays off until switched on", () => {
  assert.match(server, /galleryRoutes/);
  assert.equal(server.match(/setInterval\(runComms/)?.length, 1);
  assert.equal(gallery.includes("setInterval"), false);
  assert.match(gallery, /publicGallery/);
  assert.match(gallery, /gallery\.manage/);
  assert.equal(gallery.includes("ALLOW_UNVERIFIED_GUEST_BOOTSTRAP"), false);
});
