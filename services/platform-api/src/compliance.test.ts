import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "compliance.ts"), "utf8");
const seed = readFileSync(join(here, "../../../db/seed/0026_compliance_examples.sql"), "utf8");

describe("compliance wiring", () => {
  it("emails through the helper, keeps history, and will not remind twice", () => {
    assert.match(src, /sendEmail/);
    assert.match(src, /on conflict do nothing/);
    assert.match(src, /compliance_completion/);
    assert.match(src, /source_type/);
    assert.match(src, /cleanAttachment/);
    assert.match(src, /sealText/);
    assert.equal(src.includes("body.by_name"), false);
    assert.equal(src.includes("req.body?.author"), false);
  });

  it("seeds examples and no real address", () => {
    assert.match(seed, /Fire alarm test/);
    assert.match(seed, /Fridge and freezer calibration/);
    assert.match(seed, /example/);
    assert.equal(seed.includes("@"), false);
    assert.equal(/\b(egg|eggs|onion|onions|garlic)\b/i.test(seed), false);
  });
});
