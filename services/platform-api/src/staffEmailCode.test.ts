import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { codeHash, staffEmailCodeEnabled } from "./staffEmailCode.ts";

describe("staff email code", () => {
  it("binds a code to its random salt without storing the plaintext", () => {
    const hash = codeHash("12345678", "first-salt");
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash, codeHash("12345678", "first-salt"));
    assert.notEqual(hash, codeHash("12345678", "another-salt"));
    assert.notEqual(hash, codeHash("87654321", "first-salt"));
  });
  it("does not advertise email login without a delivery service", () => {
    const original = process.env.SMTP_URL;
    delete process.env.SMTP_URL;
    try { assert.equal(staffEmailCodeEnabled(), false); }
    finally { if (original === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = original; }
  });
});
