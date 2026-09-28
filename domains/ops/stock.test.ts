import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_STOCK, applyCount, exampleListIsVegetarian, parseStockRouting, stockAlert, stockNotices } from "./stock.ts";

describe("kitchen stock counts", () => {
  it("logs a use, a restock and a set count, and will not go below zero", () => {
    const used = applyCount(10, "use", 2);
    assert.equal(used.ok, true);
    if (!used.ok) return;
    assert.equal(used.next, 8);
    assert.equal(used.delta, -2);
    const added = applyCount(8, "restock", 4);
    assert.equal(added.ok, true);
    if (!added.ok) return;
    assert.equal(added.next, 12);
    const set = applyCount(12, "set", 3);
    assert.equal(set.ok, true);
    if (!set.ok) return;
    assert.equal(set.next, 3);
    assert.equal(applyCount(1, "use", 2).ok, false);
  });

  it("alerts the kitchen once, then stays quiet until the item is restocked", () => {
    assert.equal(stockAlert(10, 2, 5, false), "send");
    assert.equal(stockAlert(2, 1, 5, true), "quiet");
    assert.equal(stockAlert(1, 8, 5, true), "clear");
    assert.equal(stockAlert(8, 3, 5, false), "send");
  });

  it("copies the ordering person and does not invent an address", () => {
    const notes = stockNotices({ name: "Oat milk", quantity: 1, unit: "litres", threshold: 4 }, {
      kitchen: "kitchen@example.invalid",
      buyer: "stores@example.invalid",
    });
    assert.deepEqual(notes.map(n => n.audience), ["kitchen", "buyer"]);
    assert.equal(notes[0].body.includes("Oat milk"), true);
    assert.equal(stockNotices({ name: "Ghee", quantity: 0, unit: "kg", threshold: 1 }, { kitchen: "", buyer: "" }).length, 0);
    const parsed = parseStockRouting({ kitchen: "not an email", buyer: "Buyer@Example.invalid" });
    assert.equal(parsed.kitchen, "");
    assert.equal(parsed.buyer, "buyer@example.invalid");
  });

  it("seeds only vegetarian examples, with no egg and no onion or garlic family", () => {
    assert.equal(exampleListIsVegetarian(), true);
    assert.deepEqual(EXAMPLE_STOCK.map(i => i.name), [
      "Basmati rice", "Chickpeas", "Ghee", "Oat milk", "Paper towels", "Dishwasher detergent",
    ]);
  });
});