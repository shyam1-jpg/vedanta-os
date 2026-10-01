import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_ALREADY_ON_BOOK,
  EMAIL_CODE_REQUIRED,
  guestSignupGate,
  guestSignupPayloadReady,
  guestSignupValidationDetail,
  normalizeGuestEmail,
} from "./signup.ts";

const prodNew = {
  production: true,
  allowUnverifiedBootstrap: false,
  path: "/guest/register" as const,
  existingAccount: false,
  sessionOwnsAccount: false,
};

describe("guest signup gate", () => {
  it("requires an email code before a new production My Stay", () => {
    assert.deepEqual(guestSignupGate(prodNew), { action: "require_email_code" });
    assert.match(EMAIL_CODE_REQUIRED, /emailed/);
  });

  it("does not treat the unverified bootstrap flag as the way in", () => {
    assert.equal(guestSignupGate(prodNew).action, "require_email_code");
    assert.equal(guestSignupGate({ ...prodNew, allowUnverifiedBootstrap: true }).action, "allow");
  });

  it("still lets local development open a new My Stay without a code", () => {
    assert.equal(guestSignupGate({ ...prodNew, production: false }).action, "allow");
  });

  it("refuses to register an email that already has My Stay", () => {
    const decision = guestSignupGate({ ...prodNew, existingAccount: true, sessionOwnsAccount: true });
    assert.equal(decision.action, "reject");
    if (decision.action === "reject") {
      assert.equal(decision.status, 409);
      assert.equal(decision.code, "guest_identity_verification_required");
      assert.equal(decision.detail, EMAIL_ALREADY_ON_BOOK);
    }
  });

  it("lets a signed-in guest enquire again for their own email", () => {
    assert.equal(guestSignupGate({
      ...prodNew,
      path: "/guest/enquiries",
      existingAccount: true,
      sessionOwnsAccount: true,
    }).action, "allow");
  });

  it("does not let a different session enquire under someone else's email", () => {
    const decision = guestSignupGate({
      ...prodNew,
      path: "/guest/enquiries",
      existingAccount: true,
      sessionOwnsAccount: false,
    });
    assert.equal(decision.action, "reject");
  });

  it("still requires a code for a new enquiry when a bearer is present but the email is new", () => {
    assert.equal(guestSignupGate({
      ...prodNew,
      path: "/guest/enquiries",
      existingAccount: false,
      sessionOwnsAccount: true,
    }).action, "require_email_code");
  });
});

describe("guest signup payload", () => {
  it("normalises the address the code is bound to", () => {
    assert.equal(normalizeGuestEmail("  Ada@Example.com "), "ada@example.com");
  });

  it("waits for a name and email before asking the route to create My Stay", () => {
    assert.equal(guestSignupPayloadReady("/guest/register", { email: "ada@example.com" }), false);
    assert.equal(guestSignupPayloadReady("/guest/register", { name: "Ada", email: "ada@example.com" }), true);
  });

  it("waits for people and dates before an enquiry can consume a code", () => {
    const base = { name: "Ada", email: "ada@example.com", people: 2 };
    assert.equal(guestSignupPayloadReady("/guest/enquiries", base), false);
    assert.equal(guestSignupPayloadReady("/guest/enquiries", { ...base, arrival: "2026-10-10", departure: "2026-10-08" }), false);
    assert.equal(guestSignupPayloadReady("/guest/enquiries", { ...base, arrival: "2026-10-10", departure: "2026-10-12" }), true);
    assert.equal(guestSignupPayloadReady("/guest/enquiries", { ...base, programme_id: "prog-1" }), true);
    assert.equal(guestSignupPayloadReady("/guest/register", { name: "Ada", email: `${"a".repeat(250)}@example.com` }), false);
  });

  it("explains an incomplete form without asking for a code yet", () => {
    assert.equal(guestSignupValidationDetail("/guest/register", { email: "ada@example.com" }), "Name and email are required");
    assert.equal(guestSignupValidationDetail("/guest/enquiries", { name: "Ada", email: "ada@example.com" }), "Name, email and number of people are required");
    assert.equal(
      guestSignupValidationDetail("/guest/enquiries", { name: "Ada", email: "ada@example.com", people: 2, arrival: "2026-10-12", departure: "2026-10-10" }),
      "Departure must be on or after arrival",
    );
  });
});
