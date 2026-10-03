import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
export function hashPassword(password) { const salt=randomBytes(16).toString('hex'); return {salt,hash:scryptSync(password,salt,64).toString('hex')}; }
export function initialize(db, admin, password) {
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,list TEXT NOT NULL,consent INTEGER NOT NULL DEFAULT 0,unsubscribed INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,owner_id TEXT REFERENCES users(id),UNIQUE(owner_id,phone));
 CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT,mime TEXT,path TEXT,owner_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,name TEXT,instance TEXT,text TEXT,list TEXT,media_id TEXT REFERENCES media(id),status TEXT DEFAULT 'draft',min_delay INTEGER,max_delay INTEGER,daily_limit INTEGER,schedule TEXT,next_at INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,owner_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,text TEXT NOT NULL,media_id TEXT REFERENCES media(id),owner_id TEXT NOT NULL REFERENCES users(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),contact_id TEXT REFERENCES contacts(id),status TEXT DEFAULT 'pending',error TEXT,message_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(campaign_id,contact_id));
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,description TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,owner_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER,user_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS instance_limits(instance TEXT PRIMARY KEY,next_at INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS instances(name TEXT PRIMARY KEY,label TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);
 `);
 let owner=db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").get();
 const credential=hashPassword(password);
 if(!owner){owner={id:randomUUID()};db.prepare('INSERT INTO users(id,username,name,password_hash,salt,role) VALUES(?,?,?,?,?,?)').run(owner.id,admin,admin,credential.hash,credential.salt,'admin');}
 else {db.prepare("UPDATE users SET username=?,password_hash=?,salt=?,active=1 WHERE id=?").run(admin,credential.hash,credential.salt,owner.id);}
 // Upgrade the old single-account database without losing IDs or job references.
 if(!db.prepare('PRAGMA table_info(contacts)').all().some(c=>c.name==='owner_id')){
  db.exec('PRAGMA foreign_keys=OFF; BEGIN');
  try {
   db.exec(`CREATE TABLE contacts_new(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,list TEXT NOT NULL,consent INTEGER NOT NULL DEFAULT 0,unsubscribed INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,owner_id TEXT REFERENCES users(id),UNIQUE(owner_id,phone));`);
   db.prepare('INSERT INTO contacts_new SELECT id,name,phone,list,consent,unsubscribed,created_at,? FROM contacts').run(owner.id);
   db.exec('DROP TABLE contacts; ALTER TABLE contacts_new RENAME TO contacts; COMMIT;');
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
 }
 for(const table of ['campaigns','media','activity']){
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='owner_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN owner_id TEXT REFERENCES users(id)`);
  db.prepare(`UPDATE ${table} SET owner_id=? WHERE owner_id IS NULL`).run(owner.id);
 }
 if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='user_id'))db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id)');
 db.exec('DELETE FROM sessions WHERE user_id IS NULL');
 db.prepare('UPDATE contacts SET owner_id=? WHERE owner_id IS NULL').run(owner.id);
 db.exec("CREATE INDEX IF NOT EXISTS templates_owner ON templates(owner_id); CREATE INDEX IF NOT EXISTS contacts_owner ON contacts(owner_id); CREATE INDEX IF NOT EXISTS campaigns_owner ON campaigns(owner_id); CREATE INDEX IF NOT EXISTS jobs_campaign_status ON jobs(campaign_id,status); UPDATE jobs SET status='uncertain',error='Servidor reiniciado durante envio. Verifique no WhatsApp antes de reenviar.' WHERE status='sending'");
 const problems=db.prepare('PRAGMA foreign_key_check').all();if(problems.length)throw new Error('Falha na integridade da migração.');
 return owner.id;
}
