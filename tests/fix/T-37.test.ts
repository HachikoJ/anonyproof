import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { Client, startBackend } from './helpers'

async function fixture() {
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: key })
  const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: key } })
  const admin = new Client(service), user = new Client(service)
  assert.equal((await admin.login()).response.status, 200)
  const identity = (await user.identity()).data
  const db = service.openDb()
  const bodies = new Map<string, string>()
  const insert = db.prepare(`INSERT INTO feedbacks(id,category,device_id,created_at,status,original_content,
    original_content_storage_version,encrypted_content,solution,solution_storage_version)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
  db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const id = `T37-${String(i).padStart(4, '0')}`
      const body = `${i === 7 ? 'NEEDLE-cross-page' : 'ordinary'} ${'🧪'.repeat(200)} synthetic ${i}`
      bodies.set(id, body)
      const version = i % 2
      insert.run(id, ['suggestion', 'complaint', 'report'][i % 3], identity.deviceId,
        1700000000000 + Math.floor(i / 100), ['pending', 'in_progress', 'resolved', 'no_solution'][i % 4],
        version ? encryption.encrypt(body, `feedbacks:${id}:original_content`) : body, version,
        'T37-unused-legacy-cipher', encryption.encrypt('T37 private solution', `feedbacks:${id}:solution`), 1)
    }
  })()
  return { service, admin, user, identity, db, bodies }
}

test('T-37: 1000 records paginate without duplicate/gap under tied timestamps and bounded whitelist', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const first = await f.admin.request('/api/admin/feedbacks?pagination=1')
  assert.equal(first.response.status, 200)
  assert.equal(first.data.feedbacks.length, 50)
  assert.equal(first.data.pagination.total, 1000)
  assert.deepEqual(first.data.counts, { total: 1000, pending: 250, processing: 250, resolved: 250, noSolution: 250 })
  const actual: string[] = []
  let cursor: string | null = null
  do {
    const page = await f.admin.request('/api/admin/feedbacks?pagination=1&limit=100' + (cursor ? `&cursor=${cursor}` : ''))
    assert.equal(page.response.status, 200)
    assert.ok(page.data.feedbacks.length <= 100)
    assert.ok(Buffer.byteLength(JSON.stringify(page.data)) < 180000)
    for (const row of page.data.feedbacks) {
      assert.deepEqual(Object.keys(row).sort(), ['category', 'content_truncated', 'created_at', 'device_id', 'id', 'is_demo_clone', 'is_demo_template', 'original_content', 'status', 'unread_notifications'])
      assert.equal(Array.from(row.original_content).length, 160)
      assert.equal(row.content_truncated, true)
      assert.equal(row.original_content, Array.from(f.bodies.get(row.id)!).slice(0, 160).join(''))
      actual.push(row.id)
    }
    cursor = page.data.pagination.nextCursor
    assert.equal(page.data.pagination.hasMore, cursor !== null)
  } while (cursor)
  const expected = (f.db.prepare('SELECT id FROM feedbacks ORDER BY created_at DESC,id DESC').all() as { id: string }[]).map(row => row.id)
  assert.deepEqual(actual, expected)
  assert.equal(new Set(actual).size, 1000)
  const detail = await f.admin.request('/api/admin/feedback/T37-0007')
  assert.equal(detail.data.feedback.original_content, f.bodies.get('T37-0007'))
  assert.equal(detail.data.feedback.solution, 'T37 private solution')
})

test('T-37: search and filters span all records with truthful filtered totals and global overview', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const result = await f.admin.request('/api/admin/feedbacks?pagination=1&search=NEEDLE-cross-page&category=complaint&status=no_solution')
  assert.equal(result.response.status, 200)
  assert.equal(result.data.pagination.total, 1)
  assert.deepEqual(result.data.feedbacks.map((row: any) => row.id), ['T37-0007'])
  assert.equal(result.data.counts.total, 1000)
  assert.equal((await f.admin.request(`/api/admin/feedbacks?pagination=1&search=${f.identity.deviceId}`)).data.pagination.total, 1000)
  const filtered = await f.admin.request('/api/admin/feedbacks?pagination=1&category=report&status=resolved&limit=100')
  const n = (f.db.prepare("SELECT COUNT(*) n FROM feedbacks WHERE category='report' AND status='resolved'").get() as { n: number }).n
  assert.equal(filtered.data.pagination.total, n)
  assert.ok(filtered.data.feedbacks.every((row: any) => row.category === 'report' && row.status === 'resolved'))
  assert.equal((await f.admin.request('/api/admin/feedbacks?pagination=1&search=no-match-T37')).data.pagination.total, 0)
})

test('T-37: malformed bounds/cursors/filter changes reject and never bypass administrator scope', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  for (const query of ['limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=1e2', 'limit=9007199254740993',
    'limit=1&limit=2', 'limit[x]=1', 'category=unknown', 'status=unknown', 'pagination=0', 'cursor=', 'cursor=%25',
    `cursor=${'a'.repeat(1025)}`, 'unexpected=value', `search=${'x'.repeat(10001)}`]) {
    assert.equal((await f.admin.request(`/api/admin/feedbacks?${query}`)).response.status, 400, query.slice(0, 80))
  }
  const first = (await f.admin.request('/api/admin/feedbacks?pagination=1&limit=1')).data
  assert.equal((await f.admin.request(`/api/admin/feedbacks?pagination=1&cursor=${first.pagination.nextCursor}&category=report`)).response.status, 400)
  const cursor = JSON.parse(Buffer.from(first.pagination.nextCursor, 'base64url').toString())
  for (const change of [{ time: -1 }, { time: 1.1 }, { id: '../escape' }, { v: 2 }, { extra: true }]) {
    const encoded = Buffer.from(JSON.stringify({ ...cursor, ...change })).toString('base64url')
    assert.equal((await f.admin.request(`/api/admin/feedbacks?pagination=1&cursor=${encoded}`)).response.status, 400)
  }
  for (const client of [new Client(f.service), f.user]) assert.equal((await client.request('/api/admin/feedbacks?pagination=1')).response.status, 401)
})

test('T-37: demo pagination scopes totals/search to own sandbox plus immutable templates', async (t) => {
  const service = await startBackend({ DEMO_MODE: '1' })
  t.after(service.stop)
  const a = new Client(service), b = new Client(service)
  const ia = (await a.identity()).data, ib = (await b.identity()).data
  const config = (await a.request('/api/demo/config')).data
  assert.equal((await a.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  assert.equal((await b.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  const result = await a.request('/api/admin/feedbacks?pagination=1&limit=100')
  assert.equal(result.data.counts.total, config.examples.length * 2)
  assert.ok(result.data.feedbacks.every((row: any) => row.is_demo_template || row.device_id === ia.deviceId))
  assert.equal((await a.request(`/api/admin/feedbacks?pagination=1&search=${ib.deviceId}`)).data.pagination.total, 0)
  assert.ok(result.data.feedbacks.filter((row: any) => row.is_demo_template).every((row: any) => row.unread_notifications === 0))
  const cursor = (await a.request('/api/admin/feedbacks?pagination=1&limit=1')).data.pagination.nextCursor
  assert.ok(cursor)
  assert.equal((await b.request(`/api/admin/feedbacks?pagination=1&limit=1&cursor=${cursor}`)).response.status, 400)
})

test('T-37 cutover: parameter-free legacy fields remain available but capped at 100', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const legacy = await f.admin.request('/api/admin/feedbacks')
  assert.equal(legacy.data.feedbacks.length, 100)
  assert.equal(legacy.data.feedbacks[0].id, 'T37-0999')
  assert.equal(legacy.data.feedbacks[0].original_content, f.bodies.get('T37-0999'))
  assert.equal(legacy.data.pagination, undefined)
})


test('T-37: off-page notification resolves full detail and processing updates overview/filtered results', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const id = 'T37-0007'
  f.db.prepare(`INSERT INTO notifications(recipient_type,recipient_id,feedback_id,type,title,content,created_at,is_read)
    VALUES('admin','admin',?,'new_comment','T37 notification','T37 synthetic notification',?,0)`).run(id, Date.now())
  const page = (await f.admin.request('/api/admin/feedbacks?pagination=1')).data
  assert.ok(!page.feedbacks.some((row: any) => row.id === id))
  const notifications = (await f.admin.request('/api/notifications?recipientType=admin&recipientId=admin&limit=30')).data
  assert.ok(notifications.notifications.some((row: any) => row.feedback_id === id))
  const detail = (await f.admin.request('/api/admin/feedback/' + id)).data.feedback
  assert.equal(detail.original_content, f.bodies.get(id))
  assert.equal((await f.admin.post('/api/admin/feedback/' + id + '/status', {
    status: 'resolved', solution: 'T37 verified processing explanation'
  }, 'PUT')).response.status, 200)
  assert.equal((await f.admin.request('/api/admin/feedback/' + id)).data.feedback.status, 'resolved')
  const filtered = (await f.admin.request('/api/admin/feedbacks?pagination=1&search=NEEDLE-cross-page&status=resolved')).data
  assert.equal(filtered.pagination.total, 1)
  assert.equal(filtered.feedbacks[0].id, id)
  assert.equal(filtered.counts.resolved, 251)
  assert.equal(filtered.counts.noSolution, 249)
  assert.equal((await f.admin.request('/api/notifications/read-all?recipientType=admin&recipientId=admin&feedbackId=' + id,
    { method: 'PUT' })).response.status, 200)
  assert.equal((f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE feedback_id=? AND recipient_type='admin' AND is_read=0")
    .get(id) as { n: number }).n, 0)
})
