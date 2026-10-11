import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend } from './helpers'

test('T-13: both comment routes validate types and preserve bounded UTF-8 text', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const other = new Client(service)
  const { data: identity } = await user.identity()
  await other.identity()
  await admin.login()
  const { data: feedback } = await user.post('/api/feedback', {
    category: 'report', originalContent: 'comment fixture', encryptedContent: 'cipher', deviceId: identity.deviceId,
  })
  const db = service.openDb()
  t.after(() => db.close())
  const counts = () => [db.prepare('SELECT COUNT(*) n FROM feedback_comments').get(), db.prepare('SELECT COUNT(*) n FROM notifications').get()]
  for (const [client, route] of [[user, '/api/feedback'], [admin, '/api/admin/feedback']] as const) {
    for (const content of [undefined, null, {}, [], 1, true, ' ', '文', '文'.repeat(1001)]) {
      const before = counts()
      assert.equal((await client.post(`${route}/${feedback.id}/comments`, { content })).response.status, 400)
      assert.deepEqual(counts(), before)
    }
    for (const content of ['文字', '文'.repeat(1000)]) {
      const result = await client.post(`${route}/${feedback.id}/comments`, { content })
      assert.equal(result.response.status, 200)
      assert.equal(result.data.comment.content, content)
    }
  }
  const before = counts()
  assert.equal((await other.post(`/api/feedback/${feedback.id}/comments`, { content: 'unauthorized comment' })).response.status, 401)
  assert.deepEqual(counts(), before)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM feedback_comments').get() as { n: number }).n, 4)
})
