import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planOpenRota, placementIssues, type RotaSlot } from './smart-rota.ts';
import { dailyTimesheets, londonDate } from './timesheet.ts';
const slot = (id: string, date: string, start='09:00', end='17:00', userId: string | null=null, department='KITCHEN'): RotaSlot => ({id,date,start,end,userId,department,breakMinutes:0});
const people = [{id:'a',name:'A',departments:['KITCHEN','HK']},{id:'b',name:'B',departments:['KITCHEN']}];
describe('smart rota planning',()=>{
 it('does not double-book across departments or add an overnight overlap',()=>{
  assert.ok(placementIssues(slot('new','2026-10-20','01:00','06:00'),'a',[slot('old','2026-10-19','22:00','06:00','a','HK')],[],[]).includes('overlap'));
  const p=planOpenRota([slot('new','2026-10-19')],people,[slot('old','2026-10-19','09:00','17:00','a','HK')],[],[]);
  assert.equal(p.assignments[0].userId,'b');
 });
 it('respects leave, unavailable days and the next day of an overnight shift',()=>{
  const p=planOpenRota([slot('new','2026-10-19','22:00','06:00')],people,[],[{userId:'b',from:'2026-10-20',to:'2026-10-20'}],[{userId:'a',from:'2026-10-19',to:'2026-10-19'}]);
  assert.equal(p.assignments.length,0);assert.deepEqual(p.skipped[0].reasons.sort(),['availability','leave']);
 });
 it('checks the previous Sunday for rest but does not charge last week hours to this week',()=>{
  const existing=[slot('sun','2026-10-18','17:00','23:00','a')];
  assert.ok(placementIssues(slot('early','2026-10-19','07:00','15:00'),'a',existing,[],[]).includes('rest'));
  assert.deepEqual(placementIssues(slot('late','2026-10-19','10:00','18:00'),'a',existing,[],[]),[]);
 });
 it('separates the weekly cap when planning across two weeks',()=>{
  const existing=Array.from({length:6},(_,i)=>slot('x'+i,'2026-10-'+String(19+i),'07:00','15:00','a'));
  const p=planOpenRota([slot('blocked','2026-10-25','07:00','15:00'),slot('next','2026-10-26','07:00','15:00')],people.slice(0,1),existing,[],[]);
  assert.equal(p.assignments.length,1);assert.equal(p.assignments[0].shiftId,'next');assert.equal(p.skipped[0].reasons.includes('hours'),true);
 });
 it('assigns constrained departments first and keeps all assignments drafts for the caller',()=>{
  const p=planOpenRota([slot('k','2026-10-19'),slot('hk','2026-10-19','09:00','17:00',null,'HK')],people,[],[],[]);
  assert.equal(p.assignments.find(x=>x.shiftId==='hk')?.userId,'a');assert.equal(p.assignments.find(x=>x.shiftId==='k')?.userId,'b');
 });
});
const shift=(id:string,start='09:00',end='13:00')=>({id,user_id:'a',name:'A',department:'KITCHEN',date:'2026-07-01',start_time:start,end_time:end,break_minutes:0});
const punch=(id:string,start='2026-07-01T08:00:00Z',end:string|null='2026-07-01T12:00:00Z',approved=false)=>({id,user_id:'a',name:'A',department:'KITCHEN',clocked_in_at:start,clocked_out_at:end,break_minutes:0,approved_at:approved?'2026-07-02T00:00:00Z':null});
describe('daily timesheet reconciliation',()=>{
 it('counts two scheduled shifts and two clock records exactly once',()=>{
  const [r]=dailyTimesheets([shift('s1'),shift('s2','14:00','18:00')],[punch('p1'),punch('p2','2026-07-01T13:00:00Z','2026-07-01T17:00:00Z')]);
  assert.equal(r.scheduled_minutes,480);assert.equal(r.actual_minutes,480);assert.equal(r.punches.length,2);assert.equal(r.variance_minutes,0);
 });
 it('uses London dates in summer rather than UTC dates',()=>{
  assert.equal(londonDate('2026-06-30T23:30:00Z'),'2026-07-01');
  const [r]=dailyTimesheets([shift('s')],[punch('p','2026-06-30T23:30:00Z','2026-07-01T03:30:00Z')]);assert.equal(r.date,'2026-07-01');assert.equal(r.punches.length,1);
 });
 it('includes unscheduled work and separates approved minutes from open records',()=>{
  const [r]=dailyTimesheets([],[{...punch('p'),break_minutes:30,approved_at:'2026-07-02T00:00:00Z'}]);assert.equal(r.actual_minutes,210);assert.equal(r.approved_minutes,210);assert.ok(r.issues.includes('unscheduled'));
  const [open]=dailyTimesheets([shift('s')],[punch('p','2026-07-01T08:00:00Z',null)],Date.parse('2026-07-01T10:00:00Z'));assert.equal(open.still_in,true);assert.equal(open.approved,false);assert.equal(open.approved_minutes,0);
 });
 it('flags overlapping punch records for review',()=>{
  const [r]=dailyTimesheets([shift('s')],[punch('p1'),punch('p2','2026-07-01T10:00:00Z','2026-07-01T14:00:00Z')]);assert.ok(r.issues.includes('overlapping_punches'));
 });
 it('keeps minute precision when several short shifts are added',()=>{
  const [r]=dailyTimesheets([shift('s1','09:00','09:20'),shift('s2','10:00','10:20'),shift('s3','11:00','11:20')],[]);assert.equal(r.scheduled_minutes,60);
 });
});

testPosition();
function testPosition(){it('leaves role-specific shifts open unless a staff designation matches',()=>{
 const proposed={...slot('role','2026-10-19'),position:'Chef'};
 const r=planOpenRota([proposed],[{id:'a',name:'A',departments:['KITCHEN'],positions:['Kitchen porter']}],[],[],[]);assert.equal(r.assignments.length,0);assert.deepEqual(r.skipped[0].reasons,['no_matching_position']);
 const good=planOpenRota([proposed],[{id:'b',name:'B',departments:['KITCHEN'],positions:['Chef']}],[],[],[]);assert.equal(good.assignments[0].userId,'b');
})}
