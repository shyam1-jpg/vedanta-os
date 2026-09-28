/** Sustainability readings. Flags stay off until a manager turns them on. */
import type { FastifyInstance } from "fastify";
import { pool, tx } from "./db.ts";
import { requireActor, allow, problem } from "./auth.ts";
import { audit } from "./groups.ts";
import {
  METRICS,
  carbonEstimate,
  metricOf,
  parseCsv,
  parseReading,
  parseSustainabilitySettings,
  publicSummary,
  renderReportPdf,
  reportCsv,
  reportLines,
  seriesAgainstBaseline,
  type ReportLine,
  type SustainabilitySettings,
} from "../../../domains/ops/sustainability.ts";

async function actor(req: any, reply: any) {
  return requireActor(req, reply, ["ADMIN", "STAFF"]);
}

async function loadSettings(propertyId: string): Promise<SustainabilitySettings> {
  const row = (await pool.query(`select settings from property where id=$1`, [propertyId])).rows[0];
  return parseSustainabilitySettings(row?.settings?.sustainability);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type Stored = { metric: string; period: string; value: string | number; note: string | null; created_at?: string };

function rollup(rows: Stored[]) {
  const map = new Map<string, { metric: string; period: string; value: number; note: string; at: string }>();
  const ordered = [...rows].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  for (const row of ordered) {
    const key = `${row.metric}|${row.period}`;
    const current = map.get(key);
    const share = row.metric.startsWith("sourcing_");
    const value = share ? num(row.value) : Math.round(((current?.value ?? 0) + num(row.value)) * 1000) / 1000;
    map.set(key, { metric: row.metric, period: row.period, value, note: row.note || current?.note || "", at: String(row.created_at ?? "") });
  }
  return [...map.values()];
}

async function stored(propertyId: string): Promise<{ rows: Stored[]; baseline: { metric: string; value: number; note: string | null }[] } | null> {
  try {
    const rows = (await pool.query(
      `select metric, to_char(period, 'YYYY-MM') as period, value, note, created_at
       from sustainability_reading where property_id=$1`,
      [propertyId],
    )).rows as Stored[];
    const baseline = (await pool.query(
      `select metric, value, note from sustainability_baseline where property_id=$1`,
      [propertyId],
    )).rows as { metric: string; value: string; note: string | null }[];
    return { rows, baseline: baseline.map(row => ({ metric: row.metric, value: num(row.value), note: row.note })) };
  } catch (err) {
    console.error("[sustainability] tables missing", err instanceof Error ? err.message : err);
    return null;
  }
}

function pack(data: { rows: Stored[]; baseline: { metric: string; value: number; note: string | null }[] }) {
  const points = rollup(data.rows);
  const base = new Map(data.baseline.map(row => [row.metric, row.value]));
  const series = METRICS.map(metric => ({
    ...metric,
    baseline: base.has(metric.code) ? base.get(metric.code)! : null,
    points: seriesAgainstBaseline(
      points.filter(point => point.metric === metric.code).map(point => ({ period: point.period, value: point.value })),
      base.has(metric.code) ? base.get(metric.code)! : null,
    ),
    carbon: (() => {
      const last = points.filter(point => point.metric === metric.code).at(-1);
      return last ? carbonEstimate(metric.code, last.value) : null;
    })(),
  }));
  const lines: ReportLine[] = points.map(point => {
    const metric = metricOf(point.metric);
    return {
      period: point.period,
      metric: point.metric,
      label: metric?.label ?? point.metric,
      unit: metric?.unit ?? "",
      value: point.value,
      baseline: base.has(point.metric) ? base.get(point.metric)! : null,
      note: point.note,
    };
  });
  return { series, lines, points };
}

async function propertyIdFromHost(): Promise<string | null> {
  const row = (await pool.query(`select id from property order by created_at limit 1`)).rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

export default async function sustainabilityRoutes(f: FastifyInstance) {
  f.get("/public/sustainability", async () => {
    const propertyId = await propertyIdFromHost();
    if (!propertyId) return { enabled: false };
    const settings = await loadSettings(propertyId);
    const data = await stored(propertyId);
    if (!data) return publicSummary({ enabled: settings.enabled, isPublic: settings.public, period: null, totals: [] });
    const { points } = pack(data);
    const period = points.map(point => point.period).sort().at(-1) ?? null;
    const totals = points.filter(point => point.period === period).map(point => ({ metric: point.metric, value: point.value }));
    return publicSummary({ enabled: settings.enabled, isPublic: settings.public, period, totals });
  });

  f.get("/v1/settings/sustainability", async (req, reply) => {
    const a = await actor(req, reply); if (!a) return;
    if (!a.perms.has("package.manage") && !a.perms.has("sustainability.log")) {
      return reply.code(403).send(problem(403, "forbidden", "You cannot open sustainability settings"));
    }
    return await loadSettings(a.propertyId);
  });

  f.put("/v1/settings/sustainability", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "package.manage", reply)) return;
    const parsed = parseSustainabilitySettings(req.body ?? {});
    const settings = { enabled: parsed.enabled, public: parsed.enabled && parsed.public };
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{sustainability}', $2::jsonb, true) where id=$1`,
      [a.propertyId, JSON.stringify(settings)],
    );
    return settings;
  });

  f.get("/v1/sustainability", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return { enabled: false, public: false, metrics: METRICS, series: [], factors: [] };
    const data = await stored(a.propertyId);
    if (!data) return { enabled: true, public: settings.public, metrics: METRICS, series: [], factors: [], ready: false };
    const { series } = pack(data);
    return {
      enabled: true,
      public: settings.public,
      metrics: METRICS,
      series: series.map(row => ({
        ...row,
        carbon: row.carbon,
      })),
      goshala: "The cows are cared for and are never milked. The goshala does not produce milk.",
    };
  });

  f.post("/v1/sustainability/readings", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The sustainability tracker is off"));
    const parsed = parseReading(req.body ?? {});
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      const id = await tx(async c => {
        const saved = await c.query(
          `insert into sustainability_reading (tenant_id, property_id, metric, period, value, note, by_user_id, by_name)
           values ($1,$2,$3,$4::date,$5,$6,$7,$8) returning id`,
          [a.tenantId, a.propertyId, parsed.reading.metric, `${parsed.reading.period}-01`, parsed.reading.value, parsed.reading.note || null, a.userId, a.name],
        );
        await audit(c, a, "sustainability_reading", saved.rows[0].id, "sustainability.add", { payload: parsed.reading });
        return saved.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    } catch (err) {
      console.error("[sustainability] save failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The sustainability log is not ready yet"));
    }
  });

  f.post("/v1/sustainability/import", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The sustainability tracker is off"));
    const parsed = parseCsv(String(req.body?.csv ?? ""));
    if (!parsed.rows.length && parsed.errors.length) return reply.code(422).send(problem(422, "validation", parsed.errors[0]));
    let saved = 0;
    try {
      for (const row of parsed.rows) {
        await pool.query(
          `insert into sustainability_reading (tenant_id, property_id, metric, period, value, note, by_user_id, by_name)
           values ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
          [a.tenantId, a.propertyId, row.metric, `${row.period}-01`, row.value, row.note || "Imported", a.userId, a.name],
        );
        saved += 1;
      }
    } catch (err) {
      console.error("[sustainability] import failed", err instanceof Error ? err.message : err);
      return reply.code(503).send(problem(503, "unavailable", "The sustainability log is not ready yet"));
    }
    return { saved, errors: parsed.errors };
  });

  f.put("/v1/sustainability/baseline", async (req: any, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The sustainability tracker is off"));
    const parsed = parseReading({ ...(req.body ?? {}), period: "2026-01" });
    if (!parsed.ok) return reply.code(422).send(problem(422, "validation", parsed.error));
    try {
      await pool.query(
        `insert into sustainability_baseline (property_id, tenant_id, metric, value, note)
         values ($1,$2,$3,$4,$5)
         on conflict (property_id, metric) do update set value=excluded.value, note=excluded.note, updated_at=now()`,
        [a.propertyId, a.tenantId, parsed.reading.metric, parsed.reading.value, parsed.reading.note || "Baseline"],
      );
      return { ok: true };
    } catch {
      return reply.code(503).send(problem(503, "unavailable", "The sustainability log is not ready yet"));
    }
  });

  f.get("/v1/sustainability/export.csv", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The sustainability tracker is off"));
    const data = await stored(a.propertyId);
    const csv = reportCsv(data ? pack(data).lines : []);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=sustainability.csv");
    return csv;
  });

  f.get("/v1/sustainability/export.pdf", async (req, reply) => {
    const a = await actor(req, reply); if (!a || !allow(a, "sustainability.log", reply)) return;
    const settings = await loadSettings(a.propertyId);
    if (!settings.enabled) return reply.code(404).send(problem(404, "not_found", "The sustainability tracker is off"));
    const data = await stored(a.propertyId);
    const pdf = renderReportPdf(reportLines(data ? pack(data).lines : []));
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", "attachment; filename=sustainability.pdf");
    return Buffer.from(pdf);
  });
}
