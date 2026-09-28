import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOOKING_CLOSED,
  cleanIdempotencyKey,
  decideBookingGate,
  formatBookingReference,
  issueSessionOnRegister,
  publicBookingOpen,
} from "./bookingGate.ts";

const verified = { email: "guest@example.invalid", verified: true };
const unverified = { email: "guest@example.invalid", verified: false };

describe("booking gate", () => {
  it("rejects a bearer token that is not a real session", () => {
    const decision = decideBookingGate({
      route: "enquiry",
      production: true,
      allowUnverifiedBootstrap: false,
      tokenPresented: true,
      session: null,
      bodyEmail: "guest@example.invalid",
      accountExists: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 401);
      assert.notEqual(decision.status, 503);
    }
  });

  it("keeps production closed when nobody is signed in", () => {
    const decision = decideBookingGate({
      route: "enquiry",
      production: true,
      allowUnverifiedBootstrap: false,
      tokenPresented: false,
      session: null,
      bodyEmail: "guest@example.invalid",
      accountExists: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 503);
    assert.equal(publicBookingOpen({ production: true, allowUnverifiedBootstrap: false, sessionVerified: false }).open, false);
  });

  it("lets a verified guest book in production without the bootstrap flag", () => {
    const decision = decideBookingGate({
      route: "enquiry",
      production: true,
      allowUnverifiedBootstrap: false,
      tokenPresented: true,
      session: verified,
      bodyEmail: "guest@example.invalid",
      accountExists: true,
    });
    assert.equal(decision.ok, true);
    assert.equal(publicBookingOpen({ production: true, allowUnverifiedBootstrap: false, sessionVerified: true }).open, true);
  });

  it("does not treat an unverified session as enough to book", () => {
    const decision = decideBookingGate({
      route: "enquiry",
      production: true,
      allowUnverifiedBootstrap: false,
      tokenPresented: true,
      session: unverified,
      bodyEmail: "guest@example.invalid",
      accountExists: true,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.code, "email_not_verified");
  });

  it("opens booking when the bootstrap flag is on, still rejecting a fake token", () => {
    assert.equal(decideBookingGate({
      route: "enquiry", production: true, allowUnverifiedBootstrap: true, tokenPresented: false, session: null, bodyEmail: "guest@example.invalid", accountExists: false,
    }).ok, true);
    const fake = decideBookingGate({
      route: "register", production: true, allowUnverifiedBootstrap: true, tokenPresented: true, session: null, bodyEmail: "guest@example.invalid", accountExists: false,
    });
    assert.equal(fake.ok, false);
  });

  it("does not hand a new guest a session from registration in production", () => {
    assert.equal(issueSessionOnRegister(true, false), false);
    assert.equal(issueSessionOnRegister(false, false), true);
    assert.equal(issueSessionOnRegister(true, true), true);
  });

  it("keeps local booking open when no token is sent", () => {
    assert.equal(decideBookingGate({
      route: "enquiry", production: false, allowUnverifiedBootstrap: false, tokenPresented: false, session: null, bodyEmail: "guest@example.invalid", accountExists: false,
    }).ok, true);
    const taken = decideBookingGate({
      route: "register", production: false, allowUnverifiedBootstrap: false, tokenPresented: false, session: null, bodyEmail: "guest@example.invalid", accountExists: true,
    });
    assert.equal(taken.ok, false);
    if (!taken.ok) assert.equal(taken.status, 409);
  });
});

describe("idempotency and references", () => {
  it("accepts a client key and builds a guest-facing reference", () => {
    assert.equal(cleanIdempotencyKey("abc12345-ok"), "abc12345-ok");
    assert.equal(cleanIdempotencyKey("short"), null);
    assert.equal(cleanIdempotencyKey("has space!!"), null);
    assert.equal(formatBookingReference("ab12cd34ffff"), "BK-AB12CD34");
  });

  it("tells the guest the house is closed before they start", () => {
    assert.match(BOOKING_CLOSED, /not open yet/);
    assert.match(BOOKING_CLOSED, /Contact the house/);
  });
});

describe("booking gate is wired to a real session lookup", () => {
  it("does not treat a bearer prefix as proof", () => {
    const server = readFileSync(new URL("../../services/platform-api/src/server.ts", import.meta.url), "utf8");
    assert.match(server, /decideBookingGate/);
    assert.doesNotMatch(server, /auth\?\.startsWith\("Bearer "\) && !truthy/);
  });
});
