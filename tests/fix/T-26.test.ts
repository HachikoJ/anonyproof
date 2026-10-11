import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client, startBackend } from './helpers'

type WriteRoute = { client: Client, method: string, url: string, body: unknown }

async function write(route: WriteRoute, origin: string | undefined, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  if (origin !== undefined) headers.Origin = origin
  const options: RequestInit & { omitOrigin?: boolean } = {
    method: route.method, headers, body: JSON.stringify(route.body), omitOrigin: origin === undefined,
  }
  return route.client.request(route.url, options)
}

test('T-26: every existing cookie write route and login/logout alias rejects untrusted origins before business mutation', async (t) => {
  // This is real backend integration, not a synthetic app that mirrors the
  // proposed middleware. Requires source-guard wiring in server/index.ts.
  const probeDir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T26-probe-'))
  const counter = path.join(probeDir, 'session-count.txt')
  const probe = path.join(probeDir, 'probe.cjs')
  writeFileSync(counter, '0')
  writeFileSync(probe, `
    const fs = require('node:fs'); const counter = ${JSON.stringify(counter)};
    const set = Map.prototype.set;
    Map.prototype.set = function(key, value) {
      const result = Reflect.apply(set, this, [key, value]);
      const candidate = value?.value ?? value;
      if (typeof key === 'string' && /^[a-f0-9]{64}\\.[a-f0-9]{64}$/.test(key)
          && Number.isSafeInteger(candidate) && candidate > Date.now() + 7 * 60 * 60 * 1000
          && candidate <= Date.now() + 8 * 60 * 60 * 1000) {
        fs.writeFileSync(counter, String(Number(fs.readFileSync(counter, 'utf8')) + 1));
      }
      return result;
    };
  `)
  const service = await startBackend({ LOGIN_RATE_LIMIT_MAX: '1000', NODE_OPTIONS: `--require=${probe}` })
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const identity = await user.identity({ headers: { Origin: service.baseUrl } })
  assert.equal(identity.response.status, 200)
  const deviceId = identity.data.deviceId
  const trusted = (route: WriteRoute) => write(route, service.baseUrl)
  assert.equal((await trusted({ client: admin, method: 'POST', url: '/api/admin/auth/login', body: { password: service.password } })).response.status, 200)
  const submitted = await trusted({ client: user, method: 'POST', url: '/api/feedback', body: {
    category: 'report', deviceId, originalContent: 'synthetic source-guard fixture', encryptedContent: 'fixture-cipher',
  } })
  assert.equal(submitted.response.status, 200)
  const feedbackId = submitted.data.id
  assert.equal((await trusted({ client: admin, method: 'POST', url: `/api/admin/feedback/${feedbackId}/comments`, body: { content: 'synthetic response' } })).response.status, 200)
  const db = service.openDb()
  t.after(() => db.close())
  const notification = db.prepare("SELECT id FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? LIMIT 1").get(deviceId) as { id: number }
  assert.ok(notification)
  db.prepare('INSERT INTO ip_blacklist (ip, reason, attempts, blacklisted_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run('203.0.113.88', 'synthetic fixture', 1, Date.now(), null)
  const routes: WriteRoute[] = [
    ...['/api/admin/auth/login', '/api/admin/login'].map(url => ({ client: admin, method: 'POST', url, body: { password: service.password } })),
    ...['/api/admin/auth/logout', '/api/admin/logout'].map(url => ({ client: admin, method: 'POST', url, body: {} })),
    { client: user, method: 'POST', url: '/api/identity/recover', body: { recoveryCode: identity.data.recoveryCode } },
    { client: user, method: 'POST', url: '/api/feedback', body: { category: 'report', deviceId, originalContent: 'new synthetic fixture', encryptedContent: 'fixture-cipher' } },
    { client: user, method: 'POST', url: `/api/feedback/${feedbackId}/comments`, body: { content: 'synthetic supplement' } },
    { client: admin, method: 'POST', url: `/api/admin/feedback/${feedbackId}/comments`, body: { content: 'synthetic admin response' } },
    { client: admin, method: 'PUT', url: `/api/admin/feedback/${feedbackId}/status`, body: { status: 'resolved', solution: 'synthetic resolution completed' } },
    { client: admin, method: 'DELETE', url: `/api/admin/feedback/${feedbackId}`, body: {} },
    { client: admin, method: 'DELETE', url: '/api/admin/access/blacklist/203.0.113.88', body: {} },
    { client: user, method: 'PUT', url: `/api/notifications/${notification.id}/read`, body: {} },
    { client: user, method: 'PUT', url: `/api/notifications/${notification.id}/unread`, body: {} },
    { client: user, method: 'PUT', url: `/api/notifications/read-all?recipientType=user&recipientId=${deviceId}`, body: {} },
    { client: user, method: 'POST', url: '/api/identity', body: {} },
    { client: new Client(service), method: 'POST', url: '/api/identity', body: {} },
  ]
  const businessTables = ['feedbacks', 'feedback_comments', 'notifications', 'stats', 'admin_logs',
    'client_identities', 'client_identity_sessions', 'client_identity_install_keys', 'ip_blacklist']
  const snapshot = () => Object.fromEntries(businessTables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  const sessions = () => Number(readFileSync(counter, 'utf8'))
  for (const route of routes) {
    for (const origin of [undefined, 'null', 'https://deline.top', 'https://attacker.anonyproof.deline.top',
      'https://outside.invalid', service.baseUrl + '/', service.baseUrl + '?x=1']) {
      const before = snapshot()
      const beforeSessions = sessions()
      const rejected = await write(route, origin)
      assert.equal(rejected.response.status, 403, `${route.method} ${route.url} Origin=${origin}`)
      assert.deepEqual(rejected.response.headers.getSetCookie(), [])
      assert.deepEqual(snapshot(), before, `${route.method} ${route.url} must not write business data`)
      assert.equal(sessions(), beforeSessions, 'rejecting Origin must not create an admin session')
    }
  }
  const headerSpoofs: Record<string, string>[] = [{ Host: 'outside.invalid' }, { 'X-Forwarded-Host': 'outside.invalid' }]
  for (const extraHeaders of headerSpoofs) {
    const before = snapshot()
    assert.equal((await write(routes[4], 'https://outside.invalid', extraHeaders)).response.status, 403)
    assert.deepEqual(snapshot(), before)
  }
  assert.equal((await admin.request('/api/admin/auth/session')).data.authenticated, true)
  assert.equal((await trusted(routes[6])).response.status, 200)
  assert.equal((await trusted(routes[8])).response.status, 200)
  assert.equal((await trusted(routes[11])).response.status, 200)
  assert.equal((await trusted(routes[13])).response.status, 200)
  assert.equal((await trusted(routes[10])).data.removed, 1)
  assert.equal((await trusted(routes[2])).response.status, 200)
  assert.equal((await admin.request('/api/admin/auth/session')).data.authenticated, false)
  assert.equal((await trusted(routes[1])).response.status, 200)
  const recovery = await trusted(routes[4])
  assert.equal(recovery.response.status, 200)
  assert.equal(recovery.data.deviceId, deviceId)
  assert.equal((await user.request('/health')).response.status, 200)
  // Request/access audit logging may record denials. These assertions cover
  // business/authentication state, not an incorrect promise of zero audit writes.
})

test('T-26 identity GET/HEAD is read-only: valid Cookie required, headers cannot create/bind/renew/clone', async t => {
  for (const demoMode of ['0', '1']) {
    const service = await startBackend({ DEMO_MODE: demoMode, IDENTITY_RATE_LIMIT_MAX: '100' })
    t.after(service.stop)
    const db = service.openDb(); t.after(() => db.close())
    const tables = ['client_identities', 'client_identity_sessions', 'client_identity_install_keys',
      'feedbacks', 'feedback_comments', 'notifications', 'stats', 'admin_logs']
    const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const headers = { 'X-AnonyProof-Install-Key': 'T26-GET-key-'.padEnd(48, 'a'),
      'X-AnonyProof-Recovery-Code': 'A'.repeat(20), 'X-AnonyProof-Device-Id': 'device-legacy-T26' }
    const fresh = new Client(service), initial = snapshot()
    for (const method of ['GET', 'HEAD']) {
      const r = await fresh.request('/api/identity', { method, headers })
      assert.equal(r.response.status, 401)
      assert.deepEqual(r.response.headers.getSetCookie(), [])
      assert.deepEqual(snapshot(), initial)
    }
    for (const origin of [undefined, 'null', 'https://outside.invalid']) {
      const r = await fresh.request('/api/identity', { method: 'POST', headers: origin ? { ...headers, Origin: origin } : headers, omitOrigin: !origin })
      assert.equal(r.response.status, 403)
      assert.deepEqual(r.response.headers.getSetCookie(), [])
      assert.deepEqual(snapshot(), initial)
    }
    const owner = new Client(service), issued = await owner.identity({ headers })
    assert.equal(issued.response.status, 200)
    const validState = snapshot()
    for (const method of ['GET', 'HEAD']) {
      const r = await owner.request('/api/identity', { method,
        headers: { ...headers, 'X-AnonyProof-Install-Key': 'T26-unbound-'.padEnd(48, 'b'), 'X-AnonyProof-Recovery-Code': issued.data.recoveryCode } })
      assert.equal(r.response.status, 200)
      assert.deepEqual(r.response.headers.getSetCookie(), [])
      if (method === 'GET') {
        assert.equal(r.data.deviceId, issued.data.deviceId)
        assert.equal(r.data.created, false)
        assert.equal(r.data.recoveryCode, issued.data.recoveryCode)
      }
      assert.deepEqual(snapshot(), validState)
    }
    const malformed = await new Client(service).request('/api/identity', { headers: { Cookie: 'anonyproof_device_session=%E0%A4%A' } })
    assert.equal(malformed.response.status, 401)
    assert.deepEqual(snapshot(), validState)
    // Fault is confined to this synthetic DB: simulate expiry without months of waiting.
    db.prepare('UPDATE client_identity_sessions SET expires_at=?').run(Date.now() - 1)
    const expiredState = snapshot()
    assert.equal((await owner.request('/api/identity', { headers })).response.status, 401)
    assert.deepEqual(snapshot(), expiredState)
    const resumed = await owner.identity({ headers })
    assert.equal(resumed.response.status, 200)
    assert.equal(resumed.data.deviceId, issued.data.deviceId)
  }
})
