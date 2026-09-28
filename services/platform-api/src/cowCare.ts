/** Goshala daily log. The switch stays off. The bull is never guest facing. The cows are never milked. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import {
  historyCsv,
  historyLines,
  isGuestFacing,
  parseCowCareSettings,
  parseDay,
  parseVet,
  renameCow,
  seedCows,
  todayBoard,
  type CowProfile,
  type DayLog,
  type HistoryLine,
  type VetVisit,
} from "../../../domains/ops/cowCare.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseCowCareSettings(row?.settings?.cow_care);
}

async function ensureAnimals(tenantId: string, propertyId: string): Promise<CowProfile[]> {
  const count = await pool.query(`select count(*)::int n from seva_animal where property_id=$1`, [propertyId]).catch(() => null);
  if (!count) return seedCows();
  if (!count.rows[0]?.n) {
    for (const animal of seedCows()) {
      try {
        await pool.query(
          `insert into seva_animal (tenant_id, property_id, code, name, audience, note, guest_facing, kind)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (property_id, code) do nothing`,
          [tenantId, propertyId, animal.id, animal.name, isGuestFacing(animal) ? "guest" : "staff", animal.note, animal.guestFacing, animal.kind],
        );
      } catch {
        await pool.query(
          `insert into seva_animal (tenant_id, property_id, code, name, audience, note)
           values ($1,$2,$3,$4,$5,$6) on conflict (property_id, code) do nothing`,
          [tenantId, propertyId, animal.id, animal.name, isGuestFacing(animal) ? "guest" : "staff", animal.note],
        );
      }
    }
  }
  return loadAnimals(propertyId);
}

async function loadAnimals(propertyId: string): Promise<CowProfile[]> {
  try {
    const rows = (await pool.query(
      `select code, name, audience, note, guest_facing, kind from seva_animal where property_id=$1 order by name`,
      [propertyId],
    )).rows as { code: string; name: string; audience: string; note: string; guest_facing: boolean; kind: string | null }[];
    return rows.map(row => ({
      id: row.code,
      name: row.name,
      kind: row.kind === "bull" || row.audience === "staff" ? "bull" : "cow",
      guestFacing: row.kind === "bull" || row.audience === "staff" ? false : row.guest_facing === true,
      note: row.note,
    }));
  } catch {
    const rows = (await pool.query(
      `select code, name, audience, note from seva_animal where property_id=$1 order by name`,
      [propertyId],
    )).rows as { code: string; name: string; audience: string; note: string }[];
    if (!rows.length) return seedCows();
    return rows.map(row => ({
      id: row.code,
      name: row.name,
      kind: row.audience === "staff" ? "bull" : "cow",
      guestFacing: row.audience === "guest",
      note: row.note,
    }));
  }
}

async function loadDays(propertyId: string): Promise<DayLog[] | null> {
  try {
    const rows = (await pool.query(
      `select animal_code, on_date::text date, duty_name, feed_what, feed_when, feed_amount, health_note
       from goshala_day where property_id=$1`,
      [propertyId],
    )).rows as { animal_code: string; date: string; duty_name: string; feed_what: string; feed_when: string; feed_amount: string; health_note: string }[];
    return rows.map(row => ({
      animalId: row.animal_code,
      date: row.date,
      duty: row.duty_name,
      feedWhat: row.feed_what,
      feedWhen: row.feed_when,
      feedAmount: row.feed_amount,
      health: row.health_note,
    }));
  } catch (err) {
    console.error("[cow-care] day table missing", err instanceof Error ? err.message : err);
    return null;
  }
}

async function loadVisits(propertyId: string): Promise<VetVisit[] | null> {
  try {
    const rows = (await pool.query(
      `select animal_code, visit_date::text date, vet_name, reason, outcome, follow_up::text follow_up
       from goshala_vet where property_id=$1`,
      [propertyId],
    )).rows as { animal_code: string; date: string; vet_name: string; reason: string; outcome: string; follow_up: string | null }[];
    return rows.map(row => ({
      animalId: row.animal_code,
      date: row.date,
      vet: row.vet_name,
      reason: row.reason,
      outcome: row.outcome,
      followUp: row.follow_up,
    }));
  } catch (err) {
    console.error("[cow-care] vet table missing", err instanceof Error ? err.message : err);
    return null;
  }
}

function londonDate(): Promise<string> {
  return pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') date`).then(result => result.rows[0].date as string);
}

function shape(animals: CowProfile[], days: DayLog[], visits: VetVisit[], date: string) {
  return {
    enabled: true,
    ready: true,
    date,
    animals: animals.map(animal => ({
      id: animal.id,
      name: animal.name,
      kind: animal.kind,
      guest_facing: isGuestFacing(animal),
      note: animal.note,
    })),
    today: todayBoard({ animals, days, visits, date }).map(card => ({
      animal_id: card.animalId,
      name: card.name,
      guest_facing: card.guestFacing,
      done: card.done,
      missing: card.missing,
      follow_up: card.followUp,
    })),
    history: historyLines(animals, days, visits).slice(0, 60),
    note: "The cows are cared for and are never milked.",
  };
}

export async function staffOnlyAnimalNames(propertyId: string): Promise<string[]> {
  const animals = await loadAnimals(propertyId);
  return animals.filter(animal => !isGuestFacing(animal)).map(animal => animal.name);
}

export default async function cowCareRoutes(f: FastifyInstance) {
  f.get("/v1/settings/cow-care", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("goshala.care")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open cow care settings"));
    }
    return await loadSettings(a.propertyId);
  });

  f.put("/v1/settings/cow-care", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseCowCareSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{cow_care}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify({ enabled: settings.enabled })],
    );
    return { enabled: settings.enabled };
  });

  f.get("/v1/cow-care", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "goshala.care", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return { enabled: false, animals: [], today: [], history: [], note: "The cows are cared for and are never milked." };
    const animals = await ensureAnimals(a.tenantId, a.propertyId);
    const days = await loadDays(a.propertyId);
    const visits = await loadVisits(a.propertyId);
    if (!days || !visits) return { enabled: true, ready: false, animals: [], today: [], history: [], note: "The cows are cared for and are never milked." };
    return shape(animals, days, visits, await londonDate());
  });

  f.patch<{ Params: { code: string } }>("/v1/cow-care/animals/:code", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "goshala.care", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "Cow care is off"));
    const animals = await ensureAnimals(a.tenantId, a.propertyId);
    const current = animals.find(animal => animal.id === req.params.code);
    if (!current) return reply.code(404).send(problem(404, "not_found", "That animal is not on the list"));
    const renamed = renameCow(current, req.body ?? {});
    if (!renamed.ok) return reply.code(422).send(problem(422, "validation", renamed.error));
    try {
      await tx(async c => {
        await c.query(
          `update seva_animal set name=$3, note=$4, audience=$5, guest_facing=$6, kind=$7 where property_id=$1 and code=$2`,
          [a.propertyId, current.id, renamed.animal.name, renamed.animal.note, isGuestFacing(renamed.animal) ? "guest" : "staff", isGuestFacing(renamed.animal), renamed.animal.kind],
        );
        await audit(c, a, "seva_animal", current.id, "cow_care.rename", { payload: { name: renamed.animal.name, guest_facing: isGuestFacing(renamed.animal) } });
      });
      return { id: current.id, name: renamed.animal.name, guest_facing: isGuestFacing(renamed.animal) };
    } catch (err) {
      console.error("[cow-care] rename failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "Cow care is not ready yet"));
    }
  });

  f.put("/v1/cow-care/days", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "goshala.care", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "Cow care is off"));
    const animals = await ensureAnimals(a.tenantId, a.propertyId);
    const parsed = parseDay(req.body ?? {});
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    if (!animals.some(animal => animal.id === parsed.log.animalId)) {
      return reply.code(404).send(problem(404, "not_found", "That animal is not on the list"));
    }
    try {
      const id = await tx(async c => {
        const saved = await c.query(
          `insert into goshala_day (tenant_id, property_id, animal_code, on_date, duty_name, feed_what, feed_when, feed_amount, health_note, by_user_id, by_name)
           values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)
           on conflict (property_id, animal_code, on_date) do update set
             duty_name = case when excluded.duty_name <> '' then excluded.duty_name else goshala_day.duty_name end,
             feed_what = case when excluded.feed_what <> '' then excluded.feed_what else goshala_day.feed_what end,
             feed_when = case when excluded.feed_when <> '' then excluded.feed_when else goshala_day.feed_when end,
             feed_amount = case when excluded.feed_amount <> '' then excluded.feed_amount else goshala_day.feed_amount end,
             health_note = case when excluded.health_note <> '' then excluded.health_note else goshala_day.health_note end,
             by_user_id = excluded.by_user_id,
             by_name = excluded.by_name,
             updated_at = now()
           returning id`,
          [a.tenantId, a.propertyId, parsed.log.animalId, parsed.log.date, parsed.log.duty, parsed.log.feedWhat, parsed.log.feedWhen, parsed.log.feedAmount, parsed.log.health, a.userId, a.name],
        );
        await audit(c, a, "goshala_day", saved.rows[0].id, "cow_care.day", { payload: parsed.log });
        return saved.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    } catch (err) {
      console.error("[cow-care] day failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "Cow care is not ready yet"));
    }
  });

  f.post("/v1/cow-care/visits", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "goshala.care", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "Cow care is off"));
    const animals = await ensureAnimals(a.tenantId, a.propertyId);
    const parsed = parseVet(req.body ?? {});
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    if (!animals.some(animal => animal.id === parsed.visit.animalId)) {
      return reply.code(404).send(problem(404, "not_found", "That animal is not on the list"));
    }
    try {
      const id = await tx(async c => {
        const saved = await c.query(
          `insert into goshala_vet (tenant_id, property_id, animal_code, visit_date, vet_name, reason, outcome, follow_up, by_user_id, by_name)
           values ($1,$2,$3,$4::date,$5,$6,$7,$8::date,$9,$10) returning id`,
          [a.tenantId, a.propertyId, parsed.visit.animalId, parsed.visit.date, parsed.visit.vet, parsed.visit.reason, parsed.visit.outcome, parsed.visit.followUp, a.userId, a.name],
        );
        await audit(c, a, "goshala_vet", saved.rows[0].id, "cow_care.vet", { payload: parsed.visit });
        return saved.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    } catch (err) {
      console.error("[cow-care] visit failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "Cow care is not ready yet"));
    }
  });

  f.get("/v1/cow-care/export.csv", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "goshala.care", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "Cow care is off"));
    const animals = await ensureAnimals(a.tenantId, a.propertyId);
    const days = await loadDays(a.propertyId);
    const visits = await loadVisits(a.propertyId);
    const lines: HistoryLine[] = days && visits ? historyLines(animals, days, visits) : [];
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=cow-care.csv");
    return historyCsv(lines);
  });
}
