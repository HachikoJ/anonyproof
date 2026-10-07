import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend } from './helpers'

test('T-40: notification limit stays bounded for users and admins without weakening access', async (t) => {
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const other = new Client(service)
  const admin = new Client(service)
  const anonymous = new Client(service)
  const { data: identity } = await user.identity()
  const { data: otherIdentity } = await other.identity()
  assert.equal((await admin.login()).response.status, 200)
  const db = service.openDb()
  t.after(() => db.close())
  const timestamp = Date.now()
  const insertFeedback = db.prepare(`INSERT INTO feedbacks
    (id, category, encrypted_content, device_id, created_at, original_content)
    VALUES (?, 'report', 'fixture-cipher', ?, ?, 'synthetic notification fixture')`)
  insertFeedback.run('T40-own-feedback', identity.deviceId, timestamp)
  insertFeedback.run('T40-other-feedback', otherIdentity.deviceId, timestamp)
  const insertNotification = db.prepare(`INSERT INTO notifications
    (recipient_type, recipient_id, feedback_id, type, title, content, created_at)
    VALUES (?, ?, ?, 'comment', 'synthetic fixture', 'synthetic fixture', ?)`)
  const userIds: number[] = []
  const adminIds: number[] = []
  db.transaction(() => {
    for (let index = 0; index < 150; index++) {
      userIds.push(Number(insertNotification.run('user', identity.deviceId, 'T40-own-feedback', timestamp + index).lastInsertRowid))
      adminIds.push(Number(insertNotification.run('admin', 'admin', 'T40-own-feedback', timestamp + index).lastInsertRowid))
    }
    // A notification must not make another identity's feedback visible.
    insertNotification.run('user', identity.deviceId, 'T40-other-feedback', timestamp + 1000)
  })()
  const userUrl = `/api/notifications?recipientType=user&recipientId=${identity.deviceId}`
  const adminUrl = '/api/notifications?recipientType=admin&recipientId=admin'
  const invalidSuffixes = [
    ...['-1', '0', '101', '1.5', '1.0', 'abc', 'NaN', 'Infinity', '-Infinity',
      '', ' ', '\t', '\n', '+1', '1e2', '0x10', '[]', '{}', '9007199254740993',
      '10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000']
      .map((value) => `&limit=${encodeURIComponent(value)}`),
    '&limit=1&limit=2', '&limit=20&limit=20',
    '&limit%5B%5D=1', '&limit%5B0%5D=1', '&limit%5Bvalue%5D=1', '&limit=1&limit%5B%5D=1',
  ]
  for (const [client, url, expectedIds] of [[user, userUrl, userIds], [admin, adminUrl, adminIds]] as const) {
    for (const [suffix, count] of [['', 20], ['&limit=1', 1], ['&limit=20', 20],
      ['&limit=30', 30], ['&limit=99', 99], ['&limit=100', 100]] as const) {
      const { response, data } = await client.request(url + suffix)
      assert.equal(response.status, 200, url + suffix)
      assert.equal(data.notifications.length, count, url + suffix)
      assert.deepEqual(data.notifications.map((notification: { id: number }) => notification.id), [...expectedIds].reverse().slice(0, count))
    }
    for (const suffix of invalidSuffixes) {
      const { response, data } = await client.request(url + suffix)
      assert.equal(response.status, 400, url + suffix)
      assert.equal(typeof data.error, 'string')
    }
    const unread = await client.request(url.replace('/notifications?', '/notifications/unread-count?'))
    assert.equal(unread.response.status, 200)
    assert.equal(unread.data.count, 150)
  }
  assert.equal((await anonymous.request(userUrl + '&limit=100')).response.status, 401)
  assert.equal((await anonymous.request(adminUrl + '&limit=100')).response.status, 401)
  assert.equal((await user.request(adminUrl + '&limit=100')).response.status, 401)
  assert.equal((await other.request(userUrl + '&limit=100')).response.status, 403)
  assert.equal((await admin.request('/api/notifications?recipientType=admin&recipientId=someone-else&limit=100')).response.status, 401)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications').get() as { n: number }).n, 301)
  assert.equal((await anonymous.request('/health')).response.status, 200)
  assert.equal(service.output().includes('获取通知列表失败'), false)
})
