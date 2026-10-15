/**
 * Sign in with Microsoft 365 (Entra ID) — OpenID Connect authorization-code flow with PKCE.
 * Configure: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, PUBLIC_URL (of this API), WEB_URL (admin app).
 * The PKCE verifier is stored in microsoft_oauth_state (10 minutes, one use) so a callback can
 * finish on a different API process than the one that started the sign-in.
 * Users must already exist in app_user with a membership; Microsoft only proves who they are.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pool } from "./db.ts";
import { staffEmailLoginEnabled, problem, productionOwnerAllowed } from "./auth.ts";
import { staffEmailCodeEnabled } from "./staffEmailCode.ts";

const cfg = () => ({ tenant: process.env.MS_TENANT_ID, client: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET, api: process.env.PUBLIC_URL, web: process.env.WEB_URL ?? "http://localhost:3000" });
export const microsoftEnabled = () => !!(cfg().tenant && cfg().client && cfg().secret && cfg().api);

export const SWEEP_MICROSOFT_STATE = `delete from microsoft_oauth_state where expires_at <= now()`;
export const INSERT_MICROSOFT_STATE = `insert into microsoft_oauth_state (state, verifier, surface, expires_at) values ($1, $2, $3, now() + interval '10 minutes')`;
export const TAKE_MICROSOFT_STATE = `delete from microsoft_oauth_state where state = $1 and expires_at > now() returning verifier, surface`;
export const ACTIVE_STAFF_SQL = `select u.id, m.property_id, r.code role
      from app_user u
      join membership m on m.user_id=u.id
      join role r on r.id=m.role_id
      where lower(u.email)=$1 and u.status='ACTIVE' limit 1`;
export const INSERT_SESSION_SQL = `insert into session (token, user_id, property_id, audience, expires_at) values ($1,$2,$3,$4, now() + interval '12 hours')`;

export type Surface = "ADMIN" | "STAFF";
export type Sql = { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
type ExchangeResult = { ok: true; email: string } | { ok: false; reason: "rejected" | "unverified" | "no-email" };
export type MicrosoftOptions = {
  db?: Sql;
  exchangeCode?: (input: { code: string; verifier: string }) => Promise<ExchangeResult>;
};

const exchangeFailure = {
  rejected: "Microsoft did not accept the sign-in",
  unverified: "Could not verify the Microsoft token",
  "no-email": "Microsoft did not tell us your email address",
} as const;

/** Authorization codes travel in the callback query string. Keep them out of request logs. */
export function loggableRequestUrl(url: string): string {
  const query = url.indexOf("?");
  const path = query === -1 ? url : url.slice(0, query);
  return path === "/auth/microsoft/callback" ? path : url;
}

function database(opts?: MicrosoftOptions): Sql {
  if (opts?.db) return opts.db;
  return { query: (text, values) => pool.query(text, values as unknown[]) };
}

export async function saveSignInState(db: Sql, state: string, verifier: string, surface: Surface) {
  await db.query(SWEEP_MICROSOFT_STATE);
  await db.query(INSERT_MICROSOFT_STATE, [state, verifier, surface]);
}

export async function takeSignInState(db: Sql, state: string): Promise<{ verifier: string; surface: Surface } | undefined> {
  await db.query(SWEEP_MICROSOFT_STATE);
  const { rows } = await db.query(TAKE_MICROSOFT_STATE, [state]);
  const row = rows[0];
  if (!row || typeof row.verifier !== "string" || !row.verifier) return undefined;
  if (row.surface !== "ADMIN" && row.surface !== "STAFF") return undefined;
  return { verifier: row.verifier, surface: row.surface };
}

async function exchangeCode(input: { code: string; verifier: string }): Promise<ExchangeResult> {
  const c = cfg();
  const tokenRes = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.client!,
      client_secret: c.secret!,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: `${c.api}/auth/microsoft/callback`,
      code_verifier: input.verifier,
    }),
  });
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel();
    return { ok: false, reason: "rejected" };
  }
  const { id_token } = await tokenRes.json() as { id_token: string };
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${c.tenant}/discovery/v2.0/keys`));
  try {
    const { payload } = await jwtVerify(id_token, jwks, { issuer: `https://login.microsoftonline.com/${c.tenant}/v2.0`, audience: c.client });
    const email = ((payload.preferred_username ?? payload.email) as string | undefined)?.toLowerCase();
    if (!email) return { ok: false, reason: "no-email" };
    return { ok: true, email };
  } catch {
    return { ok: false, reason: "unverified" };
  }
}

export default async function microsoft(f: FastifyInstance, opts?: MicrosoftOptions) {
  const db = database(opts);
  const exchange = opts?.exchangeCode ?? exchangeCode;

  f.get("/auth/providers", async () => ({ microsoft: microsoftEnabled(), dev: process.env.NODE_ENV !== "production", email: staffEmailLoginEnabled(), email_code: staffEmailCodeEnabled() }));

  f.get("/auth/microsoft", async (req, reply) => {
    if (!microsoftEnabled()) return reply.code(404).send(problem(404, "not_configured", "Microsoft sign-in is not configured"));
    const c = cfg();
    const state = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const surface: Surface = (req.query as { surface?: string })?.surface === "staff" ? "STAFF" : "ADMIN";
    await saveSignInState(db, state, verifier, surface);
    const u = new URL(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({
      client_id: c.client!,
      response_type: "code",
      redirect_uri: `${c.api}/auth/microsoft/callback`,
      scope: "openid profile email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return reply.redirect(u.toString());
  });

  f.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/auth/microsoft/callback", async (req, reply) => {
    const c = cfg();
    const { code, state, error, error_description } = req.query;
    const pendingState = state ? await takeSignInState(db, state) : undefined;
    const destination = pendingState?.surface === "STAFF" ? "/pocket/" : "/sign-in/";
    const fail = (why: string) => reply.redirect(`${c.web}${destination}?error=${encodeURIComponent(why)}`);
    if (error) return fail(error_description ?? error);
    if (!code || !pendingState) return fail("Sign-in expired, please try again");
    const exchanged = await exchange({ code, verifier: pendingState.verifier });
    if (!exchanged.ok) return fail(exchangeFailure[exchanged.reason]);
    const email = exchanged.email.trim().toLowerCase();
    if (!email) return fail(exchangeFailure["no-email"]);
    const staff = (await db.query(ACTIVE_STAFF_SQL, [email])).rows[0] as { id?: string; property_id?: string; role?: string } | undefined;
    if (!staff?.id || !staff.property_id || !staff.role) return fail("This Microsoft account is not set up for Vedanta staff access");
    if (staff.role === "SYSTEM_OWNER" && !productionOwnerAllowed(email)) {
      return fail("This system-owner account is not approved in the production allowlist");
    }
    const token = randomBytes(32).toString("base64url");
    await db.query(INSERT_SESSION_SQL, [token, staff.id, staff.property_id, pendingState.surface]);
    return reply.redirect(`${c.web}${destination}#token=${token}`);
  });
}
