import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sslFor } from "./db.ts";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("database TLS", () => {
  it("does not verify a certificate for local Docker", () => {
    const prev = process.env.NODE_ENV;
    const insecure = process.env.PGSSL_INSECURE;
    process.env.NODE_ENV = "development";
    delete process.env.PGSSL_INSECURE;
    try { assert.equal(sslFor("postgres://vedanta:vedanta@localhost:5432/vedanta"), undefined); }
    finally { restore("NODE_ENV", prev); restore("PGSSL_INSECURE", insecure); }
  });

  it("verifies the certificate for a hosted database", () => {
    const prev = process.env.NODE_ENV;
    const insecure = process.env.PGSSL_INSECURE;
    process.env.NODE_ENV = "production";
    delete process.env.PGSSL_INSECURE;
    try {
      const ssl = sslFor("postgres://vedanta:secret@dpg-abc.render.com/vedanta");
      assert.ok(ssl && typeof ssl === "object");
      if (typeof ssl === "object" && ssl) assert.equal(ssl.rejectUnauthorized, true);
    } finally { restore("NODE_ENV", prev); restore("PGSSL_INSECURE", insecure); }
  });

  it("refuses to skip certificate checks in production", () => {
    const prev = process.env.NODE_ENV;
    const insecure = process.env.PGSSL_INSECURE;
    process.env.NODE_ENV = "production";
    process.env.PGSSL_INSECURE = "1";
    try { assert.throws(() => sslFor("postgres://vedanta:secret@dpg-abc.render.com/vedanta"), /PGSSL_INSECURE/); }
    finally { restore("NODE_ENV", prev); restore("PGSSL_INSECURE", insecure); }
  });
});
