/** Live daily briefing. Facts are cached for a few seconds. Pins and the reader are not. */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { loadHouseFacts, firstName, type HouseFacts } from "./houseFacts.ts";
import {
  briefingView,
  buildBriefing,
  parseWatchRules,
  type BriefingFacts,
  type BriefingStay,
  type Mark,
} from "../../../domains/ops/briefing.ts";
import { checkInLabels } from "./journey.ts";

const CACHE_MS = 20_000;
const KEY = /^[\w:.-]{1,120}$/;

type Cached = { at: number; generatedAt: string; facts: BriefingFacts };
const cache = new Map<string, Cached>();

async function londonDate(): Promise<string> {
  const row = (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as date`)).rows[0];
  return String(row.date);
}

function toBriefing(raw: HouseFacts, date: string): BriefingFacts {
  const stays: BriefingStay[] = [];
  for (const row of raw.stays) {
    const party = Math.round(Number(row.party));
    const base = {
      firstName: firstName(row.givenName || row.groupName, "Guest"),
      room: String(row.room ?? "").trim() || "not assigned",
      party: Number.isFinite(party) && party > 0 ? party : 0,
      returning: row.returning,
      severe: row.severe,
      access: row.accessibility.trim().length > 0,
      vip: row.vip,
      flagged: row.flagged,
      allergens: row.allergens.map(code => code.replace(/_/g, " ")).filter(Boolean),
      group: String(row.groupName ?? "").trim() || "House",
      accessNote: row.accessibility.trim(),
    };
    if (row.arrivalDate === date) stays.push({ ...base, id: `${row.id}:arrival`, movement: "arrival" });
    if (row.departureDate === date) stays.push({ ...base, id: `${row.id}:departure`, movement: "departure" });
    if (row.arrivalDate < date && row.departureDate > date) stays.push({ ...base, id: `${row.id}:in`, movement: "in_house" });
  }
  return {
    date,
    stays,
    shifts: raw.shifts.map(shift => ({
      id: shift.id,
      userId: shift.userId,
      department: shift.department,
      firstName: firstName(shift.displayName, "Staff"),
      start: shift.start,
      end: shift.end,
      swapped: shift.swapped,
    })),
    shiftsKnown: raw.shiftsKnown,
    tickets: raw.tickets,
    issues: raw.issues,
    stock: raw.stock,
    compliance: raw.compliance,
    training: raw.training.map(item => ({
      id: item.id,
      firstName: firstName(item.name, "Staff"),
      title: item.title,
      expiresOn: item.expiresOn,
    })),
    deliveries: raw.deliveries,
    notes: raw.notes.map(note => ({
      id: note.id,
      author: firstName(note.author, "Staff"),
      department: note.department,
      shift: note.shift,
      excerpt: note.excerpt.replace(/\s+/g, " ").trim().slice(0, 180),
      ackedBy: note.ackedBy,
    })),
  };
}

export async function factsFor(propertyId: string, date: string): Promise<{ facts: BriefingFacts; cached: boolean; generatedAt: string }> {
  const key = `${propertyId}:${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { facts: hit.facts, cached: true, generatedAt: hit.generatedAt };
  const raw = await loadHouseFacts({
    propertyId,
    stayOn: date,
    roomFrom: date,
    roomTo: date,
    occupancyOn: date,
    paidOn: date,
    ticketOn: date,
    issueOn: date,
    trainingOn: date,
    trainingDays: 7,
    complianceOn: date,
    complianceDays: 0,
    handoverDates: [date],
    handoverMorning: false,
    handoverLimit: 40,
    deliveryOn: date,
    includeInHouse: true,
    shiftsOn: date,
    logAs: "briefing",
  });
  const facts = toBriefing(raw, date);
  try {
    const labels = await checkInLabels(propertyId, [...new Set(facts.stays.map(stay => stay.id.split(":")[0]))]);
    for (const stay of facts.stays) {
      if (stay.movement !== "arrival") continue;
      const label = labels.get(stay.id.split(":")[0]);
      if (label) stay.checkIn = label;
    }
  } catch { /* arrivals board is optional until its table exists */ }
  try {
    const { sevaBriefing } = await import("./seva.ts");
    facts.seva = await sevaBriefing(propertyId, date);
  } catch { facts.seva = []; }
  const generatedAt = new Date().toISOString();
  cache.set(key, { at: Date.now(), generatedAt, facts });
  return { facts, cached: false, generatedAt };
}

async function rulesFor(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0] as { settings: Record<string, unknown> | null } | undefined;
  return parseWatchRules(row?.settings?.briefing);
}

function rulesBody(rules: ReturnType<typeof parseWatchRules>) {
  return {
    severe: rules.severe,
    cold: rules.cold,
    vip: rules.vip,
    compliance: rules.compliance,
    staffing: rules.staffing,
    heads: rules.heads,
  };
}

async function marksFor(propertyId: string, userId: string, date: string): Promise<Mark[]> {
  try {
    const rows = (await pool.query(
      `select item_key, action from briefing_pin where property_id=$1 and user_id=$2 and on_date=$3::date`,
      [propertyId, userId, date],
    )).rows as { item_key: string; action: "pin" | "dismiss" }[];
    return rows.map(row => ({ key: row.item_key, action: row.action }));
  } catch (err) {
    console.error("[briefing] pins unavailable", err instanceof Error ? err.message : err);
    return [];
  }
}

async function homeFor(userId: string): Promise<"house" | "briefing"> {
  try {
    const row = (await pool.query(`select home_screen from user_preference where user_id=$1`, [userId])).rows[0] as { home_screen: string } | undefined;
    return row?.home_screen === "briefing" ? "briefing" : "house";
  } catch {
    return "house";
  }
}

export default async function briefingRoutes(f: FastifyInstance) {
  f.get("/v1/briefing", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "briefing.read", reply)) return;
    const date = await londonDate();
    const [{ facts, cached, generatedAt }, rules, marks, home] = await Promise.all([
      factsFor(a.propertyId, date),
      rulesFor(a.propertyId),
      marksFor(a.propertyId, a.userId, date),
      homeFor(a.userId),
    ]);
    const view = briefingView({ role: a.role, department: a.department, perms: a.perms });
    const board = buildBriefing({ facts, view, rules, marks, userId: a.userId });
    return {
      date: board.date,
      generatedAt,
      cached,
      view: board.view,
      home,
      canManage: a.perms.has("briefing.manage"),
      watch: board.watch,
      held: board.held,
      sections: board.sections,
    };
  });

  f.post("/v1/briefing/pins", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "briefing.manage", reply)) return;
    const body = (req.body ?? {}) as { key?: unknown; action?: unknown };
    const key = String(body.key ?? "").trim();
    const action = String(body.action ?? "");
    if (!KEY.test(key)) return reply.code(422).send(problem(422, "validation", "That briefing item is not recognised"));
    if (action !== "pin" && action !== "dismiss" && action !== "clear") {
      return reply.code(422).send(problem(422, "validation", "Choose pin, dismiss, or clear"));
    }
    const date = await londonDate();
    if (action === "clear") {
      await pool.query(`delete from briefing_pin where property_id=$1 and user_id=$2 and on_date=$3::date and item_key=$4`, [a.propertyId, a.userId, date, key]);
    } else {
      await pool.query(
        `insert into briefing_pin (tenant_id, property_id, user_id, on_date, item_key, action)
         values ($1,$2,$3,$4::date,$5,$6)
         on conflict (property_id, user_id, on_date, item_key) do update set action = excluded.action`,
        [a.tenantId, a.propertyId, a.userId, date, key, action],
      );
    }
    return { ok: true, key, action };
  });

  f.get("/v1/settings/briefing", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("briefing.manage") && !a.perms.has("package.manage")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open briefing settings"));
    }
    return rulesBody(await rulesFor(a.propertyId));
  });

  f.put("/v1/settings/briefing", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "package.manage", reply)) return;
    const rules = parseWatchRules(req.body ?? {});
    const body = rulesBody(rules);
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{briefing}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(body)],
    );
    return body;
  });

  f.get("/v1/me/home", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    return { home: await homeFor(a.userId) };
  });

  f.put("/v1/me/home", async (req, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a || !allow(a, "briefing.read", reply)) return;
    const home = (req.body as { home?: unknown } | null)?.home === "briefing" ? "briefing" : "house";
    await pool.query(
      `insert into user_preference (user_id, home_screen) values ($1,$2)
       on conflict (user_id) do update set home_screen = excluded.home_screen`,
      [a.userId, home],
    );
    return { home };
  });
}
