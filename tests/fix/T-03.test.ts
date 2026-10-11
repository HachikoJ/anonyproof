import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import type DatabaseType from 'better-sqlite3'
import { CONTENT_ENVELOPE_PREFIX, ContentEncryptionError, loadContentEncryption } from '../../server/utils/contentEncryption'

const requireServer = createRequire(path.resolve(__dirname, '../../server/package.json'))
const Database = requireServer('better-sqlite3') as typeof DatabaseType
const key = Buffer.alloc(32).toString('base64')
const otherKey = Buffer.alloc(32, 1).toString('base64')
const codec = () => loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: key } })
const envelope = (stored: string) => JSON.parse(stored.slice(CONTENT_ENVELOPE_PREFIX.length))

test('T-03 module: AES-256-GCM known ciphertext, independently calculated authenticated vector', () => {
  // Zero key/nonce/plaintext: ciphertext cea7403d4d606b6e074ec5d3baf39d18
  // is the NIST AES-256-GCM vector. Tag independently calculated with Python
  // cryptography AESGCM and this format\'s documented AAD, not this module.
  const stored = 'apc:{"v":1,"alg":"A256GCM","kid":"66687aadf862bd776c8fc18b8e9f8e20","nonce":"AAAAAAAAAAAAAAAA","tag":"QU0xRQQZlCXKCZnch8MEXw==","ciphertext":"zqdAPU1ga24HTsXTuvOdGA=="}'
  assert.equal(codec().decrypt(stored, 'known-vector', 1), '\0'.repeat(16))
})

test('T-03 module: unique random 96-bit nonces; exact empty/Unicode/max-size round trips', () => {
  const encryption = codec()
  const nonces = new Set<string>()
  for (let index = 0; index < 2000; index++) {
    const stored = encryption.encrypt('same content', 'feedbacks:fixture:original_content')
    const sealed = envelope(stored)
    assert.equal(Buffer.from(sealed.nonce, 'base64').length, 12)
    assert.equal(Buffer.from(sealed.tag, 'base64').length, 16)
    assert.equal(encryption.decrypt(stored, 'feedbacks:fixture:original_content', 1), 'same content')
    assert.equal(nonces.has(sealed.nonce), false)
    nonces.add(sealed.nonce)
  }
  for (const plaintext of ['', ' 完整保留空白、中文和🧪\n', '中'.repeat(10000), 'apc:literal user text']) {
    const stored = encryption.encrypt(plaintext, 'feedbacks:fixture:original_content')
    assert.equal(encryption.decrypt(stored, 'feedbacks:fixture:original_content', 1), plaintext)
    assert.equal(stored.includes(key), false)
    assert.equal(Object.keys(envelope(stored)).includes('key'), false)
  }
})

test('T-03 module: altered cipher/tag/nonce/context/key and unknown versions cannot fall back', () => {
  const encryption = codec()
  const stored = encryption.encrypt('sensitive test text', 'feedbacks:fixture:original_content')
  for (const field of ['nonce', 'tag', 'ciphertext']) {
    const changed = envelope(stored)
    const bytes = Buffer.from(changed[field], 'base64')
    bytes[0] ^= 1
    changed[field] = bytes.toString('base64')
    assert.throws(() => encryption.decrypt('apc:' + JSON.stringify(changed), 'feedbacks:fixture:original_content', 1), ContentEncryptionError)
  }
  assert.throws(() => encryption.decrypt(stored, 'feedbacks:other-record:original_content', 1), ContentEncryptionError)
  assert.throws(() => loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } }).decrypt(stored, 'feedbacks:fixture:original_content', 1), ContentEncryptionError)
  for (const changed of [
    { ...envelope(stored), v: 2 }, { ...envelope(stored), alg: 'plain' },
    { ...envelope(stored), kid: 'unknown' }, { ...envelope(stored), nonce: '' },
    { ...envelope(stored), tag: 'bad' }, { ...envelope(stored), plaintext: 'injected' },
  ]) {
    assert.throws(() => encryption.decrypt('apc:' + JSON.stringify(changed), 'feedbacks:fixture:original_content', 1), ContentEncryptionError)
  }
  for (const broken of ['apc:', 'apc:plaintext', 'apc:null', 'apc:[]']) {
    assert.throws(() => encryption.decrypt(broken, 'fixture', 1), ContentEncryptionError)
  }
})

test('T-03 module: explicit old-format reader compatibility and demo keylessness', () => {
  for (const encryption of [codec(), loadContentEncryption({ demoMode: true, env: {} })]) {
    for (const legacy of [
      'historical plaintext', '', 'demo-encrypted:template', 'YWJjZA==',
      'apc:普通历史正文', 'apc:null', 'apc:[]',
      codec().encrypt('A valid envelope is itself this historical plaintext', 'other-field'),
      loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } }).encrypt('foreign-key envelope literal', 'other-field'),
    ]) {
      assert.equal(encryption.decrypt(legacy, 'fixture', 0), legacy)
    }
  }
  const demo = loadContentEncryption({ demoMode: true, env: {} })
  assert.equal(demo.encrypt('fixed synthetic example', 'fixture'), 'fixed synthetic example')
  assert.equal(demo.encrypt('apc:pretend envelope', 'fixture'), 'apc:pretend envelope')
  assert.throws(() => demo.decrypt(codec().encrypt('private', 'fixture'), 'fixture', 1), ContentEncryptionError)
})

test('T-03 module: storage version is mandatory; sealed version rejects missing prefix and unknown flags', () => {
  const encryption = codec()
  for (const version of [-1, 2, 99, Number.NaN, undefined as unknown as number]) {
    assert.throws(() => encryption.decrypt('apc:历史原文', 'fixture', version), ContentEncryptionError)
  }
  assert.throws(() => encryption.decrypt('historical-looking unsealed text', 'fixture', 1), ContentEncryptionError)
  assert.equal(encryption.storageVersion, 1)
  assert.equal(loadContentEncryption({ demoMode: true, env: {} }).storageVersion, 0)
})

test('T-03 module: missing, noncanonical and wrong-length key configuration fails closed', () => {
  for (const bad of [undefined, '', 'short', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), key + '\n', key.slice(0, -1), '-'.repeat(44)]) {
    assert.throws(() => loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: bad } }), ContentEncryptionError)
  }
})

test('T-03 module: persisted key marker rejects wrong/lost key without overwriting marker', () => {
  const db = new Database(':memory:')
  try {
    const encryption = codec()
    encryption.assertDatabaseKey(db)
    const before = db.prepare('SELECT * FROM content_encryption_metadata').all()
    encryption.assertDatabaseKey(db)
    const other = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } })
    assert.throws(() => other.assertDatabaseKey(db), ContentEncryptionError)
    assert.throws(() => loadContentEncryption({ demoMode: true, env: {} }).assertDatabaseKey(db), ContentEncryptionError)
    assert.deepEqual(db.prepare('SELECT * FROM content_encryption_metadata').all(), before)
    assert.equal(JSON.stringify(before).includes(key), false)
    const marker = before[0] as { key_check: string }
    const changed = envelope(marker.key_check)
    changed.tag = Buffer.alloc(16).toString('base64')
    db.prepare('UPDATE content_encryption_metadata SET key_check = ?').run('apc:' + JSON.stringify(changed))
    const corrupted = db.prepare('SELECT * FROM content_encryption_metadata').all()
    assert.throws(() => encryption.assertDatabaseKey(db), ContentEncryptionError)
    assert.deepEqual(db.prepare('SELECT * FROM content_encryption_metadata').all(), corrupted)
  } finally { db.close() }
})

test('T-03 module: markerless existing ciphertext cannot be adopted with the wrong key', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE feedbacks (original_content TEXT, encrypted_content TEXT, solution TEXT, original_content_storage_version INTEGER NOT NULL DEFAULT 0, solution_storage_version INTEGER NOT NULL DEFAULT 0)')
    db.prepare('INSERT INTO feedbacks (original_content, encrypted_content, solution, original_content_storage_version) VALUES (?, ?, ?, 1)').run(codec().encrypt('old sealed record', 'fixture'), 'old-client-package', '')
    const other = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } })
    assert.throws(() => other.assertDatabaseKey(db), ContentEncryptionError)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'content_encryption_metadata'").get(), undefined)
    codec().assertDatabaseKey(db)
    assert.equal((db.prepare('SELECT COUNT(*) AS total FROM feedbacks').get() as { total: number }).total, 1)
  } finally { db.close() }
})

test('T-03 module: row flags preserve legacy prefix collisions; old body and new solution coexist', () => {
  const db = new Database(':memory:')
  try {
    db.exec(`CREATE TABLE feedbacks (
      original_content TEXT, original_content_storage_version INTEGER NOT NULL DEFAULT 0,
      solution TEXT, solution_storage_version INTEGER NOT NULL DEFAULT 0
    )`)
    const literal = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } })
      .encrypt('literal legacy envelope under unrelated key', 'old-context')
    const encryption = codec()
    db.prepare('INSERT INTO feedbacks (original_content, solution, solution_storage_version) VALUES (?, ?, 1)')
      .run(literal, encryption.encrypt('new solution', 'feedbacks:fixture:solution'))
    encryption.assertDatabaseKey(db)
    const row = db.prepare('SELECT * FROM feedbacks').get() as {
      original_content: string; original_content_storage_version: number; solution: string; solution_storage_version: number
    }
    assert.equal(row.original_content, literal)
    assert.equal(row.original_content_storage_version, 0)
    assert.equal(encryption.decrypt(row.original_content, 'feedbacks:fixture:original_content', row.original_content_storage_version), literal)
    assert.equal(encryption.decrypt(row.solution, 'feedbacks:fixture:solution', row.solution_storage_version), 'new solution')
    // Without flag columns the old schema is legacy, including envelope-shaped
    // text. A keyless demo verifier must not mistake it for formal ciphertext.
    const oldDb = new Database(':memory:')
    try {
      oldDb.exec('CREATE TABLE feedback_comments (content TEXT)')
      oldDb.prepare('INSERT INTO feedback_comments VALUES (?)').run(literal)
      loadContentEncryption({ demoMode: true, env: {} }).assertDatabaseKey(oldDb)
      assert.equal((oldDb.prepare('SELECT content FROM feedback_comments').get() as { content: string }).content, literal)
    } finally { oldDb.close() }
  } finally { db.close() }
})

test('T-03 module: database version 1 bad prefix and unknown storage flags fail without a new marker', () => {
  for (const [version, value] of [[1, 'apc:broken'], [1, 'missing-envelope-prefix'], [2, 'old-looking text']] as const) {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE feedback_comments (content TEXT, content_storage_version INTEGER NOT NULL DEFAULT 0)')
      db.prepare('INSERT INTO feedback_comments VALUES (?, ?)').run(value, version)
      const before = db.prepare('SELECT * FROM feedback_comments').all()
      assert.throws(() => codec().assertDatabaseKey(db), ContentEncryptionError)
      assert.deepEqual(db.prepare('SELECT * FROM feedback_comments').all(), before)
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'content_encryption_metadata'").get(), undefined)
    } finally { db.close() }
  }
  const db = new Database(':memory:')
  try {
    codec().assertDatabaseKey(db)
    db.exec('CREATE TABLE notifications (title TEXT, content TEXT, content_storage_version INTEGER NOT NULL DEFAULT 0)')
    db.prepare('INSERT INTO notifications VALUES (?, ?, ?)').run('title', 'content', 2)
    assert.throws(() => codec().assertDatabaseKey(db), ContentEncryptionError)
  } finally { db.close() }
})

test('T-03 reader: real HTTP preserves legacy literals and independently sealed fields across restart/restore', async (t) => {
  const { Client, startBackend, launchBackend } = await import('./helpers')
  const { setTimeout: delay } = await import('node:timers/promises')
  const { randomBytes } = await import('node:crypto')
  const { writeFileSync } = await import('node:fs')
  const encryption = codec()
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: key })
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const identity = (await user.identity()).data
  assert.equal((await admin.login()).response.status, 200)
  const feedback = await user.post('/api/feedback', {
    category: 'report', originalContent: 'reader initial synthetic body', encryptedContent: 'old-client-package', deviceId: identity.deviceId,
  })
  assert.equal(feedback.response.status, 200)
  const id = feedback.data.id
  const db = service.openDb()
  t.after(() => db.close())
  const literal = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: otherKey } }).encrypt('legacy envelope-shaped literal', 'foreign')
  const solution = 'reader sealed synthetic solution'
  const comment = 'reader sealed synthetic comment'
  const notification = 'reader sealed synthetic notification'
  db.prepare('UPDATE feedbacks SET original_content = ?, original_content_storage_version = 0, solution = ?, solution_storage_version = 1 WHERE id = ?')
    .run(literal, encryption.encrypt(solution, `feedbacks:${id}:solution`), id)
  const added = await user.post(`/api/feedback/${id}/comments`, { content: 'reader initial synthetic comment' })
  assert.equal(added.response.status, 200)
  db.prepare('UPDATE feedback_comments SET content = ?, content_storage_version = 1 WHERE id = ?')
    .run(encryption.encrypt(comment, `feedback_comments:${id}:user:content`), added.data.comment.id)
  const ctx = `notifications:${id}:admin:admin:new_feedback`
  db.prepare("UPDATE notifications SET title = ?, content = ?, content_storage_version = 1 WHERE feedback_id = ? AND type = 'new_feedback'")
    .run(encryption.encrypt('reader sealed title', `${ctx}:title`), encryption.encrypt(notification, `${ctx}:content`), id)
  const userRead = await user.request(`/api/feedback/device/${identity.deviceId}`)
  assert.equal(userRead.response.status, 200)
  assert.equal(userRead.data.feedbacks[0].original_content, literal)
  assert.equal(userRead.data.feedbacks[0].solution, solution)
  assert.equal(Object.hasOwn(userRead.data.feedbacks[0], 'solution_storage_version'), false)
  const detail = await admin.request(`/api/admin/feedback/${id}`)
  assert.equal(detail.response.status, 200)
  assert.equal(detail.data.feedback.original_content, literal)
  assert.equal(detail.data.feedback.solution, solution)
  assert.equal((await user.request(`/api/feedback/${id}/comments`)).data.comments[0].content, comment)
  const notices = (await admin.request('/api/notifications?recipientType=admin&recipientId=admin')).data.notifications
  assert.equal(notices.find((row: any) => row.type === 'new_feedback').content, notification)
  assert.equal(notices.find((row: any) => row.type === 'new_feedback').title, 'reader sealed title')
  const backupPath = path.join(service.dir, 'reader-consistent-backup.db')
  const keyPath = path.join(service.dir, 'reader-content-key.separate.fixture')
  writeFileSync(keyPath, key, { mode: 0o600 })
  await db.backup(backupPath)
  await service.stop()
  const restored = await startBackend({ DATABASE_PATH: backupPath, CONTENT_ENCRYPTION_KEY: key })
  t.after(restored.stop)
  const restoredUser = new Client(restored)
  const recovery = await restoredUser.post('/api/identity/recover', { recoveryCode: identity.recoveryCode })
  assert.equal(recovery.response.status, 200)
  const reread = await restoredUser.request(`/api/feedback/device/${identity.deviceId}`)
  assert.equal(reread.response.status, 200)
  assert.equal(reread.data.feedbacks[0].original_content, literal)
  assert.equal(reread.data.feedbacks[0].solution, solution)
  await restored.stop()
  const restoredDb = restored.openDb()
  try {
    const before = restoredDb.prepare('SELECT * FROM content_encryption_metadata').all()
    for (const configured of ['', randomBytes(32).toString('base64')]) {
      const denied = await launchBackend({ DATABASE_PATH: backupPath, CONTENT_ENCRYPTION_KEY: configured })
      t.after(denied.stop)
      const exit = await Promise.race([denied.exited, delay(5000, 'timeout', { ref: false })])
      assert.notEqual(exit, 'timeout')
      assert.notEqual(exit, 0)
      assert.match(denied.output(), /Content encryption error/)
      assert.deepEqual(restoredDb.prepare('SELECT * FROM content_encryption_metadata').all(), before)
    }
  } finally { restoredDb.close() }
})

test('T-03 writer: four content classes have no plaintext/key copies in DB, WAL, SQL export or logs', async (t) => {
  const { Client, startBackend } = await import('./helpers')
  const { randomBytes } = await import('node:crypto')
  const { existsSync, readFileSync, writeFileSync, readdirSync } = await import('node:fs')
  const { spawnSync } = await import('node:child_process')
  const contentKey = randomBytes(32).toString('base64')
  const encryption = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: contentKey } })
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: contentKey })
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const stranger = new Client(service)
  const identity = (await user.identity()).data
  await stranger.identity()
  assert.equal((await admin.login()).response.status, 200)
  const suffix = randomBytes(8).toString('hex')
  const body = `BODY_${suffix}_synthetic confidential marker`
  const comment = `COMMENT_${suffix}_synthetic confidential marker`
  const reply = `REPLY_${suffix}_synthetic confidential marker`
  const solution = `SOLUTION_${suffix}_synthetic confidential marker`
  const oldPackage = 'obsolete-client-key-package-' + randomBytes(32).toString('base64')
  const created = await user.post('/api/feedback', { category: 'report', deviceId: identity.deviceId, originalContent: body, encryptedContent: oldPackage })
  assert.equal(created.response.status, 200)
  const id = created.data.id
  assert.equal((await user.post(`/api/feedback/${id}/comments`, { content: comment })).response.status, 200)
  assert.equal((await admin.post(`/api/admin/feedback/${id}/comments`, { content: reply })).response.status, 200)
  assert.equal((await admin.post(`/api/admin/feedback/${id}/status`, { status: 'resolved', solution }, 'PUT')).response.status, 200)
  const db = service.openDb()
  t.after(() => db.close())
  const feedback = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as any
  assert.equal(feedback.original_content_storage_version, 1)
  assert.equal(feedback.solution_storage_version, 1)
  assert.equal(feedback.encrypted_content, 'server-encrypted:v1')
  assert.equal(encryption.decrypt(feedback.original_content, `feedbacks:${id}:original_content`, 1), body)
  assert.equal(encryption.decrypt(feedback.solution, `feedbacks:${id}:solution`, 1), solution)
  const storedComments = db.prepare('SELECT * FROM feedback_comments').all() as any[]
  const storedNotices = db.prepare('SELECT * FROM notifications').all() as any[]
  const sealedValues = [feedback.original_content, feedback.solution]
  for (const row of storedComments) {
    assert.equal(row.content_storage_version, 1)
    assert.equal(encryption.decrypt(row.content, `feedback_comments:${id}:${row.commenter_type}:content`, 1), row.commenter_type === 'user' ? comment : reply)
    sealedValues.push(row.content)
  }
  for (const row of storedNotices) {
    assert.equal(row.content_storage_version, 1)
    const ctx = `notifications:${id}:${row.recipient_type}:${row.recipient_id}:${row.type}`
    assert.ok(encryption.decrypt(row.title, `${ctx}:title`, 1).length > 0)
    assert.ok(encryption.decrypt(row.content, `${ctx}:content`, 1).length > 0)
    sealedValues.push(row.title, row.content)
  }
  assert.equal(storedComments.length, 2)
  assert.equal(storedNotices.length, 4)
  assert.equal(new Set(sealedValues.map(value => envelope(value).nonce)).size, sealedValues.length)
  const markers = [body.slice(0, 22), comment.slice(0, 25), reply.slice(0, 23), solution.slice(0, 26), oldPackage,
    contentKey, Buffer.from(contentKey, 'base64').toString('hex')]
  const noCopies = (bytes: Buffer, label: string) => {
    for (const marker of markers) assert.equal(bytes.includes(Buffer.from(marker)), false, `${label} contains a protected marker/key`)
  }
  assert.ok(existsSync(service.databasePath + '-wal'), 'scan must include a live WAL')
  for (const file of [service.databasePath, service.databasePath + '-wal', service.databasePath + '-shm']) {
    if (existsSync(file)) noCopies(readFileSync(file), path.basename(file))
  }
  const exported = spawnSync('sqlite3', [service.databasePath, '.dump'], { encoding: 'utf8' })
  assert.equal(exported.status, 0, exported.stderr)
  assert.ok(exported.stdout.includes('INSERT INTO feedbacks'))
  writeFileSync(path.join(service.dir, 'synthetic-sql-export.sql'), exported.stdout)
  noCopies(Buffer.from(exported.stdout), 'SQL export')
  noCopies(Buffer.from(service.output()), 'captured process output')
  const logDir = path.join(service.dir, 'logs')
  if (existsSync(logDir)) {
    for (const file of readdirSync(logDir, { recursive: true, withFileTypes: true })) {
      if (file.isFile()) noCopies(readFileSync(path.join(file.parentPath, file.name)), 'fixture log')
    }
  }
  const list = await user.request(`/api/feedback/device/${identity.deviceId}`)
  assert.equal(list.data.feedbacks[0].original_content, body)
  assert.equal(list.data.feedbacks[0].solution, solution)
  assert.equal((await admin.request('/api/admin/feedbacks')).data.feedbacks[0].original_content, body)
  assert.equal((await admin.request(`/api/admin/feedback/${id}`)).data.feedback.solution, solution)
  assert.equal((await stranger.request(`/api/feedback/${id}/comments`)).response.status, 401)
  assert.equal((await stranger.request(`/api/feedback/device/${identity.deviceId}`)).response.status, 401)
  assert.deepEqual((await user.request(`/api/feedback/${id}/comments`)).data.comments.map((row: any) => row.content), [comment, reply])
  const adminNotices = (await admin.request('/api/notifications?recipientType=admin&recipientId=admin')).data.notifications
  const userNotices = (await user.request(`/api/notifications?recipientType=user&recipientId=${identity.deviceId}`)).data.notifications
  assert.ok(adminNotices.some((row: any) => row.content.includes(body.slice(0, 22))))
  assert.ok(adminNotices.some((row: any) => row.content.includes(comment.slice(0, 25))))
  assert.ok(userNotices.some((row: any) => row.content.includes(reply.slice(0, 23))))
  assert.ok(userNotices.some((row: any) => row.content.includes(solution.slice(0, 26))))
  const noticeCount = storedNotices.length
  assert.equal((await admin.post(`/api/admin/feedback/${id}/status`, { status: 'resolved', solution }, 'PUT')).response.status, 200)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications').get() as { n: number }).n, noticeCount)
  // Changing an old record's solution must not silently migrate its old body.
  const legacyId = 'T03-legacy-' + suffix
  db.prepare('INSERT INTO feedbacks (id,category,encrypted_content,device_id,created_at,original_content) VALUES (?,?,?,?,?,?)')
    .run(legacyId, 'report', 'legacy client package', identity.deviceId, Date.now(), 'legacy literal body')
  assert.equal((await admin.post(`/api/admin/feedback/${legacyId}/status`, { status: 'resolved', solution }, 'PUT')).response.status, 200)
  const legacy = db.prepare('SELECT * FROM feedbacks WHERE id=?').get(legacyId) as any
  assert.equal(legacy.original_content_storage_version, 0)
  assert.equal(legacy.original_content, 'legacy literal body')
  assert.equal(legacy.solution_storage_version, 1)
  const backupPath = path.join(service.dir, 'writer-consistent-backup.db')
  await db.backup(backupPath)
  await service.stop()
  const restored = await startBackend({ DATABASE_PATH: backupPath, CONTENT_ENCRYPTION_KEY: contentKey })
  t.after(restored.stop)
  const recovered = new Client(restored)
  assert.equal((await recovered.post('/api/identity/recover', { recoveryCode: identity.recoveryCode })).response.status, 200)
  const restoredRecords = (await recovered.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks
  assert.equal(restoredRecords.find((row: any) => row.id === id).original_content, body)
  assert.equal(restoredRecords.find((row: any) => row.id === id).solution, solution)
  assert.equal((await recovered.request(`/api/feedback/${id}/comments`)).data.comments[1].content, reply)
  assert.ok((await recovered.request(`/api/notifications?recipientType=user&recipientId=${identity.deviceId}`)).data.notifications.some((row: any) => row.content.includes(solution.slice(0, 26))))
})

test('T-03 writer: nonce/cipher/tag/field-version tampering is a controlled HTTP failure without plaintext fallback', async (t) => {
  const { Client, startBackend } = await import('./helpers')
  const service = await startBackend()
  t.after(service.stop)
  const user = new Client(service)
  const admin = new Client(service)
  const identity = (await user.identity()).data
  await admin.login()
  const created = await user.post('/api/feedback', { category: 'report', deviceId: identity.deviceId, originalContent: 'tamper protected body', encryptedContent: 'old-client-package' })
  const id = created.data.id
  const comment = await user.post(`/api/feedback/${id}/comments`, { content: 'tamper protected comment' })
  await admin.post(`/api/admin/feedback/${id}/status`, { status: 'resolved', solution: 'tamper protected solution' }, 'PUT')
  const db = service.openDb()
  t.after(() => db.close())
  const notice = db.prepare("SELECT id FROM notifications WHERE type='status_update'").get() as { id: number }
  const fields = [
    ['feedbacks', 'id', id, 'original_content', 'original_content_storage_version', admin, `/api/admin/feedback/${id}`],
    ['feedbacks', 'id', id, 'solution', 'solution_storage_version', user, `/api/feedback/device/${identity.deviceId}`],
    ['feedback_comments', 'id', comment.data.comment.id, 'content', 'content_storage_version', user, `/api/feedback/${id}/comments`],
    ['notifications', 'id', notice.id, 'title', 'content_storage_version', user, `/api/notifications?recipientType=user&recipientId=${identity.deviceId}`],
    ['notifications', 'id', notice.id, 'content', 'content_storage_version', user, `/api/notifications?recipientType=user&recipientId=${identity.deviceId}`],
  ] as const
  for (const [table, keyColumn, rowId, column, version, client, url] of fields) {
    const original = db.prepare(`SELECT ${column} value, ${version} version FROM ${table} WHERE ${keyColumn}=?`).get(rowId) as { value: string; version: number }
    const update = db.prepare(`UPDATE ${table} SET ${column}=?, ${version}=? WHERE ${keyColumn}=?`)
    const assertFailure = async () => {
      const result = await client.request(url)
      assert.equal(result.response.status, 500, `${table}.${column}`)
      assert.equal(typeof result.data.error, 'string')
      assert.equal(JSON.stringify(result.data).includes('protected'), false)
      assert.equal(Object.hasOwn(result.data, 'stack'), false)
    }
    try {
      for (const field of ['nonce', 'tag', 'ciphertext']) {
        const changed = envelope(original.value)
        const bytes = Buffer.from(changed[field], 'base64'); bytes[0] ^= 1
        changed[field] = bytes.toString('base64')
        update.run('apc:' + JSON.stringify(changed), 1, rowId)
        await assertFailure()
      }
      update.run(original.value, 7, rowId)
      await assertFailure()
      update.run('unsealed protected plaintext', 1, rowId)
      await assertFailure()
    } finally { update.run(original.value, original.version, rowId) }
    assert.equal((await client.request(url)).response.status, 200)
  }
  assert.equal((await user.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks[0].original_content, 'tamper protected body')
})

test('T-03 backup guide: real sqlite3 readonly online snapshot includes committed WAL and restores using a separate fixture key', async t => {
  const { Client, startBackend } = await import('./helpers')
  const { mkdtempSync, writeFileSync, readFileSync, statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { randomBytes } = await import('node:crypto')
  const { spawnSync } = await import('node:child_process')
  const contentKey = randomBytes(32).toString('base64')
  const service = await startBackend({ CONTENT_ENCRYPTION_KEY: contentKey }); t.after(service.stop)
  const user = new Client(service), identity = (await user.identity()).data
  const body = 'T03_SQLITE_BACKUP_GUIDE_SYNTHETIC_BODY'
  const comment = 'T03_SQLITE_BACKUP_GUIDE_SYNTHETIC_COMMENT'
  const submitted = await user.post('/api/feedback', { category: 'report', deviceId: identity.deviceId, originalContent: body, encryptedContent: 'fixture-cipher' })
  assert.equal(submitted.response.status, 200)
  assert.equal((await user.post(`/api/feedback/${submitted.data.id}/comments`, { content: comment })).response.status, 200)
  assert.ok(statSync(service.databasePath + '-wal').size > 0, 'online source has uncheckpointed WAL')
  const backups = mkdtempSync(path.join(tmpdir(), 'anonyproof-T03 backup-'))
  const keys = mkdtempSync(path.join(tmpdir(), 'anonyproof-T03 independent-key-'))
  const backupPath = path.join(backups, 'data snapshot.db'), keyPath = path.join(keys, 'key.fixture')
  writeFileSync(keyPath, contentKey, { mode: 0o600 })
  assert.ok(!backupPath.includes("'") && !backupPath.includes('\n'))
  const snapshot = spawnSync('sqlite3', ['-readonly', service.databasePath, `.backup '${backupPath}'`], { encoding: 'utf8', timeout: 10000 })
  assert.equal(snapshot.status, 0, snapshot.stderr)
  const bytes = readFileSync(backupPath)
  for (const marker of [body, comment, contentKey, Buffer.from(contentKey, 'base64').toString('hex')]) assert.equal(bytes.includes(Buffer.from(marker)), false)
  const db = new Database(backupPath, { readonly: true })
  try {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedbacks').get() as { n: number }).n, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feedback_comments').get() as { n: number }).n, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n, 2)
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  } finally { db.close() }
  const restored = await startBackend({ DATABASE_PATH: backupPath, CONTENT_ENCRYPTION_KEY: readFileSync(keyPath, 'utf8') }); t.after(restored.stop)
  const recovered = new Client(restored)
  assert.equal((await recovered.post('/api/identity/recover', { recoveryCode: identity.recoveryCode })).response.status, 200)
  assert.equal((await recovered.request(`/api/feedback/device/${identity.deviceId}`)).data.feedbacks[0].original_content, body)
  assert.equal((await recovered.request(`/api/feedback/${submitted.data.id}/comments`)).data.comments[0].content, comment)
})
