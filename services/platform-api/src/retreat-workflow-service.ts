import { snapshot, validatedDrafts, type WorkflowDraft } from '../../../domains/retreat/readiness.ts';
import type { Actor } from './auth.ts';
type Query = { query: (sql: string, values?: any[]) => Promise<any> };
export class WorkflowError extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; } }
export async function createWorkflow(c: Query, a: Actor, bookingId: string, version: number, kind: 'readiness' | 'change', input: unknown, note: string) {
  const g = (await c.query(`select id, name, version, status, arrival_date::text arrival, arrival_slot, departure_date::text departure, departure_slot, expected_guests, expected_rooms, dietary_notes, meals_from, meals_to from booking_group where id=$1 and property_id=$2 for update`, [bookingId, a.propertyId])).rows[0];
  if (!g) throw new WorkflowError(404, 'not_found', 'No such retreat');
  const existing = (await c.query(`select id from retreat_workflow_run where property_id=$1 and booking_id=$2 and source_version=$3 and kind=$4`, [a.propertyId, bookingId, version, kind])).rows[0];
  if (existing) return { id: existing.id, already_created: true };
  if (g.version !== version) throw new WorkflowError(409, 'version_conflict', 'This booking changed. Reload and review the current plan.');
  if (!['CONFIRMED','IN_HOUSE'].includes(g.status)) throw new WorkflowError(409, 'not_confirmed', 'Workflow packs require a confirmed or in-house booking.');
  if (!note.trim() || note.length > 800) throw new WorkflowError(422, 'validation', 'Add a review note of up to 800 characters.');
  if (kind === 'change') {
    const previous = (await c.query(`select id from retreat_workflow_run where property_id=$1 and booking_id=$2 and source_version < $3 limit 1`, [a.propertyId, bookingId, version])).rows[0];
    if (!previous) throw new WorkflowError(409, 'no_baseline', 'Create the initial readiness pack before reviewing changes.');
  }
  let drafts: WorkflowDraft[];
  try { drafts = validatedDrafts(input); } catch (e) { throw new WorkflowError(422, 'validation', (e as Error).message); }
  for (const d of drafts) if (d.assigned_staff_id) {
    const owner = (await c.query(`select u.id from app_user u join membership m on m.user_id=u.id where u.id=$1 and m.property_id=$2 and u.status='ACTIVE' limit 1`, [d.assigned_staff_id, a.propertyId])).rows[0];
    if (!owner) throw new WorkflowError(422, 'invalid_owner', 'Choose an active staff member at this property.');
  }
  const run = (await c.query(`insert into retreat_workflow_run(tenant_id,property_id,booking_id,source_version,kind,snapshot,review_note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [a.tenantId, a.propertyId, bookingId, version, kind, snapshot(g), note.trim(), a.userId])).rows[0];
  const ids: string[] = [];
  for (const d of drafts) {
    const status = d.assigned_staff_id ? 'assigned' : 'new';
    const task = (await c.query(`insert into ops_task(tenant_id,property_id,booking_id,workflow_run_id,event_label,title,notes,department,priority,status,expected_minutes,assigned_staff_id,assigned_staff_ids,due_at,created_by,source) values($1,$2,$3,$4,$5,$6,$7,$8,'high',$9,$10,$11,$12,$13,$14,'retreat_workflow') returning id`, [a.tenantId, a.propertyId, bookingId, run.id, g.name, d.title, d.notes, d.department, status, d.expected_minutes, d.assigned_staff_id, d.assigned_staff_id ? [d.assigned_staff_id] : [], d.due_at, a.userId])).rows[0];
    ids.push(task.id);
    await c.query(`insert into ops_task_event(task_id,tenant_id,property_id,kind,actor_id,actor_name,to_status,body) values($1,$2,$3,'status',$4,$5,$6,$7)`, [task.id,a.tenantId,a.propertyId,a.userId,a.name,status,`Reviewed ${kind} pack for booking version ${version}: ${note.trim()}`]);
  }
  await c.query(`insert into audit_event(tenant_id,property_id,actor_user_id,entity_type,entity_id,action,entity_version,reason,payload) values($1,$2,$3,'booking_group',$4,'retreat.workflow.create',$5,$6,$7)`, [a.tenantId,a.propertyId,a.userId,bookingId,version,note.trim(),{ run_id: run.id, kind, task_ids: ids }]);
  return { id: run.id, already_created: false, task_ids: ids };
}
