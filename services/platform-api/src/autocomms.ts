/**
 * Auto guest communications engine
 * Schedules and sends emails automatically at key lifecycle moments:
 * - Booking confirmed → confirmation email immediately
 * - 14 days before arrival → balance reminder (if balance outstanding)
 * - 7 days before arrival → pre-arrival information
 * - Day of check-out → checkout reminder (morning)
 * The post-stay note is a separate morning-after job with a one-time link.
 *
 * Run scheduleAutoComms() after any booking status change.
 * Run processAutoComms() on a cron/interval (every 15 mins).
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow } from "./auth.ts";
import { sendEmail } from "./email.ts";
import { ORGANISER_NAME_SQL, plannedComms, PROPERTY_WEBSITE_SQL, staffAlertAddresses, staffNewEnquiryLetter } from "../../../domains/comms/auto.ts";
import { legacyPreArrivalOwned, runGuestJourney } from "./journey.ts";

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
export async function reportSchedulerError(propertyId: string, job: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[scheduler] ${job} failed for ${propertyId}`, err);
  try {
    const row = (await pool.query(`select tenant_id, settings from property where id=$1`, [propertyId])).rows[0];
    const to = staffAlertAddresses(row?.settings)[0];
    if (!to || !row) return;
    await sendEmail({ tenantId: row.tenant_id, propertyId }, {
      to,
      subject: `House scheduler needs a look — ${job}`,
      body: `${job} failed.\n\n${message}\n`,
      kind: "scheduler_error",
    });
  } catch (alertErr) {
    console.error("[scheduler] could not alert admin", alertErr);
  }
}

export async function queueStaffNewEnquiry(enquiryId: string, tenantId: string, propertyId: string) {
  await pool.query(
    `INSERT INTO auto_comm (tenant_id, property_id, enquiry_id, kind, scheduled_for)
     VALUES ($1,$2,$3,'staff_new_enquiry', now())
     ON CONFLICT (enquiry_id, kind) WHERE enquiry_id IS NOT NULL AND cancelled_at IS NULL
     DO NOTHING`,
    [tenantId, propertyId, enquiryId],
  );
}

export async function scheduleAutoComms(groupId: string, tenantId: string, propertyId: string) {
  const g = (await pool.query(
    `SELECT g.id, g.name, g.organisation, g.arrival_date::text, g.departure_date::text,
            g.expected_guests, g.contact_email,
            ${ORGANISER_NAME_SQL}
     FROM booking_group g
     LEFT JOIN person p ON p.id = g.organiser_person_id
     WHERE g.id = $1`,
    [groupId]
  )).rows[0];
  if (!g || !g.contact_email) {
    console.warn(`[autocomms] booking ${groupId} has no contact email, so nothing was queued`);
    return;
  }

  const arrival = new Date(g.arrival_date + "T15:00:00Z");
  const departure = new Date(g.departure_date + "T09:00:00Z");
  const now = new Date();
  const schedule = plannedComms({ now, arrival, departure });

  await pool.query(
    `UPDATE auto_comm SET cancelled_at = now(), cancel_reason = 'rescheduled'
     WHERE group_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
    [groupId]
  );

  for (const s of schedule) {
    await pool.query(
      `INSERT INTO auto_comm (tenant_id, property_id, group_id, kind, scheduled_for)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (group_id, kind) WHERE group_id IS NOT NULL AND cancelled_at IS NULL
       DO NOTHING`,
      [tenantId, propertyId, groupId, s.kind, s.when.toISOString()]
    );
  }
}

async function deliverAutoEmail(
  comm: { id: string; tenant_id: string; property_id: string; group_id: string | null; enquiry_id?: string | null; kind: string },
  email: { to: string; subject: string; body: string },
) {
  const sent = await sendEmail(
    { tenantId: comm.tenant_id, propertyId: comm.property_id },
    {
      to: email.to,
      subject: email.subject,
      body: email.body,
      kind: `auto_${comm.kind}`,
      related_type: comm.group_id ? "booking_group" : "guest_enquiry",
      related_id: comm.group_id ?? comm.enquiry_id ?? undefined,
    },
  );
  if (sent.status === "FAILED") {
    console.error(`[autocomms] send failed for ${comm.kind} ${comm.id}`, sent.error);
    await reportSchedulerError(comm.property_id, `auto_${comm.kind}`, new Error(sent.error ?? "email failed"));
  }
  // SMTP_URL unset: sendEmail keeps the letter as LOGGED. Nothing is dropped.
  return sent;
}

// Process due auto comms — call this on a timer (every 15 mins)
export async function processAutoComms(propertyId: string) {
  await runGuestJourney(propertyId);
  const journeyPreArrival = await legacyPreArrivalOwned(propertyId);
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
    `SELECT name, tenant_id, settings, check_in_from::text, check_out_by::text,
            ${PROPERTY_WEBSITE_SQL}
     FROM property WHERE id = $1`, [propertyId]
  )).rows[0] ?? {};

  const results: { id: string; kind: string; status: string }[] = [];

  for (const comm of due) {
    let email: { to: string; subject: string; body: string } | null = null;

    if (comm.kind === "pre_arrival" && journeyPreArrival) {
      await pool.query(`UPDATE auto_comm SET cancelled_at=now(), cancel_reason='guest_journey' WHERE id=$1`, [comm.id]);
      results.push({ id: comm.id, kind: comm.kind, status: "guest_journey" });
      continue;
    }

    if (comm.kind === "feedback") {
      await pool.query(`UPDATE auto_comm SET cancelled_at=now(), cancel_reason='feedback_form' WHERE id=$1`, [comm.id]);
      results.push({ id: comm.id, kind: comm.kind, status: "feedback_form" });
      continue;
    }

    if (comm.kind === "staff_new_enquiry") {
      const enquiry = (await pool.query(
        `SELECT name, email, people, arrival_date::text AS arrival, departure_date::text AS departure
         FROM guest_enquiry WHERE id=$1`,
        [comm.enquiry_id],
      )).rows[0];
      const recipients = staffAlertAddresses(prop.settings);
      if (!enquiry || !recipients.length) {
        console.warn(`[autocomms] staff_new_enquiry ${comm.id} has no recipient`);
        await pool.query(`UPDATE auto_comm SET cancelled_at=now(), cancel_reason='no_recipient' WHERE id=$1`, [comm.id]);
        results.push({ id: comm.id, kind: comm.kind, status: "cancelled_no_recipient" });
        continue;
      }
      const letter = staffNewEnquiryLetter(enquiry);
      let lastId: string | null = null;
      let status = "LOGGED";
      for (const to of recipients) {
        const sent = await deliverAutoEmail(comm, { to, ...letter });
        lastId = sent.id;
        status = sent.status;
      }
      await pool.query(`UPDATE auto_comm SET sent_at=now(), outbound_email_id=$2 WHERE id=$1`, [comm.id, lastId]);
      results.push({ id: comm.id, kind: comm.kind, status });
      continue;
    }

    if (comm.group_id) {
      const g = (await pool.query(
        `SELECT g.name, g.organisation, g.contact_email, g.arrival_date::text, g.departure_date::text, g.expected_guests,
                ${ORGANISER_NAME_SQL}
         FROM booking_group g
         LEFT JOIN person p ON p.id = g.organiser_person_id
         WHERE g.id = $1`, [comm.group_id]
      )).rows[0];
      if (g?.contact_email) {
        const rendered = renderAutoComm(comm.kind, g, prop);
        if (rendered) email = { to: g.contact_email, ...rendered };
      }
    }

    if (!email) {
      console.warn(`[autocomms] ${comm.kind} ${comm.id} has no recipient`);
      await pool.query(`UPDATE auto_comm SET cancelled_at=now(), cancel_reason='no_recipient' WHERE id=$1`, [comm.id]);
      results.push({ id: comm.id, kind: comm.kind, status: "cancelled_no_recipient" });
      continue;
    }

    const sent = await deliverAutoEmail(comm, email);
    await pool.query(
      `UPDATE auto_comm SET sent_at=now(), outbound_email_id=$2 WHERE id=$1`,
      [comm.id, sent.id]
    );
    results.push({ id: comm.id, kind: comm.kind, status: sent.status });
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
