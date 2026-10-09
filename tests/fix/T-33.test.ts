import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startBackend, Client, projectRoot } from './helpers'

const marker = 'T33-private-marker-473911'
const ua = `Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36 ${marker}`

test('T-33 HTTP new writes retain only UA family and route template; legacy display does not rewrite history', async t => {
  const service=await startBackend({TRUST_PROXY:'1'}); const db=service.openDb(); const admin=new Client(service)
  t.after(async()=>{db.close();await service.stop()})
  assert.equal((await admin.login()).response.status,200)
  for(const path of ['/health',`/api/feedback/${marker}/comments?private=${marker}`,`/unknown-${marker}?private=${marker}`]) {
    const response=await fetch(service.baseUrl+path,{headers:{'User-Agent':ua,'X-Forwarded-For':'192.0.2.33'}});await response.text()
  }
  await delay(50)
  const logs=db.prepare('SELECT ip,user_agent,path FROM access_logs ORDER BY id').all() as {ip:string,user_agent:string,path:string}[]
  assert.ok(logs.some(row=>row.ip==='192.0.2.33' && row.user_agent==='browser:Chrome'))
  assert.ok(logs.some(row=>row.path==='/api/feedback/:feedbackId/comments'))
  assert.ok(logs.some(row=>row.path==='/unmatched'))
  assert.ok(!JSON.stringify(logs).includes(marker))
  db.prepare(`INSERT INTO access_logs (ip,user_agent,path,method,status_code,is_suspicious,suspicious_reason,created_at)
    VALUES (?,?,?,'GET',200,1,'Sensitive path access',?)`).run('192.0.2.33',ua,`/api/admin/feedback/${marker}?private=${marker}`,Date.now())
  const legacy=db.prepare('SELECT * FROM access_logs ORDER BY id DESC LIMIT 1').get() as any
  const expiredId=Number(db.prepare(`INSERT INTO access_logs(ip,user_agent,path,method,created_at) VALUES(?,?,?,'GET',?)`).run('192.0.2.134',ua,`/api/feedback/${marker}`,Date.now()-8*86400000).lastInsertRowid)
  for(const path of ['/api/admin/access/logs','/api/admin/access/suspicious']) {
    const result=await admin.request(path);assert.equal(result.response.status,200)
    assert.ok(!result.data.data.some((entry:any)=>entry.id===expiredId))
    const row=result.data.data.find((entry:any)=>entry.id===legacy.id)
    assert.equal(row.user_agent,'browser:Chrome');assert.equal(row.path,'/api/admin/feedback/:id')
    assert.ok(!JSON.stringify(result.data).includes(marker))
  }
  assert.deepEqual(db.prepare('SELECT * FROM access_logs WHERE id=?').get(legacy.id),legacy)
  assert.ok(db.prepare('SELECT 1 FROM access_logs WHERE id=?').get(expiredId),'Read filtering did not delete historical rows')
})

test('T-33 business and audit new writes omit admin IP; legacy HTTP output hides IP while records remain untouched', async t => {
  const service=await startBackend();const db=service.openDb();const owner=new Client(service),admin=new Client(service)
  t.after(async()=>{db.close();await service.stop()})
  const identity=(await owner.identity()).data;assert.equal((await admin.login()).response.status,200)
  const submit=await owner.post('/api/feedback',{category:'report',originalContent:'T33 synthetic report for privacy acceptance',encryptedContent:'synthetic',deviceId:identity.deviceId})
  assert.equal(submit.response.status,200);const id=submit.data.id
  assert.equal((await admin.post(`/api/admin/feedback/${id}/status`,{status:'in_progress',solution:'T33 synthetic processing explanation'},'PUT')).response.status,200)
  assert.equal((await admin.post(`/api/admin/feedback/${id}/comments`,{content:'T33 synthetic administrator response'})).response.status,200)
  assert.equal((db.prepare('SELECT solution_admin_ip FROM feedbacks WHERE id=?').get(id) as any).solution_admin_ip,'')
  assert.equal((db.prepare('SELECT admin_ip FROM feedback_comments WHERE feedback_id=?').get(id) as any).admin_ip,null)
  assert.ok((db.prepare('SELECT admin_ip FROM admin_logs').all() as any[]).every(row=>row.admin_ip===''))
  const ip='192.0.2.233'
  db.prepare('UPDATE feedbacks SET solution_admin_ip=? WHERE id=?').run(ip,id)
  db.prepare('UPDATE feedback_comments SET admin_ip=? WHERE feedback_id=?').run(ip,id)
  db.prepare('INSERT INTO admin_logs(action,target_id,admin_ip,created_at) VALUES(?,?,?,?)').run('legacy',id,ip,Date.now())
  for(const [client,path] of [[owner,`/api/feedback/${id}`],[admin,`/api/admin/feedback/${id}`],[owner,`/api/feedback/${id}/comments`],[admin,'/api/admin/logs']] as const) {
    const result=await client.request(path);assert.equal(result.response.status,200);assert.ok(!JSON.stringify(result.data).includes(ip))
  }
  assert.equal((db.prepare('SELECT solution_admin_ip FROM feedbacks WHERE id=?').get(id) as any).solution_admin_ip,ip)
  assert.equal((db.prepare('SELECT admin_ip FROM feedback_comments WHERE feedback_id=?').get(id) as any).admin_ip,ip)
})

test('T-33 access warnings and error handling never persist raw source IP, UA, path, query or exception content in Winston/stdout', async t => {
  const service=await startBackend({TRUST_PROXY:'1'});const db=service.openDb()
  t.after(async()=>{if(db.open)db.close();await service.stop()})
  const response=await fetch(service.baseUrl+`/api/admin/feedback/${marker}?private=${marker}`,{headers:{'User-Agent':ua,'X-Forwarded-For':'192.0.2.233'}});await response.text()
  db.exec(`CREATE TRIGGER privacy_fault BEFORE INSERT ON access_logs BEGIN SELECT RAISE(ABORT,'${marker} 192.0.2.233'); END`)
  await (await fetch(service.baseUrl+'/health',{headers:{'User-Agent':ua,'X-Forwarded-For':'192.0.2.233'}})).text()
  db.exec('DROP TRIGGER privacy_fault')
  db.prepare('INSERT INTO ip_blacklist(ip,reason,blacklisted_at,expires_at) VALUES(?,?,?,?)').run('192.0.2.233','T33 synthetic blacklist',Date.now(),Date.now()+10000)
  assert.equal((await fetch(service.baseUrl+'/health',{headers:{'X-Forwarded-For':'192.0.2.233'}})).status,403)
  await delay(150);await service.stop()
  const logs=readdirSync(join(service.dir,'logs')).filter(file=>file.endsWith('.log')).map(file=>readFileSync(join(service.dir,'logs',file),'utf8')).join('\n')+'\n'+service.output()
  for(const value of [marker,ua,'192.0.2.233','IP=127.0.0.1','access: 127.0.0.1']) assert.ok(!logs.includes(value),`Unexpected retained marker: ${value}`)
  assert.match(logs,/Suspicious access detected/);assert.match(logs,/Blacklisted source attempted access/);assert.match(logs,/SQLITE_CONSTRAINT_TRIGGER/)
})

test('T-33 classifications and routes never retain arbitrary input; all recognized outputs are idempotent', async () => {
  const {classifyUserAgent,accessRouteTemplate,safeSuspiciousReason,safeRateLimitReason,safeAccessErrorCode}=await import('../../server/utils/accessPrivacy')
  const agents=[['Mozilla/5.0 Edg/123 secret','browser:Edge'],['Mozilla/5.0 OPR/123 Chrome/123 secret','browser:Opera'],['Mozilla/5.0 Firefox/123 secret','browser:Firefox'],[ua,'browser:Chrome'],['Mozilla/5.0 Version/17 Safari/605 secret','browser:Safari'],['Googlebot/2.1 secret','bot:Google'],['curl/secret','client:script'],[marker,'browser:Other'],['','unknown']] as const
  for(const [input,output] of agents){assert.equal(classifyUserAgent(input),output);assert.equal(classifyUserAgent(output),output)}
  const paths=[['/api/notifications/secret/read?token=secret','/api/notifications/:id/read'],['/api/feedback/device/secret','/api/feedback/device/:deviceId'],['/api/admin/access/blacklist/192.0.2.33','/api/admin/access/blacklist/:ip'],['/api/admin/feedback/secret/status','/api/admin/feedback/:id/status'],['/api/feedback/secret%2Fsecret/comments','/api/feedback/:feedbackId/comments'],['/api/admin/auth/login?secret=secret','/api/admin/auth/login'],['/.env-secret','/unmatched']] as const
  for(const [input,output] of paths){assert.equal(accessRouteTemplate(input),output);assert.equal(accessRouteTemplate(output),output)}
  assert.equal(safeSuspiciousReason(marker),'Other');assert.equal(safeRateLimitReason(marker),'Rate limit exceeded')
  assert.equal(safeAccessErrorCode(new Error(marker)),'ACCESS_LOG_ERROR')
})

test('T-33 exported writers minimize direct calls and rate-limit blacklist warnings do not retain source identifiers', () => {
  const dir=mkdtempSync(join(tmpdir(),'anonyproof-T33-writers-'));const file=join(dir,'fixture.db')
  const source=`const {recordAccess,logRateLimit}=require('./server/middleware/accessStats');
    const entry=JSON.parse(process.env.T33_ENTRY);recordAccess.immediate(entry);
    for(let i=0;i<10;i++)logRateLimit(entry.ip,entry.path,'General API rate limit exceeded');`
  const result=spawnSync(process.execPath,['--import','tsx','--eval',source],{cwd:projectRoot,encoding:'utf8',timeout:10000,
    env:{...process.env,NODE_ENV:'production',INSTANCE_ROLE:'demo',DEMO_MODE:'1',CONTENT_ENCRYPTION_KEY:'',DATABASE_PATH:file,LOG_DIR:join(dir,'logs'),
      T33_ENTRY:JSON.stringify({ip:'192.0.2.33',userAgent:ua,path:`/api/feedback/${marker}/comments?secret=${marker}`,method:'GET',statusCode:200,responseTime:3,isBot:false,isSuspicious:true,suspiciousReason:marker,createdAt:Date.now()})}})
  assert.equal(result.status,0,result.stdout+result.stderr)
  const Database=createRequire(join(projectRoot,'server/package.json'))('better-sqlite3') as typeof import('better-sqlite3')
  const db=new Database(file)
  try {
    assert.deepEqual(db.prepare('SELECT ip,user_agent,path,suspicious_reason FROM access_logs').get(),{ip:'192.0.2.33',user_agent:'browser:Chrome',path:'/api/feedback/:feedbackId/comments',suspicious_reason:'Other'})
    const rows=db.prepare('SELECT ip,path,reason FROM rate_limit_logs').all() as any[]
    assert.equal(rows.length,10);assert.ok(rows.every(row=>row.ip==='192.0.2.33'&&row.path==='/api/feedback/:feedbackId/comments'&&row.reason==='General API rate limit exceeded'))
    assert.equal((db.prepare('SELECT ip FROM ip_blacklist').get() as any).ip,'192.0.2.33')
  }finally{db.close()}
  const output=readdirSync(join(dir,'logs')).filter(name=>name.endsWith('.log')).map(name=>readFileSync(join(dir,'logs',name),'utf8')).join('\n')+result.stdout+result.stderr
  assert.match(output,/Source blacklisted for 24 hours/)
  for(const value of [marker,ua,'192.0.2.33'])assert.ok(!output.includes(value))
})


test('T-33 malformed route parameters return 400 without persisting the raw business marker to stderr', async t => {
  const service=await startBackend();t.after(service.stop)
  const response=await fetch(service.baseUrl+'/api/feedback/T33-uri-marker-992%E0')
  assert.equal(response.status,400);await response.text()
  await delay(100);await service.stop()
  assert.ok(!service.output().includes('T33-uri-marker-992'))
})
