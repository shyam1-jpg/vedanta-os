import assert from "node:assert/strict";
import test from "node:test";
import { guestMaySee, parseGallerySettings, publicGallery, reviewPhoto, seedPhotos } from "./gallery.ts";

const photos = seedPhotos();

test("the gallery stays off, and the bull is never on the public list", () => {
  assert.equal(parseGallerySettings({}).enabled, false);
  assert.equal(publicGallery(photos, { enabled: false }).length, 0);
  const open = publicGallery(photos, { enabled: true });
  assert.equal(open.some(photo => photo.showsBull || /bull/i.test(photo.title + photo.caption + photo.alt)), false);
  assert.equal(open.some(photo => photo.id === "goshala"), true);
  const cow = open.find(photo => photo.id === "goshala")!;
  assert.match(cow.caption, /supervised/i);
  assert.match(cow.caption, /gentle/i);
  assert.match(cow.caption, /Example Daisy/);
  assert.equal(open.every(photo => photo.alt.length > 0 && photo.licence.includes("No person")), true);
});

test("a bull marked for guests, a person, or a cow caption without supervision stays off the list", () => {
  const bull = { ...photos.find(photo => photo.id === "bull")!, audience: "guest" as const };
  assert.equal(guestMaySee(bull), false);
  const person = { ...photos[0], showsPeople: true };
  assert.equal(guestMaySee(person), false);
  const unsupervised = { ...photos.find(photo => photo.id === "goshala")!, caption: "A cow in a field" };
  assert.equal(guestMaySee(unsupervised), false);
  const alone = { ...photos.find(photo => photo.id === "goshala")!, caption: "Supervised seva with a gentle cow, alone" };
  assert.equal(guestMaySee(alone), false);
  const saved = reviewPhoto({ category: "goshala", title: "Example Daisy", alt: "A gentle cow. No people.", caption: "Just a cow", src: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E", audience: "guest" }, "x");
  assert.equal(saved.ok, false);
  const forced = reviewPhoto({ category: "goshala", title: "Example Bull", alt: "A bull. No people.", caption: "Staff only", src: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E", audience: "guest", showsBull: true }, "y");
  assert.equal(forced.ok, true);
  if (forced.ok) assert.equal(forced.photo.audience, "staff");
  const renamed = { ...photos[0], title: "The grounds", caption: "A quiet field with Example Storm.", alt: "Trees and a lawn. No people." };
  assert.equal(guestMaySee(renamed, ["Example Storm"]), false);
  assert.equal(publicGallery([renamed], { enabled: true }, ["Example Storm"]).length, 0);
});
