import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend } from './helpers'

// Only fixture children load this probe. It counts session Map writes without
// exposing tokens or changing any production source/HTTP interface.
async function startWithSessionProbe(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T09-probe-'))
  const counter = path.join(dir, 'session-count.txt')
  const probe = path.join(dir, 'probe.cjs')
  writeFileSync(counter, '0')
  writeFileSync(probe, `
    const fs = require('node:fs');
    const counter = ${JSON.stringify(counter)};
    const originalSet = Map.prototype.set;
    Map.prototype.set = function(key, value) {
      const result = Reflect.apply(originalSet, this, [key, value]);
      if (typeof key === 'string' && /^[a-f0-9]{64}\\.[a-f0-9]{64}$/.test(key)
          && Number.isSafeInteger(value) && value > Date.now() + 7 * 60 * 60 * 1000
          && value <= Date.now() + 8 * 60 * 60 * 1000) {
        fs.writeFileSync(counter, String(Number(fs.readFileSync(counter, 'utf8')) + 1));
      }
      return result;
    };
  `)
  const service = await startBackend({ ...overrides, NODE_OPTIONS: `--require=${probe}` })
  return { service, sessionCount: () => Number(readFileSync(counter, 'utf8')) }
}

function retryAfter(response: Response, maximum: number) {
  const value = response.headers.get('Retry-After')
  assert.match(value || '', /^\d+$/)
  const seconds = Number(value)
  assert.ok(seconds >= 1 && seconds <= maximum, `Retry-After=${value}`)
  return seconds
}

test('T-09: both login aliases share successful and failed request quota', async (t) => {
  const { service, sessionCount } = await startWithSessionProbe({ LOGIN_RATE_LIMIT_MAX: '3', LOGIN_RATE_LIMIT_WINDOW_MS: '1200' })
  t.after(service.stop)
  const client = new Client(service)
  assert.equal((await client.login()).response.status, 200)
  assert.equal((await client.post('/api/admin/login', { password: 'wrong-fixture-password' })).response.status, 401)
  assert.equal((await client.post('/api/admin/login', { password: service.password })).response.status, 200)
  assert.equal(sessionCount(), 2)
  let waitSeconds = 0
  for (const alias of ['/api/admin/auth/login', '/api/admin/login']) {
    const rejected = await client.post(alias, { password: service.password })
    assert.equal(rejected.response.status, 429)
    assert.deepEqual(rejected.response.headers.getSetCookie(), [])
    waitSeconds = Math.max(waitSeconds, retryAfter(rejected.response, 2))
    assert.equal(sessionCount(), 2)
  }
  assert.equal((await client.request('/api/admin/auth/session')).data.authenticated, true)
  assert.equal((await client.post('/api/admin/logout', {})).response.status, 200)
  assert.equal((await client.request('/api/admin/session')).data.authenticated, false)
  const afterLogout = await client.login()
  assert.equal(afterLogout.response.status, 429)
  assert.deepEqual(afterLogout.response.headers.getSetCookie(), [])
  assert.equal(sessionCount(), 2)
  await delay(waitSeconds * 1000 + 100)
  assert.equal((await client.login()).response.status, 200)
  assert.equal(sessionCount(), 3)
  assert.equal((await client.request('/api/admin/auth/session')).data.authenticated, true)
})

test('T-09: default source quota permits ten logins and rejects the eleventh without signing a session', async (t) => {
  const { service, sessionCount } = await startWithSessionProbe()
  t.after(service.stop)
  const client = new Client(service)
  for (let index = 0; index < 10; index++) {
    const alias = index % 2 ? '/api/admin/login' : '/api/admin/auth/login'
    const result = await client.post(alias, { password: service.password })
    assert.equal(result.response.status, 200)
    assert.equal(result.response.headers.get('RateLimit-Limit'), '10')
  }
  assert.equal(sessionCount(), 10)
  const rejected = await client.login()
  assert.equal(rejected.response.status, 429)
  assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  retryAfter(rejected.response, 60)
  assert.equal(sessionCount(), 10)
})

test('T-09: malformed and oversized JSON consume quota before parsing; preflight does not', async (t) => {
  const { service, sessionCount } = await startWithSessionProbe({ LOGIN_RATE_LIMIT_MAX: '3', LOGIN_RATE_LIMIT_WINDOW_MS: '2000' })
  t.after(service.stop)
  const client = new Client(service)
  const preflight = await client.request('/api/admin/login', {
    method: 'OPTIONS', headers: { Origin: service.baseUrl, 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(preflight.response.status, 204)
  for (const [alias, body, status] of [
    ['/api/admin/login', '{"password":', 400],
    ['/api/admin/auth/login', JSON.stringify({ password: 'x'.repeat(400000) }), 413],
  ] as const) {
    const result = await client.request(alias, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    assert.equal(result.response.status, status)
    assert.deepEqual(result.response.headers.getSetCookie(), [])
    assert.equal(sessionCount(), 0)
  }
  assert.equal((await client.login()).response.status, 200)
  assert.equal(sessionCount(), 1)
  const overQuotaMalformed = await client.request('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":',
  })
  assert.equal(overQuotaMalformed.response.status, 429)
  assert.deepEqual(overQuotaMalformed.response.headers.getSetCookie(), [])
  retryAfter(overQuotaMalformed.response, 2)
  const overQuotaCorrect = await client.login()
  assert.equal(overQuotaCorrect.response.status, 429)
  assert.deepEqual(overQuotaCorrect.response.headers.getSetCookie(), [])
  assert.equal(sessionCount(), 1)
})

test('T-09: five wrong passwords retain the separate fifteen-minute production lock', async (t) => {
  const { service, sessionCount } = await startWithSessionProbe({ LOGIN_RATE_LIMIT_MAX: '10', LOGIN_RATE_LIMIT_WINDOW_MS: '1000' })
  t.after(service.stop)
  const client = new Client(service)
  for (let index = 0; index < 5; index++) {
    const result = await client.post(index % 2 ? '/api/admin/login' : '/api/admin/auth/login', { password: 'wrong-fixture-password' })
    assert.equal(result.response.status, 401)
    assert.deepEqual(result.response.headers.getSetCookie(), [])
  }
  const locked = await client.login()
  assert.equal(locked.response.status, 429)
  assert.deepEqual(locked.response.headers.getSetCookie(), [])
  assert.ok(retryAfter(locked.response, 900) >= 899)
  assert.equal(sessionCount(), 0)
  await delay(1100)
  const stillLocked = await client.post('/api/admin/login', { password: service.password })
  assert.equal(stillLocked.response.status, 429)
  assert.deepEqual(stillLocked.response.headers.getSetCookie(), [])
  assert.ok(retryAfter(stillLocked.response, 900) >= 897)
  assert.equal(sessionCount(), 0)
  assert.equal((await client.request('/api/admin/auth/session')).data.authenticated, false)
})

test('T-09: the published demo password is also limited across aliases', async (t) => {
  const { service, sessionCount } = await startWithSessionProbe({ DEMO_MODE: '1', LOGIN_RATE_LIMIT_MAX: '2', LOGIN_RATE_LIMIT_WINDOW_MS: '1000' })
  t.after(service.stop)
  const client = new Client(service)
  const { data: config } = await client.request('/api/demo/config')
  assert.equal(config.demoMode, true)
  for (const alias of ['/api/admin/auth/login', '/api/admin/login']) {
    assert.equal((await client.post(alias, { password: config.adminPassword })).response.status, 200)
  }
  const rejected = await client.post('/api/admin/auth/login', { password: config.adminPassword })
  assert.equal(rejected.response.status, 429)
  assert.deepEqual(rejected.response.headers.getSetCookie(), [])
  retryAfter(rejected.response, 1)
  assert.equal(sessionCount(), 2)
})

test('T-09: invalid login limiter configuration rejects startup explicitly', async (t) => {
  for (const [name, values] of [
    ['LOGIN_RATE_LIMIT_MAX', ['', '0', '-1', '1.5', 'abc', 'Infinity', '9007199254740993']],
    ['LOGIN_RATE_LIMIT_WINDOW_MS', ['', '0', '-1', '1e3', 'Infinity', '2147483648']],
  ] as const) {
    for (const value of values) {
      const service = await launchBackend({ [name]: value })
      t.after(service.stop)
      const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
      assert.notEqual(exit, 'timeout', name)
      assert.notEqual(exit, 0, name)
      assert.ok(service.output().includes(name), `${name} should identify the invalid configuration`)
    }
  }
})
