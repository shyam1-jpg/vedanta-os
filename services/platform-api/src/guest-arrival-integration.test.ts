import {before,after,test,mock} from 'node:test';import assert from 'node:assert/strict';import Fastify from 'fastify';import{PGlite}from '@electric-sql/pglite';import{pool}from './db.ts';import guestPortal from './guestPortal.ts';
const db=new PGlite(),app=Fastify();
const ids=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const [property,tenant,guest,other,enquiry,foreign,booking,programme]=ids;
const headers={authorization:'Bearer guest-test-token'};
before(async()=>{
 await db.exec(`create table guest_account(id uuid,tenant_id uuid,property_id uuid,email text,display_name text,status text);
 create table guest_session(token text,guest_id uuid,expires_at timestamptz);
 create table guest_enquiry(id uuid,tenant_id uuid,property_id uuid,guest_id uuid,booking_id uuid,arrival_date date,departure_date date,status text,dietary_notes text,accessibility_notes text,arrival_time_note text,travel_notes text);
 create table programme(id uuid,group_id uuid,property_id uuid,status text,arrival date);
 create table programme_item(id uuid,programme_id uuid,day_offset integer,start_time time,end_time time,kind text,title text,location text);
 create table guest_needs_change(id uuid default gen_random_uuid(),tenant_id uuid,property_id uuid,enquiry_id uuid,changes jsonb,created_at timestamptz default now());
 insert into guest_account values('${guest}','${tenant}','${property}','guest@example.invalid','Test guest','ACTIVE');
 insert into guest_session values('guest-test-token','${guest}',now()+interval '1 hour');
 insert into guest_enquiry values('${enquiry}','${tenant}','${property}','${guest}','${booking}',current_date+1,current_date+3,'CONVERTED',null,null,null,null),('${foreign}','${tenant}','${property}','${other}','${booking}',current_date+1,current_date+3,'CONVERTED',null,null,null,null);
 insert into programme values('${programme}','${booking}','${property}','published',current_date+1);
 insert into programme_item values(gen_random_uuid(),'${programme}',0,'17:00','18:00','session','Welcome session','Hall');`);
 const query=async(sql:string,values:any[])=>{const r=await db.query(sql,values);return{...r,rowCount:r.affectedRows??r.rows.length};};
 mock.method(pool,'query',query);mock.method(pool,'connect',async()=>({query,release(){}}));await app.register(guestPortal);await app.ready();
});
after(async()=>{await app.close();mock.restoreAll();await db.close();});
test('schedule requires guest authentication and ownership',async()=>{
 assert.equal((await app.inject({url:`/guest/enquiries/${enquiry}/schedule`})).statusCode,401);
 assert.equal((await app.inject({url:`/guest/enquiries/${foreign}/schedule`,headers})).statusCode,404);
 const res=await app.inject({url:`/guest/enquiries/${enquiry}/schedule`,headers});assert.equal(res.statusCode,200);assert.equal(res.json().items[0].title,'Welcome session');
});
test('unpublished schedules and unlinked enquiries do not disclose programme items',async()=>{
 await db.exec("update programme set status='draft'");assert.deepEqual((await app.inject({url:`/guest/enquiries/${enquiry}/schedule`,headers})).json().items,[]);
 await db.exec(`update programme set status='published';update guest_enquiry set booking_id=null where id='${enquiry}'`);assert.deepEqual((await app.inject({url:`/guest/enquiries/${enquiry}/schedule`,headers})).json().items,[]);
});
test('own dietary updates create a review record, identical retries do not',async()=>{
 const payload={dietary_notes:'Vegan meal requested',accessibility_notes:'',arrival_time_note:'16:00',travel_notes:''};
 const res=await app.inject({method:'PATCH',url:`/guest/enquiries/${enquiry}/needs`,headers,payload});assert.equal(res.statusCode,200);assert.equal(res.json().review_pending,true);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from guest_needs_change')).rows[0].n,1);
 const repeat=await app.inject({method:'PATCH',url:`/guest/enquiries/${enquiry}/needs`,headers,payload});assert.equal(repeat.statusCode,200);assert.equal(repeat.json().review_pending,false);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from guest_needs_change')).rows[0].n,1);
});
test('another guest cannot alter a stay or enqueue its dietary details',async()=>{
 const res=await app.inject({method:'PATCH',url:`/guest/enquiries/${foreign}/needs`,headers,payload:{dietary_notes:'changed',accessibility_notes:'',arrival_time_note:'',travel_notes:''}});assert.equal(res.statusCode,404);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from guest_needs_change')).rows[0].n,1);
});
test('queue failure rolls back the guest edit',async()=>{
 await db.exec("alter table guest_needs_change add constraint reject_test_change check(changes::text not like '%REJECT_UPDATE%')");
 const res=await app.inject({method:'PATCH',url:`/guest/enquiries/${enquiry}/needs`,headers,payload:{dietary_notes:'REJECT_UPDATE',accessibility_notes:'',arrival_time_note:'',travel_notes:''}});assert.equal(res.statusCode,500);
 assert.equal((await db.query<{dietary_notes:string}>(`select dietary_notes from guest_enquiry where id='${enquiry}'`)).rows[0].dietary_notes,'Vegan meal requested');
});
