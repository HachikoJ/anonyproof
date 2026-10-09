import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { randomBytes } from 'node:crypto'
import { projectRoot, startBackend, Client } from './helpers'
import { DEMO_TEMPLATE_IDS } from '../../server/demo'
import { cleanupIdentityBatch, countIdentityRetention, startIdentityRetention,
  IDENTITY_RETENTION_INTERVAL_MS } from '../../server/utils/identityRetention'

const Database = createRequire(projectRoot + '/server/package.json')('better-sqlite3') as typeof import('better-sqlite3')
const now = Date.parse('2026-10-08T12:00:00Z')
const day = 86400000
function fixture() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE client_identities(device_id TEXT PRIMARY KEY,token_hash TEXT,recovery_hash TEXT,created_at INTEGER,last_seen_at INTEGER);
    CREATE TABLE client_identity_sessions(token_hash TEXT PRIMARY KEY,device_id TEXT,created_at INTEGER,last_seen_at INTEGER,expires_at INTEGER);
    CREATE TABLE client_identity_install_keys(install_key_hash TEXT PRIMARY KEY,device_id TEXT,created_at INTEGER,last_seen_at INTEGER);
    CREATE TABLE feedbacks(id TEXT PRIMARY KEY,device_id TEXT,is_demo_template INTEGER,is_demo_clone INTEGER,encrypted_content TEXT);
    CREATE TABLE feedback_comments(id INTEGER PRIMARY KEY,feedback_id TEXT,content TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,feedback_id TEXT,recipient_type TEXT,recipient_id TEXT);
    CREATE TABLE admin_logs(id INTEGER PRIMARY KEY,action TEXT);
    INSERT INTO admin_logs VALUES(1,'retain');`)
  return db
}
function addIdentity(db: import('better-sqlite3').Database, id: string, activity: number) {
  db.prepare('INSERT INTO client_identities VALUES (?,?,?,?,?)').run(id, 'token-' + id, 'recovery-' + id, activity, activity)
  db.prepare('INSERT INTO client_identity_sessions VALUES (?,?,?,?,?)').run('token-' + id, id, activity, activity, now + day)
  db.prepare('INSERT INTO client_identity_install_keys VALUES (?,?,?,?)').run('key-' + id, id, activity, activity)
}
function noOrphans(db: import('better-sqlite3').Database) {
  for (const table of ['client_identity_sessions', 'client_identity_install_keys']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} x LEFT JOIN client_identities i ON i.device_id=x.device_id WHERE i.device_id IS NULL`).get() as any).n, 0)
  }
}

test('T-25 formal: exact 90-day boundary, any business and recent child activity preserve identity; expiry does not resurrect', (t) => {
  const db = fixture(); t.after(() => db.close())
  const cutoff = now - 90 * day
  for (const id of ['old-empty', 'has-formal', 'has-demo-flag', 'recent-key', 'recent-session', 'standalone-notice']) addIdentity(db, id, cutoff - 1)
  addIdentity(db, 'boundary', cutoff)
  addIdentity(db, 'fresh', cutoff + 1)
  db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?)').run('f1','has-formal',0,0,'unknown')
  db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?)').run('f2','has-demo-flag',0,1,`demo-encrypted:${DEMO_TEMPLATE_IDS[0]}`)
  db.prepare('INSERT INTO notifications VALUES (?,?,?,?)').run(1,null,'user','standalone-notice')
  db.prepare('UPDATE client_identity_install_keys SET last_seen_at=? WHERE device_id=?').run(cutoff, 'recent-key')
  db.prepare('UPDATE client_identity_sessions SET last_seen_at=? WHERE device_id=?').run(cutoff, 'recent-session')
  db.prepare('UPDATE client_identity_sessions SET expires_at=? WHERE device_id=?').run(now, 'fresh')
  const before = countIdentityRetention(db, 'formal', now)
  assert.deepEqual(before, { expiredSessions: 1, identitySessions: 1, installKeys: 1, identities: 1, feedbacks: 0, comments: 0, notifications: 0 })
  assert.deepEqual(cleanupIdentityBatch(db, 'formal', now), before)
  assert.equal(db.prepare("SELECT * FROM client_identities WHERE device_id='old-empty'").get(), undefined)
  assert.equal((db.prepare("SELECT token_hash FROM client_identities WHERE device_id='fresh'").get() as any).token_hash, '')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedbacks').get() as any).n, 2)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as any).n, 7)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_logs').get() as any).n, 1)
  noOrphans(db)
  assert.deepEqual(cleanupIdentityBatch(db,'formal',now), { expiredSessions:0,identitySessions:0,installKeys:0,identities:0,feedbacks:0,comments:0,notifications:0 })
})

test('T-25 demo: only current known synthetic markers retire after 30 days, cascade both notice recipients and preserve unknown history/templates', (t) => {
  const db=fixture(); t.after(()=>db.close())
  const cutoff=now-30*day
  for(const id of ['safe','unknown','mixed','template','orphan-notice']) addIdentity(db,id,cutoff-1)
  addIdentity(db,'boundary',cutoff)
  const marker=`demo-encrypted:${DEMO_TEMPLATE_IDS[0]}`
  const insert=db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?)')
  insert.run('safe-feedback','safe',0,1,marker)
  insert.run('unknown-feedback','unknown',0,1,'demo-encrypted:old-historical')
  insert.run('mixed-safe','mixed',0,1,marker)
  insert.run('mixed-unknown','mixed',0,1,'arbitrary-real-history')
  insert.run('template-feedback','template',1,0,marker)
  db.prepare('INSERT INTO feedback_comments VALUES (?,?,?)').run(1,'safe-feedback','synthetic-comment')
  const notify=db.prepare('INSERT INTO notifications VALUES (?,?,?,?)')
  notify.run(1,'safe-feedback','user','safe'); notify.run(2,'safe-feedback','admin','admin')
  notify.run(3,null,'user','orphan-notice')
  const expected={expiredSessions:0,identitySessions:1,installKeys:1,identities:1,feedbacks:1,comments:1,notifications:2}
  assert.deepEqual(countIdentityRetention(db,'demo',now),expected)
  assert.deepEqual(cleanupIdentityBatch(db,'demo',now),expected)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedbacks').get() as any).n,4)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as any).n,1)
  assert.equal(db.prepare("SELECT * FROM feedbacks WHERE id='template-feedback'").get() !== undefined,true)
  assert.equal(db.prepare("SELECT * FROM feedbacks WHERE id='mixed-safe'").get() !== undefined,true)
  noOrphans(db)
})

test('T-25: transaction fault rolls back compatibility hash/session and all demo cascades; hourly retry drains bounded batches and close cancels', (t) => {
  const db=fixture(); t.after(()=>db.close())
  for(let i=0;i<101;i++) addIdentity(db,`i${String(i).padStart(3,'0')}`,now-91*day)
  db.prepare('UPDATE client_identity_sessions SET expires_at=? WHERE device_id=?').run(now,'i000')
  db.exec(`CREATE TRIGGER fault BEFORE DELETE ON client_identity_install_keys BEGIN SELECT RAISE(ABORT,'sensitive-fixture-message'); END`)
  const counts=countIdentityRetention(db,'formal',now)
  const queue=new Map<NodeJS.Timeout,{callback:()=>void;delay:number}>()
  const errors:any[]=[]; const successes:any[]=[]
  const job=startIdentityRetention(db,'formal',{info:(message,metadata)=>successes.push({message,metadata}),error:(message,metadata)=>errors.push({message,metadata})},{now:()=>now,
    schedule:(callback,delay)=>{ const timer={unref(){}} as unknown as NodeJS.Timeout;queue.set(timer,{callback,delay});return timer },cancel:timer=>{queue.delete(timer)}})
  const step=()=>{const [key,value]=queue.entries().next().value!;queue.delete(key);value.callback();return value.delay}
  assert.equal(step(),0)
  assert.deepEqual(countIdentityRetention(db,'formal',now),counts)
  assert.equal((db.prepare("SELECT token_hash FROM client_identities WHERE device_id='i000'").get() as any).token_hash,'token-i000')
  assert.deepEqual(errors,[{message:'Identity retention failed; will retry',metadata:{code:'SQLITE_CONSTRAINT_TRIGGER'}}])
  db.exec('DROP TRIGGER fault')
  assert.equal(step(),IDENTITY_RETENTION_INTERVAL_MS)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as any).n,1)
  assert.equal(step(),0); assert.equal(step(),0)
  assert.deepEqual(successes,[{message:'Identity retention completed',metadata:counts}])
  assert.equal([...queue.values()][0].delay,IDENTITY_RETENTION_INTERVAL_MS)
  job.close(); job.close(); assert.equal(queue.size,0)
  noOrphans(db)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('idx_identity_retention_activity','idx_identity_sessions_expiry','idx_identity_sessions_activity','idx_identity_keys_activity','idx_feedback_identity_retention')").get() as any).n,5)
})

test('T-25: demo cascade fault is atomic and a feedback backlog is limited to 500 per transaction', (t)=>{
  const db=fixture();t.after(()=>db.close());addIdentity(db,'safe',now-31*day)
  db.prepare('UPDATE client_identity_sessions SET last_seen_at=?,expires_at=? WHERE device_id=?').run(now-31*day+1,now,'safe')
  const originalActivity=(db.prepare("SELECT last_seen_at FROM client_identities WHERE device_id='safe'").get() as any).last_seen_at
  const insert=db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?)')
  for(let i=0;i<501;i++) insert.run(`f${i}`,'safe',0,1,`demo-encrypted:${DEMO_TEMPLATE_IDS[0]}`)
  db.prepare('INSERT INTO feedback_comments VALUES (?,?,?)').run(1,'f0','synthetic')
  db.prepare('INSERT INTO notifications VALUES (?,?,?,?)').run(1,'f0','user','safe')
  db.exec(`CREATE TRIGGER fault BEFORE DELETE ON feedbacks BEGIN SELECT RAISE(ABORT,'synthetic-fault'); END`)
  const counts=countIdentityRetention(db,'demo',now)
  assert.throws(()=>cleanupIdentityBatch(db,'demo',now),/synthetic-fault/)
  assert.deepEqual(countIdentityRetention(db,'demo',now),counts)
  assert.equal((db.prepare("SELECT last_seen_at FROM client_identities WHERE device_id='safe'").get() as any).last_seen_at, originalActivity)
  assert.equal((db.prepare("SELECT token_hash FROM client_identities WHERE device_id='safe'").get() as any).token_hash, 'token-safe')
  db.exec('DROP TRIGGER fault')
  const first=cleanupIdentityBatch(db,'demo',now)
  assert.equal(first.feedbacks,500);assert.equal(first.identities,0)
  const second=cleanupIdentityBatch(db,'demo',now)
  assert.equal(second.feedbacks,1);assert.equal(second.identities,1)
  noOrphans(db)
})

test('T-25 live: restart cleans expired sessions without reviving old compatibility token; active Cookie and R1 recovery/binding preserve identity', async(t)=>{
  const key=randomBytes(32).toString('base64')
  const service=await startBackend({CONTENT_ENCRYPTION_KEY:key});t.after(service.stop)
  const original=new Client(service)
  const identity=await original.identity();assert.equal(identity.response.status,200)
  const recovered=new Client(service)
  const recovery=await recovered.post('/api/identity/recover',{recoveryCode:identity.data.recoveryCode})
  assert.equal(recovery.response.status,200);assert.equal(recovery.data.deviceId,identity.data.deviceId)
  const db=service.openDb();t.after(()=>{if(db.open)db.close()})
  const sessions=db.prepare(`SELECT token_hash FROM client_identity_sessions WHERE device_id=?
    ORDER BY token_hash=(SELECT token_hash FROM client_identities WHERE device_id=?)`).all(identity.data.deviceId,identity.data.deviceId) as {token_hash:string}[]
  assert.equal(sessions.length,2)
  // Expire the original session, retain the recovered browser, and emulate the
  // legacy compatibility cache pointing at an expired session with recent touch.
  db.prepare('UPDATE client_identity_sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1,sessions[0].token_hash)
  db.prepare('UPDATE client_identities SET token_hash=? WHERE device_id=?').run(sessions[0].token_hash,identity.data.deviceId)
  // Creating a different identity must not globally delete this expired row
  // without clearing its compatibility hash, which would revive it at restart.
  const unrelated = await new Client(service).identity()
  assert.equal(unrelated.response.status, 200)
  assert.ok(db.prepare('SELECT 1 FROM client_identity_sessions WHERE token_hash=?').get(sessions[0].token_hash))
  await service.stop()
  const restarted=await startBackend({DATABASE_PATH:service.databasePath,CONTENT_ENCRYPTION_KEY:key});t.after(restarted.stop)
  for(let i=0;i<100;i++){if(!db.prepare('SELECT 1 FROM client_identity_sessions WHERE token_hash=?').get(sessions[0].token_hash))break;await delay(10)}
  assert.equal(db.prepare('SELECT 1 FROM client_identity_sessions WHERE token_hash=?').get(sessions[0].token_hash),undefined)
  assert.equal((db.prepare('SELECT token_hash FROM client_identities WHERE device_id=?').get(identity.data.deviceId) as any).token_hash,'')
  original.service=restarted;recovered.service=restarted
  assert.equal((await original.request('/api/identity')).response.status,401)
  assert.equal((await recovered.identity()).data.deviceId,identity.data.deviceId)
  const fresh=new Client(restarted)
  const result=await fresh.post('/api/identity/recover',{recoveryCode:identity.data.recoveryCode})
  assert.equal(result.response.status,200);assert.equal(result.data.deviceId,identity.data.deviceId)
  const before=(db.prepare('SELECT last_seen_at FROM client_identities WHERE device_id=?').get(identity.data.deviceId) as any).last_seen_at
  db.prepare('UPDATE client_identities SET last_seen_at=? WHERE device_id=?').run(Date.now()-91*day,identity.data.deviceId)
  await fresh.identity({headers:{'X-Install-Key':'T25syntheticInstallKey000000000000000000000000000'}})
  const after=(db.prepare('SELECT last_seen_at FROM client_identities WHERE device_id=?').get(identity.data.deviceId) as any).last_seen_at
  assert.ok(after>=before)
  assert.equal(countIdentityRetention(db,'formal').identities,0)
  await restarted.stop()
  const again=await startBackend({DATABASE_PATH:service.databasePath,CONTENT_ENCRYPTION_KEY:key});t.after(again.stop)
  assert.equal(db.prepare('SELECT 1 FROM client_identity_sessions WHERE token_hash=?').get(sessions[0].token_hash),undefined)
  noOrphans(db)
})

test('T-25: expired child activity survives deletion and the session budget is shared across expired and retired identities', (t) => {
  const db = fixture(); t.after(() => db.close())
  addIdentity(db, 'recent-expired-child', now - 91 * day)
  db.prepare('UPDATE client_identity_sessions SET last_seen_at=?,expires_at=? WHERE device_id=?')
    .run(now - day, now, 'recent-expired-child')
  const old = now - 91 * day
  addIdentity(db, 'backlog', old)
  const insert = db.prepare('INSERT INTO client_identity_sessions VALUES (?,?,?,?,?)')
  for (let i = 0; i < 501; i++) insert.run(`backlog-${i}`, 'backlog', old, old, now + day)
  addIdentity(db, 'fresh-expired-backlog', now - day)
  for (let i = 0; i < 500; i++) insert.run(`fresh-expired-${i}`, 'fresh-expired-backlog', old, now - day, now)
  const snapshot = () => JSON.stringify(['client_identities','client_identity_sessions','client_identity_install_keys'].map(table =>
    db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()))
  const before = snapshot()
  const expected = countIdentityRetention(db, 'formal', now)
  assert.equal(snapshot(), before, 'dry-run is read-only')
  assert.equal(expected.identities, 1)
  const total = { expiredSessions: 0, identitySessions: 0, installKeys: 0, identities: 0, feedbacks: 0, comments: 0, notifications: 0 }
  for (let batch = 0; batch < 5; batch++) {
    const result = cleanupIdentityBatch(db, 'formal', now)
    assert.ok(result.expiredSessions + result.identitySessions <= 500)
    assert.ok(result.identities <= 100)
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += result[key]
    noOrphans(db)
    if (!Object.values(result).some(Boolean)) break
  }
  assert.deepEqual(total, expected)
  assert.ok(db.prepare("SELECT 1 FROM client_identities WHERE device_id='recent-expired-child'").get())
  assert.equal((db.prepare("SELECT last_seen_at FROM client_identities WHERE device_id='recent-expired-child'").get() as any).last_seen_at, now - day)
  assert.equal(db.prepare("SELECT 1 FROM client_identities WHERE device_id='backlog'").get(), undefined)
})
