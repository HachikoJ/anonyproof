import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { Client, startBackend } from './helpers'

async function fixture() {
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: key })
  const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: key } })
  const a = new Client(service), b = new Client(service)
  const ia = (await a.identity()).data, ib = (await b.identity()).data
  const db = service.openDb(), bodies = new Map<string, string>()
  const insert = db.prepare(`INSERT INTO feedbacks(id,category,device_id,created_at,status,original_content,
    original_content_storage_version,encrypted_content,solution,solution_storage_version)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
  db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const id = `T38-${String(i).padStart(4, '0')}`
      const body = `${'🧪'.repeat(200)} ${i === 7 ? 'NEEDLE-cross-page' : 'ordinary'} synthetic ${i}`
      bodies.set(id, body)
      const version = i % 2
      insert.run(id, ['suggestion', 'complaint', 'report'][i % 3], i < 500 ? ia.deviceId : ib.deviceId,
        1700000000000 + Math.floor(i / 100), ['pending', 'in_progress', 'resolved', 'no_solution'][i % 4],
        version ? encryption.encrypt(body, `feedbacks:${id}:original_content`) : body, version,
        'T38-unused-legacy-cipher', encryption.encrypt('T38 private solution', `feedbacks:${id}:solution`), 1)
    }
    db.prepare(`INSERT INTO notifications(recipient_type,recipient_id,feedback_id,type,title,content,created_at)
      VALUES('user',?,'T38-0007','status_update','T38 old record notification','synthetic notification',?)`)
      .run(ia.deviceId, Date.now())
  })()
  const list = (device: string, query = '') => `/api/feedback/device/${device}${query}`
  return { service, a, b, ia, ib, db, bodies, list }
}

test('T-38: 1000 records / two identities, stable tied-time cursor and 160-codepoint bounded summary', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const first = await f.a.request(f.list(f.ia.deviceId, '?pagination=1'))
  assert.equal(first.response.status, 200)
  assert.equal(first.data.feedbacks.length, 50)
  assert.equal(first.data.pagination.total, 500)
  assert.deepEqual(first.data.counts, { total: 500, pending: 125, in_progress: 125, resolved: 125, no_solution: 125 })
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page = await f.a.request(f.list(f.ia.deviceId, '?pagination=1&limit=100' + (cursor ? `&cursor=${cursor}` : '')))
    assert.equal(page.response.status, 200)
    assert.ok(page.data.feedbacks.length <= 100)
    assert.ok(Buffer.byteLength(JSON.stringify(page.data)) < 100000)
    for (const row of page.data.feedbacks) {
      assert.deepEqual(Object.keys(row).sort(), ['category', 'content_truncated', 'created_at', 'id', 'original_content', 'status', 'unread_notifications'])
      assert.equal(Array.from(row.original_content).length, 160)
      assert.equal(row.content_truncated, true)
      assert.equal(row.original_content, Array.from(f.bodies.get(row.id)!).slice(0, 160).join(''))
      ids.push(row.id)
    }
    cursor = page.data.pagination.nextCursor
    assert.equal(page.data.pagination.hasMore, !!cursor)
  } while (cursor)
  const expected = (f.db.prepare('SELECT id FROM feedbacks WHERE device_id=? ORDER BY created_at DESC,id DESC')
    .all(f.ia.deviceId) as { id: string }[]).map(row => row.id)
  assert.deepEqual(ids, expected)
  assert.equal(new Set(ids).size, 500)
  const other = await f.b.request(f.list(f.ib.deviceId, '?pagination=1&limit=100'))
  assert.equal(other.data.pagination.total, 500)
  assert.ok(other.data.feedbacks.every((row: any) => !ids.includes(row.id)))
  const legacy = await f.a.request(f.list(f.ia.deviceId))
  assert.equal(legacy.data.feedbacks.length, 100)
  assert.equal(legacy.data.pagination, undefined)
  assert.equal(legacy.data.feedbacks[0].original_content, f.bodies.get(legacy.data.feedbacks[0].id))
})

test('T-38: encrypted full-content search beyond summaries/pages, global counts and independent full detail', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const result = await f.a.request(f.list(f.ia.deviceId, '?pagination=1&search=NEEDLE-cross-page&category=complaint&status=no_solution'))
  assert.equal(result.data.pagination.total, 1)
  assert.equal(result.data.counts.total, 500)
  assert.deepEqual(result.data.feedbacks.map((row: any) => row.id), ['T38-0007'])
  assert.ok(!result.data.feedbacks[0].original_content.includes('NEEDLE'))
  const allMatches: string[] = []
  let cursor: string | null = null
  do {
    const page = await f.a.request(f.list(f.ia.deviceId, '?pagination=1&search=ordinary&limit=73' + (cursor ? `&cursor=${cursor}` : '')))
    assert.equal(page.data.pagination.total, 499)
    allMatches.push(...page.data.feedbacks.map((row: any) => row.id))
    cursor = page.data.pagination.nextCursor
  } while (cursor)
  assert.equal(new Set(allMatches).size, 499)
  assert.equal(allMatches.length, 499)
  assert.equal((await f.b.request(f.list(f.ib.deviceId, '?pagination=1&search=NEEDLE-cross-page'))).data.pagination.total, 0)
  const notices = await f.a.request(`/api/notifications?recipientType=user&recipientId=${f.ia.deviceId}`)
  assert.equal(notices.data.notifications[0].feedback_id, 'T38-0007')
  const detail = await f.a.request('/api/feedback/T38-0007')
  assert.equal(detail.response.status, 200)
  assert.equal(detail.data.feedback.original_content, f.bodies.get('T38-0007'))
  assert.equal(detail.data.feedback.solution, 'T38 private solution')
  assert.equal(detail.data.feedback.unread_notifications, 1)
  const filtered = await f.a.request(f.list(f.ia.deviceId, '?pagination=1&category=report&status=resolved'))
  const n = (f.db.prepare("SELECT COUNT(*) n FROM feedbacks WHERE device_id=? AND category='report' AND status='resolved'")
    .get(f.ia.deviceId) as { n: number }).n
  assert.equal(filtered.data.pagination.total, n)
})

test('T-38: malformed parameters/cursor identity/filter binding cannot bypass authorization', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  for (const client of [new Client(f.service), f.b]) {
    assert.equal((await client.request(f.list(f.ia.deviceId, '?pagination=1'))).response.status, 401)
    assert.equal((await client.request('/api/feedback/T38-0007')).response.status, 401)
  }
  for (const query of ['limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=1e2', 'limit=1&limit=2',
    'limit[x]=1', 'category=unknown', 'status=unknown', 'pagination=0', 'cursor=', 'cursor=%25',
    `cursor=${'a'.repeat(1025)}`, 'unexpected=value', `search=${'x'.repeat(10001)}`]) {
    assert.equal((await f.a.request(f.list(f.ia.deviceId, `?${query}`))).response.status, 400, query.slice(0, 80))
  }
  const first = (await f.a.request(f.list(f.ia.deviceId, '?pagination=1&limit=1'))).data
  assert.equal((await f.a.request(f.list(f.ia.deviceId, `?pagination=1&cursor=${first.pagination.nextCursor}&category=report`))).response.status, 400)
  assert.equal((await f.b.request(f.list(f.ib.deviceId, `?pagination=1&cursor=${first.pagination.nextCursor}`))).response.status, 400)
  const cursor = JSON.parse(Buffer.from(first.pagination.nextCursor, 'base64url').toString())
  for (const change of [{ time: -1 }, { id: '../escape' }, { v: 2 }, { extra: true }]) {
    const encoded = Buffer.from(JSON.stringify({ ...cursor, ...change })).toString('base64url')
    assert.equal((await f.a.request(f.list(f.ia.deviceId, `?pagination=1&cursor=${encoded}`))).response.status, 400)
  }
})

test('T-38: recovery R1 replaces list ownership, and demo list excludes templates/other sandboxes/legacy rows', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const recovered = new Client(f.service)
  const initial = (await recovered.identity()).data
  assert.equal((await recovered.request(f.list(initial.deviceId, '?pagination=1'))).data.pagination.total, 0)
  assert.equal((await recovered.post('/api/identity/recover', { recoveryCode: f.ia.recoveryCode })).response.status, 200)
  assert.equal((await recovered.request(f.list(f.ia.deviceId, '?pagination=1'))).data.pagination.total, 500)
  assert.equal((await recovered.request(f.list(initial.deviceId, '?pagination=1'))).response.status, 401)
  assert.equal((await recovered.request(f.list(f.ib.deviceId, '?pagination=1'))).response.status, 401)
  const demo = await startBackend({ DEMO_MODE: '1' })
  t.after(demo.stop)
  const a = new Client(demo), b = new Client(demo)
  const ia = (await a.identity()).data, ib = (await b.identity()).data
  const config = (await a.request('/api/demo/config')).data
  const db = demo.openDb()
  t.after(() => db.close())
  db.prepare(`INSERT INTO feedbacks(id,category,device_id,created_at,status,original_content,encrypted_content)
    VALUES('T38-hidden-legacy','report',?,?,'pending','must not leak','legacy')`).run(ia.deviceId, Date.now())
  const result = await a.request(f.list(ia.deviceId, '?pagination=1&limit=100'))
  assert.equal(result.data.pagination.total, config.examples.length)
  assert.ok(!result.data.feedbacks.some((row: any) => row.id === 'T38-hidden-legacy'))
  assert.equal((await a.request(f.list(ib.deviceId, '?pagination=1'))).response.status, 401)
  assert.equal((await a.request(f.list(ia.deviceId, '?pagination=1&search=must%20not%20leak'))).data.pagination.total, 0)
  assert.equal((await a.request('/api/feedback/T38-hidden-legacy')).response.status, 404)
  const template = db.prepare('SELECT id FROM feedbacks WHERE is_demo_template=1 LIMIT 1').get() as { id: string }
  assert.equal((await a.request(`/api/feedback/${template.id}`)).response.status, 404)
})
