import {before,after,beforeEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {pool} from './db.ts';
import arrivalRoutes from './guest-arrival.ts';
const db=new PGlite(),app=Fastify();
const ids=Array.from({length:12},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const [tenant,property,otherProperty,guest,otherGuest,enquiry,foreign,booking,otherBooking,staff,room,otherRoom]=ids;
const guestHeaders={authorization:'Bearer guest-token'},staffHeaders={authorization:'Bearer staff-token'};
let permissions=['group.read','group.update'];
before(async()=>{
  await db.exec(`create table tenant(id uuid primary key);create table property(id uuid primary key);
    create table app_user(id uuid primary key);create table session(token text,user_id uuid,audience text,expires_at timestamptz);
    create table guest_account(id uuid,tenant_id uuid,property_id uuid,email text,display_name text,status text);
    create table guest_session(token text,guest_id uuid,expires_at timestamptz);
    create table booking_group(id uuid,property_id uuid,name text,status text,expected_guests integer,arrival_date date,departure_date date,arrival_time time);
    create table guest_enquiry(id uuid primary key,tenant_id uuid,property_id uuid,guest_id uuid,booking_id uuid,name text,people integer,status text,arrival_date date,departure_date date,dietary_notes text,accessibility_notes text,arrival_time_note text,travel_notes text);
    create table room(id uuid,property_id uuid,number text,status text,staff_only boolean);
    create table room_occupancy(room_id uuid,group_id uuid,on_date date);
    insert into tenant values('${tenant}');insert into property values('${property}'),('${otherProperty}');insert into app_user values('${staff}');
    insert into session values('staff-token','${staff}','STAFF',now()+interval '1 hour');
    insert into guest_account values('${guest}','${tenant}','${property}','guest@example.invalid','Guest','ACTIVE'),('${otherGuest}','${tenant}','${otherProperty}','other@example.invalid','Other guest','ACTIVE');
    insert into guest_session values('guest-token','${guest}',now()+interval '1 hour');
    insert into booking_group values('${booking}','${property}','Current retreat','CONFIRMED',2,current_date,current_date+2,'16:00'),('${otherBooking}','${otherProperty}','PRIVATE OTHER HOUSE','CONFIRMED',3,current_date,current_date+2,'16:00');
    insert into guest_enquiry values('${enquiry}','${tenant}','${property}','${guest}','${booking}','Test guest',2,'CONVERTED',current_date,current_date+2,'PRIVATE DIET','PRIVATE ACCESS','16:00','PRIVATE TRAVEL'),('${foreign}','${tenant}','${otherProperty}','${otherGuest}','${otherBooking}','PRIVATE OTHER GUEST',3,'CONVERTED',current_date,current_date+2,null,null,null,null);
    insert into room values('${room}','${property}','101','VACANT_DIRTY',false),('${otherRoom}','${otherProperty}','PRIVATE ROOM','INSPECTED',false);
    insert into room_occupancy values('${room}','${booking}',current_date),('${otherRoom}','${otherBooking}',current_date);`);
  const migration=await readFile(new URL('../../../db/migrations/0043_guest_arrival_registration.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration); // migration is additive and repeat-safe
  const query=async(sql:string,values:any[]=[])=>{
    if(sql.includes('from app_user u join membership')) return {rows:[{user_id:staff,tenant_id:tenant,property_id:property,email:'staff@example.invalid',display_name:'Reception',role:'RECEPTION',role_name:'Reception',department:'FRONT',perms:permissions}],rowCount:1};
    const result=await db.query(sql,values);return {...result,rowCount:result.affectedRows??result.rows.length};
  };
  mock.method(pool,'query',query);mock.method(pool,'connect',async()=>({query,release(){}}));
  await app.register(arrivalRoutes);await app.ready();
});
beforeEach(async()=>{permissions=['group.read','group.update'];await db.exec(`delete from guest_arrival_registration;update booking_group set status='CONFIRMED';update guest_enquiry set status='CONVERTED',arrival_date=(timezone('Europe/London',now()))::date,departure_date=(timezone('Europe/London',now()))::date+2;`);});
after(async()=>{await app.close();mock.restoreAll();await db.close();});
const post=async(action:string,id=enquiry,extra={})=>{
  const current=await app.inject({url:`/guest/enquiries/${id}/arrival`,headers:guestHeaders});
  return app.inject({method:'POST',url:`/guest/enquiries/${id}/arrival`,headers:guestHeaders,payload:{action,confirmed:true,details_version:current.json().details_version,...extra}});
};
test('guest registration requires a guest session, rejects staff tokens and foreign stay IDs',async()=>{
  assert.equal((await app.inject({url:`/guest/enquiries/${enquiry}/arrival`})).statusCode,401);
  assert.equal((await app.inject({url:`/guest/enquiries/${enquiry}/arrival`,headers:staffHeaders})).statusCode,401);
  assert.equal((await post('confirm_details',foreign)).statusCode,404);
  assert.equal((await app.inject({url:`/guest/enquiries/${foreign}/arrival`,headers:guestHeaders})).statusCode,404);
});
test('requires explicit confirmation and a valid action',async()=>{
  assert.equal((await post('confirm_details',enquiry,{confirmed:false})).statusCode,422);
  assert.equal((await post('release_keys')).statusCode,422);
  assert.equal((await post('arrive','invalid')).statusCode,422);
});
test('unconfirmed booking and declined enquiry block confirmation',async()=>{
  await db.exec(`update booking_group set status='PROVISIONAL' where id='${booking}'`);assert.equal((await post('confirm_details')).statusCode,409);
  await db.exec(`update booking_group set status='CONFIRMED';update guest_enquiry set status='DECLINED' where id='${enquiry}'`);assert.equal((await post('confirm_details')).statusCode,409);
});
test('arrival requires review, retries preserve timestamps and never occupy a room',async()=>{
  assert.equal((await post('arrive')).statusCode,409);
  const review=await post('confirm_details');assert.equal(review.statusCode,200);assert.ok(review.json().details_confirmed_at);
  assert.equal((await post('confirm_details')).json().details_confirmed_at,review.json().details_confirmed_at);
  const first=await post('arrive');assert.equal(first.statusCode,200);assert.ok(first.json().arrived_at);
  assert.equal((await post('arrive')).json().arrived_at,first.json().arrived_at);
  assert.equal((await db.query(`select status from room where id='${room}'`)).rows[0].status,'VACANT_DIRTY');
  assert.equal((await db.query(`select status from booking_group where id='${booking}'`)).rows[0].status,'CONFIRMED');
  assert.equal((await db.query('select count(*)::int n from guest_arrival_registration')).rows[0].n,1);
});
test('changes to saved needs invalidate review and require confirmation again',async()=>{
  await post('confirm_details');await db.exec(`update guest_enquiry set arrival_time_note='18:00' where id='${enquiry}'`);
  const s=(await app.inject({url:`/guest/enquiries/${enquiry}/arrival`,headers:guestHeaders})).json();assert.equal(s.details_confirmed_at,null);assert.equal(s.can_arrive,false);
  assert.equal((await post('arrive')).statusCode,409);assert.equal((await post('confirm_details')).statusCode,200);
  assert.equal((await post('arrive')).statusCode,200);
});
test('rescheduled stay discards old arrival state and cannot report arrival early',async()=>{
  await post('confirm_details');await post('arrive');await db.exec(`update guest_enquiry set arrival_date=arrival_date+1,departure_date=departure_date+1 where id='${enquiry}'`);
  const reviewed=await post('confirm_details');assert.equal(reviewed.statusCode,200);assert.equal(reviewed.json().arrived_at,null);assert.equal((await post('arrive')).statusCode,409);
});
test('expired registrations cannot be changed',async()=>{
  await db.exec(`update guest_enquiry set arrival_date=arrival_date-5,departure_date=departure_date-4 where id='${enquiry}'`);
  assert.equal((await post('confirm_details')).statusCode,409);assert.equal((await post('arrive')).statusCode,409);
});
test('a stale review cannot confirm details changed in another session',async()=>{
  const old=(await app.inject({url:`/guest/enquiries/${enquiry}/arrival`,headers:guestHeaders})).json();
  await db.exec(`update guest_enquiry set arrival_time_note='21:00' where id='${enquiry}'`);
  assert.equal((await post('confirm_details',enquiry,{details_version:old.details_version})).statusCode,409);
  assert.equal((await post('confirm_details')).statusCode,200);
});
test('morning endpoint is private and requires reception permission',async()=>{
  assert.equal((await app.inject({url:'/v1/ops/morning'})).statusCode,401);
  assert.equal((await app.inject({url:'/v1/ops/morning',headers:guestHeaders})).statusCode,401);
  permissions=['cover.read'];assert.equal((await app.inject({url:'/v1/ops/morning',headers:staffHeaders})).statusCode,403);
});
test('morning board is property-scoped and excludes private needs',async()=>{
  await post('confirm_details');await post('arrive');
  const res=await app.inject({url:'/v1/ops/morning',headers:staffHeaders});assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'no-store');
  assert.equal(res.json().arrivals.length,1);assert.equal(res.json().guests.length,1);assert.equal(res.json().guests[0].rooms[0].number,'101');
  assert.ok(res.json().guests[0].arrived_at);assert.ok(!res.body.includes('PRIVATE'));assert.ok(!res.body.includes('details_hash'));
});
test('staff cannot acknowledge without write permission or before arrival',async()=>{
  const req={method:'POST' as const,url:`/v1/ops/arrivals/${enquiry}/acknowledge`,headers:staffHeaders,payload:{}};
  assert.equal((await app.inject(req)).statusCode,409);
  await post('confirm_details');await post('arrive');permissions=['group.read'];assert.equal((await app.inject(req)).statusCode,403);
});
test('reception acknowledgement is idempotent, visible to guest and not key release',async()=>{
  await post('confirm_details');await post('arrive');const req={method:'POST' as const,url:`/v1/ops/arrivals/${enquiry}/acknowledge`,headers:staffHeaders,payload:{}};
  assert.equal((await app.inject(req)).statusCode,200);
  const get=()=>app.inject({url:`/guest/enquiries/${enquiry}/arrival`,headers:guestHeaders});const seen=(await get()).json().reception_seen_at;assert.ok(seen);
  assert.equal((await app.inject(req)).statusCode,200);assert.equal((await get()).json().reception_seen_at,seen);
  assert.equal((await db.query(`select status from room where id='${room}'`)).rows[0].status,'VACANT_DIRTY');
  assert.equal((await app.inject({...req,url:`/v1/ops/arrivals/${foreign}/acknowledge`})).statusCode,409);
});
test('morning board does not show stale reviewed status after detail edits',async()=>{
  await post('confirm_details');await db.exec(`update guest_enquiry set travel_notes='changed' where id='${enquiry}'`);
  const res=await app.inject({url:'/v1/ops/morning',headers:staffHeaders});assert.equal(res.json().guests[0].details_confirmed_at,null);
});
