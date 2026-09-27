import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dietFlags, isHouseDefaultDiet } from "./diet.ts";

describe("house diet", () => {
  it("treats vegetarian, no eggs and no onion family as the default", () => {
    assert.equal(isHouseDefaultDiet({ diet: ["vegetarian"] }), true);
    assert.equal(isHouseDefaultDiet({ diet: ["vegetarian", "no_onion_garlic", "eggless"] }), true);
    assert.deepEqual(dietFlags({ diet: ["no_onion_garlic"] }), []);
  });

  it("flags real exceptions and still records allergens the kitchen must see", () => {
    const flags = dietFlags({ diet: ["vegan", "jain"], allergens: ["nuts", "cereals_gluten"], notes: "severe" });
    assert.deepEqual(flags.map(f => f.code), ["vegan", "jain", "nuts", "cereals_gluten", "notes"]);
    assert.match(flags.find(f => f.code === "jain")!.label, /root vegetables/i);
  });

  it("does not treat a plain vegetarian guest as a special request", () => {
    assert.equal(isHouseDefaultDiet({ diet: [], allergens: [], notes: "" }), true);
    assert.equal(isHouseDefaultDiet({ diet: ["dairy_free"], allergens: ["milk"] }), false);
  });
});
