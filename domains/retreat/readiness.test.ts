import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, changes, workflowPreview, validatedDrafts, readinessState, DEPARTMENT_PACK } from './readiness.ts';
const group = { arrival: '2026-10-10', arrival_slot: 'PM', departure: '2026-10-12', departure_slot: 'AM', expected_guests: 30, expected_rooms: 15, dietary_notes: null, status: 'CONFIRMED' };
test('booking drift preserves old/new values and never invents unknown counts',()=>{
 const previous=snapshot(group);const current=snapshot({...group,expected_guests:20,dietary_notes:'Vegan option requested'});
 assert.deepEqual(changes(previous,current).map(c=>c.field),['expected_guests','dietary_notes']);
 assert.equal(changes(previous,current)[0].before,30);assert.equal(changes(previous,current)[0].after,20);
 assert.equal(snapshot({}).expected_guests,null);assert.deepEqual(changes(null,current),[]);
});
test('workflow preview includes each department and remains an editable draft',()=>{
 const drafts=workflowPreview(group,'readiness',null);assert.equal(drafts.length,DEPARTMENT_PACK.length);
 assert.ok(drafts.every(d=>!d.assigned_staff_id&&!d.due_at));assert.ok(drafts.find(d=>d.department==='KITCHEN')!.notes.includes('no eggs'));
 assert.deepEqual(validatedDrafts(drafts),drafts);
});
test('reject duplicate departments, missing tasks, invalid deadlines and bad estimates',()=>{
 const drafts=workflowPreview(group,'readiness',null);
 assert.throws(()=>validatedDrafts(drafts.slice(1)));
 assert.throws(()=>validatedDrafts(drafts.map((d,i)=>i===0?{...d,department:drafts[1].department}:d)));
 assert.throws(()=>validatedDrafts(drafts.map((d,i)=>i===0?{...d,due_at:'not-a-date'}:d)));
 assert.throws(()=>validatedDrafts(drafts.map((d,i)=>i===0?{...d,expected_minutes:-1}:d)));
});
test('readiness requires verification, current plan and inspected allocated rooms',()=>{
 const tasks=DEPARTMENT_PACK.map(d=>({department:d.code,status:'verified',severity:'none'}));const rooms=[{status:'INSPECTED'}];
 assert.equal(readinessState(tasks,rooms,1,1,false).state,'Recorded checks verified');
 assert.equal(readinessState(tasks,rooms,1,1,true).state,'Plan changed — review required');
 assert.equal(readinessState(tasks.map(t=>({...t,status:'completed'})),rooms,1,1,false).state,'Preparation outstanding');
 assert.equal(readinessState(tasks,[],0,null,false).state,'Preparation outstanding');
 assert.equal(readinessState(tasks.slice(1),rooms,1,1,false).state,'Preparation outstanding');
});
test('blocked and unverified critical work prevent a ready state',()=>{
 const tasks=DEPARTMENT_PACK.map(d=>({department:d.code,status:'verified',severity:'none'}));
 tasks[0]={...tasks[0],status:'blocked'};assert.equal(readinessState(tasks,[{status:'INSPECTED'}],1,1,false).state,'Needs attention');
 tasks[0]={...tasks[0],status:'completed',severity:'critical'};assert.equal(readinessState(tasks,[{status:'INSPECTED'}],1,1,false).blockers,1);
});
