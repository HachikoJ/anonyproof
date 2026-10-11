import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend, type TestService } from './helpers'

const limits = [
  ['LOGIN_RATE_LIMIT_MAX', 'login'],
  ['IDENTITY_RATE_LIMIT_MAX', 'identity'],
  ['RECOVERY_RATE_LIMIT_MAX', 'recover'],
  ['FEEDBACK_RATE_LIMIT_MAX', 'feedback'],
  ['FEEDBACK_IDENTITY_RATE_LIMIT_MAX', 'feedback'],
  ['COMMENT_RATE_LIMIT_MAX', 'comment'],
  ['COMMENT_IDENTITY_RATE_LIMIT_MAX', 'comment'],
] as const
function count(db: ReturnType<TestService['openDb']>, table: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}
async function operation(service: TestService, kind: typeof limits[number][1]) {
  const client = new Client(service)
  if (kind === 'login') return () => client.login()
  if (kind === 'identity') return () => new Client(service).identity()
  const identity = (await client.identity()).data
  if (kind === 'recover') return () => new Client(service).post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  const body = { category: 'report', deviceId: identity.deviceId, originalContent: 'T31 synthetic config boundary', encryptedContent: 'fixture-cipher' }
  if (kind === 'feedback') return () => client.post('/api/feedback', body)
  const submitted = await client.post('/api/feedback', body); assert.equal(submitted.response.status, 200)
  return () => client.post(`/api/feedback/${submitted.data.id}/comments`, { content: 'T31 synthetic comment boundary' })
}

test('T-31: each supported request maximum independently enforces configured boundaries one and three', async t => {
  for (const [name, kind] of limits) for (const maximum of [1, 3]) await t.test(`${name}=${maximum}`, async tt => {
    const service = await startBackend({
      LOGIN_RATE_LIMIT_MAX: '100', IDENTITY_RATE_LIMIT_MAX: '100', RECOVERY_RATE_LIMIT_MAX: '100',
      FEEDBACK_RATE_LIMIT_MAX: '100', FEEDBACK_IDENTITY_RATE_LIMIT_MAX: '100',
      COMMENT_RATE_LIMIT_MAX: '100', COMMENT_IDENTITY_RATE_LIMIT_MAX: '100', [name]: String(maximum),
    }); tt.after(service.stop)
    const perform = await operation(service, kind)
    for (let index = 0; index < maximum; index++) assert.equal((await perform()).response.status, 200, `${name}: admissible ${index + 1}`)
    const db = service.openDb(); tt.after(() => db.close())
    const before = Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'client_identities', 'client_identity_sessions'].map(table => [table, count(db, table)]))
    const rejected = await perform()
    assert.equal(rejected.response.status, 429, name)
    assert.equal(rejected.response.headers.get('RateLimit-Limit'), String(maximum), name)
    assert.ok(Number(rejected.response.headers.get('Retry-After')) >= 1)
    assert.deepEqual(rejected.response.headers.getSetCookie(), [])
    assert.deepEqual(Object.fromEntries(Object.keys(before).map(table => [table, count(db, table)])), before)
  })
})

test('T-31: legacy RATE_LIMIT_MAX is explicitly deprecated, cannot be mistaken for effective protection', async t => {
  const service = await startBackend({ RATE_LIMIT_MAX: '1' }); t.after(service.stop)
  assert.ok(service.output().includes('RATE_LIMIT_MAX 已弃用且不生效'))
  const client = new Client(service)
  for (let index = 0; index < 10; index++) assert.equal((await client.login()).response.status, 200)
  const rejected = await client.login()
  assert.equal(rejected.response.status, 429); assert.equal(rejected.response.headers.get('RateLimit-Limit'), '10')
})
