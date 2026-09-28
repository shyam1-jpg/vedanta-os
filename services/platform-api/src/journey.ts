/**
 * Guest journey on the existing mail scheduler.
 * Letters go through sendEmail (logged until SMTP is set) and deliverSms (off until Twilio is set).
 * Service notes go without marketing consent. Rebook needs opt-in, and an unsubscribe stops it.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { sendEmail } from "./email.ts";
import { deliverSms } from "./sms.ts";
import { sealList, sealText } from "./fieldCrypto.ts";
import { loadRoutingRules } from "./bookingRoute.ts";
import { UK_ALLERGENS } from "../../../domains/guest/diet.ts";
import {
  departmentEmail,
  departmentSlices,
  type PartyGuest,
  type StayCapture,
} from "../../../domains/guest/booking.ts";
import { guestFacingProgrammeName, programmeKind } from "../../../domains/guest/programmes.ts";
import { parseFeedbackSettings, phoneOk, readyToInvite, signFeedbackToken, smsConfigured } from "../../../domains/guest/feedback.ts";
import {
  JOURNEY_KINDS,
  MARKETING_KINDS,
  addDays,
  arrivalStatusLabel,
  checkInReady,
  checkInSummary,
  checkInWindowOpen,
  mayPlaceWalkUp,
  organiserSummaryDue,
  parseJourneySettings,
  planGuestMessages,
  previewFields,
  readJourneyToken,
  renderMerge,
  retreatList,
  roomForGuest,
  signJourneyToken,
  summaryWave,
  templateFor,
  transitionArrival,
  journeySms,
  type ArrivalStatus,
  type JourneyKind,
  type JourneySettings,
  type PlanInput,
} from "../../../domains/guest/journey.ts";

const ALLERGENS: string[] = [...UK_ALLERGENS];
const SEVERITY = ["PREFERENCE", "INTOLERANCE", "ALLERGY", "ANAPHYLAXIS"];
const LINK_DAYS = 21;

function linkSecret(): string {
  const set = process.env.JOURNEY_LINK_SECRET?.trim();
  if (set) return set;
  if (process.env.NODE_ENV === "production") {
    const key = process.env.FIELD_ENCRYPTION_KEY?.trim();
    if (!key) throw new Error("JOURNEY_LINK_SECRET or FIELD_ENCRYPTION_KEY is required");
    return createHash("sha256").update(`journey-link:${key}`).digest("base64url");
  }
  return "vedanta-dev-journey-link";
}

function feedbackSecret(): string {
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

function publicWeb(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function fmtDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const hits = new Map<string, { n: number; t: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now - cur.t > 60_000) { hits.set(key, { n: 1, t: now }); return true; }
  cur.n += 1;
  return cur.n <= 10;
}

async function londonNow(): Promise<{ date: string; minutes: number }> {
  const row = (await pool.query(
    `select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as date,
            (extract(hour from timezone('Europe/London', now()))::int * 60
             + extract(minute from timezone('Europe/London', now()))::int) as minutes`,
  )).rows[0];
  return { date: String(row.date), minutes: Number(row.minutes) || 0 };
}

async function loadJourney(propertyId: string): Promise<{ settings: JourneySettings; name: string; tenantId: string; checkIn: string; website: string; raw: any }> {
  const row = (await pool.query(
    `select tenant_id, name, settings, check_in_from::text, coalesce(settings->>'website','https://www.thevedanta.org/') website
     from property where id=$1`,
    [propertyId],
  )).rows[0];
  return {
    settings: parseJourneySettings(row?.settings?.journey),
    name: row?.name ?? "The Vedanta",
    tenantId: row?.tenant_id,
    checkIn: String(row?.check_in ?? row?.check_in_from ?? "15:00").slice(0, 5),
    website: row?.website ?? "https://www.thevedanta.org/",
    raw: row?.settings ?? {},
  };
}

function emailOk(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email.includes("@") || /\s/.test(email)) return "";
  return email;
}

async function issueLink(row: { tenantId: string; propertyId: string; groupId: string; personId: string; purpose: "stay" | "details" | "unsubscribe" }, days = LINK_DAYS): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  const token = signJourneyToken({ personId: row.personId, groupId: row.groupId, purpose: row.purpose }, exp, linkSecret());
  await pool.query(
    `insert into guest_journey_link (token_hash, tenant_id, property_id, group_id, person_id, purpose, expires_at)
     values ($1,$2,$3,$4,$5,$6,to_timestamp($7))
     on conflict (token_hash) do nothing`,
    [tokenHash(token), row.tenantId, row.propertyId, row.groupId, row.personId, row.purpose, exp],
  );
  return token;
}

async function claimSend(row: {
  tenantId: string; propertyId: string; groupId: string; personKey: string; personId: string | null;
  kind: JourneyKind; variant: string; to: string;
}): Promise<string | null> {
  const channel = MARKETING_KINDS.includes(row.kind as typeof MARKETING_KINDS[number]) ? "marketing" : "service";
  const inserted = (await pool.query(
    `insert into guest_journey_send (tenant_id, property_id, group_id, person_key, person_id, kind, variant, channel, to_email, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')
     on conflict (group_id, person_key, kind) do nothing
     returning id`,
    [row.tenantId, row.propertyId, row.groupId, row.personKey, row.personId, row.kind, row.variant, channel, row.to],
  )).rows[0];
  return inserted?.id ?? null;
}

async function publishedRetreats(propertyId: string, today: string): Promise<{ name: string; arrival: string }[]> {
  const rows = (await pool.query(
    `select name, public_title, retreat_type, arrival_date::text arrival
     from booking_group
     where property_id=$1 and coalesce(open_for_guests, false) = true
       and status in ('PROVISIONAL','CONFIRMED')
       and retreat_type in ('residential','day_retreat')
       and arrival_date > $2::date
     order by arrival_date limit 6`,
    [propertyId, today],
  )).rows;
  const items: { name: string; arrival: string }[] = [];
  for (const row of rows) {
    const name = guestFacingProgrammeName(row.name, row.public_title, programmeKind(row.retreat_type));
    if (!name) continue;
    items.push({ name, arrival: fmtDate(row.arrival) });
  }
  return items;
}

async function routeDietUpdate(ctx: { tenantId: string; propertyId: string }, stay: StayCapture) {
  const rules = await loadRoutingRules(pool, ctx.propertyId);
  const house = (await pool.query(`select name from property where id=$1`, [ctx.propertyId])).rows[0]?.name ?? "The Vedanta";
  const slices = departmentSlices(stay, rules).filter(slice => slice.department === "KITCHEN" || slice.department === "RESTAURANT");
  for (const slice of slices) {
    const address = slice.department === "KITCHEN" ? rules.kitchen.email : rules.restaurant.email;
    const note = departmentEmail(stay, slice, address, house, "amended");
    if (!note) continue;
    await sendEmail(ctx, { to: note.to, subject: note.subject, body: note.body, kind: note.kind, related_type: "booking_group" });
  }
}

function stayFor(person: { given_name: string; family_name: string }, group: { name: string; arrival: string; departure: string }, allergens: { code: string; severity: string }[], access: boolean): StayCapture {
  const guest: PartyGuest = {
    given_name: person.given_name,
    family_name: person.family_name || "",
    diet: [],
    allergens: allergens.filter(item => SEVERITY.includes(item.severity)).map(item => ({ code: item.code, severity: item.severity as PartyGuest["allergens"][number]["severity"] })),
    other: null,
    accessibility: access ? "Step-free access" : null,
    plate: "buffet",
  };
  return {
    people: 1,
    name: `${person.given_name} ${person.family_name}`.trim(),
    email: "",
    arrival: group.arrival,
    departure: group.departure,
    arrival_slot: "PM",
    departure_slot: "AM",
    party: [guest],
    accessibility_notes: access ? "Step-free access" : null,
    arrival_time_note: null,
    room_preference: null,
    travel_notes: null,
    notes: null,
  };
}

async function feedbackLinkFor(group: { id: string; tenant_id: string; property_id: string; organiser_person_id: string | null; contact_email: string }): Promise<string> {
  const existing = (await pool.query(
    `select id, expires_at from guest_feedback_invite where group_id=$1 and sent_at is not null`,
    [group.id],
  )).rows[0];
  if (existing) {
    const exp = Math.floor(new Date(existing.expires_at).getTime() / 1000);
    const token = signFeedbackToken(existing.id, exp, feedbackSecret());
    return `${publicWeb()}/stay-note/?t=${encodeURIComponent(token)}`;
  }
  const { randomUUID } = await import("node:crypto");
  const inviteId = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 24 * 60 * 60;
  const token = signFeedbackToken(inviteId, exp, feedbackSecret());
  const account = (await pool.query(
    `select id from guest_account where property_id=$1 and lower(email)=lower($2) limit 1`,
    [group.property_id, group.contact_email],
  )).rows[0];
  await pool.query(
    `insert into guest_feedback_invite (id, tenant_id, property_id, group_id, person_id, guest_account_id, token_hash, expires_at, sent_at, email_status, sms_status)
     values ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8), now(), 'journey', 'journey')
     on conflict (group_id) do nothing`,
    [inviteId, group.tenant_id, group.property_id, group.id, group.organiser_person_id, account?.id ?? null, tokenHash(token), exp],
  );
  const stored = (await pool.query(`select id, expires_at from guest_feedback_invite where group_id=$1`, [group.id])).rows[0];
  const useExp = Math.floor(new Date(stored.expires_at).getTime() / 1000);
  const useToken = stored.id === inviteId ? token : signFeedbackToken(stored.id, useExp, feedbackSecret());
  await pool.query(
    `update booking_group set feedback_form_status='SENT', version=version+1 where id=$1 and feedback_form_status is distinct from 'RECEIVED'`,
    [group.id],
  );
  return `${publicWeb()}/stay-note/?t=${encodeURIComponent(useToken)}`;
}

type PersonRow = {
  id: string; given_name: string; family_name: string; email: string; phone: string;
  details_submitted_at: string | null; is_organiser: boolean; marketing_consent: boolean; unsubscribed_at: string | null;
};

async function peopleFor(groupId: string, organiserId: string | null): Promise<PersonRow[]> {
  const rows = (await pool.query(
    `select p.id, p.given_name, p.family_name, p.email, p.phone, ga.details_submitted_at, ga.is_organiser,
            coalesce(gp.marketing_consent, false) marketing_consent, gp.unsubscribed_at
     from group_attendee ga
     join person p on p.id = ga.person_id
     left join guest_profile gp on gp.person_id = p.id
     where ga.group_id=$1
     order by p.given_name, p.family_name`,
    [groupId],
  )).rows as PersonRow[];
  if (rows.length || !organiserId) return rows;
  const organiser = (await pool.query(
    `select p.id, p.given_name, p.family_name, p.email, p.phone, null::timestamptz details_submitted_at, true is_organiser,
            coalesce(gp.marketing_consent, false) marketing_consent, gp.unsubscribed_at
     from person p left join guest_profile gp on gp.person_id=p.id where p.id=$1`,
    [organiserId],
  )).rows[0];
  return organiser ? [organiser] : [];
}

export async function runGuestJourney(propertyId: string): Promise<number> {
  const house = await loadJourney(propertyId);
  if (!house.tenantId) return 0;
  const clock = await londonNow();
  const feedback = parseFeedbackSettings(house.raw.feedback);
  const retreats = retreatList(await publishedRetreats(propertyId, clock.date));
  const groups = (await pool.query(
    `select id, tenant_id, name, contact_email, contact_phone, organiser_person_id,
            arrival_date::text arrival, departure_date::text departure
     from booking_group
     where property_id=$1 and status in ('CONFIRMED','IN_HOUSE','COMPLETED')
       and departure_date >= ($2::date - 400)
       and arrival_date <= ($2::date + 31)
     order by arrival_date limit 40`,
    [propertyId, clock.date],
  )).rows;
  let sent = 0;
  for (const group of groups) {
    const people = await peopleFor(group.id, group.organiser_person_id);
    const prior = (await pool.query(
      `select person_key, kind from guest_journey_send where group_id=$1`,
      [group.id],
    )).rows as { person_key: string; kind: JourneyKind }[];
    const stayThankYouSent = prior.some(row => row.kind === "thank_you");
    const openComplaint = !!(await pool.query(
      `select 1 from guest_feedback f join capa c on c.feedback_id=f.id
       where f.group_id=$1 and c.status not in ('verified','closed') limit 1`,
      [group.id],
    )).rows[0];
    const primary = people.find(person => emailOk(person.email) && emailOk(person.email) === emailOk(group.contact_email))
      ?? people.find(person => person.is_organiser && emailOk(person.email))
      ?? people.find(person => emailOk(person.email));
    const lines: string[] = [];
    for (const person of people) {
      const email = emailOk(person.email);
      const sentKinds = prior.filter(row => row.person_key === person.id).map(row => row.kind);
      const rebooked = !!(await pool.query(
        `select 1 from booking_group later
         where later.property_id=$1 and later.id <> $2
           and later.status in ('PROVISIONAL','CONFIRMED','IN_HOUSE','COMPLETED')
           and later.arrival_date > $3::date
           and (
             later.organiser_person_id=$4
             or lower(later.contact_email)=lower($5)
             or exists (select 1 from group_attendee a where a.group_id=later.id and a.person_id=$4)
           ) limit 1`,
        [propertyId, group.id, group.departure, person.id, email],
      )).rows[0];
      const input: PlanInput = {
        today: clock.date,
        arrival: group.arrival,
        departure: group.departure,
        settings: house.settings,
        sent: sentKinds,
        detailsComplete: !!person.details_submitted_at,
        marketingConsent: !!person.marketing_consent,
        unsubscribed: !!person.unsubscribed_at,
        rebooked,
        openComplaint,
        feedbackReady: readyToInvite(group.departure, feedback),
        stayThankYouSent,
        skipThankYou: primary?.id !== person.id,
      };
      const plans = planGuestMessages(input);
      for (const plan of plans) {
        if (!email && !phoneOk(person.phone)) {
          lines.push(`${person.given_name} ${person.family_name} — no email address`.trim());
          continue;
        }
        const id = await claimSend({
          tenantId: house.tenantId, propertyId, groupId: group.id, personKey: person.id, personId: person.id,
          kind: plan.kind, variant: plan.variant, to: email || phoneOk(person.phone),
        });
        if (!id) continue;
        const detailsToken = await issueLink({ tenantId: house.tenantId, propertyId, groupId: group.id, personId: person.id, purpose: "details" });
        const stayToken = await issueLink({ tenantId: house.tenantId, propertyId, groupId: group.id, personId: person.id, purpose: "stay" });
        const stopToken = await issueLink({ tenantId: house.tenantId, propertyId, groupId: group.id, personId: person.id, purpose: "unsubscribe" }, 180);
        const feedbackUrl = plan.kind === "thank_you"
          ? await feedbackLinkFor({ ...group, property_id: propertyId, tenant_id: house.tenantId })
          : "";
        const fields = {
          ...previewFields(),
          first_name: person.given_name || "Guest",
          group_name: group.name,
          property_name: house.name,
          arrival: fmtDate(group.arrival),
          departure: fmtDate(group.departure),
          details_link: `${publicWeb()}/arrive/?t=${encodeURIComponent(detailsToken)}`,
          stay_link: `${publicWeb()}/arrive/?t=${encodeURIComponent(stayToken)}`,
          feedback_link: feedbackUrl,
          rebook_link: `${publicWeb()}/book/`,
          unsubscribe_link: `${publicWeb()}/opt-out/?t=${encodeURIComponent(stopToken)}`,
          house_rules: house.settings.house_rules,
          what_to_bring: house.settings.what_to_bring,
          directions: house.settings.directions,
          arrival_window: `Arrival is from ${house.checkIn}.`,
          retreats,
          key_instructions: house.settings.key_instructions,
          guest_lines: "",
          shuttle: await shuttleNote(propertyId, person.id),
        };
        const template = templateFor(house.settings, plan.kind);
        const subject = renderMerge(template.subject, fields).text;
        const body = renderMerge(template.body, fields).text;
        let status = "skipped";
        let outbound: string | null = null;
        if (email) {
          const result = await sendEmail(
            { tenantId: house.tenantId, propertyId },
            { to: email, subject, body, kind: `journey_${plan.kind}`, related_type: "booking_group", related_id: group.id },
          );
          status = result.status;
          outbound = result.id;
        }
        let smsStatus = "disabled";
        const phone = phoneOk(person.phone);
        if (phone) {
          const url = plan.kind === "thank_you" ? feedbackUrl : plan.kind === "rebook" ? fields.rebook_link : fields.stay_link;
          const text = journeySms(plan.kind, url);
          smsStatus = text.ok
            ? await deliverSms({
              TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
              TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
              TWILIO_FROM: process.env.TWILIO_FROM,
            }, { to: phone, body: text.body })
            : "failed";
        }
        await pool.query(
          `update guest_journey_send set status=$2, sms_status=$3, outbound_email_id=$4 where id=$1`,
          [id, status, smsStatus, outbound],
        );
        lines.push(`${person.given_name} ${person.family_name} — letter sent`.trim());
        sent += 1;
      }
      if (!plans.length && !email) lines.push(`${person.given_name} ${person.family_name} — no email address`.trim());
    }
    const wave = summaryWave(clock.date, group.arrival, house.settings);
    const summaryKind: JourneyKind | null = wave === "pre_arrival" ? "organiser_pre_arrival" : wave === "see_you_tomorrow" ? "organiser_tomorrow" : null;
    const organiserEmail = emailOk(group.contact_email);
    if (summaryKind && organiserEmail && organiserSummaryDue({
      wave: wave!,
      alreadySent: prior.some(row => row.kind === summaryKind),
      sequenceOn: true,
    })) {
      const id = await claimSend({
        tenantId: house.tenantId, propertyId, groupId: group.id, personKey: "", personId: group.organiser_person_id,
        kind: summaryKind, variant: "summary", to: organiserEmail,
      });
      if (id) {
        const name = people.find(person => person.id === group.organiser_person_id)?.given_name || "organiser";
        const fields = {
          ...previewFields(),
          first_name: name,
          group_name: group.name,
          property_name: house.name,
          arrival: fmtDate(group.arrival),
          departure: fmtDate(group.departure),
          guest_lines: lines.filter(Boolean).join("\n") || "No guests on the list yet.",
          house_rules: house.settings.house_rules,
        };
        const template = templateFor(house.settings, summaryKind);
        const result = await sendEmail(
          { tenantId: house.tenantId, propertyId },
          {
            to: organiserEmail,
            subject: renderMerge(template.subject, fields).text,
            body: renderMerge(template.body, fields).text,
            kind: `journey_${summaryKind}`,
            related_type: "booking_group",
            related_id: group.id,
          },
        );
        await pool.query(`update guest_journey_send set status=$2, outbound_email_id=$3 where id=$1`, [id, result.status, result.id]);
        sent += 1;
      }
    }
  }
  if (house.settings.sequences.check_in) await ensureExpected(propertyId, clock.date);
  await pool.query(
    `update guest_check_in set emergency_name=null, emergency_phone=null, id_ack=false
     where property_id=$1 and emergency_until is not null and emergency_until < $2::date`,
    [propertyId, clock.date],
  );
  return sent;
}

export async function legacyPreArrivalOwned(propertyId: string): Promise<boolean> {
  const house = await loadJourney(propertyId);
  return house.settings.sequences.pre_arrival;
}

async function ensureExpected(propertyId: string, today: string) {
  const house = await loadJourney(propertyId);
  if (!house.settings.sequences.check_in) return;
  const groups = (await pool.query(
    `select id, tenant_id, organiser_person_id from booking_group
     where property_id=$1 and arrival_date=$2::date and status in ('CONFIRMED','IN_HOUSE')`,
    [propertyId, today],
  )).rows;
  for (const group of groups) {
    const people = await peopleFor(group.id, group.organiser_person_id);
    for (const person of people) {
      await pool.query(
        `insert into guest_check_in (tenant_id, property_id, group_id, person_id, status, expected_at)
         select $1,$2,$3,$4,'expected', now()
         where not exists (select 1 from guest_check_in where group_id=$3 and person_id=$4)`,
        [house.tenantId, propertyId, group.id, person.id],
      );
    }
  }
}

async function notifyDesk(propertyId: string, groupId: string, who: string, status: ArrivalStatus) {
  const rules = await loadRoutingRules(pool, propertyId);
  const to = emailOk(rules.front.email);
  if (!to) return;
  const house = await loadJourney(propertyId);
  await sendEmail(
    { tenantId: house.tenantId, propertyId },
    {
      to,
      subject: `Arrival — ${who}`,
      body: `${who} is ${arrivalStatusLabel(status)}.\n\nOpen the arrivals board for the timestamps.\n`,
      kind: "journey_check_in",
      related_type: "booking_group",
      related_id: groupId,
    },
  );
}

async function readPublic(token: string): Promise<{ ok: false; error: string; status: number } | { ok: true; row: any; read: { personId: string; groupId: string; purpose: "stay" | "details" | "unsubscribe" } }> {
  const read = readJourneyToken(token, linkSecret());
  if (!read.ok) return { ok: false, error: read.error, status: read.error.includes("expired") ? 410 : 404 };
  const row = (await pool.query(
    `select l.tenant_id, l.property_id, l.group_id, l.person_id, l.purpose, l.expires_at,
            p.given_name, p.family_name, g.name group_name, g.arrival_date::text arrival, g.departure_date::text departure,
            ga.details_submitted_at, ga.needs_access
     from guest_journey_link l
     join person p on p.id=l.person_id
     join booking_group g on g.id=l.group_id
     left join group_attendee ga on ga.group_id=l.group_id and ga.person_id=l.person_id
     where l.token_hash=$1 and l.expires_at > now()`,
    [tokenHash(token)],
  )).rows[0];
  if (!row || row.person_id !== read.personId || row.group_id !== read.groupId) return { ok: false, error: "This link is not valid", status: 404 };
  return { ok: true, row, read };
}

export async function openStayLink(token: string) {
  return readPublic(token);
}

async function shuttleNote(propertyId: string, personId: string): Promise<string> {
  try {
    const mod = await import("./transport.ts");
    return await mod.shuttleForPerson(propertyId, personId);
  } catch {
    return "No shuttle is booked. Reply if you are coming by train and would like a seat.";
  }
}

async function assignedRoom(groupId: string, personId: string): Promise<{ number: string | null; locked: boolean }> {
  const row = (await pool.query(
    `select r.number, o.assign_locked
     from room_occupancy o join room r on r.id=o.room_id
     where o.group_id=$1 and o.person_id=$2
     order by o.on_date limit 1`,
    [groupId, personId],
  )).rows[0];
  return { number: row?.number ?? null, locked: !!row?.assign_locked };
}

export async function stayLinkForEmail(propertyId: string, email: string): Promise<{ href: string | null; check_in: boolean }> {
  const house = await loadJourney(propertyId);
  const clock = await londonNow();
  const person = (await pool.query(
    `select p.id person_id, g.id group_id, g.tenant_id, g.arrival_date::text arrival
     from person p
     join group_attendee ga on ga.person_id=p.id
     join booking_group g on g.id=ga.group_id
     where g.property_id=$1 and lower(p.email)=lower($2)
       and g.status in ('CONFIRMED','IN_HOUSE')
       and g.arrival_date >= $3::date
     order by g.arrival_date limit 1`,
    [propertyId, email, clock.date],
  )).rows[0];
  if (!person) return { href: null, check_in: false };
  const token = await issueLink({ tenantId: person.tenant_id, propertyId, groupId: person.group_id, personId: person.person_id, purpose: "stay" });
  return {
    href: `${publicWeb()}/arrive/?t=${encodeURIComponent(token)}`,
    check_in: checkInWindowOpen({
      flag: house.settings.sequences.check_in,
      today: clock.date,
      arrival: person.arrival,
      minutes: clock.minutes,
      from: house.settings.check_in_time,
    }),
  };
}

export async function checkInLabels(propertyId: string, groupIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!groupIds.length) return map;
  const rows = (await pool.query(
    `select group_id::text, status from guest_check_in where property_id=$1 and group_id = any($2::uuid[])`,
    [propertyId, groupIds],
  )).rows;
  const grouped = new Map<string, ArrivalStatus[]>();
  for (const row of rows) {
    const list = grouped.get(row.group_id) ?? [];
    list.push(row.status);
    grouped.set(row.group_id, list);
  }
  for (const [id, statuses] of grouped) map.set(id, checkInSummary(statuses));
  return map;
}

function stamp(status: ArrivalStatus): string {
  if (status === "en_route") return "en_route_at";
  if (status === "checked_in_digitally") return "checked_in_at";
  if (status === "arrived") return "arrived_at";
  if (status === "keys_issued") return "keys_at";
  return "expected_at";
}

export default async function journeyRoutes(f: FastifyInstance) {
  f.get("/v1/guest-journey/settings", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const house = await loadJourney(a.propertyId);
    return { ...house.settings, merge_fields: ["first_name", "group_name", "property_name", "arrival", "departure", "details_link", "stay_link", "feedback_link", "rebook_link", "unsubscribe_link", "house_rules", "what_to_bring", "directions", "arrival_window", "retreats", "guest_lines", "key_instructions", "shuttle"], kinds: JOURNEY_KINDS };
  });

  f.put("/v1/guest-journey/settings", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const settings = parseJourneySettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{journey}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.post<{ Body: { kind?: string; subject?: string; body?: string } }>("/v1/guest-journey/preview", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const kind = String(req.body?.kind ?? "pre_arrival") as JourneyKind;
    if (!JOURNEY_KINDS.includes(kind)) return reply.code(422).send(problem(422, "validation", "Choose a message"));
    const house = await loadJourney(a.propertyId);
    const template = {
      subject: String(req.body?.subject ?? "").trim() || templateFor(house.settings, kind).subject,
      body: String(req.body?.body ?? "").trim() || templateFor(house.settings, kind).body,
    };
    const fields = { ...previewFields(), house_rules: house.settings.house_rules, what_to_bring: house.settings.what_to_bring, directions: house.settings.directions, key_instructions: house.settings.key_instructions, property_name: house.name };
    return { subject: renderMerge(template.subject, fields).text, body: renderMerge(template.body, fields).text, missing: renderMerge(`${template.subject}\n${template.body}`, fields).missing };
  });

  f.get<{ Querystring: { group_id?: string } }>("/v1/guest-journey/sends", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const rows = (await pool.query(
      `select s.id, s.group_id, g.name group_name, s.kind, s.variant, s.channel, s.to_email, s.status, s.sms_status, s.sent_at
       from guest_journey_send s join booking_group g on g.id=s.group_id
       where s.property_id=$1 and ($2::uuid is null or s.group_id=$2)
       order by s.sent_at desc limit 50`,
      [a.propertyId, req.query.group_id ?? null],
    )).rows;
    return { items: rows };
  });

  f.get<{ Querystring: { date?: string } }>("/v1/arrivals", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const house = await loadJourney(a.propertyId);
    const today = req.query.date || (await londonNow()).date;
    if (!house.settings.sequences.check_in) return { enabled: false, date: today, items: [], note: "Digital check-in is switched off." };
    await ensureExpected(a.propertyId, today);
    const items = (await pool.query(
      `select c.id, c.group_id, g.name group_name, c.person_id, c.walk_up_name, c.status,
              c.arrival_time, c.rules_ack, c.room_released,
              c.expected_at, c.en_route_at, c.checked_in_at, c.arrived_at, c.keys_at,
              p.given_name, p.family_name,
              (select r.number from room_occupancy o join room r on r.id=o.room_id
                where o.group_id=c.group_id and o.person_id=c.person_id order by o.on_date limit 1) room_number,
              exists (select 1 from room_occupancy o where o.group_id=c.group_id and o.person_id=c.person_id and o.assign_locked) locked
       from guest_check_in c
       join booking_group g on g.id=c.group_id
       left join person p on p.id=c.person_id
       where c.property_id=$1 and g.arrival_date=$2::date
       order by g.name, p.given_name nulls last, c.walk_up_name`,
      [a.propertyId, today],
    )).rows;
    return {
      enabled: true,
      date: today,
      items: items.map(row => ({
        ...row,
        name: row.walk_up_name || `${row.given_name ?? ""} ${row.family_name ?? ""}`.trim(),
        status_label: arrivalStatusLabel(row.status),
        room: roomForGuest({ assigned: row.room_number, released: row.room_released }).show,
      })),
    };
  });

  f.post<{ Body: { group_id?: string; name?: string; room_id?: string } }>("/v1/arrivals/walk-up", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const house = await loadJourney(a.propertyId);
    if (!house.settings.sequences.check_in) return reply.code(409).send(problem(409, "off", "Digital check-in is switched off."));
    const name = String(req.body?.name ?? "").trim().slice(0, 120);
    if (name.length < 2) return reply.code(422).send(problem(422, "validation", "Say who has arrived"));
    const today = (await londonNow()).date;
    const group = (await pool.query(
      `select id from booking_group where id=$1 and property_id=$2 and arrival_date=$3::date and status in ('CONFIRMED','IN_HOUSE')`,
      [req.body?.group_id, a.propertyId, today],
    )).rows[0];
    if (!group) return reply.code(422).send(problem(422, "validation", "Choose a booking that arrives today"));
    if (req.body?.room_id) {
      const locked = (await pool.query(
        `select 1 from room_occupancy where group_id=$1 and room_id=$2 and assign_locked limit 1`,
        [group.id, req.body.room_id],
      )).rows[0];
      const place = mayPlaceWalkUp({ occupantLocked: !!locked });
      if (!place.ok) return reply.code(409).send(problem(409, "locked", place.error));
    }
    const until = addDays(today, house.settings.emergency_retention_days);
    const row = (await pool.query(
      `insert into guest_check_in (tenant_id, property_id, group_id, walk_up_name, status, arrived_at, emergency_until)
       values ($1,$2,$3,$4,'arrived', now(), $5::date) returning id`,
      [a.tenantId, a.propertyId, group.id, name, until],
    )).rows[0];
    await notifyDesk(a.propertyId, group.id, name, "arrived");
    return { id: row.id, status: "arrived" };
  });

  f.post<{ Params: { id: string }; Body: { status?: string } }>("/v1/arrivals/:id/status", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const current = (await pool.query(`select * from guest_check_in where id=$1 and property_id=$2`, [req.params.id, a.propertyId])).rows[0];
    if (!current) return reply.code(404).send(problem(404, "not_found", "That arrival is not on the board"));
    const next = String(req.body?.status ?? "") as ArrivalStatus;
    const move = transitionArrival(current.status, next);
    if (!move.ok) return reply.code(422).send(problem(422, "validation", move.error));
    const column = stamp(next);
    await pool.query(`update guest_check_in set status=$2, ${column}=now() where id=$1`, [current.id, next]);
    if (next === "arrived" || next === "checked_in_digitally") {
      const who = current.walk_up_name || "A guest";
      await notifyDesk(a.propertyId, current.group_id, who, next);
    }
    return { ok: true, status: next };
  });

  f.post<{ Params: { id: string }; Body: { released?: boolean } }>("/v1/arrivals/:id/release", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.update", reply)) return;
    const current = (await pool.query(
      `select c.id, c.group_id, c.person_id from guest_check_in c where c.id=$1 and c.property_id=$2`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!current) return reply.code(404).send(problem(404, "not_found", "That arrival is not on the board"));
    if (current.person_id) {
      const room = await assignedRoom(current.group_id, current.person_id);
      if (room.locked && req.body?.released !== false) {
        const place = mayPlaceWalkUp({ occupantLocked: true });
        if (!place.ok) {
          await pool.query(`update guest_check_in set room_released=true where id=$1`, [current.id]);
          return { ok: true, released: true, locked: true, note: "The organiser's room stays as they left it. The guest can see the number." };
        }
      }
    }
    const released = req.body?.released !== false;
    await pool.query(`update guest_check_in set room_released=$2 where id=$1`, [current.id, released]);
    return { ok: true, released };
  });

  f.get<{ Params: { token: string } }>("/public/journey/:token", async (req, reply) => {
    if (!rateOk(`j:${req.ip}`)) return reply.code(429).send(problem(429, "rate", "Too many tries. Wait a minute."));
    const found = await readPublic(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const house = await loadJourney(found.row.property_id);
    const clock = await londonNow();
    const open = checkInWindowOpen({ flag: house.settings.sequences.check_in, today: clock.date, arrival: found.row.arrival, minutes: clock.minutes, from: house.settings.check_in_time });
    const check = (await pool.query(
      `select status, room_released, rules_ack from guest_check_in where group_id=$1 and person_id=$2`,
      [found.row.group_id, found.row.person_id],
    )).rows[0];
    const room = await assignedRoom(found.row.group_id, found.row.person_id);
    const shown = roomForGuest({ assigned: room.number, released: !!check?.room_released });
    let seva: { slots: unknown[]; mine: unknown[]; welcome: string[] } = { slots: [], mine: [], welcome: [] };
    try {
      const mod = await import("./seva.ts");
      seva = await mod.sevaForStay({
        propertyId: found.row.property_id,
        personId: found.row.person_id,
        from: found.row.arrival,
        to: found.row.departure,
      });
    } catch { /* seva tables are optional until migrated */ }
    const shuttle = await shuttleNote(found.row.property_id, found.row.person_id);
    let reports: { id: string; category: string; room: string; status: string; ask: boolean }[] = [];
    try {
      const faults = await import("./guestFault.ts");
      reports = await faults.guestReports(found.row.property_id, found.row.person_id);
    } catch { /* guest reports are optional until migrated */ }
    const done = check?.status === "checked_in_digitally" || check?.status === "arrived" || check?.status === "keys_issued";
    return {
      given_name: found.row.given_name,
      group_name: found.row.group_name,
      arrival: found.row.arrival,
      departure: found.row.departure,
      allergens: ALLERGENS,
      needs_access: !!found.row.needs_access,
      complete: !!found.row.details_submitted_at,
      purpose: found.read.purpose,
      check_in: {
        enabled: house.settings.sequences.check_in,
        open,
        from: house.settings.check_in_time,
        id_required: house.settings.id_required,
        rules: house.settings.house_rules,
        status: check?.status ?? "expected",
        done,
      },
      welcome: done
        ? { room: shown.show, note: shown.note, keys: house.settings.key_instructions, seva: seva.welcome }
        : null,
      seva: { slots: seva.slots, mine: seva.mine },
      shuttle,
      reports,
    };
  });

  f.post<{ Params: { token: string }; Body: { allergens?: string[]; severity?: string; diet_notes?: string; needs_access?: boolean; confirm?: boolean } }>("/public/journey/:token/details", async (req, reply) => {
    if (!rateOk(`jd:${req.ip}`)) return reply.code(429).send(problem(429, "rate", "Too many tries. Wait a minute."));
    const found = await readPublic(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    if (found.read.purpose === "unsubscribe") return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    if (req.body?.confirm && found.row.details_submitted_at) return { ok: true, confirmed: true };
    const allergens = (req.body?.allergens ?? []).filter(code => ALLERGENS.includes(code));
    const severity = String(req.body?.severity ?? "");
    if (allergens.length && !SEVERITY.includes(severity)) return reply.code(422).send(problem(422, "validation", "Say how serious the allergy is"));
    const access = !!req.body?.needs_access;
    await pool.query(
      `insert into diet_profile (tenant_id, person_id, diet, allergens, severity, notes, allergen_detail, declared_at, version)
       values ($1,$2,'{}',$3,$4,$5,$6, now(), 1)
       on conflict (person_id) do update set allergens=excluded.allergens, severity=excluded.severity, notes=excluded.notes, allergen_detail=excluded.allergen_detail, declared_at=now(), version=diet_profile.version+1`,
      [found.row.tenant_id, found.row.person_id, sealList(allergens), allergens.length ? severity : null, sealText(req.body?.diet_notes || null), sealText(JSON.stringify(allergens.map(code => ({ code, severity }))))],
    );
    await pool.query(
      `update group_attendee set needs_access=$3, details_submitted_at=now() where group_id=$1 and person_id=$2`,
      [found.row.group_id, found.row.person_id, access],
    );
    await routeDietUpdate(
      { tenantId: found.row.tenant_id, propertyId: found.row.property_id },
      stayFor(found.row, found.row, allergens.map(code => ({ code, severity })), access),
    );
    return { ok: true };
  });

  f.post<{ Params: { token: string }; Body: { arrival_time?: string; emergency_name?: string; emergency_phone?: string; rules_ack?: boolean; id_ack?: boolean; confirm_details?: boolean } }>("/public/journey/:token/check-in", async (req, reply) => {
    if (!rateOk(`jc:${req.ip}`)) return reply.code(429).send(problem(429, "rate", "Too many tries. Wait a minute."));
    const found = await readPublic(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const house = await loadJourney(found.row.property_id);
    const clock = await londonNow();
    const ready = checkInReady({
      flag: house.settings.sequences.check_in,
      today: clock.date,
      arrival: found.row.arrival,
      minutes: clock.minutes,
      from: house.settings.check_in_time,
      rulesAck: !!req.body?.rules_ack,
      detailsConfirmed: !!found.row.details_submitted_at,
      idRequired: house.settings.id_required,
      idSeen: !!req.body?.id_ack,
    });
    if (!ready.ok) return reply.code(422).send(problem(422, "validation", ready.error));
    const current = (await pool.query(
      `select id, status from guest_check_in where group_id=$1 and person_id=$2`,
      [found.row.group_id, found.row.person_id],
    )).rows[0];
    const from = (current?.status ?? "expected") as ArrivalStatus;
    if (from === "arrived" || from === "keys_issued" || from === "checked_in_digitally") {
      const room = await assignedRoom(found.row.group_id, found.row.person_id);
      const released = current?.room_released ?? (await pool.query(`select room_released from guest_check_in where group_id=$1 and person_id=$2`, [found.row.group_id, found.row.person_id])).rows[0]?.room_released;
      const shown = roomForGuest({ assigned: room.number, released: !!released });
      return { ok: true, welcome: { room: shown.show, note: shown.note, keys: house.settings.key_instructions } };
    }
    const move = transitionArrival(from, "checked_in_digitally");
    if (!move.ok) return reply.code(422).send(problem(422, "validation", move.error));
    const until = addDays(found.row.departure, house.settings.emergency_retention_days);
    if (!current) {
      await pool.query(
        `insert into guest_check_in (tenant_id, property_id, group_id, person_id, status, arrival_time, emergency_name, emergency_phone, emergency_until, rules_ack, id_ack, checked_in_at)
         values ($1,$2,$3,$4,'checked_in_digitally',$5,$6,$7,$8::date,$9,$10, now())`,
        [found.row.tenant_id, found.row.property_id, found.row.group_id, found.row.person_id, String(req.body?.arrival_time ?? "").slice(0, 40), String(req.body?.emergency_name ?? "").slice(0, 120), String(req.body?.emergency_phone ?? "").slice(0, 40), until, true, !!req.body?.id_ack],
      );
    } else if (current.status !== "checked_in_digitally" && current.status !== "arrived" && current.status !== "keys_issued") {
      await pool.query(
        `update guest_check_in set status='checked_in_digitally', arrival_time=$2, emergency_name=$3, emergency_phone=$4, emergency_until=$5::date, rules_ack=true, id_ack=$6, checked_in_at=now() where id=$1`,
        [current.id, String(req.body?.arrival_time ?? "").slice(0, 40), String(req.body?.emergency_name ?? "").slice(0, 120), String(req.body?.emergency_phone ?? "").slice(0, 40), until, !!req.body?.id_ack],
      );
    }
    await notifyDesk(found.row.property_id, found.row.group_id, found.row.given_name, "checked_in_digitally");
    const room = await assignedRoom(found.row.group_id, found.row.person_id);
    const released = (await pool.query(`select room_released from guest_check_in where group_id=$1 and person_id=$2`, [found.row.group_id, found.row.person_id])).rows[0];
    const shown = roomForGuest({ assigned: room.number, released: !!released?.room_released });
    return { ok: true, welcome: { room: shown.show, note: shown.note, keys: house.settings.key_instructions } };
  });

  f.post<{ Params: { token: string } }>("/public/journey/:token/en-route", async (req, reply) => {
    const found = await readPublic(req.params.token);
    if (!found.ok) return reply.code(found.status).send(problem(found.status, "not_found", found.error));
    const house = await loadJourney(found.row.property_id);
    const clock = await londonNow();
    if (!house.settings.sequences.check_in || clock.date !== found.row.arrival) return reply.code(422).send(problem(422, "validation", "That opens on arrival day"));
    const current = (await pool.query(`select id, status from guest_check_in where group_id=$1 and person_id=$2`, [found.row.group_id, found.row.person_id])).rows[0];
    const from = (current?.status ?? "expected") as ArrivalStatus;
    const move = transitionArrival(from, "en_route");
    if (!move.ok) return reply.code(422).send(problem(422, "validation", move.error));
    if (!current) {
      await pool.query(
        `insert into guest_check_in (tenant_id, property_id, group_id, person_id, status, en_route_at) values ($1,$2,$3,$4,'en_route', now())`,
        [found.row.tenant_id, found.row.property_id, found.row.group_id, found.row.person_id],
      );
    } else {
      await pool.query(`update guest_check_in set status='en_route', en_route_at=now() where id=$1`, [current.id]);
    }
    return { ok: true, status: "en_route" };
  });

  f.get<{ Params: { token: string } }>("/public/journey-opt-out/:token", async (req, reply) => {
    const found = await readPublic(req.params.token);
    if (!found.ok || found.read.purpose !== "unsubscribe") return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    return { given_name: found.row.given_name, property: (await loadJourney(found.row.property_id)).name };
  });

  f.post<{ Params: { token: string } }>("/public/journey-opt-out/:token", async (req, reply) => {
    const found = await readPublic(req.params.token);
    if (!found.ok || found.read.purpose !== "unsubscribe") return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    await pool.query(
      `insert into guest_profile (person_id, tenant_id, marketing_consent, unsubscribed_at)
       values ($1,$2, false, now())
       on conflict (person_id) do update set marketing_consent=false, unsubscribed_at=now()`,
      [found.row.person_id, found.row.tenant_id],
    );
    return { ok: true, note: "Future retreat notes will stop. Messages about a stay you already have will still arrive." };
  });
}
