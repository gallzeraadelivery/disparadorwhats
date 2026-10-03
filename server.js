import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHmac, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { initialize, hashPassword } from './schema.js';
import { phone, personalize, importContacts, campaignInput, optOutPhones, replyOptOutFooter, reportReason, reportFilter, reportCsv, evolutionErrorDetail } from './core.js';
const app = express(), dataDir = path.resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive:true }); mkdirSync(path.join(dataDir,'media'),{recursive:true});
const secret = process.env.SESSION_SECRET, password = process.env.ADMIN_PASSWORD;
if (!secret || secret.length < 32 || !password || password.length < 12) throw new Error('Configure SESSION_SECRET (32+) e ADMIN_PASSWORD (12+).');
const admin = process.env.ADMIN_USER || 'admin';
const db = new DatabaseSync(path.join(dataDir,'disparazap.sqlite'));
const adminId=initialize(db,admin,password);
const q=(sql,...args)=>db.prepare(sql).all(...args), one=(sql,...args)=>db.prepare(sql).get(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
const log=(description,owner=adminId)=>run('INSERT INTO activity(description,owner_id) VALUES(?,?)',description,owner);
const safeUser=u=>({id:u.id,user:u.username,name:u.name,role:u.role,active:Boolean(u.active)});
function session(res,u){const token=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires<?',Date.now());run('INSERT INTO sessions(token,expires,user_id) VALUES(?,?,?)',token,Date.now()+43200000,u.id);res.cookie('dz_session',token+'.'+sign(token),{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'strict',maxAge:43200000,path:'/'});return safeUser(u);}
function adminOnly(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Acesso exclusivo do administrador.'});next();}
function accountInput(b){if(typeof b.user!=='string'||! /^[a-zA-Z0-9_.-]{3,40}$/.test(b.user))throw new Error('Usuário: 3 a 40 letras, números, ponto ou hífen.');if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new Error('Senha: 12 a 128 caracteres.');if(typeof b.name!=='string'||!b.name.trim()||b.name.length>120)throw new Error('Informe seu nome (até 120 caracteres).');return {username:b.user.toLowerCase(),name:b.name.trim()};}
function createUser(b){const v=accountInput(b);if(one('SELECT id FROM users WHERE username=?',v.username))throw new Error('Este usuário já está cadastrado.');const h=hashPassword(b.password),id=randomUUID();run("INSERT INTO users(id,username,name,password_hash,salt,role) VALUES(?,?,?,?,?,'user')",id,v.username,v.name,h.hash,h.salt);return one('SELECT * FROM users WHERE id=?',id);}
app.set('trust proxy',1); app.use(helmet()); app.use(express.json({limit:'256kb'}));
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
app.use((req,res,next)=>{ if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin!==publicUrl) return res.status(403).json({error:'Origem não autorizada.'}); next(); });
const sign=t=>createHmac('sha256',secret).update(t).digest('hex');
function auth(req,res,next) {
  const cookie = (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dz_session='))?.slice(11);
  if (!cookie) return res.status(401).json({error:'Faça login para continuar.'});
  const [token,signature]=cookie.split('.'), expected=sign(token||'');
  if (!signature || signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) ) return res.status(401).json({error:'Sessão expirada.'});
  const user=one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',token,Date.now());if(!user)return res.status(401).json({error:'Sessão expirada ou conta desativada.'});req.user=user;req.sessionToken=token; next();
}
const failures=new Map();
function rate(req,res,next){const key=req.ip+':'+req.path,record=failures.get(key)||{n:0,until:Date.now()+900000};if(record.until<=Date.now()){record.n=0;record.until=Date.now()+900000;}if(record.n>=12)return res.status(429).json({error:'Muitas tentativas. Aguarde 15 minutos.'});record.n++;failures.set(key,record);if(failures.size>10000){for(const [k,v] of failures)if(v.until<Date.now())failures.delete(k);}next();}
app.post('/api/login',rate,(req,res)=>{const b=req.body,u=typeof b.user==='string'?one('SELECT * FROM users WHERE username=?',b.user.toLowerCase()):null;const salt=u?.salt||secret,expected=u?Buffer.from(u.password_hash,'hex'):scryptSync('invalid-password',salt,64);const valid=typeof b.password==='string'&&b.password.length<=128&&timingSafeEqual(scryptSync(b.password,salt,64),expected)&&u?.active;if(!valid)return res.status(401).json({error:'Usuário ou senha incorretos, ou conta desativada.'});failures.delete(req.ip+':'+req.path);res.json(session(res,u));});
app.post('/api/register',rate,(req,res)=>{if(one('SELECT count(*) n FROM users').n>=1000)throw new Error('Cadastro temporariamente indisponível.');const u=createUser(req.body);log('Conta criada.',u.id);res.status(201).json(session(res,u));});
function unsubscribeValid(id,token){const expected=sign('unsubscribe:'+id);return typeof token==='string'&&token.length===expected.length&&timingSafeEqual(Buffer.from(token),Buffer.from(expected));}
app.get('/sair/:id',(req,res)=>{if(!unsubscribeValid(req.params.id,req.query.token))return res.status(403).send('Link inválido.');res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DisparaZap · Descadastro</title><link rel="stylesheet" href="/style.css"><body><main><h1>Você escolhe suas conversas.</h1><p>Confirme para deixar de receber campanhas do DisparaZap.</p><form method="post"><input type="hidden" name="token" value="${req.query.token}"><button class="button primary">Não quero receber mensagens</button></form></main></body></html>`);});
app.post('/sair/:id',express.urlencoded({extended:false}),(req,res)=>{if(!unsubscribeValid(req.params.id,req.body.token))return res.status(403).send('Link inválido.');run('UPDATE contacts SET unsubscribed=1,consent=0 WHERE id=?',req.params.id);log('Descadastro solicitado por contato.',one('SELECT owner_id FROM contacts WHERE id=?',req.params.id)?.owner_id||adminId);res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro confirmado</title><link rel="stylesheet" href="/style.css"><body><main><h1>Descadastro confirmado.</h1><p>Você não receberá novas campanhas do DisparaZap.</p></main></body></html>');});
// Each instance has a separate authentication secret; no customer text is logged.
const webhookToken=name=>sign('reply-optout:'+name);
app.post('/hooks/evolution/:instance',(req,res)=>{
 const name=req.params.instance,expected=webhookToken(name),token=req.get('x-disparazap-token');
 if(typeof token!=='string'||token.length!==expected.length||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return res.status(403).json({error:'Webhook inválido.'});
 const instance=one('SELECT * FROM instances WHERE name=?',name);
 if(!instance||protectedInstance(name)||req.body?.instance!==name)return res.status(403).json({error:'Instância inválida.'});
 const numbers=optOutPhones(req.body);let changed=0;
 db.exec('BEGIN');try{
 for(const number of numbers){
 const contact=one('SELECT * FROM contacts WHERE owner_id=? AND phone=?',instance.owner_id,number);if(!contact)continue;
 changed+=Number(run('UPDATE contacts SET consent=0,unsubscribed=1 WHERE id=? AND (consent!=0 OR unsubscribed!=1)',contact.id).changes);
 run("UPDATE jobs SET status='skipped',error='Descadastro solicitado por resposta SAIR',updated_at=CURRENT_TIMESTAMP WHERE contact_id=? AND status='pending'",contact.id);
 }
 if(changed)log(`${changed} contato(s) descadastrado(s) por resposta SAIR.`,instance.owner_id);
 db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 res.json({ok:true});
});
app.get('/health',(req,res)=>res.json({status:'ok',app:'DisparaZap'}));
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json(safeUser(req.user)));
app.post('/api/logout',(req,res)=>{run('DELETE FROM sessions WHERE token=?',req.sessionToken);res.clearCookie('dz_session');res.json({ok:true});});
async function evo(route,method='GET',body) {
  if(!process.env.EVOLUTION_API_KEY || !process.env.EVOLUTION_URL)throw new Error('Evolution API não configurada.');
  if(route.startsWith('/message/'))requireSendable(decodeURIComponent(route.split('/')[3]||''));
  const r=await fetch(process.env.EVOLUTION_URL.replace(/\/$/,'')+route,{method,headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const d=await r.json();if(!r.ok){let detail=evolutionErrorDetail(d);for(const value of [process.env.EVOLUTION_API_KEY,secret])if(value)detail=detail.split(value).join('[credencial ocultada]');throw new Error(`Evolution API respondeu HTTP ${r.status}.${detail?' '+detail:''}`);}return d;
}
const replyReady=new Map();
async function ensureReplyWebhook(name){
 if(protectedInstance(name)||!name.startsWith('dz-'))return false;
 const url=publicUrl+'/hooks/evolution/'+encodeURIComponent(name),token=webhookToken(name);
 try{
 let config=await evo('/webhook/find/'+nameValid(name));
 if(config?.url&&config.url!==url){replyReady.delete(name);return false;}
 const valid=c=>c?.enabled===true&&c.url===url&&c.webhookByEvents===false&&c.events?.includes('MESSAGES_UPSERT')&&c.headers?.['x-disparazap-token']===token;
 if(!valid(config)){
 await evo('/webhook/set/'+nameValid(name),'POST',{webhook:{enabled:true,url,headers:{'x-disparazap-token':token},webhookByEvents:false,webhookBase64:false,events:['MESSAGES_UPSERT']}});
 config=await evo('/webhook/find/'+nameValid(name));
 }
 if(!valid(config)){replyReady.delete(name);return false;}
 replyReady.set(name,Date.now()+60000);return true;
 }catch{replyReady.delete(name);return false;}
}
function protectedInstance(name){return String(name).toLowerCase()==='principal';}
function requireSendable(name){if(protectedInstance(name)){const e=new Error('Aparelho principal reservado para outro serviço. Escolha um aparelho exclusivo do DisparaZap.');e.status=403;throw e;}}
run("UPDATE campaigns SET status='paused' WHERE lower(instance)='principal' AND status='running'");
function nameValid(name){if(!/^[a-zA-Z0-9_-]{1,60}$/.test(name))throw new Error('Use letras sem acentos, números e hífen no nome da conexão.');return encodeURIComponent(name);}
async function instances(owner){const local=q('SELECT * FROM instances WHERE owner_id=?',owner);if(!local.length)return [];const d=await evo('/instance/fetchInstances');if(!Array.isArray(d))throw new Error('Resposta inesperada da Evolution API.');return local.map(i=>{const remote=d.find(x=>(x.name||x.instance?.instanceName)===i.name);return {name:i.name,label:i.label,sendable:!protectedInstance(i.name),protected:protectedInstance(i.name),state:remote?.connectionStatus||remote?.instance?.status||'close'};});}
function protectedControl(req,res,next){if(protectedInstance(req.params.name))return res.status(403).json({error:'Aparelho principal protegido. O DisparaZap não pode alterar esta conexão.'});next();}
function ownedInstance(req,res,next){if(!one('SELECT name FROM instances WHERE name=? AND owner_id=?',req.params.name,req.user.id))return res.status(404).json({error:'Conexão não encontrada.'});next();}
app.get('/api/integration',async(req,res)=>{try{const d=await evo('/');res.json({connected:true,version:d.version});}catch{res.json({connected:false,message:req.user.role==='admin'?'Integração Evolution pendente de configuração ou indisponível.':'Conexão temporariamente indisponível. Avise o administrador.'});}});
app.get('/api/instances',async(req,res)=>res.json(await instances(req.user.id)));
app.post('/api/instances',async(req,res)=>{const label=String(req.body.name||'').trim();if(!label||label.length>60)throw new Error('Informe um nome para sua conexão (até 60 caracteres).');const count=one('SELECT count(*) n FROM instances WHERE owner_id=?',req.user.id).n;if(count>=(req.user.role==='admin'?20:3))throw new Error('Limite de conexões desta conta atingido.');const name='dz-'+req.user.id.slice(0,8)+'-'+randomBytes(6).toString('hex');run('INSERT INTO instances(name,label,owner_id) VALUES(?,?,?)',name,label,req.user.id);try{await evo('/instance/create','POST',{instanceName:name,integration:'WHATSAPP-BAILEYS',qrcode:false});}catch(e){run('DELETE FROM instances WHERE name=?',name);throw e;}await ensureReplyWebhook(name);log('Conexão criada: '+label,req.user.id);res.json({ok:true,name});});
app.post('/api/instances/:name/pair',ownedInstance,protectedControl,rate,async(req,res)=>{const number=phone(req.body.phone);const d=await evo('/instance/connect/'+nameValid(req.params.name)+'?number='+encodeURIComponent(number));res.set('Cache-Control','no-store');if(d.error)throw new Error('Não foi possível gerar o código. Tente novamente ou use o QR Code.');const code=d.pairingCode||d.qrcode?.pairingCode;if(code&&/^[a-zA-Z0-9]{8}$/.test(code))return res.json({pairingCode:code,state:'connecting'});if(d.instance?.state==='open')return res.json({state:'open'});return res.status(409).json({error:'Código ainda indisponível. Aguarde alguns segundos e tente novamente. Se esta conexão já iniciou por QR Code, use o QR ou crie uma nova conexão para vincular pelo número.'});});
app.get('/api/instances/:name/qr',ownedInstance,protectedControl,async(req,res)=>{const d=await evo('/instance/connect/'+nameValid(req.params.name));res.json({base64:d.base64||d.qrcode?.base64||null,state:d.instance?.state||null});});
app.post('/api/instances/:name/proxy',ownedInstance,protectedControl,adminOnly,async(req,res)=>{const b=req.body;nameValid(req.params.name);if(typeof b.enabled!=='boolean')throw new Error('Informe se o proxy está ativo.');if(b.enabled&&(!/^[a-zA-Z0-9.-]{1,253}$/.test(b.host)||!Number.isInteger(Number(b.port))||Number(b.port)<1||Number(b.port)>65535||!['http','https','socks5'].includes(b.protocol)))throw new Error('Informe host, porta e protocolo válidos.');await evo('/proxy/set/'+nameValid(req.params.name),'POST',{enabled:b.enabled,host:b.host||'',port:String(b.port||''),protocol:b.protocol||'http',username:b.username||'',password:b.password||''});log('Configuração de proxy atualizada.',req.user.id);res.json({ok:true});});
app.get('/api/admin/users',adminOnly,(req,res)=>res.json(q('SELECT id,username,name,role,active,created_at FROM users ORDER BY created_at DESC').map(u=>({...safeUser(u),created_at:u.created_at}))));
app.post('/api/admin/users',adminOnly,(req,res)=>{const u=createUser(req.body);log('Usuário cadastrado pelo administrador: '+u.username);res.status(201).json(safeUser(u));});
app.patch('/api/admin/users/:id',adminOnly,(req,res)=>{if(req.params.id===req.user.id)throw new Error('Sua conta administrativa não pode ser desativada.');if(typeof req.body.active!=='boolean')throw new Error('Informe o estado da conta.');if(!one('SELECT id FROM users WHERE id=?',req.params.id))return res.status(404).json({error:'Usuário não encontrado.'});run('UPDATE users SET active=? WHERE id=?',req.body.active?1:0,req.params.id);if(!req.body.active){run('DELETE FROM sessions WHERE user_id=?',req.params.id);run("UPDATE campaigns SET status='paused' WHERE owner_id=? AND status='running'",req.params.id);}log('Estado de usuário atualizado.');res.json({ok:true});});
app.get('/api/contacts',(req,res)=>res.json(q('SELECT * FROM contacts WHERE owner_id=? ORDER BY created_at DESC LIMIT 10000',req.user.id)));
app.post('/api/contacts',(req,res)=>{const b=req.body;if(!b.name?.trim())throw new Error('Informe o nome.');run('INSERT INTO contacts(id,name,phone,list,consent,owner_id) VALUES(?,?,?,?,?,?)',randomUUID(),b.name.trim().slice(0,120),phone(b.phone),String(b.list||'Geral').slice(0,80),b.consent===true?1:0,req.user.id);log('Contato cadastrado.',req.user.id);res.json({ok:true});});
app.patch('/api/contacts/:id',(req,res)=>{const b=req.body;if(!one('SELECT id FROM contacts WHERE id=? AND owner_id=?',req.params.id,req.user.id))return res.status(404).json({error:'Registro não encontrado.'});if(typeof b.consent==='boolean')run('UPDATE contacts SET consent=? WHERE id=?',b.consent?1:0,req.params.id);if(typeof b.unsubscribed==='boolean')run('UPDATE contacts SET unsubscribed=? WHERE id=?',b.unsubscribed?1:0,req.params.id);res.json({ok:true});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:8}});
app.post('/api/contacts/import',upload.single('file'),(req,res)=>{if(!req.file)throw new Error('Selecione o arquivo.');const result=importContacts(req.file.buffer,req.file.originalname);let added=0;db.exec('BEGIN');try{for(const c of result.contacts)added+=Number(run('INSERT OR IGNORE INTO contacts(id,name,phone,list,consent,owner_id) VALUES(?,?,?,?,?,?)',randomUUID(),c.name,c.phone,String(req.body.list||'Geral').slice(0,80),req.body.consent==='true'?1:0,req.user.id).changes);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}log(`${added} contatos importados.`,req.user.id);res.json({added,invalid:result.invalid,duplicates:result.duplicates+result.contacts.length-added});});
app.post('/api/media',upload.single('file'),(req,res)=>{const f=req.file;if(!f)throw new Error('Selecione uma imagem ou vídeo.');let mime;
  if(f.buffer[0]===0xff&&f.buffer[1]===0xd8&&f.buffer[2]===0xff)mime='image/jpeg';
  else if(f.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(f.buffer.subarray(4,8).toString()==='ftyp')mime='video/mp4';
  else throw new Error('Use uma imagem JPG/PNG ou vídeo MP4 de até 20 MB.');
  const id=randomUUID(), dest=path.join(dataDir,'media',id);writeFileSync(dest,f.buffer,{mode:0o600});run('INSERT INTO media(id,name,mime,path,owner_id) VALUES(?,?,?,?,?)',id,path.basename(f.originalname),mime,dest,req.user.id);res.json({id,name:f.originalname,mime});});
app.get('/api/media/:id',(req,res)=>{const m=one('SELECT * FROM media WHERE id=? AND owner_id=?',req.params.id,req.user.id);if(!m)return res.status(404).json({error:'Registro não encontrado.'});res.set('Content-Type',m.mime);res.sendFile(m.path);});
function templateInput(b,owner){
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>120)throw new Error('Informe o nome do modelo (até 120 caracteres).');
 if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4000)throw new Error('Informe a mensagem (até 4.000 caracteres).');
 const media=b.mediaId||null;if(media&&!one('SELECT id FROM media WHERE id=? AND owner_id=?',media,owner))throw new Error('Mídia não encontrada.');
 return {name:b.name.trim(),text:b.text,media};
}
app.get('/api/templates',(req,res)=>res.json(q('SELECT t.*,m.mime media_mime,m.name media_name FROM templates t LEFT JOIN media m ON m.id=t.media_id WHERE t.owner_id=? ORDER BY t.updated_at DESC,t.rowid DESC',req.user.id)));
app.post('/api/templates',(req,res)=>{const v=templateInput(req.body,req.user.id),id=randomUUID();run('INSERT INTO templates(id,name,text,media_id,owner_id) VALUES(?,?,?,?,?)',id,v.name,v.text,v.media,req.user.id);log('Modelo de mensagem cadastrado: '+v.name,req.user.id);res.status(201).json({id});});
app.patch('/api/templates/:id',(req,res)=>{if(!one('SELECT id FROM templates WHERE id=? AND owner_id=?',req.params.id,req.user.id))return res.status(404).json({error:'Modelo não encontrado.'});const v=templateInput(req.body,req.user.id);run('UPDATE templates SET name=?,text=?,media_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?',v.name,v.text,v.media,req.params.id,req.user.id);res.json({ok:true});});
app.delete('/api/templates/:id',(req,res)=>{const result=run('DELETE FROM templates WHERE id=? AND owner_id=?',req.params.id,req.user.id);if(!result.changes)return res.status(404).json({error:'Modelo não encontrado.'});res.json({ok:true});});
app.get('/api/campaigns',(req,res)=>res.json(q(`SELECT c.*, (SELECT count(*) FROM jobs WHERE campaign_id=c.id) total,(SELECT count(*) FROM jobs WHERE campaign_id=c.id AND status='sent') sent,(SELECT count(*) FROM jobs WHERE campaign_id=c.id AND status IN ('failed','uncertain')) failed FROM campaigns c WHERE c.owner_id=? ORDER BY c.created_at DESC`,req.user.id)));
app.get('/api/campaigns/:id/jobs',(req,res)=>res.json(q('SELECT j.status,j.error,j.message_id,c.name,c.phone FROM jobs j JOIN contacts c ON c.id=j.contact_id WHERE campaign_id=? AND j.campaign_id IN (SELECT id FROM campaigns WHERE owner_id=?)',req.params.id,req.user.id)));
function campaignReport(id,owner){
 const campaign=one('SELECT id,name,instance,list,status,schedule,text,media_id FROM campaigns WHERE id=? AND owner_id=?',id,owner);if(!campaign)return null;
 const rows=q('SELECT j.id,j.status,j.error,j.message_id,j.updated_at,c.name,c.phone FROM jobs j JOIN contacts c ON c.id=j.contact_id WHERE j.campaign_id=? ORDER BY j.rowid',id).map(j=>({...j,reason:reportReason(j,campaign)}));
 const summary={total:rows.length,pending:0,sending:0,sent:0,failed:0,uncertain:0,skipped:0,cancelled:0};for(const row of rows)summary[row.status]=(summary[row.status]||0)+1;
 return {campaign,summary,rows,generatedAt:new Date().toISOString()};
}
app.get('/api/campaigns/:id/report',(req,res)=>{const report=campaignReport(req.params.id,req.user.id);if(!report)return res.status(404).json({error:'Campanha não encontrada.'});res.set('Cache-Control','no-store');res.json(report);});
app.get('/api/campaigns/:id/report.csv',(req,res)=>{const report=campaignReport(req.params.id,req.user.id);if(!report)return res.status(404).json({error:'Campanha não encontrada.'});const rows=reportFilter(report.rows,String(req.query.status||'all'));res.set({'Cache-Control':'no-store','Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="relatorio-campanha.csv"'});res.send(reportCsv(report.campaign,rows));});
app.post('/api/campaigns',async(req,res)=>{const b=req.body,v=campaignInput(b);requireSendable(b.instance);if(!(await instances(req.user.id)).some(i=>i.name===b.instance))throw new Error('Conexão não encontrada.');if(b.mediaId&&!one('SELECT id FROM media WHERE id=? AND owner_id=?',b.mediaId,req.user.id))throw new Error('Mídia não encontrada.');const contacts=q('SELECT id FROM contacts WHERE list=? AND owner_id=? AND consent=1 AND unsubscribed=0',b.list,req.user.id);if(!contacts.length)throw new Error('A lista precisa ter contatos autorizados e ativos.');const id=randomUUID();db.exec('BEGIN');try{run('INSERT INTO campaigns(id,name,instance,text,list,media_id,min_delay,max_delay,daily_limit,schedule,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,b.name.trim(),b.instance,b.text,b.list,b.mediaId||null,v.min,v.max,v.daily,b.schedule||null,req.user.id);for(const c of contacts)run('INSERT INTO jobs(id,campaign_id,contact_id) VALUES(?,?,?)',randomUUID(),id,c.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}log('Campanha salva como rascunho: '+b.name,req.user.id);res.json({id,total:contacts.length});});
app.post('/api/campaigns/:id/action',async(req,res)=>{const c=one('SELECT * FROM campaigns WHERE id=? AND owner_id=?',req.params.id,req.user.id);if(!c)return res.status(404).json({error:'Registro não encontrado.'});const action=req.body.action;if(!['start','pause','cancel'].includes(action))throw new Error('Ação inválida.');if(action==='start'){requireSendable(c.instance);if(!['draft','paused'].includes(c.status))throw new Error('Esta campanha não pode ser iniciada.');await ensureReplyWebhook(c.instance);const state=await evo('/instance/connectionState/'+nameValid(c.instance));if(state.instance?.state!=='open')throw new Error('Conecte o WhatsApp antes de iniciar.');run("UPDATE campaigns SET status='running' WHERE id=?",c.id);}else if(action==='pause'){run("UPDATE campaigns SET status='paused' WHERE id=? AND status='running'",c.id);}else{run("UPDATE campaigns SET status='cancelled' WHERE id=? AND status!='completed'",c.id);run("UPDATE jobs SET status='cancelled' WHERE campaign_id=? AND status='pending'",c.id);}log(`${action==='start'?'Iniciada':action==='pause'?'Pausada':'Cancelada'}: ${c.name}`,req.user.id);res.json({ok:true});});
app.get('/api/dashboard',(req,res)=>res.json({contacts:one('SELECT count(*) n FROM contacts WHERE owner_id=?',req.user.id).n,eligible:one('SELECT count(*) n FROM contacts WHERE owner_id=? AND consent=1 AND unsubscribed=0',req.user.id).n,campaigns:one('SELECT count(*) n FROM campaigns WHERE owner_id=?',req.user.id).n,sent:one("SELECT count(*) n FROM jobs WHERE status='sent' AND campaign_id IN (SELECT id FROM campaigns WHERE owner_id=?)",req.user.id).n,activity:q('SELECT * FROM activity WHERE owner_id=? ORDER BY id DESC LIMIT 8',req.user.id)}));
// Import existing Evolution connections once, exclusively into the administrator's account.
async function adoptExisting(){if(one("SELECT value FROM metadata WHERE key='instances_adopted'"))return;try{const all=await evo('/instance/fetchInstances');if(!Array.isArray(all))return;for(const i of all){const name=i.name||i.instance?.instanceName;if(name)run('INSERT OR IGNORE INTO instances(name,label,owner_id) VALUES(?,?,?)',name,name,adminId);}run("INSERT OR IGNORE INTO metadata VALUES('instances_adopted','1')");}catch{/* Retry after integration is configured. */}}
let working=false;
async function tick(){if(working)return;working=true;try{
 await adoptExisting();
 for(const c of q("SELECT c.* FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE c.status='running' AND c.next_at<=? AND u.active=1",Date.now())){
  if(protectedInstance(c.instance)){run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);continue;}
  if(!one('SELECT name FROM instances WHERE name=? AND owner_id=?',c.instance,c.owner_id)){run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);continue;}
  if(c.schedule&&Date.parse(c.schedule)>Date.now())continue;
  const limit=one('SELECT next_at FROM instance_limits WHERE instance=?',c.instance);if(limit?.next_at>Date.now())continue;
  const count=one("SELECT count(*) n FROM jobs j JOIN campaigns c ON c.id=j.campaign_id WHERE c.instance=? AND j.status IN ('sent','sending','uncertain') AND j.updated_at>=?",c.instance,new Date(Date.now()-86400000).toISOString().replace('T',' ').slice(0,19)).n;
  if(count>=c.daily_limit)continue;
  const job=one("SELECT j.id job_id,c.id contact_id,c.name,c.phone,c.consent,c.unsubscribed FROM jobs j JOIN contacts c ON c.id=j.contact_id WHERE j.campaign_id=? AND j.status='pending' ORDER BY j.rowid LIMIT 1",c.id);
  if(!job){run("UPDATE campaigns SET status='completed' WHERE id=? AND status='running'",c.id);log('Campanha finalizada: '+c.name,c.owner_id);continue;}
  if(!job.consent||job.unsubscribed){run("UPDATE jobs SET status='skipped',error='Contato sem autorização ou descadastrado',updated_at=CURRENT_TIMESTAMP WHERE id=?",job.job_id);continue;}
  let state;try{state=await evo('/instance/connectionState/'+nameValid(c.instance));}catch{run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);log('Campanha pausada: não foi possível verificar a conexão.',c.owner_id);continue;}if(state.instance?.state!=='open'){run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);log('Campanha pausada: WhatsApp desconectado.',c.owner_id);continue;}
  if((replyReady.get(c.instance)||0)<Date.now())await ensureReplyWebhook(c.instance);
  // Pause/cancel may occur while checking connection; recheck immediately before sending.
  if(one('SELECT status FROM campaigns WHERE id=?',c.id)?.status!=='running')continue;
  const current=one('SELECT consent,unsubscribed FROM contacts WHERE id=? AND owner_id=?',job.contact_id,c.owner_id);if(!current?.consent||current.unsubscribed)continue;
  const footer=(replyReady.get(c.instance)||0)>Date.now()?replyOptOutFooter:'Para não receber mais mensagens: '+publicUrl+'/sair/'+job.contact_id+'?token='+sign('unsubscribe:'+job.contact_id);
  let text=personalize(c.text,job)+'\n\n'+footer;
  run("UPDATE jobs SET status='sending',updated_at=CURRENT_TIMESTAMP WHERE id=?",job.job_id);
  const delay=randomInt(c.min_delay,c.max_delay+1)*1000, next=Date.now()+delay;
  run('INSERT INTO instance_limits VALUES(?,?) ON CONFLICT(instance) DO UPDATE SET next_at=excluded.next_at',c.instance,next);
  run('UPDATE campaigns SET next_at=? WHERE id=?',next,c.id);
  try{let result;if(c.media_id){const m=one('SELECT * FROM media WHERE id=?',c.media_id);result=await evo('/message/sendMedia/'+nameValid(c.instance),'POST',{number:job.phone,mediatype:m.mime.startsWith('image')?'image':'video',mimetype:m.mime,caption:text,media:readFileSync(m.path).toString('base64'),fileName:m.name});}else result=await evo('/message/sendText/'+nameValid(c.instance),'POST',{number:job.phone,text,linkPreview:false});
   run("UPDATE jobs SET status='sent',message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",result.key?.id||null,job.job_id);
  }catch(e){run("UPDATE jobs SET status='uncertain',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",'Envio não confirmado: '+e.message,job.job_id);run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);log('Campanha pausada após falha de envio: '+c.name,c.owner_id);}
 }
}catch(e){console.error('Worker:',e.message);}finally{working=false;}}
await adoptExisting();
const timer=setInterval(tick,2000);
app.use(express.static('public'));
app.use((err,req,res,next)=>{const message=String(err.code).startsWith('SQLITE_CONSTRAINT')?'Este registro já existe ou possui dados inválidos.':err.message;res.status(err.status||(err instanceof multer.MulterError?413:400)).json({error:message||'Não foi possível concluir.'});});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('DisparaZap iniciado.'));
async function shutdown(){clearInterval(timer);server.close();for(let i=0;working&&i<50;i++)await new Promise(r=>setTimeout(r,1000));db.close();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
