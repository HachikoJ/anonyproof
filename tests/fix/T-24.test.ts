import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import Database from 'better-sqlite3'
import { createProxyBoundary } from '../../server/middleware/proxyBoundary'
import { startBackend } from './helpers'

test('T-24 proxy configuration fails closed without a canonical independent key', () => {
  for (const key of [undefined, '', 'placeholder', randomBytes(31).toString('base64'), randomBytes(65).toString('base64')]) {
    assert.throws(() => createProxyBoundary({ TRUST_PROXY: '1', PROXY_AUTH_KEY: key }))
  }
  assert.throws(() => createProxyBoundary({ TRUST_PROXY: 'true' }))
  assert.doesNotThrow(() => createProxyBoundary({ TRUST_PROXY: '0' }))
  assert.doesNotThrow(() => createProxyBoundary({ TRUST_PROXY: '1', PROXY_AUTH_KEY: randomBytes(32).toString('base64') }))
})

test('T-24 real backend rejects missing/wrong/repeated proxy keys and non-normalized source before writes; health stays local', async t => {
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ TRUST_PROXY: '1', PROXY_AUTH_KEY: key })
  t.after(service.stop)
  const db = new Database(service.databasePath)
  t.after(() => db.close())
  const snapshot = () => JSON.stringify(Object.fromEntries(['client_identities','client_identity_sessions','feedbacks',
    'feedback_comments','notifications','access_logs','rate_limit_logs'].map(table => [table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
  const before = snapshot()
  const headers = { Origin: service.baseUrl, 'X-Forwarded-For': '203.0.113.17', 'Content-Type':'application/json' }
  for (const credential of [undefined, 'incorrect-key', key + 'x']) {
    const response = await fetch(service.baseUrl + '/api/identity', { method:'POST', body:'{}',
      headers: { ...headers, ...(credential ? { 'X-AnonyProof-Proxy-Auth':credential } : {}) } })
    assert.equal(response.status,403)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.equal(response.headers.get('set-cookie'),null)
    assert.ok(!(await response.text()).includes(key))
  }
  for (const source of ['', 'not-an-ip', '203.0.113.17, 198.51.100.18']) {
    assert.equal((await fetch(service.baseUrl+'/api/identity',{method:'POST',body:'{}',
      headers:{...headers,'X-AnonyProof-Proxy-Auth':key,'X-Forwarded-For':source}})).status,403)
  }
  const duplicate = await new Promise<number>((resolve,reject) => {
    const req=http.request(service.baseUrl+'/api/identity',{method:'POST',headers:['Host',new URL(service.baseUrl).host,'Origin',service.baseUrl,
      'Content-Type','application/json','X-Forwarded-For','203.0.113.17',
      'X-AnonyProof-Proxy-Auth',key,'X-AnonyProof-Proxy-Auth',key]},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode!))
    });req.on('error',reject);req.end('{}')
  })
  assert.equal(duplicate,403)
  assert.equal(snapshot(),before)
  assert.equal((await fetch(service.baseUrl+'/health',{headers:{'X-Forwarded-For':'203.0.113.17'}})).status,200)
  const identity=await fetch(service.baseUrl+'/api/identity',{method:'POST',body:'{}',
    headers:{...headers,'X-AnonyProof-Proxy-Auth':key}})
  assert.equal(identity.status,200)
  assert.ok(identity.headers.get('set-cookie'))
  const row=db.prepare('SELECT ip FROM access_logs ORDER BY id DESC LIMIT 1').get() as {ip:string}
  assert.equal(row.ip,'203.0.113.17')
  assert.ok(!service.output().includes(key))
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM access_logs').all()).includes(key))
})

test('T-24 unproxied requests ignore all supplied source headers', async t => {
  const service=await startBackend({TRUST_PROXY:'0'})
  t.after(service.stop)
  const db=new Database(service.databasePath);t.after(()=>db.close())
  assert.equal((await fetch(service.baseUrl+'/api/stats',{headers:{'X-Forwarded-For':'203.0.113.17',
    'Forwarded':'for=198.51.100.17','X-Real-IP':'198.51.100.18','X-AnonyProof-Proxy-Auth':'untrusted'}})).status,200)
  const row=db.prepare('SELECT ip FROM access_logs ORDER BY id DESC LIMIT 1').get() as {ip:string}
  assert.equal(row.ip,'127.0.0.1')
})

test('T-24 middleware rejects a non-loopback peer even with the correct key and strips private raw headers', () => {
  const key=randomBytes(32).toString('base64')
  const boundary=createProxyBoundary({TRUST_PROXY:'1',PROXY_AUTH_KEY:key})
  for (const [peer,allowed] of [['127.0.0.1',true],['::1',true],['::ffff:127.0.0.1',true],
    ['192.0.2.17',false],['::ffff:192.0.2.17',false],['2001:db8::1',false]] as const) {
    const request:any={path:'/api/stats',socket:{remoteAddress:peer},headers:{
      'x-anonyproof-proxy-auth':key,'x-forwarded-for':'203.0.113.17'},
      rawHeaders:['X-AnonyProof-Proxy-Auth',key,'X-Forwarded-For','203.0.113.17'],
      get(name:string){return this.headers[name.toLowerCase()]}}
    let passed=false,status=200
    const response:any={status(code:number){status=code;return this},json(){return this}}
    boundary(request,response,()=>{passed=true})
    assert.equal(passed,allowed)
    assert.equal(status,allowed?200:403)
    assert.equal(request.headers['x-anonyproof-proxy-auth'],undefined)
    assert.ok(!request.rawHeaders.includes(key))
  }
})
