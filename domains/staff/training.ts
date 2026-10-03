/** Staff training, one section per department the house already uses.
 *  Lessons are the live manual chapters. Nothing here invents a procedure. */

import { HOUSE_MANUALS, MANUAL_KIND_LABEL, type ManualKind } from "../ops/manual.ts";
import { OPS_DEPARTMENTS } from "../ops/board.ts";
import { HOUSE_DEPARTMENTS } from "./organogram.ts";

export type TrainingSource = {
  slug: string;
  department: string;
  kind: string;
  title: string;
  summary: string;
  status?: string;
  sort_order?: number;
};

export type TrainingItem = {
  slug: string;
  title: string;
  kind: string;
  kind_label: string;
  summary: string;
};

export type TrainingSection = {
  code: string;
  name: string;
  items: TrainingItem[];
  empty: string | null;
};

const OPS_CODES = new Set<string>(OPS_DEPARTMENTS.map(d => d.code));

/** Ops departments, with organogram departments the boards do not already name. */
export function trainingDepartments(): { code: string; name: string }[] {
  const rows: { code: string; name: string }[] = [];
  const wholeHouse = OPS_DEPARTMENTS.find(d => d.code === "HOUSE");
  if (wholeHouse) rows.push({ code: wholeHouse.code, name: wholeHouse.label });
  for (const dept of HOUSE_DEPARTMENTS) {
    rows.push({ code: dept.code, name: dept.name });
    if (dept.code === "FRONT") {
      const night = OPS_DEPARTMENTS.find(d => d.code === "NIGHT");
      if (night) rows.push({ code: night.code, name: night.label });
    }
  }
  for (const dept of OPS_DEPARTMENTS) {
    if (!rows.some(row => row.code === dept.code)) rows.push({ code: dept.code, name: dept.label });
  }
  return rows;
}

export function trainingEmptyMessage(name: string): string {
  return `Training for ${name} is not written yet.`;
}

export function staffTrainingSections(chapters: TrainingSource[] = HOUSE_MANUALS): TrainingSection[] {
  return trainingDepartments().map(dept => {
    const items = chapters
      .filter(ch => ch.department === dept.code && ch.status !== "withdrawn")
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title))
      .map(ch => ({
        slug: ch.slug,
        title: ch.title,
        kind: ch.kind,
        kind_label: MANUAL_KIND_LABEL[ch.kind as ManualKind] ?? ch.kind,
        summary: ch.summary,
      }));
    return {
      code: dept.code,
      name: dept.name,
      items,
      empty: items.length === 0 ? trainingEmptyMessage(dept.name) : null,
    };
  });
}

export function isKnownTrainingDepartment(code: string): boolean {
  return OPS_CODES.has(code) || HOUSE_DEPARTMENTS.some(d => d.code === code);
}
