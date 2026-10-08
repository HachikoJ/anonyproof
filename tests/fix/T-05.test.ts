import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend, type TestService } from './helpers'

function snapshot(db: ReturnType<TestService['openDb']>) {
  return Object.fromEntries(['client_identities', 'client_identity_sessions', 'client_identity_install_keys', 'feedbacks', 'feedback_comments', 'notifications'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function count(db: ReturnType<TestService['openDb']>, table: string, where = '') {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n
}
function retrySeconds(response: Response) {
  const value = response.headers.get('Retry-After'); assert.match(value || '', /^\d+$/)
  const seconds = Number(value); assert.ok(seconds >= 1 && seconds <= 2); return seconds
}

test('T-05: identity source quota rejects before signing/creating/cloning; same install key reuses identity after window', async t => {
  const service = await startBackend({ DEMO_MODE: '1', IDENTITY_RATE_LIMIT_MAX: '2', IDENTITY_RATE_LIMIT_WINDOW_MS: '1200', IDENTITY_MAX_RECORDS: '100' }); t.after(service.stop)
  const key = 'T05_fixture_install_key_'.padEnd(48, 'a')
  const first = await new Client(service).identity({ headers: { 'X-AnonyProof-Install-Key': key } })
  assert.equal(first.response.status, 200)
  const second = await new Client(service).identity({ headers: { 'X-AnonyProof-Install-Key': key } })
  assert.equal(second.response.status, 200); assert.equal(second.data.deviceId, first.data.deviceId)
  const db = service.openDb(); t.after(() => db.close())
  assert.equal(count(db, 'client_identities'), 1); assert.equal(count(db, 'client_identity_sessions'), 2)
  assert.equal(count(db, 'client_identity_install_keys'), 1)
  assert.equal(count(db, 'client_identities', 'WHERE demo_initialized = 1'), 1)
  const before = snapshot(db)
  const rejected = await new Client(service).identity({ headers: { 'X-AnonyProof-Install-Key': 'T05_new_key_'.padEnd(48, 'b') } })
  assert.equal(rejected.response.status, 429); assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  assert.deepEqual(snapshot(db), before)
  await delay(retrySeconds(rejected.response) * 1000 + 100)
  const reused = await new Client(service).identity({ headers: { 'X-AnonyProof-Install-Key': key, 'X-AnonyProof-Recovery-Code': first.data.recoveryCode } })
  assert.equal(reused.response.status, 200); assert.equal(reused.data.deviceId, first.data.deviceId)
  assert.equal(count(db, 'client_identities'), 1)
  assert.equal(count(db, 'feedbacks', 'WHERE is_demo_clone = 1'), 7)
})

test('T-05: durable identity capacity rejects all new issuers, keeps existing identities usable and never deletes data', async t => {
  for (const demo of ['0', '1']) {
    const service = await startBackend({ DEMO_MODE: demo, IDENTITY_MAX_RECORDS: '2', IDENTITY_RATE_LIMIT_MAX: '100', DEMO_MAX_CLONES: '1' }); t.after(service.stop)
    const users = [new Client(service), new Client(service)]
    const issued = await Promise.all(users.map(user => user.identity()))
    assert.ok(issued.every(result => result.response.status === 200))
    const db = service.openDb(); t.after(() => db.close())
    assert.equal(count(db, 'client_identities'), 2)
    if (demo === '1') {
      assert.equal(count(db, 'client_identities', 'WHERE demo_initialized = 1'), 1)
      assert.equal(count(db, 'feedbacks', 'WHERE is_demo_clone = 1'), 7)
    }
    const before = snapshot(db)
    const denied = await new Client(service).identity()
    assert.equal(denied.response.status, 503); assert.deepEqual(denied.response.headers.getSetCookie(), [])
    assert.deepEqual(snapshot(db), before)
    if (demo === '1') {
      const config = (await users[0].request('/api/demo/config')).data
      const login = await new Client(service).post('/api/admin/login', { password: config.adminPassword })
      assert.equal(login.response.status, 503); assert.deepEqual(login.response.headers.getSetCookie(), [])
      assert.deepEqual(snapshot(db), before)
      assert.equal((await users[0].post('/api/admin/auth/login', { password: config.adminPassword })).response.status, 200)
    }
    const retained = await users[0].identity()
    assert.equal(retained.response.status, 200); assert.equal(retained.data.deviceId, issued[0].data.deviceId)
    const recovery = await new Client(service).post('/api/identity/recover', { recoveryCode: issued[1].data.recoveryCode })
    assert.equal(recovery.response.status, 200); assert.equal(recovery.data.deviceId, issued[1].data.deviceId)
    assert.equal(count(db, 'client_identities'), 2)
  }
})

test('T-05: default source admits ten then rejects eleventh; configurable one rejects second', async t => {
  for (const [overrides, max] of [[{}, 10], [{ IDENTITY_RATE_LIMIT_MAX: '1' }, 1]] as [Record<string, string>, number][]) {
    const service = await startBackend(overrides); t.after(service.stop)
    for (let index = 0; index < max; index++) assert.equal((await new Client(service).identity()).response.status, 200)
    const db = service.openDb(); t.after(() => db.close()); const before = snapshot(db)
    const denied = await new Client(service).identity()
    assert.equal(denied.response.status, 429); assert.deepEqual(snapshot(db), before)
    assert.equal(denied.response.headers.get('RateLimit-Limit'), String(max))
    assert.ok(Number(denied.response.headers.get('Retry-After')) >= 1)
  }
})

test('T-05: zero clone allowance creates identities without copies and never returns 500', async t => {
  const service = await startBackend({ DEMO_MODE: '1', DEMO_MAX_CLONES: '0' }); t.after(service.stop)
  for (let index = 0; index < 3; index++) assert.equal((await new Client(service).identity()).response.status, 200)
  const db = service.openDb(); t.after(() => db.close())
  assert.equal(count(db, 'client_identities'), 3); assert.equal(count(db, 'feedbacks', 'WHERE is_demo_clone = 1'), 0)
})

test('T-05: invalid identity or clone capacity configuration fails startup explicitly', async t => {
  for (const name of ['IDENTITY_RATE_LIMIT_MAX', 'IDENTITY_RATE_LIMIT_WINDOW_MS', 'IDENTITY_MAX_RECORDS', 'DEMO_MAX_CLONES']) for (const value of name === 'DEMO_MAX_CLONES' ? ['-1', 'abc', 'Infinity', '1.5'] : ['0', 'abc', name.endsWith('WINDOW_MS') ? '2147483648' : '9007199254740993']) {
    const service = await launchBackend({ [name]: value }); t.after(service.stop)
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout'); assert.notEqual(exit, 0); assert.ok(service.output().includes(name))
  }
})

test('T-05: restarting with the same fixture DB cannot reset durable identity capacity', async t => {
  const key = randomBytes(32).toString('base64')
  const first = await startBackend({ IDENTITY_MAX_RECORDS: '1', CONTENT_ENCRYPTION_KEY: key }); t.after(first.stop)
  const user = new Client(first), identity = (await user.identity()).data
  await first.stop()
  const restarted = await startBackend({ IDENTITY_MAX_RECORDS: '1', DATABASE_PATH: first.databasePath, CONTENT_ENCRYPTION_KEY: key }); t.after(restarted.stop)
  const newIdentity = await new Client(restarted).identity()
  assert.equal(newIdentity.response.status, 503); assert.deepEqual(newIdentity.response.headers.getSetCookie(), [])
  const restored = await new Client(restarted).post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  assert.equal(restored.response.status, 200); assert.equal(restored.data.deviceId, identity.deviceId)
  user.service = restarted
  assert.equal((await user.identity({ headers: { 'X-AnonyProof-Recovery-Code': identity.recoveryCode } })).response.status, 200)
  const db = restarted.openDb(); t.after(() => db.close())
  assert.equal(count(db, 'client_identities'), 1)
  // T-21 owns cache-loss passive rotation; supplying the saved code here must
  // not be misreported as proving its still-pending missing-code scenario.
})
