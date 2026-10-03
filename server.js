import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHmac, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { phone, personalize, importContacts, campaignInput } from './core.js';
const app = express(), dataDir = path.resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive:true }); mkdirSync(path.join(dataDir,'media'),{recursive:true});
const secret = process.env.SESSION_SECRET, password = process.env.ADMIN_PASSWORD;
if (!secret || secret.length < 32 || !password || password.length < 12) throw new Error('Configure SESSION_SECRET (32+) e ADMIN_PASSWORD (12+).');
const admin = process.env.ADMIN_USER || 'admin', passwordHash = scryptSync(password, secret, 64);
const db = new DatabaseSync(path.join(dataDir,'disparazap.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,list TEXT NOT NULL,consent INTEGER NOT NULL DEFAULT 0,unsubscribed INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT,mime TEXT,path TEXT);
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,name TEXT,instance TEXT,text TEXT,list TEXT,media_id TEXT REFERENCES media(id),status TEXT DEFAULT 'draft',min_delay INTEGER,max_delay INTEGER,daily_limit INTEGER,schedule TEXT,next_at INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),contact_id TEXT REFERENCES contacts(id),status TEXT DEFAULT 'pending',error TEXT,message_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(campaign_id,contact_id));
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,description TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER);
CREATE TABLE IF NOT EXISTS instance_limits(instance TEXT PRIMARY KEY,next_at INTEGER DEFAULT 0);
`);
// Interrupted requests have unknown results. Never resend them automatically.
db.exec("UPDATE jobs SET status='uncertain',error='Servidor reiniciado durante envio. Verifique no WhatsApp antes de reenviar.' WHERE status='sending'");
const q=(sql,...args)=>db.prepare(sql).all(...args), one=(sql,...args)=>db.prepare(sql).get(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
const log=description=>run('INSERT INTO activity(description) VALUES(?)',description);
app.set('trust proxy',1); app.use(helmet()); app.use(express.json({limit:'256kb'}));
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
app.use((req,res,next)=>{ if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin!==publicUrl) return res.status(403).json({error:'Origem não autorizada.'}); next(); });
const sign=t=>createHmac('sha256',secret).update(t).digest('hex');
function auth(req,res,next) {
  const cookie = (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dz_session='))?.slice(11);
  if (!cookie) return res.status(401).json({error:'Faça login para continuar.'});
  const [token,signature]=cookie.split('.'), expected=sign(token||'');
  if (!signature || signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) || !one('SELECT token FROM sessions WHERE token=? AND expires>?',token,Date.now())) return res.status(401).json({error:'Sessão expirada.'});
  req.sessionToken=token; next();
}
const failures=new Map();
app.post('/api/login',(req,res)=>{
  const key=req.ip, record=failures.get(key)||{n:0,until:0};
  if(record.until>Date.now() && record.n>=8)return res.status(429).json({error:'Muitas tentativas. Aguarde 15 minutos.'});
  if(record.until<=Date.now()){record.n=0;record.until=Date.now()+900000;}
  const valid=typeof req.body.password==='string' && req.body.password.length<=256 && timingSafeEqual(scryptSync(req.body.password,secret,64),passwordHash) && req.body.user===admin;
  if(!valid){record.n++;failures.set(key,record);return res.status(401).json({error:'Usuário ou senha incorretos.'});}
  failures.delete(key); const token=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires<?',Date.now());run('INSERT INTO sessions VALUES(?,?)',token,Date.now()+43200000);
  res.cookie('dz_session',token+'.'+sign(token),{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'strict',maxAge:43200000,path:'/'});res.json({user:admin});
});
function unsubscribeValid(id,token){const expected=sign('unsubscribe:'+id);return typeof token==='string'&&token.length===expected.length&&timingSafeEqual(Buffer.from(token),Buffer.from(expected));}
app.get('/sair/:id',(req,res)=>{if(!unsubscribeValid(req.params.id,req.query.token))return res.status(403).send('Link inválido.');res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DisparaZap · Descadastro</title><link rel="stylesheet" href="/style.css"><body><main><h1>Você escolhe suas conversas.</h1><p>Confirme para deixar de receber campanhas do DisparaZap.</p><form method="post"><input type="hidden" name="token" value="${req.query.token}"><button class="button primary">Não quero receber mensagens</button></form></main></body></html>`);});
app.post('/sair/:id',express.urlencoded({extended:false}),(req,res)=>{if(!unsubscribeValid(req.params.id,req.body.token))return res.status(403).send('Link inválido.');run('UPDATE contacts SET unsubscribed=1,consent=0 WHERE id=?',req.params.id);log('Descadastro solicitado por contato.');res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro confirmado</title><link rel="stylesheet" href="/style.css"><body><main><h1>Descadastro confirmado.</h1><p>Você não receberá novas campanhas do DisparaZap.</p></main></body></html>');});
app.get('/health',(req,res)=>res.json({status:'ok',app:'DisparaZap'}));
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json({user:admin}));
app.post('/api/logout',(req,res)=>{run('DELETE FROM sessions WHERE token=?',req.sessionToken);res.clearCookie('dz_session');res.json({ok:true});});
async function evo(route,method='GET',body) {
  if(!process.env.EVOLUTION_API_KEY || !process.env.EVOLUTION_URL)throw new Error('Evolution API não configurada.');
  const r=await fetch(process.env.EVOLUTION_URL.replace(/\/$/,'')+route,{method,headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const d=await r.json();if(!r.ok)throw new Error(`Evolution API respondeu HTTP ${r.status}.`);return d;
}
function nameValid(name){if(!/^[a-zA-Z0-9_-]{1,60}$/.test(name))throw new Error('Use letras sem acentos, números e hífen no nome da conexão.');return encodeURIComponent(name);}
async function instances(){const d=await evo('/instance/fetchInstances');if(!Array.isArray(d))throw new Error('Resposta inesperada da Evolution API.');return d.map(x=>({name:x.name||x.instance?.instanceName,state:x.connectionStatus||x.instance?.status||'close'}));}
app.get('/api/instances',async(req,res)=>res.json(await instances()));
app.post('/api/instances',async(req,res)=>{const name=req.body.name;nameValid(name);if(!name.startsWith('dz-'))throw new Error('Novas conexões devem começar com dz-.');await evo('/instance/create','POST',{instanceName:name,integration:'WHATSAPP-BAILEYS',qrcode:true});log('Conexão criada: '+name);res.json({ok:true});});
app.get('/api/instances/:name/qr',async(req,res)=>{const d=await evo('/instance/connect/'+nameValid(req.params.name));res.json({base64:d.base64||d.qrcode?.base64||null,state:d.instance?.state||null});});
app.post('/api/instances/:name/proxy',async(req,res)=>{const b=req.body;nameValid(req.params.name);if(typeof b.enabled!=='boolean')throw new Error('Informe se o proxy está ativo.');if(b.enabled&&(!/^[a-zA-Z0-9.-]{1,253}$/.test(b.host)||!Number.isInteger(Number(b.port))||Number(b.port)<1||Number(b.port)>65535||!['http','https','socks5'].includes(b.protocol)))throw new Error('Informe host, porta e protocolo válidos.');await evo('/proxy/set/'+nameValid(req.params.name),'POST',{enabled:b.enabled,host:b.host||'',port:String(b.port||''),protocol:b.protocol||'http',username:b.username||'',password:b.password||''});log('Configuração de proxy atualizada: '+req.params.name);res.json({ok:true});});
app.get('/api/contacts',(req,res)=>res.json(q('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 10000')));
app.post('/api/contacts',(req,res)=>{const b=req.body;if(!b.name?.trim())throw new Error('Informe o nome.');run('INSERT INTO contacts(id,name,phone,list,consent) VALUES(?,?,?,?,?)',randomUUID(),b.name.trim().slice(0,120),phone(b.phone),String(b.list||'Geral').slice(0,80),b.consent===true?1:0);log('Contato cadastrado.');res.json({ok:true});});
app.patch('/api/contacts/:id',(req,res)=>{const b=req.body;if(!one('SELECT id FROM contacts WHERE id=?',req.params.id))return res.sendStatus(404);if(typeof b.consent==='boolean')run('UPDATE contacts SET consent=? WHERE id=?',b.consent?1:0,req.params.id);if(typeof b.unsubscribed==='boolean')run('UPDATE contacts SET unsubscribed=? WHERE id=?',b.unsubscribed?1:0,req.params.id);res.json({ok:true});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:8}});
app.post('/api/contacts/import',upload.single('file'),(req,res)=>{if(!req.file)throw new Error('Selecione o arquivo.');const result=importContacts(req.file.buffer,req.file.originalname);let added=0;db.exec('BEGIN');try{for(const c of result.contacts)added+=Number(run('INSERT OR IGNORE INTO contacts(id,name,phone,list,consent) VALUES(?,?,?,?,?)',randomUUID(),c.name,c.phone,String(req.body.list||'Geral').slice(0,80),req.body.consent==='true'?1:0).changes);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}log(`${added} contatos importados.`);res.json({added,invalid:result.invalid,duplicates:result.duplicates+result.contacts.length-added});});
app.post('/api/media',upload.single('file'),(req,res)=>{const f=req.file;if(!f)throw new Error('Selecione uma imagem ou vídeo.');let mime;
  if(f.buffer[0]===0xff&&f.buffer[1]===0xd8&&f.buffer[2]===0xff)mime='image/jpeg';
  else if(f.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(f.buffer.subarray(4,8).toString()==='ftyp')mime='video/mp4';
  else throw new Error('Use uma imagem JPG/PNG ou vídeo MP4 de até 20 MB.');
  const id=randomUUID(), dest=path.join(dataDir,'media',id);writeFileSync(dest,f.buffer,{mode:0o600});run('INSERT INTO media VALUES(?,?,?,?)',id,path.basename(f.originalname),mime,dest);res.json({id,name:f.originalname,mime});});
app.get('/api/media/:id',(req,res)=>{const m=one('SELECT * FROM media WHERE id=?',req.params.id);if(!m)return res.sendStatus(404);res.set('Content-Type',m.mime);res.sendFile(m.path);});
app.get('/api/campaigns',(req,res)=>res.json(q(`SELECT c.*, (SELECT count(*) FROM jobs WHERE campaign_id=c.id) total,(SELECT count(*) FROM jobs WHERE campaign_id=c.id AND status='sent') sent,(SELECT count(*) FROM jobs WHERE campaign_id=c.id AND status IN ('failed','uncertain')) failed FROM campaigns c ORDER BY c.created_at DESC`)));
app.get('/api/campaigns/:id/jobs',(req,res)=>res.json(q('SELECT j.status,j.error,j.message_id,c.name,c.phone FROM jobs j JOIN contacts c ON c.id=j.contact_id WHERE campaign_id=?',req.params.id)));
app.post('/api/campaigns',async(req,res)=>{const b=req.body,v=campaignInput(b);if(!(await instances()).some(i=>i.name===b.instance))throw new Error('Conexão não encontrada.');if(b.mediaId&&!one('SELECT id FROM media WHERE id=?',b.mediaId))throw new Error('Mídia não encontrada.');const contacts=q('SELECT id FROM contacts WHERE list=? AND consent=1 AND unsubscribed=0',b.list);if(!contacts.length)throw new Error('A lista precisa ter contatos autorizados e ativos.');const id=randomUUID();db.exec('BEGIN');try{run('INSERT INTO campaigns(id,name,instance,text,list,media_id,min_delay,max_delay,daily_limit,schedule) VALUES(?,?,?,?,?,?,?,?,?,?)',id,b.name.trim(),b.instance,b.text,b.list,b.mediaId||null,v.min,v.max,v.daily,b.schedule||null);for(const c of contacts)run('INSERT INTO jobs(id,campaign_id,contact_id) VALUES(?,?,?)',randomUUID(),id,c.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}log('Campanha salva como rascunho: '+b.name);res.json({id,total:contacts.length});});
app.post('/api/campaigns/:id/action',async(req,res)=>{const c=one('SELECT * FROM campaigns WHERE id=?',req.params.id);if(!c)return res.sendStatus(404);const action=req.body.action;if(!['start','pause','cancel'].includes(action))throw new Error('Ação inválida.');if(action==='start'){if(!['draft','paused'].includes(c.status))throw new Error('Esta campanha não pode ser iniciada.');const state=await evo('/instance/connectionState/'+nameValid(c.instance));if(state.instance?.state!=='open')throw new Error('Conecte o WhatsApp antes de iniciar.');run("UPDATE campaigns SET status='running' WHERE id=?",c.id);}else if(action==='pause'){run("UPDATE campaigns SET status='paused' WHERE id=? AND status='running'",c.id);}else{run("UPDATE campaigns SET status='cancelled' WHERE id=? AND status!='completed'",c.id);run("UPDATE jobs SET status='cancelled' WHERE campaign_id=? AND status='pending'",c.id);}log(`${action==='start'?'Iniciada':action==='pause'?'Pausada':'Cancelada'}: ${c.name}`);res.json({ok:true});});
app.get('/api/dashboard',(req,res)=>res.json({contacts:one('SELECT count(*) n FROM contacts').n,eligible:one('SELECT count(*) n FROM contacts WHERE consent=1 AND unsubscribed=0').n,campaigns:one('SELECT count(*) n FROM campaigns').n,sent:one("SELECT count(*) n FROM jobs WHERE status='sent'").n,activity:q('SELECT * FROM activity ORDER BY id DESC LIMIT 8')}));
let working=false;
async function tick(){if(working)return;working=true;try{
 for(const c of q("SELECT * FROM campaigns WHERE status='running' AND next_at<=?",Date.now())){
  if(c.schedule&&Date.parse(c.schedule)>Date.now())continue;
  const limit=one('SELECT next_at FROM instance_limits WHERE instance=?',c.instance);if(limit?.next_at>Date.now())continue;
  const count=one("SELECT count(*) n FROM jobs j JOIN campaigns c ON c.id=j.campaign_id WHERE c.instance=? AND j.status IN ('sent','sending','uncertain') AND j.updated_at>=?",c.instance,new Date(Date.now()-86400000).toISOString().replace('T',' ').slice(0,19)).n;
  if(count>=c.daily_limit)continue;
  const job=one("SELECT j.id job_id,c.id contact_id,c.name,c.phone,c.consent,c.unsubscribed FROM jobs j JOIN contacts c ON c.id=j.contact_id WHERE j.campaign_id=? AND j.status='pending' ORDER BY j.rowid LIMIT 1",c.id);
  if(!job){run("UPDATE campaigns SET status='completed' WHERE id=? AND status='running'",c.id);log('Campanha finalizada: '+c.name);continue;}
  if(!job.consent||job.unsubscribed){run("UPDATE jobs SET status='skipped',error='Contato sem autorização ou descadastrado',updated_at=CURRENT_TIMESTAMP WHERE id=?",job.job_id);continue;}
  const state=await evo('/instance/connectionState/'+nameValid(c.instance));if(state.instance?.state!=='open'){run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);log('Campanha pausada: WhatsApp desconectado.');continue;}
  // Pause/cancel may occur while checking connection; recheck immediately before sending.
  if(one('SELECT status FROM campaigns WHERE id=?',c.id)?.status!=='running')continue;
  const current=one('SELECT consent,unsubscribed FROM contacts WHERE phone=?',job.phone);if(!current?.consent||current.unsubscribed)continue;
  let text=personalize(c.text,job)+'\n\nPara não receber mais mensagens: '+publicUrl+'/sair/'+job.contact_id+'?token='+sign('unsubscribe:'+job.contact_id);
  run("UPDATE jobs SET status='sending',updated_at=CURRENT_TIMESTAMP WHERE id=?",job.job_id);
  const delay=randomInt(c.min_delay,c.max_delay+1)*1000, next=Date.now()+delay;
  run('INSERT INTO instance_limits VALUES(?,?) ON CONFLICT(instance) DO UPDATE SET next_at=excluded.next_at',c.instance,next);
  run('UPDATE campaigns SET next_at=? WHERE id=?',next,c.id);
  try{let result;if(c.media_id){const m=one('SELECT * FROM media WHERE id=?',c.media_id);result=await evo('/message/sendMedia/'+nameValid(c.instance),'POST',{number:job.phone,mediatype:m.mime.startsWith('image')?'image':'video',mimetype:m.mime,caption:text,media:readFileSync(m.path).toString('base64'),fileName:m.name});}else result=await evo('/message/sendText/'+nameValid(c.instance),'POST',{number:job.phone,text,linkPreview:false});
   run("UPDATE jobs SET status='sent',message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",result.key?.id||null,job.job_id);
  }catch(e){run("UPDATE jobs SET status='uncertain',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",'Envio não confirmado: '+e.message,job.job_id);run("UPDATE campaigns SET status='paused' WHERE id=?",c.id);log('Campanha pausada após falha de envio: '+c.name);}
 }
}catch(e){console.error('Worker:',e.message);}finally{working=false;}}
const timer=setInterval(tick,2000);
app.use(express.static('public'));
app.use((err,req,res,next)=>{const message=err.code==='SQLITE_CONSTRAINT_UNIQUE'?'Este telefone já está cadastrado.':err.message;res.status(err instanceof multer.MulterError?413:400).json({error:message||'Não foi possível concluir.'});});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('DisparaZap iniciado.'));
async function shutdown(){clearInterval(timer);server.close();for(let i=0;working&&i<50;i++)await new Promise(r=>setTimeout(r,1000));db.close();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
