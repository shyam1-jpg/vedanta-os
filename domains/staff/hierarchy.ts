/** Reporting lines for the house. Departments stay on the department table.
 *  Sub-sections use department_section, the same shape as the rota and SOP branch.
 */

export const ORG_LEVELS = ["gm", "head", "lead", "staff"] as const;
export type OrgLevel = (typeof ORG_LEVELS)[number];
export type TrainingMark = "cleared" | "not_cleared" | "none";
export type StaffContact = "work" | "none";

export const LEVEL_LABEL: Record<OrgLevel, string> = {
  gm: "General manager",
  head: "Department head",
  lead: "Team lead",
  staff: "Staff",
};

const LEVEL_RANK: Record<OrgLevel, number> = { gm: 0, head: 1, lead: 2, staff: 3 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type OrgSeat = {
  id: string;
  title: string;
  department: string;
  departmentName: string;
  level: OrgLevel;
  holderId: string | null;
  holderName: string | null;
  managerId: string | null;
  dottedIds: string[];
  training: TrainingMark;
  email: string | null;
  personalPhone: string | null;
  workPhone: string | null;
};

export type OrgViewer = {
  userId: string | null;
  role: string;
  positionIds: string[];
};

export type VisibleContact = { email: string | null; phone: string | null; workPhone: string | null };

export type TreeNode = {
  id: string;
  name: string;
  vacant: boolean;
  title: string;
  department: string;
  departmentName: string;
  level: OrgLevel;
  levelLabel: string;
  reports: number;
  training: TrainingMark;
  trainingLabel: string;
  children: TreeNode[];
};

export type ReassignInput = {
  positionId: string;
  managerId?: string | null;
  department?: string;
  level?: OrgLevel;
  title?: string;
  dottedIds?: string[];
  effectiveOn: string;
};

export function parseOrgSettings(raw: unknown): { allowMultipleGm: boolean; staffContact: StaffContact } {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    allowMultipleGm: src.allow_multiple_gm === true,
    staffContact: src.staff_contact === "none" ? "none" : "work",
  };
}

export function canEditOrg(role: string, permissions: Iterable<string> = []): boolean {
  if (role === "SYSTEM_OWNER" || role === "GENERAL_MANAGER") return true;
  return [...permissions].includes("org.manage");
}

export function levelOk(value: unknown): value is OrgLevel {
  return ORG_LEVELS.includes(value as OrgLevel);
}

export function trainingStatus(assigned: number, cleared: boolean): TrainingMark {
  if (assigned <= 0) return "none";
  return cleared ? "cleared" : "not_cleared";
}

export function trainingLabel(mark: TrainingMark): string {
  if (mark === "cleared") return "Cleared for unsupervised work";
  if (mark === "not_cleared") return "Not cleared";
  return "No training record";
}

export function weekRange(today: string, offsetWeeks = 0): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (day === 0 ? -6 : 1 - day) + offsetWeeks * 7);
  const from = dt.toISOString().slice(0, 10);
  dt.setUTCDate(dt.getUTCDate() + 6);
  return { from, to: dt.toISOString().slice(0, 10) };
}

function byId(seats: OrgSeat[]): Map<string, OrgSeat> {
  return new Map(seats.map(seat => [seat.id, seat]));
}

/** Primary and dotted lines together. A cycle means someone reports, even with a dotted line, back to themselves. */
export function structureCycle(seats: { id: string; managerId: string | null; dottedIds: string[] }[]): boolean {
  const map = new Map(seats.map(seat => [seat.id, seat]));
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(id, 1);
    const seat = map.get(id);
    const next = seat ? [seat.managerId, ...seat.dottedIds].filter((id): id is string => !!id) : [];
    for (const parent of next) {
      if (!map.has(parent)) continue;
      if (visit(parent)) return true;
    }
    color.set(id, 2);
    return false;
  };
  return seats.some(seat => visit(seat.id));
}

function clone(seats: OrgSeat[]): OrgSeat[] {
  return seats.map(seat => ({ ...seat, dottedIds: [...seat.dottedIds] }));
}

export function reassign(
  seats: OrgSeat[],
  change: ReassignInput,
  opts: { allowMultipleGm: boolean },
): { ok: true; seats: OrgSeat[] } | { ok: false; error: string } {
  if (!DATE.test(change.effectiveOn)) return { ok: false, error: "Choose the date this change takes effect" };
  const next = clone(seats);
  const seat = next.find(item => item.id === change.positionId);
  if (!seat) return { ok: false, error: "That position is not on the tree" };
  if (change.managerId !== undefined) {
    if (change.managerId && !next.some(item => item.id === change.managerId)) return { ok: false, error: "Choose a manager who is on the tree" };
    seat.managerId = change.managerId;
  }
  if (change.department !== undefined) {
    const code = change.department.trim();
    if (!code) return { ok: false, error: "Choose a department" };
    seat.department = code;
  }
  if (change.level !== undefined) {
    if (!levelOk(change.level)) return { ok: false, error: "Choose a level" };
    seat.level = change.level;
  }
  if (change.title !== undefined) {
    const title = change.title.trim();
    if (title.length < 2) return { ok: false, error: "Give the position a title" };
    seat.title = title.slice(0, 80);
  }
  if (change.dottedIds !== undefined) {
    const dotted = [...new Set(change.dottedIds.filter(id => id && id !== seat.id))];
    if (dotted.some(id => !next.some(item => item.id === id))) return { ok: false, error: "A dotted line has to point at someone on the tree" };
    seat.dottedIds = dotted;
  }
  const managers = next.filter(item => item.level === "gm");
  if (!opts.allowMultipleGm && managers.length > 1) return { ok: false, error: "The house has one general manager at the top" };
  if (!opts.allowMultipleGm && seat.level === "gm" && seat.managerId) return { ok: false, error: "The general manager sits at the top" };
  if (structureCycle(next)) return { ok: false, error: "That reporting line would go in a circle" };
  return { ok: true, seats: next };
}

/** Move someone into a department. A head keeps the general manager. Everyone else reports to that department's head. */
export function dropOnDepartment(seats: OrgSeat[], positionId: string, department: string, effectiveOn: string, allowMultipleGm: boolean) {
  const seat = seats.find(item => item.id === positionId);
  if (!seat) return { ok: false as const, error: "That position is not on the tree" };
  const head = seats.find(item => item.department === department && item.level === "head" && item.id !== positionId);
  const gm = seats.find(item => item.level === "gm" && item.id !== positionId);
  const managerId = seat.level === "gm" ? null : seat.level === "head" ? (gm?.id ?? null) : (head?.id ?? gm?.id ?? null);
  return reassign(seats, { positionId, department, managerId, effectiveOn }, { allowMultipleGm });
}

export type OrgSnapshot = {
  title: string;
  department: string;
  level: OrgLevel;
  managerId: string | null;
  dottedIds: string[];
  active: boolean;
};

export function snapshot(seat: OrgSeat, active = true): OrgSnapshot {
  return { title: seat.title, department: seat.department, level: seat.level, managerId: seat.managerId, dottedIds: [...seat.dottedIds], active };
}

export function undoChange(seats: OrgSeat[], before: OrgSnapshot, positionId: string): { ok: true; seats: OrgSeat[] } | { ok: false; error: string } {
  const next = clone(seats);
  const seat = next.find(item => item.id === positionId);
  if (!seat) return { ok: false, error: "That position is not on the tree" };
  if (!before.active) return { ok: true, seats: next.filter(item => item.id !== positionId) };
  seat.title = before.title;
  seat.department = before.department;
  seat.level = before.level;
  seat.managerId = before.managerId;
  seat.dottedIds = [...before.dottedIds];
  if (structureCycle(next)) return { ok: false, error: "Undoing that change would go in a circle" };
  return { ok: true, seats: next };
}

function manages(positionIds: Set<string>, seat: OrgSeat, seats: OrgSeat[]): boolean {
  const map = byId(seats);
  const seen = new Set<string>();
  const queue = [seat.managerId, ...seat.dottedIds].filter((id): id is string => !!id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (positionIds.has(id)) return true;
    const parent = map.get(id);
    if (!parent) continue;
    if (parent.managerId) queue.push(parent.managerId);
    queue.push(...parent.dottedIds);
  }
  return false;
}

export function seesPersonalContact(viewer: OrgViewer, seat: OrgSeat, seats: OrgSeat[]): boolean {
  if (viewer.role === "SYSTEM_OWNER" || viewer.role === "GENERAL_MANAGER") return true;
  const mine = new Set(viewer.positionIds);
  const held = seats.filter(item => mine.has(item.id));
  if (held.some(item => item.level === "gm")) return true;
  if (held.some(item => item.level === "head" && item.department === seat.department)) return true;
  return manages(mine, seat, seats);
}

export function visibleContact(seat: OrgSeat, viewer: OrgViewer, seats: OrgSeat[], mode: StaffContact): VisibleContact {
  if (seesPersonalContact(viewer, seat, seats)) {
    return { email: seat.email, phone: seat.personalPhone, workPhone: seat.workPhone };
  }
  if (mode === "none") return { email: null, phone: null, workPhone: null };
  return { email: seat.email, phone: null, workPhone: seat.workPhone };
}

export function directReports(seats: OrgSeat[], positionId: string): number {
  return seats.filter(seat => seat.managerId === positionId).length;
}

export function departmentScope(code: string, departments: { code: string; parent: string | null }[]): string[] {
  const want = new Set<string>([code]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const dept of departments) {
      if (dept.parent && want.has(dept.parent) && !want.has(dept.code)) {
        want.add(dept.code);
        grew = true;
      }
    }
  }
  return [...want];
}

export function buildLadder(seats: OrgSeat[], department?: string | null, scope: string[] = []): TreeNode[] {
  const allowed = department ? new Set(scope.length ? scope : [department]) : null;
  const shown = allowed ? seats.filter(seat => allowed.has(seat.department)) : seats;
  const ids = new Set(shown.map(seat => seat.id));
  const childrenOf = new Map<string, OrgSeat[]>();
  const roots: OrgSeat[] = [];
  for (const seat of shown) {
    if (seat.managerId && ids.has(seat.managerId)) {
      const list = childrenOf.get(seat.managerId) ?? [];
      list.push(seat);
      childrenOf.set(seat.managerId, list);
    } else roots.push(seat);
  }
  const sortSeats = (list: OrgSeat[]) => list.slice().sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const node = (seat: OrgSeat): TreeNode => ({
    id: seat.id,
    name: seat.holderName || "Vacant",
    vacant: !seat.holderName,
    title: seat.title,
    department: seat.department,
    departmentName: seat.departmentName,
    level: seat.level,
    levelLabel: LEVEL_LABEL[seat.level],
    reports: directReports(shown, seat.id),
    training: seat.training,
    trainingLabel: trainingLabel(seat.training),
    children: sortSeats(childrenOf.get(seat.id) ?? []).map(node),
  });
  return sortSeats(roots).map(node);
}

export type ImportPerson = {
  email: string;
  name: string;
  role: string;
  department: string;
  section: string | null;
  level: OrgLevel;
  managerEmail: string | null;
  workPhone: string | null;
  personalPhone: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inferLevel(role: string): OrgLevel {
  const code = role.trim().toUpperCase();
  if (code === "GENERAL_MANAGER") return "gm";
  if (code === "SYSTEM_OWNER") return "head";
  if (/HEAD_|_MANAGER$|_SUPERVISOR$|^MAINTENANCE$/.test(code)) return "head";
  if (/SOUS|SENIOR|LEAD|_LEAD$/.test(code)) return "lead";
  return "staff";
}

export function parseOrgImport(raw: unknown): { ok: true; people: ImportPerson[] } | { ok: false; error: string } {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rows = Array.isArray(body.people) ? body.people : null;
  if (!rows) return { ok: false, error: "The file needs a people list" };
  const people: ImportPerson[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return { ok: false, error: "Each person needs a name and an email" };
    const item = row as Record<string, unknown>;
    const email = String(item.email ?? "").trim().toLowerCase();
    const name = String(item.name ?? "").trim();
    const role = String(item.role ?? "").trim().toUpperCase();
    const department = String(item.department ?? "").trim().toUpperCase();
    if (!EMAIL.test(email)) return { ok: false, error: "Each person needs an email address" };
    if (name.length < 2) return { ok: false, error: "Each person needs a name" };
    if (!department) return { ok: false, error: `${name} needs a department` };
    const level = levelOk(item.level) ? item.level : inferLevel(role || "STAFF");
    const manager = String(item.manager ?? item.managerEmail ?? "").trim().toLowerCase();
    people.push({
      email,
      name: name.slice(0, 80),
      role: role || "STAFF",
      department,
      section: item.section ? String(item.section).trim().toUpperCase() : null,
      level,
      managerEmail: manager && EMAIL.test(manager) ? manager : null,
      workPhone: item.work_phone ? String(item.work_phone).trim().slice(0, 40) : null,
      personalPhone: item.phone ? String(item.phone).trim().slice(0, 40) : null,
    });
  }
  return { ok: true, people };
}

export function placeholderContact(email: string): boolean {
  const lower = email.trim().toLowerCase();
  return lower.endsWith("@example.invalid") || lower.endsWith("@example.com");
}
