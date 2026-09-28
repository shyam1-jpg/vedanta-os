import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "org.ts"), "utf8");

describe("organisation wiring", () => {
  it("checks the reporting line, hides personal contact, and keeps sub-sections on the shared table", () => {
    assert.match(src, /reassign/);
    assert.match(src, /visibleContact/);
    assert.match(src, /sealText/);
    assert.match(src, /department_section/);
    assert.match(src, /staff-teams\.local\.json/);
    assert.match(src, /org\.manage/);
    assert.match(src, /a\.userId/);
    assert.match(src, /rota_shift/);
    assert.match(src, /clearedForUsers|clearanceForUsers/);
    const list = src.slice(src.indexOf('"/v1/org"'), src.indexOf('"/v1/org/positions/:id"'));
    assert.equal(list.includes("personalPhone"), false);
    assert.equal(list.includes("personal_phone"), false);
  });
});
