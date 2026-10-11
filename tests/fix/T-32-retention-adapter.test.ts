// Synthetic-only acceptance. Never reads real assets, environment keys or SSH.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  mkdtempSync, realpathSync, openSync, closeSync, writeSync, readFileSync, writeFileSync,
  statSync, lstatSync, existsSync, readdirSync, copyFileSync, chmodSync, mkdirSync, symlinkSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type DatabaseType from 'better-sqlite3'
import { prepareRetainedVersion, restoreRetainedVersion, RETAINED_VERSION_FILES, RETAINED_RESTORE_FILES } from '../../scripts/content-retention-adapter'
import {
  PRIVATE_RETENTION_FORMAT, PrivateRetentionError, privateFileDigest,
  sealPrivateRetentionFile, restorePrivateRetentionFile, type RetentionArchiveKind,
} from '../../scripts/private-retention-archive'

const Database = createRequire(path.resolve(__dirname, '../../server/package.json'))('better-sqlite3') as typeof DatabaseType
const directory = () => mkdtempSync(path.join(realpathSync(tmpdir()), 'anonyproof-T32-retention-synthetic-'))
const key = () => randomBytes(32).toString('base64')
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
function privateFile(file: string, contents: string | Buffer) { writeFileSync(file, contents, { flag: 'wx', mode: 0o600 }) }
function quoted(name: string) { return '"' + name.replace(/"/g, '""') + '"' }

function allRows(db: DatabaseType.Database) {
  db.defaultSafeIntegers(true)
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").pluck().all() as string[]
  return names.map(name => ({ name, columns: db.prepare(`SELECT * FROM ${quoted(name)}`).columns().map(c => c.name),
    rows: db.prepare(`SELECT * FROM ${quoted(name)}`).raw(true).all() }))
}
function schema(db: DatabaseType.Database) { return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').raw(true).all() }

function fixture(folder: string, variant = 'current') {
  const sourcePath = path.join(folder, 'source.db')
  closeSync(openSync(sourcePath, 'wx', 0o600))
  const db = new Database(sourcePath)
  db.exec(`CREATE TABLE feedbacks (id TEXT PRIMARY KEY, device_id TEXT, original_content TEXT,
      solution TEXT, encrypted_content TEXT, is_demo_template INTEGER, is_demo_clone INTEGER);
    CREATE TABLE feedback_comments (id INTEGER PRIMARY KEY, feedback_id TEXT, commenter_type TEXT, content, attachment BLOB);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, feedback_id TEXT, recipient_type TEXT, recipient_id TEXT,
      type TEXT, title TEXT, content, is_read INTEGER);
    CREATE TABLE client_identities (device_id TEXT PRIMARY KEY, recovery_hash TEXT, token_hash TEXT, install_key_hash TEXT);
    CREATE TABLE instance_metadata (id INTEGER PRIMARY KEY, role TEXT, version INTEGER);
    CREATE TABLE request_idempotency (id INTEGER PRIMARY KEY, snapshot);
    CREATE TABLE access_logs (id INTEGER PRIMARY KEY, ip TEXT, user_agent TEXT);
    CREATE TABLE "strange""table" (k TEXT PRIMARY KEY, bytes BLOB, large_integer INTEGER, real_value REAL, null_value, empty_text TEXT, literal_null TEXT) WITHOUT ROWID;
    CREATE INDEX preserved_index ON feedback_comments(feedback_id);
    CREATE TRIGGER preserved_trigger BEFORE DELETE ON feedbacks BEGIN SELECT RAISE(ABORT, 'T32_SECRET_TRIGGER'); END;`)
  db.prepare('INSERT INTO feedbacks VALUES(?,?,?,?,?,?,?)').run('T32_PRIVATE_SAME_ID', 'T32_PRIVATE_DEVICE',
    `T32_SECRET_${variant}_BODY_中文🌲`, null, `T32_SECRET_LEGACY_PACKAGE_${variant}`, 1, 0)
  db.prepare('INSERT INTO feedbacks VALUES(?,?,?,?,?,?,?)').run('T32_PRIVATE_NULL_FLAGS', 'T32_PRIVATE_DEVICE', null, '', 'old-package', null, 1)
  const comment = db.prepare('INSERT INTO feedback_comments VALUES(?,?,?,?,?)')
  comment.run(1, 'T32_PRIVATE_SAME_ID', 'user', 'T32_SECRET_ATTACHED_COMMENT', Buffer.from([0, 1, 255]))
  comment.run(BigInt('9223372036854775807'), 'T32_PRIVATE_MISSING_PARENT', 'user', null, Buffer.from([255, 0, 128]))
  comment.run(3, null, 'admin', Buffer.from('T32_SECRET_BLOB_ORPHAN'), null)
  const notice = db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)')
  notice.run(1, 'T32_PRIVATE_SAME_ID', 'user', 'T32_PRIVATE_DEVICE', 'status_change', 'T32_SECRET_NOTICE_TITLE', null, 0)
  notice.run(2, 'T32_PRIVATE_MISSING_PARENT', 'admin', 'admin', 'new_feedback', 'T32_SECRET_ORPHAN_TITLE', 'T32_SECRET_ORPHAN_NOTICE', 1)
  notice.run(3, null, 'user', 'T32_PRIVATE_DEVICE', 'general', 'T32_SECRET_GENERAL_TITLE', null, 0)
  db.prepare('INSERT INTO client_identities VALUES(?,?,?,?)').run('T32_PRIVATE_DEVICE', 'T32_SECRET_RECOVERY_HASH', 'T32_SECRET_TOKEN_HASH', null)
  db.exec("INSERT INTO instance_metadata VALUES(1,'demo',1)")
  db.prepare('INSERT INTO request_idempotency VALUES(?,?)').run(1, Buffer.from('T32_SECRET_IDEMPOTENCY'))
  db.prepare('INSERT INTO access_logs VALUES(?,?,?)').run(1, '192.0.2.42', 'T32_SECRET_OLD_UA')
  db.prepare('INSERT INTO "strange""table" VALUES(?,?,?,?,?,?,?)').run('T32_PRIVATE_BLOB_ROW', Buffer.from([0, 255, 128, 0]),
    BigInt('-9223372036854775808'), 1.25, null, '', 'null')
  const rows = allRows(db), originalSchema = schema(db)
  db.close()
  return { sourcePath, rows, originalSchema }
}

async function restore(outputDirectory: string, folder: string, contentKey: string, versionBinding: string,
  name: string, kind: RetentionArchiveKind) {
  const destinationPath = path.join(folder, 'restored-' + name)
  const catalog = JSON.parse(readFileSync(path.join(outputDirectory, RETAINED_VERSION_FILES.catalog), 'utf8'))
  assert.equal(catalog.versionBinding, versionBinding)
  const result = await restorePrivateRetentionFile({ archivePath: path.join(outputDirectory, name),
    destinationPath, contentKey, versionBinding: catalog.packageBinding, kind })
  assert.deepEqual(result, { restored: true, authenticated: true, format: PRIVATE_RETENTION_FORMAT })
  return destinationPath
}

function assertPrivateTree(folder: string) {
  assert.equal(lstatSync(folder).mode & 0o777, 0o700)
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    assert.equal(entry.isSymbolicLink(), false)
    if (entry.isDirectory()) assertPrivateTree(file)
    else assert.equal(statSync(file).mode & 0o777, 0o600, entry.name)
  }
}

test('T-32 archive-only: exact schema/types/NULL/flags/identity/old packages survive independent authenticated restore', async () => {
  const folder = directory(), f = fixture(folder), contentKey = key(), sourceDigest = digest(f.sourcePath)
  const outputDirectory = path.join(folder, 'prepared'), versionBinding = 'synthetic-current'
  const report = await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding })
  assert.equal(report.archivePrepared, true); assert.equal(report.independentlyRestored, true)
  assert.equal(report.originalTypesPreserved, true); assert.equal(report.isolatedRowsArchived, true)
  for (const field of ['runtimeCandidatePrepared', 'roleAdopted', 'flagsModified', 'activated', 'sourceModified',
    'finalBusinessRetentionComplete', 'historicalPlaintextDisposalComplete'] as const) assert.equal(report[field], false)
  assert.equal(report.mode, 'archive-only')
  const output = JSON.stringify(report)
  for (const marker of ['T32_SECRET', 'T32_PRIVATE', folder, versionBinding, contentKey, sourceDigest, '192.0.2.42']) assert.equal(output.includes(marker), false)
  assert.deepEqual(JSON.parse(readFileSync(path.join(outputDirectory, RETAINED_VERSION_FILES.completion), 'utf8')), report)
  assert.equal(digest(f.sourcePath), sourceDigest)
  const restoredPath = await restore(outputDirectory, folder, contentKey, versionBinding, RETAINED_VERSION_FILES.snapshot, 'snapshot')
  assert.notEqual(statSync(restoredPath).ino, statSync(f.sourcePath).ino)
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true })
  try {
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.deepEqual(schema(db), f.originalSchema); assert.deepEqual(allRows(db), f.rows)
    assert.equal((db.prepare('SELECT role FROM instance_metadata').get() as { role: string }).role, 'demo')
  } finally { db.close() }
  const manifestPath = await restore(outputDirectory, folder, contentKey, versionBinding, RETAINED_VERSION_FILES.manifest, 'manifest')
  const manifest = readFileSync(manifestPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(manifest[0].fullSnapshotIsTransitional, true)
  assert.equal(manifest[0].finalTelemetryDisposalPending, true)
  assert.equal(manifest[0].sourceFlagsPreserved, true); assert.equal(manifest[0].roleAdopted, false)
  assert.equal(manifest.some(line => line.entry === 'original-mapping' && line.table === 'feedbacks' && line.values.some((v: { type: string }) => v.type === 'null')), true)
  assert.equal(manifest.some(line => line.entry === 'original-mapping' && line.table === 'client_identities'), true)
  for (const name of [RETAINED_VERSION_FILES.snapshot, RETAINED_VERSION_FILES.isolatedRows, RETAINED_VERSION_FILES.manifest]) {
    const bytes = readFileSync(path.join(outputDirectory, name))
    for (const marker of ['T32_SECRET', 'T32_PRIVATE', contentKey, sourceDigest]) assert.equal(bytes.includes(Buffer.from(marker)), false)
    assert.equal(bytes.includes(Buffer.from(contentKey, 'base64')), false)
  }
  assertPrivateTree(folder)
})

test('T-32 archive-only: isolated typed rows distinguish missing parents, NULL target comments and general notifications', async () => {
  const folder = directory(), f = fixture(folder), contentKey = key(), outputDirectory = path.join(folder, 'prepared'), versionBinding = 'synthetic-isolation'
  await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding })
  const file = await restore(outputDirectory, folder, contentKey, versionBinding, RETAINED_VERSION_FILES.isolatedRows, 'isolated-rows')
  const [header, ...rows] = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(header.format, 'AnonyProof/typed-isolated-rows/1')
  assert.deepEqual(rows.map(row => row.category).sort(), ['missing-parent-comment', 'missing-parent-notification', 'no-target-comment', 'no-target-notification'])
  const comment = rows.find(row => row.category === 'missing-parent-comment')
  assert.deepEqual(comment.values[comment.columns.indexOf('id')], { type: 'integer', value: '9223372036854775807' })
  assert.deepEqual(comment.values[comment.columns.indexOf('content')], { type: 'null' })
  assert.deepEqual(comment.values[comment.columns.indexOf('attachment')], { type: 'blob', value: Buffer.from([255, 0, 128]).toString('base64') })
  const noTarget = rows.find(row => row.category === 'no-target-notification')
  assert.deepEqual(noTarget.values[noTarget.columns.indexOf('feedback_id')], { type: 'null' })
  assert.deepEqual(noTarget.values[noTarget.columns.indexOf('content')], { type: 'null' })
  const db = new Database(f.sourcePath, { readonly: true }); assert.deepEqual(allRows(db), f.rows); db.close()
})

test('T-32 archive-only: three versions with the same IDs retain different bodies without merging; version substitution fails', async () => {
  const contentKey = key(), prepared: { folder: string; output: string; binding: string }[] = []
  for (const variant of ['current', 'backup-a', 'backup-b']) {
    const folder = directory(), f = fixture(folder, variant), output = path.join(folder, 'prepared'), binding = 'synthetic-' + variant
    await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory: output, contentKey, versionBinding: binding })
    const restoredPath = await restore(output, folder, contentKey, binding, RETAINED_VERSION_FILES.snapshot, 'snapshot')
    const db = new Database(restoredPath, { readonly: true })
    assert.equal((db.prepare('SELECT original_content FROM feedbacks WHERE id=?').get('T32_PRIVATE_SAME_ID') as { original_content: string }).original_content, `T32_SECRET_${variant}_BODY_中文🌲`)
    assert.deepEqual(allRows(db), f.rows); db.close()
    const catalog = JSON.parse(readFileSync(path.join(output, RETAINED_VERSION_FILES.catalog), 'utf8'))
    prepared.push({ folder, output, binding: catalog.packageBinding })
  }
  const wrongDestination = path.join(prepared[1].folder, 'cross-version.db')
  await assert.rejects(restorePrivateRetentionFile({ archivePath: path.join(prepared[0].output, RETAINED_VERSION_FILES.snapshot),
    destinationPath: wrongDestination, contentKey, versionBinding: prepared[1].binding, kind: 'snapshot' }), /ARCHIVE_AUTHENTICATION_OR_IO_FAILED/)
  assert.equal(existsSync(wrongDestination), false)
})

test('T-32 archive-only: wrong key, tag/cipher/header corruption, truncation and kind swap never publish unauthenticated plaintext', async t => {
  const folder = directory(), plaintextPath = path.join(folder, 'source.private'), archivePath = path.join(folder, 'valid.apra'), contentKey = key()
  privateFile(plaintextPath, 'T32_SECRET_AUTHENTICATED_PAYLOAD'.repeat(6000))
  await sealPrivateRetentionFile({ plaintextPath, archivePath, contentKey, versionBinding: 'synthetic-auth', kind: 'manifest' })
  const original = readFileSync(archivePath), before = digest(plaintextPath)
  for (const scenario of ['wrong-key', 'wrong-kind', 'cipher', 'tag', 'header', 'truncate']) await t.test(scenario, async () => {
    const testArchive = path.join(folder, scenario + '.apra'), destinationPath = path.join(folder, scenario + '.private')
    const bytes = Buffer.from(original)
    if (scenario === 'cipher') bytes[25] ^= 1
    if (scenario === 'tag') bytes[bytes.length - 1] ^= 1
    if (scenario === 'header') bytes[0] ^= 1
    privateFile(testArchive, scenario === 'truncate' ? bytes.subarray(0, bytes.length - 1) : bytes)
    let thrown: unknown
    try { await restorePrivateRetentionFile({ archivePath: testArchive, destinationPath,
      contentKey: scenario === 'wrong-key' ? key() : contentKey, versionBinding: 'synthetic-auth',
      kind: scenario === 'wrong-kind' ? 'snapshot' : 'manifest' }) } catch (error) { thrown = error }
    assert.ok(thrown instanceof PrivateRetentionError)
    for (const marker of ['T32_SECRET', folder, contentKey]) assert.equal(String(thrown).includes(marker), false)
    assert.equal(existsSync(destinationPath), false)
    assert.equal(digest(plaintextPath), before)
  })
  assert.equal(digest(archivePath), createHash('sha256').update(original).digest('hex'))
  assertPrivateTree(folder)
})

test('T-32 archive-only: empty and multi-chunk large files authenticate and round trip with private independent files', async () => {
  const folder = directory(), contentKey = key()
  for (const size of [0, 12 * 1024 * 1024]) {
    const plaintextPath = path.join(folder, `source-${size}.private`), archivePath = path.join(folder, `sealed-${size}.apra`), destinationPath = path.join(folder, `restored-${size}.private`)
    const fd = openSync(plaintextPath, 'wx', 0o600), chunk = Buffer.alloc(64 * 1024, 0x37)
    for (let written = 0; written < size; written += chunk.length) writeSync(fd, chunk)
    closeSync(fd)
    await sealPrivateRetentionFile({ plaintextPath, archivePath, contentKey, versionBinding: 'synthetic-stream', kind: 'snapshot' })
    await restorePrivateRetentionFile({ archivePath, destinationPath, contentKey, versionBinding: 'synthetic-stream', kind: 'snapshot' })
    assert.equal(statSync(destinationPath).size, size)
    assert.equal(await privateFileDigest(destinationPath), await privateFileDigest(plaintextPath))
    assert.notEqual(statSync(destinationPath).ino, statSync(plaintextPath).ino)
    if (!size) {
      const noAuthentication = path.join(folder, 'empty-wrong-key.private')
      await assert.rejects(restorePrivateRetentionFile({ archivePath, destinationPath: noAuthentication, contentKey: key(), versionBinding: 'synthetic-stream', kind: 'snapshot' }), /ARCHIVE_AUTHENTICATION_OR_IO_FAILED/)
      assert.equal(existsSync(noAuthentication), false)
    }
  }
})

test('T-32 archive-only: exclusive outputs and racing restore targets never replace existing files', async () => {
  const folder = directory(), f = fixture(folder), contentKey = key(), outputDirectory = path.join(folder, 'prepared'), versionBinding = 'synthetic-exclusive'
  await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding })
  const before = digest(path.join(outputDirectory, RETAINED_VERSION_FILES.completion))
  await assert.rejects(prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding }), /DESTINATION_EXISTS/)
  assert.equal(digest(path.join(outputDirectory, RETAINED_VERSION_FILES.completion)), before)
  const archivePath = path.join(outputDirectory, RETAINED_VERSION_FILES.snapshot), existing = path.join(folder, 'existing.private')
  const catalog = JSON.parse(readFileSync(path.join(outputDirectory, RETAINED_VERSION_FILES.catalog), 'utf8'))
  privateFile(existing, 'T32_PRIVATE_EXISTING_FILE')
  await assert.rejects(restorePrivateRetentionFile({ archivePath, destinationPath: existing, contentKey, versionBinding: catalog.packageBinding, kind: 'snapshot' }), /DESTINATION_EXISTS/)
  assert.equal(readFileSync(existing, 'utf8'), 'T32_PRIVATE_EXISTING_FILE')
  const racing = path.join(folder, 'racing.private')
  const pending = restorePrivateRetentionFile({ archivePath, destinationPath: racing, contentKey, versionBinding: catalog.packageBinding, kind: 'snapshot' })
  privateFile(racing, 'T32_PRIVATE_RACING_FILE')
  await assert.rejects(pending, /ARCHIVE_AUTHENTICATION_OR_IO_FAILED/)
  assert.equal(readFileSync(racing, 'utf8'), 'T32_PRIVATE_RACING_FILE')
  await assert.rejects(sealPrivateRetentionFile({ plaintextPath: f.sourcePath, archivePath, contentKey, versionBinding, kind: 'snapshot' }), /DESTINATION_EXISTS/)
})

function copyRecoveryPackage(source: string, destination: string) {
  mkdirSync(destination, { mode: 0o700 })
  for (const name of [RETAINED_VERSION_FILES.snapshot, RETAINED_VERSION_FILES.isolatedRows, RETAINED_VERSION_FILES.manifest, RETAINED_VERSION_FILES.catalog]) {
    copyFileSync(path.join(source, name), path.join(destination, name))
    chmodSync(path.join(destination, name), 0o600)
  }
}

test('T-32 package restore: a new process restores using only separately copied key, catalog and three archives', async () => {
  const original = directory(), f = fixture(original), contentKey = key(), before = digest(f.sourcePath)
  const prepared = path.join(original, 'prepared'), versionBinding = 'synthetic-process-independent'
  const report = await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory: prepared, contentKey, versionBinding })
  assert.equal(report.recoveryCatalogRequired, true)
  const backup = directory(), archives = path.join(backup, 'independent-archives')
  copyRecoveryPackage(prepared, archives)
  const keyFolder = directory(), keyPath = path.join(keyFolder, 'synthetic-content-key.private')
  privateFile(keyPath, contentKey)
  const catalogPath = path.join(archives, RETAINED_VERSION_FILES.catalog), catalogBytes = readFileSync(catalogPath, 'utf8')
  assert.equal(catalogBytes.includes(contentKey), false); assert.equal(catalogBytes.includes(original), false)
  assert.notEqual(statSync(path.join(prepared, RETAINED_VERSION_FILES.catalog)).ino, statSync(catalogPath).ino)
  for (const name of [RETAINED_VERSION_FILES.snapshot, RETAINED_VERSION_FILES.isolatedRows, RETAINED_VERSION_FILES.manifest]) {
    assert.notEqual(statSync(path.join(prepared, name)).ino, statSync(path.join(archives, name)).ino)
  }
  const destinationDirectory = path.join(backup, 'restored-in-new-process'), root = path.resolve(__dirname, '../..')
  const script = `const fs=require('node:fs');const {restoreRetainedVersion}=require('./scripts/content-retention-adapter');
    (async()=>{const p=JSON.parse(fs.readFileSync(0,'utf8'));const key=fs.readFileSync(p.keyPath,'utf8');
    const r=await restoreRetainedVersion({archiveDirectory:p.archives,catalogPath:p.catalogPath,destinationDirectory:p.destinationDirectory,contentKey:key});
    process.stdout.write(JSON.stringify(r));})().catch(e=>{process.stderr.write(e.message);process.exitCode=1;});`
  const child = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '-e', script], {
    cwd: root, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 20000,
    input: JSON.stringify({ keyPath, archives, catalogPath, destinationDirectory }),
  })
  assert.equal(child.status, 0, child.stderr)
  const restoredReport = JSON.parse(child.stdout)
  assert.equal(restoredReport.packageAuthenticated, true); assert.equal(restoredReport.relationshipsVerified, true)
  assert.equal(restoredReport.integrityVerified, true); assert.equal(restoredReport.runtimeCandidatePrepared, false)
  for (const marker of [original, backup, contentKey, versionBinding, 'T32_PRIVATE', 'T32_SECRET']) assert.equal(child.stdout.includes(marker), false)
  assert.deepEqual(JSON.parse(readFileSync(path.join(destinationDirectory, RETAINED_RESTORE_FILES.completion), 'utf8')), restoredReport)
  const db = new Database(path.join(destinationDirectory, RETAINED_RESTORE_FILES.snapshot), { readonly: true, fileMustExist: true })
  assert.deepEqual(schema(db), f.originalSchema); assert.deepEqual(allRows(db), f.rows); db.close()
  assert.equal(digest(f.sourcePath), before)
  assertPrivateTree(backup); assertPrivateTree(keyFolder)
})

test('T-32 package restore: every preparation gets a unique package binding and valid cross-package substitutions fail', async t => {
  const first = directory(), a = fixture(first, 'one'), second = directory(), b = fixture(second, 'two'), contentKey = key()
  const firstOutput = path.join(first, 'prepared'), secondOutput = path.join(second, 'prepared'), versionBinding = 'same-logical-source'
  await prepareRetainedVersion({ sourcePath: a.sourcePath, outputDirectory: firstOutput, contentKey, versionBinding })
  await prepareRetainedVersion({ sourcePath: b.sourcePath, outputDirectory: secondOutput, contentKey, versionBinding })
  const catalogA = JSON.parse(readFileSync(path.join(firstOutput, RETAINED_VERSION_FILES.catalog), 'utf8'))
  const catalogB = JSON.parse(readFileSync(path.join(secondOutput, RETAINED_VERSION_FILES.catalog), 'utf8'))
  assert.equal(catalogA.versionBinding, catalogB.versionBinding)
  assert.notEqual(catalogA.packageBinding, catalogB.packageBinding)
  assert.match(catalogA.packageBinding, /^[a-f0-9]{48}$/)
  for (const scenario of ['snapshot', 'isolatedRows', 'manifest', 'catalog', 'logical-mapping', 'catalog-extra-path', 'catalog-missing']) await t.test(scenario, async () => {
    const folder = directory(), archives = path.join(folder, 'archives'), destinationDirectory = path.join(folder, 'restored')
    copyRecoveryPackage(firstOutput, archives)
    let catalogPath = path.join(archives, RETAINED_VERSION_FILES.catalog)
    if (['snapshot', 'isolatedRows', 'manifest', 'catalog'].includes(scenario)) {
      const name = RETAINED_VERSION_FILES[scenario as 'snapshot' | 'isolatedRows' | 'manifest' | 'catalog']
      copyFileSync(path.join(secondOutput, name), path.join(archives, name))
    } else if (scenario === 'logical-mapping') {
      writeFileSync(catalogPath, JSON.stringify({ ...catalogA, versionBinding: 'different-logical-source' }))
    } else if (scenario === 'catalog-extra-path') {
      writeFileSync(catalogPath, JSON.stringify({ ...catalogA, archivePath: '../source.db' }))
    } else catalogPath = path.join(archives, 'does-not-exist.private')
    await assert.rejects(restoreRetainedVersion({ archiveDirectory: archives, catalogPath, destinationDirectory, contentKey }), PrivateRetentionError)
    assert.equal(existsSync(path.join(destinationDirectory, RETAINED_RESTORE_FILES.completion)), false)
    for (const name of [RETAINED_RESTORE_FILES.snapshot, RETAINED_RESTORE_FILES.isolatedRows, RETAINED_RESTORE_FILES.manifest]) assert.equal(existsSync(path.join(destinationDirectory, name)), false)
    assertPrivateTree(folder)
  })
})

test('T-32 package restore: authenticated manifest digest/schema relationships are checked before any success publication', async t => {
  const original = directory(), f = fixture(original), contentKey = key(), prepared = path.join(original, 'prepared')
  await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory: prepared, contentKey, versionBinding: 'synthetic-manifest-relations' })
  const catalog = JSON.parse(readFileSync(path.join(prepared, RETAINED_VERSION_FILES.catalog), 'utf8'))
  for (const field of ['snapshotDigest', 'isolatedRowsDigest', 'schemaDigest']) await t.test(field, async () => {
    const folder = directory(), archives = path.join(folder, 'archives'), destinationDirectory = path.join(folder, 'restored')
    copyRecoveryPackage(prepared, archives)
    const manifestPlain = path.join(folder, 'manifest.private')
    await restorePrivateRetentionFile({ archivePath: path.join(prepared, RETAINED_VERSION_FILES.manifest),
      destinationPath: manifestPlain, contentKey, versionBinding: catalog.packageBinding, kind: 'manifest' })
    const lines = readFileSync(manifestPlain, 'utf8').trimEnd().split('\n'), header = JSON.parse(lines[0])
    header[field] = '0'.repeat(64); lines[0] = JSON.stringify(header)
    writeFileSync(manifestPlain, lines.join('\n') + '\n')
    const changedArchive = path.join(folder, 'changed-manifest.apra')
    await sealPrivateRetentionFile({ plaintextPath: manifestPlain, archivePath: changedArchive,
      contentKey, versionBinding: catalog.packageBinding, kind: 'manifest' })
    copyFileSync(changedArchive, path.join(archives, RETAINED_VERSION_FILES.manifest))
    await assert.rejects(restoreRetainedVersion({ archiveDirectory: archives,
      catalogPath: path.join(archives, RETAINED_VERSION_FILES.catalog), destinationDirectory, contentKey }), /ARCHIVE_PACKAGE_MISMATCH/)
    assert.equal(existsSync(path.join(destinationDirectory, RETAINED_RESTORE_FILES.completion)), false)
    assert.equal(existsSync(path.join(destinationDirectory, RETAINED_RESTORE_FILES.snapshot)), false)
  })
})

test('T-32 package restore: a publication race leaves authenticated partial files but no successful completion marker', async () => {
  const folder = directory(), f = fixture(folder), contentKey = key(), prepared = path.join(folder, 'prepared')
  await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory: prepared, contentKey, versionBinding: 'synthetic-publication-race' })
  const destinationDirectory = path.join(folder, 'restored')
  const pending = restoreRetainedVersion({ archiveDirectory: prepared,
    catalogPath: path.join(prepared, RETAINED_VERSION_FILES.catalog), destinationDirectory, contentKey })
  const racing = path.join(destinationDirectory, RETAINED_RESTORE_FILES.isolatedRows)
  privateFile(racing, 'T32_PRIVATE_PREEXISTING_RACING_TARGET')
  await assert.rejects(pending, /RETENTION_RESTORE_OR_IO_FAILED/)
  assert.equal(readFileSync(racing, 'utf8'), 'T32_PRIVATE_PREEXISTING_RACING_TARGET')
  assert.equal(existsSync(path.join(destinationDirectory, RETAINED_RESTORE_FILES.completion)), false)
  // The first publication link succeeded before the second encountered EEXIST.
  // Its plaintext is authenticated, but this directory is not a complete restore.
  const db = new Database(path.join(destinationDirectory, RETAINED_RESTORE_FILES.snapshot), { readonly: true, fileMustExist: true })
  assert.deepEqual(allRows(db), f.rows); db.close()
  await assert.rejects(restoreRetainedVersion({ archiveDirectory: prepared,
    catalogPath: path.join(prepared, RETAINED_VERSION_FILES.catalog), destinationDirectory, contentKey }), /DESTINATION_EXISTS/)
  assertPrivateTree(folder)
})

test('T-32 archive-only: unapproved runtime mode, invalid keys/bindings, broad permissions and symlink paths fail before publication', async t => {
  for (const scenario of ['runtime', 'key', 'binding', 'source-mode', 'parent-mode', 'source-symlink', 'parent-symlink']) await t.test(scenario, async () => {
    const folder = directory(), f = fixture(folder), outputDirectory = path.join(folder, 'prepared'), contentKey = key()
    let sourcePath = f.sourcePath, output = outputDirectory
    if (scenario === 'source-mode') chmodSync(f.sourcePath, 0o644)
    if (scenario === 'parent-mode') chmodSync(folder, 0o755)
    if (scenario === 'source-symlink') { sourcePath = path.join(folder, 'link.db'); symlinkSync(f.sourcePath, sourcePath) }
    if (scenario === 'parent-symlink') {
      const privateParent = path.join(folder, 'private-parent'); mkdirSync(privateParent, { mode: 0o700 })
      const link = path.join(folder, 'parent-link'); symlinkSync(privateParent, link)
      output = path.join(link, 'prepared')
    }
    const before = digest(f.sourcePath)
    await assert.rejects(prepareRetainedVersion({ sourcePath, outputDirectory: output,
      contentKey: scenario === 'key' ? '' : contentKey, versionBinding: scenario === 'binding' ? '../private' : 'synthetic-guard',
      ...(scenario === 'runtime' ? { mode: 'runtime-projection' as 'archive-only' } : {}) }), PrivateRetentionError)
    assert.equal(existsSync(output), false); assert.equal(digest(f.sourcePath), before)
  })
})

test('T-32 archive-only: committed WAL snapshot survives unchanged writer and contains original role/flags', async () => {
  const folder = directory(), f = fixture(folder), contentKey = key(), outputDirectory = path.join(folder, 'prepared'), versionBinding = 'synthetic-wal'
  const writer = new Database(f.sourcePath); writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0')
  writer.prepare('UPDATE feedbacks SET original_content=? WHERE id=?').run('T32_SECRET_COMMITTED_WAL', 'T32_PRIVATE_SAME_ID')
  const rows = allRows(writer), before = digest(f.sourcePath), walBefore = digest(f.sourcePath + '-wal')
  assert.ok(statSync(f.sourcePath + '-wal').size > 0)
  try {
    await prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding })
    assert.equal(digest(f.sourcePath), before); assert.equal(digest(f.sourcePath + '-wal'), walBefore)
    assert.deepEqual(allRows(writer), rows)
    const restoredPath = await restore(outputDirectory, folder, contentKey, versionBinding, RETAINED_VERSION_FILES.snapshot, 'snapshot')
    const restored = new Database(restoredPath, { readonly: true })
    assert.deepEqual(allRows(restored), rows); restored.close()
  } finally { writer.close() }
})

test('T-32 archive-only: giant metadata rows and unsupported relationship schema fail without a completion marker or source changes', async t => {
  for (const scenario of ['large-row', 'schema']) await t.test(scenario, async () => {
    const folder = directory(), f = fixture(folder), contentKey = key(), outputDirectory = path.join(folder, 'prepared')
    const db = new Database(f.sourcePath)
    if (scenario === 'large-row') db.prepare('UPDATE "strange""table" SET bytes=?').run(Buffer.alloc(9 * 1024 * 1024))
    else db.exec('ALTER TABLE feedback_comments RENAME COLUMN feedback_id TO unknown_parent')
    db.close(); const before = digest(f.sourcePath)
    await assert.rejects(prepareRetainedVersion({ sourcePath: f.sourcePath, outputDirectory, contentKey, versionBinding: 'synthetic-bounds' }),
      new RegExp(scenario === 'large-row' ? 'TYPED_ROW_PREVIEW_LIMIT' : 'UNSUPPORTED_RELATIONSHIP_SCHEMA'))
    assert.equal(existsSync(path.join(outputDirectory, RETAINED_VERSION_FILES.completion)), false)
    assert.equal(digest(f.sourcePath), before)
    assertPrivateTree(folder)
  })
})
