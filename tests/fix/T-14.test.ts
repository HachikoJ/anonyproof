import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend } from './helpers'

test('T-14: approved solution length/type boundary rejects before status/log/notification writes', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const { data: identity } = await user.identity()
  await admin.login()
  const { data: feedback } = await user.post('/api/feedback', {
    category: 'report', originalContent: 'solution fixture', encryptedContent: 'cipher', deviceId: identity.deviceId,
  })
  const db = service.openDb()
  t.after(() => db.close())
  const snapshot = () => ({
    feedback: db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedback.id),
    logs: db.prepare('SELECT COUNT(*) n FROM admin_logs').get(),
    notifications: db.prepare('SELECT COUNT(*) n FROM notifications').get(),
  })
  const route = `/api/admin/feedback/${feedback.id}/status`
  for (const status of ['in_progress', 'resolved', 'no_solution']) {
    for (const solution of [null, {}, [], 10, true, '文'.repeat(10001), '文' + ' '.repeat(10000)]) {
      const before = snapshot()
      const result = await admin.post(route, { status, solution }, 'PUT')
      assert.equal(result.response.status, 400)
      assert.deepEqual(snapshot(), before)
    }
    if (status !== 'in_progress') {
      for (const solution of [undefined, '', ' ', '文'.repeat(9)]) {
        const before = snapshot()
        assert.equal((await admin.post(route, { status, solution }, 'PUT')).response.status, 400)
        assert.deepEqual(snapshot(), before)
      }
    }
  }
  for (const status of [null, {}, ['resolved'], 'pending', 'reviewed']) {
    const before = snapshot()
    assert.equal((await admin.post(route, { status, solution: '文'.repeat(10) }, 'PUT')).response.status, 400)
    assert.deepEqual(snapshot(), before)
  }
  assert.equal((await admin.post(route, { status: 'in_progress' }, 'PUT')).response.status, 200)
  assert.equal((await admin.post(route, { status: 'resolved', solution: '文'.repeat(10) }, 'PUT')).response.status, 200)
  assert.equal((await admin.post(route, { status: 'no_solution', solution: '文'.repeat(10000) }, 'PUT')).response.status, 200)
  const stored = db.prepare('SELECT status, solution FROM feedbacks WHERE id = ?').get(feedback.id) as { status: string; solution: string }
  assert.equal(stored.status, 'no_solution')
  assert.equal(stored.solution, '文'.repeat(10000))
  assert.equal((await user.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks[0].solution, stored.solution)
})
