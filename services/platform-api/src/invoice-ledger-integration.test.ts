import {before,after,test,mock} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import Fastify from 'fastify';import{PGlite}from '@electric-sql/pglite';import{pool}from './db.ts';import routes from './invoice-attachments.ts';
const db=new PGlite(),app=Fastify();const ids=Array.from({length:7},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);const [tenant,property,foreign,user,other,booking,old]=ids;
const headers={authorization:'Bearer owner'},foreignHeaders={authorization:'Bearer foreign'};
const data=(s:string)=>`data:application/pdf;base64,${Buffer.from('%PDF-1.4\n'+s).toString('base64')}`;
const payload=(patch:Record<string,unknown>={})=>({filename:'invoice.pdf',data:data('invoice'),supplierCode:'LOCAL',localName:'Green Farm',invoiceDate:'2026-10-05',total:'80.00',reviewed:true,documentType:'invoice',currency:'GBP',invoiceNumber:'GF-100',subtotal:'80',vat:'0',lines:[{code:'L100',description:'Lentils',quantity:'2',unit:'kg',unitPrice:'40',net:'80'}],...patch});
before(async()=>{
 await db.exec(`create table tenant(id uuid primary key);create table property(id uuid primary key);create table app_user(id uuid primary key);
 create table booking_group(id uuid primary key,property_id uuid,name text,status text,arrival_date date,departure_date date,agreed_total numeric);
 create table retreat_income(property_id uuid,received_on date,amount numeric);create table folio(id uuid,property_id uuid,group_id uuid,total_agreed numeric,updated_at timestamptz);create table payment(folio_id uuid,paid_at timestamptz,amount numeric,kind text);
 insert into tenant values('${tenant}');insert into property values('${property}'),('${foreign}');insert into app_user values('${user}'),('${other}');insert into booking_group values('${booking}','${foreign}','Private retreat','CONFIRMED','2026-10-01','2026-10-07',1000);`);
 await db.exec(await readFile(new URL('../../../db/migrations/0042_invoice_attachments.sql',import.meta.url),'utf8'));
 await db.query(`insert into invoice_attachment(id,tenant_id,property_id,filename,mime,file_data,supplier_code,supplier_name,invoice_date,total,entered_by) values($1,$2,$3,'legacy.pdf','application/pdf',$4,'LOCAL','Old shop','2026-10-01',10,$5)`,[old,tenant,property,data('legacy'),user]);
 await db.exec(await readFile(new URL('../../../db/migrations/0044_invoice_ledger.sql',import.meta.url),'utf8'));
 mock.method(pool,'query',async(sql:string,values:any[]=[])=>{
  if(sql.startsWith('select user_id, audience from session'))return{rows:values[0]==='owner'?[{user_id:user,audience:'ADMIN'}]:values[0]==='foreign'?[{user_id:other,audience:'ADMIN'}]:values[0]==='denied'?[{user_id:'denied',audience:'ADMIN'}]:[],rowCount:1};
  if(sql.includes('from app_user u join membership'))return{rows:[{user_id:values[0],tenant_id:tenant,property_id:values[0]===other?foreign:property,email:'test@example.invalid',display_name:'Test',role:'FINANCE_HR',role_name:'Finance',perms:values[0]==='denied'?[]:['report.read']}],rowCount:1};
  const r=await db.query(sql,values);return{...r,rowCount:r.rows.length||r.affectedRows||0};
 });await app.register(routes);await app.ready();
});
after(async()=>{await app.close();mock.restoreAll();await db.close();});
test('migration preserves legacy invoice values and originals',async()=>{const r=await db.query<any>('select * from invoice_attachment where id=$1',[old]);assert.equal(Number(r.rows[0].total),10);assert.equal(r.rows[0].document_type,'invoice');assert.deepEqual(r.rows[0].lines,[]);assert.equal(r.rows[0].file_data,data('legacy'));});
test('unauthenticated and unprivileged requests are rejected',async()=>{assert.equal((await app.inject({url:'/v1/invoice-attachments/spend'})).statusCode,401);assert.equal((await app.inject({url:'/v1/invoice-attachments/spend',headers:{authorization:'Bearer denied'}})).statusCode,403);});
test('review, file, dates, currency and line validation run before saving',async()=>{for(const patch of [{reviewed:false},{data:'bad'},{invoiceDate:'2026-02-30'},{currency:'USD'},{lines:[{description:'x',net:'-1'}]}]){const r=await app.inject({url:'/v1/invoice-attachments',method:'POST',headers,payload:payload(patch)});assert.equal(r.statusCode,422,r.body);}assert.equal((await db.query<any>('select count(*)::int n from invoice_attachment')).rows[0].n,1);});
test('cannot attach an invoice to another property retreat',async()=>{assert.equal((await app.inject({url:'/v1/invoice-attachments',method:'POST',headers,payload:payload({bookingId:booking})})).statusCode,404);});
test('confirmed products persist and duplicate documents return 409',async()=>{
 const r=await app.inject({url:'/v1/invoice-attachments',method:'POST',headers,payload:payload()});assert.equal(r.statusCode,200,r.body);
 const original=await app.inject({url:`/v1/invoice-attachments/${r.json().id}`,headers});assert.equal(original.json().data,data('invoice'));
 for(const patch of [{},{data:data('different scan'),invoiceNumber:'gf-100',localName:'green farm'},{data:data('legacy'),invoiceNumber:'OLD'}])assert.equal((await app.inject({url:'/v1/invoice-attachments',method:'POST',headers,payload:payload(patch)})).statusCode,409);
 assert.equal((await app.inject({url:`/v1/invoice-attachments/${r.json().id}`,headers:foreignHeaders})).statusCode,404);
});
test('credits reduce spend; searches receive every row and structured fields',async()=>{
 const r=await app.inject({url:'/v1/invoice-attachments',method:'POST',headers,payload:payload({data:data('credit'),documentType:'credit',invoiceNumber:'CN-1',total:'20',subtotal:'20',lines:[]})});assert.equal(r.statusCode,200,r.body);
 const report=(await app.inject({url:'/v1/invoice-attachments/spend?anchor=2026-10-05',headers})).json();assert.equal(report.periods.month.spend,70);assert.equal(report.items.length,3);assert.equal(report.items.find((r:any)=>r.invoiceNumber==='GF-100').lines[0].code,'L100');assert.equal(report.items.find((r:any)=>r.documentType==='credit').total,20);
});
test('duplicate detection and listing are property-scoped',async()=>{
 const r=await app.inject({url:'/v1/invoice-attachments',method:'POST',headers:foreignHeaders,payload:payload()});assert.equal(r.statusCode,200,r.body);
 const report=(await app.inject({url:'/v1/invoice-attachments/spend',headers:foreignHeaders})).json();assert.equal(report.items.length,1);assert.equal(report.items[0].invoiceNumber,'GF-100');
});
test('more than 100 records are not silently excluded from the searchable ledger',async()=>{
 await db.query(`insert into invoice_attachment(tenant_id,property_id,filename,mime,file_data,supplier_code,supplier_name,invoice_date,total) select $1,$2,'old-'||n||'.pdf','application/pdf','legacy'||n,'LOCAL','History','2026-09-01',1 from generate_series(1,105) n`,[tenant,property]);
 const report=(await app.inject({url:'/v1/invoice-attachments/spend',headers})).json();assert.equal(report.items.length,108);
});
