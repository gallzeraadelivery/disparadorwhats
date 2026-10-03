import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('authenticated workflow, consent, media, queue, isolation and unsubscribe', {timeout:30000},async()=>{
 const calls=[];let fail=false;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;assert.equal(req.headers.apikey,'test-api-key');res.setHeader('Content-Type','application/json');
 if(req.url==='/instance/fetchInstances')res.end(JSON.stringify([{name:'dz-test',connectionStatus:'open'}]));
 else if(req.url.startsWith('/instance/connectionState'))res.end(JSON.stringify({instance:{state:'open'}}));
 else if(req.url.startsWith('/message/')){calls.push({route:req.url,body:JSON.parse(raw)});res.statusCode=fail?500:201;res.end(JSON.stringify(fail?{error:'test'}:{key:{id:'MOCK-MESSAGE-ID'}}));}
 else {res.statusCode=404;res.end('{}');}});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));const mockPort=mock.address().port;
 const port=await new Promise(r=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const root=`http://127.0.0.1:${port}`,dir=mkdtempSync(path.join(tmpdir(),'disparazap-test-'));
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{env:{...process.env,PORT:String(port),PUBLIC_URL:root,DATA_DIR:dir,SESSION_SECRET:'x'.repeat(64),ADMIN_PASSWORD:'test-password-long',EVOLUTION_URL:`http://127.0.0.1:${mockPort}`,EVOLUTION_API_KEY:'test-api-key',COOKIE_SECURE:'false'},stdio:'ignore'});
 let cookie;
 const request=async(url,body,method,headers={})=>{const r=await fetch(root+url,{method:method||(body?'POST':'GET'),headers:{...(!(body instanceof FormData)&&body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body?body instanceof FormData?body:JSON.stringify(body):undefined});let d;try{d=await r.json();}catch{}return {r,d};};
 try{
  for(let i=0;i<40;i++){try{if((await fetch(root+'/health')).ok)break;}catch{}await sleep(100);}
  assert.equal((await request('/api/contacts')).r.status,401);
  assert.equal((await request('/api/login',{user:'admin',password:'wrong-password'})).r.status,401);
  let login=await request('/api/login',{user:'admin',password:'test-password-long'});assert.equal(login.r.status,200);cookie=login.r.headers.get('set-cookie').split(';')[0];assert.match(login.r.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await request('/api/contacts',{name:'Bad',phone:'65999991234'},'POST', {Origin:'https://evil.example'})).r.status,403);
  await request('/api/contacts',{name:'Maria',phone:'+5565999991234',list:'Teste',consent:false});
  const campaign={name:'Teste seguro',instance:'dz-test',text:'Olá, {{nome}}!',list:'Teste',minDelay:30,maxDelay:30,dailyLimit:5};
  assert.equal((await request('/api/campaigns',campaign)).r.status,400);
  const contact=(await request('/api/contacts')).d[0];await request('/api/contacts/'+contact.id,{consent:true},'PATCH');
  let c=(await request('/api/campaigns',campaign)).d;assert.equal(c.total,1);await sleep(2200);assert.equal(calls.length,0,'drafts never send');
  const form=new FormData();form.append('file',new Blob([Buffer.from([137,80,78,71,13,10,26,10,1,2,3])],{type:'image/png'}),'test.png');const media=(await request('/api/media',form)).d;assert.ok(media.id);
  const scheduled=(await request('/api/campaigns',{...campaign,name:'Agendada',schedule:new Date(Date.now()+600000).toISOString(),mediaId:media.id})).d;await request('/api/campaigns/'+scheduled.id+'/action',{action:'start'});
  await request('/api/campaigns/'+c.id+'/action',{action:'start'});
  for(let i=0;i<40&&calls.length===0;i++)await sleep(100);
  assert.equal(calls.length,1);assert.match(calls[0].body.text,/Olá, Maria!/);assert.match(calls[0].body.text,/\/sair\//);assert.equal(calls[0].body.number,'5565999991234');
  const jobs=(await request('/api/campaigns/'+c.id+'/jobs')).d;assert.equal(jobs[0].status,'sent');
  const imageCampaign=(await request('/api/campaigns',{...campaign,name:'Mídia',mediaId:media.id})).d;
  await request('/api/campaigns/'+imageCampaign.id+'/action',{action:'start'});await sleep(2300);assert.equal(calls.length,1,'same instance shares its interval across campaigns');
  const database=new DatabaseSync(path.join(dir,'disparazap.sqlite'));database.exec('UPDATE instance_limits SET next_at=0');
  for(let i=0;i<40&&calls.length<2;i++)await sleep(100);
  assert.equal(calls.length,2);assert.match(calls[1].route,/sendMedia/);assert.equal(calls[1].body.mediatype,'image');assert.ok(calls[1].body.media);
  const limited=(await request('/api/campaigns',{...campaign,name:'Limite',dailyLimit:1})).d;await request('/api/campaigns/'+limited.id+'/action',{action:'start'});database.exec('UPDATE instance_limits SET next_at=0');await sleep(2300);assert.equal(calls.length,2,'daily limit is shared across campaigns');await request('/api/campaigns/'+limited.id+'/action',{action:'cancel'});
  fail=true;const uncertain=(await request('/api/campaigns',{...campaign,name:'Falha'})).d;await request('/api/campaigns/'+uncertain.id+'/action',{action:'start'});
  for(let i=0;i<40&&calls.length<3;i++)await sleep(100);
  assert.equal(calls.length,3);assert.equal((await request('/api/campaigns/'+uncertain.id+'/jobs')).d[0].status,'uncertain');assert.equal((await request('/api/campaigns')).d.find(c=>c.id===uncertain.id).status,'paused');await sleep(2300);assert.equal(calls.length,3,'uncertain sends are never automatically retried');database.close();
  const link=calls[0].body.text.split('mensagens: ')[1];assert.equal((await fetch(link)).status,200);assert.equal((await request('/api/contacts')).d[0].unsubscribed,0,'GET link must not unsubscribe');
  const u=new URL(link);const unsubscribe=await fetch(link,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:root},body:'token='+u.searchParams.get('token')});assert.equal(unsubscribe.status,200);
  assert.equal((await request('/api/contacts')).d[0].unsubscribed,1);assert.equal((await request('/api/campaigns',campaign)).r.status,400);
  assert.equal((await fetch(root+'/sair/'+contact.id+'?token=bad')).status,403);
  assert.equal(calls.length,3,'scheduled campaign must not send yet');
  await request('/api/logout',{});assert.equal((await request('/api/contacts')).r.status,401);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));rmSync(dir,{recursive:true,force:true});}
});
