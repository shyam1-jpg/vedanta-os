import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "training.ts"), "utf8");
const hr = readFileSync(join(here, "hr.ts"), "utf8");
const seed = readFileSync(join(here, "../../../db/seed/0028_training_examples.sql"), "utf8");
const modules = readFileSync(join(here, "../../../db/seed/0029_training_departments.sql"), "utf8");
const migration = readFileSync(join(here, "../../../db/migrations/0054_training_departments.sql"), "utf8");

describe("training tracker wiring", () => {
  it("emails through the helper, keeps an audit, and will not remind twice", () => {
    assert.match(src, /sendEmail/);
    assert.match(src, /on conflict do nothing/);
    assert.match(src, /training_event/);
    assert.match(src, /staffProgress/);
    assert.match(src, /planChecklistEdit/);
    assert.match(src, /inductionItemIds/);
    assert.match(src, /requires_retraining/);
    assert.match(src, /cleanAttachment/);
    assert.match(src, /staff_sop/);
    assert.equal(src.includes("body.signed_off_name"), false);
    assert.match(hr, /unsupervised_cleared/);
    assert.match(hr, /not cleared for unsupervised work/);
  });

  it("seeds examples and no real person", () => {
    assert.match(seed, /Example chef induction/);
    assert.match(seed, /Example food hygiene level 2/);
    assert.equal(/\b(priya|shyam|nair)\b/i.test(seed), false);
    assert.equal(seed.includes("@"), false);
  });

  it("seeds one shared fire module and a checklist that can be edited", () => {
    assert.match(migration, /training_module_dept/);
    assert.match(migration, /training_check/);
    assert.match(migration, /training_tick/);
    assert.match(migration, /checklist_version/);
    assert.match(modules, /'Fire safety'/);
    assert.equal(modules.split("'Fire safety', 'fire_safety'").length, 2);
    assert.match(modules, /'Chemical safety \(COSHH\)', 'MAINT'/);
    assert.match(modules, /'Chemical safety \(COSHH\)', 'HK'/);
    assert.equal(modules.includes("KITCHEN") && modules.includes("FRONT"), true);
    assert.equal(/@/.test(modules), false);
    assert.equal(/\b(priya|shyam|nair)\b/i.test(modules), false);
  });
});
