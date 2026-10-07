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
