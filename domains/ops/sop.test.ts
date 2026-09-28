import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sopSlug, uniqueSlug } from "./sop.ts";

describe("SOP slugs", () => {
  it("makes a linkable slug from a title", () => {
    assert.equal(sopSlug("Kitchen opening checks"), "kitchen-opening-checks");
    assert.equal(sopSlug("  "), "sop");
  });

  it("does not collide with a slug already in the library", () => {
    assert.equal(uniqueSlug("Kitchen opening checks", ["kitchen-opening-checks"]), "kitchen-opening-checks-2");
  });
});
