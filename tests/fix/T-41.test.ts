import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Client, startBackend } from './helpers'

// All faults are SQLite triggers in this test's fresh temporary database. No
// production header, public debug endpoint, environment secret or real DB.
function snapshot(db: Database.Database) {
  return Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'admin_logs', 'stats']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
}

function inject(db: Database.Database, event: string, table: string, when = '') {
  db.exec(`CREATE TRIGGER fix_t41_fault BEFORE ${event} ON ${table} ${when}
    BEGIN SELECT RAISE(ABORT, 'T41_FIXTURE_ONLY'); END`)
  return () => db.exec('DROP TRIGGER fix_t41_fault')
}

async function fixture() {
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const user = new Client(service)
  const admin = new Client(service)
  const identity = await user.identity()
  assert.equal(identity.response.status, 200)
  assert.equal((await admin.login()).response.status, 200)
  const db = service.openDb()
  const submit = () => user.post('/api/feedback', {
    category: 'report', originalContent: 'T41 synthetic report', encryptedContent: 'fixture-cipher', deviceId: identity.data.deviceId,
  })
  return { service, user, admin, identity: identity.data, db, submit }
}

test('T-41: feedback statistics and required notification faults roll back the entire business write', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  for (const [event, table, when] of [
    ['INSERT', 'feedbacks', ''], ['UPDATE', 'stats', ''],
    ['INSERT', 'notifications', "WHEN NEW.type = 'new_feedback'"],
  ]) {
    await t.test(`${table} ${event} failure`, async () => {
      const before = snapshot(f.db)
      const release = inject(f.db, event, table, when)
      try {
        const result = await f.submit()
        assert.equal(result.response.status, 500)
        assert.deepEqual(snapshot(f.db), before)
      } finally { release() }
    })
  }
  const submitted = await f.submit()
  assert.equal(submitted.response.status, 200)
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM feedbacks').get() as { n: number }).n, 1)
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM notifications').get() as { n: number }).n, 1)
  assert.deepEqual(f.db.prepare('SELECT total_feedbacks, encrypted_count FROM stats').get(), { total_feedbacks: 1, encrypted_count: 1 })
})

test('T-41: user and admin comment notification faults cannot persist orphaned comments', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const feedback = await f.submit()
  assert.equal(feedback.response.status, 200)
  for (const [label, client, prefix, recipient] of [
    ['user', f.user, '/api/feedback', 'admin'], ['admin', f.admin, '/api/admin/feedback', 'user'],
  ] as const) {
    for (const [event, table, when] of [
      ['INSERT', 'feedback_comments', ''],
      ['INSERT', 'notifications', `WHEN NEW.type = 'comment' AND NEW.recipient_type = '${recipient}'`],
    ]) {
      await t.test(`${label}: ${table} ${event} failure`, async () => {
        const before = snapshot(f.db)
        const release = inject(f.db, event, table, when)
        try {
          const result = await client.post(`${prefix}/${feedback.data.id}/comments`, { content: `T41 synthetic ${label} comment` })
          assert.equal(result.response.status, 500)
          assert.deepEqual(snapshot(f.db), before)
        } finally { release() }
      })
    }
    const before = snapshot(f.db)
    const result = await client.post(`${prefix}/${feedback.data.id}/comments`, { content: `T41 successful ${label} comment` })
    assert.equal(result.response.status, 200)
    assert.equal((snapshot(f.db).feedback_comments as unknown[]).length, (before.feedback_comments as unknown[]).length + 1)
    assert.equal((snapshot(f.db).notifications as unknown[]).length, (before.notifications as unknown[]).length + 1)
  }
})

test('T-41: status audit/update/notification failures preserve all fields and related records', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const feedback = await f.submit()
  assert.equal(feedback.response.status, 200)
  const update = () => f.admin.post(`/api/admin/feedback/${feedback.data.id}/status`, {
    status: 'resolved', solution: 'T41 resolution with sufficient length',
  }, 'PUT')
  for (const [event, table, when] of [
    ['INSERT', 'admin_logs', "WHEN NEW.action = 'update_status'"],
    ['UPDATE', 'feedbacks', ''],
    ['INSERT', 'notifications', "WHEN NEW.type = 'status_update'"],
  ]) {
    await t.test(`${table} ${event} failure`, async () => {
      const before = snapshot(f.db)
      const release = inject(f.db, event, table, when)
      try {
        assert.equal((await update()).response.status, 500)
        assert.deepEqual(snapshot(f.db), before)
      } finally { release() }
    })
  }
  const before = snapshot(f.db)
  assert.equal((await update()).response.status, 200)
  const after = snapshot(f.db)
  assert.equal((after.admin_logs as unknown[]).length, (before.admin_logs as unknown[]).length + 1)
  assert.equal((after.notifications as unknown[]).length, (before.notifications as unknown[]).length + 1)
  assert.equal((after.feedbacks as { status: string }[])[0].status, 'resolved')
  assert.equal((await update()).response.status, 200)
  assert.equal((snapshot(f.db).notifications as unknown[]).length, (after.notifications as unknown[]).length)
  assert.equal((await f.user.request(`/api/feedback/device/${f.identity.deviceId}`)).data.feedbacks[0].solution, 'T41 resolution with sufficient length')
})

test('T-41: optional access logging faults leave core feedback/comment/status operations successful', async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const release = inject(f.db, 'INSERT', 'access_logs')
  try {
    const feedback = await f.submit()
    assert.equal(feedback.response.status, 200)
    assert.equal((await f.user.post(`/api/feedback/${feedback.data.id}/comments`, { content: 'T41 telemetry-independent comment' })).response.status, 200)
    assert.equal((await f.admin.post(`/api/admin/feedback/${feedback.data.id}/status`, {
      status: 'resolved', solution: 'T41 telemetry-independent resolution',
    }, 'PUT')).response.status, 200)
    const state = snapshot(f.db)
    assert.equal((state.feedbacks as unknown[]).length, 1)
    assert.equal((state.feedback_comments as unknown[]).length, 1)
    assert.equal((state.notifications as unknown[]).length, 3)
    assert.equal((state.admin_logs as unknown[]).length, 1)
    assert.deepEqual(f.db.prepare('SELECT total_feedbacks, encrypted_count FROM stats').get(), { total_feedbacks: 1, encrypted_count: 1 })
    assert.equal((await f.user.request('/health')).response.status, 200)
  } finally { release() }
})

// Deletion's transaction and dependent comment/notification erasure belong to
// T-34. Its confirmation/implementation is not complete, so do not count this
// as a passing deletion acceptance or accidentally test today's broken policy.
test('T-41 delete rollback matrix: every related row survives log/delete/stats/dependent-row faults', {
  skip: 'T-34 deletion semantics/transaction confirmation and implementation are pending',
}, async (t) => {
  const f = await fixture()
  t.after(async () => { f.db.close(); await f.service.stop() })
  const feedback = await f.submit()
  assert.equal(feedback.response.status, 200)
  assert.equal((await f.user.post(`/api/feedback/${feedback.data.id}/comments`, { content: 'T41 retained child comment' })).response.status, 200)
  for (const [event, table, when] of [
    ['INSERT', 'admin_logs', "WHEN NEW.action = 'delete'"],
    ['DELETE', 'feedback_comments', ''], ['DELETE', 'notifications', ''],
    ['DELETE', 'feedbacks', ''], ['UPDATE', 'stats', ''],
  ]) {
    await t.test(`${table} ${event} failure`, async () => {
      const before = snapshot(f.db)
      const release = inject(f.db, event, table, when)
      try {
        assert.equal((await f.admin.request(`/api/admin/feedback/${feedback.data.id}`, { method: 'DELETE' })).response.status, 500)
        assert.deepEqual(snapshot(f.db), before)
      } finally { release() }
    })
  }
})
