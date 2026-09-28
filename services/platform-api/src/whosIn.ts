/** Who is in today. The rows are the briefing stays plus digital check-in labels. */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { requireActor, allow } from "./auth.ts";
import { factsFor } from "./briefing.ts";
import { checkInLabels } from "./journey.ts";
import { filterWho, fireRoll, fireRollCsv, whoRole, type WhoSource } from "../../../domains/ops/whosIn.ts";

export default async function whosInRoutes(f: FastifyInstance) {
  f.get("/v1/whos-in", async (req: any, reply) => {
    const a = await requireActor(req, reply, ["ADMIN", "STAFF"]); if (!a) return;
    if (!a.perms.has("group.read") && !a.perms.has("briefing.read")) return allow(a, "group.read", reply);
    const date = String(req.query?.date ?? "") || (await pool.query(`select to_char(timezone('Europe/London', now()), 'YYYY-MM-DD') date`)).rows[0].date;
    const { facts, generatedAt, cached } = await factsFor(a.propertyId, date);
    let labels = new Map<string, string>();
    try {
      labels = await checkInLabels(a.propertyId, [...new Set(facts.stays.map(stay => stay.id.split(":")[0]))]);
    } catch { /* check-in table is optional until migrated */ }
    const rooms = (await pool.query(`select number, building from room where property_id=$1`, [a.propertyId])).rows as { number: string; building: string | null }[];
    const buildingOf = new Map(rooms.map(room => [room.number, room.building || "House"]));
    const rows: WhoSource[] = facts.stays.map(stay => {
      const number = stay.room.split(",")[0]?.trim() ?? "";
      return {
        id: stay.id,
        firstName: stay.firstName,
        room: stay.room,
        group: stay.group || "House",
        building: buildingOf.get(number) || "House",
        movement: stay.movement,
        checkIn: stay.checkIn || labels.get(stay.id.split(":")[0]) || "",
        accessNote: stay.accessNote || (stay.access ? "accessibility" : ""),
        dietFlag: stay.severe || stay.allergens.length > 0,
        allergens: stay.allergens,
      };
    });
    const role = whoRole({ role: a.role, department: a.department, perms: a.perms });
    if (req.query?.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      return fireRollCsv(rows);
    }
    return {
      date,
      generatedAt,
      cached,
      role,
      items: filterWho(rows, role, { q: req.query?.q, building: req.query?.building, group: req.query?.group, status: req.query?.status }),
      roll: fireRoll(rows),
      buildings: [...new Set(rows.map(row => row.building))].sort(),
      groups: [...new Set(rows.map(row => row.group))].sort(),
    };
  });
}
