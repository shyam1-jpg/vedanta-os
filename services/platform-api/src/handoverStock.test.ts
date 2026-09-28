import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ops = readFileSync(join(here, "ops.ts"), "utf8");
const stock = readFileSync(join(here, "kitchenStock.ts"), "utf8");
const seed = readFileSync(join(here, "../../../db/seed/0025_kitchen_stock_examples.sql"), "utf8");

describe("handover and stock wiring", () => {
  it("attributes a handover to the signed-in person", () => {
    const post = ops.slice(ops.indexOf('f.post("/v1/ops/handover"'), ops.indexOf('f.post("/v1/ops/notices"'));
    assert.match(post, /author_user_id/);
    assert.match(post, /a\.userId/);
    assert.match(post, /a\.name/);
    assert.equal(post.includes("body.author"), false);
    assert.equal(post.includes("req.body?.author"), false);
    assert.match(post, /chooseTags/);
  });

  it("keeps the old handover post working for the night note", () => {
    assert.match(ops, /parseDepartment\(req\.body\?\.department/);
    assert.match(ops, /parseShift\(req\.body\?\.shift\)/);
    assert.match(ops, /ops_handover_ack/);
  });

  it("logs stock changes against the signed-in person and emails only from settings", () => {
    const count = stock.slice(stock.indexOf('"/v1/kitchen-stock/:id/count"'));
    assert.match(count, /by_user_id/);
    assert.match(count, /a\.userId/);
    assert.match(count, /a\.name/);
    assert.equal(count.includes("body.by_name"), false);
    assert.match(stock, /stockNotices/);
    assert.match(stock, /parseStockRouting/);
  });

  it("seeds vegetarian examples and no real address", () => {
    assert.match(seed, /Basmati rice/);
    assert.match(seed, /Example — change this/);
    assert.equal(/\b(egg|eggs|onion|onions|garlic|shallot|leek)\b/i.test(seed), false);
    assert.equal(seed.includes("@"), false);
  });
});
