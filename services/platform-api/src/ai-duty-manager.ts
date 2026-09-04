/**
 * AI Duty Manager — powered by Claude
 * Answers natural language questions about the house:
 * "Which rooms aren't ready?" "How many Jain guests tomorrow?" "What should I worry about today?"
 * Generates automatic morning and evening management briefings.
 */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow } from "./auth.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

async function getHouseContext(propertyId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [estate, rooms, arrivals, departures, inHouse, maintenance, tasks, dietary] = await Promise.all([
    // Property pulse
    pool.query(`
      SELECT p.name, p.check_in_from::text, p.check_out_by::text,
             (SELECT count(*) FROM room WHERE property_id=p.id AND NOT staff_only) guest_rooms
      FROM property p WHERE p.id=$1`, [propertyId]),

    // Room statuses
    pool.query(`
      SELECT r.number, r.section, rse.status, rse.updated_at
      FROM room r
      LEFT JOIN LATERAL (
        SELECT status, updated_at FROM room_status_event
        WHERE room_id=r.id ORDER BY updated_at DESC LIMIT 1
      ) rse ON true
      WHERE r.property_id=$1 AND NOT r.staff_only
      ORDER BY r.number`, [propertyId]),

    // Today's arrivals
    pool.query(`
      SELECT g.name, g.expected_guests, g.arrival_slot, g.arrival_time::text, g.contact_name
      FROM booking_group g
      WHERE g.property_id=$1 AND g.arrival_date=$2 AND g.status IN ('CONFIRMED','IN_HOUSE')
      ORDER BY g.arrival_time`, [propertyId, today]),

    // Today's departures
    pool.query(`
      SELECT g.name, g.expected_guests, g.departure_slot, g.departure_time::text
      FROM booking_group g
      WHERE g.property_id=$1 AND g.departure_date=$2 AND g.status='IN_HOUSE'`, [propertyId, today]),

    // Currently in house
    pool.query(`
      SELECT g.name, g.expected_guests, g.arrival_date::text, g.departure_date::text
      FROM booking_group g
      WHERE g.property_id=$1 AND g.status='IN_HOUSE'`, [propertyId]),

    // Open maintenance issues
    pool.query(`
      SELECT title, priority, location, status, created_at::text
      FROM maintenance_ticket
      WHERE property_id=$1 AND status NOT IN ('DONE','CANCELLED')
      ORDER BY CASE priority WHEN 'safety' THEN 1 WHEN 'urgent' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END
      LIMIT 20`, [propertyId]),

    // Overdue tasks
    pool.query(`
      SELECT title, department, due_at::text, priority
      FROM ops_task
      WHERE property_id=$1 AND status NOT IN ('done','cancelled')
        AND due_at < now()
      ORDER BY due_at LIMIT 10`, [propertyId]),

    // Dietary needs in house today
    pool.query(`
      SELECT d.diet, d.allergens, d.severity, count(*) n
      FROM room_occupancy o
      JOIN person p ON p.id=o.person_id
      JOIN diet_profile d ON d.person_id=p.id
      JOIN room r ON r.id=o.room_id
      WHERE r.property_id=$1 AND o.on_date=$2
        AND (array_length(d.allergens,1)>0 OR array_length(d.diet,1)>0)
      GROUP BY d.diet, d.allergens, d.severity`, [propertyId, today]),
  ]);

  const prop = estate.rows[0] ?? {};
  const roomStatuses = rooms.rows;
  const notReady = roomStatuses.filter(r => !r.status || r.status === "DIRTY" || r.status === "NEEDS_REDO");
  const ready = roomStatuses.filter(r => r.status === "CLEAN" || r.status === "INSPECTED");
  const outOfOrder = roomStatuses.filter(r => r.status === "OUT_OF_ORDER");

  return `
VEDANTA OWAY RETREAT — HOUSE CONTEXT
Property: ${prop.name ?? "The Vedanta Way"}
Date: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
Time: ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} London time
Guest rooms: ${prop.guest_rooms ?? 41} total

ROOMS:
- Ready/inspected: ${ready.length} rooms (${ready.map(r => r.number).join(", ") || "none"})
- Not ready (dirty/uncleaned): ${notReady.length} rooms (${notReady.map(r => r.number).join(", ") || "none"})
- Out of order: ${outOfOrder.length} rooms (${outOfOrder.map(r => r.number).join(", ") || "none"})

TODAY'S ARRIVALS (${arrivals.rows.length} groups):
${arrivals.rows.length === 0 ? "None" : arrivals.rows.map(a =>
  `- ${a.name}: ${a.expected_guests ?? "?"} guests, ${a.arrival_slot} ${a.arrival_time ? "from " + a.arrival_time.slice(0,5) : ""}${a.contact_name ? " (contact: " + a.contact_name + ")" : ""}`
).join("\n")}

TODAY'S DEPARTURES (${departures.rows.length} groups):
${departures.rows.length === 0 ? "None" : departures.rows.map(d =>
  `- ${d.name}: ${d.expected_guests ?? "?"} guests, ${d.departure_slot}`
).join("\n")}

CURRENTLY IN HOUSE (${inHouse.rows.length} groups):
${inHouse.rows.length === 0 ? "Empty house" : inHouse.rows.map(g =>
  `- ${g.name}: ${g.expected_guests ?? "?"} guests, arrived ${g.arrival_date}, departing ${g.departure_date}`
).join("\n")}

DIETARY NEEDS IN HOUSE TODAY:
${dietary.rows.length === 0 ? "None recorded" : dietary.rows.map(d =>
  `- ${d.n} guest(s): diet=${(d.diet??[]).join(",")||"none"}, allergens=${(d.allergens??[]).join(",")||"none"}, severity=${d.severity ?? "preference"}`
).join("\n")}

OPEN MAINTENANCE ISSUES (${maintenance.rows.length}):
${maintenance.rows.length === 0 ? "None" : maintenance.rows.map(m =>
  `- [${m.priority.toUpperCase()}] ${m.title}${m.location ? " in " + m.location : ""} (${m.status})`
).join("\n")}

OVERDUE TASKS (${tasks.rows.length}):
${tasks.rows.length === 0 ? "None" : tasks.rows.map(t =>
  `- [${t.department}] ${t.title} — was due ${t.due_at}`
).join("\n")}
`.trim();
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);
  const data = await resp.json() as any;
  return data.content?.[0]?.text ?? "No response";
}

const DUTY_MANAGER_SYSTEM = `You are the AI Duty Manager for Vedanta Oway Retreat, a luxury Grade II listed retreat centre in Lincolnshire. You have real-time data about the house — rooms, guests, arrivals, departures, maintenance issues and tasks.

Your role is to help the duty manager run the house smoothly. You are concise, warm, professional and practical. You speak like an experienced hotel general manager. You prioritise guest safety and experience above everything.

When answering questions:
- Be specific and actionable — name rooms, groups and people by name
- Flag safety and urgent issues first
- Be honest if data is missing ("I don't have that information")
- Keep answers short unless a full briefing is requested
- Use British English`;

export async function generateMorningBriefing(propertyId: string): Promise<string> {
  const context = await getHouseContext(propertyId);
  return callClaude(
    DUTY_MANAGER_SYSTEM + "\n\n" + context,
    `Generate a morning management briefing for the duty manager. Cover:
1. What's happening today (arrivals, departures, in-house groups)
2. Room readiness — any concerns?
3. Dietary and accessibility needs for today's guests
4. Maintenance issues that need attention
5. Overdue tasks
6. Top 3 things to focus on today

Keep it under 300 words. Use clear sections. Be direct.`
  );
}

export default async function aiDutyManager(f: FastifyInstance) {

  // Natural language question to the AI Duty Manager
  f.post("/v1/duty-manager/ask", async (req: any, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const { question } = req.body ?? {};
    if (!question?.trim()) return reply.code(422).send({ error: "question is required" });
    if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "AI Duty Manager is not configured. Set ANTHROPIC_API_KEY." });

    try {
      const context = await getHouseContext(a.propertyId);
      const answer = await callClaude(DUTY_MANAGER_SYSTEM + "\n\n" + context, question);
      // Log the query for audit
      await pool.query(
        `INSERT INTO audit_event (tenant_id, property_id, actor_user_id, entity_type, entity_id, action, payload)
         VALUES ($1,$2,$3,'duty_manager','ai','query',$4)`,
        [a.tenantId, a.propertyId, a.userId, JSON.stringify({ question: question.slice(0, 500), answer_length: answer.length })]
      );
      return { answer, context_date: new Date().toISOString() };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message ?? "AI query failed" });
    }
  });

  // Generate morning briefing
  f.get("/v1/duty-manager/morning-briefing", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "AI Duty Manager is not configured. Set ANTHROPIC_API_KEY." });

    try {
      const briefing = await generateMorningBriefing(a.propertyId);
      return { briefing, generated_at: new Date().toISOString() };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message ?? "Briefing generation failed" });
    }
  });

  // Raw house context (for debugging / transparency)
  f.get("/v1/duty-manager/context", async (req, reply) => {
    const a = await requireActor(req, reply); if (!a || !allow(a, "group.read", reply)) return;
    const context = await getHouseContext(a.propertyId);
    return { context };
  });
}
