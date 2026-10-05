import{before,after,test,mock}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';import Fastify from'fastify';import{pool}from'./db.ts';import planday from'./planday.ts';import{openToken}from'./planday-client.ts';
const db=new PGlite(),app=Fastify();const tenant='00000000-0000-4000-8000-000000000001',property='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003',user='00000000-0000-4000-8000-000000000004';const headers={authorization:'Bearer owner'};let failClock=false;const previousKey=process.env.PLANDAY_TOKEN_ENCRYPTION_KEY;
before(async()=>{
 process.env.PLANDAY_TOKEN_ENCRYPTION_KEY='b'.repeat(64);
 await db.exec(`create table tenant(id uuid primary key);create table property(id uuid primary key);create table app_user(id uuid primary key);insert into tenant values('${tenant}');insert into property values('${property}'),('${foreign}');insert into app_user values('${user}');`);
 await db.exec(await readFile(new URL('../../../db/migrations/0045_planday_readonly.sql',import.meta.url),'utf8'));
 const query=async(sql:string,values:any[]=[])=>{
  if(sql.includes('from session'))return{rows:[{user_id:values[0],audience:'ADMIN'}],rowCount:1};
  if(sql.includes('from app_user u join membership'))return{rows:[{user_id:user,tenant_id:tenant,property_id:values[0]==='foreign'?foreign:property,email:'qa@example.invalid',display_name:'QA',role:'FINANCE_HR',perms:values[0]==='denied'?['report.read']:['clock.manage','user.manage']}],rowCount:1};
  if(sql.includes('pg_try_advisory_lock'))return{rows:[{locked:true}],rowCount:1};if(sql.includes('pg_advisory_unlock'))return{rows:[{}],rowCount:1};
  const r=await db.query(sql,values);return{...r,rowCount:r.rows.length||r.affectedRows||0};
 };mock.method(pool,'query',query);mock.method(pool,'connect',async()=>({query,release(){}}));
 mock.method(globalThis,'fetch',async(url:any,init:any)=>{
  if(String(url)==='https://id.planday.com/connect/token')return new Response(JSON.stringify({access_token:'test-access',refresh_token:'rotated-test-token'}));
  assert.equal(init.method,undefined);const p=new URL(String(url)).pathname;assert.equal(new URL(String(url)).host,'openapi.planday.com');
  if(p.includes('punchclock')&&failClock)return new Response('NEVER_EXPOSE_UPSTREAM',{status:403});
  const row=p.includes('employees')?{id:1,firstName:'Test',lastName:'Staff',bankAccount:'PRIVATE',departments:[1]}:p.includes('departments')?{id:1,name:'Kitchen'}:{id:1,employeeId:1,departmentId:1,startDateTime:'2026-10-05T08:00',endDateTime:'2026-10-05T16:00',isApproved:true,status:'Approved'};
  return new Response(JSON.stringify({data:[row],paging:{total:1}}));
 });await app.register(planday);await app.ready();
});
after(async()=>{await app.close();mock.restoreAll();await db.close();if(previousKey===undefined)delete process.env.PLANDAY_TOKEN_ENCRYPTION_KEY;else process.env.PLANDAY_TOKEN_ENCRYPTION_KEY=previousKey;});
test('staff data needs clock.manage and authentication',async()=>{assert.equal((await app.inject({url:'/v1/planday'})).statusCode,401);assert.equal((await app.inject({url:'/v1/planday',headers:{authorization:'Bearer denied'}})).statusCode,403);assert.equal((await app.inject({url:'/v1/planday',headers})).json().connected,false);});
test('connection requires consent; secret is encrypted and never returned',async()=>{
 const payload={clientId:'test-app-id',refreshToken:'test-refresh-token',consent:false};assert.equal((await app.inject({url:'/v1/planday/connect',method:'POST',headers,payload})).statusCode,422);
 const r=await app.inject({url:'/v1/planday/connect',method:'POST',headers,payload:{...payload,consent:true}});assert.equal(r.statusCode,200,r.body);
 const row=(await db.query<any>('select * from planday_connection')).rows[0];assert.equal(openToken(row.token_encrypted,property),'rotated-test-token');assert.ok(!JSON.stringify(row).includes('rotated-test-token'));
 const status=await app.inject({url:'/v1/planday',headers});assert.ok(!status.body.includes('token'));assert.equal(status.json().connected,true);
 assert.equal((await app.inject({url:'/v1/planday',headers:{authorization:'Bearer foreign'}})).json().connected,false);
});
test('sync validates range and stores only minimised property snapshot',async()=>{
 assert.equal((await app.inject({url:'/v1/planday/sync',method:'POST',headers,payload:{from:'2026-01-01',to:'2026-10-05'}})).statusCode,422);
 const r=await app.inject({url:'/v1/planday/sync',method:'POST',headers,payload:{from:'2026-10-01',to:'2026-10-05'}});assert.equal(r.statusCode,200,r.body);
 const status=await app.inject({url:'/v1/planday',headers});assert.equal(status.json().snapshot.employees[0].name,'Test Staff');assert.ok(!status.body.includes('PRIVATE'));assert.equal(status.json().snapshot.clock[0].approved,true);
});
test('failed sync keeps the previous snapshot and persists rotated token',async()=>{
 await db.exec("update planday_connection set last_attempt_at=now()-interval '2 minutes'");failClock=true;
 const r=await app.inject({url:'/v1/planday/sync',method:'POST',headers,payload:{from:'2026-10-02',to:'2026-10-06'}});assert.equal(r.statusCode,502);assert.ok(!r.body.includes('NEVER_EXPOSE'));
 const status=(await app.inject({url:'/v1/planday',headers})).json();assert.equal(status.from,'2026-10-01');assert.equal(status.snapshot.employees.length,1);
});
test('disconnect affects only the current property and clears its stored snapshot',async()=>{
 assert.equal((await app.inject({url:'/v1/planday',method:'DELETE',headers:{authorization:'Bearer foreign'}})).statusCode,200);assert.equal((await app.inject({url:'/v1/planday',headers})).json().connected,true);
 assert.equal((await app.inject({url:'/v1/planday',method:'DELETE',headers})).statusCode,200);assert.equal((await app.inject({url:'/v1/planday',headers})).json().connected,false);
});
