// T-32 archive-only preparation. Never reads an environment key, adopts a role,
// changes flags/rows, starts a service, activates a DB, or deletes an asset.
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { constants, mkdirSync, mkdtempSync, openSync, closeSync, writeSync, fsyncSync, lstatSync, linkSync, createReadStream, readFileSync } from 'node:fs'
import type DatabaseType from 'better-sqlite3'
import {
  PRIVATE_RETENTION_FORMAT, PrivateRetentionError, assertPrivateDirectory, assertPrivateFile,
  assertRetentionArchiveParameters, privateFileDigest, sealPrivateRetentionFile, restorePrivateRetentionFile,
} from './private-retention-archive'

const Database = createRequire(path.resolve(__dirname, '../server/package.json'))('better-sqlite3') as typeof DatabaseType
export const RETAINED_VERSION_FILES = Object.freeze({
  snapshot: 'snapshot.apra', isolatedRows: 'isolated-rows.apra', manifest: 'manifest.apra',
  catalog: 'recovery-catalog.private.json', completion: 'archive-only-complete.json',
})
export const RETAINED_RESTORE_FILES = Object.freeze({
  snapshot: 'snapshot.db', isolatedRows: 'isolated-rows.private', manifest: 'manifest.private',
  completion: 'restore-only-complete.json',
})
const CATALOG_FORMAT = 'AnonyProof/private-retention-catalog/1'
const MANIFEST_FORMAT = 'AnonyProof/private-retention-manifest/1'
type RecoveryCatalog = {
  format: typeof CATALOG_FORMAT; archiveFormat: typeof PRIVATE_RETENTION_FORMAT;
  packageBinding: string; versionBinding: string;
}
type SqlValue = null | string | bigint | number | Buffer
type TypedValue = { type: 'null' } | { type: 'integer' | 'real' | 'text' | 'blob'; value: string }
function fail(code: string): never { throw new PrivateRetentionError(code) }
function quote(identifier: string) { return '"' + identifier.replace(/"/g, '""') + '"' }
const MAX_TYPED_ROW_BYTES = 8 * 1024 * 1024

function assertBoundedTypedRows(db: DatabaseType.Database) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all() as string[]
  for (const table of tables) {
    const columns = db.prepare(`SELECT * FROM ${quote(table)} LIMIT 0`).columns().map(column => column.name)
    if (!columns.length || columns.length > 256) fail('UNSUPPORTED_MANIFEST_SCHEMA')
    const bytes = columns.map(column => `CASE typeof(${quote(column)}) WHEN 'text' THEN length(CAST(${quote(column)} AS BLOB)) WHEN 'blob' THEN length(${quote(column)}) ELSE 16 END`).join('+')
    if (db.prepare(`SELECT 1 FROM ${quote(table)} WHERE (${bytes}) > ? LIMIT 1`).get(MAX_TYPED_ROW_BYTES)) fail('TYPED_ROW_PREVIEW_LIMIT')
  }
}

function typed(value: SqlValue): TypedValue {
  if (value === null) return { type: 'null' }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() }
  if (typeof value === 'number') return { type: 'real', value: Object.is(value, -0) ? '-0' : String(value) }
  if (typeof value === 'string') return { type: 'text', value }
  if (Buffer.isBuffer(value)) return { type: 'blob', value: value.toString('base64') }
  fail('UNSUPPORTED_SQLITE_VALUE')
}

async function writePrivateLines(file: string, produce: (write: (value: unknown) => Promise<void>) => Promise<void>) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    await produce(async value => {
      const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8')
      let offset = 0
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
      await new Promise<void>(resolve => setImmediate(resolve))
    })
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function schemaDigest(db: DatabaseType.Database) {
  const hash = createHash('sha256')
  for (const row of db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').raw(true).iterate() as Iterable<SqlValue[]>) {
    hash.update(JSON.stringify(row.map(typed)) + '\n', 'utf8')
  }
  return hash.digest('hex')
}

function reservePrivateOutput(directory: string) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) fail('EXPLICIT_CANONICAL_PATH_REQUIRED')
  assertPrivateDirectory(path.dirname(directory))
  try { lstatSync(directory); fail('DESTINATION_EXISTS') } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('DESTINATION_UNAVAILABLE')
  }
  mkdirSync(directory, { mode: 0o700 })
  assertPrivateDirectory(directory)
}

function publishPreparedFiles(directory: string, files: { staged: string; name: string }[], stagedCompletion: string, completionName: string) {
  for (const file of files) linkSync(file.staged, path.join(directory, file.name))
  const fd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(fd)
    linkSync(stagedCompletion, path.join(directory, completionName))
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

function readCatalog(file: string): RecoveryCatalog {
  assertPrivateFile(file)
  if (lstatSync(file).size > 8192) fail('INVALID_RECOVERY_CATALOG')
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) } catch { fail('INVALID_RECOVERY_CATALOG') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RECOVERY_CATALOG')
  const catalog = value as Record<string, unknown>
  if (Object.keys(catalog).sort().join(',') !== 'archiveFormat,format,packageBinding,versionBinding' ||
      catalog.format !== CATALOG_FORMAT || catalog.archiveFormat !== PRIVATE_RETENTION_FORMAT ||
      typeof catalog.packageBinding !== 'string' || !/^[a-f0-9]{48}$/.test(catalog.packageBinding) ||
      typeof catalog.versionBinding !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(catalog.versionBinding)) fail('INVALID_RECOVERY_CATALOG')
  return catalog as RecoveryCatalog
}

async function readManifestHeader(file: string) {
  assertPrivateFile(file)
  let buffer = Buffer.alloc(0)
  const stream = createReadStream(file, { fd: openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW),
    autoClose: true, highWaterMark: 16384 })
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    const newline = buffer.indexOf(10)
    if (newline >= 0) {
      if (newline > 16384) fail('INVALID_AUTHENTICATED_MANIFEST')
      let value: unknown
      try { value = JSON.parse(buffer.subarray(0, newline).toString('utf8')) } catch { fail('INVALID_AUTHENTICATED_MANIFEST') }
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_AUTHENTICATED_MANIFEST')
      return value as Record<string, unknown>
    }
    if (buffer.length > 16384) fail('INVALID_AUTHENTICATED_MANIFEST')
  }
  fail('INVALID_AUTHENTICATED_MANIFEST')
}

function relationSchema(db: DatabaseType.Database) {
  for (const [table, required] of [
    ['feedbacks', ['id']], ['feedback_comments', ['feedback_id']], ['notifications', ['feedback_id']],
  ] as const) {
    const columns = new Set((db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(row => row.name))
    if (required.some(column => !columns.has(column))) fail('UNSUPPORTED_RELATIONSHIP_SCHEMA')
  }
}

async function writeIsolatedRows(db: DatabaseType.Database, file: string, catalog: RecoveryCatalog) {
  relationSchema(db)
  await writePrivateLines(file, async write => {
    await write({ format: 'AnonyProof/typed-isolated-rows/1', versionBinding: catalog.versionBinding, packageBinding: catalog.packageBinding })
    for (const [table, category, predicate] of [
      ['feedback_comments', 'missing-parent-comment', 'c.feedback_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.id=c.feedback_id)'],
      ['feedback_comments', 'no-target-comment', 'c.feedback_id IS NULL'],
      ['notifications', 'missing-parent-notification', 'c.feedback_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.id=c.feedback_id)'],
      ['notifications', 'no-target-notification', 'c.feedback_id IS NULL'],
    ] as const) {
      const statement = db.prepare(`SELECT c.* FROM ${table} c WHERE ${predicate}`).raw(true)
      const columns = statement.columns().map(column => column.name)
      for (const row of statement.iterate() as Iterable<SqlValue[]>) {
        await write({ table, category, columns, values: row.map(typed) })
      }
    }
  })
}

async function writeManifest(db: DatabaseType.Database, file: string, catalog: RecoveryCatalog, snapshotDigest: string, isolatedRowsDigest: string) {
  await writePrivateLines(file, async write => {
    await write({ format: MANIFEST_FORMAT, versionBinding: catalog.versionBinding, packageBinding: catalog.packageBinding,
      mode: 'archive-only', sourceFlagsPreserved: true, roleAdopted: false,
      snapshotDigest, isolatedRowsDigest, schemaDigest: schemaDigest(db),
      fullSnapshotIsTransitional: true, finalTelemetryDisposalPending: true })
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").raw(true)
    for (const row of schema.iterate() as Iterable<SqlValue[]>) await write({ entry: 'schema', values: row.map(typed) })
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").pluck().all() as string[]
    for (const table of names) {
      const statement = db.prepare(`SELECT * FROM ${quote(table)}`).raw(true)
      const columns = statement.columns().map(column => column.name)
      const hash = createHash('sha256')
      let rows = BigInt(0)
      for (const row of statement.iterate() as Iterable<SqlValue[]>) {
        hash.update(JSON.stringify(row.map(typed)) + '\n', 'utf8'); rows++
      }
      await write({ entry: 'table', table, columns, rows: typed(rows), typedDigest: hash.digest('hex') })
      // Original flags and ownership remain private in both the manifest and
      // the byte-exact snapshot. No mapping or service role is introduced.
      if (table === 'feedbacks' || table === 'client_identities' || table === 'instance_metadata') {
        const available = new Set(columns)
        const fields = (table === 'feedbacks' ? ['id', 'device_id', 'is_demo_template', 'is_demo_clone']
          : table === 'client_identities' ? ['device_id', 'recovery_hash', 'token_hash', 'install_key_hash']
            : ['id', 'role', 'version']).filter(field => available.has(field))
        if (fields.length) for (const row of db.prepare(`SELECT ${fields.map(quote).join(',')} FROM ${quote(table)}`).raw(true).iterate() as Iterable<SqlValue[]>) {
          await write({ entry: 'original-mapping', table, columns: fields, values: row.map(typed) })
        }
      }
    }
  })
}

/** Creates a new private output directory. Public report deliberately contains no counts, paths or hashes. */
export async function prepareRetainedVersion(options: {
  sourcePath: string; outputDirectory: string; contentKey: string; versionBinding: string; mode?: 'archive-only'
}) {
  let source: DatabaseType.Database | undefined, snapshot: DatabaseType.Database | undefined
  try {
    if (options.mode !== undefined && options.mode !== 'archive-only') fail('ARCHIVE_ONLY_REQUIRED')
    assertRetentionArchiveParameters(options.contentKey, options.versionBinding)
    assertPrivateFile(options.sourcePath)
    // Exclusive directory reservation: failures remain private for separately
    // approved disposal; never retry into or replace a partial prior attempt.
    reservePrivateOutput(options.outputDirectory)
    const catalog: RecoveryCatalog = { format: CATALOG_FORMAT, archiveFormat: PRIVATE_RETENTION_FORMAT,
      packageBinding: randomBytes(24).toString('hex'), versionBinding: options.versionBinding }
    const staging = mkdtempSync(path.join(options.outputDirectory, '.T32-archive-only-'))
    assertPrivateDirectory(staging)
    const snapshotPath = path.join(staging, 'snapshot.db')
    closeSync(openSync(snapshotPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600))
    source = new Database(options.sourcePath, { readonly: true, fileMustExist: true, timeout: 1000 })
    source.pragma('query_only=ON')
    await source.backup(snapshotPath)
    source.close(); source = undefined
    assertPrivateFile(snapshotPath)
    snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true, timeout: 1000 })
    snapshot.pragma('query_only=ON')
    snapshot.defaultSafeIntegers(true)
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') fail('INTEGRITY_CHECK_FAILED')
    // File encryption is streaming. SQLite row iteration is also bounded by
    // this explicit preflight; unsupported giant rows fail without truncation.
    assertBoundedTypedRows(snapshot)
    const snapshotDigest = await privateFileDigest(snapshotPath)
    const rowsPath = path.join(staging, 'isolated-rows.private'), manifestPath = path.join(staging, 'manifest.private')
    await writeIsolatedRows(snapshot, rowsPath, catalog)
    const isolatedRowsDigest = await privateFileDigest(rowsPath)
    await writeManifest(snapshot, manifestPath, catalog, snapshotDigest, isolatedRowsDigest)
    snapshot.close(); snapshot = undefined
    const files = [
      { kind: 'snapshot' as const, source: snapshotPath, name: RETAINED_VERSION_FILES.snapshot },
      { kind: 'isolated-rows' as const, source: rowsPath, name: RETAINED_VERSION_FILES.isolatedRows },
      { kind: 'manifest' as const, source: manifestPath, name: RETAINED_VERSION_FILES.manifest },
    ]
    for (const file of files) {
      const archivePath = path.join(staging, file.name), restoredPath = path.join(staging, file.name + '.verified-private')
      const binding = { contentKey: options.contentKey, versionBinding: catalog.packageBinding, kind: file.kind }
      await sealPrivateRetentionFile({ ...binding, plaintextPath: file.source, archivePath })
      await restorePrivateRetentionFile({ ...binding, archivePath, destinationPath: restoredPath })
      if (lstatSync(file.source).ino === lstatSync(restoredPath).ino ||
          await privateFileDigest(file.source) !== await privateFileDigest(restoredPath)) fail('INDEPENDENT_RESTORE_MISMATCH')
      if (file.kind === 'snapshot') {
        // Only authenticated plaintext reaches SQLite, after byte equality.
        const restored = new Database(restoredPath, { readonly: true, fileMustExist: true })
        try { if (restored.pragma('integrity_check', { simple: true }) !== 'ok') fail('RESTORE_INTEGRITY_CHECK_FAILED') }
        finally { restored.close() }
      }
    }
    const report = {
      archivePrepared: true as const, independentlyRestored: true as const, originalTypesPreserved: true as const,
      isolatedRowsArchived: true as const, runtimeCandidatePrepared: false as const,
      roleAdopted: false as const, flagsModified: false as const, activated: false as const, sourceModified: false as const,
      format: PRIVATE_RETENTION_FORMAT, mode: 'archive-only' as const,
      recoveryCatalogRequired: true as const,
      finalBusinessRetentionComplete: false as const, historicalPlaintextDisposalComplete: false as const,
      caveats: ['Full snapshot is transitional private recovery material; telemetry retention/disposal remains separately controlled.',
        'Private staging can contain plaintext; its disposal requires a separate approved asset list.',
        'No runtime role adoption, credential activation, public access, source modification or deletion occurred.'],
    }
    const stagedCompletion = path.join(staging, RETAINED_VERSION_FILES.completion)
    await writePrivateLines(stagedCompletion, async write => { await write(report) })
    const stagedCatalog = path.join(staging, RETAINED_VERSION_FILES.catalog)
    await writePrivateLines(stagedCatalog, async write => { await write(catalog) })
    // Publish only authenticated artifacts. Completion marker is last; without
    // it a partially published directory never represents successful preparation.
    publishPreparedFiles(options.outputDirectory,
      [...files.map(file => ({ staged: path.join(staging, file.name), name: file.name })),
        { staged: stagedCatalog, name: RETAINED_VERSION_FILES.catalog }], stagedCompletion, RETAINED_VERSION_FILES.completion)
    return report
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('RETENTION_SOURCE_OR_IO_FAILED')
  } finally { snapshot?.close(); source?.close() }
}

/** Complete package restore, using only an independently retained key/catalog and three archives. */
export async function restoreRetainedVersion(options: {
  archiveDirectory: string; catalogPath: string; destinationDirectory: string; contentKey: string
}) {
  let db: DatabaseType.Database | undefined
  try {
    const catalog = readCatalog(options.catalogPath)
    assertRetentionArchiveParameters(options.contentKey, catalog.packageBinding)
    assertPrivateDirectory(options.archiveDirectory)
    reservePrivateOutput(options.destinationDirectory)
    const staging = mkdtempSync(path.join(options.destinationDirectory, '.T32-package-restore-'))
    assertPrivateDirectory(staging)
    const files = [
      { kind: 'snapshot' as const, archive: RETAINED_VERSION_FILES.snapshot, restored: RETAINED_RESTORE_FILES.snapshot },
      { kind: 'isolated-rows' as const, archive: RETAINED_VERSION_FILES.isolatedRows, restored: RETAINED_RESTORE_FILES.isolatedRows },
      { kind: 'manifest' as const, archive: RETAINED_VERSION_FILES.manifest, restored: RETAINED_RESTORE_FILES.manifest },
    ]
    for (const file of files) await restorePrivateRetentionFile({
      archivePath: path.join(options.archiveDirectory, file.archive), destinationPath: path.join(staging, file.restored),
      contentKey: options.contentKey, versionBinding: catalog.packageBinding, kind: file.kind,
    })
    const manifest = await readManifestHeader(path.join(staging, RETAINED_RESTORE_FILES.manifest))
    if (manifest.format !== MANIFEST_FORMAT || manifest.packageBinding !== catalog.packageBinding ||
        manifest.versionBinding !== catalog.versionBinding || manifest.mode !== 'archive-only' ||
        manifest.roleAdopted !== false || manifest.sourceFlagsPreserved !== true ||
        manifest.fullSnapshotIsTransitional !== true || manifest.finalTelemetryDisposalPending !== true ||
        !['snapshotDigest', 'isolatedRowsDigest', 'schemaDigest'].every(field => typeof manifest[field] === 'string' && /^[a-f0-9]{64}$/.test(manifest[field] as string))) fail('ARCHIVE_PACKAGE_MISMATCH')
    const snapshotPath = path.join(staging, RETAINED_RESTORE_FILES.snapshot)
    if (await privateFileDigest(snapshotPath) !== manifest.snapshotDigest ||
        await privateFileDigest(path.join(staging, RETAINED_RESTORE_FILES.isolatedRows)) !== manifest.isolatedRowsDigest) fail('ARCHIVE_PACKAGE_MISMATCH')
    // All three GCM tags and their authenticated relationships have passed.
    // Only now may the restored snapshot reach SQLite.
    db = new Database(snapshotPath, { readonly: true, fileMustExist: true })
    db.pragma('query_only=ON'); db.defaultSafeIntegers(true)
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('RESTORE_INTEGRITY_CHECK_FAILED')
    if (schemaDigest(db) !== manifest.schemaDigest) fail('ARCHIVE_PACKAGE_MISMATCH')
    db.close(); db = undefined
    const report = { restored: true as const, packageAuthenticated: true as const, relationshipsVerified: true as const,
      integrityVerified: true as const, runtimeCandidatePrepared: false as const, roleAdopted: false as const,
      activated: false as const, sourceModified: false as const, format: PRIVATE_RETENTION_FORMAT,
      finalBusinessRetentionComplete: false as const, historicalPlaintextDisposalComplete: false as const }
    const completion = path.join(staging, RETAINED_RESTORE_FILES.completion)
    await writePrivateLines(completion, async write => { await write(report) })
    publishPreparedFiles(options.destinationDirectory, files.map(file => ({ staged: path.join(staging, file.restored), name: file.restored })),
      completion, RETAINED_RESTORE_FILES.completion)
    return report
  } catch (error) {
    if (error instanceof PrivateRetentionError) throw error
    fail('RETENTION_RESTORE_OR_IO_FAILED')
  } finally { db?.close() }
}
