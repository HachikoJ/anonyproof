import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, startBackend } from './helpers'

const sentinel = 'PRIVATE_REAL_SENTINEL_T01'
const denied = (status: number) => assert.ok([401, 403, 404].includes(status), `Expected denial, got ${status}`)

test('T-01: public demo isolates two identities, immutable templates and all legacy/private paths', async (t) => {
  const service = await startBackend({ DEMO_MODE: '1' })
  t.after(service.stop)
  const a = new Client(service), b = new Client(service), freshAdmin = new Client(service)
  const identityA = (await a.identity()).data, identityB = (await b.identity()).data
  const config = (await a.request('/api/demo/config')).data
  assert.equal(config.demoMode, true)
  const db = service.openDb()
  t.after(() => db.close())
  const insert = db.prepare(`INSERT INTO feedbacks
    (id,category,encrypted_content,device_id,created_at,status,original_content,is_demo_template,is_demo_clone)
    VALUES (?, 'report', ?, ?, ?, 'pending', ?, ?, ?)`)
  insert.run('legacy-real', sentinel, identityA.deviceId, Date.now(), sentinel, 0, 0)
  insert.run('demo-feedback-suggestion-pending', sentinel, 'demo-device-anonyproof-2026', Date.now(), sentinel, 1, 0)
  insert.run('legacy-owned-clone', 'demo-encrypted:demo-feedback-suggestion-pending', identityA.deviceId, Date.now(), sentinel, 0, 1)
  const notice = db.prepare(`INSERT INTO notifications
    (recipient_type,recipient_id,feedback_id,type,title,content,is_read,created_at)
    VALUES (?, ?, ?, 'comment', ?, ?, 0, ?)`)
  for (const id of ['legacy-real', 'legacy-owned-clone', 'demo-feedback-suggestion-pending']) {
    db.prepare('INSERT INTO feedback_comments (feedback_id,commenter_type,content,created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'user', sentinel, Date.now())
    notice.run('admin', 'admin', id, sentinel, sentinel, Date.now())
    if (id !== 'demo-feedback-suggestion-pending') notice.run('user', identityA.deviceId, id, sentinel, sentinel, Date.now())
  }
  db.prepare('INSERT INTO admin_logs (action,target_id,admin_ip,created_at) VALUES (?, ?, ?, ?)')
    .run(sentinel, sentinel, '198.51.100.231', Date.now())
  const hash = (db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id = ?').get(identityA.deviceId) as any).recovery_hash
  assert.equal((await a.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  assert.equal((await b.post('/api/admin/auth/login', { password: config.adminPassword })).response.status, 200)
  assert.equal((db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id = ?').get(identityA.deviceId) as any).recovery_hash, hash)
  const firstLogin = await freshAdmin.post('/api/admin/auth/login', { password: config.adminPassword })
  assert.equal(firstLogin.response.status, 200)
  assert.ok(firstLogin.data.deviceId)
  assert.ok(firstLogin.data.recoveryCode)
  const cookies = firstLogin.response.headers.getSetCookie()
  assert.ok(cookies.some(cookie => cookie.startsWith('anonyproof_device_session=')))
  assert.ok(cookies.some(cookie => cookie.startsWith('anonyproof_admin_session=')))
  const adminOnly = cookies.find(cookie => cookie.startsWith('anonyproof_admin_session='))!.split(';')[0]
  const identitiesBefore = (db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as any).n
  const withoutIdentity = await fetch(service.baseUrl + '/api/admin/feedbacks', { headers: { Cookie: adminOnly } })
  assert.equal(withoutIdentity.status, 200)
  assert.ok((await withoutIdentity.json()).feedbacks.every((row: any) => row.is_demo_template === 1))
  assert.equal(withoutIdentity.headers.getSetCookie().length, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM client_identities').get() as any).n, identitiesBefore)
  const recordsA = (await a.request(`/api/feedback/device/${identityA.deviceId}`)).data.feedbacks
  const recordsB = (await b.request(`/api/feedback/device/${identityB.deviceId}`)).data.feedbacks
  const own = recordsA[0].id, other = recordsB[0].id, template = config.examples[0].id
  const list = (await a.request('/api/admin/feedbacks')).data.feedbacks
  assert.ok(list.some((row: any) => row.id === own))
  assert.ok(list.some((row: any) => row.id === template))
  assert.ok(list.filter((row: any) => row.is_demo_template).every((row: any) => row.unread_notifications === 0))
  assert.ok(!list.some((row: any) => row.id === other))
  assert.ok(!JSON.stringify(list).includes(sentinel))
  assert.ok(!JSON.stringify(recordsA).includes(sentinel))
  for (const id of [other, 'legacy-real', 'legacy-owned-clone', 'demo-feedback-suggestion-pending']) {
    denied((await a.request(`/api/admin/feedback/${id}`)).response.status)
    denied((await a.request(`/api/feedback/${id}/comments`)).response.status)
    denied((await a.post(`/api/admin/feedback/${id}/comments`, { demoCommentId: 'reply' })).response.status)
    denied((await a.post(`/api/admin/feedback/${id}/status`, { status: 'resolved', demoSolutionId: 'resolved' }, 'PUT')).response.status)
    denied((await a.request(`/api/admin/feedback/${id}`, { method: 'DELETE' })).response.status)
  }
  denied((await a.request(`/api/feedback/device/${identityB.deviceId}`)).response.status)
  denied((await a.request(`/api/notifications?recipientType=user&recipientId=${identityB.deviceId}`)).response.status)
  assert.equal((await a.request(`/api/admin/feedback/${template}`)).response.status, 200)
  assert.equal((await a.request(`/api/feedback/${template}/comments`)).response.status, 200)
  denied((await a.post(`/api/admin/feedback/${template}/comments`, { demoCommentId: 'reply' })).response.status)
  denied((await a.post(`/api/feedback/${template}/comments`, { demoCommentId: 'supplement' })).response.status)
  denied((await a.post(`/api/admin/feedback/${template}/status`, { status: 'resolved', demoSolutionId: 'resolved' }, 'PUT')).response.status)
  denied((await a.request(`/api/admin/feedback/${template}`, { method: 'DELETE' })).response.status)
  for (const url of ['/api/admin/logs', '/api/admin/access/stats', '/api/admin/access/logs', '/api/admin/access/suspicious', '/api/admin/access/blacklist']) {
    assert.equal((await a.request(url)).response.status, 403)
  }
  assert.equal((await a.request('/api/admin/access/blacklist/198.51.100.231', { method: 'DELETE' })).response.status, 403)
  assert.equal((await a.request('/api/stats')).data.total, config.examples.length)
  for (const type of ['user', 'admin']) {
    const recipient = type === 'user' ? identityA.deviceId : 'admin'
    const notifications = (await a.request(`/api/notifications?recipientType=${type}&recipientId=${recipient}&limit=100`)).data.notifications
    assert.ok(!JSON.stringify(notifications).includes(sentinel))
    if (type === 'admin') assert.ok(notifications.every((row: any) => list.some((feedback: any) => feedback.id === row.feedback_id && !feedback.is_demo_template)))
  }
  const templateNotice = db.prepare("SELECT id,is_read FROM notifications WHERE feedback_id = ? AND recipient_type = 'admin' LIMIT 1").get(template) as any
  for (const action of ['read', 'unread']) denied((await a.request(`/api/notifications/${templateNotice.id}/${action}`, { method: 'PUT' })).response.status)
  denied((await a.request(`/api/notifications/read-all?recipientType=admin&recipientId=admin&feedbackId=${template}`, { method: 'PUT' })).response.status)
  assert.equal((db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(templateNotice.id) as any).is_read, templateNotice.is_read)
  const privateNotice = db.prepare("SELECT id FROM notifications WHERE feedback_id = 'legacy-real' AND recipient_type = 'admin'").get() as any
  denied((await a.request(`/api/notifications/${privateNotice.id}/read`, { method: 'PUT' })).response.status)
  const invalid = await a.post('/api/feedback', { category: 'report', originalContent: sentinel, encryptedContent: sentinel, deviceId: identityA.deviceId })
  assert.equal(invalid.response.status, 400)
  const submitted = await a.post('/api/feedback', { demoExampleId: template, deviceId: identityA.deviceId, originalContent: sentinel, encryptedContent: { secret: sentinel } })
  assert.equal(submitted.response.status, 200)
  const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(submitted.data.id) as any
  assert.equal(row.is_demo_clone, 1)
  assert.equal(row.original_content, config.examples[0].content)
  assert.equal(row.encrypted_content, `demo-encrypted:${template}`)
  assert.equal((await a.post(`/api/feedback/${submitted.data.id}/comments`, { content: sentinel })).response.status, 400)
  assert.equal((await a.post(`/api/feedback/${submitted.data.id}/comments`, { demoCommentId: 'supplement', content: sentinel })).response.status, 200)
  assert.equal((await a.post(`/api/admin/feedback/${submitted.data.id}/comments`, { demoCommentId: 'reply', content: sentinel })).response.status, 200)
  assert.equal((await a.post(`/api/admin/feedback/${submitted.data.id}/status`, { status: 'resolved', demoSolutionId: 'resolved', solution: sentinel }, 'PUT')).response.status, 200)
  const processed = (await a.request(`/api/admin/feedback/${submitted.data.id}`)).data.feedback
  assert.equal(processed.solution, config.solutions.find((item: any) => item.id === 'resolved').content)
  assert.ok(!JSON.stringify((await a.request(`/api/feedback/${submitted.data.id}/comments`)).data).includes(sentinel))
  denied((await b.request(`/api/admin/feedback/${submitted.data.id}`)).response.status)
  assert.equal((await a.request(`/api/admin/feedback/${submitted.data.id}`, { method: 'DELETE' })).response.status, 200)
  assert.equal((db.prepare("SELECT original_content FROM feedbacks WHERE id='legacy-real'").get() as any).original_content, sentinel)
})

test('T-01: existing cookie login after restart preserves recovery hash and upgrades only safe sandbox copies', async (t) => {
  const first = await startBackend({ DEMO_MODE: '1' })
  t.after(first.stop)
  const user = new Client(first)
  const identity = (await user.identity()).data
  const db = first.openDb()
  // Simulate an already-initialized v1 identity, retaining all its old assets.
  db.prepare("UPDATE feedbacks SET encrypted_content='demo-encrypted:demo-feedback-old' WHERE device_id=? AND is_demo_clone=1").run(identity.deviceId)
  const originalCount = (db.prepare('SELECT COUNT(*) AS n FROM feedbacks WHERE device_id=?').get(identity.deviceId) as any).n
  const hash = (db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id=?').get(identity.deviceId) as any).recovery_hash
  await first.stop()
  const second = await startBackend({ DEMO_MODE: '1', DATABASE_PATH: first.databasePath })
  t.after(second.stop)
  user.service = second
  const config = (await user.request('/api/demo/config')).data
  assert.equal((await user.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  assert.equal((db.prepare('SELECT recovery_hash FROM client_identities WHERE device_id=?').get(identity.deviceId) as any).recovery_hash, hash)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedbacks WHERE device_id=?').get(identity.deviceId) as any).n, originalCount + config.examples.length)
  assert.equal((await user.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks.length, config.examples.length)
  const formal = await startBackend()
  t.after(formal.stop)
  user.service = formal
  assert.equal((await user.request('/api/admin/feedbacks')).response.status, 401)
  assert.equal((await user.post('/api/admin/login', { password: config.adminPassword })).response.status, 401)
  db.close()
})
