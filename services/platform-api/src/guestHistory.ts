/** Guest history on the existing person and Guest 360 record. One profile, every stay. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem, type Actor } from "./auth.ts";
import { openList, openText, sealList, sealText } from "./fieldCrypto.ts";
import {
  allergenCard,
  allergenDue,
  canEditNote,
  erasureMarker,
  formatAllergens,
  matchGuest,
  parseRetentionSettings,
  profileDue,
  profileView,
  projectProfile,
  projectSearch,
  retentionMarker,
  textDue,
  textPdf,
  viewFor,
  type AllergenItem,
  type KnownGuest,
  type MatchHit,
  type ProfileBundle,
  type ProfileView,
  type RetentionSettings,
} from "../../../domains/guest/history.ts";

type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
async function actor(req: any, reply: any): Promise<Actor | null> {
  const a = await requireActor(req, reply, ["ADMIN", "STAFF"]);
  return a ?? null;
}

async function londonToday(): Promise<string> {
  return (await pool.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d as string;
}

async function loadSettings(propertyId: string): Promise<RetentionSettings> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseRetentionSettings(row?.settings?.guest_retention);
}

function consentOn(row: { allergen_keep?: boolean; allergen_consent_withdrawn_at?: string | null; profile_marker?: string | null } | undefined): boolean {
  return !!row?.allergen_keep && !row?.allergen_consent_withdrawn_at && !row?.profile_marker;
}

async function knownGuests(db: Db, tenantId: string): Promise<KnownGuest[]> {
  const rows = (await db.query(
    `select id, given_name, family_name, email, phone, date_of_birth::text, postcode, merged_into_id
     from person where tenant_id=$1 and erased_at is null`,
    [tenantId],
  )).rows;
  return rows.map(row => ({
    id: row.id,
    givenName: row.given_name,
    familyName: row.family_name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    postcode: row.postcode,
    mergedInto: row.merged_into_id,
  }));
}

async function event(db: Db, args: { tenantId: string; propertyId: string; personId?: string | null; action: string; detail?: string | null; actorUserId?: string | null }) {
  await db.query(
    `insert into guest_profile_event (tenant_id, property_id, person_id, action, detail, actor_user_id) values ($1,$2,$3,$4,$5,$6)`,
    [args.tenantId, args.propertyId, args.personId ?? null, args.action, args.detail ?? null, args.actorUserId ?? null],
  );
}

async function ensureProfile(db: Db, tenantId: string, personId: string) {
  await db.query(
    `insert into guest_profile (person_id, tenant_id) values ($1,$2) on conflict (person_id) do nothing`,
    [personId, tenantId],
  );
}

export async function applyGuestConsent(db: Db, tenantId: string, personId: string, keep: boolean) {
  if (!keep) return;
  await ensureProfile(db, tenantId, personId);
  await db.query(
    `update guest_profile set allergen_keep=true, allergen_consent_at=coalesce(allergen_consent_at, now()), allergen_consent_withdrawn_at=null where person_id=$1`,
    [personId],
  );
}

async function queueMatches(db: Db, args: {
  tenantId: string; propertyId: string; subjectId?: string | null; groupId?: string | null; enquiryId?: string | null;
}, hits: MatchHit[]) {
  let n = 0;
  for (const hit of hits) {
    if (hit.autoLink || hit.id === args.subjectId) continue;
    const inserted = (await db.query(
      `insert into guest_match (tenant_id, property_id, subject_person_id, candidate_person_id, strength, group_id, enquiry_id)
       select $1,$2,$3,$4,$5,$6,$7
       where not exists (
         select 1 from guest_match
         where property_id=$2 and status='pending' and candidate_person_id=$4
           and subject_person_id is not distinct from $3::uuid
           and group_id is not distinct from $6::uuid
           and enquiry_id is not distinct from $7::uuid
       )
       returning id`,
      [args.tenantId, args.propertyId, args.subjectId ?? null, hit.id, hit.strength, args.groupId ?? null, args.enquiryId ?? null],
    )).rows[0];
    if (inserted) n += 1;
  }
  return n;
}

function splitName(name: string): { givenName: string; familyName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { givenName: parts[0] ?? "", familyName: parts.slice(1).join(" ") || parts[0] || "" };
}

export async function suggestContact(db: Db, args: {
  tenantId: string; propertyId: string; email?: string | null; phone?: string | null; name?: string | null;
  dateOfBirth?: string | null; postcode?: string | null; groupId?: string | null; enquiryId?: string | null; actorUserId?: string | null;
}): Promise<{ autoPersonId: string | null; prompts: number }> {
  const { givenName, familyName } = splitName(args.name ?? "");
  const hits = matchGuest({
    email: args.email, phone: args.phone, givenName, familyName, dateOfBirth: args.dateOfBirth, postcode: args.postcode,
  }, await knownGuests(db, args.tenantId));
  const auto = hits.find(hit => hit.autoLink);
  if (auto) {
    await event(db, { tenantId: args.tenantId, propertyId: args.propertyId, personId: auto.id, action: "link", detail: "auto email", actorUserId: args.actorUserId });
    return { autoPersonId: auto.id, prompts: 0 };
  }
  const prompts = await queueMatches(db, {
    tenantId: args.tenantId, propertyId: args.propertyId, groupId: args.groupId, enquiryId: args.enquiryId,
  }, hits);
  return { autoPersonId: null, prompts };
}

export async function recordDietHistory(db: Db, args: {
  tenantId: string; propertyId: string; personId: string; groupId?: string | null;
  arrival?: string | null; departure?: string | null; diet?: string[]; allergens?: AllergenItem[]; notes?: string | null;
}) {
  const codes = (args.allergens ?? []).map(item => item.code).filter(Boolean);
  const severity = (args.allergens ?? []).reduce<string | null>((best, item) => {
    const rank: Record<string, number> = { PREFERENCE: 1, INTOLERANCE: 2, ALLERGY: 3, ANAPHYLAXIS: 4 };
    if (!item.severity) return best;
    if (!best || (rank[item.severity] ?? 0) > (rank[best] ?? 0)) return item.severity;
    return best;
  }, null);
  const detail = sealText(JSON.stringify(args.allergens ?? []));
  if (args.groupId) {
    await db.query(
      `insert into diet_history (tenant_id, property_id, person_id, group_id, arrival, departure, diet, allergens, severity, notes, allergen_detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (person_id, group_id) do update set
         arrival=excluded.arrival, departure=excluded.departure, diet=excluded.diet, allergens=excluded.allergens,
         severity=excluded.severity, notes=excluded.notes, allergen_detail=excluded.allergen_detail, declared_at=now()
       where diet_history.retention_marker is null`,
      [args.tenantId, args.propertyId, args.personId, args.groupId, args.arrival ?? null, args.departure ?? null, sealList(args.diet ?? []), sealList(codes), severity, sealText(args.notes ?? null), detail],
    );
    return;
  }
  await db.query(
    `insert into diet_history (tenant_id, property_id, person_id, arrival, departure, diet, allergens, severity, notes, allergen_detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [args.tenantId, args.propertyId, args.personId, args.arrival ?? null, args.departure ?? null, sealList(args.diet ?? []), sealList(codes), severity, sealText(args.notes ?? null), detail],
  );
}

export async function linkReturningGuest(db: Db, args: {
  tenantId: string; propertyId: string; existingId?: string | null;
  givenName: string; familyName: string; email?: string | null; phone?: string | null;
  dateOfBirth?: string | null; postcode?: string | null;
  groupId?: string | null; enquiryId?: string | null; actorUserId?: string | null;
  arrival?: string | null; departure?: string | null;
  roomPreference?: string | null; accessibility?: string | null; specialRequests?: string | null;
  keepAllergens?: boolean; diet?: string[]; allergens?: AllergenItem[]; dietNotes?: string | null;
}): Promise<string> {
  const known = await knownGuests(db, args.tenantId);
  let personId = args.existingId ?? "";
  if (!personId) {
    const hits = matchGuest({
      email: args.email, phone: args.phone, givenName: args.givenName, familyName: args.familyName,
      dateOfBirth: args.dateOfBirth, postcode: args.postcode,
    }, known);
    const auto = hits.find(hit => hit.autoLink);
    if (auto) {
      personId = auto.id;
      await event(db, { tenantId: args.tenantId, propertyId: args.propertyId, personId, action: "link", detail: "auto email", actorUserId: args.actorUserId });
    } else {
      personId = (await db.query(
        `insert into person (tenant_id, given_name, family_name, email, phone, date_of_birth, postcode) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [args.tenantId, args.givenName, args.familyName, args.email ?? null, args.phone ?? null, args.dateOfBirth || null, args.postcode ?? null],
      )).rows[0].id;
      await queueMatches(db, { tenantId: args.tenantId, propertyId: args.propertyId, subjectId: personId, groupId: args.groupId, enquiryId: args.enquiryId }, hits);
    }
  } else {
    const hits = matchGuest({
      id: personId, email: args.email, phone: args.phone, givenName: args.givenName, familyName: args.familyName,
      dateOfBirth: args.dateOfBirth, postcode: args.postcode,
    }, known).map(hit => ({ ...hit, autoLink: false }));
    await queueMatches(db, { tenantId: args.tenantId, propertyId: args.propertyId, subjectId: personId, groupId: args.groupId, enquiryId: args.enquiryId }, hits);
  }
  await ensureProfile(db, args.tenantId, personId);
  const today = (await db.query(`select (timezone('Europe/London', now()))::date::text d`)).rows[0].d as string;
  const activity = args.departure && args.departure > today ? args.departure : today;
  const current = (await db.query(`select accessibility_notes, room_preference, special_requests from guest_profile where person_id=$1`, [personId])).rows[0];
  const access = openText(current?.accessibility_notes) || args.accessibility || null;
  const room = current?.room_preference || args.roomPreference || null;
  const existingReq = openText(current?.special_requests) || "";
  const extra = args.specialRequests?.trim() || "";
  const requests = extra && existingReq.includes(extra) ? existingReq : [existingReq, extra].filter(Boolean).join("\n");
  await db.query(
    `update guest_profile set
       accessibility_notes=$2, room_preference=$3, special_requests=$4,
       last_activity_on = greatest(coalesce(last_activity_on, $5::date), $5::date),
       allergen_keep = case when $6::boolean then true else allergen_keep end,
       allergen_consent_at = case when $6::boolean and allergen_consent_at is null then now() else allergen_consent_at end,
       allergen_consent_withdrawn_at = case when $6::boolean then null else allergen_consent_withdrawn_at end
     where person_id=$1`,
    [personId, sealText(access), room, sealText(requests || null), activity, !!args.keepAllergens],
  );
  if (args.email) {
    const account = (await db.query(
      `select id from guest_account where tenant_id=$1 and lower(email)=lower($2) order by created_at limit 1`,
      [args.tenantId, args.email],
    )).rows[0];
    if (account) await db.query(`update person set guest_account_id=coalesce(guest_account_id, $2) where id=$1`, [personId, account.id]);
  }
  if ((args.diet?.length || args.allergens?.length || args.dietNotes) && args.groupId) {
    await recordDietHistory(db, {
      tenantId: args.tenantId, propertyId: args.propertyId, personId, groupId: args.groupId,
      arrival: args.arrival, departure: args.departure, diet: args.diet, allergens: args.allergens, notes: args.dietNotes,
    });
  }
  return personId;
}

function openAllergens(detail: string | null, codes: string[] | null, severity: string | null): AllergenItem[] {
  const text = openText(detail);
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(item => item?.code).map(item => ({ code: String(item.code), severity: String(item.severity ?? severity ?? "") }));
    } catch { /* fall through */ }
  }
  return (openList(codes) ?? []).filter(Boolean).map(code => ({ code, severity: severity ?? "" }));
}

async function loadBundle(db: Db, propertyId: string, personId: string, thisGroupId: string | null, today: string): Promise<ProfileBundle | null> {
  const person = (await db.query(
    `select p.id, p.given_name, p.family_name, p.email, p.phone, p.organisation, p.date_of_birth::text, p.postcode,
            p.guest_account_id, p.erased_at, p.merged_into_id,
            gp.accessibility_notes, gp.room_preference, gp.special_requests, gp.allergen_keep, gp.allergen_consent_at,
            gp.allergen_consent_withdrawn_at, gp.profile_marker, gp.allergen_marker, gp.notes profile_notes,
            ga.dietary_notes, ga.accessibility_notes account_access, ga.room_preference account_room,
            coalesce(gp.vip, ga.vip, false) as vip, ga.notes account_notes
     from person p
     left join guest_profile gp on gp.person_id = p.id
     left join guest_account ga on ga.id = p.guest_account_id
     where p.id=$1`,
    [personId],
  )).rows[0];
  if (!person || person.merged_into_id) return null;
  const stays = (await db.query(
    `select g.id, coalesce(nullif(g.public_title, ''), g.name) as name, g.arrival_date::text arrival, g.departure_date::text departure, g.status,
            coalesce(array_agg(distinct r.number) filter (where r.number is not null), '{}') rooms
     from booking_group g
     left join room_occupancy o on o.group_id = g.id and o.person_id = $1
     left join room r on r.id = o.room_id
     where g.property_id=$2 and (
       g.organiser_person_id=$1
       or exists (select 1 from group_attendee ga where ga.group_id=g.id and ga.person_id=$1)
       or o.person_id=$1
       or exists (select 1 from guest_enquiry ge where ge.booking_id=g.id and ge.matched_person_id=$1)
     )
     group by g.id
     order by g.arrival_date desc`,
    [personId, propertyId],
  )).rows;
  const history = (await db.query(
    `select group_id, departure::text, diet, allergens, severity, allergen_detail, retention_marker
     from diet_history where person_id=$1 and property_id=$2 order by declared_at desc`,
    [personId, propertyId],
  )).rows;
  const notes = (await db.query(
    `select id, body, author_user_id, author_name, created_at, retention_marker from guest_staff_note
     where person_id=$1 and property_id=$2 order by created_at desc`,
    [personId, propertyId],
  )).rows;
  const feedback = (await db.query(
    `select f.id, f.food_score, f.room_score, f.overall_score, f.comment, f.problem, f.problem_category, f.problem_detail, f.retention_marker, c.id capa_id
     from guest_feedback f left join capa c on c.feedback_id=f.id
     where f.property_id=$1 and (f.person_id=$2 or ($3::uuid is not null and f.guest_account_id=$3))
     order by f.created_at desc`,
    [propertyId, personId, person.guest_account_id],
  )).rows;
  const complaints = person.guest_account_id ? (await db.query(
    `select id, severity, department, description, retention_marker from guest_complaint
     where property_id=$1 and guest_id=$2 order by created_at desc`,
    [propertyId, person.guest_account_id],
  )).rows : [];
  const previous = stays.filter(stay => stay.id !== thisGroupId && stay.departure < today);
  const consent = consentOn(person);
  const historyItems = history.filter(row => !row.retention_marker && row.group_id !== thisGroupId).flatMap(row => openAllergens(row.allergen_detail, row.allergens, row.severity));
  const thisItems = history.filter(row => !row.retention_marker && thisGroupId && row.group_id === thisGroupId).flatMap(row => openAllergens(row.allergen_detail, row.allergens, row.severity));
  const card = allergenCard({ consent, history: historyItems, thisStay: thisItems });
  const latest = history.find(row => !row.retention_marker);
  const erased = !!person.erased_at || !!person.profile_marker;
  const issue = (text: string | null, marker: string | null) => marker || openText(text) || "";
  return {
    id: person.id,
    name: erased ? "Former guest" : `${person.given_name} ${person.family_name}`.trim(),
    email: erased ? null : person.email,
    phone: erased ? null : person.phone,
    organisation: erased ? null : person.organisation,
    dateOfBirth: erased ? null : person.date_of_birth,
    postcode: erased ? null : person.postcode,
    vip: !!person.vip,
    preferences: [person.room_preference || person.account_room, openText(person.dietary_notes)].filter(Boolean).join(" · ") || null,
    accessibility: openText(person.accessibility_notes) || openText(person.account_access),
    roomPreference: person.room_preference || person.account_room,
    specialRequests: openText(person.special_requests),
    notes: notes.map(note => ({
      id: note.id,
      body: note.retention_marker || openText(note.body) || "",
      authorId: note.author_user_id,
      author: note.author_name,
      at: note.created_at,
    })),
    allergens: consent ? historyItems : [],
    diet: latest && !latest.retention_marker ? (openList(latest.diet) ?? []).filter(Boolean) : [],
    allergenLine: person.allergen_marker || card.line,
    thisStay: card.thisStay,
    previousStays: previous.length,
    lastVisit: previous[0]?.departure ?? null,
    pastIssues: [
      ...complaints.map(row => row.retention_marker || [row.severity, row.department, openText(row.description)].filter(Boolean).join(" · ")),
      ...feedback.filter(row => row.problem).map(row => row.retention_marker || [row.problem_category, openText(row.problem_detail)].filter(Boolean).join(" · ")),
    ].filter(Boolean),
    compliments: feedback.filter(row => !row.problem && row.comment && !row.retention_marker && Number(row.overall_score) >= 4).map(row => openText(row.comment) || "").filter(Boolean),
    feedback: feedback.map(row => ({
      id: row.id,
      scores: `${row.food_score}/${row.room_score}/${row.overall_score}`,
      comment: row.retention_marker || openText(row.comment),
      capaId: row.capa_id,
    })),
    stays: stays.map(stay => ({ id: stay.id, name: stay.name, arrival: stay.arrival, departure: stay.departure, rooms: stay.rooms ?? [], status: stay.status })),
    consent,
    consentAt: person.allergen_consent_at,
    withdrawnAt: person.allergen_consent_withdrawn_at,
    marker: person.profile_marker || person.allergen_marker,
  };
}

function cardFrom(bundle: ProfileBundle, view: ProfileView) {
  const projected = projectProfile(bundle, view);
  return {
    person_id: bundle.id,
    name: bundle.name,
    view,
    returning: bundle.previousStays > 0,
    ...projected,
  };
}

async function promptsFor(db: Db, propertyId: string, groupId: string | null, personId: string | null) {
  return (await db.query(
    `select m.id, m.strength, m.subject_person_id, m.candidate_person_id,
            c.given_name || ' ' || c.family_name as candidate_name, c.email candidate_email
     from guest_match m join person c on c.id=m.candidate_person_id
     where m.property_id=$1 and m.status='pending'
       and ($2::uuid is null or m.group_id=$2 or m.subject_person_id in (select person_id from group_attendee where group_id=$2) or m.enquiry_id in (select id from guest_enquiry where booking_id=$2))
       and ($3::uuid is null or m.subject_person_id=$3 or m.candidate_person_id=$3)
     order by m.created_at`,
    [propertyId, groupId, personId],
  )).rows;
}

async function logAccess(a: Actor, personId: string, view: string) {
  await pool.query(
    `insert into guest_access_log (tenant_id, property_id, person_id, user_id, view) values ($1,$2,$3,$4,$5)`,
    [a.tenantId, a.propertyId, personId, a.userId, view],
  );
}

export async function purgeGuestHistory(propertyId: string): Promise<number> {
  const settings = await loadSettings(propertyId);
  const today = await londonToday();
  const prop = (await pool.query(`select tenant_id from property where id=$1`, [propertyId])).rows[0];
  if (!prop) return 0;
  const marker = retentionMarker(today);
  let n = 0;
  const people = (await pool.query(
    `select p.id, gp.last_activity_on::text, gp.profile_marker, gp.allergen_keep, gp.allergen_consent_withdrawn_at, gp.allergen_marker,
            (select max(g.departure_date)::text from booking_group g
              where g.property_id=$2 and (g.organiser_person_id=p.id or exists (select 1 from group_attendee ga where ga.group_id=g.id and ga.person_id=p.id))) last_departure
     from person p
     left join guest_profile gp on gp.person_id=p.id
     where p.tenant_id=$1 and p.erased_at is null and p.merged_into_id is null`,
    [prop.tenant_id, propertyId],
  )).rows;
  for (const person of people) {
    const due = profileDue(person.last_activity_on, today, settings.profile_inactive_months, !!person.profile_marker);
    if (due) {
      await pool.query(
        `update person set given_name='Former', family_name='guest', email=null, phone=null, date_of_birth=null, postcode=null, notes=null, organisation=null, erased_at=now() where id=$1 and erased_at is null`,
        [person.id],
      );
      await pool.query(
        `update guest_profile set profile_marker=$2, profile_purged_at=coalesce(profile_purged_at, now()), allergen_keep=false, allergen_consent_withdrawn_at=coalesce(allergen_consent_withdrawn_at, now()),
           accessibility_notes=null, special_requests=null, notes=null, allergen_marker=coalesce(allergen_marker, $2) where person_id=$1 and profile_marker is null`,
        [person.id, marker],
      );
      await event(pool, { tenantId: prop.tenant_id, propertyId, personId: person.id, action: "purge", detail: marker });
      n += 1;
    }
  }
  const diets = (await pool.query(
    `select h.id, h.departure::text, h.retention_marker, h.person_id, gp.allergen_keep, gp.allergen_consent_withdrawn_at, gp.profile_marker, gp.last_activity_on::text
     from diet_history h left join guest_profile gp on gp.person_id=h.person_id
     where h.property_id=$1 and h.retention_marker is null`,
    [propertyId],
  )).rows;
  for (const row of diets) {
    const dueProfile = profileDue(row.last_activity_on, today, settings.profile_inactive_months, !!row.profile_marker) || !!row.profile_marker;
    if (!allergenDue({
      departure: row.departure, today, days: settings.allergen_days_after_departure,
      consent: consentOn(row), alreadyMarked: false, profileDue: dueProfile,
    })) continue;
    const updated = (await pool.query(
      `update diet_history set diet='{}', allergens='{}', severity=null, notes=null, allergen_detail=null, retention_marker=$2, purged_at=now()
       where id=$1 and retention_marker is null returning id`,
      [row.id, marker],
    )).rows[0];
    if (updated) n += 1;
  }
  const live = (await pool.query(
    `select d.person_id, gp.allergen_keep, gp.allergen_consent_withdrawn_at, gp.profile_marker, gp.allergen_marker, gp.last_activity_on::text,
            (select max(departure)::text from diet_history h where h.person_id=d.person_id and h.property_id=$1) last_departure
     from diet_profile d join person p on p.id=d.person_id
     left join guest_profile gp on gp.person_id=d.person_id
     where p.tenant_id=$2 and gp.allergen_marker is null`,
    [propertyId, prop.tenant_id],
  )).rows;
  for (const row of live) {
    const dueProfile = !!row.profile_marker || profileDue(row.last_activity_on, today, settings.profile_inactive_months, false);
    if (!allergenDue({
      departure: row.last_departure, today, days: settings.allergen_days_after_departure,
      consent: consentOn(row), alreadyMarked: false, profileDue: dueProfile,
    })) continue;
    await pool.query(`update diet_profile set diet='{}', allergens='{}', severity=null, notes=null, allergen_detail=null where person_id=$1`, [row.person_id]);
    await pool.query(
      `insert into guest_profile (person_id, tenant_id, allergen_marker) values ($1,$2,$3)
       on conflict (person_id) do update set allergen_marker=coalesce(guest_profile.allergen_marker, excluded.allergen_marker)`,
      [row.person_id, prop.tenant_id, marker],
    );
    n += 1;
  }
  const feedback = (await pool.query(
    `select id, created_at::date::text recorded, person_id from guest_feedback where property_id=$1 and retention_marker is null`,
    [propertyId],
  )).rows;
  for (const row of feedback) {
    const profile = people.find(person => person.id === row.person_id);
    const dueProfile = profile ? !!profile.profile_marker || profileDue(profile.last_activity_on, today, settings.profile_inactive_months, !!profile.profile_marker) : false;
    if (!dueProfile && !textDue(row.recorded, today, settings.feedback_text_days, false)) continue;
    const updated = (await pool.query(
      `update guest_feedback set comment=null, problem_detail=null, first_name=null, retention_marker=$2, anonymised_at=coalesce(anonymised_at, now())
       where id=$1 and retention_marker is null returning id, complaint_id`,
      [row.id, marker],
    )).rows[0];
    if (!updated) continue;
    await pool.query(`update capa set root_cause=null, corrective_action=null, preventive_action=null, updated_at=now() where feedback_id=$1`, [row.id]);
    if (updated.complaint_id) {
      await pool.query(`update guest_complaint set description=null, compensation=null, resolution=null, retention_marker=coalesce(retention_marker, $2) where id=$1 and retention_marker is null`, [updated.complaint_id, marker]);
    }
    n += 1;
  }
  const notes = (await pool.query(
    `select n.id, n.created_at::date::text recorded, gp.profile_marker, gp.last_activity_on::text
     from guest_staff_note n left join guest_profile gp on gp.person_id=n.person_id
     where n.property_id=$1 and n.retention_marker is null`,
    [propertyId],
  )).rows;
  for (const row of notes) {
    const dueProfile = !!row.profile_marker || profileDue(row.last_activity_on, today, settings.profile_inactive_months, !!row.profile_marker);
    if (!dueProfile && !textDue(row.recorded, today, settings.staff_note_days, false)) continue;
    const updated = (await pool.query(
      `update guest_staff_note set body=null, retention_marker=$2, purged_at=now() where id=$1 and retention_marker is null returning id`,
      [row.id, marker],
    )).rows[0];
    if (updated) n += 1;
  }
  return n;
}

async function mergePeople(db: Db, a: Actor, survivorId: string, mergedId: string) {
  if (survivorId === mergedId) return;
  const before = (await db.query(`select email, phone, date_of_birth::text, postcode, guest_account_id from person where id=$1`, [survivorId])).rows[0];
  const mergedBefore = (await db.query(
    `select given_name, family_name, email, phone, date_of_birth::text, postcode, guest_account_id from person where id=$1`,
    [mergedId],
  )).rows[0];
  const noteIds = (await db.query(`select id from guest_staff_note where person_id=$1`, [mergedId])).rows.map(row => row.id);
  const dietIds = (await db.query(`select id from diet_history where person_id=$1`, [mergedId])).rows.map(row => row.id);
  const attendeeIds = (await db.query(`select id from group_attendee where person_id=$1`, [mergedId])).rows.map(row => row.id);
  const occupancyIds = (await db.query(`select id from room_occupancy where person_id=$1`, [mergedId])).rows.map(row => row.id);
  const feedbackIds = (await db.query(`select id from guest_feedback where person_id=$1`, [mergedId])).rows.map(row => row.id);
  const enquiryIds = (await db.query(`select id from guest_enquiry where matched_person_id=$1`, [mergedId])).rows.map(row => row.id);
  await db.query(
    `delete from group_attendee ga using group_attendee keep
     where ga.person_id=$1 and keep.person_id=$2 and keep.group_id=ga.group_id`,
    [mergedId, survivorId],
  );
  await db.query(`update group_attendee set person_id=$2 where person_id=$1`, [mergedId, survivorId]);
  await db.query(
    `delete from diet_history h using diet_history keep
     where h.person_id=$1 and keep.person_id=$2 and keep.group_id is not null and keep.group_id=h.group_id`,
    [mergedId, survivorId],
  );
  await db.query(`update diet_history set person_id=$2 where person_id=$1`, [mergedId, survivorId]);
  await db.query(`update guest_staff_note set person_id=$2 where person_id=$1`, [mergedId, survivorId]);
  await db.query(`update room_occupancy set person_id=$2 where person_id=$1`, [mergedId, survivorId]);
  await db.query(`update guest_feedback set person_id=$2 where person_id=$1`, [mergedId, survivorId]);
  await db.query(`update guest_enquiry set matched_person_id=$2 where matched_person_id=$1`, [mergedId, survivorId]);
  await db.query(`update booking_group set organiser_person_id=$2 where organiser_person_id=$1`, [mergedId, survivorId]);
  await db.query(
    `update person s set
       email=coalesce(s.email, m.email), phone=coalesce(s.phone, m.phone),
       date_of_birth=coalesce(s.date_of_birth, m.date_of_birth), postcode=coalesce(s.postcode, m.postcode),
       guest_account_id=coalesce(s.guest_account_id, m.guest_account_id)
     from person m where s.id=$1 and m.id=$2`,
    [survivorId, mergedId],
  );
  await db.query(`update person set merged_into_id=$2, email=null, phone=null where id=$1`, [mergedId, survivorId]);
  const snapshot = { survivorBefore: before, mergedBefore, noteIds, dietIds, attendeeIds, occupancyIds, feedbackIds, enquiryIds };
  await db.query(
    `insert into guest_merge_event (tenant_id, property_id, survivor_id, merged_id, action, snapshot, actor_user_id)
     values ($1,$2,$3,$4,'merge',$5::jsonb,$6)`,
    [a.tenantId, a.propertyId, survivorId, mergedId, JSON.stringify(snapshot), a.userId],
  );
  await event(db, { tenantId: a.tenantId, propertyId: a.propertyId, personId: survivorId, action: "merge", detail: mergedId, actorUserId: a.userId });
}

export default async function guestHistoryRoutes(f: FastifyInstance) {
  f.get("/v1/settings/guest-retention", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    return loadSettings(a.propertyId);
  });

  f.put("/v1/settings/guest-retention", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseRetentionSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{guest_retention}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/guest-history/search", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const view = profileView(a.role, a.perms);
    if (view === "none") return reply.code(403).send(problem(403, "forbidden", "You cannot search guest profiles"));
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return { items: [] };
    const digits = q.replace(/\D/g, "");
    const rows = (await pool.query(
      `select p.id, p.given_name || ' ' || p.family_name as name, p.email, p.phone, gp.room_preference,
              coalesce(gp.vip, ga.vip, false) vip,
              d.diet, d.allergens, d.severity, d.allergen_detail, gp.allergen_marker, gp.allergen_keep, gp.allergen_consent_withdrawn_at, gp.profile_marker
       from person p
       left join guest_profile gp on gp.person_id=p.id
       left join guest_account ga on ga.id=p.guest_account_id
       left join diet_profile d on d.person_id=p.id
       where p.tenant_id=$1 and p.merged_into_id is null
         and (
           (p.given_name || ' ' || p.family_name) ilike '%' || $2 || '%'
           or p.email ilike '%' || $2 || '%'
           or p.phone ilike '%' || $2 || '%'
           or ($3 <> '' and regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g') like '%' || $3 || '%')
         )
       order by p.family_name, p.given_name limit 20`,
      [a.tenantId, q, digits],
    )).rows;
    return {
      items: rows.map(row => {
        const consent = consentOn(row);
        const items = consent && !row.allergen_marker ? openAllergens(row.allergen_detail, row.allergens, row.severity) : [];
        return projectSearch({
          id: row.id,
          name: row.profile_marker ? "Former guest" : row.name,
          email: row.email,
          phone: row.phone,
          diet: consent ? (openList(row.diet) ?? []).filter(Boolean) : [],
          allergenLine: row.allergen_marker || (consent && items.length ? formatAllergens(items) : "allergens: ask again"),
          roomPreference: row.room_preference,
          vip: row.vip,
        }, view);
      }),
    };
  });

  f.get("/v1/guest-history/arrivals", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const surface = req.query.surface === "kitchen" || req.query.surface === "front" ? req.query.surface : "profile";
    const view = viewFor(profileView(a.role, a.perms), surface);
    if (view === "none") return { items: [] };
    const today = String(req.query.date ?? "") || await londonToday();
    const groups = (await pool.query(
      `select g.id, g.name, g.organiser_person_id from booking_group g
       where g.property_id=$1 and g.arrival_date=$2::date and g.status in ('ENQUIRY','PROVISIONAL','CONFIRMED','IN_HOUSE')
       order by g.arrival_slot, g.name`,
      [a.propertyId, today],
    )).rows;
    const items = [];
    for (const group of groups) {
      const people = (await pool.query(
        `select person_id from group_attendee where group_id=$1
         union select organiser_person_id from booking_group where id=$1 and organiser_person_id is not null
         union select matched_person_id from guest_enquiry where booking_id=$1 and matched_person_id is not null`,
        [group.id],
      )).rows;
      const cards = [];
      for (const row of people) {
        const bundle = await loadBundle(pool, a.propertyId, row.person_id, group.id, today);
        if (!bundle) continue;
        await logAccess(a, bundle.id, view);
        cards.push(cardFrom(bundle, view));
      }
      items.push({ group_id: group.id, name: group.name, cards, prompts: view === "kitchen" ? [] : await promptsFor(pool, a.propertyId, group.id, null) });
    }
    return { date: today, items };
  });

  f.get("/v1/guest-history/booking/:groupId", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const view = profileView(a.role, a.perms);
    if (view === "none") return reply.code(403).send(problem(403, "forbidden", "You cannot open this guest"));
    const today = await londonToday();
    const people = (await pool.query(
      `select person_id from group_attendee where group_id=$1
       union select organiser_person_id from booking_group where id=$1 and property_id=$2 and organiser_person_id is not null
       union select matched_person_id from guest_enquiry where booking_id=$1 and matched_person_id is not null`,
      [req.params.groupId, a.propertyId],
    )).rows;
    const cards = [];
    for (const row of people) {
      const bundle = await loadBundle(pool, a.propertyId, row.person_id, req.params.groupId, today);
      if (!bundle) continue;
      await logAccess(a, bundle.id, view);
      cards.push(cardFrom(bundle, view));
    }
    return { cards, prompts: await promptsFor(pool, a.propertyId, req.params.groupId, null) };
  });

  f.get("/v1/guest-history/:personId", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const view = profileView(a.role, a.perms);
    if (view === "none") return reply.code(403).send(problem(403, "forbidden", "You cannot open this guest"));
    const today = await londonToday();
    const bundle = await loadBundle(pool, a.propertyId, req.params.personId, null, today);
    if (!bundle) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    await logAccess(a, bundle.id, view);
    const prompts = view === "kitchen" ? [] : await promptsFor(pool, a.propertyId, null, bundle.id);
    return { ...projectProfile(bundle, view), prompts, card: cardFrom(bundle, view) };
  });

  f.post("/v1/guest-history/:personId/notes", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager records house notes"));
    const body = String(req.body?.body ?? "").trim();
    if (!body) return reply.code(422).send(problem(422, "validation", "Write the note"));
    const person = (await pool.query(`select id from person where id=$1 and tenant_id=$2 and merged_into_id is null`, [req.params.personId, a.tenantId])).rows[0];
    if (!person) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    const note = await tx(async c => {
      await ensureProfile(c, a.tenantId, person.id);
      const row = (await c.query(
        `insert into guest_staff_note (tenant_id, property_id, person_id, body, author_user_id, author_name)
         values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
        [a.tenantId, a.propertyId, person.id, sealText(body), a.userId, a.name],
      )).rows[0];
      await c.query(
        `insert into guest_note_event (note_id, tenant_id, action, actor_user_id, actor_name) values ($1,$2,'create',$3,$4)`,
        [row.id, a.tenantId, a.userId, a.name],
      );
      await c.query(`update guest_profile set last_activity_on=greatest(coalesce(last_activity_on, current_date), (timezone('Europe/London', now()))::date) where person_id=$1`, [person.id]);
      return row;
    });
    reply.code(201);
    return { id: note.id, at: note.created_at };
  });

  f.patch("/v1/guest-history/notes/:noteId", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const body = String(req.body?.body ?? "").trim();
    if (!body) return reply.code(422).send(problem(422, "validation", "Write the note"));
    const note = (await pool.query(
      `select id, body, author_user_id, retention_marker from guest_staff_note where id=$1 and property_id=$2`,
      [req.params.noteId, a.propertyId],
    )).rows[0];
    if (!note) return reply.code(404).send(problem(404, "not_found", "No such note"));
    if (note.retention_marker) return reply.code(409).send(problem(409, "retained", "This note has already been removed"));
    const manager = profileView(a.role, a.perms) === "manager";
    if (!canEditNote(note.author_user_id, a.userId, manager)) return reply.code(403).send(problem(403, "forbidden", "Only the author or a manager can change this note"));
    await tx(async c => {
      await c.query(
        `insert into guest_note_event (note_id, tenant_id, action, previous_body, actor_user_id, actor_name) values ($1,$2,'edit',$3,$4,$5)`,
        [note.id, a.tenantId, note.body, a.userId, a.name],
      );
      await c.query(`update guest_staff_note set body=$2, updated_at=now() where id=$1`, [note.id, sealText(body)]);
    });
    return { ok: true };
  });

  f.post("/v1/guest-history/matches/:id/confirm", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const view = profileView(a.role, a.perms);
    if (view !== "front" && view !== "manager") return reply.code(403).send(problem(403, "forbidden", "Front of house or a manager confirms a match"));
    const match = (await pool.query(`select * from guest_match where id=$1 and property_id=$2 and status='pending'`, [req.params.id, a.propertyId])).rows[0];
    if (!match) return reply.code(404).send(problem(404, "not_found", "No match waiting"));
    await tx(async c => {
      if (match.subject_person_id) await mergePeople(c, a, match.candidate_person_id, match.subject_person_id);
      else await event(c, { tenantId: a.tenantId, propertyId: a.propertyId, personId: match.candidate_person_id, action: "link", detail: match.strength, actorUserId: a.userId });
      if (match.enquiry_id) await c.query(`update guest_enquiry set matched_person_id=$2 where id=$1`, [match.enquiry_id, match.candidate_person_id]);
      if (match.group_id) await c.query(`update booking_group set organiser_person_id=coalesce(organiser_person_id, $2) where id=$1`, [match.group_id, match.candidate_person_id]);
      await c.query(`update guest_match set status='merged', decided_at=now(), decided_by=$2 where id=$1`, [match.id, a.userId]);
    });
    return { ok: true, person_id: match.candidate_person_id };
  });

  f.post("/v1/guest-history/matches/:id/dismiss", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    const view = profileView(a.role, a.perms);
    if (view !== "front" && view !== "manager") return reply.code(403).send(problem(403, "forbidden", "Front of house or a manager dismisses a match"));
    const updated = (await pool.query(
      `update guest_match set status='dismissed', decided_at=now(), decided_by=$3 where id=$1 and property_id=$2 and status='pending' returning id`,
      [req.params.id, a.propertyId, a.userId],
    )).rows[0];
    if (!updated) return reply.code(404).send(problem(404, "not_found", "No match waiting"));
    return { ok: true };
  });

  f.post("/v1/guest-history/:personId/unmerge", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager undoes a merge"));
    const eventRow = (await pool.query(
      `select id, merged_id, snapshot from guest_merge_event
       where survivor_id=$1 and property_id=$2 and action='merge'
         and not exists (
           select 1 from guest_merge_event later
           where later.merged_id=guest_merge_event.merged_id and later.action='unmerge' and later.created_at > guest_merge_event.created_at
         )
       order by created_at desc limit 1`,
      [req.params.personId, a.propertyId],
    )).rows[0];
    if (!eventRow) return reply.code(404).send(problem(404, "not_found", "Nothing to unmerge"));
    const snap = eventRow.snapshot ?? {};
    const before = snap.survivorBefore ?? {};
    const mergedBefore = snap.mergedBefore ?? {};
    await tx(async c => {
      const restore = async (table: string, column: string, ids: string[]) => {
        if (!ids?.length) return;
        await c.query(`update ${table} set ${column}=$2 where id = any($1::uuid[])`, [ids, eventRow.merged_id]);
      };
      await restore("guest_staff_note", "person_id", snap.noteIds ?? []);
      await restore("diet_history", "person_id", snap.dietIds ?? []);
      await restore("group_attendee", "person_id", snap.attendeeIds ?? []);
      await restore("room_occupancy", "person_id", snap.occupancyIds ?? []);
      await restore("guest_feedback", "person_id", snap.feedbackIds ?? []);
      if (snap.enquiryIds?.length) await c.query(`update guest_enquiry set matched_person_id=$2 where id = any($1::uuid[])`, [snap.enquiryIds, eventRow.merged_id]);
      await c.query(
        `update person set merged_into_id=null, given_name=coalesce($2, given_name), family_name=coalesce($3, family_name), email=$4, phone=$5, date_of_birth=$6, postcode=$7, guest_account_id=$8 where id=$1`,
        [eventRow.merged_id, mergedBefore.given_name ?? null, mergedBefore.family_name ?? null, mergedBefore.email ?? null, mergedBefore.phone ?? null, mergedBefore.date_of_birth ?? null, mergedBefore.postcode ?? null, mergedBefore.guest_account_id ?? null],
      );
      await c.query(
        `update person set email=$2, phone=$3, date_of_birth=$4, postcode=$5, guest_account_id=$6 where id=$1`,
        [req.params.personId, before.email ?? null, before.phone ?? null, before.date_of_birth ?? null, before.postcode ?? null, before.guest_account_id ?? null],
      );
      await c.query(
        `insert into guest_merge_event (tenant_id, property_id, survivor_id, merged_id, action, snapshot, actor_user_id)
         values ($1,$2,$3,$4,'unmerge',$5::jsonb,$6)`,
        [a.tenantId, a.propertyId, req.params.personId, eventRow.merged_id, JSON.stringify({ undoes: eventRow.id }), a.userId],
      );
      await event(c, { tenantId: a.tenantId, propertyId: a.propertyId, personId: req.params.personId, action: "unmerge", detail: eventRow.merged_id, actorUserId: a.userId });
    });
    return { ok: true, person_id: eventRow.merged_id };
  });

  f.post("/v1/guest-history/:personId/consent", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager records allergen consent"));
    const keep = !!req.body?.keep;
    const person = (await pool.query(`select id from person where id=$1 and tenant_id=$2 and merged_into_id is null`, [req.params.personId, a.tenantId])).rows[0];
    if (!person) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    await ensureProfile(pool, a.tenantId, person.id);
    if (keep) {
      await pool.query(
        `update guest_profile set allergen_keep=true, allergen_consent_at=now(), allergen_consent_withdrawn_at=null where person_id=$1`,
        [person.id],
      );
    } else {
      await pool.query(
        `update guest_profile set allergen_keep=false, allergen_consent_withdrawn_at=now() where person_id=$1`,
        [person.id],
      );
    }
    await event(pool, { tenantId: a.tenantId, propertyId: a.propertyId, personId: person.id, action: keep ? "consent" : "withdraw", actorUserId: a.userId });
    return { ok: true, keep };
  });

  f.post("/v1/guest-history/:personId/vip", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager sets the VIP flag"));
    const vip = !!req.body?.vip;
    const person = (await pool.query(`select id, guest_account_id from person where id=$1 and tenant_id=$2 and merged_into_id is null`, [req.params.personId, a.tenantId])).rows[0];
    if (!person) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    await ensureProfile(pool, a.tenantId, person.id);
    await pool.query(`update guest_profile set vip=$2 where person_id=$1`, [person.id, vip]);
    if (person.guest_account_id) await pool.query(`update guest_account set vip=$2 where id=$1`, [person.guest_account_id, vip]);
    await event(pool, { tenantId: a.tenantId, propertyId: a.propertyId, personId: person.id, action: vip ? "vip" : "vip_clear", actorUserId: a.userId });
    return { ok: true, vip };
  });

  f.get("/v1/guest-history/:personId/export", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager exports a guest profile"));
    const today = await londonToday();
    const bundle = await loadBundle(pool, a.propertyId, req.params.personId, null, today);
    if (!bundle) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    await logAccess(a, bundle.id, "export");
    const payload = projectProfile(bundle, "manager");
    if (req.query.format === "pdf") {
      const lines = [
        bundle.name,
        bundle.email ?? "",
        bundle.phone ?? "",
        `Stays: ${bundle.stays.length}. Last visit: ${bundle.lastVisit ?? "none"}`,
        `Allergens: ${bundle.allergenLine}`,
        `Consent: ${bundle.consent ? "kept for future stays" : "not given"}`,
        ...bundle.stays.map(stay => `${stay.arrival} to ${stay.departure} ${stay.name} rooms ${stay.rooms.join(", ")}`),
        ...bundle.notes.map(note => `Note ${note.author}: ${note.body}`),
        ...bundle.feedback.map(row => `Feedback ${row.scores} ${row.comment ?? ""}`),
      ];
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", `attachment; filename="guest-${bundle.id}.pdf"`);
      return reply.send(textPdf(`Guest profile ${bundle.name}`, lines));
    }
    return payload;
  });

  f.post("/v1/guest-history/:personId/erase", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (profileView(a.role, a.perms) !== "manager") return reply.code(403).send(problem(403, "forbidden", "A manager erases a guest profile"));
    const today = await londonToday();
    const marker = erasureMarker(today);
    const person = (await pool.query(`select id, guest_account_id from person where id=$1 and tenant_id=$2 and merged_into_id is null`, [req.params.personId, a.tenantId])).rows[0];
    if (!person) return reply.code(404).send(problem(404, "not_found", "No such guest"));
    await tx(async c => {
      await c.query(
        `update person set given_name='Former', family_name='guest', email=null, phone=null, date_of_birth=null, postcode=null, notes=null, organisation=null, erased_at=now() where id=$1`,
        [person.id],
      );
      await ensureProfile(c, a.tenantId, person.id);
      await c.query(
        `update guest_profile set profile_marker=$2, profile_purged_at=now(), allergen_marker=$2, allergen_keep=false, allergen_consent_withdrawn_at=coalesce(allergen_consent_withdrawn_at, now()),
           accessibility_notes=null, special_requests=null, notes=null where person_id=$1`,
        [person.id, marker],
      );
      await c.query(`update diet_profile set diet='{}', allergens='{}', severity=null, notes=null, allergen_detail=null where person_id=$1`, [person.id]);
      await c.query(
        `update diet_history set diet='{}', allergens='{}', severity=null, notes=null, allergen_detail=null, retention_marker=coalesce(retention_marker, $2), purged_at=coalesce(purged_at, now()) where person_id=$1`,
        [person.id, marker],
      );
      await c.query(
        `update guest_staff_note set body=null, retention_marker=coalesce(retention_marker, $2), purged_at=coalesce(purged_at, now()) where person_id=$1`,
        [person.id, marker],
      );
      await c.query(
        `update guest_feedback set comment=null, problem_detail=null, first_name=null, retention_marker=coalesce(retention_marker, $2), anonymised_at=coalesce(anonymised_at, now()) where person_id=$1`,
        [person.id, marker],
      );
      if (person.guest_account_id) {
        await c.query(
          `update guest_account set display_name='Former guest', email=$2, status='SUSPENDED', dietary_notes=null, accessibility_notes=null, travel_notes=null, notes=null, room_preference=null where id=$1`,
          [person.guest_account_id, `erased-${person.guest_account_id}@example.invalid`],
        );
      }
      await event(c, { tenantId: a.tenantId, propertyId: a.propertyId, personId: person.id, action: "erase", detail: marker, actorUserId: a.userId });
    });
    return { ok: true, marker };
  });
}
