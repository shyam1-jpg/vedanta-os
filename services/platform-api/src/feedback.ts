/** Post-stay feedback. The morning-after job is idempotent: one invite per booking.
 *  The public form needs no sign-in. Free text is sealed. The text service stays off until configured.
 */
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { openText, sealText } from "./fieldCrypto.ts";
import { deliverSms } from "./sms.ts";
import {
  PROBLEM_CATEGORIES,
  SCORE_LABELS,
  capaStatusOk,
  feedbackNotices,
  firstNameOnly,
  guestEmail,
  isKind,
  parseFeedbackSettings,
  parseSubmission,
  phoneOk,
  readFeedbackToken,
  readyToInvite,
  shouldAnonymise,
  signFeedbackToken,
  smsInvite,
  wantsMaintenance,
  type FeedbackSettings,
} from "../../../domains/guest/feedback.ts";
import { ownsFeedbackLetter, parseJourneySettings } from "../../../domains/guest/journey.ts";

const LINK_DAYS = 21;

function linkSecret(): string {
  const set = process.env.FEEDBACK_LINK_SECRET?.trim();
  if (set) return set;
  if (process.env.NODE_ENV === "production") {
    const key = process.env.FIELD_ENCRYPTION_KEY?.trim();
    if (!key) throw new Error("FEEDBACK_LINK_SECRET or FIELD_ENCRYPTION_KEY is required");
    return createHash("sha256").update(`feedback-link:${key}`).digest("base64url");
  }
  return "vedanta-dev-feedback-link";
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const hits = new Map<string, { n: number; t: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now - cur.t > 60_000) { hits.set(key, { n: 1, t: now }); return true; }
  cur.n += 1;
  return cur.n <= 10;
}

async function loadSettings(propertyId: string): Promise<FeedbackSettings> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseFeedbackSettings(row?.settings?.feedback);
}

function presentSettings(settings: FeedbackSettings) {
  return {
    ...settings,
    delay_label: settings.delay === "morning_after" ? "morning_after" : "hours",
    delay_hours: settings.delay === "morning_after" ? null : settings.delay.hours,
    receives: {
      kitchen: "A food problem.",
      front: "A room problem.",
      housekeeping: "A room problem, with front of house.",
      manager: "Every problem, and the only copy of a note about the team.",
    },
  };
}

function publicWeb(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function sendDueFeedback(propertyId: string): Promise<number> {
  const owned = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  if (ownsFeedbackLetter(parseJourneySettings(owned?.settings?.journey))) return 0;
  const settings = await loadSettings(propertyId);
  const prop = (await pool.query(`select name from property where id=$1`, [propertyId])).rows[0];
  const propertyName = prop?.name ?? "The Vedanta";
  const rows = (await pool.query(
    `select g.id, g.tenant_id, g.contact_email, g.contact_phone, g.departure_date::text departure,
            g.organiser_person_id, p.given_name,
            (select ga.id from guest_account ga where ga.property_id=g.property_id and lower(ga.email)=lower(g.contact_email) limit 1) guest_account_id
     from booking_group g
     left join person p on p.id=g.organiser_person_id
     where g.property_id=$1
       and g.status in ('CONFIRMED','IN_HOUSE','COMPLETED')
       and g.departure_date <= (timezone('Europe/London', now()))::date
       and not exists (
         select 1 from guest_feedback_invite i where i.group_id=g.id and i.sent_at is not null
       )
     order by g.departure_date
     limit 30`,
    [propertyId],
  )).rows;
  let sent = 0;
  for (const row of rows) {
    if (!readyToInvite(row.departure, settings)) continue;
    const email = String(row.contact_email ?? "").trim().toLowerCase();
    const emailGood = email.includes("@") && !/\s/.test(email);
    const phone = phoneOk(row.contact_phone);
    const smsOn = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM;
    if (!emailGood && !(smsOn && phone)) continue;
    try {
      const inviteId = randomUUID();
      const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 24 * 60 * 60;
      const token = signFeedbackToken(inviteId, exp, linkSecret());
      const claimed = (await pool.query(
        `insert into guest_feedback_invite (id, tenant_id, property_id, group_id, person_id, guest_account_id, token_hash, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8))
         on conflict (group_id) do update
           set token_hash=excluded.token_hash, expires_at=excluded.expires_at
           where guest_feedback_invite.sent_at is null
         returning id`,
        [inviteId, row.tenant_id, propertyId, row.id, row.organiser_person_id, row.guest_account_id, tokenHash(token), exp],
      )).rows[0];
      if (!claimed) continue;
      const url = `${publicWeb()}/stay-note/?t=${encodeURIComponent(token)}`;
      const name = firstNameOnly(row.given_name);
      let emailStatus = "skipped";
      if (emailGood) {
        const letter = guestEmail(name, url, propertyName);
        const result = await sendEmail(
          { tenantId: row.tenant_id, propertyId, userId: null },
          { to: email, subject: letter.subject, body: letter.body, kind: "feedback_invite", related_type: "guest_feedback_invite", related_id: claimed.id },
        );
        emailStatus = result.status;
      }
      let smsStatus = "disabled";
      if (phone) {
        const text = smsInvite(url);
        smsStatus = text.ok
          ? await deliverSms({
            TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
            TWILIO_FROM: process.env.TWILIO_FROM,
          }, { to: phone, body: text.body, kind: "feedback_invite", email, tenantId: row.tenant_id, propertyId })
          : "failed";
      }
      await pool.query(
        `update guest_feedback_invite set sent_at=now(), email_status=$2, sms_status=$3 where id=$1`,
        [claimed.id, emailStatus, smsStatus],
      );
      await pool.query(
        `update booking_group set feedback_form_status='SENT', version=version+1 where id=$1 and feedback_form_status is distinct from 'RECEIVED'`,
        [row.id],
      );
      sent += 1;
    } catch (err) {
      console.warn("[feedback] invite skipped", err);
    }
  }
  return sent;
}

export async function retainFeedback(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  const rows = (await pool.query(
    `select id, comment, problem_detail, created_at, maintenance_ticket_id, complaint_id
     from guest_feedback where property_id=$1 and anonymised_at is null`,
    [propertyId],
  )).rows;
  let n = 0;
  for (const row of rows) {
    if (!shouldAnonymise(new Date(row.created_at), settings.retention_days)) continue;
    await pool.query(
      `update guest_feedback set comment=null, problem_detail=null, first_name=null, anonymised_at=now() where id=$1`,
      [row.id],
    );
    await pool.query(
      `update capa set root_cause=null, corrective_action=null, preventive_action=null, updated_at=now() where feedback_id=$1`,
      [row.id],
    );
    if (row.maintenance_ticket_id) {
      await pool.query(`update maintenance_ticket set description='Personal detail removed after the retention period.' where id=$1`, [row.maintenance_ticket_id]);
    }
    if (row.complaint_id) {
      await pool.query(`update guest_complaint set description=$2, compensation=null, resolution=null where id=$1`, [row.complaint_id, sealText("Personal detail removed after the retention period.")]);
    }
    n += 1;
  }
  return n;
}

async function inviteByToken(token: string) {
  const read = readFeedbackToken(token, linkSecret());
  if (!read.ok) return { error: read.error, status: read.error.includes("expired") ? 410 : 404 } as const;
  const row = (await pool.query(
    `select i.*, p.name property_name, per.given_name
     from guest_feedback_invite i
     join property p on p.id=i.property_id
     left join person per on per.id=i.person_id
     where i.token_hash=$1`,
    [tokenHash(token)],
  )).rows[0];
  if (!row) return { error: "This link is not valid", status: 404 } as const;
  return { row, read } as const;
}

export default async function feedbackRoutes(f: FastifyInstance) {
  f.get("/v1/settings/feedback", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("group.read")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open feedback settings"));
    }
    return presentSettings(await loadSettings(a.propertyId));
  });

  f.put("/v1/settings/feedback", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const body = req.body ?? {};
    const settings = parseFeedbackSettings({
      delay: body.delay === "hours" || body.delay_label === "hours" ? Number(body.delay_hours ?? body.hours ?? 0) : "morning_after",
      retention_days: body.retention_days,
      open_maintenance: body.open_maintenance,
      emails: body.emails ?? body,
    });
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{feedback}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return presentSettings(settings);
  });

  f.get("/public/feedback/:token", async (req: any, reply) => {
    if (!rateOk(`fb:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Please wait a minute"));
    const found = await inviteByToken(String(req.params.token ?? ""));
    if ("error" in found) {
      const status = found.status ?? 404;
      return reply.code(status).send(problem(status, status === 410 ? "gone" : "not_found", found.error ?? "This link is not valid"));
    }
    const row = found.row;
    if (row.used_at) return { state: "used", property_name: row.property_name };
    if (new Date(row.expires_at).getTime() <= Date.now()) return reply.code(410).send(problem(410, "gone", "This link has expired"));
    return {
      state: "open",
      property_name: row.property_name,
      greeting: firstNameOnly(row.given_name),
      scores: SCORE_LABELS,
      categories: PROBLEM_CATEGORIES,
    };
  });

  f.post("/public/feedback/:token", async (req: any, reply) => {
    if (!rateOk(`fbpost:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Please wait a minute"));
    const parsed = parseSubmission(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const found = await inviteByToken(String(req.params.token ?? ""));
    if ("error" in found) {
      const status = found.status ?? 404;
      return reply.code(status).send(problem(status, status === 410 ? "gone" : "not_found", found.error ?? "This link is not valid"));
    }
    const invite = found.row;
    if (invite.used_at) return reply.code(410).send(problem(410, "gone", "This link has already been used"));
    if (new Date(invite.expires_at).getTime() <= Date.now()) return reply.code(410).send(problem(410, "gone", "This link has expired"));
    const settings = await loadSettings(invite.property_id);
    const name = firstNameOnly(invite.given_name);
    const saved = await tx(async c => {
      const locked = (await c.query(`select used_at from guest_feedback_invite where id=$1 for update`, [invite.id])).rows[0];
      if (!locked || locked.used_at) return null;
      const feedback = (await c.query(
        `insert into guest_feedback (invite_id, tenant_id, property_id, group_id, person_id, guest_account_id, first_name,
           food_score, room_score, overall_score, comment, problem, problem_category, problem_detail)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [invite.id, invite.tenant_id, invite.property_id, invite.group_id, invite.person_id, invite.guest_account_id, name,
          parsed.food, parsed.room, parsed.overall, sealText(parsed.comment || null), parsed.problem, parsed.category, sealText(parsed.detail || null)],
      )).rows[0];
      let capaId: string | null = null;
      let ticketId: string | null = null;
      if (parsed.problem && parsed.category) {
        const due = (await c.query(`select (timezone('Europe/London', now()))::date + 7 d`)).rows[0].d;
        capaId = (await c.query(
          `insert into capa (feedback_id, tenant_id, property_id, status, due_on) values ($1,$2,$3,'open',$4) returning id`,
          [feedback.id, invite.tenant_id, invite.property_id, due],
        )).rows[0].id;
        await c.query(
          `insert into capa_event (capa_id, tenant_id, property_id, to_status, note, by_name) values ($1,$2,$3,'open','Opened from a guest note','Guest')`,
          [capaId, invite.tenant_id, invite.property_id],
        );
        const complaint = (await c.query(
          `insert into guest_complaint (tenant_id, property_id, guest_id, severity, department, description)
           values ($1,$2,$3,'minor',$4,$5) returning id`,
          [invite.tenant_id, invite.property_id, invite.guest_account_id, parsed.category === "food" ? "KITCHEN" : parsed.category === "room" ? "HK" : "MGMT", sealText(parsed.detail)],
        )).rows[0];
        if (wantsMaintenance(parsed.category, settings)) {
          const room = (await c.query(
            `select r.id, r.number from room_occupancy o join room r on r.id=o.room_id where o.group_id=$1 order by o.on_date desc limit 1`,
            [invite.group_id],
          )).rows[0];
          const ticket = (await c.query(
            `insert into maintenance_ticket (tenant_id, property_id, room_id, location, title, description, priority, status, department)
             values ($1,$2,$3,$4,$5,$6,'NORMAL','OPEN','HK') returning id`,
            [invite.tenant_id, invite.property_id, room?.id ?? null, room ? `Room ${room.number}` : "Guest room", "Room note from a guest", parsed.detail],
          )).rows[0];
          ticketId = ticket.id;
        }
        await c.query(`update guest_feedback set maintenance_ticket_id=$2, complaint_id=$3 where id=$1`, [feedback.id, ticketId, complaint.id]);
      }
      await c.query(`update guest_feedback_invite set used_at=now() where id=$1`, [invite.id]);
      await c.query(`update booking_group set feedback_form_status='RECEIVED', version=version+1 where id=$1`, [invite.group_id]);
      await c.query(
        `insert into audit_event (tenant_id, property_id, actor_type, entity_type, entity_id, action, payload)
         values ($1,$2,'INTEGRATION','guest_feedback',$3,'feedback.submit',$4::jsonb)`,
        [invite.tenant_id, invite.property_id, feedback.id, JSON.stringify({ problem: parsed.problem, category: parsed.category, kind: isKind(parsed.overall, parsed.problem) })],
      );
      return { id: feedback.id as string, capaId, ticketId };
    });
    if (!saved) return reply.code(410).send(problem(410, "gone", "This link has already been used"));
    if (parsed.problem && parsed.category) {
      const notes = feedbackNotices({ category: parsed.category, firstName: name, detail: parsed.detail }, settings);
      for (const note of notes) {
        await sendEmail(
          { tenantId: invite.tenant_id, propertyId: invite.property_id, userId: null },
          { to: note.to, subject: note.subject, body: note.body, kind: `feedback_${note.audience}`, related_type: "guest_feedback", related_id: saved.id },
        );
      }
    }
    return { ok: true, kind: isKind(parsed.overall, parsed.problem) };
  });

  f.get("/v1/feedback/dashboard", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const avg = (await pool.query(
      `select count(*)::int n, round(avg(food_score), 1) food, round(avg(room_score), 1) room, round(avg(overall_score), 1) overall
       from guest_feedback where property_id=$1 and anonymised_at is null`,
      [a.propertyId],
    )).rows[0];
    const trends = (await pool.query(
      `select to_char(created_at at time zone 'Europe/London', 'YYYY-MM') month,
              count(*)::int n, round(avg(overall_score), 1) overall
       from guest_feedback where property_id=$1
       group by 1 order by 1 desc limit 6`,
      [a.propertyId],
    )).rows;
    const flagged = (await pool.query(
      `select f.id, f.first_name, f.problem_category, f.problem_detail, f.created_at, f.maintenance_ticket_id,
              c.id capa_id, c.status, c.due_on::text, c.owner_user_id, u.display_name owner_name,
              c.root_cause, c.corrective_action, c.preventive_action
       from guest_feedback f
       left join capa c on c.feedback_id=f.id
       left join app_user u on u.id=c.owner_user_id
       where f.property_id=$1 and f.problem
       order by f.created_at desc limit 50`,
      [a.propertyId],
    )).rows.map((row: any) => ({
      ...row,
      problem_detail: openText(row.problem_detail),
      root_cause: openText(row.root_cause),
      corrective_action: openText(row.corrective_action),
      preventive_action: openText(row.preventive_action),
    }));
    const capaIds = flagged.map((row: { capa_id: string | null }) => row.capa_id).filter(Boolean);
    const events = capaIds.length
      ? (await pool.query(
        `select capa_id, from_status, to_status, note, by_name, created_at
         from capa_event where capa_id = any($1::uuid[]) order by created_at`,
        [capaIds],
      )).rows
      : [];
    const people = (await pool.query(
      `select distinct u.id, u.display_name name
       from app_user u join membership m on m.user_id=u.id
       where m.property_id=$1 and u.status='ACTIVE'
       order by u.display_name`,
      [a.propertyId],
    )).rows;
    return {
      averages: avg,
      trends,
      people,
      flagged: flagged.map((row: { capa_id: string | null }) => ({
        ...row,
        events: events.filter((event: { capa_id: string }) => event.capa_id === row.capa_id),
      })),
    };
  });

  f.get("/v1/feedback/kind-words", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    const rows = (await pool.query(
      `select first_name, comment, overall_score, created_at
       from guest_feedback
       where property_id=$1 and problem=false and overall_score >= 4 and comment is not null and anonymised_at is null
       order by created_at desc limit 40`,
      [a.propertyId],
    )).rows;
    return {
      items: rows.map((row: any) => ({
        first_name: firstNameOnly(row.first_name),
        comment: openText(row.comment),
        overall: row.overall_score,
        created_at: row.created_at,
      })),
    };
  });

  f.patch("/v1/feedback/capa/:id", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const status = req.body?.status;
    if (status != null && !capaStatusOk(status)) return reply.code(422).send(problem(422, "validation", "That status is not on the list"));
    const saved = await tx(async c => {
      const row = (await c.query(`select * from capa where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "No such corrective action"); }
      const next = status ?? row.status;
      const owner = req.body?.owner_user_id !== undefined ? (req.body.owner_user_id || null) : row.owner_user_id;
      const root = req.body?.root_cause !== undefined ? sealText(String(req.body.root_cause ?? "").trim().slice(0, 2000) || null) : row.root_cause;
      const corrective = req.body?.corrective_action !== undefined ? sealText(String(req.body.corrective_action ?? "").trim().slice(0, 2000) || null) : row.corrective_action;
      const preventive = req.body?.preventive_action !== undefined ? sealText(String(req.body.preventive_action ?? "").trim().slice(0, 2000) || null) : row.preventive_action;
      const due = req.body?.due_on !== undefined ? (req.body.due_on || null) : row.due_on;
      await c.query(
        `update capa set status=$2, owner_user_id=$3, root_cause=$4, corrective_action=$5, preventive_action=$6, due_on=$7, updated_at=now() where id=$1`,
        [row.id, next, owner, root, corrective, preventive, due],
      );
      const note = String(req.body?.note ?? "").trim().slice(0, 500) || (next === row.status ? "Details updated" : null);
      await c.query(
        `insert into capa_event (capa_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, a.tenantId, a.propertyId, row.status, next, note, a.userId, a.name],
      );
      await audit(c, a, "capa", row.id, "capa.update", { from: row.status, to: next });
      return { ok: true, status: next };
    });
    return saved;
  });
}
