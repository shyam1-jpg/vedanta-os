import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COWS_BLOCKED,
  FACTOR_YEAR,
  gardenImpact,
  gardenLocalShare,
  harvestStock,
  historyCsv,
  parseGardenSettings,
  parseHarvest,
  parsePlot,
  parseUse,
  parseWaste,
  plotBoard,
  stockOpFor,
  wasteCarbon,
} from "./garden.ts";

describe("vegetable garden", () => {
  it("stays off until the switch is on, and shows what is growing and what is due", () => {
    assert.deepEqual(parseGardenSettings({}), { enabled: false });
    assert.equal(parseGardenSettings({ enabled: true }).enabled, true);
    const board = plotBoard([
      { id: "a", name: "Example bed", crop: "Example kale", variety: "Example variety", plantedOn: "2026-04-12", dueOn: "2026-09-20", status: "growing" },
      { id: "b", name: "Example bed 2", crop: "Example chard", variety: "", plantedOn: "2026-07-01", dueOn: "2026-10-15", status: "growing" },
      { id: "c", name: "Old bed", crop: "Example kale", variety: "", plantedOn: "2026-03-01", dueOn: "2026-06-01", status: "cleared" },
    ], "2026-09-28");
    assert.equal(board.growing.length, 2);
    assert.equal(board.due.length, 1);
    assert.equal(board.due[0].crop, "Example kale");
    const planted = parsePlot({ name: "Example bed", crop: "onion", variety: "", planted_on: "2026-04-01", due_on: "2026-06-01" });
    assert.equal(planted.ok, false);
  });

  it("turns a harvest into incoming garden stock and keeps the kitchen vegetarian", () => {
    const harvest = parseHarvest({ crop: "Example kale", variety: "Example variety", kg: 2.5, date: "2026-09-27", plot_id: "bed" });
    assert.equal(harvest.ok, true);
    if (!harvest.ok) return;
    const stock = harvestStock(harvest.entry);
    assert.equal(stock.ok, true);
    if (!stock.ok) return;
    assert.equal(stock.source, "garden");
    assert.equal(stock.unit, "kg");
    assert.equal(stock.kg, 2.5);
    assert.equal(stock.name, "Example kale (Example variety)");
    assert.equal(stockOpFor(harvest.entry), "restock");
    assert.equal(harvestStock({ crop: "garlic", variety: "", kg: 1 }).ok, false);
  });

  it("blocks feeding kitchen waste to the cows and allows produce that never entered the kitchen", () => {
    const prep = parseWaste({ crop: "Example kale", kg: 0.4, date: "2026-09-28", waste_type: "prep", destination: "cows" });
    assert.equal(prep.ok, false);
    if (prep.ok) return;
    assert.equal(prep.error, COWS_BLOCKED);
    assert.match(prep.error, /Animal By-Products/);
    assert.match(prep.error, /never entered the kitchen/);
    const surplus = parseWaste({ crop: "Example kale", kg: 1, date: "2026-09-28", waste_type: "surplus", destination: "cows", straight_from_plot: true });
    assert.equal(surplus.ok, false);
    const plate = parseWaste({ kg: 0.2, date: "2026-09-28", waste_type: "plate", destination: "cows", origin: "plot" });
    assert.equal(plate.ok, false);
    const spoiled = parseWaste({ crop: "Example kale", kg: 0.3, date: "2026-09-28", waste_type: "spoiled", destination: "landfill" });
    assert.equal(spoiled.ok, true);
    if (!spoiled.ok) return;
    assert.equal(spoiled.entry.origin, "kitchen");
    assert.equal(stockOpFor(spoiled.entry), "use");
    const fromPlot = parseWaste({ crop: "Example chard", kg: 0.4, date: "2026-09-28", destination: "cows", straight_from_plot: true });
    assert.equal(fromPlot.ok, true);
    if (!fromPlot.ok) return;
    assert.equal(fromPlot.entry.origin, "plot");
    assert.equal(fromPlot.entry.wasteType, null);
    assert.equal(stockOpFor(fromPlot.entry), null);
    const used = parseUse({ crop: "Example kale", kg: 1, date: "2026-09-28" });
    assert.equal(used.ok, true);
    if (!used.ok) return;
    assert.equal(stockOpFor(used.entry), "use");
  });

  it("feeds compost, local share, destination split, and a labelled carbon estimate to the dashboard", () => {
    const impact = gardenImpact({
      period: "2026-09",
      otherIncomingKg: 1.5,
      entries: [
        { kind: "harvest", kg: 2.5, destination: null, onDate: "2026-09-27" },
        { kind: "waste", kg: 0.8, destination: "compost", onDate: "2026-09-28" },
        { kind: "waste", kg: 0.2, destination: "landfill", onDate: "2026-09-28" },
        { kind: "waste", kg: 0.4, destination: "cows", onDate: "2026-09-28" },
        { kind: "harvest", kg: 9, destination: null, onDate: "2026-08-01" },
      ],
    });
    assert.equal(impact.composted_kg, 0.8);
    assert.equal(impact.garden_kg, 2.5);
    assert.equal(impact.local_share, gardenLocalShare(2.5, 1.5));
    assert.equal(impact.local_share, 62.5);
    assert.equal(impact.by_destination.find(row => row.code === "cows")?.carbon, null);
    const compost = impact.by_destination.find(row => row.code === "compost")?.carbon;
    assert.equal(compost?.label, "Estimate");
    assert.equal(compost?.year, FACTOR_YEAR);
    assert.equal(compost?.year, 2026);
    assert.match(compost?.factorText ?? "", /9\.0069 kg CO2e per tonne/);
    assert.match(compost?.source ?? "", /UK government GHG conversion factors/);
    assert.match(impact.carbon_note, /estimates/i);
    assert.match(impact.carbon_note, /2026/);
    const landfill = wasteCarbon("landfill", 1);
    assert.equal(landfill?.kgCo2e, 0.7);
    assert.match(landfill?.factorText ?? "", /700\.3326/);
    const csv = historyCsv([{ date: "2026-09-28", plot: "Example bed", crop: "Example kale", kind: "waste", kg: 0.8, wasteType: "prep", destination: "compost", origin: "kitchen" }]);
    assert.match(csv, /^date,plot,crop,kind,kg,waste_type,destination,origin/);
    assert.equal(/\b(milk|milking|dairy)\b/i.test(csv), false);
    assert.equal(gardenLocalShare(0, 0), null);
  });
});
