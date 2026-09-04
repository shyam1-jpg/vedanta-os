/**
 * Auto guest communications engine
 * Schedules and sends emails automatically at key lifecycle moments:
 * - Booking confirmed → confirmation email immediately
 * - 14 days before arrival → balance reminder (if balance outstanding)
 * - 7 days before arrival → pre-arrival information
 * - Day of check-out → checkout reminder (morning)
 * - 3 days after departure → feedback request
 *
 * Run scheduleAutoComms() after any booking status change.
 * Run processAutoComms() on a cron/interval (every 15 mins).
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow } from "./auth.ts";
import { emailConfigured } from "./email.ts";
import nodemailer from "nodemailer";

const FROM = process.env.MAIL_FROM ?? "The Vedanta <bookings@thevedanta.org>";
const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Email templates per communication kind
function renderAutoComm(kind: string, group: any, property: any): { subject: string; body: string } | null {
  const name = group.contact_name ?? group.organisation ?? "organiser";
  const prop = property.name ?? "The Vedanta";
  const arrival = fmtDate(group.arrival_date);
  const departure = fmtDate(group.departure_date);

  switch (kind) {
    case "booking_confirmed":
      return {
        subject: `Your booking is confirmed — ${group.name} at ${prop}`,
        body: `Dear ${name},

We are delighted to confirm your booking with us.

Booking:   ${group.name}
Arrive:    ${arrival}
Depart:    ${departure}
Guests:    ${group.expected_guests ?? "to be confirmed"}

Your booking form is complete and we have received your signed terms and conditions.

If you have any questions before your arrival, please reply to this email — we are always happy to help.

With warm regards,
The Team at ${prop}
${property.website ?? "https://www.thevedanta.org/"}`,
      };

    case "balance_reminder":
      return {
        subject: `Balance reminder — ${group.name} arriving ${arrival}`,
        body: `Dear ${name},

A friendly reminder that the balance for ${group.name} is due before your arrival on ${arrival}.

If you have already arranged payment, please disregard this message. If you have any questions about your balance, please reply to this email.

We look forward to welcoming you very soon.

With warm regards,
The Team at ${prop}
${property.website ?? "https://www.thevedanta.org/"}`,
      };

    case "pre_arrival":
      return {
        subject: `Preparing for your arrival — ${group.name} at ${prop}`,
        body: `Dear ${name},

We are looking forward to welcoming ${group.name} to ${prop} on ${arrival}.

Check-in is from ${property.check_in_from ?? "15:00"}. Please let us know your expected arrival time if you haven't already so we can have everything ready.

If you have any last-minute questions — dietary needs, accessibility requirements, directions — please do not hesitate to get in touch.

The house will be ready and waiting.

With warm regards,
The Team at ${prop}
${property.website ?? "https://www.thevedanta.org/"}`,
      };

    case "checkout_reminder":
      return {
        subject: `Checkout today — ${group.name}`,
        body: `Dear ${name},

We hope you have had a wonderful stay with us.

As a reminder, checkout today (${departure}) is by ${property.check_out_by ?? "11:00"}. Please let us know if you need to arrange luggage storage or a slightly later checkout.

It has been a pleasure having you with us.

With warm regards,
The Team at ${prop}
${property.website ?? "https://www.thevedanta.org/"}`,
      };

    case "feedback":
      return {
        subject: `How was your stay? — ${group.name} at ${prop}`,
        body: `Dear ${name},

Thank you for staying with us. We hope ${group.name} was everything you hoped for.

We would love to hear how your stay went — your feedback helps us make every retreat better. If you have a moment, please reply to this email with any thoughts, suggestions or comments.

We hope to welcome you back soon.

With warm regards,
The Team at ${prop}
${property.website ?? "https://www.thevedanta.org/"}`,
      };

    default:
      return null;
  }
}

// Schedule auto comms for a booking — called when booking is confirmed or dates change
export async function scheduleAutoComms(groupId: string, tenantId: string, propertyId: string) {
  const g = (await pool.query(
    `SELECT g.id, g.name, g.contact_name, g.organisation, g.arrival_date::text, g.departure_date::text,
            g.expected_guests, g.contact_email
     FROM booking_group g WHERE g.id = $1`,
    [groupId]
  )).rows[0];
  if (!g || !g.contact_email) return; // no email address, nothing to schedule

  const arrival = new Date(g.arrival_date + "T15:00:00Z");
  const departure = new Date(g.departure_date + "T09:00:00Z");
  const now = new Date();

  const schedule: { kind: string; when: Date }[] = [
    { kind: "booking_confirmed", when: now }, // immediately
    { kind: "balance_reminder",  when: new Date(arrival.getTime() - 14 * 86400000) },
    { kind: "pre_arrival",       when: new Date(arrival.getTime() - 7  * 86400000) },
    { kind: "checkout_reminder", when: new Date(departure.getTime()) },
    { kind: "feedback",          when: new Date(departure.getTime() + 3 * 86400000) },
  ];

  // Cancel any unsent comms for this group first
  await pool.query(
    `UPDATE auto_comm SET cancelled_at = now(), cancel_reason = 'rescheduled'
     WHERE group_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
    [groupId]
  );

  // Schedule new ones (skip if in the past except for confirmed which fires immediately)
  for (const s of schedule) {
    if (s.kind !== "booking_confirmed" && s.when < now) continue;
    await pool.query(
      `INSERT INTO auto_comm (tenant_id, property_id, group_id, kind, scheduled_for)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [tenantId, propertyId, groupId, s.kind, s.when.toISOString()]
    );
  }
}

// Process due auto comms — call this on a timer (every 15 mins)
export async function processAutoComms(propertyId: string) {
  const due = (await pool.query(
    `SELECT ac.id, ac.kind, ac.group_id, ac.enquiry_id, ac.tenant_id, ac.property_id
     FROM auto_comm ac
     WHERE ac.property_id = $1
       AND ac.scheduled_for <= now()
       AND ac.sent_at IS NULL AND ac.cancelled_at IS NULL
     LIMIT 20`,
    [propertyId]
  )).rows;

  const prop = (await pool.query(
    `SELECT name, check_in_from::text, check_out_by::text, website, settings->>'check_in_from' ci,
            coalesce(settings->>'website','https://www.thevedanta.org/') website
     FROM property WHERE id = $1`, [propertyId]
  )).rows[0] ?? {};

  const results: { id: string; kind: string; status: string }[] = [];

  for (const comm of due) {
    let email: { to: string; subject: string; body: string } | null = null;

    if (comm.group_id) {
      const g = (await pool.query(
        `SELECT name, contact_name, organisation, contact_email, arrival_date::text, departure_date::text, expected_guests
         FROM booking_group WHERE id = $1`, [comm.group_id]
      )).rows[0];
      if (g?.contact_email) {
        const rendered = renderAutoComm(comm.kind, g, prop);
        if (rendered) email = { to: g.contact_email, ...rendered };
      }
    }

    if (!email) {
      await pool.query(`UPDATE auto_comm SET cancelled_at=now(), cancel_reason='no_recipient' WHERE id=$1`, [comm.id]);
      results.push({ id: comm.id, kind: comm.kind, status: "cancelled_no_recipient" });
      continue;
    }

    // Log to outbound_email
    const emailRow = (await pool.query(
      `INSERT INTO outbound_email (tenant_id, property_id, to_email, subject, body, kind, related_type, related_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'booking_group',$7,$8) RETURNING id`,
      [comm.tenant_id, comm.property_id, email.to, email.subject, email.body, `auto_${comm.kind}`,
       comm.group_id, transport ? "QUEUED" : "LOGGED"]
    )).rows[0];

    let status = "LOGGED";
    if (transport) {
      try {
        await transport.sendMail({ from: FROM, to: email.to, subject: email.subject, text: email.body });
        await pool.query(`UPDATE outbound_email SET status='SENT', sent_at=now() WHERE id=$1`, [emailRow.id]);
        status = "SENT";
      } catch {
        await pool.query(`UPDATE outbound_email SET status='FAILED' WHERE id=$1`, [emailRow.id]);
        status = "FAILED";
      }
    }

    await pool.query(
      `UPDATE auto_comm SET sent_at=now(), outbound_email_id=$2 WHERE id=$1`,
      [comm.id, emailRow.id]
    );
    results.push({ id: comm.id, kind: comm.kind, status });
  }

  return results;
}

export default async function autoComms(f: FastifyInstance) {

  // List scheduled/sent auto comms for a booking
  f.get<{ Params: { id: string } }>("/v1/groups/:id/comms", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const r = await pool.query(
      `SELECT ac.id, ac.kind, ac.scheduled_for, ac.sent_at, ac.cancelled_at, ac.cancel_reason,
              oe.status AS email_status, oe.to_email
       FROM auto_comm ac
       LEFT JOIN outbound_email oe ON oe.id = ac.outbound_email_id
       WHERE ac.group_id = $1
       ORDER BY ac.scheduled_for`,
      [req.params.id]
    );
    return { items: r.rows };
  });

  // Cancel a scheduled comm
  f.delete<{ Params: { id: string; commId: string } }>("/v1/groups/:id/comms/:commId", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    await pool.query(
      `UPDATE auto_comm SET cancelled_at=now(), cancel_reason='cancelled_by_staff'
       WHERE id=$1 AND group_id=$2 AND sent_at IS NULL`,
      [req.params.commId, req.params.id]
    );
    return { ok: true };
  });

  // Process due comms now (also runs on cron)
  f.post("/v1/process-auto-comms", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const results = await processAutoComms(a.propertyId);
    return { processed: results.length, results };
  });
}
