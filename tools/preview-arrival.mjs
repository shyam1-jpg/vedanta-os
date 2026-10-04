/** Loopback-only UI fixtures. No live accounts, database, email, bookings or keys. */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist-web/',import.meta.url)),port=4320;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const tomorrow=new Date(Date.parse(`${today}T12:00:00Z`)+2*86400000).toISOString().slice(0,10);
const id='00000000-0000-4000-8000-000000000001';
const stay={id,people:2,arrival:today,departure:tomorrow,status:'CONVERTED',programme_name:'Sample retreat',notes:'',dietary_notes:'Plant-based meals requested',accessibility_notes:'',arrival_time_note:'16:00',travel_notes:'Arriving by taxi',rooms:[{number:'101',section:'First Floor'}]};
const arrival={today,details_version:'local-preview',details:{arrival:today,departure:tomorrow,people:2,arrival_time:stay.arrival_time_note,dietary:stay.dietary_notes,accessibility:stay.accessibility_notes,travel:stay.travel_notes},can_confirm:true,can_arrive:false,reason:'Review your saved stay details, then confirm they are up to date.',details_confirmed_at:null,arrived_at:null,reception_seen_at:null};
const handover=[{id:'sample-handover',body:'Prepare arrival packs at reception. Room 101 still needs its final inspection.',department_label:'House',shift_label:'Morning',author_name:'Preview supervisor',acknowledged:false}];
const checks=[{id:'sample-check',title:'Review today’s arrivals with reception',department_label:'House',due_time:'09:00',done:false}];
const tasks=[{id:'sample-task',title:'Complete final room inspection',assigned_name:'Preview attendant',assigned_label:'',due_at:`${today}T10:00:00Z`,status:'in_progress',status_label:'In progress',overdue:true,room_label:'101',department_label:'Housekeeping',next:[]}];
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"connect-src 'self'");
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`),p=url.pathname;let body={};
    if(['POST','PATCH'].includes(req.method)){let raw='';for await(const c of req){raw+=c;if(raw.length>16000)return send(res,413,{});}body=JSON.parse(raw||'{}');}
    if(p.startsWith('/guest/')||p.startsWith('/auth/')||p.startsWith('/v1/')||p.startsWith('/staff/')||p==='/me'){
      if(p==='/guest/property')return send(res,200,{name:'The Vedanta Way',kicker:'Retreat centre',tagline:'A local test of guest arrival',about:'',website:'',company:'',address:'',check_in_from:'15:00',check_out_by:'11:00',rooms:40});
      if(p==='/guest/programmes')return send(res,200,{items:[]});
      if(p==='/guest/calendar')return send(res,200,{days:[]});
      if(p==='/guest/login')return send(res,200,{token:'preview-guest',user:{name:'Preview Guest',email:'guest@example.invalid'}});
      if(p==='/guest/me')return req.headers.authorization?send(res,200,{name:'Preview Guest',email:'guest@example.invalid'}):send(res,401,{detail:'Sign in to this local preview.'});
      if(p==='/guest/enquiries')return send(res,200,{items:[stay]});
      if(p===`/guest/enquiries/${id}/needs`){Object.assign(stay,body);arrival.details_confirmed_at=null;arrival.can_arrive=false;return send(res,200,{ok:true,review_pending:true});}
      if(p===`/guest/enquiries/${id}/arrival`){
        if(req.method==='POST'){
          if(body.action==='confirm_details'){arrival.details_confirmed_at??=new Date().toISOString();arrival.can_arrive=true;arrival.reason='When you reach the house, tell reception you have arrived.';}
          if(body.action==='arrive')arrival.arrived_at??=new Date().toISOString();
        }return send(res,200,arrival);
      }
      if(p==='/auth/providers')return send(res,200,{microsoft:false,email:true,email_code:false,dev:true});
      if(p==='/auth/login')return send(res,200,{token:'preview-staff',user:{name:'Preview Reception',role:'RECEPTION',permissions:['group.read','group.update'],surface:body.surface==='staff'?'STAFF':'ADMIN'}});
      if(p==='/me')return send(res,200,{name:'Preview Reception',email:'reception@example.invalid',role:'RECEPTION',role_name:'Reception',permissions:['group.read','group.update'],property_name:'The Vedanta Way'});
      if(p==='/staff/clock')return send(res,200,{last:'IN',hours_this_week:12});
      if(p==='/staff/payroll')return send(res,200,{hours:12,shifts:[]});
      if(p==='/v1/ops/board')return send(res,200,{date:today,handover,checklists:checks,progress:{done:checks.filter(c=>c.done).length,total:checks.length},notices:[],guest_requests:[]});
      if(p==='/v1/ops/morning')return send(res,200,{date:today,can_acknowledge:true,arrivals:[{id:'sample-booking',name:'Sample retreat',expected_guests:2,arrival_time:'16:00'}],departures:[],rooms:[{status:'VACANT_CLEAN',count:8},{status:'INSPECTED',count:12},{status:'CLEANING',count:3}],guests:[{...stay,name:'Preview Guest',...arrival,rooms:[{number:'101',status:'VACANT_CLEAN'}]}]});
      if(p===`/v1/ops/arrivals/${id}/acknowledge`){arrival.reception_seen_at??=new Date().toISOString();return send(res,200,{ok:true});}
      if(p==='/v1/ops/tasks')return send(res,200,{items:tasks,matched_total:tasks.length,counts:{open:1,overdue:1},can_assign:true});
      if(p==='/v1/ops/handover'&&req.method==='POST'){handover.unshift({id:`note-${handover.length}`,body:body.body,department_label:'House',shift_label:'Morning',author_name:'Preview Reception',acknowledged:false});return send(res,200,{ok:true});}
      if(p.endsWith('/acknowledge')){const h=handover.find(h=>p.includes(h.id));if(h)h.acknowledged=true;return send(res,200,{ok:true});}
      if(p.endsWith('/tick')){checks[0].done=body.done;return send(res,200,{ok:true});}
      if(p==='/v1/service/front-desk')return send(res,403,{detail:'Not part of this isolated preview.'});
      return send(res,200,{items:[]});
    }
    let file=resolve(root,'.'+decodeURIComponent(p));if(!file.startsWith(resolve(root)+sep))return send(res,404,{});
    if(p.endsWith('/'))file=resolve(file,'index.html');if(!(await stat(file)).isFile())return send(res,404,{});
    let content=await readFile(file);const ext=extname(file);
    if(ext==='.html')content=Buffer.from(content.toString().replace('</head>','<style>body::after{content:"LOCAL TEST · Synthetic guests · Nothing is sent to the live house";position:fixed;bottom:8px;left:8px;z-index:999;background:#f9eecf;color:#244134;border:1px solid #b39a69;padding:8px;font:11px system-ui;pointer-events:none;max-width:90%}</style></head>'));
    const mime={'.html':'text/html; charset=utf-8','.txt':'text/plain; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
    res.writeHead(200,{'content-type':mime[ext]??'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch{send(res,404,{detail:'Local preview resource not found.'});}
}).listen(port,'127.0.0.1',()=>console.log(`Local arrival preview http://127.0.0.1:${port}/book/ and /pocket/`));
