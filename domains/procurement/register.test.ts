import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stockNotices } from "../ops/stock.ts";
import {
  EXAMPLE_SUPPLIERS,
  deliveryAlert,
  deliveryNotices,
  isFoodSupplier,
  nextDelivery,
  parseDelivery,
  parseSupplier,
} from "./register.ts";

describe("supplier register", () => {
  it("uses only obviously fake examples", () => {
    for (const supplier of EXAMPLE_SUPPLIERS) {
      assert.match(supplier.name, /^Example /);
      assert.match(supplier.email, /\.invalid$/);
    }
  });

  it("knows when a delivery is due or overdue, and when the next one is", () => {
    assert.equal(deliveryAlert("2026-09-28", "2026-09-28"), "today");
    assert.equal(deliveryAlert("2026-09-01", "2026-09-28"), "overdue");
    assert.equal(deliveryAlert("2026-10-01", "2026-09-28"), null);
    assert.equal(nextDelivery("2026-09-28", ["thu"], null, null), "2026-10-01");
    assert.equal(nextDelivery("2026-09-28", [], 2, "week"), "2026-10-12");
  });

  it("tells the kitchen about a food delivery and the orderer about every delivery", () => {
    const food = deliveryNotices({ name: "Example Dry Goods", kind: "today", due: "2026-09-28" }, true, { kitchen: "kitchen@example.invalid", buyer: "buyer@example.invalid" });
    assert.deepEqual(food.map(n => n.audience), ["kitchen", "buyer"]);
    const parts = deliveryNotices({ name: "Example Fixings", kind: "missed", due: "2026-09-28" }, false, { kitchen: "kitchen@example.invalid", buyer: "buyer@example.invalid" });
    assert.deepEqual(parts.map(n => n.audience), ["buyer"]);
    assert.equal(isFoodSupplier(["food", "cleaning"]), true);
  });

  it("rejects a real-looking gap and a bad delivery result", () => {
    assert.equal(parseSupplier({ name: "A", categories: ["food"] }).ok, false);
    const parsed = parseSupplier({ name: "Example Dry Goods", categories: ["food"], email: "not an email" });
    assert.equal(parsed.ok, false);
    const ok = parseSupplier({ name: "Example Dry Goods", categories: ["food"], email: "orders@example-dry-goods.invalid", days: ["mon"], next_delivery: "2026-10-01", active: true });
    assert.equal(ok.ok, true);
    assert.equal(parseDelivery({ status: "late" }).ok, false);
    assert.equal(parseDelivery({ status: "partial", note: "Short on rice" }).ok, true);
  });

  it("adds the preferred supplier to a low-stock note", () => {
    const notes = stockNotices(
      { name: "Basmati rice", quantity: 2, unit: "kg", threshold: 5 },
      { kitchen: "kitchen@example.invalid", buyer: "" },
      { name: "Example Dry Goods", phone: "01600 000111", email: "orders@example-dry-goods.invalid" },
    );
    assert.match(notes[0].body, /Example Dry Goods/);
    assert.match(notes[0].body, /01600 000111/);
  });
});
