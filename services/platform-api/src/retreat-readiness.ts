import type { FastifyInstance } from 'fastify';
import { pool, tx } from './db.ts';
import { requireActor, allow, problem } from './auth.ts';
import { snapshot, changes, workflowPreview, readinessState } from '../../../domains/retreat/readiness.ts';
import { formatTask, parseUuid } from '../../../domains/ops/tasks.ts';
import { createWorkflow } from './retreat-workflow-service.ts';

export default async function readiness(f: FastifyInstance) {
  f.get('/v1/retreat-readiness/:id', async (req: any, reply) => {
    const a = await requireActor(req,reply,['ADMIN','STAFF']); if (!a || !allow(a,'group.read',reply)) return;
    if (!parseUuid(req.params.id)) return reply.code(422).send(problem(422,'validation','Invalid booking'));
    const g = (await pool.query(`select id,name,status,version,arrival_date::text arrival,arrival_slot,departure_date::text departure,departure_slot,expected_guests,expected_rooms,dietary_notes,meals_from,meals_to from booking_group where id=$1 and property_id=$2`, [req.params.id,a.propertyId])).rows[0];
    if (!g) return reply.code(404).send(problem(404,'not_found','No such retreat'));
    const [rooms, tasks, runs] = await Promise.all([
      pool.query(`select distinct r.id,r.number,r.status from room_occupancy o join room r on r.id=o.room_id where o.group_id=$1 and r.property_id=$2 order by r.number`,[g.id,a.propertyId]),
      pool.query(`select t.*,u.display_name assigned_name from ops_task t left join app_user u on u.id=t.assigned_staff_id where t.booking_id=$1 and t.property_id=$2 order by t.created_at`,[g.id,a.propertyId]),
      pool.query(`select r.id,r.source_version,r.kind,r.snapshot,r.review_note,r.created_at,u.display_name reviewer from retreat_workflow_run r join app_user u on u.id=r.created_by where r.booking_id=$1 and r.property_id=$2 order by r.source_version desc,r.created_at desc limit 20`,[g.id,a.propertyId]),
    ]);
    const baseline = runs.rows[0] ?? null;
    const delta = changes(baseline?.snapshot ?? null,snapshot(g));
    const formatted = tasks.rows.map(t => formatTask(t));
    const recordedReadiness = readinessState(formatted,rooms.rows,rooms.rows.length,g.expected_rooms,delta.length>0);
    if (!baseline) recordedReadiness.state = "No reviewed plan yet";
    return { booking:g, rooms:rooms.rows, tasks:formatted, runs:runs.rows, changes:delta, has_baseline:!!baseline,
      readiness:recordedReadiness,
      preview:workflowPreview(g,delta.length?'change':'readiness',baseline?.snapshot??null),
      can_create:(a.perms.has('task.assign') || a.perms.has('user.manage')) && a.perms.has('task.write') };
  });
  f.post('/v1/retreat-readiness/:id/workflows',async (req:any,reply) => {
    const a=await requireActor(req,reply); if(!a || !allow(a,'group.read',reply) || !allow(a,'task.write',reply))return;
    if(!a.perms.has('task.assign') && !a.perms.has('user.manage'))return reply.code(403).send(problem(403,'forbidden','A manager creates retreat workflow packs.'));
    const b=req.body??{};
    if(!parseUuid(req.params.id)||!Number.isInteger(b.source_version)||!['readiness','change'].includes(b.kind))return reply.code(422).send(problem(422,'validation','Booking, source version and workflow kind are required.'));
    return tx(c=>createWorkflow(c,a,req.params.id,b.source_version,b.kind,b.tasks,String(b.review_note??'')));
  });
}
