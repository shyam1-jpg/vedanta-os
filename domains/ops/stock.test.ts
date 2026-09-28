import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_STOCK, applyCount, exampleListIsVegetarian, groupOrders, orderMessage, packsToOrder, parseReorderSettings, parseStockRouting, stockAlert, stockNotices, vegetarianName } from "./stock.ts";

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

  it("rounds an order up to whole packs and keeps it as a draft until a supplier is allowed to be emailed", () => {
    assert.equal(parseReorderSettings({}).enabled, false);
    assert.equal(packsToOrder({ quantity: 3, par: 10, threshold: 4, packSize: 4 }), 2);
    assert.equal(packsToOrder({ quantity: 4, par: 10, threshold: 4, packSize: 4 }), 0);
    assert.equal(packsToOrder({ quantity: 1, par: 0, threshold: 4, packSize: 1 }), 0);
    const rice = {
      id: "rice", name: "Basmati rice", unit: "kg", quantity: 2, par: 20, threshold: 5, low: 5, packSize: 5,
      supplierId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", supplierName: "Example Mill", supplierEmail: "mill@example.invalid",
    };
    const oats = { ...rice, id: "oats", name: "Oat milk", quantity: 1, par: 12, packSize: 6, unit: "litres" };
    const towels = { ...rice, id: "towels", name: "Paper towels", supplierId: null, supplierName: null, supplierEmail: null, quantity: 1, par: 6, packSize: 2, unit: "packs" };
    const held = groupOrders([rice, oats, towels], parseReorderSettings({ enabled: false }));
    assert.equal(held.length, 0);
    const drafts = groupOrders([rice, oats, towels, { ...rice, id: "bad", name: "Onion powder" }], parseReorderSettings({ enabled: true, auto_send: {} }));
    assert.equal(drafts.length, 2);
    const mill = drafts.find(order => order.supplierName === "Example Mill");
    assert.equal(mill?.autoSend, false);
    assert.equal(mill?.lines.length, 2);
    assert.equal(mill?.lines.find(line => line.name === "Basmati rice")?.quantity, 20);
    const loose = drafts.find(order => order.supplierKey === "");
    assert.equal(loose?.autoSend, false);
    const sent = groupOrders([rice], parseReorderSettings({ enabled: true, auto_send: { [rice.supplierId]: true } }));
    assert.equal(sent[0].autoSend, true);
    assert.match(orderMessage(sent[0]).body, /no eggs/);
    assert.equal(vegetarianName("Free range eggs").ok, false);
    assert.equal(vegetarianName("Chickpeas").ok, true);
  });

  it("seeds only vegetarian examples, with no egg and no onion or garlic family", () => {
    assert.equal(exampleListIsVegetarian(), true);
    assert.deepEqual(EXAMPLE_STOCK.map(i => i.name), [
      "Basmati rice", "Chickpeas", "Ghee", "Oat milk", "Paper towels", "Dishwasher detergent",
    ]);
  });
});