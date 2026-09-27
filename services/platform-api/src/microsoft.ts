/**
 * Sign in with Microsoft 365 (Entra ID) — OpenID Connect authorization-code flow with PKCE.
 * Configure: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, PUBLIC_URL (of this API), WEB_URL (admin app).
 * Users must already exist in app_user with a membership; Microsoft only proves who they are.
 *
 * Multi-factor authentication is required. Entra Conditional Access should require MFA,
 * and the app registration should emit the optional id_token claim `amr`. This code
 * refuses a token that does not show a second factor. In production that check cannot be turned off.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { pool } from "./db.ts";
import { devLoginAllowed, issueStaffSession, problem, productionOwnerAllowed } from "./auth.ts";

const MFA_METHODS = new Set(["mfa", "otp", "rsa", "hwk", "ngcmfa", "fido", "x509", "sms", "phone"]);

export function mfaRequired(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.OIDC_REQUIRE_MFA !== "false";
}

export function tokenShowsMfa(payload: JWTPayload | Record<string, unknown>): boolean {
  const amr = payload.amr;
  if (Array.isArray(amr) && amr.some(v => MFA_METHODS.has(String(v).toLowerCase()))) return true;
  const acr = String(payload.acr ?? "");
  return /mfa/i.test(acr);
}

const cfg = () => ({ tenant: process.env.MS_TENANT_ID, client: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET, api: process.env.PUBLIC_URL, web: process.env.WEB_URL ?? "http://localhost:3000" });
export const microsoftEnabled = () => !!(cfg().tenant && cfg().client && cfg().secret && cfg().api);
const pending = new Map<string, { verifier: string; at: number; audience: "ADMIN" | "STAFF" }>();

export default async function microsoft(f: FastifyInstance) {
  f.get("/auth/providers", async () => ({ microsoft: microsoftEnabled(), dev: devLoginAllowed().ok, email: false, mfa: mfaRequired() }));

  f.get<{ Querystring: { surface?: string } }>("/auth/microsoft", async (req, reply) => {
    if (!microsoftEnabled()) return reply.code(404).send(problem(404, "not_configured", "Microsoft sign-in is not configured"));
    const c = cfg(); const state = randomBytes(16).toString("base64url"); const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const audience = req.query.surface === "staff" ? "STAFF" : "ADMIN";
    for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
    pending.set(state, { verifier, at: Date.now(), audience });
    const u = new URL(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({
      client_id: c.client!, response_type: "code", redirect_uri: `${c.api}/auth/microsoft/callback`,
      scope: "openid profile email", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
      claims: JSON.stringify({ id_token: { amr: { essential: false } } }),
    }).toString();
    return reply.redirect(u.toString());
  });

  f.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/auth/microsoft/callback", async (req, reply) => {
    const c = cfg(); const { code, state, error, error_description } = req.query;
    const p = state ? pending.get(state) : undefined;
    const home = p?.audience === "STAFF" ? `${c.web}/pocket/` : `${c.web}/sign-in/`;
    const fail = (why: string) => reply.redirect(`${home}?error=${encodeURIComponent(why)}`);
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
      if (mfaRequired() && !tokenShowsMfa(payload)) return fail("Microsoft did not confirm a second factor. The house requires multi-factor authentication. Ask for the Entra app to send the amr claim, and for Conditional Access to require MFA.");
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
    const token = await issueStaffSession(u.id, u.property_id, p.audience);
    const back = p.audience === "STAFF" ? `${c.web}/pocket/#token=${token}` : `${c.web}/sign-in/#token=${token}`;
    return reply.redirect(back);
  });
}
