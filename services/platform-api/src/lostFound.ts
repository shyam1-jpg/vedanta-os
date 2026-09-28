/** Lost and found. Contact details are sealed and removed when a case closes.
 *  A missing report never messages the guest. Staff preview, then send. */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { sendEmail } from "./email.ts";
import { deliverSms } from "./sms.ts";
import { openText, sealText } from "./fieldCrypto.ts";
import { cleanPhoto, parseAreas } from "../../../domains/ops/fault.ts";
import { phoneOk, smsConfigured } from "../../../domains/guest/feedback.ts";
import {
  LOST_CATEGORIES,
  closedStatus,
  disposalDue,
  disposalNotice,
  heldTooLong,
  lostGuestMessage,
  lostReference,
  parseFoundItem,
  parseKeep,
  parseLostSettings,
  parseMissingReport,
  parseReturnChoice,
  parseSignature,
  parseStatusChange,
  rankMatches,
  renderSlipPdf,
  retentionNotice,
  slipLines,
  staffChoiceNote,
  type ReturnSlip,
} from "../../../domains/ops/lostFound.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function londonToday(): Promise<string> {
  return (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d;
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseLostSettings(row?.settings?.lost_found);
}

function publicWeb(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

function smsEnv() {
  return {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM: process.env.TWILIO_FROM,
  };
}

function jpegBytes(photo: string | null | undefined): Uint8Array | undefined {
  const marker = "data:image/jpeg;base64,";
  if (!photo?.startsWith(marker)) return undefined;
  const buf = Buffer.from(photo.slice(marker.length), "base64");
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  return new Uint8Array(buf);
}

function methodLabel(row: { return_method?: string | null; guest_choice_detail?: string | null }): string {
  if (row.return_method === "posted") return "Posted";
  if (row.return_method === "collected") return "Collected";
  return row.guest_choice_detail || "";
}

async function propertyName(propertyId: string): Promise<{ name: string; tenant_id: string } | null> {
  return (await pool.query(`select name, tenant_id from property where id=$1`, [propertyId])).rows[0] ?? null;
}

type StayReport = {
  id: string;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  guest_account_id: string | null;
  group_id: string | null;
  booking_ref: string | null;
  matched_item_id: string | null;
  status: string;
  category: string;
  place: string | null;
  happened_on: string | null;
  rejected_ids: string[] | null;
  guest_choice: string | null;
  guest_choice_detail: string | null;
  rooms?: string[];
  stay_from?: string | null;
  stay_to?: string | null;
  guest_name?: string;
  booking_code?: string;
};

async function attachStays(propertyId: string, reports: StayReport[]): Promise<StayReport[]> {
  const groupIds = [...new Set(reports.map(r => r.group_id).filter((id): id is string => !!id))];
  const refs = [...new Set(reports.map(r => String(r.booking_ref ?? "").trim().toLowerCase()).filter(Boolean))];
  const guestIds = [...new Set(reports.map(r => r.guest_account_id).filter((id): id is string => !!id))];
  const reservations = groupIds.length || refs.length
    ? (await pool.query(
      `select id, group_id, confirmation_code, arrival_date::text arrival, departure_date::text departure,
              (select trim(p.given_name || ' ' || p.family_name) from person p where p.id = reservation.primary_guest_id) guest_name
       from reservation
       where property_id=$1 and (group_id = any($2::uuid[]) or lower(confirmation_code) = any($3::text[]))`,
      [propertyId, groupIds, refs],
    )).rows : [];
  const resIds = reservations.map((row: { id: string }) => row.id);
  const occGroups = [...new Set([...groupIds, ...reservations.map((row: { group_id: string | null }) => row.group_id).filter(Boolean)])];
  const occupied = occGroups.length
    ? (await pool.query(
      `select o.group_id, rm.number from room_occupancy o join room rm on rm.id = o.room_id where o.group_id = any($1::uuid[])`,
      [occGroups],
    )).rows : [];
  const assigned = resIds.length
    ? (await pool.query(
      `select ra.reservation_id, rm.number from room_assignment ra join room rm on rm.id = ra.room_id where ra.reservation_id = any($1::uuid[])`,
      [resIds],
    )).rows : [];
  const guests = guestIds.length
    ? (await pool.query(`select id, display_name from guest_account where id = any($1::uuid[])`, [guestIds])).rows : [];
  const guestById = new Map(guests.map((row: { id: string; display_name: string }) => [row.id, row.display_name]));
  return reports.map(report => {
    const ref = String(report.booking_ref ?? "").trim().toLowerCase();
    const byRef = ref ? reservations.find((row: { confirmation_code: string }) => String(row.confirmation_code).toLowerCase() === ref) : null;
    const byGroup = report.group_id ? reservations.find((row: { group_id: string | null }) => row.group_id === report.group_id) : null;
    const stay = byRef ?? byGroup ?? null;
    const groupId = report.group_id || stay?.group_id || null;
    const rooms = [...new Set([
      ...occupied.filter((row: { group_id: string }) => row.group_id === groupId).map((row: { number: string }) => row.number),
      ...(stay ? assigned.filter((row: { reservation_id: string }) => row.reservation_id === stay.id).map((row: { number: string }) => row.number) : []),
    ])];
    const contact = openText(report.contact_name);
    return {
      ...report,
      description: openText(report.description),
      contact_name: contact,
      contact_email: openText(report.contact_email),
      contact_phone: openText(report.contact_phone),
      guest_name: contact || (report.guest_account_id ? guestById.get(report.guest_account_id) : "") || stay?.guest_name || "",
      booking_code: stay?.confirmation_code || report.booking_ref || "",
      stay_from: stay?.arrival ?? null,
      stay_to: stay?.departure ?? null,
      rooms,
    };
  });
}

async function loadSlipRow(propertyId: string, id: string) {
  return (await pool.query(
    `select i.*, i.found_on::text,
            r.id report_id, r.contact_name report_contact, r.guest_choice_detail, r.booking_ref, r.group_id, r.guest_account_id,
            coalesce(nullif(trim(ga.display_name), ''), nullif(trim(coalesce(p.given_name, '') || ' ' || coalesce(p.family_name, '')), ''), nullif(trim(coalesce(bp.given_name, '') || ' ' || coalesce(bp.family_name, '')), '')) guest_display,
            coalesce(res.confirmation_code, bygroup.confirmation_code, r.booking_ref) booking_code
     from lost_item i
     left join lateral (
       select * from lost_report where matched_item_id = i.id and property_id = i.property_id order by created_at desc limit 1
     ) r on true
     left join guest_account ga on ga.id = r.guest_account_id
     left join reservation res on res.property_id = i.property_id and r.booking_ref is not null and lower(res.confirmation_code) = lower(r.booking_ref)
     left join person p on p.id = res.primary_guest_id
     left join lateral (
       select confirmation_code, primary_guest_id from reservation
       where group_id = r.group_id and property_id = i.property_id order by arrival_date limit 1
     ) bygroup on true
     left join person bp on bp.id = bygroup.primary_guest_id
     where i.id=$1 and i.property_id=$2`,
    [id, propertyId],
  )).rows[0];
}

function presentSlip(row: any, handler: string): ReturnSlip & { photo: string | null; signature: string | null; status: string; postage_note?: string } {
  const photo = typeof row.photo === "string" && row.photo.startsWith("data:image/") ? row.photo : null;
  const signature = typeof row.signature === "string" && row.signature.startsWith("data:image/png;base64,") ? row.signature : null;
  const guestName = openText(row.report_contact) || row.guest_display || "";
  return {
    reference: row.reference || lostReference(row.id),
    description: row.description,
    foundPlace: row.place,
    foundOn: String(row.found_on).slice(0, 10),
    guestName,
    bookingRef: row.booking_code || "",
    method: methodLabel(row),
    handler: row.handled_by_name || handler || "Staff",
    hasPhoto: !!photo,
    photo,
    signature,
    status: row.status,
  };
}

async function closeReport(c: { query: Function }, itemId: string, propertyId: string) {
  await c.query(
    `update lost_report set status='closed', contact_name=null, contact_email=null, contact_phone=null, guest_choice_detail=null
     where matched_item_id=$1 and property_id=$2`,
    [itemId, propertyId],
  );
}

export async function remindLostFound(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  if (!settings.manager) return 0;
  const today = await londonToday();
  const prop = await propertyName(propertyId);
  if (!prop) return 0;
  const rows = (await pool.query(
    `select id, found_on::text, status from lost_item
     where property_id=$1 and retention_alerted_at is null and status in ('logged','matched','claimed')`,
    [propertyId],
  )).rows.filter((row: { found_on: string; status: string }) => heldTooLong(row.found_on, today, settings.hold_days, row.status));
  let n = 0;
  if (rows.length) {
    const ids = rows.map((row: { id: string }) => row.id);
    await pool.query(`update lost_item set retention_alerted_at=now() where id = any($1::uuid[]) and retention_alerted_at is null`, [ids]);
    const note = retentionNotice(ids.length, settings.hold_days);
    await sendEmail(
      { tenantId: prop.tenant_id, propertyId, userId: null },
      { to: settings.manager, subject: note.subject, body: note.body, kind: "lost_found_retention", related_type: "lost_item", related_id: ids[0] },
    );
    n += ids.length;
  }
  const due = (await pool.query(
    `select id, found_on::text, status,
            (timezone('Europe/London', notified_at))::date::text notified_on,
            disposal_hold_until::text hold_until
     from lost_item
     where property_id=$1 and disposal_alerted_at is null and status in ('logged','matched','claimed')`,
    [propertyId],
  )).rows.filter((row: { found_on: string; notified_on: string | null; hold_until: string | null; status: string }) => disposalDue({
    foundOn: row.found_on, notifiedOn: row.notified_on, holdUntil: row.hold_until, today, disposalDays: settings.disposal_days, status: row.status,
  }));
  if (due.length) {
    const ids = due.map((row: { id: string }) => row.id);
    await pool.query(`update lost_item set disposal_alerted_at=now() where id = any($1::uuid[]) and disposal_alerted_at is null`, [ids]);
    const note = disposalNotice(ids.length, settings.disposal_days);
    await sendEmail(
      { tenantId: prop.tenant_id, propertyId, userId: null },
      { to: settings.manager, subject: note.subject, body: note.body, kind: "lost_found_disposal", related_type: "lost_item", related_id: ids[0] },
    );
    n += ids.length;
  }
  return n;
}

async function loadPublic(token: string) {
  if (token.length < 16 || token.length > 200) return null;
  return (await pool.query(
    `select l.expires_at, l.tenant_id, l.property_id, l.report_id,
            r.guest_choice, r.guest_choice_detail, r.status report_status,
            i.id item_id, i.description, i.reference, i.status item_status,
            p.name property_name, p.settings
     from lost_link l
     join lost_report r on r.id = l.report_id
     join lost_item i on i.id = l.item_id
     join property p on p.id = l.property_id
     where l.token_hash=$1`,
    [tokenHash(token)],
  )).rows[0] ?? null;
}

export default async function lostFoundRoutes(f: FastifyInstance) {
  f.get("/v1/settings/lost-found", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("lostfound.log")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open lost and found settings"));
    }
    return await loadSettings(a.propertyId);
  });

  f.put("/v1/settings/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseLostSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{lost_found}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const today = await londonToday();
    const settings = await loadSettings(a.propertyId);
    const rooms = (await pool.query(`select number from room where property_id=$1 order by number`, [a.propertyId])).rows.map((row: { number: string }) => row.number);
    const areas = parseAreas((await pool.query(`select settings from property where id=$1`, [a.propertyId])).rows[0]?.settings?.fault_areas);
    const items = (await pool.query(
      `select i.*, i.found_on::text,
              (timezone('Europe/London', i.notified_at))::date::text notified_on,
              i.disposal_hold_until::text hold_until,
              (select json_agg(json_build_object('from_status', e.from_status, 'to_status', e.to_status, 'note', e.note, 'by_name', e.by_name, 'created_at', e.created_at) order by e.created_at)
               from lost_event e where e.item_id = i.id) events
       from lost_item i where i.property_id=$1 order by i.found_on desc limit 200`,
      [a.propertyId],
    )).rows.map((row: any) => ({
      ...row,
      claimant_name: openText(row.claimant_name),
      reference: row.reference || lostReference(row.id),
      has_photo: !!row.photo,
      has_signature: !!row.signature,
      photo: undefined,
      signature: undefined,
      held_long: heldTooLong(row.found_on, today, settings.hold_days, row.status),
      disposal_due: disposalDue({
        foundOn: row.found_on,
        notifiedOn: row.notified_on,
        holdUntil: row.hold_until,
        today,
        disposalDays: settings.disposal_days,
        status: row.status,
      }),
      events: row.events ?? [],
    }));
    const rawReports = (await pool.query(
      `select id, description, category, place, happened_on::text, guest_account_id, group_id, booking_ref,
              contact_name, contact_email, contact_phone, status, matched_item_id, rejected_ids,
              guest_choice, guest_choice_detail, choice_at, created_at
       from lost_report where property_id=$1 order by created_at desc limit 100`,
      [a.propertyId],
    )).rows as StayReport[];
    const opened = await attachStays(a.propertyId, rawReports);
    const linked = new Map<string, StayReport>();
    for (const report of opened) {
      if (report.matched_item_id && !linked.has(report.matched_item_id)) linked.set(report.matched_item_id, report);
    }
    const withGuest = items.map((item: any) => {
      const report = linked.get(item.id);
      return {
        ...item,
        report_id: report?.id ?? null,
        guest_name: report?.guest_name || "",
        booking_ref: report?.booking_code || "",
        guest_choice: report?.guest_choice ?? null,
        guest_choice_detail: report?.guest_choice_detail ?? null,
      };
    });
    const reports = opened.map(report => ({
      ...report,
      suggestions: report.status === "open"
        ? rankMatches({
          description: report.description || "",
          category: report.category,
          place: report.place,
          happened_on: report.happened_on,
          rooms: report.rooms ?? [],
          stay_from: report.stay_from,
          stay_to: report.stay_to,
        }, withGuest, report.rejected_ids ?? []).map(row => ({
          id: row.item.id,
          reference: row.item.reference,
          description: row.item.description,
          place: row.item.place,
          found_on: row.item.found_on,
          score: row.score,
          reasons: row.reasons,
        }))
        : [],
    }));
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    const category = String(req.query?.category ?? "");
    const status = String(req.query?.status ?? "");
    const place = String(req.query?.place ?? "");
    let filtered = withGuest;
    if (category) filtered = filtered.filter((item: { category: string }) => item.category === category);
    if (status) filtered = filtered.filter((item: { status: string }) => item.status === status);
    if (place) filtered = filtered.filter((item: { place: string }) => item.place === place);
    if (q) filtered = filtered.filter((item: { description: string; storage: string | null; reference: string }) => `${item.reference} ${item.description} ${item.storage ?? ""}`.toLowerCase().includes(q));
    const disposal = withGuest.filter((item: { disposal_due: boolean }) => item.disposal_due).map((item: any) => ({
      id: item.id, reference: item.reference, description: item.description, found_on: item.found_on, status: item.status, notified_on: item.notified_on,
    }));
    return {
      items: filtered, reports, rooms, areas, categories: LOST_CATEGORIES,
      hold_days: settings.hold_days, disposal_days: settings.disposal_days, postage_note: settings.postage_note, disposal,
    };
  });

  f.post("/v1/lost-found", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const parsed = parseFoundItem(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const photo = cleanPhoto(req.body?.photo);
    if (!photo.ok) return reply.code(422).send(problem(422, "validation", photo.error));
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into lost_item (tenant_id, property_id, description, category, place, found_on, found_by_user_id, found_by_name, photo, storage)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [a.tenantId, a.propertyId, parsed.description, parsed.category, parsed.place, parsed.foundOn, a.userId, a.name, photo.photo, parsed.storage || null],
      )).rows[0];
      const reference = lostReference(row.id);
      await c.query(`update lost_item set reference=$2 where id=$1`, [row.id, reference]);
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,'logged','Logged as found',$4,$5)`,
        [row.id, a.tenantId, a.propertyId, a.userId, a.name],
      );
      await audit(c, a, "lost_item", row.id, "lostfound.add", { payload: { place: parsed.place, reference } });
      return { id: row.id, reference };
    });
    reply.code(201);
    return saved;
  });

  f.post("/v1/lost-found/reports", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const parsed = parseMissingReport(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const guest = String(req.body?.guest_account_id ?? "").trim();
    let group = String(req.body?.group_id ?? "").trim();
    const bookingRef = String(req.body?.booking_ref ?? "").trim().slice(0, 40);
    if (guest && !UUID.test(guest)) return reply.code(422).send(problem(422, "validation", "That guest is not on the list"));
    if (group && !UUID.test(group)) return reply.code(422).send(problem(422, "validation", "That booking is not on the list"));
    if (bookingRef) {
      const reservation = (await pool.query(
        `select group_id from reservation where property_id=$1 and lower(confirmation_code)=lower($2) limit 1`,
        [a.propertyId, bookingRef],
      )).rows[0];
      if (!reservation) return reply.code(422).send(problem(422, "validation", "That booking reference was not found"));
      if (!group && reservation.group_id) group = reservation.group_id;
    }
    // A missing report is saved only. The guest is not told until staff send the message.
    const saved = await tx(async c => {
      const row = (await c.query(
        `insert into lost_report (tenant_id, property_id, description, category, place, happened_on, guest_account_id, group_id, booking_ref, contact_name, contact_email, contact_phone, created_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [a.tenantId, a.propertyId, sealText(parsed.description), parsed.category, parsed.place || null, parsed.happenedOn || null, guest || null, group || null, bookingRef || null,
          sealText(parsed.contactName || null), sealText(parsed.contactEmail || null), sealText(parsed.contactPhone || null), a.userId],
      )).rows[0];
      await audit(c, a, "lost_report", row.id, "lostfound.report", {});
      return row;
    });
    reply.code(201);
    return { id: saved.id };
  });

  f.post("/v1/lost-found/reports/:id/decision", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const itemId = String(req.body?.item_id ?? "");
    const action = String(req.body?.action ?? "");
    if (!UUID.test(itemId)) return reply.code(422).send(problem(422, "validation", "Choose an item from the list"));
    if (action !== "confirm" && action !== "reject") return reply.code(422).send(problem(422, "validation", "Confirm or reject the match"));
    // Confirming a match does not tell the guest.
    const saved = await tx(async c => {
      const report = (await c.query(`select * from lost_report where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!report) { reply.code(404); return problem(404, "not_found", "That report is not in the log"); }
      if (report.status === "closed") { reply.code(422); return problem(422, "validation", "This report is closed"); }
      const item = (await c.query(`select * from lost_item where id=$1 and property_id=$2 for update`, [itemId, a.propertyId])).rows[0];
      if (!item) { reply.code(404); return problem(404, "not_found", "That item is not in the log"); }
      if (action === "reject") {
        await c.query(
          `update lost_report set rejected_ids = (
             select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(rejected_ids, '{}') || array[$2::uuid]) x
           ) where id=$1`,
          [report.id, item.id],
        );
        await c.query(
          `insert into lost_event (item_id, report_id, tenant_id, property_id, note, by_user_id, by_name)
           values ($1,$2,$3,$4,'Not a match',$5,$6)`,
          [item.id, report.id, a.tenantId, a.propertyId, a.userId, a.name],
        );
        await audit(c, a, "lost_report", report.id, "lostfound.reject", { payload: { item_id: item.id } });
        return { ok: true, action: "reject" };
      }
      if (!["logged", "matched"].includes(item.status)) { reply.code(422); return problem(422, "validation", "That item can no longer be matched"); }
      const other = (await c.query(
        `select id from lost_report where matched_item_id=$1 and property_id=$2 and id<>$3 and status='matched' limit 1`,
        [item.id, a.propertyId, report.id],
      )).rows[0];
      if (other) { reply.code(409); return problem(409, "conflict", "That item is already matched to another report"); }
      await c.query(`update lost_item set status='matched', handled_by_user_id=$2, handled_by_name=$3 where id=$1`, [item.id, a.userId, a.name]);
      await c.query(`update lost_report set status='matched', matched_item_id=$2 where id=$1`, [report.id, item.id]);
      await c.query(
        `insert into lost_event (item_id, report_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,'matched','Matched to the missing report',$6,$7)`,
        [item.id, report.id, a.tenantId, a.propertyId, item.status, a.userId, a.name],
      );
      await audit(c, a, "lost_item", item.id, "lostfound.match", { payload: { report_id: report.id } });
      return { ok: true, action: "confirm" };
    });
    return saved;
  });

  f.post("/v1/lost-found/:id/status", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const saved = await tx(async c => {
      const row = (await c.query(`select * from lost_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not in the log"); }
      const parsed = parseStatusChange(req.body, row.status);
      if (!parsed.ok) { reply.code(422); return problem(422, "validation", parsed.error); }
      const closed = closedStatus(parsed.status);
      await c.query(
        `update lost_item set status=$2, claimant_name=$3, claimed_at=case when $2 in ('claimed','returned') then coalesce(claimed_at, now()) else claimed_at end,
           return_method=$4, handled_by_user_id=$5, handled_by_name=$6, closed_at=case when $7 then now() else closed_at end,
           photo=case when $2 in ('disposed','donated') then null else photo end,
           disposal_reason=case when $2 in ('disposed','donated') then $8 else disposal_reason end,
           donate_to=case when $2 = 'donated' then $9 else donate_to end
         where id=$1`,
        [row.id, parsed.status, parsed.claimant ? sealText(parsed.claimant) : row.claimant_name, parsed.method, a.userId, a.name, closed, parsed.note || null, parsed.recipient || null],
      );
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, a.tenantId, a.propertyId, row.status, parsed.status, parsed.note || null, a.userId, a.name],
      );
      if (closed) await closeReport(c, row.id, a.propertyId);
      if (parsed.status === "logged") {
        await c.query(
          `update lost_report set status='open', matched_item_id=null where matched_item_id=$1 and property_id=$2 and status='matched'`,
          [row.id, a.propertyId],
        );
      }
      const reportId = String(req.body?.report_id ?? "");
      if (parsed.status === "matched" && UUID.test(reportId)) {
        await c.query(
          `update lost_report set status='matched', matched_item_id=$2 where id=$1 and property_id=$3`,
          [reportId, row.id, a.propertyId],
        );
      }
      await audit(c, a, "lost_item", row.id, "lostfound.status", { from: row.status, to: parsed.status });
      return { ok: true, status: parsed.status };
    });
    return saved;
  });

  f.get("/v1/lost-found/:id/slip", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const row = await loadSlipRow(a.propertyId, req.params.id);
    if (!row) return reply.code(404).send(problem(404, "not_found", "That item is not in the log"));
    const settings = await loadSettings(a.propertyId);
    const slip = { ...presentSlip(row, a.name), postage_note: settings.postage_note };
    if (String(req.query?.format ?? "") === "pdf") {
      const size = req.query?.size === "a5" ? "a5" : "a4";
      const bytes = renderSlipPdf(slipLines(slip), size, jpegBytes(slip.photo));
      return reply.type("application/pdf").header("content-disposition", `inline; filename="${slip.reference}-${size}.pdf"`).send(Buffer.from(bytes));
    }
    return slip;
  });

  f.post("/v1/lost-found/:id/collect", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    let signature: string | null = null;
    if (req.body?.signature) {
      const drawn = parseSignature(req.body);
      if (!drawn.ok) return reply.code(422).send(problem(422, "validation", drawn.error));
      signature = drawn.data;
    }
    const saved = await tx(async c => {
      const row = (await c.query(`select * from lost_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not in the log"); }
      if (!["matched", "claimed"].includes(row.status)) { reply.code(422); return problem(422, "validation", "Match it before collection"); }
      const report = (await c.query(
        `select contact_name from lost_report where matched_item_id=$1 and property_id=$2 order by created_at desc limit 1`,
        [row.id, a.propertyId],
      )).rows[0];
      const claimant = String(req.body?.claimant_name ?? "").trim().slice(0, 80) || openText(row.claimant_name) || openText(report?.contact_name) || "";
      if (claimant.length < 2) { reply.code(422); return problem(422, "validation", "Say who is collecting it"); }
      await c.query(
        `update lost_item set status='returned', claimant_name=$2, claimed_at=coalesce(claimed_at, now()), return_method='collected',
           handled_by_user_id=$3, handled_by_name=$4, closed_at=now(), signature=coalesce($5, signature)
         where id=$1`,
        [row.id, sealText(claimant), a.userId, a.name, signature],
      );
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, from_status, to_status, note, by_user_id, by_name)
         values ($1,$2,$3,$4,'returned',$5,$6,$7)`,
        [row.id, a.tenantId, a.propertyId, row.status, signature ? "Collected, signed on screen" : "Collected", a.userId, a.name],
      );
      await closeReport(c, row.id, a.propertyId);
      await audit(c, a, "lost_item", row.id, "lostfound.collect", { payload: { signed: !!signature } });
      return { ok: true, status: "returned" };
    });
    return saved;
  });

  f.get("/v1/lost-found/:id/notify", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const row = await loadSlipRow(a.propertyId, req.params.id);
    if (!row) return reply.code(404).send(problem(404, "not_found", "That item is not in the log"));
    const prop = await propertyName(a.propertyId);
    const report = row.report_id
      ? (await pool.query(`select contact_email, contact_phone, status from lost_report where id=$1 and property_id=$2`, [row.report_id, a.propertyId])).rows[0]
      : null;
    const email = openText(report?.contact_email);
    const phone = phoneOk(openText(report?.contact_phone));
    const ready = smsConfigured(smsEnv());
    const message = lostGuestMessage({
      house: prop?.name || "The house",
      item: row.description,
      link: "(the guest's private link is added when you send this)",
    });
    const canSend = !!row.report_id && ["matched", "claimed"].includes(row.status) && !!(email || (phone && ready));
    let warning = "";
    if (!row.report_id || !["matched", "claimed"].includes(row.status)) warning = "Confirm the match before telling the guest";
    else if (!email && !phone) warning = "There is no email or phone on this report";
    else if (!email && !ready) warning = "Text messages are not set up, and there is no email on this report";
    return { ...message, to_email: email, to_phone: phone, sms_ready: ready, can_send: canSend, warning };
  });

  f.post("/v1/lost-found/:id/notify", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    if (req.body?.send !== true) return reply.code(422).send(problem(422, "validation", "Preview the message, then send it. Nothing was sent."));
    const row = await loadSlipRow(a.propertyId, req.params.id);
    if (!row) return reply.code(404).send(problem(404, "not_found", "That item is not in the log"));
    if (!row.report_id || !["matched", "claimed"].includes(row.status)) {
      return reply.code(422).send(problem(422, "validation", "Confirm the match before telling the guest"));
    }
    const report = (await pool.query(`select * from lost_report where id=$1 and property_id=$2`, [row.report_id, a.propertyId])).rows[0];
    const email = openText(report?.contact_email);
    const phone = phoneOk(openText(report?.contact_phone));
    const ready = smsConfigured(smsEnv());
    if (!email && !phone) return reply.code(422).send(problem(422, "validation", "There is no email or phone on this report"));
    if (!email && !ready) return reply.code(422).send(problem(422, "validation", "Text messages are not set up, and there is no email on this report"));
    const settings = await loadSettings(a.propertyId);
    const prop = await propertyName(a.propertyId);
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + settings.link_days * 86_400_000).toISOString();
    await tx(async c => {
      await c.query(`update lost_link set expires_at=now() where report_id=$1 and expires_at > now()`, [report.id]);
      await c.query(
        `insert into lost_link (tenant_id, property_id, report_id, item_id, token_hash, expires_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [a.tenantId, a.propertyId, report.id, row.id, tokenHash(token), expires],
      );
    });
    const link = `${publicWeb()}/lost-return/?t=${encodeURIComponent(token)}`;
    const message = lostGuestMessage({ house: prop?.name || "The house", item: row.description, link });
    let emailStatus = "skipped";
    if (email) {
      const result = await sendEmail(
        { tenantId: a.tenantId, propertyId: a.propertyId, userId: a.userId },
        { to: email, subject: message.subject, body: message.body, kind: "lost_found_guest", related_type: "lost_item", related_id: row.id },
      );
      emailStatus = result.status;
    }
    let smsStatus = phone ? await deliverSms(smsEnv(), { to: phone, body: message.sms }) : "disabled";
    const told = emailStatus === "LOGGED" || emailStatus === "SENT" || smsStatus === "sent";
    if (!told) return reply.code(502).send(problem(502, "delivery_failed", "The message could not be sent"));
    await pool.query(`update lost_item set notified_at=coalesce(notified_at, now()) where id=$1`, [row.id]);
    await pool.query(`update lost_report set notified_at=coalesce(notified_at, now()) where id=$1`, [report.id]);
    await pool.query(
      `insert into lost_event (item_id, report_id, tenant_id, property_id, note, by_user_id, by_name)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, report.id, a.tenantId, a.propertyId, `Guest notified by email (${emailStatus})${phone ? `, text ${smsStatus}` : ""}`, a.userId, a.name],
    );
    await tx(async c => { await audit(c, a, "lost_item", row.id, "lostfound.notify", { payload: { email_status: emailStatus, sms_status: smsStatus } }); });
    return { ok: true, email_status: emailStatus, sms_status: smsStatus };
  });

  f.post("/v1/lost-found/:id/keep", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "lostfound.log", reply)) return;
    const today = await londonToday();
    const parsed = parseKeep(req.body, today);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const row = (await c.query(`select id, status from lost_item where id=$1 and property_id=$2 for update`, [req.params.id, a.propertyId])).rows[0];
      if (!row) { reply.code(404); return problem(404, "not_found", "That item is not in the log"); }
      if (closedStatus(row.status)) { reply.code(422); return problem(422, "validation", "This item is already closed"); }
      await c.query(
        `update lost_item set disposal_hold_until=$2, disposal_reason=$3, disposal_alerted_at=null where id=$1`,
        [row.id, parsed.until, parsed.reason],
      );
      await c.query(
        `insert into lost_event (item_id, tenant_id, property_id, note, by_user_id, by_name)
         values ($1,$2,$3,$4,$5,$6)`,
        [row.id, a.tenantId, a.propertyId, `Keep until ${parsed.until}: ${parsed.reason}`, a.userId, a.name],
      );
      await audit(c, a, "lost_item", row.id, "lostfound.keep", { payload: { until: parsed.until } });
      return { ok: true, until: parsed.until };
    });
    return saved;
  });

  f.get("/public/lost-property/:token", async (req: any, reply) => {
    if (!rateOk(`lost:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Please wait a minute"));
    const row = await loadPublic(String(req.params.token ?? ""));
    if (!row) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    if (new Date(row.expires_at).getTime() <= Date.now()) return reply.code(410).send(problem(410, "expired", "This link has expired"));
    const settings = parseLostSettings(row.settings?.lost_found);
    const body = {
      state: row.guest_choice ? "chosen" : "open",
      property_name: row.property_name,
      reference: row.reference || lostReference(row.item_id),
      description: String(row.description ?? "").slice(0, 160),
      postage_note: settings.postage_note,
      choice: row.guest_choice,
      detail: row.guest_choice ? row.guest_choice_detail : null,
    };
    if (!row.guest_choice && closedStatus(row.item_status)) return reply.code(410).send(problem(410, "expired", "This item has already been closed"));
    return body;
  });

  f.post("/public/lost-property/:token", async (req: any, reply) => {
    if (!rateOk(`lostpost:${req.ip || "x"}`)) return reply.code(429).send(problem(429, "rate_limited", "Please wait a minute"));
    const row = await loadPublic(String(req.params.token ?? ""));
    if (!row) return reply.code(404).send(problem(404, "not_found", "This link is not valid"));
    if (new Date(row.expires_at).getTime() <= Date.now()) return reply.code(410).send(problem(410, "expired", "This link has expired"));
    if (row.guest_choice) return reply.code(409).send(problem(409, "conflict", "A choice has already been saved"));
    if (closedStatus(row.item_status)) return reply.code(410).send(problem(410, "expired", "This item has already been closed"));
    const parsed = parseReturnChoice(req.body);
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    const saved = await tx(async c => {
      const current = (await c.query(`select guest_choice from lost_report where id=$1 for update`, [row.report_id])).rows[0];
      if (!current) { reply.code(404); return problem(404, "not_found", "This link is not valid"); }
      if (current.guest_choice) { reply.code(409); return problem(409, "conflict", "A choice has already been saved"); }
      await c.query(
        `update lost_report set guest_choice=$2, guest_choice_detail=$3, choice_at=now() where id=$1`,
        [row.report_id, parsed.choice, parsed.detail],
      );
      await c.query(
        `insert into lost_event (item_id, report_id, tenant_id, property_id, note, by_name)
         values ($1,$2,$3,$4,$5,'Guest')`,
        [row.item_id, row.report_id, row.tenant_id, row.property_id, parsed.choice === "postage" ? "Guest chose postage" : parsed.detail],
      );
      return { ok: true };
    });
    if (!saved || !("ok" in saved) || !saved.ok) return saved;
    const settings = parseLostSettings(row.settings?.lost_found);
    if (settings.manager) {
      const note = staffChoiceNote({ reference: row.reference || lostReference(row.item_id), choice: parsed.choice, detail: parsed.detail });
      await sendEmail(
        { tenantId: row.tenant_id, propertyId: row.property_id, userId: null },
        { to: settings.manager, subject: note.subject, body: note.body, kind: "lost_found_choice", related_type: "lost_report", related_id: row.report_id },
      );
    }
    return { ok: true, choice: parsed.choice };
  });
}
