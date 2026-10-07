import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend, type TestService } from './helpers'

function snapshot(db: ReturnType<TestService['openDb']>) {
  return Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'stats'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function seconds(response: Response) {
  const header = response.headers.get('Retry-After')
  assert.match(header || '', /^\d+$/)
  const value = Number(header); assert.ok(value >= 1 && value <= 2)
  return value
}
async function submit(client: Client, deviceId: string, headers?: Record<string, string>) {
  return client.request('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({
    category: 'report', deviceId, originalContent: 'T06 synthetic quota fixture', encryptedContent: 'fixture-cipher',
  }) })
}

test('T-06: identity quota spans submissions and caller-supplied device IDs cannot select another quota', async t => {
  const service = await startBackend({ FEEDBACK_RATE_LIMIT_MAX: '100', FEEDBACK_IDENTITY_RATE_LIMIT_MAX: '2', FEEDBACK_RATE_LIMIT_WINDOW_MS: '1200' }); t.after(service.stop)
  const user = new Client(service), other = new Client(service)
  const { data: identity } = await user.identity(), { data: otherIdentity } = await other.identity()
  const db = service.openDb(); t.after(() => db.close())
  for (let index = 0; index < 2; index++) assert.equal((await submit(user, identity.deviceId)).response.status, 200)
  const before = snapshot(db)
  assert.equal((await submit(user, otherIdentity.deviceId)).response.status, 403)
  assert.deepEqual(snapshot(db), before)
  const rejected = await submit(user, identity.deviceId)
  assert.equal(rejected.response.status, 429)
  assert.equal(rejected.response.headers.get('RateLimit-Limit'), '2')
  assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  assert.deepEqual(snapshot(db), before)
  assert.equal((await submit(new Client(service), identity.deviceId)).response.status, 401)
  // Another identity is not affected by the first identity's quota.
  assert.equal((await submit(other, otherIdentity.deviceId)).response.status, 200)
  assert.equal((await user.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks.length, 2)
  await delay(seconds(rejected.response) * 1000 + 100)
  assert.equal((await submit(user, identity.deviceId)).response.status, 200)
})

test('T-06: source quota cannot be evaded by changing identities or untrusted forwarded headers', async t => {
  const service = await startBackend({ FEEDBACK_RATE_LIMIT_MAX: '3', FEEDBACK_IDENTITY_RATE_LIMIT_MAX: '100', FEEDBACK_RATE_LIMIT_WINDOW_MS: '1200', TRUST_PROXY: '0' }); t.after(service.stop)
  const users = Array.from({ length: 4 }, () => new Client(service))
  const ids = [] as string[]
  for (const user of users) ids.push((await user.identity()).data.deviceId)
  const db = service.openDb(); t.after(() => db.close())
  for (let index = 0; index < 3; index++) assert.equal((await submit(users[index], ids[index], { 'X-Forwarded-For': `203.0.113.${index + 1}` })).response.status, 200)
  const before = snapshot(db)
  const rejected = await submit(users[3], ids[3], { 'X-Forwarded-For': '203.0.113.99' })
  assert.equal(rejected.response.status, 429)
  assert.equal(rejected.response.headers.get('RateLimit-Limit'), '3')
  assert.deepEqual(snapshot(db), before)
  assert.equal((await submit(new Client(service), ids[3])).response.status, 401)
  assert.equal((await users[3].request('/health')).response.status, 200)
  await delay(seconds(rejected.response) * 1000 + 100)
  assert.equal((await submit(users[3], ids[3])).response.status, 200)
})

test('T-06: default quota admits ten and blocks eleventh, boundary one is configurable', async t => {
  for (const [overrides, maximum] of [[{}, 10], [{ FEEDBACK_RATE_LIMIT_MAX: '1', FEEDBACK_IDENTITY_RATE_LIMIT_MAX: '1' }, 1]] as [Record<string, string>, number][]) {
    const service = await startBackend(overrides); t.after(service.stop)
    const user = new Client(service); const identity = (await user.identity()).data
    const db = service.openDb(); t.after(() => db.close())
    for (let index = 0; index < maximum; index++) assert.equal((await submit(user, identity.deviceId)).response.status, 200)
    const before = snapshot(db)
    const rejected = await submit(user, identity.deviceId)
    assert.equal(rejected.response.status, 429)
    assert.deepEqual(snapshot(db), before)
    assert.ok(Number(rejected.response.headers.get('Retry-After')) >= 1)
  }
})

test('T-06: invalid source/identity/window configuration fails startup explicitly', async t => {
  for (const name of ['FEEDBACK_RATE_LIMIT_MAX', 'FEEDBACK_IDENTITY_RATE_LIMIT_MAX', 'FEEDBACK_RATE_LIMIT_WINDOW_MS']) {
    for (const value of ['0', '-1', 'abc', name.endsWith('WINDOW_MS') ? '2147483648' : '9007199254740993']) {
      const service = await launchBackend({ [name]: value }); t.after(service.stop)
      const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
      assert.notEqual(exit, 'timeout'); assert.notEqual(exit, 0); assert.ok(service.output().includes(name))
    }
  }
})
