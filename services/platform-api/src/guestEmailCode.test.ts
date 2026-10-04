import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { EMAIL_CODE_SENT } from "../../../domains/guest/signup.ts";
import guestEmailCode, { guestEmailCodeHash, guestEmailCodeMatches, guestEmailDeliveryEnabled, normalizeGuestEmailCode, guestEmailFailureCategory } from "./guestEmailCode.ts";

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

  it("reports missing delivery without disclosing configuration or claiming a send", async () => {
    const original = process.env.SMTP_URL;
    delete process.env.SMTP_URL;
    const app = Fastify();
    try {
      await app.register(guestEmailCode);
      const options = await app.inject({method: "GET", url: "/guest/auth-options"});
      assert.deepEqual(options.json(), {email_code: false});
      assert.equal(options.headers["cache-control"], "no-store");
      const request = await app.inject({method: "POST", url: "/guest/email-code/request", payload: {email: "guest@example.invalid"}});
      assert.equal(request.statusCode, 503);
      assert.equal(request.json().code, "email_unavailable");
      assert.equal("token" in request.json(), false);
    } finally {
      await app.close();
      if (original === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = original;
    }
  });

  it("advertises configured delivery without exposing the secret or sending an email", async () => {
    const original = process.env.SMTP_URL;
    process.env.SMTP_URL = "smtp://test-user:test-secret@smtp.example.invalid:587";
    const app = Fastify();
    try {
      await app.register(guestEmailCode);
      const options = await app.inject({method: "GET", url: "/guest/auth-options"});
      assert.deepEqual(options.json(), {email_code: true});
      assert.equal(options.body.includes("test-secret"), false);
    } finally {
      await app.close();
      if (original === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = original;
    }
  });

  it("redacts sensitive delivery errors to a safe category", () => {
    assert.equal(guestEmailFailureCategory({code:"EAUTH",message:"secret password and code 12345678"}), "EAUTH");
    assert.equal(guestEmailFailureCategory({code:"smtp://password@example.invalid",message:"private"}), "DELIVERY_FAILED");
    assert.equal(guestEmailFailureCategory(null), "DELIVERY_FAILED");
    assert.equal(guestEmailFailureCategory(new Error("private")), "DELIVERY_FAILED");
  });
});
