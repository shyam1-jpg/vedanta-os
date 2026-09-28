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
import bookingRoute from "./bookingRoute.ts";
import ops from "./ops.ts";
import kitchenStock from "./kitchenStock.ts";
import feedbackRoutes from "./feedback.ts";
import complianceRoutes from "./compliance.ts";
import lostFoundRoutes from "./lostFound.ts";
import supplierRoutes from "./suppliers.ts";
import trainingRoutes from "./training.ts";
import guestHistoryRoutes from "./guestHistory.ts";
import service from "./service.ts";
import manuals from "./manuals.ts";
import tasks from "./tasks.ts";
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
import nightAuditRoutes from "./nightAudit.ts";
import shiftSwapRoutes from "./shiftSwap.ts";
import { assertFieldEncryptionReady } from "./fieldCrypto.ts";
import { decideBookingGate } from "../../../domains/guest/bookingGate.ts";

assertFieldEncryptionReady();

const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  const text = typeof body === "string" ? body : "";
  (req as { rawBody?: string }).rawBody = text;
  if (!text) { done(null, {}); return; }
  try { done(null, JSON.parse(text)); }
  catch (err) { (err as { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
});
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
  reply.header("access-control-allow-headers", "authorization, content-type, if-match, idempotency-key");
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
 * Guest identity safety gate.
 * Local/Cloudflare development can still bootstrap a new My Stay so the product can
 * be tested. Production must not grant a private portal session merely because a
 * browser typed an email address. Keep ALLOW_UNVERIFIED_GUEST_BOOTSTRAP=false until
 * email OTP/magic-link verification is implemented and tested.
 */
app.addHook("preHandler", async (req: any, reply) => {
  const path = String(req.url ?? "").split("?")[0];
  if (path !== "/guest/register" && path !== "/guest/enquiries") return;
  if (req.method !== "POST") return;

  const auth = String(req.headers.authorization ?? "");
  const tokenPresented = auth.startsWith("Bearer ") && auth.slice(7).trim().length > 0;
  const token = tokenPresented ? auth.slice(7).trim() : "";
  const bodyEmail = String(req.body?.email ?? "").trim().toLowerCase();
  const sessionRow = token
    ? (await pool.query(
      `select lower(g.email) email, g.email_verified
       from guest_session s
       join guest_account g on g.id = s.guest_id
       where s.token=$1 and s.expires_at > now() and g.status='ACTIVE'`,
      [token],
    )).rows[0]
    : null;
  const account = bodyEmail.includes("@")
    ? (await pool.query(`select id from guest_account where lower(email)=$1 and status='ACTIVE' limit 1`, [bodyEmail])).rows[0]
    : null;
  const decision = decideBookingGate({
    route: path === "/guest/register" ? "register" : "enquiry",
    production: isProd,
    allowUnverifiedBootstrap: truthy(process.env.ALLOW_UNVERIFIED_GUEST_BOOTSTRAP),
    tokenPresented,
    session: sessionRow ? { email: sessionRow.email, verified: !!sessionRow.email_verified } : null,
    bodyEmail,
    accountExists: !!account,
  });
  if (!decision.ok) return reply.code(decision.status).send(problem(decision.status, decision.code, decision.detail));
});

app.setErrorHandler((err: any, req, reply) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send(problem(status, err.code ?? (status >= 500 ? "internal" : "error"), status >= 500 ? "Something went wrong on our side" : err.message, { trace_id: req.id }));
});

app.get("/health", async () => { await pool.query("select 1"); return { ok: true }; });
await app.register(authRoutes); await app.register(microsoft); await app.register(groups, { prefix: "/v1" }); await app.register(occupancy, { prefix: "/v1" }); await app.register(users, { prefix: "/v1" }); await app.register(guests, { prefix: "/v1" }); await app.register(housekeeping, { prefix: "/v1" }); await app.register(reports, { prefix: "/v1" }); await app.register(packages, { prefix: "/v1" }); await app.register(forms); await app.register(integrations); await app.register(email); await app.register(maintenance, { prefix: "/v1" }); await app.register(autoplace, { prefix: "/v1" }); await app.register(estate, { prefix: "/v1" }); await app.register(workforce); await app.register(guestPortal); await app.register(bookingRoute); await app.register(ops); await app.register(kitchenStock); await app.register(feedbackRoutes); await app.register(complianceRoutes); await app.register(lostFoundRoutes); await app.register(supplierRoutes); await app.register(trainingRoutes); await app.register(guestHistoryRoutes); await app.register(service); await app.register(manuals); await app.register(tasks); await app.register(quality, { prefix: "/v1" }); await app.register(sessions); await app.register(folioRoutes); await app.register(programmeRoutes); await app.register(autoCommsRoutes); await app.register(aiDutyManagerRoutes); await app.register(hrRoutes); await app.register(purchasingRoutes); await app.register(financeRoutes); await app.register(emergencyRoutes); await app.register(stripeRoutes); await app.register(nightAuditRoutes); await app.register(shiftSwapRoutes);
app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" }).then(async () => {
  // Process due auto-communications every 15 minutes
  try {
    const { processAutoComms, reportSchedulerError } = await import("./autocomms.ts");
    const { sendDueFeedback, retainFeedback } = await import("./feedback.ts");
    const { sendDueCompliance } = await import("./compliance.ts");
    const { remindLostFound } = await import("./lostFound.ts");
    const { sendDueDeliveries } = await import("./suppliers.ts");
    const { sendDueTraining } = await import("./training.ts");
    const { purgeGuestHistory } = await import("./guestHistory.ts");
    const { runScheduledNightAudit } = await import("./nightAudit.ts");
    const { expireShiftSwaps } = await import("./shiftSwap.ts");
    const { pool } = await import("./db.ts");
    const runComms = async () => {
      const props = (await pool.query("SELECT id FROM property")).rows;
      for (const p of props) {
        try { await processAutoComms(p.id); } catch (err) { await reportSchedulerError(p.id, "processAutoComms", err); }
        try { await sendDueFeedback(p.id); } catch (err) { await reportSchedulerError(p.id, "sendDueFeedback", err); }
        try { await retainFeedback(p.id); } catch (err) { await reportSchedulerError(p.id, "retainFeedback", err); }
        try { await sendDueCompliance(p.id); } catch (err) { await reportSchedulerError(p.id, "sendDueCompliance", err); }
        try { await remindLostFound(p.id); } catch (err) { await reportSchedulerError(p.id, "remindLostFound", err); }
        try { await sendDueDeliveries(p.id); } catch (err) { await reportSchedulerError(p.id, "sendDueDeliveries", err); }
        try { await sendDueTraining(p.id); } catch (err) { await reportSchedulerError(p.id, "sendDueTraining", err); }
        try { await purgeGuestHistory(p.id); } catch (err) { await reportSchedulerError(p.id, "purgeGuestHistory", err); }
        try { await runScheduledNightAudit(p.id); } catch (err) { await reportSchedulerError(p.id, "runScheduledNightAudit", err); }
        try { await expireShiftSwaps(p.id); } catch (err) { await reportSchedulerError(p.id, "expireShiftSwaps", err); }
      }
    };
    runComms(); // run on boot
    setInterval(runComms, 15 * 60 * 1000); // then every 15 mins
    console.log("[autocomms] scheduler started");
  } catch (e) { console.warn("[autocomms] could not start scheduler:", e); }
}).catch(e => { console.error(e); process.exit(1); });
