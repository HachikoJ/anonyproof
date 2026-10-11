// Partial T-32 acceptance: read-only inventory preparation only. Historical
// candidate conversion/authentication is covered separately in T-32-candidate;
// real retention mapping, activation and old-asset disposal remain pending.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { inventoryContentMigration } from '../../scripts/content-migration-inventory'
const root = path.resolve(__dirname, '../..')
const Database = createRequire(root + '/server/package.json')('better-sqlite3')
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const dir = () => mkdtempSync(path.join(tmpdir(), 'anonyproof-T32-inventory-'))

function legacy(file: string) {
  const db = new Database(file)
  db.exec(`CREATE TABLE feedbacks (id TEXT, device_id TEXT, original_content TEXT, solution TEXT, is_demo_template INTEGER, is_demo_clone INTEGER);
    CREATE TABLE feedback_comments (feedback_id TEXT, content TEXT);
    CREATE TABLE notifications (feedback_id TEXT, title TEXT, content TEXT);
    CREATE TABLE client_identities (device_id TEXT, recovery_hash TEXT);`)
  db.prepare('INSERT INTO feedbacks VALUES (?, ?, ?, ?, ?, ?)').run('T32_PRIVATE_ID', 'T32_PRIVATE_DEVICE', 'T32_SECRET_BODY', '', 0, 0)
  db.prepare('INSERT INTO feedbacks VALUES (?, ?, ?, ?, ?, ?)').run('T32_PRIVATE_DEMO_ID', 'T32_PRIVATE_DEVICE', 'T32_SECRET_DEMO', null, 1, 0)
  db.prepare('INSERT INTO feedback_comments VALUES (?, ?)').run('T32_PRIVATE_ID', 'T32_SECRET_COMMENT')
  db.prepare('INSERT INTO feedback_comments VALUES (?, ?)').run('T32_ORPHAN_ID', 'T32_SECRET_ORPHAN')
  db.prepare('INSERT INTO feedback_comments VALUES (?, ?)').run(null, 'T32_SECRET_NO_PARENT')
  db.prepare('INSERT INTO notifications VALUES (?, ?, ?)').run('T32_ORPHAN_ID', 'T32_SECRET_TITLE', 'T32_SECRET_NOTICE')
  db.prepare('INSERT INTO notifications VALUES (?, ?, ?)').run(null, 'T32_SECRET_GENERAL', 'T32_SECRET_GENERAL')
  db.prepare('INSERT INTO client_identities VALUES (?, ?)').run('T32_PRIVATE_DEVICE', 'T32_SECRET_RECOVERY_HASH')
  db.close()
}

test('T-32 inventory: legacy version columns absent, orphan/scopes reported without contents or source writes', () => {
  const file = path.join(dir(), 'legacy.db'); legacy(file); const before = digest(file)
  const report = inventoryContentMigration(file)
  assert.equal(report.readOnly, true); assert.equal(report.migrationPerformed, false)
  assert.deepEqual(report.recordCounts, { feedbacks: 2, feedback_comments: 3, notifications: 2, client_identities: 1 })
  assert.deepEqual(report.feedbackScopeCounts, { formal: 1, templates: 1, clones: 0, unknown: 0 })
  assert.deepEqual(report.orphanCounts, { comments: 1, commentsWithoutTarget: 1, notifications: 1, notificationsWithoutTarget: 1 })
  assert.deepEqual(report.schemaGaps, [])
  assert.ok(report.storage.every(row => row.legacyRows === (row.table === 'feedback_comments' ? 3 : 2) && row.markedVersion1Rows === 0 && !row.versionColumnPresent))
  assert.equal(report.storage.find(row => row.fields[0] === 'solution')?.nullContentRows, 1)
  const output = JSON.stringify(report)
  assert.equal(output.includes('T32_SECRET'), false); assert.equal(output.includes('T32_PRIVATE'), false)
  assert.equal(digest(file), before)
  assert.deepEqual(inventoryContentMigration(file), report)
  assert.equal(digest(file), before)
})

test('T-32 inventory: marked v1, unknown storage flags and missing schema stay distinct; no encryption claim', () => {
  const file = path.join(dir(), 'mixed.db'); legacy(file)
  const db = new Database(file)
  db.exec('ALTER TABLE feedbacks ADD COLUMN original_content_storage_version INTEGER; ALTER TABLE feedbacks ADD COLUMN solution_storage_version INTEGER; ALTER TABLE feedback_comments ADD COLUMN content_storage_version INTEGER; ALTER TABLE notifications ADD COLUMN content_storage_version INTEGER;')
  db.exec('UPDATE feedbacks SET original_content_storage_version = 1, solution_storage_version = 0; UPDATE feedback_comments SET content_storage_version = 7; UPDATE notifications SET content_storage_version = NULL;')
  db.close()
  const before = digest(file), report = inventoryContentMigration(file)
  assert.equal(report.storage[0].markedVersion1Rows, 2)
  assert.equal(report.storage[1].legacyRows, 2)
  assert.equal(report.storage[2].unknownVersionRows, 3)
  assert.equal(report.storage[3].unknownVersionRows, 2)
  assert.ok(report.caveats[0].includes('do not prove'))
  assert.equal(digest(file), before)
  const emptyFile = path.join(dir(), 'empty.db'), empty = new Database(emptyFile); empty.close()
  assert.deepEqual(inventoryContentMigration(emptyFile).schemaGaps, ['feedbacks', 'feedback_comments', 'notifications'])
})

test('T-32 inventory CLI: explicit source only, unavailable sources fail without creating a DB; redacted JSON is usable', () => {
  const folder = dir(), file = path.join(folder, 'legacy.db'); legacy(file); const before = digest(file)
  const command = (args: string[]) => spawnSync('npx', ['--no-install', 'tsx', 'scripts/content-migration-inventory.ts', ...args], { cwd: root, encoding: 'utf8', timeout: 10000 })
  const valid = command([file]); assert.equal(valid.status, 0, valid.stderr)
  assert.deepEqual(JSON.parse(valid.stdout), inventoryContentMigration(file))
  assert.equal(valid.stdout.includes('T32_SECRET'), false); assert.equal(digest(file), before)
  const missing = path.join(folder, 'does-not-exist.db')
  assert.notEqual(command([missing]).status, 0); assert.equal(existsSync(missing), false)
  assert.equal(command([]).status, 2)
  assert.equal(command([file, 'extra-argument']).status, 2)
})
