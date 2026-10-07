import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useCrypto } from '../../app/hooks/useCrypto'
import { Client } from './helpers'
import { cipherFaultFixture } from './T-04.fixture'

test('T-04: actual submit hook returns only the compatibility marker with no browser WebCrypto', async () => {
  let hook: ReturnType<typeof useCrypto> | undefined
  const Harness = () => { hook = useCrypto(); return null }
  renderToString(React.createElement(Harness))
  assert.ok(hook)
  // SSR has no window/crypto.subtle. The actual exported hook succeeds because
  // at-rest encryption is performed by the server, not a client fallback.
  const marker = await hook.encrypt('T04 synthetic browser plaintext')
  assert.equal(marker, 'server-encrypted:v1')
  assert.equal(marker.includes('T04'), false)
  assert.notEqual(marker, Buffer.from('T04 synthetic browser plaintext').toString('base64'))
})

test('T-04: real cipher failures roll back feedback/comment/status and later required notifications', async (t) => {
  const f = await cipherFaultFixture()
  t.after(f.service.stop)
  const user = new Client(f.service)
  const admin = new Client(f.service)
  const identity = (await user.identity()).data
  await admin.login()
  const db = f.service.openDb()
  t.after(() => db.close())
  const snapshot = () => Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'admin_logs', 'stats']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
  const submit = () => user.post('/api/feedback', { category: 'report', deviceId: identity.deviceId,
    originalContent: 'T04 synthetic body', encryptedContent: 'server-encrypted:v1' })
  for (const fault of ['*', '收到一条举报线索', 'T04 synthetic body']) {
    const before = snapshot(); f.fault(fault)
    const result = await submit()
    assert.equal(result.response.status, 500)
    assert.deepEqual(snapshot(), before)
    assert.deepEqual(Object.keys(result.data), ['error'])
    f.fault('')
  }
  const created = await submit()
  assert.equal(created.response.status, 200)
  for (const [client, url, body, faults, method] of [
    [user, `/api/feedback/${created.data.id}/comments`, { content: 'T04 synthetic supplement' }, ['*', '提交人补充了说明'], 'POST'],
    [admin, `/api/admin/feedback/${created.data.id}/comments`, { content: 'T04 synthetic reply' }, ['*', '处理人员回复了您的提交'], 'POST'],
    [admin, `/api/admin/feedback/${created.data.id}/status`, { status: 'resolved', solution: 'T04 synthetic resolution' }, ['*', '提交记录状态已更新', '当前状态为'], 'PUT'],
  ] as const) {
    for (const fault of faults) {
      const before = snapshot(); f.fault(fault)
      assert.equal((await client.post(url, body, method)).response.status, 500)
      assert.deepEqual(snapshot(), before)
      f.fault('')
    }
    assert.equal((await client.post(url, body, method)).response.status, 200)
  }
  const record = (await user.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks[0]
  assert.equal(record.original_content, 'T04 synthetic body')
  assert.equal(record.solution, 'T04 synthetic resolution')
  assert.equal((db.prepare('SELECT original_content_storage_version v FROM feedbacks').get() as { v: number }).v, 1)
  // Legacy Base64 request data is accepted only for old-client compatibility;
  // it is discarded, and cannot claim or produce unencrypted safe storage.
  const encoded = Buffer.from('T04 legacy Base64 body').toString('base64')
  assert.equal((await user.post('/api/feedback', { category: 'report', deviceId: identity.deviceId,
    originalContent: 'T04 legacy Base64 body', encryptedContent: encoded })).response.status, 200)
  const stored = db.prepare('SELECT encrypted_content,original_content,original_content_storage_version FROM feedbacks ORDER BY created_at DESC LIMIT 1').get() as any
  assert.equal(stored.encrypted_content, 'server-encrypted:v1')
  assert.equal(stored.original_content_storage_version, 1)
  assert.match(stored.original_content, /^apc:/)
  assert.notEqual(stored.original_content, encoded)
  assert.equal(f.service.output().includes('T04_FIXTURE_ENCRYPTION_FAILURE'), true)
  assert.equal(readFileSync(f.control, 'utf8'), '')
})
