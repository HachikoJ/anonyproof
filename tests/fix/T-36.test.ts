import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type DatabaseType from 'better-sqlite3'
import { Client, labelSyntheticDatabase, launchBackend, projectRoot, startBackend } from './helpers'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { executeIdempotent } from '../../server/utils/requestIdempotency'
import { initializeBusinessSchema, initializeAdminCursorIndex, initializeCommentCursorIndex,
  initializeDeviceCursorIndex } from '../../server/schema'

const Database = createRequire(path.join(projectRoot, 'server/package.json'))('better-sqlite3') as typeof DatabaseType
const identityTtlMs = 365 * 24 * 60 * 60 * 1000
const businessTables = ['instance_metadata', 'content_encryption_metadata', 'feedbacks', 'feedback_comments',
  'notifications', 'stats', 'admin_logs', 'client_identities', 'client_identity_sessions',
  'client_identity_install_keys', 'request_idempotency']
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'

function logicalSnapshot(db: DatabaseType.Database) {
  const master = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all() as Array<{ type: string; name: string }>
  const tables = master.filter(row => row.type === 'table').map(row => row.name)
  return {
    master,
    pragmas: Object.fromEntries(tables.map(table => [table, {
      columns: db.prepare(`PRAGMA table_info(${quote(table)})`).all(),
      indexes: (db.prepare(`PRAGMA index_list(${quote(table)})`).all() as Array<{ name: string }>).map(index => ({
        ...index, columns: db.prepare(`PRAGMA index_info(${quote(index.name)})`).all(),
      })),
    }])),
    // Access counters/logs change on health requests. Their schema is compared
    // above; only business/identity/key/idempotency rows belong in this snapshot.
    rows: Object.fromEntries(businessTables.filter(table => tables.includes(table))
      .map(table => [table, db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all()])),
  }
}

function legacyFixture(role: 'formal' | 'demo', withInstallColumn = false) {
  const folder = mkdtempSync(path.join(tmpdir(), 'anonyproof-T36-schema-'))
  const databasePath = path.join(folder, 'synthetic-old-schema.db')
  const db = new Database(databasePath), now = Date.now()
  labelSyntheticDatabase(db, role)
  // Explicitly labelled synthetic historical schema, never an unlabelled real DB.
  db.exec(`CREATE TABLE feedbacks (
      id TEXT PRIMARY KEY,category TEXT NOT NULL,encrypted_content TEXT NOT NULL,
      device_id TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT DEFAULT 'pending',
      original_content TEXT NOT NULL DEFAULT '',solution TEXT NOT NULL DEFAULT '');
    CREATE TABLE feedback_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,feedback_id TEXT NOT NULL,commenter_type TEXT NOT NULL,
      content TEXT NOT NULL,created_at INTEGER NOT NULL,admin_ip TEXT,attachment_id TEXT);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,recipient_type TEXT NOT NULL,recipient_id TEXT NOT NULL,
      feedback_id TEXT,type TEXT NOT NULL,title TEXT NOT NULL,content TEXT,is_read INTEGER DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE client_identities (
      device_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL UNIQUE,
      ${withInstallColumn ? 'install_key_hash TEXT,' : ''}
      created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,demo_initialized INTEGER NOT NULL DEFAULT 0);`)
  const deviceId = `device-T36-${role}-legacy`, feedbackId = `T36-${role}-legacy-feedback`
  const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const recoveryHash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const installHash = withInstallColumn ? createHash('sha256').update(randomBytes(32)).digest('hex') : undefined
  db.prepare(`INSERT INTO feedbacks(id,category,encrypted_content,device_id,created_at,status,original_content,solution)
    VALUES(?,?,?,?,?,'pending',?,?)`).run(feedbackId, 'suggestion', 'T36 synthetic legacy client package', deviceId, now,
    'T36 synthetic preserved old body', 'T36 synthetic preserved old solution')
  db.prepare(`INSERT INTO feedback_comments(id,feedback_id,commenter_type,content,created_at)
    VALUES(41,?,'user','T36 synthetic old comment',?)`).run(feedbackId, now)
  db.prepare(`INSERT INTO notifications(id,recipient_type,recipient_id,feedback_id,type,title,content,created_at)
    VALUES(51,'user',?,?,'comment','T36 synthetic old title','T36 synthetic old notice',?)`).run(deviceId, feedbackId, now)
  if (withInstallColumn) db.prepare(`INSERT INTO client_identities
    (device_id,token_hash,recovery_hash,install_key_hash,created_at,last_seen_at,demo_initialized) VALUES(?,?,?,?,?,?,0)`)
    .run(deviceId, tokenHash, recoveryHash, installHash, now, now)
  else db.prepare(`INSERT INTO client_identities
    (device_id,token_hash,recovery_hash,created_at,last_seen_at,demo_initialized) VALUES(?,?,?,?,?,0)`)
    .run(deviceId, tokenHash, recoveryHash, now, now)
  db.close()
  return { role, databasePath, deviceId, feedbackId, tokenHash, installHash, now,
    contentKey: role === 'formal' ? randomBytes(32).toString('base64') : '',
    sessionSecret: randomBytes(32).toString('hex') }
}

function environment(fixture: ReturnType<typeof legacyFixture>) {
  return { DATABASE_PATH: fixture.databasePath, INSTANCE_ROLE: fixture.role,
    DEMO_MODE: fixture.role === 'demo' ? '1' : '0', CONTENT_ENCRYPTION_KEY: fixture.contentKey,
    SESSION_SECRET: fixture.sessionSecret }
}

async function denied(env: Record<string, string>, expected: RegExp) {
  const service = await launchBackend(env)
  try {
    const exit = await Promise.race([service.exited, delay(10000, 'timeout', { ref: false })])
    assert.notEqual(exit, 'timeout', 'failed startup must terminate rather than listen')
    assert.notEqual(exit, 0)
    assert.match(service.output(), expected)
  } finally { await service.stop() }
}

for (const role of ['formal', 'demo'] as const) test(`T-36 ${role}: labelled old schema survives three real starts and repeat initializer without duplicated business/seed/session/idempotency`, async t => {
  const fixture = legacyFixture(role, role === 'demo')
  const encryption = loadContentEncryption({ demoMode: role === 'demo', env: { CONTENT_ENCRYPTION_KEY: fixture.contentKey } })
  let baseline: ReturnType<typeof logicalSnapshot> | undefined
  for (let boot = 0; boot < 3; boot++) {
    const service = await startBackend(environment(fixture))
    t.after(service.stop)
    const db = service.openDb()
    try {
      assert.equal((await fetch(service.baseUrl + '/health')).status, 200)
      assert.equal((await new Client(service).request('/api/demo/config')).data.demoMode, role === 'demo')
      assert.equal((db.prepare('SELECT role FROM instance_metadata').get() as { role: string }).role, role)
      const legacy = db.prepare('SELECT * FROM feedbacks WHERE id=?').get(fixture.feedbackId) as any
      assert.equal(legacy.original_content, 'T36 synthetic preserved old body')
      assert.equal(legacy.solution, 'T36 synthetic preserved old solution')
      assert.equal(legacy.original_content_storage_version, 0)
      assert.equal(legacy.solution_storage_version, 0)
      assert.equal(legacy.is_demo_template, 0); assert.equal(legacy.is_demo_clone, 0)
      assert.equal((db.prepare('SELECT content_storage_version FROM feedback_comments WHERE id=41').get() as any).content_storage_version, 0)
      assert.equal((db.prepare('SELECT content_storage_version FROM notifications WHERE id=51').get() as any).content_storage_version, 0)
      assert.deepEqual(db.prepare('SELECT token_hash,device_id,created_at,last_seen_at,expires_at FROM client_identity_sessions').all(), [{
        token_hash: fixture.tokenHash, device_id: fixture.deviceId, created_at: fixture.now,
        last_seen_at: fixture.now, expires_at: fixture.now + identityTtlMs,
      }])
      const bound = db.prepare('SELECT install_key_hash,device_id FROM client_identity_install_keys').all()
      assert.deepEqual(bound, fixture.installHash ? [{ install_key_hash: fixture.installHash, device_id: fixture.deviceId }] : [])
      const templates = db.prepare('SELECT id FROM feedbacks WHERE is_demo_template=1 ORDER BY id').all()
      if (role === 'formal') assert.deepEqual(templates, [])
      else assert.ok(templates.length > 0, 'demo fixed templates must actually be seeded')
      if (boot === 0) {
        // Keep one real-format, nonexpired metadata row through every restart.
        const key = `v1:${Date.now()}:${randomUUID()}`
        executeIdempotent(db, encryption, `user:${fixture.deviceId}`, 'feedback', key, { fixtureOnly: true }, () => ({
          result: { success: true, id: fixture.feedbackId }, targetType: 'feedback', targetId: fixture.feedbackId,
        }))
        baseline = logicalSnapshot(db)
        // Explicit direct repetition complements the actual process restarts.
        for (let repeat = 0; repeat < 2; repeat++) {
          assert.deepEqual(initializeBusinessSchema(db, encryption, role === 'demo'), { identityCookieTtlMs: identityTtlMs })
          initializeAdminCursorIndex(db); initializeCommentCursorIndex(db); initializeDeviceCursorIndex(db)
          assert.deepEqual(logicalSnapshot(db), baseline)
        }
      } else assert.deepEqual(logicalSnapshot(db), baseline)
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM request_idempotency').get() as { n: number }).n, 1)
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    } finally { db.close(); await service.stop() }
  }
})

test('T-36 missing/wrong content key rejects repeatedly before business migration, then the correct key can start and restart', async t => {
  const fixture = legacyFixture('formal')
  const correct = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: fixture.contentKey } })
  const db = new Database(fixture.databasePath)
  correct.assertDatabaseKey(db)
  const before = logicalSnapshot(db)
  const wrongKey = randomBytes(32).toString('base64')
  const wrong = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: wrongKey } })
  assert.throws(() => initializeBusinessSchema(db, wrong, false), /DATABASE_KEY_MISMATCH/)
  assert.deepEqual(logicalSnapshot(db), before)
  db.close()
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const [key, expected] of [['', /MISSING_KEY/], [wrongKey, /DATABASE_KEY_MISMATCH/]] as const) {
      await denied({ ...environment(fixture), CONTENT_ENCRYPTION_KEY: key }, expected)
      const check = new Database(fixture.databasePath, { readonly: true })
      try { assert.deepEqual(logicalSnapshot(check), before) } finally { check.close() }
    }
  }
  let migrated: ReturnType<typeof logicalSnapshot> | undefined
  for (let boot = 0; boot < 2; boot++) {
    const service = await startBackend(environment(fixture)); t.after(service.stop)
    const check = service.openDb()
    try {
      if (boot === 0) {
        migrated = logicalSnapshot(check)
        assert.notDeepEqual(migrated, before, 'correct key must permit the actual pending schema migration')
        assert.ok((check.prepare('PRAGMA table_info(feedbacks)').all() as Array<{ name: string }>)
          .some(column => column.name === 'original_content_storage_version'))
      } else assert.deepEqual(logicalSnapshot(check), migrated)
    } finally { check.close(); await service.stop() }
  }
})

test('T-36 failed schema initialization is not swallowed; retry still fails until synthetic fault is disabled', async t => {
  const fixture = legacyFixture('formal'), db = new Database(fixture.databasePath)
  db.exec(`CREATE TABLE stats(id INTEGER PRIMARY KEY CHECK(id=1),total_feedbacks INTEGER DEFAULT 0,encrypted_count INTEGER DEFAULT 0);
    CREATE TABLE T36_fixture_gate(enabled INTEGER NOT NULL);
    INSERT INTO T36_fixture_gate VALUES(1);
    CREATE TRIGGER T36_fixture_schema_fault BEFORE INSERT ON stats
      WHEN (SELECT enabled FROM T36_fixture_gate)=1
      BEGIN SELECT RAISE(ABORT,'T36 synthetic schema initialization failure'); END;`)
  db.close()
  for (let attempt = 0; attempt < 2; attempt++) await denied(environment(fixture), /T36 synthetic schema initialization failure/)
  const repair = new Database(fixture.databasePath)
  // Retain the fixture-only gate/trigger; disable the fault without deleting assets.
  repair.prepare('UPDATE T36_fixture_gate SET enabled=0').run()
  repair.close()
  let baseline: ReturnType<typeof logicalSnapshot> | undefined
  for (let boot = 0; boot < 2; boot++) {
    const service = await startBackend(environment(fixture)); t.after(service.stop)
    const check = service.openDb()
    try {
      assert.equal((check.prepare('SELECT COUNT(*) AS n FROM stats').get() as { n: number }).n, 1)
      if (boot === 0) baseline = logicalSnapshot(check)
      else assert.deepEqual(logicalSnapshot(check), baseline)
    } finally { check.close(); await service.stop() }
  }
})


test('T-36 real Express registration trace matches all 43 S0 entries; both auth aliases and parameter routes retain HTTP behavior', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'anonyproof-T36-route-trace-'))
  const tracePath = path.join(folder, 'registration-trace.json')
  const preloadPath = path.join(folder, 'trace-preload.cjs')
  const expressPath = createRequire(path.join(projectRoot, 'server/package.json')).resolve('express')
  // Fixture-only preload records actual Application calls, never headers/body,
  // internal router layers or query/settings getters. No production hook exists.
  writeFileSync(preloadPath, `const fs = require('node:fs');
const application = require(${JSON.stringify(expressPath)}).application;
const trace = []; let depth = 0;
for (const method of ['use','get','post','put','delete']) {
  const original = application[method];
  application[method] = function (...args) {
    const record = depth === 0 && (method === 'use' || args.length > 1);
    depth++;
    try {
      const result = original.apply(this,args);
      if (record) {
        const first = args[0];
        const paths = typeof first === 'string' ? [first]
          : Array.isArray(first) && first.every(p => typeof p === 'string') ? first : null;
        trace.push({ order: trace.length + 1, method: method.toUpperCase(), paths });
        fs.writeFileSync(${JSON.stringify(tracePath)}, JSON.stringify(trace));
      }
      return result;
    } finally { depth--; }
  };
}`, { mode: 0o600 })
  const service = await startBackend({ NODE_OPTIONS: '--require=' + preloadPath })
  t.after(service.stop)
  const baseline = JSON.parse(readFileSync(path.join(projectRoot,
    'audit/execution-results/T-36-route-baseline.json'), 'utf8'))
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'))
  assert.equal(trace.length, 43)
  assert.deepEqual(trace, baseline.registrations)
  for (const prefix of ['/api/admin/auth', '/api/admin']) {
    const client = new Client(service)
    assert.deepEqual((await client.request(prefix + '/session')).data, { authenticated: false })
    const login = await client.post(prefix + '/login', { password: service.password })
    assert.equal(login.response.status, 200); assert.equal(login.data.success, true)
    assert.ok(login.response.headers.getSetCookie().some(cookie =>
      cookie.startsWith('anonyproof_admin_session=') && cookie.includes('HttpOnly') &&
      cookie.includes('SameSite=Strict') && cookie.split('; ').includes('Path=/') &&
      cookie.split('; ').includes('Max-Age=28800') && cookie.split('; ').includes('Secure')))
    for (const sessionPath of ['/api/admin/auth/session', '/api/admin/session'])
      assert.deepEqual((await client.request(sessionPath)).data, { authenticated: true })
    assert.equal((await client.request('/api/admin/access/blacklist/192.0.2.254', { method: 'DELETE' })).response.status, 200)
    assert.deepEqual((await client.request(prefix + '/logout', { method: 'POST' })).data, { success: true })
    for (const sessionPath of ['/api/admin/auth/session', '/api/admin/session'])
      assert.deepEqual((await client.request(sessionPath)).data, { authenticated: false })
    assert.equal((await client.request('/api/admin/feedback/missing-record')).response.status, 401)
  }
  const user = new Client(service), admin = new Client(service)
  const identity = (await user.identity()).data
  const body = 'T36 synthetic route body'
  const created = await user.post('/api/feedback', { deviceId: identity.deviceId,
    category: 'suggestion', originalContent: body, encryptedContent: 'T36 synthetic discarded envelope' })
  assert.equal(created.response.status, 200)
  const id = created.data.id
  const detail = await user.request('/api/feedback/' + id)
  assert.equal(detail.response.status, 200); assert.equal(detail.data.feedback.id, id)
  assert.equal(detail.data.feedback.original_content, body)
  const deviceList = await user.request('/api/feedback/device/' + encodeURIComponent(identity.deviceId))
  assert.equal(deviceList.response.status, 200); assert.equal(deviceList.data.feedbacks[0].id, id)
  const comment = await user.post('/api/feedback/' + id + '/comments', { content: 'T36 synthetic route comment' })
  assert.equal(comment.response.status, 200)
  const comments = await user.request('/api/feedback/' + id + '/comments')
  assert.equal(comments.response.status, 200); assert.equal(comments.data.comments[0].id, comment.data.comment.id)
  assert.equal((await new Client(service).request('/api/feedback/' + id)).response.status, 401)
  assert.equal((await user.request('/api/feedback/missing-record')).response.status, 404)
  assert.equal((await user.request('/api/feedback/%ZZ')).response.status, 400)
  assert.equal((await admin.login()).response.status, 200)
  assert.equal((await admin.request('/api/admin/feedback/' + id)).data.feedback.id, id)
  assert.equal((await admin.post('/api/admin/feedback/' + id + '/status',
    { status: 'in_progress', solution: '' }, 'PUT')).response.status, 200)
  const notifications = await user.request('/api/notifications?recipientType=user&recipientId=' + encodeURIComponent(identity.deviceId))
  assert.equal(notifications.response.status, 200); assert.ok(notifications.data.notifications.length > 0)
  const noticeId = notifications.data.notifications[0].id
  assert.equal((await user.request('/api/notifications/' + noticeId + '/read', { method: 'PUT' })).data.updated, 1)
  assert.equal((await user.request('/api/notifications/' + noticeId + '/unread', { method: 'PUT' })).data.updated, 1)
  // Parameterized admin route retains its original path, authorization and result.
  assert.equal((await admin.request('/api/admin/feedback/' + id, { method: 'DELETE' })).response.status, 200)
  assert.equal((await user.request('/api/feedback/' + id)).response.status, 404)
})
