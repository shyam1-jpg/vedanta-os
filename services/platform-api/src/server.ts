import Fastify from "fastify";
import { pool } from "./db.ts";
import { problem } from "./auth.ts";
import authRoutes from "./auth.ts";
import microsoft from "./microsoft.ts";
import groups from "./groups.ts";
import occupancy from "./occupancy.ts";
import users from "./users.ts";
import guests from "./guests.ts";
import housekeeping from "./housekeeping.ts";
import reports from "./reports.ts";
import packages from "./packages.ts";
import forms from "./forms.ts";
import integrations from "./integrations.ts";
import email from "./email.ts";
import maintenance from "./maintenance.ts";
import autoplace from "./autoplace.ts";
import estate from "./estate.ts";
import workforce from "./workforce.ts";
import guestPortal from "./guestPortal.ts";
import ops from "./ops.ts";
import service from "./service.ts";
import manuals from "./manuals.ts";
import staffEmailCode from "./staffEmailCode.ts";
import tasks from "./tasks.ts";
import readiness from "./retreat-readiness.ts";
import preRetreat from "./pre-retreat.ts";
import backOfficeRoutes from "./back-office-routes.ts";
import staffAssets from "./staff-assets.ts";
import guestNeedsReviews from "./guest-needs-reviews.ts";
import quality from "./quality.ts";
import sessions from "./sessions.ts";
import folioRoutes from "./folio.ts";
import programmeRoutes from "./programme.ts";
import autoCommsRoutes from "./autocomms.ts";
import aiDutyManagerRoutes from "./ai-duty-manager.ts";
import hrRoutes from "./hr.ts";
import purchasingRoutes from "./purchasing.ts";
import financeRoutes from "./finance.ts";
import emergencyRoutes from "./emergency.ts";
import stripeRoutes from "./stripe.ts";
import guestEmailCode, { takeGuestEmailCode } from "./guestEmailCode.ts";
import {
  EMAIL_CODE_INVALID,
  EMAIL_CODE_REQUIRED,
  guestSignupGate,
  guestSignupPayloadReady,
  guestSignupValidationDetail,
  normalizeGuestEmail,
  type GuestSignupPath,
} from "../../../domains/guest/signup.ts";

const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
const isProd = process.env.NODE_ENV === "production";

function truthy(v: string | undefined): boolean {
  if (v == null) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function configuredOrigins(): Set<string> {
  const values = [
    process.env.WEB_URL,
    process.env.GUEST_WEB_URL,
    process.env.STAFF_WEB_URL,
    ...(process.env.CORS_ORIGINS ?? "").split(","),
  ].map(x => x?.trim()).filter(Boolean) as string[];
  return new Set(values.map(x => {
    try { return new URL(x).origin; } catch { return x.replace(/\/$/, ""); }
  }));
}

const allowedOrigins = configuredOrigins();

app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  const originAllowed = !origin || !isProd || allowedOrigins.has(origin);

  if (origin && originAllowed) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
  }
  reply.header("access-control-allow-headers", "authorization, content-type, if-match");
  reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  reply.header("access-control-expose-headers", "etag");
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (isProd) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");

  if (req.method === "OPTIONS") {
    if (!originAllowed) return reply.code(403).send(problem(403, "origin_not_allowed", "This web origin is not allowed"));
    return reply.code(204).send();
  }
});

/**
 * Guest identity gate for a new My Stay.
 * Production does not open a private stay from a typed email alone, and a bearer
 * token is not proof of a new address. The guest submits the one-time code from
 * POST /guest/email-code/request. An existing guest signs in with their access
 * code; a further enquiry is accepted only when that session owns the email.
 * ALLOW_UNVERIFIED_GUEST_BOOTSTRAP stays off. It would skip this check.
 * Local development can still open a My Stay without a code.
 */
app.addHook("preHandler", async (req: any, reply) => {
  const path = String(req.url ?? "").split("?")[0];
  if (path !== "/guest/register" && path !== "/guest/enquiries") return;

  const email = normalizeGuestEmail(req.body?.email);
  const emailOk = email.includes("@") && email.length <= 254;
  let existingId: string | null = null;
  let sessionOwns = false;
  if (emailOk) {
    const existing = (await pool.query(
      `select id from guest_account where lower(email)=$1 and status='ACTIVE' limit 1`,
      [email],
    )).rows[0];
    existingId = existing?.id ?? null;
    const auth = req.headers.authorization as string | undefined;
    if (existingId && path === "/guest/enquiries" && auth?.startsWith("Bearer ")) {
      const owned = (await pool.query(
        `select 1 from guest_session where token=$1 and guest_id=$2 and expires_at > now() limit 1`,
        [auth.slice(7), existingId],
      )).rowCount;
      sessionOwns = !!owned;
    }
  }

  const decision = guestSignupGate({
    production: isProd,
    allowUnverifiedBootstrap: truthy(process.env.ALLOW_UNVERIFIED_GUEST_BOOTSTRAP),
    path: path as GuestSignupPath,
    existingAccount: !!existingId,
    sessionOwnsAccount: sessionOwns,
  });
  if (decision.action === "reject") {
    return reply.code(decision.status).send(problem(decision.status, decision.code, decision.detail));
  }
  if (decision.action === "allow") {
    req.guestSignupAllowed = true;
    return;
  }
  if (!guestSignupPayloadReady(path as GuestSignupPath, req.body)) {
    return reply.code(422).send(problem(422, "validation", guestSignupValidationDetail(path as GuestSignupPath, req.body)));
  }

  const code = String(req.body?.email_code ?? "");
  if (!code.trim()) {
    return reply.code(503).send(problem(503, "guest_email_verification_required", EMAIL_CODE_REQUIRED));
  }
  if (await takeGuestEmailCode(email, code) !== "ok") {
    return reply.code(401).send(problem(401, "invalid_email_code", EMAIL_CODE_INVALID));
  }
  req.guestEmailVerified = true;
});

app.setErrorHandler((err: any, req, reply) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send(problem(status, err.code ?? (status >= 500 ? "internal" : "error"), status >= 500 ? "Something went wrong on our side" : err.message, { trace_id: req.id }));
});

app.get("/health", async () => { await pool.query("select 1"); return { ok: true }; });
await app.register(authRoutes); await app.register(microsoft); await app.register(staffEmailCode); await app.register(guestEmailCode); await app.register(groups, { prefix: "/v1" }); await app.register(occupancy, { prefix: "/v1" }); await app.register(users, { prefix: "/v1" }); await app.register(guests, { prefix: "/v1" }); await app.register(housekeeping, { prefix: "/v1" }); await app.register(reports, { prefix: "/v1" }); await app.register(packages, { prefix: "/v1" }); await app.register(forms); await app.register(integrations); await app.register(email); await app.register(maintenance, { prefix: "/v1" }); await app.register(autoplace, { prefix: "/v1" }); await app.register(estate, { prefix: "/v1" }); await app.register(workforce); await app.register(guestPortal); await app.register(ops); await app.register(service); await app.register(manuals); await app.register(tasks); await app.register(readiness); await app.register(preRetreat); await app.register(backOfficeRoutes); await app.register(staffAssets); await app.register(guestNeedsReviews); await app.register(quality, { prefix: "/v1" }); await app.register(sessions); await app.register(folioRoutes); await app.register(programmeRoutes); await app.register(autoCommsRoutes); await app.register(aiDutyManagerRoutes); await app.register(hrRoutes); await app.register(purchasingRoutes); await app.register(financeRoutes); await app.register(emergencyRoutes); await app.register(stripeRoutes);
app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" }).then(async () => {
  // Process due auto-communications every 15 minutes
  try {
    const { processAutoComms } = await import("./autocomms.ts");
    const { pool } = await import("./db.ts");
    const runComms = async () => {
      const props = (await pool.query("SELECT id FROM property")).rows;
      for (const p of props) { try { await processAutoComms(p.id); } catch {} }
    };
    runComms(); // run on boot
    setInterval(runComms, 15 * 60 * 1000); // then every 15 mins
    console.log("[autocomms] scheduler started");
  } catch (e) { console.warn("[autocomms] could not start scheduler:", e); }
}).catch(e => { console.error(e); process.exit(1); });
