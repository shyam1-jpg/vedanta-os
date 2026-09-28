import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  carbonEstimate,
  parseCsv,
  parseReading,
  parseSustainabilitySettings,
  publicSummary,
  renderReportPdf,
  reportCsv,
  seriesAgainstBaseline,
} from "./sustainability.ts";

describe("sustainability tracker", () => {
  it("stays off, including the public summary, until both switches are on", () => {
    assert.deepEqual(parseSustainabilitySettings({}), { enabled: false, public: false });
    assert.deepEqual(publicSummary({ enabled: false, isPublic: true, period: "2026-09", totals: [{ metric: "energy_kwh", value: 10 }] }), { enabled: false });
    assert.equal(publicSummary({ enabled: true, isPublic: false, period: "2026-09", totals: [] }).enabled, false);
    const open = publicSummary({ enabled: true, isPublic: true, period: "2026-09", totals: [{ metric: "seva_hours", value: 18 }, { metric: "energy_kwh", value: 100 }] });
    assert.equal(open.enabled, true);
    if (!open.enabled) return;
    assert.match(open.goshala, /never milked/);
    assert.equal(open.carbon[0]?.label, "Estimate");
  });

  it("refuses a dairy figure for the goshala and accepts plate and prep waste", () => {
    assert.equal(parseReading({ metric: "goshala_milk", period: "2026-09", value: 12 }).ok, false);
    const milked = parseReading({ metric: "goshala_care", period: "2026-09", value: 2, note: "Morning milking" });
    assert.equal(milked.ok, false);
    if (milked.ok) return;
    assert.match(milked.error, /never milked/);
    const plate = parseReading({ metric: "waste_plate", period: "2026-09", value: 4.2, note: "Example plate waste" });
    const prep = parseReading({ metric: "waste_prep", period: "2026-09", value: 6 });
    assert.equal(plate.ok, true);
    assert.equal(prep.ok, true);
    assert.equal(parseReading({ metric: "sourcing_local", period: "2026-09", value: 140 }).ok, false);
  });

  it("imports a CSV, compares a month with the baseline, and labels the carbon estimate", () => {
    const imported = parseCsv("period,metric,value,note\n2026-09,waste_diverted,9,Example compost\n2026-09,goshala_feed,4,milk yield\n2026-08,energy_kwh,1000,Example\n");
    assert.equal(imported.rows.length, 2);
    assert.equal(imported.errors.length, 1);
    assert.match(imported.errors[0], /never milked/);
    const trend = seriesAgainstBaseline([{ period: "2026-08", value: 1000 }, { period: "2026-09", value: 1100 }], 1000);
    assert.equal(trend[1].delta, 100);
    assert.equal(trend[0].baseline, 1000);
    const carbon = carbonEstimate("energy_kwh", 1000);
    assert.ok(carbon);
    assert.equal(carbon?.label, "Estimate");
    assert.match(carbon?.factorText ?? "", /0\.20705/);
    assert.match(carbon?.source ?? "", /UK government GHG conversion factors/);
    const csv = reportCsv([{ period: "2026-09", metric: "energy_kwh", label: "Electricity", unit: "kWh", value: 1000, baseline: 900, note: "Example" }]);
    assert.match(csv, /Estimate/);
    assert.match(csv, /UK government GHG conversion factors/);
    const pdf = renderReportPdf(["Estimate: 207.05 kg CO2e", "The cows are never milked."]);
    assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-");
  });
});
