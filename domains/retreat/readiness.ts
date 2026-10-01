/** Shared retreat planning rules. No inferred bookings, capacity or allergy clearance. */
export const SNAPSHOT_FIELDS = ['arrival', 'arrival_slot', 'departure', 'departure_slot', 'expected_guests', 'expected_rooms', 'dietary_notes', 'meals_from', 'meals_to', 'status'] as const;
export type Snapshot = Record<typeof SNAPSHOT_FIELDS[number], string | number | null>;
export function snapshot(group: Record<string, unknown>): Snapshot {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(k => [k, group[k] == null ? null : typeof group[k] === 'number' ? group[k] : String(group[k])])) as Snapshot;
}
export function changes(previous: Snapshot | null, current: Snapshot) {
  if (!previous) return [];
  return SNAPSHOT_FIELDS.filter(k => previous[k] !== current[k]).map(field => ({ field, before: previous[field], after: current[field] }));
}
export const DEPARTMENT_PACK = [
  { code: 'FRONT', title: 'Confirm arrivals and welcome arrangements', minutes: 30, notes: 'Review confirmed arrival timings and room allocations. Coordinate welcome arrangements and outstanding guest requests.' },
  { code: 'HK', title: 'Prepare and inspect retreat rooms', minutes: 30, notes: 'Review room allocations and arrival times. Follow the approved turnover SOP and obtain inspection sign-off. Report room defects.' },
  { code: 'KITCHEN', title: 'Confirm meal covers and dietary preparation', minutes: 30, notes: 'Review meal counts by service using the kitchen covers screen. Check guest dietary declarations, recipes and supplier labels. Vegetarian; no eggs, onion, garlic, leeks, spring onions or chives. Confirm Jain/Ekadashi requests when applicable. Manager review is required for allergen decisions.' },
  { code: 'RESTAURANT', title: 'Prepare dining service and buffet labels', minutes: 25, notes: 'Agree confirmed covers and service timings with kitchen. Check dietary service instructions, buffet labels, setup, replenishment and closing responsibilities.' },
  { code: 'MAINT', title: 'Review room and equipment restrictions', minutes: 20, notes: 'Review open defects, service visits and operating restrictions affecting this retreat. Follow authorised procedures; a task completion does not certify equipment as safe.' },
  { code: 'GROUNDS', title: 'Check guest routes and outdoor areas', minutes: 25, notes: 'Review guest routes, access and planned outdoor activities. Record weather-related hazards, restrictions and required grounds work.' },
  { code: 'NIGHT', title: 'Confirm night cover and late arrivals', minutes: 20, notes: 'Confirm competent night cover, late arrivals, access arrangements and handover. Review approved emergency contacts and procedures.' },
  { code: 'MGMT', title: 'Review staffing and supplier requirements', minutes: 30, notes: 'Compare planned work with confirmed shifts and stock. Review proposed rota or order changes. Estimates in this pack are starter values, not a staffing capacity calculation.' },
] as const;
export type WorkflowDraft = { department: string; title: string; notes: string; expected_minutes: number; assigned_staff_id: string | null; due_at: string | null };
export function workflowPreview(group: Record<string, unknown>, kind: 'readiness' | 'change', previous: Snapshot | null): WorkflowDraft[] {
  const delta = changes(previous, snapshot(group));
  const context = kind === 'change' ? 'Review booking changes: ' + delta.map(d => `${d.field}: ${d.before ?? 'not recorded'} → ${d.after ?? 'not recorded'}`).join('; ') : 'Retreat readiness review';
  return DEPARTMENT_PACK.map(d => ({ department: d.code, title: `${kind === 'change' ? 'Change review: ' : ''}${d.title}`, notes: `${context}\n${d.notes}`, expected_minutes: d.minutes, assigned_staff_id: null, due_at: null }));
}
export function validatedDrafts(input: unknown): WorkflowDraft[] {
  if (!Array.isArray(input) || input.length !== DEPARTMENT_PACK.length) throw new Error('Review all eight department tasks.');
  const seen = new Set<string>();
  return input.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid department task.');
    const d = raw as Record<string, unknown>;
    const department = String(d.department ?? '');
    if (!DEPARTMENT_PACK.some(x => x.code === department) || seen.has(department)) throw new Error('Each department must appear once.');
    seen.add(department);
    const title = String(d.title ?? '').trim(), notes = String(d.notes ?? '').trim();
    const minutes = Number(d.expected_minutes);
    if (!title || title.length > 200 || notes.length > 8000 || !Number.isInteger(minutes) || minutes < 0 || minutes > 20000) throw new Error('Check task title, notes and estimated minutes.');
    const owner = d.assigned_staff_id ? String(d.assigned_staff_id) : null;
    if (owner && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)) throw new Error('Invalid task owner.');
    const date = d.due_at ? new Date(String(d.due_at)) : null;
    if (date && !Number.isFinite(date.getTime())) throw new Error('Invalid deadline.');
    return { department, title, notes, expected_minutes: minutes, assigned_staff_id: owner, due_at: date?.toISOString() ?? null };
  });
}
export function readinessState(tasks: { status: string; severity: string; overdue?: boolean }[], rooms: { status: string }[], allocated: number, wanted: number | null, stale: boolean) {
  const active = tasks.filter(t => t.status !== 'cancelled');
  const missingDepartments = DEPARTMENT_PACK.filter(d => !(tasks as { status: string; severity: string; department?: string }[]).some(t => t.department === d.code && t.status !== 'cancelled')).map(d => d.code);
  const blockers = active.filter(t => ['blocked', 'waiting'].includes(t.status) || (t.severity === 'critical' && t.status !== 'verified')).length;
  const allVerified = active.length > 0 && active.every(t => t.status === 'verified') && !missingDepartments.length;
  const roomsInspected = rooms.length > 0 && rooms.every(r => r.status === 'INSPECTED');
  const allocationKnown = wanted != null && allocated >= wanted;
  const state = stale ? 'Plan changed — review required' : blockers ? 'Needs attention' : allVerified && allocationKnown && (wanted === 0 || roomsInspected) ? 'Recorded checks verified' : 'Preparation outstanding';
  return { state, blockers, missing_departments: missingDepartments, verified: active.filter(t => t.status === 'verified').length, active: active.length, rooms_inspected: rooms.filter(r => r.status === 'INSPECTED').length, rooms_total: rooms.length, allocation_known: allocationKnown };
}
