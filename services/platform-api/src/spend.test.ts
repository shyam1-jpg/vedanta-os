import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "spend.ts"), "utf8");
const server = readFileSync(join(dir, "server.ts"), "utf8");

describe("spend wiring", () => {
  it("alerts once through the shared mail helper and keeps an audit trail", () => {
    assert.match(src, /thresholdsToSend/);
    assert.match(src, /on conflict \(property_id, department_id, month, threshold\) do nothing/);
    assert.match(src, /sendEmail/);
    assert.match(src, /cleanPhoto/);
    assert.match(src, /Europe\/London/);
    assert.match(src, /spend\.manage/);
    assert.match(src, /deleted_at/);
    assert.match(src, /audit\(/);
    assert.match(src, /copyBudgets/);
    assert.match(src, /kind: "spend_alert"/);
    assert.equal(src.includes("personal_phone"), false);
    assert.match(server, /remindSpend/);
    assert.match(server, /spendRoutes/);
  });
});
