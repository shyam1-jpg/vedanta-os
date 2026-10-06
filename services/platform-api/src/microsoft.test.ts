import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ACTIVE_STAFF_SQL,
  INSERT_MICROSOFT_STATE,
  INSERT_SESSION_SQL,
  SWEEP_MICROSOFT_STATE,
  TAKE_MICROSOFT_STATE,
  loggableRequestUrl,
  microsoftEnabled,
  type MicrosoftOptions,
  type Sql,
  type Surface,
} from "./microsoft.ts";

type Staff = { id: string; property_id: string; role: string };
type StateRow = { state: string; verifier: string; surface: Surface; expiresAt: number };
type SessionRow = { token: string; user_id: string; property_id: string; audience: string };

const TEN_MINUTES = 10 * 60 * 1000;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createSharedDb(now: () => number = Date.now) {
  const states: StateRow[] = [];
  const staff = new Map<string, Staff>();
  const sessions: SessionRow[] = [];
  const db: Sql = {
    async query(sql, params = []) {
      if (sql === SWEEP_MICROSOFT_STATE) {
        const cutoff = now();
        for (let i = states.length - 1; i >= 0; i--) if (states[i].expiresAt <= cutoff) states.splice(i, 1);
        return { rows: [] };
      }
      if (sql === INSERT_MICROSOFT_STATE) {
        states.push({
          state: String(params[0]),
          verifier: String(params[1]),
          surface: params[2] === "STAFF" ? "STAFF" : "ADMIN",
          expiresAt: now() + TEN_MINUTES,
        });
        return { rows: [] };
      }
      if (sql === TAKE_MICROSOFT_STATE) {
        const cutoff = now();
        const idx = states.findIndex(row => row.state === params[0] && row.expiresAt > cutoff);
        if (idx < 0) return { rows: [] };
        const [row] = states.splice(idx, 1);
        return { rows: [{ verifier: row.verifier, surface: row.surface }] };
      }
      if (sql === ACTIVE_STAFF_SQL) {
        const row = staff.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql === INSERT_SESSION_SQL) {
        sessions.push({
          token: String(params[0]),
          user_id: String(params[1]),
          property_id: String(params[2]),
          audience: String(params[3]),
        });
        return { rows: [] };
      }
      throw new Error("unexpected sql");
    },
  };
  return { db, states, staff, sessions };
}

async function isolatedMicrosoft() {
  const href = new URL(`./microsoft.ts?isolate=${Math.random().toString(36).slice(2)}`, import.meta.url).href;
  return import(href) as Promise<typeof import("./microsoft.ts")>;
}

async function listen(mod: typeof import("./microsoft.ts"), db: Sql, exchangeCode: MicrosoftOptions["exchangeCode"]) {
  const app = Fastify({ logger: false });
  await app.register(mod.default, { db, exchangeCode });
  return app;
}

async function withMicrosoftEnv<T>(fn: () => Promise<T>) {
  const keys = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "PUBLIC_URL", "WEB_URL"] as const;
  const prev = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.MS_TENANT_ID = "tenant";
  process.env.MS_CLIENT_ID = "client";
  process.env.MS_CLIENT_SECRET = "test-client-secret";
  process.env.PUBLIC_URL = "https://vedanta-api.onrender.com";
  process.env.WEB_URL = "https://vedanta-admin.onrender.com";
  try {
    return await fn();
  } finally {
    for (const key of keys) restore(key, prev[key]);
  }
}

function accept(email: string): MicrosoftOptions["exchangeCode"] {
  return async () => ({ ok: true, email });
}

async function closeAll(apps: FastifyInstance[]) {
  await Promise.all(apps.map(app => app.close()));
}

describe("microsoft sign-in state", () => {
  it("keeps Microsoft sign-in off until tenant, client, secret and public url are set", () => {
    const keys = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "PUBLIC_URL"] as const;
    const prev = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.MS_TENANT_ID = "tenant";
    process.env.MS_CLIENT_ID = "client";
    process.env.MS_CLIENT_SECRET = "test-client-secret";
    process.env.PUBLIC_URL = "https://vedanta-api.onrender.com";
    try {
      assert.equal(microsoftEnabled(), true);
      for (const key of keys) {
        const saved = process.env[key];
        delete process.env[key];
        assert.equal(microsoftEnabled(), false);
        restore(key, saved);
      }
    } finally {
      for (const key of keys) restore(key, prev[key]);
    }
  });

  it("does not write the authorization code into request logs", () => {
    const logged = loggableRequestUrl("/auth/microsoft/callback?code=auth-code&state=opaque");
    assert.equal(logged, "/auth/microsoft/callback");
    assert.equal(logged.includes("auth-code"), false);
    assert.equal(loggableRequestUrl("/v1/guests?q=ada"), "/v1/guests?q=ada");
  });

  it("issues a session when the callback is handled by a different process", async () => {
    await withMicrosoftEnv(async () => {
      const shared = createSharedDb();
      shared.staff.set("staff@thevedanta.org", {
        id: "11111111-1111-1111-1111-111111111111",
        property_id: "22222222-2222-2222-2222-222222222222",
        role: "RECEPTIONIST",
      });
      let verifier = "";
      const exchangeCode: MicrosoftOptions["exchangeCode"] = async input => {
        verifier = input.verifier;
        return { ok: true, email: "Staff@TheVedanta.org" };
      };
      const starterMod = await isolatedMicrosoft();
      const callbackMod = await isolatedMicrosoft();
      assert.notEqual(starterMod.default, callbackMod.default);
      const starter = await listen(starterMod, shared.db, exchangeCode);
      const callback = await listen(callbackMod, shared.db, exchangeCode);
      try {
        const begin = await starter.inject({ method: "GET", url: "/auth/microsoft" });
        assert.equal(begin.statusCode, 302);
        const authorize = new URL(String(begin.headers.location));
        const state = authorize.searchParams.get("state");
        assert.ok(state);
        assert.equal(shared.states.length, 1);
        assert.equal(authorize.searchParams.get("redirect_uri"), "https://vedanta-api.onrender.com/auth/microsoft/callback");

        const done = await callback.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${encodeURIComponent(state)}` });
        assert.equal(done.statusCode, 302);
        const location = new URL(String(done.headers.location));
        assert.equal(location.searchParams.get("error"), null);
        assert.equal(location.origin + location.pathname, "https://vedanta-admin.onrender.com/sign-in/");
        const token = location.hash.replace(/^#token=/, "");
        assert.equal(createHash("sha256").update(verifier).digest("base64url"), authorize.searchParams.get("code_challenge"));
        assert.equal(shared.states.length, 0);
        assert.equal(shared.sessions.length, 1);
        assert.equal(token, shared.sessions[0].token);
        assert.equal(shared.sessions[0].user_id, "11111111-1111-1111-1111-111111111111");
        assert.equal(shared.sessions[0].audience, "ADMIN");

        const replay = await callback.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${encodeURIComponent(state)}` });
        assert.match(String(replay.headers.location), /error=Sign-in%20expired%2C%20please%20try%20again/);
        assert.equal(shared.sessions.length, 1);
      } finally {
        await closeAll([starter, callback]);
      }
    });
  });

  it("keeps the staff pocket surface when another process finishes sign-in", async () => {
    await withMicrosoftEnv(async () => {
      const shared = createSharedDb();
      shared.staff.set("porter@thevedanta.org", {
        id: "33333333-3333-3333-3333-333333333333",
        property_id: "22222222-2222-2222-2222-222222222222",
        role: "RECEPTIONIST",
      });
      const starter = await listen(await isolatedMicrosoft(), shared.db, accept("porter@thevedanta.org"));
      const callback = await listen(await isolatedMicrosoft(), shared.db, accept("porter@thevedanta.org"));
      try {
        const begin = await starter.inject({ method: "GET", url: "/auth/microsoft?surface=staff" });
        const state = new URL(String(begin.headers.location)).searchParams.get("state");
        assert.ok(state);
        const done = await callback.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${encodeURIComponent(state)}` });
        assert.match(String(done.headers.location), /^https:\/\/vedanta-admin\.onrender\.com\/pocket\/#token=/);
        assert.equal(shared.sessions[0].audience, "STAFF");
      } finally {
        await closeAll([starter, callback]);
      }
    });
  });

  it("still expires the sign-in when the shared state is older than 10 minutes", async () => {
    await withMicrosoftEnv(async () => {
      let now = 1_700_000_000_000;
      const shared = createSharedDb(() => now);
      const starter = await listen(await isolatedMicrosoft(), shared.db, accept("staff@thevedanta.org"));
      const callback = await listen(await isolatedMicrosoft(), shared.db, accept("staff@thevedanta.org"));
      try {
        const begin = await starter.inject({ method: "GET", url: "/auth/microsoft" });
        const state = new URL(String(begin.headers.location)).searchParams.get("state");
        assert.ok(state);
        now += TEN_MINUTES + 1;
        const done = await callback.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${state}` });
        assert.match(String(done.headers.location), /error=Sign-in%20expired%2C%20please%20try%20again/);
        assert.equal(shared.sessions.length, 0);
        assert.match(INSERT_MICROSOFT_STATE, /interval '10 minutes'/);
        assert.match(TAKE_MICROSOFT_STATE, /expires_at > now\(\)/);
      } finally {
        await closeAll([starter, callback]);
      }
    });
  });

  it("does not accept a Microsoft account that is not an active staff user", async () => {
    await withMicrosoftEnv(async () => {
      const shared = createSharedDb();
      const app = await listen(await isolatedMicrosoft(), shared.db, accept("visitor@example.com"));
      try {
        const begin = await app.inject({ method: "GET", url: "/auth/microsoft" });
        const state = new URL(String(begin.headers.location)).searchParams.get("state");
        const done = await app.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${state}` });
        assert.match(String(done.headers.location), /error=This%20Microsoft%20account%20is%20not%20set%20up%20for%20Vedanta%20staff%20access/);
        assert.equal(shared.sessions.length, 0);
        assert.match(ACTIVE_STAFF_SQL, /u\.status='ACTIVE'/);
      } finally {
        await app.close();
      }
    });
  });

  it("still refuses an unlisted production system owner", async () => {
    await withMicrosoftEnv(async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevOwner = process.env.BOOTSTRAP_OWNER_EMAIL;
      const prevAdmins = process.env.BOOTSTRAP_ADMIN_EMAILS;
      const prevAllow = process.env.SYSTEM_OWNER_ALLOWLIST;
      process.env.NODE_ENV = "production";
      delete process.env.BOOTSTRAP_OWNER_EMAIL;
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
      delete process.env.SYSTEM_OWNER_ALLOWLIST;
      const shared = createSharedDb();
      shared.staff.set("owner@thevedanta.org", {
        id: "44444444-4444-4444-4444-444444444444",
        property_id: "22222222-2222-2222-2222-222222222222",
        role: "SYSTEM_OWNER",
      });
      const app = await listen(await isolatedMicrosoft(), shared.db, accept("owner@thevedanta.org"));
      try {
        const begin = await app.inject({ method: "GET", url: "/auth/microsoft" });
        const state = new URL(String(begin.headers.location)).searchParams.get("state");
        const done = await app.inject({ method: "GET", url: `/auth/microsoft/callback?code=auth-code&state=${state}` });
        assert.match(String(done.headers.location), /error=This%20system-owner%20account%20is%20not%20approved%20in%20the%20production%20allowlist/);
        assert.equal(shared.sessions.length, 0);
      } finally {
        await app.close();
        restore("NODE_ENV", prevEnv);
        restore("BOOTSTRAP_OWNER_EMAIL", prevOwner);
        restore("BOOTSTRAP_ADMIN_EMAILS", prevAdmins);
        restore("SYSTEM_OWNER_ALLOWLIST", prevAllow);
      }
    });
  });
});
