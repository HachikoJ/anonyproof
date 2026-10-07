import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Client, projectRoot, startBackend } from './helpers'

for (const directory of ['', 'server']) {
  test(`T-16: ${directory || 'root'} HTTP parser dependencies reject known malformed shapes`, () => {
    const requirePackage = createRequire(path.join(projectRoot, directory, 'package.json'))
    const qs = requirePackage('qs')
    const bodyParser = requirePackage('body-parser')
    const routing = requirePackage('path-to-regexp')
    assert.equal(requirePackage('qs/package.json').version, '6.16.0')
    assert.equal(requirePackage('body-parser/package.json').version, '2.3.0')
    // GHSA-4mjr-xmp4-gh2g: bounded parse/stringify regression, without crashing a worker.
    assert.doesNotThrow(() => qs.stringify(qs.parse('x[constructor][isBuffer]=y', { plainObjects: true })))
    assert.deepEqual(qs.parse('item=a&item=b'), { item: ['a', 'b'] })
    assert.deepEqual(qs.parse('item[]=a&item[]=b'), { item: ['a', 'b'] })
    // GHSA-v422-hmwv-36x6: invalid configured limits must never disable enforcement.
    assert.throws(() => bodyParser.json({ limit: 'invalid-limit' }))
    // GHSA-j3q9-mxjg-w52f: compilation rejects excessive optional route combinations.
    assert.throws(() => routing.pathToRegexp('/{a}{b}{c}{d}{e}{f}{g}{h}{i}:z'))
    assert.equal(routing.match('/api/feedback/:id')('/api/feedback/fixture').params.id, 'fixture')
  })
}

test('T-16: actual backend routes and bounded HTTP parser failures preserve availability', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const other = new Client(service)
  const admin = new Client(service)
  const identity = await user.identity()
  await other.identity()
  const submitted = await user.post('/api/feedback', {
    category: 'report', originalContent: 'HTTP regression fixture', encryptedContent: 'fixture-cipher', deviceId: identity.data.deviceId,
  })
  assert.equal(submitted.response.status, 200)
  assert.equal((await other.request(`/api/feedback/device/${identity.data.deviceId}`)).response.status, 401)
  assert.equal((await user.request(`/api/feedback/device/${identity.data.deviceId}`)).response.status, 200)
  assert.equal((await admin.login()).response.status, 200)
  assert.equal((await admin.request('/api/admin/auth/session')).data.authenticated, true)
  assert.equal((await admin.request('/api/admin/session')).data.authenticated, true)
  for (const query of ['limit=1&limit=2', 'limit[]=1&limit[]=2']) {
    assert.equal((await admin.request(`/api/admin/access/logs?${query}`)).response.status, 200)
  }
  assert.equal((await admin.post('/api/admin/auth/logout', {})).response.status, 200)
  assert.equal((await admin.post('/api/admin/login', { password: service.password })).response.status, 200)
  assert.equal((await admin.post('/api/admin/logout', {})).response.status, 200)
  for (const [body, status] of [
    ['{"category":', 400],
    [JSON.stringify({ content: 'x'.repeat(1024 * 1024) }), 413],
  ] as const) {
    const rejected = await user.request('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    assert.equal(rejected.response.status, status)
    assert.equal((await user.request('/health')).response.status, 200)
  }
  const db = service.openDb()
  try {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedbacks').get() as { n: number }).n, 1)
  } finally { db.close() }
})
