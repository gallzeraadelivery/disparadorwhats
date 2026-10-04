import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {recipientNotOnWhatsApp} from '../core.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('only explicit recipient rejection is classified as number without WhatsApp',()=>{
 assert.equal(recipientNotOnWhatsApp({response:{message:[{number:'5565999991234',exists:false}]}}),true);
 for(const body of [{error:'account restricted'},{message:'timeout'},{exists:false},{response:{message:[{number:'5565999991234',exists:true}]}}])assert.equal(recipientNotOnWhatsApp(body),false);
});
test('number without WhatsApp fails only that recipient and continues without retry',{timeout:20000},async()=>{
 const calls=[];let webhook=null;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;res.setHeader('Content-Type','application/json');
 if(req.url==='/instance/fetchInstances')return res.end(JSON.stringify([{name:'dz-recipient',connectionStatus:'open'}]));
 if(req.url.startsWith('/instance/connectionState'))return res.end(JSON.stringify({instance:{state:'open'}}));
 if(req.url.startsWith('/webhook/find'))return res.end(JSON.stringify(webhook));
 if(req.url.startsWith('/webhook/set'))return res.end(JSON.stringify(webhook=JSON.parse(raw).webhook));
 if(req.url.startsWith('/message/')){const b=JSON.parse(raw);calls.push(b.number);if(calls.length===1){res.statusCode=400;return res.end(JSON.stringify({response:{message:[{number:b.number,exists:false}]}}));}res.statusCode=201;return res.end(JSON.stringify({key:{id:'NEXT-RECIPIENT'}}));}
 res.statusCode=404;res.end('{}');});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const port=await new Promise(r=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const root=`http://127.0.0.1:${port}`,dir=mkdtempSync(path.join(tmpdir(),'dz-recipient-'));
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{stdio:'ignore',env:{...process.env,PORT:String(port),DATA_DIR:dir,PUBLIC_URL:root,SESSION_SECRET:'q'.repeat(64),ADMIN_PASSWORD:'test-password-long',COOKIE_SECURE:'false',EVOLUTION_URL:`http://127.0.0.1:${mock.address().port}`,EVOLUTION_API_KEY:'test-key'}});
 let cookie,db;
 const request=async(url,body)=>{const r=await fetch(root+url,{method:body?'POST':'GET',headers:{Cookie:cookie||'',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
 try{
 for(let i=0;i<50;i++){try{if((await fetch(root+'/health')).ok)break;}catch{}await sleep(100);}
 const login=await fetch(root+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',password:'test-password-long'})});cookie=login.headers.get('set-cookie').split(';')[0];
 for(const [name,phone] of [['Primeiro','5565999991234'],['Segundo','5565999994321']])await request('/api/contacts',{name,phone,list:'Teste',consent:true});
 const c=await request('/api/campaigns',{name:'Teste de rejeição por contato',instance:'dz-recipient',list:'Teste',text:'Teste neutro',minDelay:30,maxDelay:30,dailyLimit:10});await request('/api/campaigns/'+c.id+'/action',{action:'start'});
 for(let i=0;i<50&&calls.length<1;i++)await sleep(100);await sleep(100);assert.equal(calls.length,1);
 let report=await request('/api/campaigns/'+c.id+'/report');assert.equal(report.campaign.status,'running');assert.equal(report.summary.failed,1);assert.equal(report.summary.pending,1);assert.match(report.rows.find(r=>r.status==='failed').reason,/Número sem WhatsApp/);
 await sleep(2100);assert.equal(calls.length,1,'the next recipient respects the interval');
 db=new DatabaseSync(path.join(dir,'disparazap.sqlite'));db.exec('UPDATE instance_limits SET next_at=0; UPDATE campaigns SET next_at=0');
 for(let i=0;i<50&&calls.length<2;i++)await sleep(100);await sleep(100);assert.deepEqual(calls,['5565999991234','5565999994321']);
 report=await request('/api/campaigns/'+c.id+'/report');assert.equal(report.summary.failed,1);assert.equal(report.summary.sent,1);assert.equal(report.rows.find(r=>r.status==='failed').messages[0].status,'failed');
 }finally{db?.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});}
});
