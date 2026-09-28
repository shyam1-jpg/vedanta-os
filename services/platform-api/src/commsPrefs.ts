/**
 * Guest communication preferences. Every guest letter and text asks this module before it is sent.
 * The switch defaults to off. Quiet-hour holds are released by the existing 15-minute mail job.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { allow, problem, requireActor } from "./auth.ts";
import {
  decideDelivery,
  MARKETING_WORDING,
  parseCommsFlag,
  parseCommsPrefs,
  readCommsToken,
  saveChoice,
  signCommsToken,
  unsubscribeChoice,
  WORDING_VERSION,
  type CommsPrefs,
  type DeliveryDecision,
} from "../../../domains/guest/commsPrefs.ts";

type PrefRow = {
  operational_channel: string; marketing: boolean; marketing_channel: string; quiet_from: string; quiet_to: string;
  consent_at: string | null; consent_source: string | null; wording_version: string | null; wording: string | null;
};

function fromRow(row: PrefRow): CommsPrefs {
  return parseCommsPrefs({
    operational_channel: row.operational_channel,
    marketing: row.marketing,
    marketing_channel: row.marketing_channel,
    quiet_from: row.quiet_from,
    quiet_to: row.quiet_to,
    consent_at: row.consent_at,
    consent_source: row.consent_source,
    wording_version: row.wording_version,
    wording: row.wording,
  });
}

function linkSecret(): string {
  const set = process.env.COMMS_LINK_SECRET?.trim() || process.env.JOURNEY_LINK_SECRET?.trim();
  if (set) return set;
  if (process.env.NODE_ENV === "production") {
    const key = process.env.FIELD_ENCRYPTION_KEY?.trim();
    if (!key) throw new Error("COMMS_LINK_SECRET or JOURNEY_LINK_SECRET is required");
    return key;
  }
  return "dev-comms-link";
}

function publicWeb(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function linksFor(email: string): { preferences: string; unsubscribe: string } {
  const exp = Date.now() + 180 * 86_400_000;
  const secret = linkSecret();
  const prefs = signCommsToken(email, "prefs", exp, secret);
  const stop = signCommsToken(email, "unsubscribe", exp, secret);
  return {
    preferences: `${publicWeb()}/hear/?t=${encodeURIComponent(prefs)}`,
    unsubscribe: `${publicWeb()}/hear/?t=${encodeURIComponent(stop)}`,
  };
}

async function flagOn(propertyId: string): Promise<boolean> {
  const row = (await pool.query(`select coalesce(settings->'comms_prefs', '{}'::jsonb) prefs from property where id=$1`, [propertyId])).rows[0];
  return parseCommsFlag(row?.prefs);
}

async function loadPrefs(propertyId: string, email: string): Promise<CommsPrefs | null> {
  const row = (await pool.query(
    `select operational_channel, marketing, marketing_channel, quiet_from, quiet_to, consent_at::text, consent_source, wording_version, wording
     from guest_comms_pref where property_id=$1 and email=$2`,
    [propertyId, email.trim().toLowerCase()],
  )).rows[0] as PrefRow | undefined;
  return row ? fromRow(row) : null;
}

async function storePrefs(tenantId: string, propertyId: string, email: string, prefs: CommsPrefs, event: { marketing: boolean; source: string; wordingVersion: string; wording: string; at: string } | null) {
  const address = email.trim().toLowerCase();
  await pool.query(
    `insert into guest_comms_pref (tenant_id, property_id, email, operational_channel, marketing, marketing_channel, quiet_from, quiet_to, consent_at, consent_source, wording_version, wording, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     on conflict (property_id, email) do update set
       operational_channel=excluded.operational_channel, marketing=excluded.marketing, marketing_channel=excluded.marketing_channel,
       quiet_from=excluded.quiet_from, quiet_to=excluded.quiet_to, consent_at=excluded.consent_at, consent_source=excluded.consent_source,
       wording_version=excluded.wording_version, wording=excluded.wording, updated_at=now()`,
    [tenantId, propertyId, address, prefs.operationalChannel, prefs.marketing, prefs.marketingChannel, prefs.quietFrom, prefs.quietTo, prefs.consentAt, prefs.consentSource, prefs.wordingVersion, prefs.wording],
  );
  if (event) {
    await pool.query(
      `insert into guest_comms_event (tenant_id, property_id, email, marketing, source, wording_version, wording, at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, propertyId, address, event.marketing, event.source, event.wordingVersion, event.wording, event.at],
    );
  }
  await pool.query(
    `update guest_profile gp set marketing_consent=$3, unsubscribed_at=case when $3 then null else coalesce(gp.unsubscribed_at, now()) end
     from person p where p.id=gp.person_id and gp.tenant_id=$1 and lower(p.email)=lower($2)`,
    [tenantId, address, prefs.marketing],
  ).catch(() => {});
}

export async function gateOutbound(input: {
  tenantId: string;
  propertyId: string;
  to: string;
  email?: string;
  kind: string;
  channel: "email" | "sms";
  audience?: "guest" | "staff";
  urgent?: boolean;
  now?: Date;
}): Promise<DeliveryDecision> {
  const on = await flagOn(input.propertyId);
  const address = (input.email || (input.channel === "email" ? input.to : "")).trim().toLowerCase();
  const prefs = on && address.includes("@") ? await loadPrefs(input.propertyId, address).catch(() => null) : null;
  const links = on && address.includes("@") ? linksFor(address) : undefined;
  return decideDelivery({
    flagOn: on,
    kind: input.kind,
    channel: input.channel,
    audience: input.audience,
    urgent: input.urgent,
    prefs,
    now: input.now ?? new Date(),
    links,
  });
}

export async function releaseDeferredGuestMail(propertyId: string) {
  const due = (await pool.query(
    `select id, tenant_id, to_email, subject, body, kind, channel, guest_email, related_type, related_id
     from outbound_email where property_id=$1 and status='DEFERRED' and not_before <= now() order by not_before limit 40`,
    [propertyId],
  )).rows as { id: string; tenant_id: string; to_email: string; subject: string; body: string; kind: string; channel: string; guest_email: string | null }[];
  for (const row of due) {
    const channel = row.channel === "sms" ? "sms" : "email";
    const decision = await gateOutbound({
      tenantId: row.tenant_id,
      propertyId,
      to: row.to_email,
      email: row.guest_email ?? (channel === "email" ? row.to_email : undefined),
      kind: row.kind,
      channel,
    });
    if (decision.action === "defer") {
      await pool.query(`update outbound_email set not_before=$2, hold_reason=$3 where id=$1`, [row.id, decision.notBefore ?? null, decision.reason]);
      continue;
    }
    if (decision.action === "skip") {
      await pool.query(`update outbound_email set status='SKIPPED', hold_reason=$2 where id=$1`, [row.id, decision.reason]);
      continue;
    }
    if (decision.footer && channel === "email" && !String(row.body).includes("How you hear from The Vedanta")) {
      await pool.query(`update outbound_email set body = body || $2 where id=$1`, [row.id, `\n${decision.footer}`]);
    }
    if (channel === "sms") {
      const { deliverSms } = await import("./sms.ts");
      const status = await deliverSms(
        { TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, TWILIO_FROM: process.env.TWILIO_FROM },
        { to: row.to_email, body: row.body },
      );
      await pool.query(`update outbound_email set status=$2, sent_at=case when $2='SENT' then now() else sent_at end, error=$3 where id=$1`, [row.id, status === "sent" ? "SENT" : "FAILED", status === "sent" ? null : status]);
      continue;
    }
    const { dispatchOutbound } = await import("./email.ts");
    await dispatchOutbound(row.id);
  }
}

async function house(): Promise<{ id: string; tenant_id: string } | null> {
  return (await pool.query(`select id, tenant_id from property order by created_at limit 1`)).rows[0] ?? null;
}

async function guestEmail(req: { headers: { authorization?: string } }): Promise<{ email: string; tenantId: string; propertyId: string } | null> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!token) return null;
  const row = (await pool.query(
    `select g.email, g.tenant_id, g.property_id from guest_session s join guest_account g on g.id=s.guest_id
     where s.token=$1 and s.expires_at > now() and g.status='ACTIVE'`,
    [token],
  )).rows[0];
  return row ? { email: row.email, tenantId: row.tenant_id, propertyId: row.property_id } : null;
}

function view(enabled: boolean, prefs: CommsPrefs | null) {
  const current = prefs ?? parseCommsPrefs(null);
  return {
    enabled,
    operational_channel: current.operationalChannel,
    marketing: current.marketing,
    marketing_channel: current.marketingChannel,
    quiet_from: current.quietFrom,
    quiet_to: current.quietTo,
    consent_at: current.consentAt,
    consent_source: current.consentSource,
    wording_version: current.wordingVersion ?? WORDING_VERSION,
    wording: MARKETING_WORDING,
  };
}

export default async function commsPrefsRoutes(app: FastifyInstance) {
  app.get("/v1/comms-prefs/settings", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "comms.prefs", reply)) return;
    return { enabled: await flagOn(actor.propertyId) };
  });

  app.put<{ Body: { enabled?: boolean } }>("/v1/comms-prefs/settings", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "comms.prefs", reply)) return;
    const enabled = req.body?.enabled === true;
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{comms_prefs}', $2::jsonb, true) where id=$1`,
      [actor.propertyId, JSON.stringify({ enabled })],
    );
    return { enabled };
  });

  app.get("/guest/comms-prefs", async (req, reply) => {
    const guest = await guestEmail(req);
    if (!guest) return reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    const enabled = await flagOn(guest.propertyId).catch(() => false);
    if (!enabled) return { enabled: false, wording: MARKETING_WORDING, wording_version: WORDING_VERSION };
    const prefs = await loadPrefs(guest.propertyId, guest.email).catch(() => null);
    return view(true, prefs);
  });

  app.put<{ Body: { operational_channel?: string; marketing?: boolean; marketing_channel?: string; quiet_from?: string; quiet_to?: string } }>("/guest/comms-prefs", async (req, reply) => {
    const guest = await guestEmail(req);
    if (!guest) return reply.code(401).send(problem(401, "unauthenticated", "Sign in to continue"));
    if (!await flagOn(guest.propertyId)) return reply.code(409).send(problem(409, "off", "The house has not switched this on"));
    const previous = await loadPrefs(guest.propertyId, guest.email);
    const saved = saveChoice({ ...req.body, operationalChannel: req.body?.operational_channel, marketingChannel: req.body?.marketing_channel, quietFrom: req.body?.quiet_from, quietTo: req.body?.quiet_to, at: new Date().toISOString(), source: "my_stay", previous });
    if (!saved.ok) return reply.code(422).send(problem(422, "validation", saved.error));
    await storePrefs(guest.tenantId, guest.propertyId, guest.email, saved.prefs, saved.event);
    return view(true, saved.prefs);
  });

  app.get<{ Params: { token: string } }>("/public/comms/:token", async (req, reply) => {
    const read = readCommsToken(req.params.token, linkSecret());
    if (!read.ok) return reply.code(404).send(problem(404, "not_found", read.error));
    const prop = await house();
    if (!prop) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    const enabled = await flagOn(prop.id).catch(() => false);
    const prefs = enabled ? await loadPrefs(prop.id, read.email).catch(() => null) : null;
    return { ...view(enabled, prefs), purpose: read.purpose, email: read.email.replace(/^(.).*(@.*)$/, "$1…$2") };
  });

  app.post<{ Params: { token: string }; Body: { operational_channel?: string; marketing?: boolean; marketing_channel?: string; quiet_from?: string; quiet_to?: string } }>("/public/comms/:token", async (req, reply) => {
    const read = readCommsToken(req.params.token, linkSecret());
    if (!read.ok || read.purpose !== "prefs") return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    const prop = await house();
    if (!prop) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    if (!await flagOn(prop.id)) return reply.code(409).send(problem(409, "off", "The house has not switched this on"));
    const previous = await loadPrefs(prop.id, read.email);
    const saved = saveChoice({ ...req.body, operationalChannel: req.body?.operational_channel, marketingChannel: req.body?.marketing_channel, quietFrom: req.body?.quiet_from, quietTo: req.body?.quiet_to, at: new Date().toISOString(), source: "preference_page", previous });
    if (!saved.ok) return reply.code(422).send(problem(422, "validation", saved.error));
    await storePrefs(prop.tenant_id, prop.id, read.email, saved.prefs, saved.event);
    return view(true, saved.prefs);
  });

  app.post<{ Params: { token: string } }>("/public/comms/:token/unsubscribe", async (req, reply) => {
    const read = readCommsToken(req.params.token, linkSecret());
    if (!read.ok) return reply.code(404).send(problem(404, "not_found", read.error));
    const prop = await house();
    if (!prop) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    const previous = await loadPrefs(prop.id, read.email).catch(() => null);
    const stopped = unsubscribeChoice(previous, new Date().toISOString());
    await storePrefs(prop.tenant_id, prop.id, read.email, stopped.prefs, stopped.event);
    return { ok: true, note: "Retreat notes are stopped. A message about a booking you already have can still arrive." };
  });
}
