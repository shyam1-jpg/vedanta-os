import type {FastifyInstance} from 'fastify';
import {pool} from './db.ts';import{requireActor,allow,problem}from'./auth.ts';
import{validDate}from'../../../domains/finance/invoice-ledger.ts';
import{PlandayError,plandayKey,sealToken,openToken,refreshPlanday,plandayList,minimiseSnapshot}from'./planday-client.ts';
const busy=new Set<string>();const connectionAttempts=new Map<string,number>();
export default async function planday(f:FastifyInstance){
 f.get('/v1/planday',async(req,reply)=>{
  reply.header('Cache-Control','no-store');const a=await requireActor(req,reply);if(!a||!allow(a,'clock.manage',reply))return;
  const row=(await pool.query('select connected_at,last_synced_at,snapshot_from::text,snapshot_to::text,snapshot from planday_connection where property_id=$1',[a.propertyId])).rows[0];
  let ready=true;try{plandayKey();}catch{ready=false;}
  return{connected:!!row,secureStorageReady:ready,canConfigure:a.perms.has('user.manage'),lastSyncedAt:row?.last_synced_at??null,from:row?.snapshot_from??'',to:row?.snapshot_to??'',snapshot:row?.snapshot??null};
 });
 f.post('/v1/planday/connect',{bodyLimit:16_000},async(req:any,reply)=>{
  const a=await requireActor(req,reply);if(!a||!allow(a,'clock.manage',reply)||!allow(a,'user.manage',reply))return;
  const clientId=String(req.body?.clientId??'').trim(),refreshToken=String(req.body?.refreshToken??'').trim();
  if(!/^[A-Za-z0-9_-]{8,160}$/.test(clientId)||refreshToken.length<10||refreshToken.length>8000)return reply.code(422).send(problem(422,'validation','Enter the App ID and token from Planday API Access.'));
  if(req.body?.consent!==true)return reply.code(422).send(problem(422,'validation','Confirm you administer this Planday portal and approve read-only access.'));
  if(busy.has(a.propertyId)||(connectionAttempts.get(a.propertyId)??0)>Date.now()-60_000)return reply.code(429).send(problem(429,'busy','Wait a minute before trying the connection again.'));
  // Replacement is explicit: disconnect first so an existing portal cannot be silently swapped.
  if((await pool.query('select property_id from planday_connection where property_id=$1',[a.propertyId])).rows.length)return reply.code(409).send(problem(409,'connected','Disconnect the existing Planday connection before replacing it.'));
  busy.add(a.propertyId);connectionAttempts.set(a.propertyId,Date.now());
  try{plandayKey();const token=await refreshPlanday(clientId,refreshToken);await pool.query('insert into planday_connection(property_id,tenant_id,client_id,token_encrypted,connected_by) values($1,$2,$3,$4,$5)',[a.propertyId,a.tenantId,clientId,sealToken(token.refreshToken,a.propertyId),a.userId]);return{ok:true};}
  catch(e){const status=e instanceof PlandayError?e.status:502;return reply.code(status).send(problem(status,'planday_connection',e instanceof PlandayError?e.message:'Could not connect to Planday. Please try again.'));}
  finally{busy.delete(a.propertyId);}
 });
 f.post('/v1/planday/sync',async(req:any,reply)=>{
  const a=await requireActor(req,reply);if(!a||!allow(a,'clock.manage',reply))return;
  const {from,to}=req.body??{};
  if(!validDate(from)||!validDate(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>30)return reply.code(422).send(problem(422,'validation','Choose an inclusive date range of up to 31 days.'));
  if(busy.has(a.propertyId))return reply.code(429).send(problem(429,'busy','A Planday sync is already running.'));
  const c=await pool.connect();
  if(busy.has(a.propertyId)){c.release();return reply.code(429).send(problem(429,'busy','A Planday sync is already running.'));}
  busy.add(a.propertyId);let locked=false;
  try{
   locked=(await c.query('select pg_try_advisory_lock(hashtext($1)) as locked',[`planday:${a.propertyId}`])).rows[0].locked;
   if(!locked)throw new PlandayError(429,'A Planday sync is already running.');
   await c.query('begin');const row=(await c.query('select * from planday_connection where property_id=$1 for update',[a.propertyId])).rows[0];
   if(!row)throw new PlandayError(409,'Connect Planday first.');
   if(row.last_attempt_at&&Date.now()-new Date(row.last_attempt_at).getTime()<60_000)throw new PlandayError(429,'Wait one minute between syncs.');
   const token=await refreshPlanday(row.client_id,openToken(row.token_encrypted,a.propertyId));
   // Persist token rotation even if a later read fails. The property lock spans both commits.
   await c.query('update planday_connection set token_encrypted=$2,last_attempt_at=now() where property_id=$1',[a.propertyId,sealToken(token.refreshToken,a.propertyId)]);await c.query('commit');
   const range={from,to,signal:AbortSignal.timeout(90_000)};const employees=await plandayList('employees',row.client_id,token.accessToken,range);const departments=await plandayList('departments',row.client_id,token.accessToken,range);const shifts=await plandayList('shifts',row.client_id,token.accessToken,range);const clock=await plandayList('clock',row.client_id,token.accessToken,range);
   const snapshot=minimiseSnapshot(employees,departments,shifts,clock);
   await c.query('update planday_connection set snapshot=$2::jsonb,snapshot_from=$3,snapshot_to=$4,last_synced_at=now() where property_id=$1',[a.propertyId,JSON.stringify(snapshot),from,to]);return{ok:true};
  }catch(e){await c.query('rollback').catch(()=>{});const status=e instanceof PlandayError?e.status:502;return reply.code(status).send(problem(status,'planday_sync',e instanceof PlandayError?e.message:'Planday sync failed. The last successful snapshot is unchanged.'));}
  finally{if(locked)await c.query('select pg_advisory_unlock(hashtext($1))',[`planday:${a.propertyId}`]).catch(()=>{});c.release();busy.delete(a.propertyId);}
 });
 f.delete('/v1/planday',async(req,reply)=>{
  const a=await requireActor(req,reply);if(!a||!allow(a,'clock.manage',reply)||!allow(a,'user.manage',reply))return;
  if(busy.has(a.propertyId))return reply.code(409).send(problem(409,'busy','Wait for the current sync to finish before disconnecting.'));
  const c=await pool.connect();let locked=false;
  try{locked=(await c.query('select pg_try_advisory_lock(hashtext($1)) as locked',[`planday:${a.propertyId}`])).rows[0].locked;if(!locked)return reply.code(409).send(problem(409,'busy','Wait for the current sync to finish.'));await c.query('delete from planday_connection where property_id=$1',[a.propertyId]);return{ok:true};}
  finally{if(locked)await c.query('select pg_advisory_unlock(hashtext($1))',[`planday:${a.propertyId}`]).catch(()=>{});c.release();}
 });
}
