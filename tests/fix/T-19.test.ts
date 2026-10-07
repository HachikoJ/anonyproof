import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, launchBackend, startBackend } from './helpers'

test('T-19: isolated production backend and existing authorized flow run', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const other = new Client(service)
  const admin = new Client(service)
  const identity = await user.identity()
  assert.equal(identity.response.status, 200)
  assert.ok(identity.data.recoveryCode)
  const submitted = await user.post('/api/feedback', {
    category: 'report', originalContent: 'fixture report', encryptedContent: 'fixture-cipher', deviceId: identity.data.deviceId,
  })
  assert.equal(submitted.response.status, 200)
  const id = submitted.data.id
  const records = await user.request(`/api/feedback/device/${identity.data.deviceId}`)
  assert.equal(records.data.feedbacks[0].id, id)
  await other.identity()
  assert.equal((await other.request(`/api/feedback/device/${identity.data.deviceId}`)).response.status, 401)
  assert.equal((await user.post(`/api/feedback/${id}/comments`, { content: 'fixture supplement' })).response.status, 200)
  assert.equal((await admin.login()).response.status, 200)
  assert.equal((await admin.request('/api/admin/feedbacks')).data.feedbacks.length, 1)
  assert.equal((await admin.post(`/api/admin/feedback/${id}/status`, { status: 'resolved', solution: 'fixture resolution complete' }, 'PUT')).response.status, 200)
  assert.equal((await admin.post(`/api/admin/feedback/${id}/comments`, { content: 'fixture response' })).response.status, 200)
  const notices = await user.request(`/api/notifications?recipientType=user&recipientId=${identity.data.deviceId}`)
  assert.equal(notices.response.status, 200)
  assert.equal(notices.data.notifications.length, 2)
  assert.equal((await user.request(`/api/feedback/${id}/comments`)).data.comments.length, 2)
  assert.equal((await admin.request('/api/admin/access/stats')).response.status, 200)
})

for (const [label, overrides, expected] of [
  ['missing secret', { SESSION_SECRET: '' }, /SESSION_SECRET/],
  ['short secret', { SESSION_SECRET: 'short' }, /SESSION_SECRET/],
  ['missing password', { ADMIN_PASSWORD: '' }, /ADMIN_PASSWORD/],
  ['short password', { ADMIN_PASSWORD: 'short' }, /ADMIN_PASSWORD/],
] as const) {
  test(`T-19: production rejects ${label}`, async (t) => {
    const service = await launchBackend(overrides)
    t.after(service.stop)
    const result = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(result, 'timeout')
    assert.notEqual(result, 0)
    assert.match(service.output(), expected)
  })
}
