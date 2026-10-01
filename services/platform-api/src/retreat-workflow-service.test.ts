import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createWorkflow } from './retreat-workflow-service.ts';
import { workflowPreview, DEPARTMENT_PACK } from '../../../domains/retreat/readiness.ts';
import type { Actor } from './auth.ts';
const db=new PGlite();
const tenant='00000000-0000-4000-8000-000000000001',property='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',person='00000000-0000-4000-8000-000000000004',booking='00000000-0000-4000-8000-000000000005';
const actor:Actor={userId:person,tenantId:tenant,propertyId:property,email:'test@example.invalid',name:'Test manager',role:'GENERAL_MANAGER',roleName:'Manager',department:'MGMT',perms:new Set(['group.read','task.write','task.assign']),audience:'ADMIN'};
const drafts=()=>workflowPreview({expected_guests:30},'readiness',null);
before(async()=>{
 await db.exec(`CREATE TABLE tenant(id uuid primary key);CREATE TABLE property(id uuid primary key);CREATE TABLE app_user(id uuid primary key,status text);CREATE TABLE membership(user_id uuid,property_id uuid);CREATE TABLE permission(code text primary key,description text);
 CREATE TABLE booking_group(id uuid primary key,name text,version integer,status text,property_id uuid,arrival_date date,arrival_slot text,departure_date date,departure_slot text,expected_guests integer,expected_rooms integer,dietary_notes text,meals_from text,meals_to text);
 CREATE TABLE asset(id uuid primary key);CREATE TABLE ops_handover(id uuid primary key);CREATE TABLE guest_enquiry(id uuid primary key);
 CREATE TABLE audit_event(id uuid primary key default gen_random_uuid(),tenant_id uuid,property_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,action text,entity_version integer,reason text,payload jsonb);
 INSERT INTO tenant VALUES('${tenant}');INSERT INTO property VALUES('${property}'),('${other}');INSERT INTO app_user VALUES('${person}','ACTIVE');INSERT INTO membership VALUES('${person}','${property}');
 INSERT INTO booking_group VALUES('${booking}','Test retreat',1,'CONFIRMED','${property}','2026-10-10','PM','2026-10-12','AM',30,15,null,null,null);`);
 await db.exec(await readFile(new URL('../../../db/migrations/0019_ops_task_engine.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../../db/migrations/0039_retreat_workflows.sql',import.meta.url),'utf8'));
});
after(async()=>{await db.close();});
const create=(version:number,kind:'readiness'|'change'='readiness',input:unknown=drafts(),a=actor)=>db.transaction(c=>createWorkflow(c,a,booking,version,kind,input,'Reviewed test planning requirements'));
test('atomic pack writes tasks, source snapshot, task events and audit',async()=>{
 const result=await create(1);assert.equal(result.already_created,false);assert.equal(result.task_ids?.length,DEPARTMENT_PACK.length);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from ops_task')).rows[0].n,DEPARTMENT_PACK.length);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from ops_task_event')).rows[0].n,DEPARTMENT_PACK.length);
 const row=(await db.query<{snapshot:{expected_guests:number}}> ('select snapshot from retreat_workflow_run')).rows[0];assert.equal(row.snapshot.expected_guests,30);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from audit_event')).rows[0].n,1);
});
test('retry does not create duplicate records',async()=>{
 const result=await create(1);assert.equal(result.already_created,true);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from ops_task')).rows[0].n,DEPARTMENT_PACK.length);
});
test('stale source versions and wrong-property bookings are rejected',async()=>{
 await assert.rejects(()=>create(9),/booking changed/);
 await assert.rejects(()=>create(1,'readiness',drafts(),{...actor,propertyId:other}),/No such retreat/);
});
test('invalid owner rolls back without adding any task or review',async()=>{
 await db.exec(`update booking_group set version=2,expected_guests=20 where id='${booking}'`);
 const d=drafts();d[0].assigned_staff_id='00000000-0000-4000-8000-000000000099';
 await assert.rejects(()=>create(2,'change',d),/active staff member/);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from retreat_workflow_run')).rows[0].n,1);
});
test('change review snapshots the new booking and preserves previous task history',async()=>{
 const result=await create(2,'change');assert.equal(result.already_created,false);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from ops_task')).rows[0].n,DEPARTMENT_PACK.length*2);
 assert.equal((await db.query<{snapshot:{expected_guests:number}}>('select snapshot from retreat_workflow_run where source_version=2')).rows[0].snapshot.expected_guests,20);
});
test('database failure during task insert rolls back the entire pack',async()=>{
 await db.exec(`update booking_group set version=3 where id='${booking}';ALTER TABLE ops_task ADD CONSTRAINT test_fail_title CHECK(title <> 'REJECT THIS TITLE')`);
 const d=drafts();d[1].title='REJECT THIS TITLE';await assert.rejects(()=>create(3,'readiness',d));
 assert.equal((await db.query<{n:number}>('select count(*)::int n from retreat_workflow_run')).rows[0].n,2);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from ops_task')).rows[0].n,DEPARTMENT_PACK.length*2);
});
test('unconfirmed booking cannot create an operational pack',async()=>{
 await db.exec(`update booking_group set status='ENQUIRY' where id='${booking}'`);await assert.rejects(()=>create(3),/confirmed or in-house/);
});
