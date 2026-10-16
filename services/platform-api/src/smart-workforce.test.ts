import {before,after,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {pool} from './db.ts';
import workforce from './workforce-desk.ts';
const db=new PGlite(),app=Fastify();
const [tenant,property,other,actor,person,second,department]=Array.from({length:7},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
let permissions=['group.read','content.publish'];
const headers={authorization:'Bearer test-token'};
before(async()=>{
 await db.exec(`create table app_user(id uuid primary key,display_name text,status text);create table session(token text,user_id uuid,audience text,expires_at timestamptz);
 create table department(id uuid,code text);create table membership(user_id uuid,property_id uuid,department_id uuid);
 create table staff_hr(user_id uuid,property_id uuid,designation text);
 create table staff_department(user_id uuid,property_id uuid,department text);
 create table rota_shift(id uuid primary key default gen_random_uuid(),tenant_id uuid,property_id uuid,user_id uuid,department text,position text,shift_type text,shift_date date,start_time time,end_time time,break_minutes int default 30,notes text,published boolean default false,status text default 'scheduled',created_by uuid);
 create table staff_availability(user_id uuid,property_id uuid,on_date date,available boolean);
 create table absence_request(user_id uuid,property_id uuid,from_date date,to_date date,status text);
 create table staff_leave(user_id uuid,property_id uuid,starts_on date,ends_on date,status text);
 create table staff_clock(id uuid primary key default gen_random_uuid(),tenant_id uuid,property_id uuid,user_id uuid,kind text,at timestamptz default now());
 create table audit_event(id bigserial primary key,tenant_id uuid,property_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,action text,from_state text,to_state text,reason text,entity_version int,payload jsonb);
 create table clock_record(id uuid primary key default gen_random_uuid(),tenant_id uuid,property_id uuid,user_id uuid,clocked_in_at timestamptz,clocked_out_at timestamptz,break_minutes int default 0,approved_at timestamptz,approved_by uuid);
 insert into app_user values('${actor}','Head chef','ACTIVE'),('${person}','Chef A','ACTIVE'),('${second}','Chef B','ACTIVE');
 insert into session values('test-token','${actor}','ADMIN',now()+interval '1 hour');
 insert into department values('${department}','KITCHEN');insert into membership values('${person}','${property}','${department}'),('${second}','${property}','${department}');
 insert into staff_department values('${person}','${property}','KITCHEN'),('${second}','${property}','KITCHEN');`);
 const query=async(sql:string,values:any[]=[])=>{
  if(sql.includes('from app_user u join membership'))return {rows:[{user_id:actor,tenant_id:tenant,property_id:property,email:'test@example.invalid',display_name:'Head chef',role:'HEAD_CHEF',role_name:'Head chef',department:'KITCHEN',perms:permissions}],rowCount:1};
  const r=await db.query(sql,values);return {...r,rowCount:r.rows.length||r.affectedRows||0};
 };
 mock.method(pool,'query',query);mock.method(pool,'connect',async()=>({query,release(){}}));
 await app.register(workforce);await app.ready();
});
beforeEach(async()=>{permissions=['group.read','content.publish'];await db.exec('delete from rota_shift;delete from clock_record;delete from staff_clock;delete from audit_event;delete from staff_availability;delete from absence_request;delete from staff_leave;');});
after(async()=>{await app.close();await db.close();});
const request=(url:string,payload:any)=>app.inject({method:'POST',url,headers,payload});
async function draft(user_id:string|null=null,options:Record<string,unknown>={}){return request('/v1/workforce-desk/shifts',{department:'KITCHEN',date:'2026-10-19',start_time:'09:00',end_time:'17:00',break_minutes:0,user_id,...options});}
test('preview is read-only; reviewed application stays draft; replay is rejected',async()=>{
 const d=await draft();assert.equal(d.statusCode,201,d.body);
 const preview=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'KITCHEN',preview:true});assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().assignments.length,1);
 assert.equal((await db.query<{user_id:string|null}>('select user_id from rota_shift')).rows[0].user_id,null);
 const apply=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'KITCHEN',preview_token:preview.json().preview_token});assert.equal(apply.statusCode,200,apply.body);
 const row=(await db.query<{user_id:string;published:boolean}>('select user_id,published from rota_shift')).rows[0];assert.ok(row.user_id);assert.equal(row.published,false);
 const replay=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'KITCHEN',preview_token:preview.json().preview_token});assert.equal(replay.statusCode,409);
});
test('a change in leave invalidates the preview and HOD cannot suggest another department',async()=>{
 await draft();const p=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'KITCHEN',preview:true});
 await db.exec(`insert into absence_request values('${person}','${property}','2026-10-19','2026-10-19','approved')`);
 const result=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'KITCHEN',preview_token:p.json().preview_token});assert.equal(result.statusCode,409,result.body);
 permissions=['group.read','leave.approve_hod'];const denied=await request('/v1/workforce-desk/shifts/suggest',{from:'2026-10-19',to:'2026-10-25',department:'HK',preview:true});assert.equal(denied.statusCode,403);
});
test('assigned shift creation checks overlaps and preserves a zero-minute break',async()=>{
 const first=await draft(person);assert.equal(first.statusCode,201,first.body);
 assert.equal((await db.query<{break_minutes:number}>('select break_minutes from rota_shift')).rows[0].break_minutes,0);
 const overlap=await draft(person,{start_time:'16:00',end_time:'20:00'});assert.equal(overlap.statusCode,409,overlap.body);
 const invalid=await draft(person,{start_time:'29:00'});assert.equal(invalid.statusCode,422);
});
test('timesheets include multiple and unscheduled punches without reusing one per shift',async()=>{
 await draft(person,{start_time:'09:00',end_time:'13:00',published:true});await draft(person,{start_time:'14:00',end_time:'18:00',published:true});
 await db.exec(`insert into clock_record(property_id,user_id,clocked_in_at,clocked_out_at) values('${property}','${person}','2026-10-19T08:00:00Z','2026-10-19T12:00:00Z'),('${property}','${person}','2026-10-19T13:00:00Z','2026-10-19T17:00:00Z'),('${property}','${second}','2026-10-19T08:00:00Z','2026-10-19T09:00:00Z'),('${other}','${second}','2026-10-19T08:00:00Z','2026-10-19T10:00:00Z');`);
 const r=await app.inject({url:'/v1/workforce-desk/timesheets?from=2026-10-19&to=2026-10-25',headers});assert.equal(r.statusCode,200,r.body);const rows=r.json().lines;assert.equal(rows.length,2);const a=rows.find((x:any)=>x.user_id===person);assert.equal(a.actual_minutes,480);assert.equal(a.scheduled_minutes,480);assert.equal(a.punches.length,2);assert.equal(rows.find((x:any)=>x.user_id===second).actual_minutes,60);
});
test('open and overlapping punch records cannot be approved',async()=>{
 const rows=await db.query<{id:string}>(`insert into clock_record(property_id,user_id,clocked_in_at,clocked_out_at) values($1,$2,'2026-10-19T08:00:00Z',null) returning id`,[property,person]);
 const open=await request(`/v1/workforce-desk/timesheets/${rows.rows[0].id}/approve`,{});assert.equal(open.statusCode,409,open.body);
 await db.exec(`update clock_record set clocked_out_at='2026-10-19T12:00:00Z';insert into clock_record(property_id,user_id,clocked_in_at,clocked_out_at) values('${property}','${person}','2026-10-19T09:00:00Z','2026-10-19T10:00:00Z')`);
 const overlap=await request(`/v1/workforce-desk/timesheets/${rows.rows[0].id}/approve`,{});assert.equal(overlap.statusCode,409,overlap.body);
});

test('phone clock helper writes an auditable timesheet pair and rejects duplicate punches',async()=>{
 const {recordWorkClock,WorkClockError}=await import('./work-clock.ts');
 const a={userId:person,tenantId:tenant,propertyId:property,email:'test@example.invalid',name:'Chef A',role:'CHEF',roleName:'Chef',department:'KITCHEN',perms:new Set(['clock.self']),audience:'STAFF' as const};
 const first=await recordWorkClock(a,'IN');assert.equal(first.event.kind,'IN');assert.ok(first.record.clocked_in_at);
 await assert.rejects(()=>recordWorkClock(a,'IN'),WorkClockError);
 const out=await recordWorkClock(a,'OUT');assert.equal(out.record.id,first.record.id);assert.ok(out.record.clocked_out_at);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from clock_record')).rows[0].n,1);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from audit_event')).rows[0].n,2);
});
test('legacy phone work is visible but never duplicates a linked timesheet clock',async()=>{
 await db.exec(`insert into staff_clock(tenant_id,property_id,user_id,kind,at) values('${tenant}','${property}','${person}','IN','2026-10-19T08:00:00Z'),('${tenant}','${property}','${person}','OUT','2026-10-19T12:00:00Z')`);
 let r=await app.inject({url:'/v1/workforce-desk/timesheets?from=2026-10-19&to=2026-10-25',headers});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().lines[0].actual_minutes,240);assert.equal(r.json().lines[0].punches[0].can_approve,false);assert.ok(r.json().lines[0].issues.includes('phone_history'));
 await db.exec(`insert into clock_record(tenant_id,property_id,user_id,clocked_in_at,clocked_out_at) values('${tenant}','${property}','${person}','2026-10-19T08:00:00Z','2026-10-19T12:00:00Z')`);
 r=await app.inject({url:'/v1/workforce-desk/timesheets?from=2026-10-19&to=2026-10-25',headers});assert.equal(r.json().lines[0].actual_minutes,240);assert.equal(r.json().lines[0].punches.length,1);
});
test('a completed record approval is audited and repeat approval is idempotent',async()=>{
 const row=(await db.query<{id:string}>(`insert into clock_record(property_id,user_id,clocked_in_at,clocked_out_at) values($1,$2,'2026-10-19T08:00:00Z','2026-10-19T12:00:00Z') returning id`,[property,person])).rows[0];
 const first=await request(`/v1/workforce-desk/timesheets/${row.id}/approve`,{});assert.equal(first.statusCode,200,first.body);
 const second=await request(`/v1/workforce-desk/timesheets/${row.id}/approve`,{});assert.equal(second.statusCode,200,second.body);
 assert.equal((await db.query<{n:number}>(`select count(*)::int n from audit_event where action='timesheet.approve'`)).rows[0].n,1);
});
test('cancelled shifts do not block a new placement through the weekly cap',async()=>{
 const id=(await draft(person)).json().id;
 await db.exec(`update rota_shift set status='cancelled';insert into rota_shift(property_id,user_id,department,shift_date,start_time,end_time,break_minutes,status) select '${property}','${person}','KITCHEN','2026-10-19'::date+n,'07:00','15:00',0,'cancelled' from generate_series(1,5) n`);
 const open=await draft(null,{date:'2026-10-25'});assert.equal(open.statusCode,201,open.body);
 const r=await request(`/v1/workforce-desk/shifts/${open.json().id}/place`,{user_id:person,date:'2026-10-25'});assert.equal(r.statusCode,200,r.body);
});
