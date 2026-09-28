/** Vegetable garden. The switch stays off. A harvest lands on the kitchen stock list as garden. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import { applyCount } from "../../../domains/ops/stock.ts";
import {
  COWS_BLOCKED,
  DESTINATIONS,
  WASTE_TYPES,
  gardenImpact,
  harvestStock,
  historyCsv,
  parseGardenSettings,
  parseHarvest,
  parsePlot,
  parseUse,
  parseWaste,
  plotBoard,
  stockName,
  stockOpFor,
  type GardenEntry,
  type Plot,
} from "../../../domains/ops/garden.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function loadSettings(propertyId: string) {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseGardenSettings(row?.settings?.garden);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function londonDate(): Promise<string> {
  const row = (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') as d`)).rows[0] as { d: string };
  return row.d;
}

async function loadPlots(propertyId: string): Promise<Plot[] | null> {
  try {
    const rows = (await pool.query(
      `select id, name, crop, variety, planted_on::text planted_on, due_on::text due_on, status
       from garden_plot where property_id=$1 order by name`,
      [propertyId],
    )).rows as { id: string; name: string; crop: string; variety: string; planted_on: string; due_on: string; status: string }[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      crop: row.crop,
      variety: row.variety,
      plantedOn: row.planted_on,
      dueOn: row.due_on,
      status: row.status === "cleared" ? "cleared" : "growing",
    }));
  } catch (err) {
    console.error("[garden] plot table missing", err instanceof Error ? err.message : err);
    return null;
  }
}

type StoredEntry = GardenEntry & { id: string; plotId: string | null; plotName: string };

async function loadEntries(propertyId: string): Promise<StoredEntry[] | null> {
  try {
    const rows = (await pool.query(
      `select e.id, e.kind, e.crop, e.variety, e.kg, e.waste_type, e.destination, e.origin, e.on_date::text on_date, e.plot_id, g.name plot_name
       from garden_entry e
       left join garden_plot g on g.id = e.plot_id
       where e.property_id=$1
       order by e.on_date desc, e.created_at desc
       limit 60`,
      [propertyId],
    )).rows as Record<string, string>[];
    return rows.map(row => ({
      id: row.id,
      kind: row.kind === "use" || row.kind === "waste" ? row.kind : "harvest",
      crop: row.crop,
      variety: row.variety ?? "",
      kg: num(row.kg),
      wasteType: (row.waste_type || null) as GardenEntry["wasteType"],
      destination: (row.destination || null) as GardenEntry["destination"],
      origin: row.origin === "plot" ? "plot" : "kitchen",
      onDate: row.on_date,
      plotId: row.plot_id,
      plotName: row.plot_name ?? "",
    }));
  } catch (err) {
    console.error("[garden] entry table missing", err instanceof Error ? err.message : err);
    return null;
  }
}

async function otherIncomingKg(propertyId: string, period: string): Promise<number> {
  try {
    const row = (await pool.query(
      `select coalesce(sum(delta), 0) kg
       from kitchen_stock_log
       where property_id=$1 and action='restock' and created_at >= ($2 || '-01')::date
         and created_at < (($2 || '-01')::date + interval '1 month')
         and coalesce(source, '') <> 'garden'
         and coalesce(note, '') <> 'From the garden'`,
      [propertyId, period],
    )).rows[0] as { kg: string };
    return num(row?.kg);
  } catch {
    try {
      const row = (await pool.query(
        `select coalesce(sum(delta), 0) kg
         from kitchen_stock_log
         where property_id=$1 and action='restock' and created_at >= ($2 || '-01')::date
           and created_at < (($2 || '-01')::date + interval '1 month')
           and coalesce(note, '') <> 'From the garden'`,
        [propertyId, period],
      )).rows[0] as { kg: string };
      return num(row?.kg);
    } catch (err) {
      console.error("[garden] stock log skipped", err instanceof Error ? err.message : err);
      return 0;
    }
  }
}

export async function gardenDashboard(propertyId: string) {
  try {
    const latest = (await pool.query(
      `select to_char(max(on_date), 'YYYY-MM') as period from garden_entry where property_id=$1`,
      [propertyId],
    )).rows[0] as { period: string | null } | undefined;
    if (!latest?.period) return null;
    const rows = (await pool.query(
      `select kind, destination, sum(kg) kg
       from garden_entry
       where property_id=$1 and to_char(on_date, 'YYYY-MM')=$2
       group by kind, destination`,
      [propertyId, latest.period],
    )).rows as { kind: string; destination: string | null; kg: string }[];
    const other = await otherIncomingKg(propertyId, latest.period);
    return gardenImpact({
      period: latest.period,
      otherIncomingKg: other,
      entries: rows.map(row => ({
        kind: row.kind === "use" || row.kind === "waste" ? row.kind : "harvest",
        kg: num(row.kg),
        destination: (row.destination || null) as GardenEntry["destination"],
        onDate: `${latest.period}-01`,
      })),
    });
  } catch (err) {
    console.error("[garden] dashboard skipped", err instanceof Error ? err.message : err);
    return null;
  }
}

async function applyStock(
  c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  a: { tenantId: string; propertyId: string; userId?: string | null; name: string },
  entry: GardenEntry,
): Promise<{ itemId: string | null; note: string }> {
  const op = stockOpFor(entry);
  if (!op) return { itemId: null, note: "" };
  const line = harvestStock({ crop: entry.crop, variety: entry.variety, kg: entry.kg });
  if (!line.ok) return { itemId: null, note: line.error };
  const name = line.name;
  let row = (await c.query(
    `select id, quantity from kitchen_stock_item where property_id=$1 and name=$2 for update`,
    [a.propertyId, name],
  )).rows[0] as { id: string; quantity: string } | undefined;
  if (!row && op === "restock") {
    await c.query(`SAVEPOINT garden_stock_source`);
    try {
      const inserted = await c.query(
        `insert into kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, notes, source)
         values ($1,$2,$3,'kg',0,0,'From the garden','garden') returning id, quantity`,
        [a.tenantId, a.propertyId, name],
      );
      await c.query(`RELEASE SAVEPOINT garden_stock_source`);
      row = inserted.rows[0];
    } catch {
      await c.query(`ROLLBACK TO SAVEPOINT garden_stock_source`);
      const inserted = await c.query(
        `insert into kitchen_stock_item (tenant_id, property_id, name, unit, quantity, low_threshold, notes)
         values ($1,$2,$3,'kg',0,0,'From the garden') returning id, quantity`,
        [a.tenantId, a.propertyId, name],
      );
      row = inserted.rows[0];
    }
  }
  if (!row) return { itemId: null, note: "Logged. That crop is not on the kitchen list, so the count was left as it is." };
  const parsed = applyCount(num(row.quantity), op, entry.kg);
  if (!parsed.ok) return { itemId: row.id, note: "Logged. The stock count was left as it is because there isn't that much on the list." };
  await c.query(`update kitchen_stock_item set quantity=$2, updated_at=now() where id=$1`, [row.id, parsed.next]);
  await c.query(`SAVEPOINT garden_log_source`);
  try {
    await c.query(
      `insert into kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, note, by_user_id, by_name, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.id, a.tenantId, a.propertyId, parsed.action, num(row.quantity), parsed.next, parsed.delta, op === "restock" ? "From the garden" : "Garden log", a.userId, a.name, op === "restock" ? "garden" : null],
    );
    await c.query(`RELEASE SAVEPOINT garden_log_source`);
  } catch {
    await c.query(`ROLLBACK TO SAVEPOINT garden_log_source`);
    await c.query(
      `insert into kitchen_stock_log (item_id, tenant_id, property_id, action, quantity_before, quantity_after, delta, note, by_user_id, by_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, a.tenantId, a.propertyId, parsed.action, num(row.quantity), parsed.next, parsed.delta, op === "restock" ? "From the garden" : "Garden log", a.userId, a.name],
    );
  }
  return { itemId: row.id, note: op === "restock" ? "Added to kitchen stock from the garden." : "" };
}

function historyOf(entries: StoredEntry[]) {
  return entries.map(row => ({
    date: row.onDate,
    plot: row.plotName,
    crop: stockName(row.crop, row.variety),
    kind: row.kind,
    kg: row.kg,
    waste_type: row.wasteType ?? "",
    destination: row.destination ?? "",
    origin: row.origin,
  }));
}

export default async function gardenRoutes(f: FastifyInstance) {
  f.get("/v1/settings/garden", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("garden.log")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open garden settings"));
    }
    return loadSettings(a.propertyId);
  });

  f.put("/v1/settings/garden", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const settings = parseGardenSettings(req.body ?? {});
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{garden}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/garden", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return { enabled: false, cows_rule: COWS_BLOCKED };
    const today = await londonDate();
    const plots = await loadPlots(a.propertyId);
    if (!plots) return { enabled: true, ready: false, date: today };
    const entries = await loadEntries(a.propertyId);
    const board = plotBoard(plots, today);
    const impact = await gardenDashboard(a.propertyId);
    return {
      enabled: true,
      ready: true,
      date: today,
      growing: board.growing,
      due: board.due,
      history: entries ? historyOf(entries) : [],
      impact,
      waste_types: WASTE_TYPES,
      destinations: DESTINATIONS,
      cows_rule: COWS_BLOCKED,
    };
  });

  f.post("/v1/garden/plots", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const parsed = parsePlot(req.body ?? {});
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      const saved = await tx(async c => {
        const existing = (await c.query(
          `select id from garden_plot where property_id=$1 and name=$2 for update`,
          [a.propertyId, parsed.plot.name],
        )).rows[0] as { id: string } | undefined;
        const row = existing
          ? await c.query(
            `update garden_plot set crop=$2, variety=$3, planted_on=$4, due_on=$5, status='growing', updated_at=now() where id=$1 returning id`,
            [existing.id, parsed.plot.crop, parsed.plot.variety, parsed.plot.plantedOn, parsed.plot.dueOn],
          )
          : await c.query(
            `insert into garden_plot (tenant_id, property_id, name, crop, variety, planted_on, due_on)
             values ($1,$2,$3,$4,$5,$6,$7) returning id`,
            [a.tenantId, a.propertyId, parsed.plot.name, parsed.plot.crop, parsed.plot.variety, parsed.plot.plantedOn, parsed.plot.dueOn],
          );
        await audit(c, a, "garden_plot", row.rows[0].id, "garden.plant", { payload: parsed.plot });
        return row.rows[0].id as string;
      });
      reply.code(201);
      return { id: saved };
    } catch (err) {
      console.error("[garden] plant failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The garden log is not ready yet"));
    }
  });

  f.post("/v1/garden/plots/:id/clear", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const row = (await pool.query(
      `update garden_plot set status='cleared', updated_at=now() where id=$1 and property_id=$2 returning id`,
      [req.params.id, a.propertyId],
    )).rows[0];
    if (!row) return reply.code(404).send(problem(404, "not_found", "That plot is not on the list"));
    return { ok: true };
  });

  f.post("/v1/garden/harvests", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const body = req.body ?? {};
    let crop = String(body.crop ?? "");
    let variety = String(body.variety ?? "");
    let plotId = String(body.plot_id ?? body.plotId ?? "");
    if (plotId && !crop) {
      const plot = (await pool.query(`select crop, variety from garden_plot where id=$1 and property_id=$2`, [plotId, a.propertyId])).rows[0] as { crop: string; variety: string } | undefined;
      if (!plot) return reply.code(404).send(problem(404, "not_found", "That plot is not on the list"));
      crop = plot.crop;
      variety = plot.variety;
    }
    const parsed = parseHarvest({ ...body, crop, variety, plot_id: plotId, date: body.date || await londonDate() });
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      const saved = await tx(async c => {
        const stock = await applyStock(c, a, parsed.entry);
        const row = await c.query(
          `insert into garden_entry (tenant_id, property_id, plot_id, kind, crop, variety, kg, origin, on_date, stock_item_id, by_user_id, by_name)
           values ($1,$2,$3,'harvest',$4,$5,$6,'plot',$7,$8,$9,$10) returning id`,
          [a.tenantId, a.propertyId, parsed.entry.plotId || null, parsed.entry.crop, parsed.entry.variety, parsed.entry.kg, parsed.entry.onDate, stock.itemId, a.userId, a.name],
        );
        await audit(c, a, "garden_entry", row.rows[0].id, "garden.harvest", { payload: { crop: parsed.entry.crop, kg: parsed.entry.kg, source: "garden" } });
        return { id: row.rows[0].id as string, note: stock.note };
      });
      reply.code(201);
      return saved;
    } catch (err) {
      console.error("[garden] harvest failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The garden log is not ready yet"));
    }
  });

  f.post("/v1/garden/use", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const parsed = parseUse({ ...(req.body ?? {}), date: req.body?.date || await londonDate() });
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      const saved = await tx(async c => {
        const stock = await applyStock(c, a, parsed.entry);
        const row = await c.query(
          `insert into garden_entry (tenant_id, property_id, kind, crop, variety, kg, origin, on_date, stock_item_id, by_user_id, by_name)
           values ($1,$2,'use',$3,$4,$5,'kitchen',$6,$7,$8,$9) returning id`,
          [a.tenantId, a.propertyId, parsed.entry.crop, parsed.entry.variety, parsed.entry.kg, parsed.entry.onDate, stock.itemId, a.userId, a.name],
        );
        await audit(c, a, "garden_entry", row.rows[0].id, "garden.use", { payload: { crop: parsed.entry.crop, kg: parsed.entry.kg } });
        return { id: row.rows[0].id as string, note: stock.note };
      });
      reply.code(201);
      return saved;
    } catch (err) {
      console.error("[garden] use failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The garden log is not ready yet"));
    }
  });

  f.post("/v1/garden/waste", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const parsed = parseWaste({ ...(req.body ?? {}), date: req.body?.date || await londonDate() });
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      const saved = await tx(async c => {
        const stock = await applyStock(c, a, parsed.entry);
        const row = await c.query(
          `insert into garden_entry (tenant_id, property_id, kind, crop, variety, kg, waste_type, destination, origin, on_date, stock_item_id, by_user_id, by_name)
           values ($1,$2,'waste',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [a.tenantId, a.propertyId, parsed.entry.crop, parsed.entry.variety, parsed.entry.kg, parsed.entry.wasteType, parsed.entry.destination, parsed.entry.origin, parsed.entry.onDate, stock.itemId, a.userId, a.name],
        );
        await audit(c, a, "garden_entry", row.rows[0].id, "garden.waste", { payload: { destination: parsed.entry.destination, origin: parsed.entry.origin, kg: parsed.entry.kg } });
        return { id: row.rows[0].id as string, note: stock.note };
      });
      reply.code(201);
      return saved;
    } catch (err) {
      console.error("[garden] waste failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The garden log is not ready yet"));
    }
  });

  f.get("/v1/garden/export.csv", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "garden.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The garden log is off"));
    const entries = await loadEntries(a.propertyId);
    if (!entries) return reply.code(503).send(problem(503, "unavailable", "The garden log is not ready yet"));
    reply.header("content-type", "text/csv; charset=utf-8");
    return historyCsv(historyOf(entries).map(row => ({
      date: row.date,
      plot: row.plot,
      crop: row.crop,
      kind: row.kind,
      kg: row.kg,
      wasteType: row.waste_type,
      destination: row.destination,
      origin: row.origin,
    })));
  });
}
