/** House sustainability figures for the kitchen and the goshala.
 *  The cows are cared for and are never milked. There is no dairy production.
 *  Carbon figures are estimates and always name the factor and its source.
 */

export const METRICS = [
  { code: "waste_plate", label: "Plate waste", unit: "kg" },
  { code: "waste_prep", label: "Prep waste", unit: "kg" },
  { code: "waste_diverted", label: "Waste composted", unit: "kg" },
  { code: "energy_kwh", label: "Electricity", unit: "kWh" },
  { code: "water_m3", label: "Water", unit: "m3" },
  { code: "sourcing_local", label: "Local sourcing", unit: "%" },
  { code: "sourcing_organic", label: "Organic sourcing", unit: "%" },
  { code: "seva_hours", label: "Seva hours", unit: "hours" },
  { code: "goshala_feed", label: "Goshala feed", unit: "kg" },
  { code: "goshala_bedding", label: "Goshala bedding", unit: "kg" },
  { code: "goshala_care", label: "Goshala care visits", unit: "visits" },
] as const;

export type MetricCode = (typeof METRICS)[number]["code"];

export type Reading = { metric: MetricCode; period: string; value: number; note: string };

export type SustainabilitySettings = { enabled: boolean; public: boolean };

/** Estimates only. Each row is the factor this house multiplies by, named so a report can show it. */
export const CARBON_FACTORS = [
  {
    metric: "energy_kwh" as const,
    activity: "UK grid electricity",
    per: "kWh",
    kgCo2e: 0.20705,
    factorText: "0.20705 kg CO2e per kWh",
    source: "UK government GHG conversion factors (DESNZ), UK electricity. Confirm the year on the published spreadsheet before a funder pack.",
  },
  {
    metric: "water_m3" as const,
    activity: "Water supply",
    per: "m3",
    kgCo2e: 0.149,
    factorText: "0.149 kg CO2e per cubic metre",
    source: "UK government GHG conversion factors (DESNZ), water supply. Confirm the year on the published spreadsheet before a funder pack.",
  },
] as const;

const MONTH = /^\d{4}-\d{2}$/;
const DAIRY = /\b(milk|milking|milked|dairy|lactation|yield|udder)\b/i;

export function metricOf(code: string) {
  return METRICS.find(row => row.code === code) ?? null;
}

export function parseSustainabilitySettings(raw: unknown): SustainabilitySettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { enabled: src.enabled === true, public: src.public === true };
}

export function parseReading(raw: unknown): { ok: true; reading: Reading } | { ok: false; error: string } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const metric = String(src.metric ?? "").trim();
  const known = metricOf(metric);
  if (!known) return { ok: false, error: "Choose a metric from the list" };
  const note = String(src.note ?? "").trim().slice(0, 240);
  if (DAIRY.test(metric) || (metric.startsWith("goshala") && DAIRY.test(note))) {
    return { ok: false, error: "The cows are never milked. There is no dairy production to record." };
  }
  const value = Number(src.value);
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: "Enter a number that is zero or more" };
  if (metric.startsWith("sourcing_") && value > 100) return { ok: false, error: "A share is between 0 and 100" };
  const period = String(src.period ?? "").trim().slice(0, 7);
  if (!MONTH.test(period)) return { ok: false, error: "Use a month, such as 2026-09" };
  return { ok: true, reading: { metric: known.code, period, value: Math.round(value * 1000) / 1000, note } };
}

export function parseCsv(text: string): { rows: Reading[]; errors: string[] } {
  const lines = String(text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ["The file is empty"] };
  const header = splitCsv(lines[0]).map(cell => cell.trim().toLowerCase());
  const periodAt = header.indexOf("period");
  const metricAt = header.indexOf("metric");
  const valueAt = header.indexOf("value");
  const noteAt = header.indexOf("note");
  if (periodAt < 0 || metricAt < 0 || valueAt < 0) return { rows: [], errors: ["Use columns period, metric, value, note"] };
  const rows: Reading[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = splitCsv(line);
    const parsed = parseReading({
      period: cells[periodAt] ?? "",
      metric: cells[metricAt] ?? "",
      value: cells[valueAt] ?? "",
      note: noteAt >= 0 ? cells[noteAt] ?? "" : "",
    });
    if (!parsed.ok) errors.push(`Row ${index + 2}: ${parsed.error}`);
    else rows.push(parsed.reading);
  });
  return { rows, errors };
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

export function seriesAgainstBaseline(points: { period: string; value: number }[], baseline: number | null) {
  return [...points].sort((a, b) => a.period.localeCompare(b.period)).map(point => ({
    period: point.period,
    value: point.value,
    baseline,
    delta: baseline == null ? null : Math.round((point.value - baseline) * 1000) / 1000,
  }));
}

export function carbonEstimate(metric: string, value: number) {
  const factor = CARBON_FACTORS.find(row => row.metric === metric);
  if (!factor) return null;
  return {
    label: "Estimate" as const,
    kgCo2e: Math.round(value * factor.kgCo2e * 1000) / 1000,
    factor: factor.kgCo2e,
    factorText: factor.factorText,
    source: factor.source,
    activity: factor.activity,
  };
}

export function publicSummary(input: { enabled: boolean; isPublic: boolean; period: string | null; totals: { metric: string; value: number }[] }) {
  if (!input.enabled || !input.isPublic) return { enabled: false as const };
  const pick = (code: string) => input.totals.find(row => row.metric === code)?.value ?? null;
  const energy = pick("energy_kwh");
  const water = pick("water_m3");
  return {
    enabled: true as const,
    period: input.period,
    waste_composted_kg: pick("waste_diverted"),
    plate_waste_kg: pick("waste_plate"),
    prep_waste_kg: pick("waste_prep"),
    seva_hours: pick("seva_hours"),
    local_share: pick("sourcing_local"),
    organic_share: pick("sourcing_organic"),
    goshala: "The cows are cared for and are never milked. The goshala does not produce milk.",
    carbon: [energy == null ? null : carbonEstimate("energy_kwh", energy), water == null ? null : carbonEstimate("water_m3", water)].filter(row => row != null),
  };
}

export type ReportLine = {
  period: string;
  metric: string;
  label: string;
  unit: string;
  value: number;
  baseline: number | null;
  note: string;
};

export function reportCsv(lines: ReportLine[]): string {
  const header = "period,metric,label,unit,value,baseline,carbon_kg,factor,source,label_carbon,note";
  const body = lines.map(line => {
    const carbon = carbonEstimate(line.metric, line.value);
    return [
      line.period,
      line.metric,
      csvCell(line.label),
      line.unit,
      String(line.value),
      line.baseline == null ? "" : String(line.baseline),
      carbon ? String(carbon.kgCo2e) : "",
      carbon ? csvCell(carbon.factorText) : "",
      carbon ? csvCell(carbon.source) : "",
      carbon ? "Estimate" : "",
      csvCell(line.note),
    ].join(",");
  });
  return [header, ...body].join("\n") + "\n";
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function reportLines(lines: ReportLine[]): string[] {
  const out = [
    "Sustainability report",
    "Example figures for the kitchen and the goshala.",
    "The cows are cared for and are never milked.",
    "Carbon figures are estimates.",
    "",
  ];
  for (const line of lines) {
    const base = line.baseline == null ? "" : ` Baseline ${line.baseline}.`;
    out.push(`${line.period} ${line.label}: ${line.value} ${line.unit}.${base}`);
    const carbon = carbonEstimate(line.metric, line.value);
    if (carbon) out.push(`Estimate: ${carbon.kgCo2e} kg CO2e. Factor ${carbon.factorText}. ${carbon.source}`);
  }
  return out;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function renderReportPdf(lines: string[]): Uint8Array {
  const commands = ["BT", "/F1 11 Tf", "40 800 Td", "14 TL"];
  for (const line of lines.slice(0, 48)) commands.push(`(${escapePdf(line.slice(0, 110))}) Tj`, "T*");
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  const chunks: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((obj, index) => {
    offsets[index + 1] = length;
    const bytes = new TextEncoder().encode(obj);
    chunks.push(bytes);
    length += bytes.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`;
  chunks.push(new TextEncoder().encode(xref));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
