/** A short vegetable-garden note. Not a farm system.
 *  A harvest is incoming kitchen stock from the garden.
 *  Catering waste is never fed to the cows.
 */

import { vegetarianName } from "./stock.ts";

export const WASTE_TYPES = [
  { code: "prep", label: "Prep waste" },
  { code: "plate", label: "Plate waste" },
  { code: "spoiled", label: "Spoiled stock" },
  { code: "surplus", label: "Garden surplus" },
] as const;

export const DESTINATIONS = [
  { code: "compost", label: "Composted" },
  { code: "digestion", label: "Anaerobic digestion or food waste collection" },
  { code: "landfill", label: "Landfill" },
  { code: "donated", label: "Donated" },
  { code: "cows", label: "Fed to the cows" },
] as const;

export type WasteType = (typeof WASTE_TYPES)[number]["code"];
export type Destination = (typeof DESTINATIONS)[number]["code"];
export type Origin = "kitchen" | "plot";

export type GardenSettings = { enabled: boolean };

export type Plot = {
  id: string;
  name: string;
  crop: string;
  variety: string;
  plantedOn: string;
  dueOn: string;
  status: "growing" | "cleared";
};

export type GardenEntry = {
  kind: "harvest" | "use" | "waste";
  crop: string;
  variety: string;
  kg: number;
  wasteType: WasteType | null;
  destination: Destination | null;
  origin: Origin;
  onDate: string;
};

/** Published disposal factors, kilograms of CO2e per tonne. Year is part of the label. */
export const WASTE_FACTORS = [
  { destination: "compost" as const, perTonne: 9.0069, activity: "Organic food and drink waste, composting" },
  { destination: "digestion" as const, perTonne: 9.0069, activity: "Organic food and drink waste, anaerobic digestion" },
  { destination: "landfill" as const, perTonne: 700.3326, activity: "Organic food and drink waste, landfill" },
] as const;

export const FACTOR_YEAR = 2026;
export const FACTOR_SOURCE = "UK government GHG conversion factors (DESNZ) 2026, refuse, organic food and drink waste.";

export const COWS_BLOCKED =
  "Kitchen waste cannot be fed to the cows. Under the Animal By-Products Regulations it is illegal to feed catering waste to farmed animals, including cattle, even from a vegetarian kitchen. Only produce taken straight from the plot, which has never entered the kitchen, can be recorded as fed to the cows.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function kgOf(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return round3(n);
}

function foodName(name: string): { ok: true } | { ok: false; error: string } {
  return vegetarianName(name);
}

export function parseGardenSettings(raw: unknown): GardenSettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { enabled: src.enabled === true };
}

export function stockName(crop: string, variety: string): string {
  const base = crop.trim();
  const kind = variety.trim();
  return (kind ? `${base} (${kind})` : base).slice(0, 120);
}

export function parsePlot(raw: unknown): { ok: true; plot: Omit<Plot, "id" | "status"> } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const name = text(src.name ?? src.plot, 80);
  const crop = text(src.crop, 80);
  const variety = text(src.variety, 80);
  if (!name || !crop) return { ok: false, error: "Name the plot and the crop" };
  const food = foodName(`${crop} ${variety}`);
  if (!food.ok) return food;
  const plantedOn = text(src.planted_on ?? src.plantedOn, 10);
  const dueOn = text(src.due_on ?? src.dueOn ?? src.expected_harvest, 10);
  if (!DAY.test(plantedOn) || !DAY.test(dueOn)) return { ok: false, error: "Use dates such as 2026-04-12" };
  if (dueOn < plantedOn) return { ok: false, error: "The harvest date is after the planting date" };
  return { ok: true, plot: { name, crop, variety, plantedOn, dueOn } };
}

export function plotBoard(plots: Plot[], today: string) {
  const growing = plots.filter(plot => plot.status === "growing");
  const cards = growing.map(plot => ({ ...plot, due: plot.dueOn <= today }));
  return { growing: cards, due: cards.filter(plot => plot.due) };
}

export function harvestStock(raw: { crop: string; variety: string; kg: number }): { ok: true; name: string; unit: "kg"; kg: number; source: "garden"; note: string } | { ok: false; error: string } {
  const name = stockName(raw.crop, raw.variety);
  const food = foodName(name);
  if (!food.ok) return food;
  if (!(raw.kg > 0)) return { ok: false, error: "Enter the kilograms" };
  return { ok: true, name, unit: "kg", kg: round3(raw.kg), source: "garden", note: "From the garden" };
}

export function parseHarvest(raw: unknown): { ok: true; entry: GardenEntry & { plotId: string } } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const crop = text(src.crop, 80);
  const variety = text(src.variety, 80);
  const kg = kgOf(src.kg);
  const onDate = text(src.date ?? src.on_date, 10);
  if (!crop) return { ok: false, error: "Name the crop" };
  if (kg == null) return { ok: false, error: "Enter the kilograms" };
  if (!DAY.test(onDate)) return { ok: false, error: "Use a date such as 2026-09-27" };
  const stock = harvestStock({ crop, variety, kg });
  if (!stock.ok) return stock;
  return {
    ok: true,
    entry: { kind: "harvest", crop, variety, kg, wasteType: null, destination: null, origin: "plot", onDate, plotId: text(src.plot_id ?? src.plotId, 80) },
  };
}

export function parseUse(raw: unknown): { ok: true; entry: GardenEntry } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const crop = text(src.crop, 80);
  const variety = text(src.variety, 80);
  const kg = kgOf(src.kg);
  const onDate = text(src.date ?? src.on_date, 10);
  if (!crop) return { ok: false, error: "Name the crop" };
  if (kg == null) return { ok: false, error: "Enter the kilograms used" };
  if (!DAY.test(onDate)) return { ok: false, error: "Use a date such as 2026-09-27" };
  const food = foodName(stockName(crop, variety));
  if (!food.ok) return food;
  return { ok: true, entry: { kind: "use", crop, variety, kg, wasteType: null, destination: null, origin: "kitchen", onDate } };
}

function wasteTypeOf(value: unknown): WasteType | null {
  const code = text(value, 20);
  return WASTE_TYPES.some(row => row.code === code) ? code as WasteType : null;
}

function destinationOf(value: unknown): Destination | null {
  const code = text(value, 20);
  return DESTINATIONS.some(row => row.code === code) ? code as Destination : null;
}

/** Kitchen waste types always count as catering waste, even if someone ticks straight from the plot. */
export function parseWaste(raw: unknown): { ok: true; entry: GardenEntry } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const crop = text(src.crop, 80) || "Garden produce";
  const variety = text(src.variety, 80);
  const kg = kgOf(src.kg);
  const onDate = text(src.date ?? src.on_date, 10);
  const wasteType = wasteTypeOf(src.waste_type ?? src.wasteType ?? src.type);
  const destination = destinationOf(src.destination);
  const askedPlot = src.origin === "plot" || src.straight_from_plot === true || src.straightFromPlot === true;
  if (kg == null) return { ok: false, error: "Enter the kilograms" };
  if (!DAY.test(onDate)) return { ok: false, error: "Use a date such as 2026-09-27" };
  if (!destination) return { ok: false, error: "Choose where it went" };
  const food = foodName(stockName(crop, variety));
  if (!food.ok) return food;
  const origin: Origin = wasteType || !askedPlot ? "kitchen" : "plot";
  if (destination === "cows" && origin !== "plot") return { ok: false, error: COWS_BLOCKED };
  if (origin === "kitchen" && !wasteType) return { ok: false, error: "Choose the kind of waste" };
  return { ok: true, entry: { kind: "waste", crop, variety, kg, wasteType: origin === "plot" ? null : wasteType, destination, origin, onDate } };
}

/** Spoiled stock and kitchen surplus leave the shelf. Prep and plate waste are recorded without a second stock change. */
export function stockOpFor(entry: Pick<GardenEntry, "kind" | "wasteType" | "origin">): "restock" | "use" | null {
  if (entry.kind === "harvest") return "restock";
  if (entry.kind === "use") return "use";
  if (entry.kind === "waste" && entry.origin === "kitchen" && (entry.wasteType === "spoiled" || entry.wasteType === "surplus")) return "use";
  return null;
}

export function wasteCarbon(destination: string, kg: number) {
  const factor = WASTE_FACTORS.find(row => row.destination === destination);
  if (!factor || !(kg > 0)) return null;
  return {
    label: "Estimate" as const,
    kgCo2e: round3(kg * factor.perTonne / 1000),
    factorText: `${factor.perTonne} kg CO2e per tonne`,
    year: FACTOR_YEAR,
    source: FACTOR_SOURCE,
    activity: factor.activity,
  };
}

export function gardenLocalShare(gardenKg: number, otherIncomingKg: number): number | null {
  const garden = Math.max(0, gardenKg);
  const other = Math.max(0, otherIncomingKg);
  const total = garden + other;
  if (!(total > 0)) return null;
  return Math.round((garden / total) * 1000) / 10;
}

export function gardenImpact(input: {
  period: string;
  entries: Pick<GardenEntry, "kind" | "kg" | "destination" | "onDate">[];
  otherIncomingKg: number;
}) {
  const rows = input.entries.filter(row => row.onDate.startsWith(input.period));
  const gardenKg = round3(rows.filter(row => row.kind === "harvest").reduce((sum, row) => sum + row.kg, 0));
  const byDestination = DESTINATIONS.map(dest => {
    const kg = round3(rows.filter(row => row.kind === "waste" && row.destination === dest.code).reduce((sum, row) => sum + row.kg, 0));
    return { code: dest.code, label: dest.label, kg, carbon: wasteCarbon(dest.code, kg) };
  }).filter(row => row.kg > 0);
  const composted = byDestination.find(row => row.code === "compost")?.kg ?? 0;
  return {
    period: input.period,
    composted_kg: composted,
    local_share: gardenLocalShare(gardenKg, input.otherIncomingKg),
    garden_kg: gardenKg,
    other_incoming_kg: round3(Math.max(0, input.otherIncomingKg)),
    by_destination: byDestination,
    carbon_note: `Carbon figures are estimates. They use the UK government GHG conversion factors (DESNZ) ${FACTOR_YEAR}.`,
  };
}

export function historyCsv(lines: { date: string; plot: string; crop: string; kind: string; kg: number; wasteType: string; destination: string; origin: string }[]): string {
  const header = "date,plot,crop,kind,kg,waste_type,destination,origin";
  const body = lines.map(line => [line.date, line.plot, line.crop, line.kind, String(line.kg), line.wasteType, line.destination, line.origin].map(csvCell).join(","));
  return [header, ...body].join("\n") + "\n";
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
