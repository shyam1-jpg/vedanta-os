import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lostFound.ts"), "utf8");

describe("lost and found wiring", () => {
  it("seals guest contact, emails through the helper, and records who handled it", () => {
    assert.match(src, /sealText/);
    assert.match(src, /sendEmail/);
    assert.match(src, /deliverSms/);
    assert.match(src, /createHash\("sha256"\)/);
    assert.match(src, /lost_link/);
    assert.match(src, /disposal_days/);
    assert.match(src, /rankMatches/);
    assert.match(src, /renderSlipPdf/);
    assert.match(src, /cleanPhoto/);
    assert.match(src, /a\.userId/);
    assert.match(src, /a\.name/);
    assert.match(src, /contact_name=null/);
    assert.match(src, /guest_choice_detail=null/);
    assert.match(src, /req\.body\?\.send !== true/);
    assert.equal(src.includes("body.found_by"), false);
    assert.equal(src.includes("req.body?.author"), false);
    const reports = src.slice(src.indexOf('"/v1/lost-found/reports"'), src.indexOf('"/v1/lost-found/reports/:id/decision"'));
    assert.equal(reports.includes("sendEmail"), false);
    assert.equal(reports.includes("lostGuestMessage"), false);
  });
});
