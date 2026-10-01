import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_CODE_SENT } from "../../../domains/guest/signup.ts";
import { guestEmailCodeHash, guestEmailCodeMatches, guestEmailDeliveryEnabled, normalizeGuestEmailCode } from "./guestEmailCode.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("guest email code", () => {
  it("binds a code to its salt and never treats the hash as the code", () => {
    const hash = guestEmailCodeHash("12345678", "first-salt");
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(guestEmailCodeMatches("12345678", "first-salt", hash), true);
    assert.equal(guestEmailCodeMatches("12345678", "another-salt", hash), false);
    assert.equal(guestEmailCodeMatches("87654321", "first-salt", hash), false);
    assert.equal(hash.includes("12345678"), false);
  });

  it("ignores spaces typed into the code", () => {
    assert.equal(normalizeGuestEmailCode(" 1234 5678 "), "12345678");
  });

  it("does not advertise guest email codes without a delivery service", () => {
    const original = process.env.SMTP_URL;
    delete process.env.SMTP_URL;
    try { assert.equal(guestEmailDeliveryEnabled(), false); }
    finally { if (original === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = original; }
  });

  it("tells the guest a code was emailed without including a code", () => {
    assert.match(EMAIL_CODE_SENT, /emailed a code/);
    assert.equal(/\d{6,}/.test(EMAIL_CODE_SENT), false);
  });

  it("keeps unverified guest bootstrap switched off in the deploy blueprints", () => {
    for (const file of ["render.yaml", "render.monorepo.yaml"]) {
      const src = readFileSync(join(root, file), "utf8");
      assert.match(src, /key:\s*ALLOW_UNVERIFIED_GUEST_BOOTSTRAP\s+value:\s*"false"/);
    }
  });
});
