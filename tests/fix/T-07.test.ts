import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, startBackend, launchBackend, type TestService } from './helpers'

function snapshot(db: ReturnType<TestService['openDb']>) {
  return Object.fromEntries(['feedback_comments', 'notifications'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
async function feedback(user: Client) {
  const identity = (await user.identity()).data
  const created = await user.post('/api/feedback', { deviceId: identity.deviceId, category: 'report', originalContent: 'T07 synthetic parent', encryptedContent: 'fixture-cipher' })
  assert.equal(created.response.status, 200)
  return created.data.id as string
}
const comment = (client: Client, id: string) => client.post(`/api/feedback/${id}/comments`, { content: 'T07 synthetic user supplement' })
function waitSeconds(response: Response) {
  const header = response.headers.get('Retry-After'); assert.match(header || '', /^\d+$/)
  const value = Number(header); assert.ok(value >= 1 && value <= 2); return value
}

test('T-07: user quota spans feedback IDs, unauthorized identities stay rejected and no comments/notices appear on 429', async t => {
  const service = await startBackend({ COMMENT_RATE_LIMIT_MAX: '100', COMMENT_IDENTITY_RATE_LIMIT_MAX: '2', COMMENT_RATE_LIMIT_WINDOW_MS: '1200' }); t.after(service.stop)
  const user = new Client(service), other = new Client(service)
  const ids = [await feedback(user), await feedback(user)], otherId = await feedback(other)
  const db = service.openDb(); t.after(() => db.close())
  assert.equal((await comment(user, ids[0])).response.status, 200)
  assert.equal((await comment(user, ids[1])).response.status, 200)
  const before = snapshot(db)
  assert.equal((await comment(user, otherId)).response.status, 401)
  assert.equal((await comment(new Client(service), ids[0])).response.status, 401)
  assert.deepEqual(snapshot(db), before)
  const rejected = await comment(user, ids[1])
  assert.equal(rejected.response.status, 429); assert.equal(rejected.response.headers.get('RateLimit-Limit'), '2')
  assert.deepEqual(rejected.response.headers.getSetCookie(), []); assert.deepEqual(snapshot(db), before)
  assert.equal((await comment(other, otherId)).response.status, 200)
  // Dedicated administrator reply keeps its existing privileges and quota.
  const admin = new Client(service); assert.equal((await admin.login()).response.status, 200)
  assert.equal((await admin.post(`/api/admin/feedback/${ids[0]}/comments`, { content: 'T07 synthetic administrator reply' })).response.status, 200)
  assert.equal((await user.request(`/api/feedback/${ids[0]}/comments`)).response.status, 200)
  await delay(waitSeconds(rejected.response) * 1000 + 100)
  assert.equal((await comment(user, ids[0])).response.status, 200)
})

test('T-07: source quota spans identities and changing untrusted XFF cannot reset it', async t => {
  const service = await startBackend({ COMMENT_RATE_LIMIT_MAX: '3', COMMENT_IDENTITY_RATE_LIMIT_MAX: '100', COMMENT_RATE_LIMIT_WINDOW_MS: '1200', TRUST_PROXY: '0' }); t.after(service.stop)
  const users = Array.from({ length: 4 }, () => new Client(service)), ids: string[] = []
  for (const user of users) ids.push(await feedback(user))
  const db = service.openDb(); t.after(() => db.close())
  for (let index = 0; index < 3; index++) {
    const result = await users[index].request(`/api/feedback/${ids[index]}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${index + 1}` }, body: JSON.stringify({ content: 'T07 source fixture' }) })
    assert.equal(result.response.status, 200)
  }
  const before = snapshot(db)
  const rejected = await users[3].request(`/api/feedback/${ids[3]}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' }, body: JSON.stringify({ content: 'T07 source fixture' }) })
  assert.equal(rejected.response.status, 429); assert.equal(rejected.response.headers.get('RateLimit-Limit'), '3')
  assert.deepEqual(snapshot(db), before)
  await delay(waitSeconds(rejected.response) * 1000 + 100)
  assert.equal((await comment(users[3], ids[3])).response.status, 200)
})

test('T-07: default identity quota is twenty; threshold one can be configured', async t => {
  for (const [overrides, maximum] of [[{}, 20], [{ COMMENT_RATE_LIMIT_MAX: '1', COMMENT_IDENTITY_RATE_LIMIT_MAX: '1' }, 1]] as [Record<string, string>, number][]) {
    const service = await startBackend(overrides); t.after(service.stop)
    const user = new Client(service), id = await feedback(user), db = service.openDb(); t.after(() => db.close())
    for (let index = 0; index < maximum; index++) assert.equal((await comment(user, id)).response.status, 200)
    const before = snapshot(db), rejected = await comment(user, id)
    assert.equal(rejected.response.status, 429); assert.deepEqual(snapshot(db), before)
    assert.ok(Number(rejected.response.headers.get('Retry-After')) >= 1)
  }
})

test('T-07: existing formal-admin access to the user-comment route is preserved and spans target IDs', async t => {
  const service = await startBackend({ COMMENT_RATE_LIMIT_MAX: '100', COMMENT_IDENTITY_RATE_LIMIT_MAX: '2' }); t.after(service.stop)
  const user = new Client(service), admin = new Client(service)
  const ids = [await feedback(user), await feedback(user)]
  assert.equal((await admin.login()).response.status, 200)
  const db = service.openDb(); t.after(() => db.close())
  for (const id of ids) {
    const response = await comment(admin, id)
    assert.equal(response.response.status, 200); assert.equal(response.data.comment.commenter_type, 'user')
  }
  const before = snapshot(db)
  assert.equal((await comment(admin, ids[0])).response.status, 429)
  assert.deepEqual(snapshot(db), before)
  assert.equal((await admin.post('/api/admin/auth/logout', {})).response.status, 200)
  assert.equal((await comment(admin, ids[0])).response.status, 401)
  assert.deepEqual(snapshot(db), before)
})

test('T-07: invalid limiter configuration fails startup by its name', async t => {
  for (const name of ['COMMENT_RATE_LIMIT_MAX', 'COMMENT_IDENTITY_RATE_LIMIT_MAX', 'COMMENT_RATE_LIMIT_WINDOW_MS']) for (const value of ['0', '-1', 'abc', name.endsWith('WINDOW_MS') ? '2147483648' : '9007199254740993']) {
    const service = await launchBackend({ [name]: value }); t.after(service.stop)
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout'); assert.notEqual(exit, 0); assert.ok(service.output().includes(name))
  }
})
