import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, startBackend } from './helpers'

// Test-only preload instruments the real backing Maps, without adding a
// production endpoint/configuration or recording session/recovery values.
// Synthetic filler reaches the actual production bounds after one real write.
async function probed(options: { sessions?: boolean; attempts?: boolean; codes?: boolean; demo?: boolean; identityCap?: string } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T22-http-'))
  const stateFile = path.join(dir, 'state.json')
  const timeFile = path.join(dir, 'time.txt')
  const preload = path.join(dir, 'preload.cjs')
  writeFileSync(timeFile, '0')
  writeFileSync(preload, `
    const fs = require('node:fs');
    const timeFile = ${JSON.stringify(timeFile)}, stateFile = ${JSON.stringify(stateFile)};
    const fill = ${JSON.stringify(options)};
    const originalNow = Date.now, originalSet = Map.prototype.set, originalInterval = global.setInterval;
    const stores = {}, filled = {};
    Date.now = () => originalNow() + Number(fs.readFileSync(timeFile, 'utf8'));
    function report() {
      fs.writeFileSync(stateFile + '.next', JSON.stringify(Object.fromEntries(Object.entries(stores).map(([k,v]) => [k,v.size]))));
      fs.renameSync(stateFile + '.next', stateFile);
    }
    Map.prototype.set = function(key, entry) {
      const result = Reflect.apply(originalSet, this, [key, entry]);
      if (!entry || typeof entry !== 'object' || !('expiresAt' in entry) || !('value' in entry)) return result;
      const value = entry.value;
      let kind;
      if (typeof key === 'string' && /^[a-f0-9]{64}\\.[a-f0-9]{64}$/.test(key) && typeof value === 'number') kind = 'sessions';
      else if (value && typeof value.count === 'number' && typeof value.resetAt === 'number') kind = 'attempts';
      else if (value && typeof value.code === 'string' && typeof value.expiresAt === 'number') kind = 'codes';
      if (!kind) return result;
      stores[kind] = this;
      if (fill[kind] && !filled[kind]) {
        filled[kind] = true;
        const bound = kind === 'sessions' ? 1000 : 10000;
        for (let n = 1; n < bound; n++) {
          const filler = kind === 'sessions' ? value : kind === 'attempts' ? {count: 5, resetAt: value.resetAt} : {code: 'synthetic-cache-filler', expiresAt: value.expiresAt};
          Reflect.apply(originalSet, this, ['T22-synthetic-' + n, {value: filler, expiresAt: entry.expiresAt}]);
        }
      }
      report();
      return result;
    };
    global.setInterval = function(callback, ms, ...args) {
      if (ms === 60000 && String(callback).includes('cleanup')) {
        return originalInterval(() => { callback(); report(); }, 20, ...args);
      }
      return originalInterval(callback, ms, ...args);
    };
  `)
  const service = await startBackend({
    NODE_OPTIONS: `--require=${preload}`, LOGIN_RATE_LIMIT_MAX: '1000', IDENTITY_RATE_LIMIT_MAX: '1000',
    ...(options.attempts ? { TRUST_PROXY: '1' } : {}),
    ...(options.demo ? { DEMO_MODE: '1' } : {}),
    ...(options.identityCap ? { IDENTITY_MAX_RECORDS: options.identityCap } : {}),
  })
  return {
    service,
    advance: async (ms: number) => {
      writeFileSync(timeFile, String(ms))
      await delay(150)
    },
    state: () => JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, number>,
  }
}

function rows(db: ReturnType<Awaited<ReturnType<typeof startBackend>>['openDb']>) {
  return ['client_identities', 'client_identity_sessions', 'client_identity_install_keys', 'feedbacks', 'feedback_comments', 'notifications']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
}

test('T-22 HTTP capacity refuses demo login before cookies/identity/clones, preserves valid sessions, timer reclaims and logout deletes', async t => {
  const f = await probed({ sessions: true, demo: true })
  t.after(f.service.stop)
  const admin = new Client(f.service)
  const config = await admin.request('/api/demo/config')
  // Use the published runtime demo password rather than any fixture formal secret.
  assert.equal((await admin.post('/api/admin/login', { password: config.data.adminPassword })).response.status, 200)
  assert.equal(f.state().sessions, 1000)
  assert.equal((await admin.request('/api/admin/auth/session')).data.authenticated, true)
  const db = f.service.openDb()
  t.after(() => db.close())
  const before = rows(db)
  const denied = await new Client(f.service).post('/api/admin/auth/login', { password: config.data.adminPassword })
  assert.equal(denied.response.status, 503)
  assert.deepEqual(denied.response.headers.getSetCookie(), [])
  assert.deepEqual(rows(db), before)
  assert.equal(f.state().sessions, 1000)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, true)
  await f.advance(8 * 60 * 60_000 - 10_000)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, true)
  await f.advance(8 * 60 * 60_000)
  // No lookup of the old token occurred between advancing and observing size.
  assert.equal(f.state().sessions, 0)
  assert.equal((await admin.request('/api/admin/auth/session')).data.authenticated, false)
  const loggedIn = await admin.post('/api/admin/auth/login', { password: config.data.adminPassword })
  assert.equal(loggedIn.response.status, 200)
  assert.equal(f.state().sessions, 1)
  const cookie = loggedIn.response.headers.getSetCookie().find(value => value.startsWith('anonyproof_admin_session='))!.split(';')[0]
  const invalid = await new Client(f.service).request('/api/admin/session', { headers: { Cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') } })
  assert.equal(invalid.data.authenticated, false)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, true)
  assert.equal((await admin.post('/api/admin/logout', {})).response.status, 200)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, false)
  await delay(50)
  assert.equal(f.state().sessions, 0)
})

test('T-22 HTTP full failure store rejects a new source, retains old lockout and automatically expires all 10000 entries', async t => {
  const f = await probed({ attempts: true })
  t.after(f.service.stop)
  const client = new Client(f.service)
  const wrong = (source: string) => client.request('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': source },
    body: JSON.stringify({ password: 'synthetic-wrong-password' }),
  })
  for (let n = 0; n < 5; n++) assert.equal((await wrong('203.0.113.10')).response.status, 401)
  assert.equal(f.state().attempts, 10000)
  const denied = await wrong('203.0.113.11')
  assert.equal(denied.response.status, 503)
  assert.deepEqual(denied.response.headers.getSetCookie(), [])
  assert.equal(f.state().attempts, 10000)
  assert.equal((await wrong('203.0.113.10')).response.status, 429)
  const valid = await new Client(f.service).request('/api/admin/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.12' },
    body: JSON.stringify({ password: f.service.password }),
  })
  assert.equal(valid.response.status, 200)
  assert.equal(f.state().attempts, 10000)
  assert.equal((await wrong('203.0.113.10')).response.status, 429)
  await f.advance(15 * 60_000 - 10_000)
  assert.equal((await wrong('203.0.113.10')).response.status, 429)
  assert.equal(f.state().attempts, 10000)
  await f.advance(15 * 60_000)
  assert.equal(f.state().attempts, 0)
  assert.equal((await wrong('203.0.113.11')).response.status, 401)
  assert.equal(f.state().attempts, 1)
})

test('T-22 real display cache evicts oldest at 10000 without changing saved R1, and timer expires entries without reads', async t => {
  const f = await probed({ codes: true })
  t.after(f.service.stop)
  const user = new Client(f.service)
  const identity = await user.identity()
  assert.equal(identity.response.status, 200)
  assert.equal(f.state().codes, 10000)
  const saved = identity.data.recoveryCode
  const db = f.service.openDb()
  t.after(() => db.close())
  const before = db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id=?').get(identity.data.deviceId)
  assert.equal((await new Client(f.service).identity()).response.status, 200)
  assert.equal(f.state().codes, 10000)
  const afterEviction = await user.identity()
  assert.equal(afterEviction.response.status, 200)
  assert.equal(afterEviction.data.deviceId, identity.data.deviceId)
  assert.equal(afterEviction.data.recoveryCode, undefined)
  assert.deepEqual(db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id=?').get(identity.data.deviceId), before)
  const recovered = await new Client(f.service).post('/api/identity/recover', { recoveryCode: saved })
  assert.equal(recovered.response.status, 200)
  assert.equal(recovered.data.deviceId, identity.data.deviceId)
  await f.advance(10 * 60_000 - 10_000)
  assert.equal(f.state().codes, 10000)
  await f.advance(10 * 60_000)
  assert.equal(f.state().codes, 0)
  const missing = await user.identity()
  assert.equal(missing.response.status, 200)
  assert.equal(missing.data.recoveryCode, undefined)
  assert.deepEqual(db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id=?').get(identity.data.deviceId), before)
})


test('T-22 demo identity failure releases the reserved admin session and never signs cookies', async t => {
  const f = await probed({ demo: true, identityCap: '1' })
  t.after(f.service.stop)
  const admin = new Client(f.service)
  const config = await admin.request('/api/demo/config')
  assert.equal((await admin.post('/api/admin/login', { password: config.data.adminPassword })).response.status, 200)
  const db = f.service.openDb()
  t.after(() => db.close())
  const before = rows(db)
  const failed = await new Client(f.service).post('/api/admin/login', { password: config.data.adminPassword })
  assert.equal(failed.response.status, 503)
  assert.deepEqual(failed.response.headers.getSetCookie(), [])
  assert.deepEqual(rows(db), before)
  await delay(50)
  assert.equal(f.state().sessions, 1)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, true)
})
