import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "suppliers.ts"), "utf8");
const stock = readFileSync(join(here, "kitchenStock.ts"), "utf8");
const seed = readFileSync(join(here, "../../../db/seed/0027_supplier_examples.sql"), "utf8");

describe("supplier register wiring", () => {
  it("emails through the helper, will not alert twice, and links stock to a supplier", () => {
    assert.match(src, /sendEmail/);
    assert.match(src, /on conflict do nothing/);
    assert.match(src, /cleanPhoto/);
    assert.match(src, /a\.userId/);
    assert.match(stock, /supplier_id/);
    assert.match(stock, /preferredSupplier/);
    assert.equal(src.includes("body.by_name"), false);
  });

  it("seeds only fake example suppliers", () => {
    assert.match(seed, /Example Dry Goods/);
    assert.match(seed, /Example — not a real supplier/);
    assert.equal(/\b(suma|screwfix|jewson|amazon)\b|british gas/i.test(seed), false);
    assert.match(seed, /\.invalid/);
  });
});
