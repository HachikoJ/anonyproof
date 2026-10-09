import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type DatabaseType from 'better-sqlite3'
import { Client, startBackend, projectRoot } from './helpers'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { cleanupIdempotency, executeIdempotent, IDEMPOTENCY_WINDOW_MS as WINDOW, IDEMPOTENCY_FUTURE_SKEW_MS as SKEW,
  IdempotencyError, initializeIdempotency, parseIdempotencyKey, startIdempotencyCleanup } from '../../server/utils/requestIdempotency'
import { createPendingActions } from '../../app/utils/pendingAction'
import { inventoryContentMigration } from '../../scripts/content-migration-inventory'
import { prepareContentMigrationCandidate } from '../../scripts/content-migration-candidate'
const Database = createRequire(path.join(projectRoot,'server/package.json'))('better-sqlite3') as typeof DatabaseType
const key = (time = Date.now()) => `v1:${time}:${randomUUID()}`
const send = (client: Client, url: string, body: unknown, requestKey?: string) => client.request(url, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(requestKey === undefined ? {} : { 'Idempotency-Key': requestKey }) }, body: JSON.stringify(body) })
function counts(db: DatabaseType.Database) { return ['feedbacks','feedback_comments','notifications','request_idempotency'].map(table =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n) }
async function fixture(demo = false) {
  const contentKey = randomBytes(32).toString('base64')
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: demo ? '' : contentKey, DEMO_MODE: demo ? '1' : '0',
    FEEDBACK_RATE_LIMIT_MAX:'1000', FEEDBACK_IDENTITY_RATE_LIMIT_MAX:'1000', COMMENT_RATE_LIMIT_MAX:'1000', COMMENT_IDENTITY_RATE_LIMIT_MAX:'1000' })
  const user = new Client(service), other = new Client(service), admin = new Client(service)
  const identityResponse = await user.identity()
  const identity = identityResponse.data, otherIdentity = (await other.identity()).data
  const config = (await user.request('/api/demo/config')).data
  assert.equal((await admin.post('/api/admin/auth/login', { password: demo ? config.adminPassword : service.password })).response.status,200)
  const db=service.openDb()
  const body = demo ? { deviceId: identity.deviceId, demoExampleId: config.examples[0].id }
    : { deviceId: identity.deviceId, category:'report', originalContent:'T42_SECRET_FEEDBACK_MARKER', encryptedContent:'T42_DISCARDED_CLIENT_KEY_PACKAGE' }
  return { service,user,other,admin,identity,otherIdentity,db,body,contentKey,config, identityCookie: identityResponse.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ') }
}

test('T-42 server: concurrent/repeated/lost-response feedback writes return original result; new action and identity are independent',async t=>{
  const f=await fixture();t.after(async()=>{f.db.close();await f.service.stop()})
  const requestKey=key(), before=counts(f.db)
  const replies=await Promise.all(Array.from({length:8},()=>send(f.user,'/api/feedback',f.body,requestKey)))
  assert.ok(replies.every(reply=>reply.response.status===200))
  assert.ok(replies.every(reply=>JSON.stringify(reply.data)===JSON.stringify(replies[0].data)))
  assert.deepEqual(counts(f.db),before.map((n,i)=>n+([0,2,3].includes(i)?1:0)))
  const protectedCounts=counts(f.db)
  assert.equal((await f.user.request('/api/feedback',{method:'POST',omitOrigin:true,headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(f.body)})).response.status,403)
  assert.deepEqual(counts(f.db),protectedCounts)
  // Discard the committed response, then manually retry the same action.
  assert.deepEqual((await send(f.user,'/api/feedback',{...f.body,encryptedContent:'new-random-legacy-package'},requestKey)).data,replies[0].data)
  for(const change of [{ originalContent:'T42_CHANGED_BODY_MARKER' },{category:'complaint'}])
    assert.equal((await send(f.user,'/api/feedback',{...f.body,...change},requestKey)).response.status,409)
  assert.notEqual((await send(f.user,'/api/feedback',f.body,key())).data.id,replies[0].data.id)
  const other=await send(f.other,'/api/feedback',{...f.body,deviceId:f.otherIdentity.deviceId},requestKey)
  assert.equal(other.response.status,200);assert.notEqual(other.data.id,replies[0].data.id)
  assert.equal((await send(new Client(f.service),'/api/feedback',f.body,requestKey)).response.status,401)
  assert.equal((await send(f.user,'/api/feedback',f.body,undefined)).response.status,200)
})

test('T-42 server: all comment roles/targets conflict safely, exact original id/time is replayed and deleted targets never resurrect',async t=>{
  const f=await fixture();t.after(async()=>{f.db.close();await f.service.stop()})
  const feedback=(await send(f.user,'/api/feedback',f.body,key())).data.id
  const second=(await send(f.user,'/api/feedback',f.body,key())).data.id
  for(const [client,prefix] of [[f.user,'/api/feedback'],[f.admin,'/api/admin/feedback'],[f.admin,'/api/feedback']] as const){
    const k=key(), body={content:'  T42_SECRET_COMMENT_MARKER  '}, before=counts(f.db)
    const replies=await Promise.all(Array.from({length:5},()=>send(client,`${prefix}/${feedback}/comments`,body,k)))
    assert.ok(replies.every(reply=>reply.response.status===200));assert.ok(replies.every(reply=>JSON.stringify(reply.data)===JSON.stringify(replies[0].data)))
    assert.deepEqual(counts(f.db),before.map((n,i)=>n+(i===0?0:1)))
    assert.equal((await send(client,`${prefix}/${feedback}/comments`,{content:body.content.trim()},k)).data.comment.id,replies[0].data.comment.id)
    assert.equal((await send(client,`${prefix}/${feedback}/comments`,{content:'T42 changed comment'},k)).response.status,409)
    assert.equal((await send(client,`${prefix}/${second}/comments`,body,k)).response.status,409)
    f.db.prepare('DELETE FROM feedback_comments WHERE id=?').run(replies[0].data.comment.id)
    const deletedCounts=counts(f.db)
    assert.equal((await send(client,`${prefix}/${feedback}/comments`,body,k)).response.status,410)
    assert.deepEqual(counts(f.db),deletedCounts)
  }
  const shared=key(), body={content:'T42 distinct authenticated admin sessions'}
  const a=await send(f.admin,`/api/admin/feedback/${feedback}/comments`,body,shared)
  await f.other.login()
  const b=await send(f.other,`/api/admin/feedback/${feedback}/comments`,body,shared)
  assert.equal(b.response.status,200);assert.notEqual(a.data.comment.id,b.data.comment.id)
  const k=key();const original=await send(f.user,'/api/feedback',f.body,k)
  f.db.prepare('DELETE FROM feedbacks WHERE id=?').run(original.data.id)
  const before=counts(f.db)
  assert.equal((await send(f.user,'/api/feedback',f.body,k)).response.status,410);assert.deepEqual(counts(f.db),before)
  await f.other.post('/api/admin/auth/logout', {})
  assert.equal((await send(f.other,`/api/feedback/${feedback}/comments`,{content:'T42 secret'},key())).response.status,401)
})

test('T-42 server: business, notifications and metadata faults are one atomic transaction for feedback and both comment endpoints',async t=>{
  const f=await fixture();t.after(async()=>{f.db.close();await f.service.stop()})
  const id=(await send(f.user,'/api/feedback',f.body,key())).data.id
  for(const [client,url,body,table] of [[f.user,'/api/feedback',f.body,'feedbacks'],
    [f.user,`/api/feedback/${id}/comments`,{content:'T42 fault user'},'feedback_comments'],
    [f.admin,`/api/admin/feedback/${id}/comments`,{content:'T42 fault admin'},'feedback_comments']] as const){
    for(const faultTable of [table,'notifications','request_idempotency']){
      const before=counts(f.db), k=key()
      f.db.exec(`CREATE TRIGGER t42_fault BEFORE INSERT ON ${faultTable} BEGIN SELECT RAISE(ABORT,'T42_FIXTURE_ONLY'); END`)
      assert.equal((await send(client,url,body,k)).response.status,500);assert.deepEqual(counts(f.db),before)
      f.db.exec('DROP TRIGGER t42_fault')
      assert.equal((await send(client,url,body,k)).response.status,200)
      const committed=counts(f.db);assert.equal((await send(client,url,body,k)).response.status,200);assert.deepEqual(counts(f.db),committed)
    }
  }
})

test('T-42 boundaries: exact 7-day expiry/skew, invalid headers, cleanup batch500/rollback/diagnostic do not change business',async t=>{
  const f=await fixture();t.after(async()=>{f.db.close();await f.service.stop()})
  const now=1800000000000,k=key(now-WINDOW+1)
  assert.ok(parseIdempotencyKey(k,now))
  assert.throws(()=>parseIdempotencyKey(k,now+1), (e:any)=>e.code==='IDEMPOTENCY_KEY_EXPIRED')
  assert.throws(()=>parseIdempotencyKey(k,now+2), (e:any)=>e.code==='IDEMPOTENCY_KEY_EXPIRED')
  assert.ok(parseIdempotencyKey(key(now+SKEW),now))
  assert.throws(()=>parseIdempotencyKey(key(now+SKEW+1),now), (e:any)=>e.code==='IDEMPOTENCY_CLOCK_SKEW')
  for(const invalid of ['', 'x'.repeat(81), `v1:01:${randomUUID()}`,`v1:9007199254740992:${randomUUID()}`,key()+','+key(),'v1:123:not-a-uuid'])
    assert.equal((await send(f.user,'/api/feedback',f.body,invalid)).response.status,400)
  const duplicateStatus=await new Promise<number>(resolve=>{
    const wire=http.request(f.service.baseUrl+'/api/feedback',{method:'POST',headers:['Content-Type','application/json','Origin',f.service.baseUrl,'Cookie',f.identityCookie,'Idempotency-Key',key(),'Idempotency-Key',key()]},response=>{response.resume();response.on('end',()=>resolve(response.statusCode!))})
    wire.end(JSON.stringify(f.body))
  })
  assert.equal(duplicateStatus,400)
  const old=key(Date.now()-WINDOW), business=counts(f.db).slice(0,3)
  const untouched=()=>JSON.stringify(Object.fromEntries(['feedbacks','feedback_comments','notifications','client_identities','client_identity_sessions','client_identity_install_keys','access_logs','rate_limit_logs','admin_logs','stats'].map(table=>[table,f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
  assert.equal((await send(f.user,'/api/feedback',f.body,old)).data.code,'IDEMPOTENCY_KEY_EXPIRED')
  const beforeCleanup=untouched()
  const insert=f.db.prepare(`INSERT INTO request_idempotency(scope,action,request_key,created_at,expires_at,target_type,target_id,snapshot,snapshot_storage_version)
    VALUES('unit','feedback',?,?,?,'feedback','unit','synthetic',0)`)
  f.db.transaction(()=>{for(let i=0;i<501;i++)insert.run(key(i),i,0);insert.run(key(now),now,now+1)})()
  f.db.exec("CREATE TRIGGER t42_cleanup_fault BEFORE DELETE ON request_idempotency BEGIN SELECT RAISE(ABORT,'T42_FIXTURE_ONLY'); END")
  assert.throws(()=>cleanupIdempotency(f.db,now));assert.equal(counts(f.db)[3],502)
  const diagnostics:string[]=[];const runner=startIdempotencyCleanup(f.db,m=>diagnostics.push(m));runner.close()
  assert.deepEqual(diagnostics,['Idempotency metadata cleanup failed; deleted=0'])
  f.db.exec('DROP TRIGGER t42_cleanup_fault')
  assert.equal(cleanupIdempotency(f.db,now),500);assert.equal(cleanupIdempotency(f.db,now),1);assert.equal(cleanupIdempotency(f.db,now),0)
  assert.equal(counts(f.db)[3],1);assert.deepEqual(counts(f.db).slice(0,3),business)
  assert.equal(untouched(),beforeCleanup)
  assert.equal((await send(f.user,'/api/feedback',f.body,old)).data.code,'IDEMPOTENCY_KEY_EXPIRED')
  assert.equal((await send(f.user,'/api/feedback',f.body,key())).response.status,200)
})

test('T-42 encryption and durable user replay: SQLite/WAL/dump/logs exclude content/key/package, inventory recognizes new table and migration refuses unknown preservation',async t=>{
  const f=await fixture();let service=f.service;t.after(async()=>{f.db.close();await service.stop()})
  const k=key(), first=await send(f.user,'/api/feedback',f.body,k)
  const comment=await send(f.user,`/api/feedback/${first.data.id}/comments`,{content:'T42_SECRET_COMMENT_MARKER'},key())
  assert.equal(comment.response.status,200)
  const metadata=f.db.prepare('SELECT * FROM request_idempotency').all() as any[]
  assert.ok(metadata.every(row=>row.snapshot_storage_version===1&&row.snapshot.startsWith('apc:')))
  for(const marker of ['T42_SECRET_FEEDBACK_MARKER','T42_SECRET_COMMENT_MARKER','T42_DISCARDED_CLIENT_KEY_PACKAGE',f.contentKey]){
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM request_idempotency').all()).includes(marker))
    assert.ok(!readFileSync(service.databasePath).includes(Buffer.from(marker)))
    assert.ok(!readFileSync(service.databasePath+'-wal').includes(Buffer.from(marker)))
    assert.ok(!service.output().includes(marker))
  }
  const inventory=inventoryContentMigration(service.databasePath)
  assert.equal(inventory.recordCounts.request_idempotency,2)
  assert.equal(inventory.storage.find(row=>row.table==='request_idempotency')?.markedVersion1Rows,2)
  await assert.rejects(prepareContentMigrationCandidate({sourcePath:service.databasePath,destinationPath:path.join(service.dir,'candidate.db'),contentKey:f.contentKey}), (e:any)=>e.code==='UNREVIEWED_IDEMPOTENCY_METADATA')
  const wrong=loadContentEncryption({demoMode:false,env:{CONTENT_ENCRYPTION_KEY:randomBytes(32).toString('base64')}})
  assert.throws(()=>wrong.assertDatabaseKey(f.db))
  const dbPath=service.databasePath;await service.stop()
  service=await startBackend({DATABASE_PATH:dbPath, CONTENT_ENCRYPTION_KEY:f.contentKey})
  f.user.service=service
  const replay=await send(f.user,'/api/feedback',f.body,k)
  assert.equal(replay.response.status,200);assert.deepEqual(replay.data,first.data)
})

class FakeStorage implements Storage {
  map=new Map<string,string>();length=0;getItem(k:string){return this.map.get(k)??null}setItem(k:string,v:string){this.map.set(k,v);this.length=this.map.size}
  removeItem(k:string){this.map.delete(k);this.length=this.map.size}clear(){this.map.clear();this.length=0}key(i:number){return [...this.map.keys()][i]??null}
}
test('T-42 frontend lifecycle: retry/refresh retains key only, edited failed content never auto-rekeys, explicit new action and storage failures',()=>{
  const storage=new FakeStorage();let next=0;const keys=()=>key(1000+next++)
  const actions=createPendingActions(()=>storage,keys), body={content:'T42_LOCAL_BODY_NOT_STORED'}
  const original=actions.begin('feedback','', 'user-A',body)
  assert.equal(actions.begin('feedback','', 'user-A',body),original)
  assert.ok(!JSON.stringify([...storage.map]).includes(body.content));assert.equal(next,1)
  assert.throws(()=>actions.begin('feedback','','user-A',{content:'changed'}));assert.equal(next,1)
  const reload=createPendingActions(()=>storage,keys);assert.equal(reload.begin('feedback','','user-A',body),original)
  reload.complete('feedback','','user-A');assert.notEqual(reload.begin('feedback','','user-A',body),original)
  reload.abandon('feedback','','user-A');assert.equal(storage.length,0)
  const broken=createPendingActions(()=>{throw new Error('denied')},keys)
  assert.throws(()=>broken.begin('user_comment','target','user-A',body));assert.equal(next,2)
})


test('T-42 demo: fixed choices replay and sandbox identities/admin sessions cannot reuse others results',async t=>{
  const f=await fixture(true);t.after(async()=>{f.db.close();await f.service.stop()})
  const k=key(), first=await send(f.user,'/api/feedback',f.body,k)
  assert.equal(first.response.status,200);assert.deepEqual((await send(f.user,'/api/feedback',f.body,k)).data,first.data)
  assert.equal((await send(f.user,'/api/feedback',{...f.body,demoExampleId:f.config.examples[1].id},k)).response.status,409)
  const identity=(await f.admin.identity()).data
  const own=await send(f.admin,'/api/feedback',{...f.body,deviceId:identity.deviceId},k)
  assert.equal(own.response.status,200);assert.notEqual(own.data.id,first.data.id)
  const body={demoCommentId:f.config.adminComments[0].id}, commentKey=key()
  const reply=await send(f.admin,`/api/admin/feedback/${own.data.id}/comments`,body,commentKey)
  assert.equal(reply.response.status,200)
  assert.deepEqual((await send(f.admin,`/api/admin/feedback/${own.data.id}/comments`,body,commentKey)).data,reply.data)
  assert.equal((await send(f.admin,`/api/admin/feedback/${first.data.id}/comments`,body,commentKey)).response.status,409)
  const otherAdmin=new Client(f.service)
  await otherAdmin.post('/api/admin/auth/login',{password:f.config.adminPassword})
  assert.equal((await send(otherAdmin,`/api/admin/feedback/${own.data.id}/comments`,body,commentKey)).response.status,404)
  const userBody={demoCommentId:f.config.userComments[0].id}, uk=key()
  const comment=await send(f.user,`/api/feedback/${first.data.id}/comments`,userBody,uk)
  assert.equal(comment.response.status,200);assert.deepEqual((await send(f.user,`/api/feedback/${first.data.id}/comments`,userBody,uk)).data,comment.data)
  assert.ok((f.db.prepare('SELECT snapshot_storage_version FROM request_idempotency').all() as any[]).every(row=>row.snapshot_storage_version===0))
})


test('T-42 concurrent processes share user scope and unique transaction; retries retain normal source quota',async t=>{
  const f=await fixture();const second=await startBackend({DATABASE_PATH:f.service.databasePath,CONTENT_ENCRYPTION_KEY:f.contentKey,
    FEEDBACK_RATE_LIMIT_MAX:'1000',FEEDBACK_IDENTITY_RATE_LIMIT_MAX:'1000'})
  t.after(async()=>{f.db.close();await second.stop();await f.service.stop()})
  const k=key(), attempts=await Promise.all(Array.from({length:12},(_,i)=>fetch((i%2?f.service:second).baseUrl+'/api/feedback',{
    method:'POST',headers:{Origin:(i%2?f.service:second).baseUrl,Cookie:f.identityCookie,'Content-Type':'application/json','Idempotency-Key':k},body:JSON.stringify(f.body)}).then(async response=>({status:response.status,data:await response.json()}))))
  assert.ok(attempts.every(item=>item.status===200));assert.ok(attempts.every(item=>JSON.stringify(item.data)===JSON.stringify(attempts[0].data)))
  assert.deepEqual(counts(f.db),[1,0,1,1])
  const limited=await startBackend({FEEDBACK_RATE_LIMIT_MAX:'1',FEEDBACK_IDENTITY_RATE_LIMIT_MAX:'1'})
  t.after(limited.stop);const user=new Client(limited),identity=(await user.identity()).data, lk=key()
  const body={...f.body,deviceId:identity.deviceId}
  assert.equal((await send(user,'/api/feedback',body,lk)).response.status,200)
  assert.equal((await send(user,'/api/feedback',body,lk)).response.status,429)
})


test('T-42 exact expiry before/after metadata cleanup cannot run the mutation again',()=>{
  const db=new Database(':memory:');const codec=loadContentEncryption({demoMode:true})
  db.exec('CREATE TABLE feedbacks(id TEXT PRIMARY KEY); CREATE TABLE feedback_comments(id INTEGER,feedback_id TEXT)')
  initializeIdempotency(db,codec)
  const now=1800000000000,k=key(now), semantic={content:'synthetic'}, scope='user:synthetic';let writes=0
  const mutate=()=>{writes++;db.prepare("INSERT INTO feedbacks VALUES('synthetic')").run();return{result:{id:'synthetic',timestamp:now},targetType:'feedback' as const,targetId:'synthetic'}}
  const first=executeIdempotent(db,codec,scope,'feedback',k,semantic,mutate,now)
  assert.deepEqual(executeIdempotent(db,codec,scope,'feedback',k,semantic,mutate,now+WINDOW-1),first)
  for(const moment of [now+WINDOW,now+WINDOW+1])assert.throws(()=>executeIdempotent(db,codec,scope,'feedback',k,semantic,mutate,moment),(e:any)=>e.code==='IDEMPOTENCY_KEY_EXPIRED')
  assert.equal(cleanupIdempotency(db,now+WINDOW),1)
  assert.throws(()=>executeIdempotent(db,codec,scope,'feedback',k,semantic,mutate,now+WINDOW),(e:any)=>e.code==='IDEMPOTENCY_KEY_EXPIRED')
  assert.equal(writes,1);assert.equal((db.prepare('SELECT COUNT(*) n FROM feedbacks').get() as any).n,1);db.close()
})

test('T-42 frontend write/remove storage failures preserve the original key and never quietly create another',()=>{
  const storage=new FakeStorage();let generated=0,denyWrite=true,denyRemove=true
  const keyValue=key();const wrapped={getItem:(name:string)=>storage.getItem(name),setItem:(name:string,value:string)=>{if(denyWrite)throw new Error();storage.setItem(name,value)},removeItem:(name:string)=>{if(denyRemove)throw new Error();storage.removeItem(name)}} as Storage
  const actions=createPendingActions(()=>wrapped,()=>{generated++;return keyValue})
  assert.throws(()=>actions.begin('feedback','','A',{content:'draft'}));assert.equal(generated,1)
  denyWrite=false;assert.equal(actions.begin('feedback','','A',{content:'draft'}),keyValue)
  assert.throws(()=>actions.complete('feedback','','A'));assert.equal(actions.begin('feedback','','A',{content:'draft'}),keyValue);assert.equal(generated,1)
  assert.throws(()=>actions.abandon('feedback','','A'));assert.equal(generated,1)
  denyRemove=false;actions.complete('feedback','','A');assert.equal(storage.length,0)
})
