/**
 * Sign in with Microsoft 365 (Entra ID) — OpenID Connect authorization-code flow with PKCE.
 * Configure: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, PUBLIC_URL (of this API), WEB_URL (web origin).
 * The house door (/auth/microsoft) issues an admin-audience session to /sign-in/#token=...
 * Pocket (/auth/microsoft?surface=staff) issues a staff-audience session to /pocket/#token=...
 * Users must already exist in app_user with a membership; Microsoft only proves who they are.
 * The session token is placed in the URL fragment only and is never logged.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pool } from "./db.ts";
import { staffEmailLoginEnabled, problem, productionOwnerAllowed } from "./auth.ts";
import { audienceFromState, audienceFromSurface, sessionErrorLocation, sessionHandoffLocation, stateForAudience, type HandoffAudience } from "./session-handoff.ts";

const cfg = () => ({ tenant: process.env.MS_TENANT_ID, client: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET, api: process.env.PUBLIC_URL, web: process.env.WEB_URL ?? "http://localhost:3000" });
export const microsoftEnabled = () => !!(cfg().tenant && cfg().client && cfg().secret && cfg().api);
const pending = new Map<string, { verifier: string; at: number; audience: HandoffAudience }>();  // state → PKCE verifier, 10 minutes

export default async function microsoft(f: FastifyInstance) {
  f.get("/auth/providers", async () => ({ microsoft: microsoftEnabled(), dev: process.env.NODE_ENV !== "production", email: staffEmailLoginEnabled() }));

  f.get<{ Querystring: { surface?: string } }>("/auth/microsoft", async (req, reply) => {
    if (!microsoftEnabled()) return reply.code(404).send(problem(404, "not_configured", "Microsoft sign-in is not configured"));
    const c = cfg(); const audience = audienceFromSurface(req.query.surface);
    const state = stateForAudience(audience, randomBytes(16).toString("base64url")); const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
    pending.set(state, { verifier, at: Date.now(), audience });
    const u = new URL(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({ client_id: c.client!, response_type: "code", redirect_uri: `${c.api}/auth/microsoft/callback`, scope: "openid profile email", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
    return reply.redirect(u.toString());
  });

  f.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/auth/microsoft/callback", async (req, reply) => {
    const c = cfg(); const { code, state, error, error_description } = req.query;
    const p = state ? pending.get(state) : undefined;
    const audience: HandoffAudience = p?.audience ?? audienceFromState(state) ?? "ADMIN";
    const fail = (why: string) => reply.redirect(sessionErrorLocation(audience, why, c.web));
    if (error) return fail(error_description ?? error);
    if (!code || !p) return fail("Sign-in expired, please try again");
    pending.delete(state!);
    const tokenRes = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.client!, client_secret: c.secret!, grant_type: "authorization_code", code, redirect_uri: `${c.api}/auth/microsoft/callback`, code_verifier: p.verifier }) });
    if (!tokenRes.ok) return fail("Microsoft did not accept the sign-in");
    const { id_token } = await tokenRes.json() as { id_token: string };
    const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${c.tenant}/discovery/v2.0/keys`));
    let email: string | undefined;
    try {
      const { payload } = await jwtVerify(id_token, jwks, { issuer: `https://login.microsoftonline.com/${c.tenant}/v2.0`, audience: c.client });
      email = ((payload.preferred_username ?? payload.email) as string | undefined)?.toLowerCase();
    } catch { return fail("Could not verify the Microsoft token"); }
    if (!email) return fail("Microsoft did not tell us your email address");
    const u = (await pool.query(`select u.id, m.property_id, r.code role
      from app_user u
      join membership m on m.user_id=u.id
      join role r on r.id=m.role_id
      where lower(u.email)=$1 and u.status='ACTIVE' limit 1`, [email])).rows[0];
    if (!u) return fail("This Microsoft account is not set up for Vedanta staff access");
    if (u.role === "SYSTEM_OWNER" && !productionOwnerAllowed(email)) {
      return fail("This system-owner account is not approved in the production allowlist");
    }
    const token = randomBytes(32).toString("base64url");
    await pool.query(`insert into session (token, user_id, property_id, audience, expires_at) values ($1,$2,$3,$4, now() + interval '12 hours')`, [token, u.id, u.property_id, audience]);
    return reply.redirect(sessionHandoffLocation(audience, token, c.web));
  });
}
