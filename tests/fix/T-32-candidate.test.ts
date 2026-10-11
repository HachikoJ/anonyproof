// Preparation acceptance on new synthetic sources only. Real mapping, role
// adoption, activation and old DB/backup disposal remain pending decisions.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { prepareContentMigrationCandidate, ContentMigrationPreparationError } from '../../scripts/content-migration-candidate'
import { loadContentEncryption } from '../../server/utils/contentEncryption'
import { startBackend, Client, labelSyntheticDatabase } from './helpers'

const Database = createRequire(path.resolve(__dirname, '../../server/package.json'))('better-sqlite3')
const directory = () => mkdtempSync(path.join(tmpdir(), 'anonyproof-T32-candidate-'))
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const key = () => randomBytes(32).toString('base64')
const codec = (contentKey: string) => loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: contentKey } })
const sourceRows = (db: any) => Object.fromEntries(['feedbacks', 'feedback_comments', 'notifications', 'client_identities', 'retained_audit'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]))

function legacySource(folder: string) {
  const sourcePath = path.join(folder, 'source.db'), db = new Database(sourcePath)
  const legacyKey = key(), foreignEnvelope = codec(key()).encrypt('T32_SECRET_FOREIGN_LITERAL', 'foreign-context')
  const bodies = ['T32_SECRET_BODY_A'.repeat(512) + '中文🌲', foreignEnvelope, 'T32_SECRET_BODY_B'], solutions = ['T32_SECRET_SOLUTION_A', '', 'T32_SECRET_SOLUTION_B']
  const recoveryCodes = ['A'.repeat(20), 'B'.repeat(20)]
  db.exec(`CREATE TABLE feedbacks (id TEXT PRIMARY KEY, category TEXT NOT NULL, encrypted_content TEXT NOT NULL,
      device_id TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT DEFAULT 'pending',
      is_demo_template INTEGER NOT NULL DEFAULT 0, is_demo_clone INTEGER NOT NULL DEFAULT 0,
      original_content TEXT, solution TEXT);
    CREATE TABLE feedback_comments (id INTEGER PRIMARY KEY, feedback_id TEXT, commenter_type TEXT, content TEXT, created_at INTEGER, admin_ip TEXT, attachment_id TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, feedback_id TEXT, recipient_type TEXT, recipient_id TEXT, type TEXT, title TEXT, content TEXT, is_read INTEGER, created_at INTEGER);
    CREATE TABLE client_identities (device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL UNIQUE,
      install_key_hash TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, demo_initialized INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE retained_audit (id INTEGER PRIMARY KEY, action TEXT);
    INSERT INTO retained_audit VALUES (1,'unchanged-audit'),(2,'unchanged-audit');`)
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    `T32_PRIVATE_FEEDBACK_${i}`, 'report', JSON.stringify({ key: legacyKey, ciphertext: Buffer.from(bodies[i]).toString('base64') }),
    i < 2 ? 'device-T32_PRIVATE_A' : 'device-T32_PRIVATE_B', 100 + i, i ? 'pending' : 'resolved', 0, 0, bodies[i], solutions[i])
  for (let i = 0; i < 2; i++) db.prepare('INSERT INTO client_identities VALUES (?,?,?,?,?,?,?)').run(
    i ? 'device-T32_PRIVATE_B' : 'device-T32_PRIVATE_A', '', createHash('sha256').update(recoveryCodes[i]).digest('hex'), null, 100, 100, 0)
  const comments = ['T32_SECRET_COMMENT_USER', 'T32_SECRET_COMMENT_ADMIN', 'T32_SECRET_COMMENT_B', 'T32_SECRET_COMMENT_ORPHAN']
  for (let i = 0; i < 4; i++) db.prepare('INSERT INTO feedback_comments VALUES (?,?,?,?,?,?,?)').run(
    i + 1, i < 2 ? 'T32_PRIVATE_FEEDBACK_0' : i === 2 ? 'T32_PRIVATE_FEEDBACK_2' : 'T32_PRIVATE_ORPHAN', i === 1 ? 'admin' : 'user', comments[i], 200 + i, '', null)
  const titles = ['T32_SECRET_TITLE_ADMIN', 'T32_SECRET_TITLE_A', 'T32_SECRET_TITLE_B', 'T32_SECRET_TITLE_GENERAL']
  const notices = ['T32_SECRET_NOTICE_ADMIN', 'T32_SECRET_NOTICE_A', 'T32_SECRET_NOTICE_B', 'T32_SECRET_NOTICE_GENERAL']
  for (let i = 0; i < 4; i++) db.prepare('INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?,?)').run(
    i + 1, i < 2 ? 'T32_PRIVATE_FEEDBACK_0' : i === 2 ? 'T32_PRIVATE_FEEDBACK_2' : null,
    i ? 'user' : 'admin', i === 0 ? 'admin' : i === 2 ? 'device-T32_PRIVATE_B' : 'device-T32_PRIVATE_A',
    i === 0 ? 'new_feedback' : i === 3 ? 'general' : 'status_change', titles[i], notices[i], i % 2, 300 + i)
  const rows = sourceRows(db); db.close()
  return { sourcePath, legacyKey, bodies, solutions, comments, titles, notices, recoveryCodes, rows }
}

function verifyContent(db: any, contentKey: string, fixture: ReturnType<typeof legacySource>) {
  const c = codec(contentKey)
  for (const [i, row] of db.prepare('SELECT * FROM feedbacks ORDER BY id').all().entries()) {
    assert.equal(row.original_content_storage_version, 1); assert.equal(row.solution_storage_version, 1)
    assert.equal(c.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, 1), fixture.bodies[i])
    assert.equal(c.decrypt(row.solution, `feedbacks:${row.id}:solution`, 1), fixture.solutions[i])
    assert.equal(row.encrypted_content, 'server-encrypted:v1')
  }
  for (const [i, row] of db.prepare('SELECT * FROM feedback_comments ORDER BY id').all().entries()) {
    assert.equal(row.content_storage_version, 1)
    assert.equal(c.decrypt(row.content, `feedback_comments:${row.feedback_id}:${row.commenter_type}:content`, 1), fixture.comments[i])
  }
  for (const [i, row] of db.prepare('SELECT * FROM notifications ORDER BY id').all().entries()) {
    const context = `notifications:${row.feedback_id}:${row.recipient_type}:${row.recipient_id}:${row.type}`
    assert.equal(row.content_storage_version, 1)
    assert.equal(c.decrypt(row.title, `${context}:title`, 1), fixture.titles[i])
    assert.equal(c.decrypt(row.content, `${context}:content`, 1), fixture.notices[i])
  }
}

test('T-32 candidate: preserve exact rows/ownership, seal four content classes, compact residuals, authenticate and restore HTTP', async t => {
  const folder = directory(), fixture = legacySource(folder), before = digest(fixture.sourcePath), contentKey = key()
  assert.equal(readFileSync(fixture.sourcePath).includes(Buffer.from('T32_SECRET_BODY_A')), true)
  assert.equal(readFileSync(fixture.sourcePath).includes(Buffer.from(fixture.legacyKey)), true)
  const destinationPath = path.join(folder, 'new candidate.db')
  const report = await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  assert.deepEqual(report.converted, { feedbackBodies: 3, solutions: 3, comments: 4, notifications: 4, obsoletePackages: 3 })
  assert.deepEqual(report.recordCounts, { feedbacks: 3, feedback_comments: 4, notifications: 4, client_identities: 2 })
  assert.equal(report.activated, false); assert.equal(report.sourceModified, false)
  assert.equal(report.existingTableCountsPreserved, true)
  assert.equal(JSON.stringify(report).includes('T32_SECRET'), false); assert.equal(JSON.stringify(report).includes('T32_PRIVATE'), false)
  assert.equal(JSON.stringify(report).includes(contentKey), false); assert.equal(digest(fixture.sourcePath), before)
  assert.equal(statSync(report.workingDirectory!).mode & 0o777, 0o700)
  assert.equal(statSync(destinationPath).mode & 0o777, 0o600)
  assert.equal(statSync(destinationPath).ino, statSync(path.join(report.workingDirectory!, 'candidate.db')).ino)
  const db = new Database(destinationPath, { readonly: true }); verifyContent(db, contentKey, fixture)
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  const rows = sourceRows(db)
  assert.deepEqual(rows.client_identities, fixture.rows.client_identities); assert.deepEqual(rows.retained_audit, fixture.rows.retained_audit)
  for (const table of ['feedbacks', 'feedback_comments', 'notifications']) {
    const mutable = table === 'feedbacks' ? ['original_content', 'solution', 'encrypted_content', 'original_content_storage_version', 'solution_storage_version'] : table === 'feedback_comments' ? ['content', 'content_storage_version'] : ['title', 'content', 'content_storage_version']
    const strip = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !mutable.includes(k)))
    assert.deepEqual(rows[table].map(strip), fixture.rows[table].map(strip))
  }
  const dump = db.prepare("SELECT original_content AS v FROM feedbacks UNION ALL SELECT solution FROM feedbacks UNION ALL SELECT content FROM feedback_comments UNION ALL SELECT title FROM notifications UNION ALL SELECT content FROM notifications UNION ALL SELECT key_check FROM content_encryption_metadata").all()
  db.close()
  const bytes = readFileSync(destinationPath)
  for (const marker of ['T32_SECRET_BODY_A', ...fixture.bodies, ...fixture.bodies.map(value => Buffer.from(value).toString('base64').slice(0, 32)), ...fixture.solutions, ...fixture.comments, ...fixture.titles, ...fixture.notices, fixture.legacyKey, contentKey, Buffer.from(contentKey, 'base64').toString('hex')].filter(Boolean)) {
    assert.equal(bytes.includes(Buffer.from(marker)), false)
    assert.equal(JSON.stringify(dump).includes(marker), false)
  }
  assert.equal(bytes.includes(Buffer.from(contentKey, 'base64')), false)
  assert.equal(bytes.includes(Buffer.from(fixture.legacyKey, 'base64')), false)
  for (const suffix of ['-wal', '-journal']) assert.equal(existsSync(destinationPath + suffix), false)
  const restorePath = path.join(folder, 'independent-restore.db')
  writeFileSync(restorePath, bytes, { flag: 'wx', mode: 0o600 })
  // T-02 refuses automatic adoption. This synthetic restore explicitly models
  // the separately approved role-mapping step; real candidates stay unlabelled.
  const restoreDb = new Database(restorePath)
  labelSyntheticDatabase(restoreDb, 'formal')
  restoreDb.close()
  const restored = await startBackend({ DATABASE_PATH: restorePath, CONTENT_ENCRYPTION_KEY: contentKey }); t.after(restored.stop)
  for (const [i, recoveryCode] of fixture.recoveryCodes.entries()) {
    const user = new Client(restored), recovered = await user.post('/api/identity/recover', { recoveryCode })
    assert.equal(recovered.response.status, 200)
    const result = await user.request(`/api/feedback/device/${recovered.data.deviceId}`)
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.data.feedbacks.map((r: any) => r.id).sort(), i ? ['T32_PRIVATE_FEEDBACK_2'] : ['T32_PRIVATE_FEEDBACK_0', 'T32_PRIVATE_FEEDBACK_1'])
    assert.equal(result.data.feedbacks.find((r: any) => r.id === `T32_PRIVATE_FEEDBACK_${i ? 2 : 0}`).original_content, fixture.bodies[i ? 2 : 0])
    if (!i) assert.equal(result.data.feedbacks.find((r: any) => r.id === 'T32_PRIVATE_FEEDBACK_1').original_content, fixture.bodies[1])
  }
  const admin = new Client(restored); assert.equal((await admin.login()).response.status, 200)
  const detail = await admin.request('/api/admin/feedback/T32_PRIVATE_FEEDBACK_0')
  assert.equal(detail.response.status, 200); assert.equal(detail.data.feedback.solution, fixture.solutions[0])
  const discussion = await admin.request('/api/feedback/T32_PRIVATE_FEEDBACK_0/comments')
  assert.equal(discussion.response.status, 200); assert.deepEqual(discussion.data.comments.map((r: any) => r.content), fixture.comments.slice(0, 2))
  assert.equal((await admin.request('/api/notifications?recipientType=admin&recipientId=admin')).data.notifications[0].content, fixture.notices[0])
  assert.equal(digest(fixture.sourcePath), before)
})

test('T-32 candidate: repeating on a completed candidate authenticates but never reseals/duplicates records', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), first = path.join(folder, 'first.db'), second = path.join(folder, 'second.db')
  await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath: first, contentKey })
  const db = new Database(first, { readonly: true }), rows = sourceRows(db), marker = db.prepare('SELECT * FROM content_encryption_metadata').all(); db.close()
  const firstHash = digest(first), repeated = await prepareContentMigrationCandidate({ sourcePath: first, destinationPath: second, contentKey })
  assert.deepEqual(repeated.converted, { feedbackBodies: 0, solutions: 0, comments: 0, notifications: 0, obsoletePackages: 0 })
  assert.equal(digest(first), firstHash)
  const final = new Database(second, { readonly: true }); verifyContent(final, contentKey, fixture)
  assert.deepEqual(sourceRows(final), rows); assert.deepEqual(final.prepare('SELECT * FROM content_encryption_metadata').all(), marker); final.close()
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: first, destinationPath: second, contentKey }), /DESTINATION_EXISTS/)
})

test('T-32 candidate: late NULL failure rolls back schema/content/marker and preserves source; corrected synthetic retry succeeds', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db')
  const bad = new Database(fixture.sourcePath); bad.exec('UPDATE notifications SET content=NULL WHERE id=4'); const expected = sourceRows(bad); bad.close()
  const before = digest(fixture.sourcePath)
  let error: ContentMigrationPreparationError | undefined
  try { await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey }) } catch (e) { error = e as ContentMigrationPreparationError }
  assert.equal(error?.code, 'UNSUPPORTED_NULL_OR_CONTENT_TYPE'); assert.ok(error?.workingDirectory)
  assert.equal(existsSync(destinationPath), false); assert.equal(digest(fixture.sourcePath), before)
  assert.equal(error!.message.includes('T32_SECRET'), false); assert.equal(error!.message.includes(contentKey), false)
  const staged = new Database(path.join(error!.workingDirectory!, 'snapshot.db'), { readonly: true })
  assert.deepEqual(sourceRows(staged), expected)
  assert.equal(staged.prepare("SELECT 1 FROM sqlite_master WHERE name='content_encryption_metadata'").get(), undefined)
  assert.equal(staged.prepare('PRAGMA table_info(feedbacks)').all().some((r: any) => r.name.endsWith('_storage_version')), false); staged.close()
  const corrected = new Database(fixture.sourcePath); corrected.prepare('UPDATE notifications SET content=? WHERE id=4').run(fixture.notices[3]); corrected.close()
  await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  const verified = new Database(destinationPath, { readonly: true }); verifyContent(verified, contentKey, fixture); verified.close()
})

test('T-32 candidate: wrong key and tampered marked-v1 contents fail, not plaintext fallback', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), first = path.join(folder, 'first.db')
  await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath: first, contentKey })
  const before = digest(first)
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: first, destinationPath: path.join(folder, 'wrong.db'), contentKey: key() }), /DATABASE_KEY_MISMATCH/)
  assert.equal(digest(first), before); assert.equal(existsSync(path.join(folder, 'wrong.db')), false)
  const tampered = new Database(first); const row = tampered.prepare('SELECT content FROM notifications WHERE id=4').get()
  const envelope = JSON.parse(row.content.slice(4)); envelope.tag = randomBytes(16).toString('base64')
  tampered.prepare('UPDATE notifications SET content=? WHERE id=4').run('apc:' + JSON.stringify(envelope)); tampered.close()
  const tamperedHash = digest(first)
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: first, destinationPath: path.join(folder, 'tampered.db'), contentKey }), /AUTHENTICATION_FAILED/)
  assert.equal(digest(first), tamperedHash); assert.equal(existsSync(path.join(folder, 'tampered.db')), false)
})

test('T-32 candidate: committed WAL snapshot is included while writer remains open; original logical data unchanged', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db')
  const writer = new Database(fixture.sourcePath); writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0')
  writer.prepare('UPDATE feedbacks SET original_content=? WHERE id=?').run('T32_SECRET_COMMITTED_WAL', 'T32_PRIVATE_FEEDBACK_2')
  const expected = sourceRows(writer), before = digest(fixture.sourcePath), wal = digest(fixture.sourcePath + '-wal')
  assert.ok(statSync(fixture.sourcePath + '-wal').size > 0)
  await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  assert.deepEqual(sourceRows(writer), expected); assert.equal(digest(fixture.sourcePath), before); assert.equal(digest(fixture.sourcePath + '-wal'), wal)
  const candidate = new Database(destinationPath, { readonly: true }), row = candidate.prepare("SELECT * FROM feedbacks WHERE id='T32_PRIVATE_FEEDBACK_2'").get()
  assert.equal(codec(contentKey).decrypt(row.original_content, 'feedbacks:T32_PRIVATE_FEEDBACK_2:original_content', 1), 'T32_SECRET_COMMITTED_WAL')
  candidate.close(); writer.close()
  assert.equal(readFileSync(destinationPath).includes(Buffer.from('T32_SECRET_COMMITTED_WAL')), false)
})

test('T-32 candidate: scope/triggers/schema/versions/missing key/paths rejected, and destination publication cannot overwrite a racing file', async t => {
  for (const [name, sql, expected] of [
    ['demo', "UPDATE feedbacks SET is_demo_template=1 WHERE id='T32_PRIVATE_FEEDBACK_0'", 'UNAPPROVED_SCOPE'],
    ['clone', "UPDATE feedbacks SET is_demo_clone=1 WHERE id='T32_PRIVATE_FEEDBACK_0'", 'UNAPPROVED_SCOPE'],
    ['trigger', "CREATE TRIGGER unreviewed AFTER UPDATE ON feedbacks BEGIN UPDATE retained_audit SET action='changed'; END", 'UNREVIEWED_TRIGGER'],
    ['version', 'ALTER TABLE feedbacks ADD COLUMN original_content_storage_version INTEGER DEFAULT 7', 'UNSUPPORTED_STORAGE_VERSION'],
    ['realVersion', 'ALTER TABLE feedbacks ADD COLUMN original_content_storage_version REAL DEFAULT 0.0', 'UNSUPPORTED_STORAGE_VERSION'],
    ['nullSolution', 'UPDATE feedbacks SET solution=NULL', 'UNSUPPORTED_NULL_OR_CONTENT_TYPE'],
    ['ambiguousBody', "UPDATE feedbacks SET original_content=''", 'AMBIGUOUS_LEGACY_BODY'],
    ['schema', 'ALTER TABLE feedbacks RENAME COLUMN solution TO archived_solution', 'UNSUPPORTED_SCHEMA'],
    ['primary', 'ALTER TABLE feedback_comments RENAME TO held_feedback_comments; CREATE TABLE feedback_comments AS SELECT * FROM held_feedback_comments', 'UNSUPPORTED_PRIMARY_KEY'],
  ]) await t.test(name, async () => {
    const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db')
    const db = new Database(fixture.sourcePath); db.exec(sql); db.close(); const before = digest(fixture.sourcePath)
    await assert.rejects(prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey }), new RegExp(expected))
    assert.equal(digest(fixture.sourcePath), before); assert.equal(existsSync(destinationPath), false)
  })
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db')
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey: '' }), /MISSING_KEY/)
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: 'source.db', destinationPath, contentKey }), /ABSOLUTE_PATHS_REQUIRED/)
  const missing = path.join(folder, 'missing.db')
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: missing, destinationPath, contentKey }), /SOURCE_OR_IO_FAILURE/)
  assert.equal(existsSync(missing), false)
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath: fixture.sourcePath, contentKey }), /DESTINATION_EXISTS/)
  await assert.rejects(prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath: fixture.sourcePath + '-wal', contentKey }), /DESTINATION_DB_SUFFIX_REQUIRED/)
  const pending = prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  writeFileSync(destinationPath, 'T32_PRIVATE_RACING_FILE', { flag: 'wx' })
  await assert.rejects(pending, /SOURCE_OR_IO_FAILURE/)
  assert.equal(readFileSync(destinationPath, 'utf8'), 'T32_PRIVATE_RACING_FILE')
})

test('T-32 candidate: bounded keyset batches convert every row beyond two batch boundaries', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db')
  const db = new Database(fixture.sourcePath)
  const feedback = db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?,?,?,?,?,?)')
  const comment = db.prepare('INSERT INTO feedback_comments VALUES (?,?,?,?,?,?,?)')
  const notice = db.prepare('INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?,?)')
  db.transaction(() => {
    for (let i = 0; i < 257; i++) {
      const id = `bulk-T32-${String(i).padStart(6, '0')}`, content = `T32_SECRET_BATCH_${i}`
      feedback.run(id, 'report', fixture.legacyKey, 'device-T32_PRIVATE_A', i + 400, 'pending', 0, 0, content, '')
      comment.run(i + 5, id, 'user', content, i + 500, '', null)
      notice.run(i + 5, id, 'user', 'device-T32_PRIVATE_A', 'general', content, content, 0, i + 600)
    }
  })()
  const ownership = db.prepare('SELECT device_id, COUNT(*) AS n FROM feedbacks GROUP BY device_id ORDER BY device_id').all()
  db.close(); const before = digest(fixture.sourcePath)
  const report = await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  assert.deepEqual(report.converted, { feedbackBodies: 260, solutions: 260, comments: 261, notifications: 261, obsoletePackages: 260 })
  assert.equal(digest(fixture.sourcePath), before)
  const candidate = new Database(destinationPath, { readonly: true }), c = codec(contentKey)
  assert.deepEqual(candidate.prepare('SELECT device_id, COUNT(*) AS n FROM feedbacks GROUP BY device_id ORDER BY device_id').all(), ownership)
  for (const row of candidate.prepare("SELECT * FROM feedbacks WHERE id LIKE 'bulk-T32-%' ORDER BY id").all()) {
    const n = Number(row.id.slice(-6))
    assert.equal(c.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, row.original_content_storage_version), `T32_SECRET_BATCH_${n}`)
  }
  for (const row of candidate.prepare('SELECT * FROM feedback_comments WHERE id>=5 ORDER BY id').all()) {
    assert.equal(c.decrypt(row.content, `feedback_comments:${row.feedback_id}:user:content`, row.content_storage_version), `T32_SECRET_BATCH_${row.id - 5}`)
  }
  for (const row of candidate.prepare('SELECT * FROM notifications WHERE id>=5 ORDER BY id').all()) {
    const ctx = `notifications:${row.feedback_id}:user:device-T32_PRIVATE_A:general`
    for (const field of ['title', 'content']) assert.equal(c.decrypt(row[field], `${ctx}:${field}`, row.content_storage_version), `T32_SECRET_BATCH_${row.id - 5}`)
  }
  candidate.close()
})

test('T-32 candidate: mixed legacy and marked-v1 fields preserve valid ciphertext independently while sealing only legacy values', async () => {
  const folder = directory(), fixture = legacySource(folder), contentKey = key(), destinationPath = path.join(folder, 'candidate.db'), c = codec(contentKey)
  const db = new Database(fixture.sourcePath)
  db.exec(`ALTER TABLE feedbacks ADD COLUMN original_content_storage_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE feedbacks ADD COLUMN solution_storage_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE feedback_comments ADD COLUMN content_storage_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE notifications ADD COLUMN content_storage_version INTEGER NOT NULL DEFAULT 0;`)
  const body = c.encrypt(fixture.bodies[0], 'feedbacks:T32_PRIVATE_FEEDBACK_0:original_content')
  const solution = c.encrypt(fixture.solutions[2], 'feedbacks:T32_PRIVATE_FEEDBACK_2:solution')
  const comment = c.encrypt(fixture.comments[1], 'feedback_comments:T32_PRIVATE_FEEDBACK_0:admin:content')
  const ctx = 'notifications:T32_PRIVATE_FEEDBACK_0:admin:admin:new_feedback'
  const title = c.encrypt(fixture.titles[0], `${ctx}:title`), notice = c.encrypt(fixture.notices[0], `${ctx}:content`)
  db.prepare("UPDATE feedbacks SET original_content=?, original_content_storage_version=1 WHERE id='T32_PRIVATE_FEEDBACK_0'").run(body)
  db.prepare("UPDATE feedbacks SET solution=?, solution_storage_version=1 WHERE id='T32_PRIVATE_FEEDBACK_2'").run(solution)
  db.prepare('UPDATE feedback_comments SET content=?, content_storage_version=1 WHERE id=2').run(comment)
  db.prepare('UPDATE notifications SET title=?, content=?, content_storage_version=1 WHERE id=1').run(title, notice)
  db.close(); const before = digest(fixture.sourcePath)
  const report = await prepareContentMigrationCandidate({ sourcePath: fixture.sourcePath, destinationPath, contentKey })
  assert.deepEqual(report.converted, { feedbackBodies: 2, solutions: 2, comments: 3, notifications: 3, obsoletePackages: 3 })
  assert.equal(digest(fixture.sourcePath), before)
  const candidate = new Database(destinationPath, { readonly: true }); verifyContent(candidate, contentKey, fixture)
  assert.equal(candidate.prepare("SELECT original_content FROM feedbacks WHERE id='T32_PRIVATE_FEEDBACK_0'").get().original_content, body)
  assert.equal(candidate.prepare("SELECT solution FROM feedbacks WHERE id='T32_PRIVATE_FEEDBACK_2'").get().solution, solution)
  assert.equal(candidate.prepare('SELECT content FROM feedback_comments WHERE id=2').get().content, comment)
  assert.deepEqual(candidate.prepare('SELECT title,content FROM notifications WHERE id=1').get(), { title, content: notice })
  candidate.close()
})
