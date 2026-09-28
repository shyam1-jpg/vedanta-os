/** Who is in the house. Rows come from the briefing stays and the digital check-in status.
 *  Front of house, housekeeping, and managers see names and rooms.
 *  The kitchen sees a dietary flag. Allergen codes stay off this board.
 */

import type { BriefingStay, Movement } from "./briefing.ts";

export type WhoRole = "front" | "housekeeping" | "manager" | "kitchen" | "other";

export type WhoSource = {
  id: string;
  firstName: string;
  room: string;
  group: string;
  building: string;
  movement: Movement;
  checkIn: string;
  accessNote: string;
  dietFlag: boolean;
  allergens: string[];
};

export type WhoCard = {
  id: string;
  name: string;
  room: string | null;
  group: string;
  building: string;
  status: string;
  access: string | null;
  diet: string | null;
};

const KITCHEN = new Set(["HEAD_CHEF", "KITCHEN_MANAGER", "SOUS_CHEF", "SENIOR_CHEF_DE_PARTIE", "CHEF_DE_PARTIE", "KITCHEN_APPRENTICE", "KITCHEN_ASSISTANT", "KITCHEN_PORTER", "KITCHEN"]);
const HOUSEKEEPING = new Set(["HK_SUPERVISOR", "HK_ATTENDANT", "HOUSEKEEPING"]);
const FRONT = new Set(["FRONT_OFFICE_MANAGER", "FRONT_OFFICE", "RECEPTIONIST", "NIGHT_PORTER", "FRONT"]);
const MANAGER = new Set(["SYSTEM_OWNER", "GENERAL_MANAGER", "OPERATIONS_MANAGER", "RETREAT_MANAGER", "RESTAURANT_MANAGER", "ADMIN"]);

export function whoRole(input: { role: string; department?: string | null; perms?: Iterable<string> }): WhoRole {
  const role = String(input.role ?? "").toUpperCase();
  const department = String(input.department ?? "").toUpperCase();
  const perms = new Set(input.perms ?? []);
  if (perms.has("guest.profile.kitchen") || KITCHEN.has(role) || department === "KITCHEN") return "kitchen";
  if (HOUSEKEEPING.has(role) || department === "HOUSEKEEPING" || department === "HK") return "housekeeping";
  if (MANAGER.has(role) || perms.has("night.audit") || perms.has("package.manage")) return "manager";
  if (FRONT.has(role) || department === "FRONT") return "front";
  return "other";
}

export function stayStatus(row: Pick<WhoSource, "movement" | "checkIn">): string {
  if (row.movement === "in_house") return "in house";
  if (row.movement === "departure") return row.checkIn && row.checkIn !== "expected" ? row.checkIn : "departing";
  return row.checkIn || "expected";
}

export function projectWho(row: WhoSource, role: WhoRole): WhoCard {
  const names = role === "kitchen" || role === "front" || role === "housekeeping" || role === "manager";
  const rooms = role === "front" || role === "housekeeping" || role === "manager";
  return {
    id: row.id,
    name: names ? row.firstName : "Guest",
    room: rooms ? row.room : null,
    group: row.group,
    building: row.building || "House",
    status: stayStatus(row),
    access: rooms && row.accessNote ? row.accessNote : null,
    diet: role === "kitchen" ? (row.dietFlag ? "dietary flag" : "no dietary flag") : null,
  };
}

export function cardHasAllergen(card: WhoCard, codes: string[]): boolean {
  const blob = JSON.stringify(card).toLowerCase();
  return codes.some(code => code && blob.includes(code.toLowerCase()));
}

export function filterWho(rows: WhoSource[], role: WhoRole, query: { q?: string; building?: string; group?: string; status?: string }): WhoCard[] {
  const q = String(query.q ?? "").trim().toLowerCase();
  const building = String(query.building ?? "").trim().toLowerCase();
  const group = String(query.group ?? "").trim().toLowerCase();
  const status = String(query.status ?? "").trim().toLowerCase();
  return rows
    .filter(row => !building || (row.building || "House").toLowerCase() === building)
    .filter(row => !group || row.group.toLowerCase().includes(group))
    .filter(row => !status || stayStatus(row).toLowerCase() === status)
    .filter(row => {
      if (!q) return true;
      return [row.firstName, row.room, row.group, row.building, stayStatus(row)].join(" ").toLowerCase().includes(q);
    })
    .map(row => projectWho(row, role));
}

export function onSite(row: Pick<WhoSource, "movement" | "checkIn">): boolean {
  if (row.movement === "in_house") return true;
  if (row.movement === "departure") return true;
  const status = (row.checkIn || "expected").toLowerCase();
  return status === "arrived" || status === "keys issued" || status === "checked in digitally";
}

export type RollLine = { name: string; room: string; group: string; access: string };

export function fireRoll(rows: WhoSource[]): RollLine[] {
  return rows.filter(onSite).map(row => ({
    name: row.firstName,
    room: row.room || "not assigned",
    group: row.group,
    access: row.accessNote ? "step-free" : "",
  }));
}

export function fireRollCsv(rows: WhoSource[]): string {
  const lines = ["Name,Room,Group,Access", ...fireRoll(rows).map(row => [row.name, row.room, row.group, row.access].map(cell => `"${cell.replace(/"/g, "")}"`).join(","))];
  return lines.join("\n");
}

export function fromBriefingStay(stay: BriefingStay, extra: { group: string; building: string; accessNote: string }): WhoSource {
  return {
    id: stay.id,
    firstName: stay.firstName,
    room: stay.room,
    group: extra.group,
    building: extra.building || "House",
    movement: stay.movement,
    checkIn: stay.checkIn ?? "",
    accessNote: extra.accessNote,
    dietFlag: stay.severe || stay.allergens.length > 0,
    allergens: stay.allergens,
  };
}
