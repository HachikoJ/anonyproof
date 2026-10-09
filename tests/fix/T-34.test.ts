import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { Client, startBackend } from './helpers'

// Trigger faults are confined to fresh synthetic fixture databases. The
// production service gains no fault header, environment toggle or debug route.
const tables = ['feedbacks', 'feedback_comments', 'notifications', 'admin_logs', 'stats']
function snapshot(db: Database.Database) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
}
function count(db: Database.Database, table: string, id: string) {
  return (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${table === 'feedbacks' ? 'id' : 'feedback_id'} = ?`).get(id) as { n: number }).n
}
async function fixture(demo = false) {
  const service = await startBackend(demo ? { DEMO_MODE: '1' } : {})
  const owner = new Client(service), other = new Client(service), admin = new Client(service)
  const a = (await owner.identity()).data, b = (await other.identity()).data
  const config = demo ? (await owner.request('/api/demo/config')).data : undefined
  if (demo) {
    assert.equal((await owner.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
    assert.equal((await other.post('/api/admin/login', { password: config.adminPassword })).response.status, 200)
  } else assert.equal((await admin.login()).response.status, 200)
  const db = service.openDb()
  const submit = async (client: Client, deviceId: string) => {
    const result = await client.post('/api/feedback', demo
      ? { demoExampleId: config.examples[0].id, deviceId }
      : { category: 'report', originalContent: 'T34 private synthetic report', encryptedContent: 'synthetic-only', deviceId })
    assert.equal(result.response.status, 200)
    return result.data.id as string
  }
  const target = await submit(owner, a.deviceId), retained = await submit(other, b.deviceId)
  const operator = demo ? owner : admin
  assert.equal((await owner.post(`/api/feedback/${target}/comments`, demo
    ? { demoCommentId: 'supplement' } : { content: 'T34 private synthetic user comment' })).response.status, 200)
  assert.equal((await operator.post(`/api/admin/feedback/${target}/comments`, demo
    ? { demoCommentId: 'reply' } : { content: 'T34 private synthetic admin comment' })).response.status, 200)
  // Historical orphan disposition is a separate approval gate. This unrelated
  // synthetic orphan must survive route deletion, not become hidden cleanup.
  db.prepare('INSERT INTO feedback_comments(feedback_id,commenter_type,content,created_at) VALUES(?,?,?,?)')
    .run('T34-existing-orphan', 'user', 'T34 unrelated synthetic orphan', Date.now())
  db.prepare('INSERT INTO notifications(recipient_type,recipient_id,feedback_id,type,title,content,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('admin', 'admin', 'T34-existing-orphan', 'comment', 'T34 orphan title', 'T34 unrelated orphan notification', Date.now())
  return { service, owner, other, admin, operator, a, b, config, db, target, retained }
}

test('T-34: formal delete removes both notification recipients and all comments atomically with minimal audit', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  assert.ok(count(f.db, 'feedback_comments', f.target) >= 2)
  for (const recipient of ['user', 'admin']) {
    assert.ok((f.db.prepare('SELECT COUNT(*) n FROM notifications WHERE feedback_id=? AND recipient_type=?')
      .get(f.target, recipient) as { n: number }).n > 0)
  }
  const before = snapshot(f.db)
  assert.equal((await f.operator.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 200)
  for (const table of ['feedbacks', 'feedback_comments', 'notifications']) assert.equal(count(f.db, table, f.target), 0)
  for (const table of ['feedbacks', 'feedback_comments', 'notifications']) {
    const rows = (state: ReturnType<typeof snapshot>) => (state[table] as Record<string, unknown>[])
      .filter(row => (table === 'feedbacks' ? row.id : row.feedback_id) !== f.target)
    assert.deepEqual(rows(snapshot(f.db)), rows(before))
  }
  const logs = f.db.prepare("SELECT * FROM admin_logs WHERE action='delete' AND target_id=?").all(f.target) as Record<string, unknown>[]
  assert.equal(logs.length, 1)
  assert.deepEqual(Object.keys(logs[0]).sort(), ['action', 'admin_ip', 'created_at', 'id', 'target_id'])
  assert.equal(logs[0].admin_ip, '')
  assert.equal(logs[0].action, 'delete')
  assert.equal(logs[0].target_id, f.target)
  assert.equal(typeof logs[0].created_at, 'number')
  assert.ok(!JSON.stringify(logs).includes('private synthetic'))
  assert.deepEqual(f.db.prepare('SELECT total_feedbacks, encrypted_count FROM stats').get(), { total_feedbacks: 1, encrypted_count: 1 })
  assert.deepEqual(f.db.pragma('foreign_key_check'), [])
  assert.equal((await f.operator.request(`/api/admin/feedback/${f.target}`)).response.status, 404)
  for (const client of [f.owner, f.operator]) assert.equal((await client.request(`/api/feedback/${f.target}/comments`)).response.status, 404)
  assert.ok(!(await f.owner.request(`/api/feedback/device/${f.a.deviceId}`)).data.feedbacks.some((row: any) => row.id === f.target))
  for (const [client, recipientType, recipientId] of [[f.owner, 'user', f.a.deviceId], [f.operator, 'admin', 'admin']] as const) {
    const result = await client.request(`/api/notifications?recipientType=${recipientType}&recipientId=${recipientId}&limit=100`)
    assert.equal(result.response.status, 200)
    assert.ok(!result.data.notifications.some((row: any) => row.feedback_id === f.target))
  }
  const afterReads = snapshot(f.db)
  assert.equal((await f.operator.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 404)
  assert.deepEqual(snapshot(f.db), afterReads)
})

test('T-34: audit/child/parent/statistics failures roll back every affected business row', async (t) => {
  for (const [event, table, when] of [
    ['INSERT', 'admin_logs', "WHEN NEW.action='delete'"],
    ['DELETE', 'feedback_comments', ''],
    ['DELETE', 'notifications', "WHEN OLD.recipient_type='admin'"],
    ['DELETE', 'notifications', "WHEN OLD.recipient_type='user'"],
    ['DELETE', 'feedbacks', ''], ['UPDATE', 'stats', ''],
  ]) {
    await t.test(`${table} ${event} ${when || 'all rows'}`, async (caseTest) => {
      const f = await fixture()
      caseTest.after(async () => { f.db.close(); await f.service.stop() })
      const before = snapshot(f.db)
      f.db.exec(`CREATE TRIGGER fix_t34_fault BEFORE ${event} ON ${table} ${when}
        BEGIN SELECT RAISE(ABORT, 'T34_FIXTURE_ONLY'); END`)
      try {
        const result = await f.operator.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })
        assert.equal(result.response.status, 500)
        assert.deepEqual(result.data, { error: '删除失败' })
        assert.deepEqual(snapshot(f.db), before)
        assert.deepEqual(f.db.pragma('foreign_key_check'), [])
        assert.equal((await f.owner.request('/health')).response.status, 200)
      } finally { f.db.exec('DROP TRIGGER fix_t34_fault') }
      assert.equal((await f.operator.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 200)
    })
  }
})

test('T-34: unauthenticated and user-cookie requests cannot delete formal feedback', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const before = snapshot(f.db)
  for (const client of [new Client(f.service), f.owner, f.other]) {
    assert.equal((await client.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 401)
    assert.deepEqual(snapshot(f.db), before)
  }
})

test('T-34: demo administrator can delete only own sandbox and preserves shared templates and other identities', async (t) => {
  const f = await fixture(true)
  t.after(async () => { f.db.close(); await f.service.stop() })
  const before = snapshot(f.db)
  for (const [client, id] of [[f.other, f.target], [f.owner, f.retained], [f.owner, f.config.examples[0].id]] as const) {
    assert.equal((await client.request(`/api/admin/feedback/${id}`, { method: 'DELETE' })).response.status, 404)
    assert.deepEqual(snapshot(f.db), before)
  }
  assert.equal((await f.owner.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 200)
  for (const table of ['feedbacks', 'feedback_comments', 'notifications']) {
    assert.equal(count(f.db, table, f.target), 0)
    const retainedRows = (state: ReturnType<typeof snapshot>) => (state[table] as Record<string, unknown>[])
      .filter(row => (table === 'feedbacks' ? row.id : row.feedback_id) !== f.target)
    assert.deepEqual(retainedRows(snapshot(f.db)), retainedRows(before))
  }
  assert.equal((await f.owner.request(`/api/admin/feedback/${f.target}`, { method: 'DELETE' })).response.status, 404)
  assert.deepEqual(f.db.pragma('foreign_key_check'), [])
})
