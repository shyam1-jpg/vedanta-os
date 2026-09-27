import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acceptsIdentityHeader, devLoginAllowed, devLoginEmailAllowed, emailLoginEnabled, productionOwnerAllowed } from "./auth.ts";
import { mfaRequired, tokenShowsMfa } from "./microsoft.ts";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("staff sign-in", () => {
  it("never accepts the X-User header as a credential", () => {
    assert.equal(acceptsIdentityHeader(), false);
  });

  it("refuses the development door in production even when the secret and flag are set", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_LOGIN;
    const prevSecret = process.env.DEV_LOGIN_SECRET;
    const prevDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_LOGIN = "true";
    process.env.DEV_LOGIN_SECRET = "local-dev-secret-value";
    delete process.env.DATABASE_URL;
    try { assert.deepEqual(devLoginAllowed(), { ok: false, reason: "production" }); }
    finally {
      restore("NODE_ENV", prevEnv);
      restore("ALLOW_DEV_LOGIN", prevFlag);
      restore("DEV_LOGIN_SECRET", prevSecret);
      restore("DATABASE_URL", prevDb);
    }
  });

  it("refuses the development door against a hosted database", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_LOGIN;
    const prevSecret = process.env.DEV_LOGIN_SECRET;
    const prevDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "development";
    process.env.ALLOW_DEV_LOGIN = "true";
    process.env.DEV_LOGIN_SECRET = "local-dev-secret-value";
    process.env.DATABASE_URL = "postgres://user:pass@dpg-example.render.com/vedanta";
    try { assert.equal(devLoginAllowed().ok, false); assert.equal(devLoginAllowed().reason, "hosted-database"); }
    finally {
      restore("NODE_ENV", prevEnv);
      restore("ALLOW_DEV_LOGIN", prevFlag);
      restore("DEV_LOGIN_SECRET", prevSecret);
      restore("DATABASE_URL", prevDb);
    }
  });

  it("opens the development door only with an explicit flag and a long secret", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_DEV_LOGIN;
    const prevSecret = process.env.DEV_LOGIN_SECRET;
    const prevDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_URL;
    process.env.ALLOW_DEV_LOGIN = "true";
    process.env.DEV_LOGIN_SECRET = "short";
    try {
      assert.equal(devLoginAllowed().reason, "secret");
      process.env.DEV_LOGIN_SECRET = "local-dev-secret-value";
      assert.equal(devLoginAllowed().ok, true);
    } finally {
      restore("NODE_ENV", prevEnv);
      restore("ALLOW_DEV_LOGIN", prevFlag);
      restore("DEV_LOGIN_SECRET", prevSecret);
      restore("DATABASE_URL", prevDb);
    }
  });

  it("only lets synthetic example accounts use the development door", () => {
    assert.equal(devLoginEmailAllowed("dev.chef@example.invalid"), true);
    assert.equal(devLoginEmailAllowed("someone@thevedanta.org"), false);
    assert.equal(devLoginEmailAllowed("guest@example.com"), false);
  });
});

describe("microsoft multi-factor", () => {
  it("accepts a token that shows a second factor", () => {
    assert.equal(tokenShowsMfa({ amr: ["pwd", "mfa"] }), true);
    assert.equal(tokenShowsMfa({ amr: ["fido"] }), true);
    assert.equal(tokenShowsMfa({ acr: "mfa" }), true);
  });

  it("rejects a password-only token", () => {
    assert.equal(tokenShowsMfa({ amr: ["pwd"] }), false);
    assert.equal(tokenShowsMfa({}), false);
  });

  it("cannot turn the MFA check off in production", () => {
    const prevEnv = process.env.NODE_ENV;
    const prev = process.env.OIDC_REQUIRE_MFA;
    process.env.NODE_ENV = "production";
    process.env.OIDC_REQUIRE_MFA = "false";
    try { assert.equal(mfaRequired(), true); }
    finally { restore("NODE_ENV", prevEnv); restore("OIDC_REQUIRE_MFA", prev); }
  });
});

describe("emailLoginEnabled guest portal flag", () => {
  it("is enabled by default, including production", () => {
    const prev = process.env.GUEST_PORTAL_ENABLED;
    delete process.env.GUEST_PORTAL_ENABLED;
    try { assert.equal(emailLoginEnabled(), true); }
    finally { restore("GUEST_PORTAL_ENABLED", prev); }
  });

  it("can disable guest registration and access-code sign-in independently", () => {
    const prev = process.env.GUEST_PORTAL_ENABLED;
    process.env.GUEST_PORTAL_ENABLED = "false";
    try { assert.equal(emailLoginEnabled(), false); }
    finally { restore("GUEST_PORTAL_ENABLED", prev); }
  });
});

describe("productionOwnerAllowed", () => {
  it("allows local development owners without an allowlist", () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try { assert.equal(productionOwnerAllowed("owner@example.com"), true); }
    finally { restore("NODE_ENV", prevEnv); }
  });

  it("rejects a production system owner not explicitly configured", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevOwner = process.env.BOOTSTRAP_OWNER_EMAIL;
    const prevAdmins = process.env.BOOTSTRAP_ADMIN_EMAILS;
    const prevAllow = process.env.SYSTEM_OWNER_ALLOWLIST;
    process.env.NODE_ENV = "production";
    delete process.env.BOOTSTRAP_OWNER_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    delete process.env.SYSTEM_OWNER_ALLOWLIST;
    try { assert.equal(productionOwnerAllowed("owner@example.com"), false); }
    finally {
      restore("NODE_ENV", prevEnv);
      restore("BOOTSTRAP_OWNER_EMAIL", prevOwner);
      restore("BOOTSTRAP_ADMIN_EMAILS", prevAdmins);
      restore("SYSTEM_OWNER_ALLOWLIST", prevAllow);
    }
  });

  it("allows production owners explicitly configured by deployment secret", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevOwner = process.env.BOOTSTRAP_OWNER_EMAIL;
    process.env.NODE_ENV = "production";
    process.env.BOOTSTRAP_OWNER_EMAIL = "Owner@Example.com";
    try { assert.equal(productionOwnerAllowed("owner@example.com"), true); }
    finally { restore("NODE_ENV", prevEnv); restore("BOOTSTRAP_OWNER_EMAIL", prevOwner); }
  });
});
