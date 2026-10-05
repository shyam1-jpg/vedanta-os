/** Customer integration, read-only resources. Never log credentials or upstream bodies. */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export class PlandayError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
export function plandayKey():Buffer {
 const raw=process.env.PLANDAY_TOKEN_ENCRYPTION_KEY??'';
 if(!/^[a-f0-9]{64}$/i.test(raw))throw new PlandayError(503,'Planday secure storage is not configured on the server yet.');
 return Buffer.from(raw,'hex');
}
export function sealToken(token:string,propertyId:string):string {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',plandayKey(),iv);cipher.setAAD(Buffer.from(propertyId));
 return [iv, cipher.update(token,'utf8'),cipher.final(),cipher.getAuthTag()].map(b=>b.toString('base64')).join('.');
}
export function openToken(value:string,propertyId:string):string {
 const [iv,body,end,tag]=value.split('.').map(s=>Buffer.from(s,'base64'));const decipher=createDecipheriv('aes-256-gcm',plandayKey(),iv);decipher.setAAD(Buffer.from(propertyId));decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(body),decipher.update(end),decipher.final()]).toString('utf8');
}
async function jsonResponse(response:Response){
 if(!response.ok){await response.body?.cancel();const status=response.status===429?429:502;throw new PlandayError(status,response.status===401||response.status===403?'Planday rejected access. Check the authorisation and read-only scopes.':response.status===429?'Planday is busy. Wait a minute before syncing again.':'Planday could not complete the request. Your last saved snapshot is unchanged.');}
 const text=await response.text();if(text.length>5_000_000)throw new PlandayError(502,'Planday returned too much data. Use a smaller date range.');
 try{return JSON.parse(text);}catch{throw new PlandayError(502,'Planday returned an unreadable response.');}
}
export async function refreshPlanday(clientId:string,refreshToken:string,request:typeof fetch=fetch){
 const data=await jsonResponse(await request('https://id.planday.com/connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(20_000),redirect:'error'}));
 if(typeof data.access_token!=='string'||!data.access_token)throw new PlandayError(502,'Planday did not return an access token.');
 return {accessToken:data.access_token as string,refreshToken:typeof data.refresh_token==='string'&&data.refresh_token?data.refresh_token:refreshToken};
}
const PATHS={employees:'/hr/v1.0/employees',departments:'/hr/v1.0/departments',shifts:'/scheduling/v1.0/shifts',clock:'/punchclock/v1.0/punchclockshifts'} as const;
export async function plandayList(kind:keyof typeof PATHS,clientId:string,accessToken:string,range:{from:string;to:string;signal?:AbortSignal},request:typeof fetch=fetch){
 const result:Record<string,any>[]=[];const seen=new Set<number>();
 for(let offset=0;offset<5000;){
  range.signal?.throwIfAborted();
  const url=new URL(PATHS[kind],'https://openapi.planday.com');url.searchParams.set('offset',String(offset));url.searchParams.set('limit','50');
  if(kind==='shifts'||kind==='clock'){url.searchParams.set('from',range.from+(kind==='clock'?'T00:00:00':''));url.searchParams.set('to',range.to+(kind==='clock'?'T23:59:59':''));}
  const timeout=AbortSignal.timeout(20_000);
  const json=await jsonResponse(await request(url,{headers:{'X-ClientId':clientId,Authorization:`Bearer ${accessToken}`},signal:range.signal?AbortSignal.any([range.signal,timeout]):timeout,redirect:'error'}));
  if(!Array.isArray(json.data))throw new PlandayError(502,'Planday returned an unexpected list.');
  for(const row of json.data){if(!row||!Number.isSafeInteger(row.id)||seen.has(row.id))throw new PlandayError(502,'Planday pagination changed during the read. Please sync again.');seen.add(row.id);result.push(row);}
  offset+=json.data.length;
  if(!json.data.length||Number.isFinite(json.paging?.total)&&offset>=json.paging.total)return result;
 }
 throw new PlandayError(422,'More than 5,000 records matched. Use a smaller range before syncing.');
}
export function minimiseSnapshot(employees:Record<string,any>[],departments:Record<string,any>[],shifts:Record<string,any>[],clock:Record<string,any>[]){
 const text=(v:unknown)=>typeof v==='string'?v.slice(0,160):'';
 const id=(v:unknown)=>Number.isSafeInteger(v)?v as number:null;
 return {
  employees:employees.map(e=>({id:e.id,name:[text(e.firstName),text(e.lastName)].filter(Boolean).join(' ')||`Employee ${e.id}`,departments:Array.isArray(e.departments)?e.departments.filter(Number.isSafeInteger):[]})),
  departments:departments.map(d=>({id:d.id,name:text(d.name)})),
  shifts:shifts.map(s=>({id:s.id,employeeId:id(s.employeeId),departmentId:id(s.departmentId),date:text(s.date),start:text(s.startDateTime),end:text(s.endDateTime),timeZone:text(s.timeZone),status:text(s.status)})),
  clock:clock.map(c=>({id:c.id,employeeId:id(c.employeeId),departmentId:id(c.departmentId),shiftId:id(c.shiftId),start:text(c.startDateTime),end:text(c.endDateTime),approved:c.isApproved===true})),
 };
}
