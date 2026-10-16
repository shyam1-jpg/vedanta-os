import { tx } from './db.ts';
import type { Actor } from './auth.ts';
import { audit } from './groups.ts';
export class WorkClockError extends Error {}
/** One atomic write keeps the phone event register and manager timesheets in sync. */
export async function recordWorkClock(a: Actor, kind: 'IN' | 'OUT') {
 return tx(async db=>{
  await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,['clock:'+a.propertyId+':'+a.userId]);
  const open=(await db.query(`select id,clocked_in_at from clock_record where property_id=$1 and user_id=$2 and clocked_out_at is null for update`,[a.propertyId,a.userId])).rows;
  const last=(await db.query(`select kind,at from staff_clock where property_id=$1 and user_id=$2 order by at desc limit 1`,[a.propertyId,a.userId])).rows[0];
  if(open.length>1)throw new WorkClockError('More than one clock record is open. Ask a manager to check the records.');
  if(kind==='IN'&&(open.length||last?.kind==='IN'))throw new WorkClockError('You are already clocked in.');
  if(kind==='OUT'&&!open.length&&last?.kind!=='IN')throw new WorkClockError('Clock in first.');
  const event=(await db.query(`insert into staff_clock(tenant_id,property_id,user_id,kind) values($1,$2,$3,$4) returning id,kind,at`,[a.tenantId,a.propertyId,a.userId,kind])).rows[0];
  let record;
  if(kind==='IN')record=(await db.query(`insert into clock_record(tenant_id,property_id,user_id,clocked_in_at) values($1,$2,$3,$4) returning id,clocked_in_at,clocked_out_at`,[a.tenantId,a.propertyId,a.userId,event.at])).rows[0];
  else if(open.length)record=(await db.query(`update clock_record set clocked_out_at=$2 where id=$1 returning id,clocked_in_at,clocked_out_at`,[open[0].id,event.at])).rows[0];
  else record=(await db.query(`insert into clock_record(tenant_id,property_id,user_id,clocked_in_at,clocked_out_at) values($1,$2,$3,$4,$5) returning id,clocked_in_at,clocked_out_at`,[a.tenantId,a.propertyId,a.userId,last.at,event.at])).rows[0];
  await audit(db,a,'staff_clock',event.id,kind==='IN'?'clock.in':'clock.out',{payload:{clock_record_id:record.id}});
  return {event,record};
 });
}
