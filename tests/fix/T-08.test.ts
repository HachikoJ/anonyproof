import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend } from './helpers'

function retryAfter(response: Response, max: number) {
  const value = response.headers.get('Retry-After')
  assert.match(value || '', /^\d+$/)
  const seconds = Number(value)
  assert.ok(seconds >= 1 && seconds <= max)
  return seconds
}
function snapshot(db: ReturnType<Awaited<ReturnType<typeof startBackend>>['openDb']>) {
  return Object.fromEntries(['client_identities', 'client_identity_sessions', 'client_identity_install_keys',
    'feedbacks', 'feedback_comments', 'notifications'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

test('T-08: different invalid recovery codes share source quota; rejected recovery cannot issue or rebind credentials', async t => {
  const service = await startBackend({ RECOVERY_RATE_LIMIT_MAX: '3', RECOVERY_RATE_LIMIT_WINDOW_MS: '1200' })
  t.after(service.stop)
  const user = new Client(service)
  const { data: identity } = await user.identity()
  const db = service.openDb(); t.after(() => db.close())
  const before = snapshot(db)
  for (const recoveryCode of ['not-a-valid-code', 'A'.repeat(20), 'B'.repeat(20)]) {
    const attempt = await new Client(service).post('/api/identity/recover', { recoveryCode })
    assert.equal(attempt.response.status, 404)
    assert.deepEqual(attempt.data, { error: '恢复码无效，请检查后重试' })
    assert.deepEqual(attempt.response.headers.getSetCookie(), [])
    assert.deepEqual(snapshot(db), before)
  }
  const fresh = new Client(service)
  const rejected = await fresh.post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  assert.equal(rejected.response.status, 429)
  assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  assert.deepEqual(snapshot(db), before)
  const seconds = retryAfter(rejected.response, 2)
  assert.equal((await user.request('/api/feedback/device/' + identity.deviceId)).response.status, 200)
  await delay(seconds * 1000 + 100)
  const recovered = await fresh.post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  assert.equal(recovered.response.status, 200)
  assert.equal(recovered.data.deviceId, identity.deviceId)
  assert.ok(recovered.response.headers.getSetCookie().length)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as { n: number }).n, 1)
})

test('T-08: successful recovery also consumes quota, default ten-per-minute rejects the eleventh', async t => {
  const service = await startBackend(); t.after(service.stop)
  const user = new Client(service); const { data: identity } = await user.identity()
  const db = service.openDb(); t.after(() => db.close())
  for (let index = 0; index < 10; index++) {
    const recovered = await new Client(service).post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
    assert.equal(recovered.response.status, 200)
    assert.equal(recovered.data.deviceId, identity.deviceId)
    assert.equal(recovered.response.headers.get('RateLimit-Limit'), '10')
  }
  const before = snapshot(db)
  const rejected = await new Client(service).post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  assert.equal(rejected.response.status, 429)
  assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  assert.deepEqual(snapshot(db), before)
  retryAfter(rejected.response, 60)
})

test('T-08: malformed/oversized recovery POSTs consume quota before parsing; wrong Origin and preflight do not', async t => {
  const service = await startBackend({ RECOVERY_RATE_LIMIT_MAX: '2', RECOVERY_RATE_LIMIT_WINDOW_MS: '2000' }); t.after(service.stop)
  const client = new Client(service)
  assert.equal((await client.request('/api/identity/recover', { method: 'OPTIONS', headers: { Origin: service.baseUrl, 'Access-Control-Request-Method': 'POST' } })).response.status, 204)
  assert.equal((await client.request('/api/identity/recover', { method: 'POST', headers: { Origin: 'https://outside.invalid', 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403)
  for (const [body, status] of [['{"recoveryCode":', 400], [JSON.stringify({ recoveryCode: 'x'.repeat(400000) }), 413]] as const) {
    const result = await client.request('/api/identity/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    assert.equal(result.response.status, status)
    assert.deepEqual(result.response.headers.getSetCookie(), [])
  }
  const exhausted = await client.post('/api/identity/recover', { recoveryCode: 'x' })
  assert.equal(exhausted.response.status, 429)
  assert.deepEqual(exhausted.response.headers.getSetCookie(), [])
  retryAfter(exhausted.response, 2)
  const db = service.openDb(); t.after(() => db.close())
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identity_sessions').get() as { n: number }).n, 0)
})

test('T-08: invalid recovery limiter values reject startup by the offending configuration name', async t => {
  for (const [name, values] of [
    ['RECOVERY_RATE_LIMIT_MAX', ['', '0', '-1', '1.5', 'abc', '9007199254740993']],
    ['RECOVERY_RATE_LIMIT_WINDOW_MS', ['', '0', '-1', '1e3', '2147483648']],
  ] as const) for (const value of values) {
    const service = await launchBackend({ [name]: value }); t.after(service.stop)
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout'); assert.notEqual(exit, 0)
    assert.ok(service.output().includes(name))
  }
})
