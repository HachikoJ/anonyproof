import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend } from './helpers'
import { MAX_ENCRYPTED_CONTENT_BYTES } from '../../server/utils/validation'

test('T-12: feedback input matrix rejects before business writes', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const { data: identity } = await user.identity()
  const valid = { category: 'report', deviceId: identity.deviceId, originalContent: '文', encryptedContent: 'cipher' }
  const db = service.openDb()
  t.after(() => db.close())
  const snapshot = () => ({
    feedbacks: db.prepare('SELECT COUNT(*) n FROM feedbacks').get(),
    notifications: db.prepare('SELECT COUNT(*) n FROM notifications').get(),
    comments: db.prepare('SELECT COUNT(*) n FROM feedback_comments').get(),
    stats: db.prepare('SELECT * FROM stats').get(),
  })
  for (const originalContent of [null, [], {}, 7, true, '', '  \n', '文'.repeat(10001), '文' + ' '.repeat(10000)]) {
    const before = snapshot()
    const result = await user.post('/api/feedback', { ...valid, originalContent })
    assert.equal(result.response.status, 400)
    assert.deepEqual(snapshot(), before)
  }
  for (const body of [null, [], {}, { ...valid, category: 'other' }, { ...valid, category: ['report'] },
    { ...valid, deviceId: {} }, { ...valid, encryptedContent: {} }, { ...valid, encryptedContent: '  ' }]) {
    const before = snapshot()
    assert.equal((await user.post('/api/feedback', body)).response.status, 400)
    assert.deepEqual(snapshot(), before)
  }
  for (const encryptedContent of ['a'.repeat(MAX_ENCRYPTED_CONTENT_BYTES + 1), '文'.repeat(Math.floor(MAX_ENCRYPTED_CONTENT_BYTES / 3) + 1)]) {
    const before = snapshot()
    assert.equal((await user.post('/api/feedback', { ...valid, encryptedContent })).response.status, 413)
    assert.deepEqual(snapshot(), before)
  }
  const other = new Client(service)
  const { data: otherIdentity } = await other.identity()
  const before = snapshot()
  assert.equal((await user.post('/api/feedback', { ...valid, deviceId: otherIdentity.deviceId })).response.status, 403)
  assert.deepEqual(snapshot(), before)

  assert.equal((await user.post('/api/feedback', valid)).response.status, 200)
  assert.equal((await user.post('/api/feedback', { ...valid, originalContent: '文'.repeat(10000), encryptedContent: 'a'.repeat(MAX_ENCRYPTED_CONTENT_BYTES) })).response.status, 200)
  // Worst-case JSON escaping of a legal 10000-character body remains accepted.
  const escaped = JSON.stringify({ ...valid, originalContent: '文'.repeat(10000) }).replaceAll('文', '\\u6587')
  assert.equal((await user.request('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: escaped })).response.status, 200)
  for (const [body, status] of [['{"originalContent":', 400], [JSON.stringify({ ...valid, extra: 'a'.repeat(400000) }), 413]] as const) {
    const before = snapshot()
    const result = await user.request('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    assert.equal(result.response.status, status)
    assert.equal(typeof result.data.error, 'string')
    assert.equal(Object.hasOwn(result.data, 'stack'), false)
    assert.deepEqual(snapshot(), before)
  }
  assert.equal((db.prepare('SELECT COUNT(*) n FROM feedbacks').get() as { n: number }).n, 3)
})
