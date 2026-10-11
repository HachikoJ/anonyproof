import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { Client, startBackend } from './helpers'

async function fixture() {
  const key = randomBytes(32).toString('base64')
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: key })
  const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: key } })
  const user = new Client(service), other = new Client(service), admin = new Client(service)
  const identity = (await user.identity()).data, otherIdentity = (await other.identity()).data
  assert.equal((await admin.login()).response.status, 200)
  const id = (await user.post('/api/feedback', { category: 'suggestion', originalContent: 'T39 synthetic parent', encryptedContent: 'T39 marker', deviceId: identity.deviceId })).data.id
  const otherId = (await other.post('/api/feedback', { category: 'report', originalContent: 'T39 other parent', encryptedContent: 'T39 marker', deviceId: otherIdentity.deviceId })).data.id
  const db = service.openDb()
  const insert = db.prepare('INSERT INTO feedback_comments(feedback_id,commenter_type,content,content_storage_version,created_at) VALUES(?,?,?,?,?)')
  db.transaction(() => {
    for (let i = 0; i < 250; i++) {
      const type = i % 2 ? 'admin' : 'user', body = `T39 synthetic ${i} ${'x'.repeat(700)}`
      insert.run(id, type, i % 2 ? encryption.encrypt(body, `feedback_comments:${id}:${type}:content`) : body, i % 2,
        1700000000000 + Math.floor(i / 50))
    }
  })()
  return { service, encryption, db, insert, user, other, admin, id, otherId, identity }
}

test('T-39: 250 tied-time comments paginate newest then older with exact chronology/total and bounded whitelist', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  for (const client of [f.user, f.admin]) {
    let cursor: string | null = null, all: any[] = []
    do {
      const result = await client.request(`/api/feedback/${f.id}/comments?pagination=1&limit=73${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(result.response.status, 200)
      assert.equal(result.data.pagination.total, 250)
      assert.ok(result.data.comments.length <= 73)
      assert.ok(Buffer.byteLength(JSON.stringify(result.data)) < 100000)
      for (const row of result.data.comments) {
        assert.deepEqual(Object.keys(row).sort(), ['commenter_type', 'content', 'created_at', 'feedback_id', 'id'])
        assert.ok(row.content.startsWith('T39 synthetic '))
      }
      all = [...result.data.comments, ...all]
      cursor = result.data.pagination.nextCursor
      assert.equal(result.data.pagination.hasMore, !!cursor)
    } while (cursor)
    assert.equal(all.length, 250)
    assert.equal(new Set(all.map(row => row.id)).size, 250)
    const expected = (f.db.prepare('SELECT id FROM feedback_comments WHERE feedback_id=? ORDER BY created_at ASC,id ASC').all(f.id) as { id: number }[]).map(row => row.id)
    assert.deepEqual(all.map(row => row.id), expected)
    const latest = (await client.request(`/api/feedback/${f.id}/comments?pagination=1`)).data
    assert.equal(latest.comments.length, 50)
    assert.equal(latest.comments.at(-1).id, expected.at(-1))
    const legacy = (await client.request(`/api/feedback/${f.id}/comments`)).data
    assert.equal(legacy.comments.length, 100)
    assert.deepEqual(legacy.comments.map((row: any) => row.id), expected.slice(-100))
    assert.equal(legacy.pagination, undefined)
  }
})

test('T-39: send and incremental newer pages retain loaded old pages, no duplicate and accurate count', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const latest = (await f.user.request(`/api/feedback/${f.id}/comments?pagination=1`)).data
  const older = (await f.user.request(`/api/feedback/${f.id}/comments?pagination=1&cursor=${latest.pagination.nextCursor}`)).data
  const loaded = [...older.comments, ...latest.comments]
  f.db.transaction(() => { for (let i = 0; i < 121; i++) f.insert.run(f.id, 'user', `T39 concurrent ${i}`, 0, 1700000001000 + Math.floor(i / 30)) })()
  const own = await f.user.post(`/api/feedback/${f.id}/comments`, { content: 'T39 own visible message' })
  const reply = await f.admin.post(`/api/admin/feedback/${f.id}/comments`, { content: 'T39 admin visible reply' })
  assert.equal(own.response.status, 200)
  assert.equal(reply.response.status, 200)
  let after: string = latest.pagination.latestCursor, more = true
  const fresh: any[] = []
  while (more) {
    const page = (await f.user.request(`/api/feedback/${f.id}/comments?pagination=1&limit=50&after=${after}`)).data
    assert.equal(page.pagination.total, 373)
    assert.ok(page.comments.length <= 50)
    fresh.push(...page.comments)
    after = page.pagination.latestCursor || after
    more = page.pagination.hasMore
  }
  const merged = Array.from(new Map([...loaded, own.data.comment, ...fresh].map(row => [row.id, row])).values())
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  assert.equal(fresh.length, 123)
  assert.equal(new Set(fresh.map(row => row.id)).size, 123)
  assert.equal(merged.length, 223)
  assert.deepEqual(merged.slice(0, 100).map(row => row.id), loaded.map(row => row.id))
  assert.equal(merged.find(row => row.id === own.data.comment.id).content, 'T39 own visible message')
  assert.equal(merged.find(row => row.id === reply.data.comment.id).content, 'T39 admin visible reply')
  const empty = (await f.other.request(`/api/feedback/${f.otherId}/comments?pagination=1`)).data
  assert.equal(empty.pagination.total, 0)
  assert.equal(empty.pagination.latestCursor, null)
  await f.other.post(`/api/feedback/${f.otherId}/comments`, { content: 'T39 empty thread first message' })
  assert.equal((await f.other.request(`/api/feedback/${f.otherId}/comments?pagination=1`)).data.pagination.total, 1)
})

test('T-39: auth is checked before pagination, cursor binds thread and reader scope; malformed bounds reject', async t => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  for (const client of [new Client(f.service), f.other]) assert.equal((await client.request(`/api/feedback/${f.id}/comments?pagination=1`)).response.status, 401)
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=1e2', 'limit=-1', 'limit=1&limit=2', 'limit[x]=1', 'pagination=0', 'cursor=', 'after=', 'cursor=%25', 'unknown=x', `cursor=${'a'.repeat(1025)}`])
    assert.equal((await f.user.request(`/api/feedback/${f.id}/comments?${query}`)).response.status, 400, query.slice(0, 80))
  const first = (await f.user.request(`/api/feedback/${f.id}/comments?pagination=1&limit=1`)).data
  assert.equal((await f.admin.request(`/api/feedback/${f.id}/comments?pagination=1&cursor=${first.pagination.nextCursor}`)).response.status, 400)
  assert.equal((await f.other.request(`/api/feedback/${f.otherId}/comments?pagination=1&cursor=${first.pagination.nextCursor}`)).response.status, 400)
  assert.equal((await f.user.request(`/api/feedback/${f.id}/comments?cursor=${first.pagination.nextCursor}&after=${first.pagination.latestCursor}`)).response.status, 400)
  const cursor = JSON.parse(Buffer.from(first.pagination.nextCursor, 'base64url').toString())
  for (const change of [{ id: -1 }, { id: 1.2 }, { time: -1 }, { v: 2 }, { extra: true }]) {
    const encoded = Buffer.from(JSON.stringify({ ...cursor, ...change })).toString('base64url')
    assert.equal((await f.user.request(`/api/feedback/${f.id}/comments?cursor=${encoded}`)).response.status, 400)
  }
})

test('T-39: demo read-only template admin access and sandbox comment isolation are preserved', async t => {
  const service = await startBackend({ DEMO_MODE: '1' })
  t.after(service.stop)
  const a = new Client(service), b = new Client(service)
  const ia = (await a.identity()).data, ib = (await b.identity()).data
  const config = (await a.request('/api/demo/config')).data
  const db = service.openDb()
  t.after(() => db.close())
  const template = (db.prepare('SELECT id FROM feedbacks WHERE is_demo_template=1 LIMIT 1').get() as { id: string }).id
  const own = (db.prepare('SELECT id FROM feedbacks WHERE device_id=? AND is_demo_clone=1 LIMIT 1').get(ia.deviceId) as { id: string }).id
  const foreign = (db.prepare('SELECT id FROM feedbacks WHERE device_id=? AND is_demo_clone=1 LIMIT 1').get(ib.deviceId) as { id: string }).id
  assert.equal((await a.request(`/api/feedback/${template}/comments?pagination=1`)).response.status, 404)
  assert.equal((await a.request(`/api/feedback/${own}/comments?pagination=1`)).response.status, 200)
  assert.equal((await b.request(`/api/feedback/${own}/comments?pagination=1`)).response.status, 401)
  assert.equal((await a.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  assert.equal((await a.request(`/api/feedback/${template}/comments?pagination=1`)).response.status, 200)
  assert.equal((await a.request(`/api/feedback/${foreign}/comments?pagination=1`)).response.status, 404)
})
