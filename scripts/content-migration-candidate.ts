// T-32 preparation library. No CLI, environment loading, activation or deletion.
// Real sources/retention mappings still require the confirmations in FIX_PLAN.md.
import path from 'node:path'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, realpathSync, mkdtempSync, openSync, closeSync, fsyncSync, linkSync } from 'node:fs'
import type DatabaseType from 'better-sqlite3'
import { loadContentEncryption, ContentEncryptionError } from '../server/utils/contentEncryption'

const Database = createRequire(path.resolve(__dirname, '../server/package.json'))('better-sqlite3') as typeof DatabaseType
const specs = [
  { table: 'feedbacks', required: ['id', 'device_id', 'original_content', 'solution', 'encrypted_content', 'is_demo_template', 'is_demo_clone'], versions: ['original_content_storage_version', 'solution_storage_version'] },
  { table: 'feedback_comments', required: ['id', 'feedback_id', 'commenter_type', 'content'], versions: ['content_storage_version'] },
  { table: 'notifications', required: ['id', 'feedback_id', 'recipient_type', 'recipient_id', 'type', 'title', 'content'], versions: ['content_storage_version'] },
] as const

export class ContentMigrationPreparationError extends Error {
  constructor(public readonly code: string, public readonly workingDirectory?: string) {
    // Do not propagate SQLite/crypto errors which may contain source text.
    super(`T-32 candidate preparation failed: ${code}`)
    this.name = 'ContentMigrationPreparationError'
  }
}

function fail(code: string): never { throw new ContentMigrationPreparationError(code) }
function countRows(db: DatabaseType.Database) {
  const result = Object.create(null) as Record<string, number>
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").iterate() as Iterable<{ name: string }>) {
    // Schema identifiers must be quoted; arbitrary names are never interpolated raw.
    const quoted = '"' + row.name.replace(/"/g, '""') + '"'
    result[row.name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n
  }
  return result
}

function eachContentRow(db: DatabaseType.Database, table: 'feedbacks' | 'feedback_comments' | 'notifications', visit: (row: Record<string, unknown>) => void) {
  // Finish each read statement before updates; keep memory bounded and avoid
  // writes through an active better-sqlite3 iterate() cursor.
  const first = db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT 128`)
  const next = db.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT 128`)
  let cursor: number | string | undefined
  while (true) {
    const rows = (cursor === undefined ? first.all() : next.all(cursor)) as Record<string, unknown>[]
    if (!rows.length) break
    for (const row of rows) {
      if (typeof row.id !== 'string' && (typeof row.id !== 'number' || !Number.isSafeInteger(row.id))) fail('INVALID_RECORD_ID')
      visit(row)
    }
    cursor = rows[rows.length - 1].id as number | string
  }
}

function checkSchema(db: DatabaseType.Database) {
  for (const spec of specs) {
    const schema = db.prepare(`PRAGMA table_info(${spec.table})`).all() as { name: string; pk: number }[]
    const columns = new Set(schema.map(row => row.name))
    if (spec.required.some(field => !columns.has(field))) fail('UNSUPPORTED_SCHEMA')
    if (schema.filter(row => row.pk).length !== 1 || schema.find(row => row.name === 'id')?.pk !== 1) fail('UNSUPPORTED_PRIMARY_KEY')
    for (const version of spec.versions) if (columns.has(version) && db.prepare(`SELECT 1 FROM ${spec.table} WHERE typeof(${version}) != 'integer' OR ${version} NOT IN (0,1) LIMIT 1`).get()) fail('UNSUPPORTED_STORAGE_VERSION')
  }
  // This library converts an already selected formal retained snapshot. It must
  // not silently decide which historical demo/clone/unknown rows become formal.
  if (db.prepare('SELECT 1 FROM feedbacks WHERE is_demo_template IS NULL OR is_demo_clone IS NULL OR is_demo_template != 0 OR is_demo_clone != 0 LIMIT 1').get()) fail('UNAPPROVED_SCOPE')
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' LIMIT 1").get()) fail('UNREVIEWED_TRIGGER')
}

export async function prepareContentMigrationCandidate(options: {
  sourcePath: string; destinationPath: string; contentKey: string
}) {
  let workingDirectory: string | undefined
  let source: DatabaseType.Database | undefined, staged: DatabaseType.Database | undefined
  try {
    const { sourcePath, destinationPath, contentKey } = options
    if (!path.isAbsolute(sourcePath) || !path.isAbsolute(destinationPath)) fail('ABSOLUTE_PATHS_REQUIRED')
    if (!destinationPath.endsWith('.db')) fail('DESTINATION_DB_SUFFIX_REQUIRED')
    if (!lstatSync(sourcePath).isFile() || !lstatSync(path.dirname(destinationPath)).isDirectory()) fail('INVALID_PATH')
    if (existsSync(destinationPath) || (() => { try { lstatSync(destinationPath); return true } catch { return false } })()) fail('DESTINATION_EXISTS')
    const codec = loadContentEncryption({ demoMode: false, env: { CONTENT_ENCRYPTION_KEY: contentKey } })
    source = new Database(realpathSync(sourcePath), { readonly: true, fileMustExist: true, timeout: 1000 })
    source.pragma('query_only=ON')
    checkSchema(source)
    // Private staging can contain legacy plaintext after a failed conversion.
    // Reserve both files before SQLite opens them; neither replaces an asset.
    workingDirectory = mkdtempSync(path.join(path.dirname(destinationPath), '.T32-working-'))
    const snapshotPath = path.join(workingDirectory, 'snapshot.db'), candidatePath = path.join(workingDirectory, 'candidate.db')
    closeSync(openSync(snapshotPath, 'wx', 0o600))
    await source.backup(snapshotPath)
    source.close(); source = undefined
    staged = new Database(snapshotPath, { fileMustExist: true, timeout: 1000 })
    // Rollback pages stay in the private staging directory, avoiding an
    // unbounded in-memory journal for large retained snapshots.
    if (staged.pragma('journal_mode=DELETE', { simple: true }) !== 'delete') fail('UNSAFE_STAGING_JOURNAL')
    staged.pragma('temp_store=MEMORY')
    staged.pragma('secure_delete=ON')
    staged.pragma('synchronous=FULL')
    checkSchema(staged)
    const beforeCounts = countRows(staged)
    const converted = { feedbackBodies: 0, solutions: 0, comments: 0, notifications: 0, obsoletePackages: 0 }
    const contextString = (value: unknown) => { if (typeof value !== 'string') fail('INVALID_CONTEXT'); return value }
    const transform = (stored: unknown, context: string, version: unknown) => {
      if (typeof stored !== 'string') fail('UNSUPPORTED_NULL_OR_CONTENT_TYPE')
      if (version !== 0 && version !== 1) fail('UNSUPPORTED_STORAGE_VERSION')
      const plaintext = codec.decrypt(stored, context, version)
      if (version === 1) return stored // authenticate every existing envelope; never reseal it
      const sealed = codec.encrypt(plaintext, context)
      if (codec.decrypt(sealed, context, 1) !== plaintext) fail('CONVERSION_VERIFICATION_FAILED')
      return sealed
    }
    staged.transaction(() => {
      for (const spec of specs) {
        const columns = new Set((staged!.prepare(`PRAGMA table_info(${spec.table})`).all() as { name: string }[]).map(row => row.name))
        for (const version of spec.versions) if (!columns.has(version)) staged!.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${version} INTEGER NOT NULL DEFAULT 0`)
      }
      codec.assertDatabaseKey(staged!)
      const feedbackUpdate = staged!.prepare('UPDATE feedbacks SET original_content=?, original_content_storage_version=1, solution=?, solution_storage_version=1, encrypted_content=? WHERE id=?')
      eachContentRow(staged!, 'feedbacks', row => {
        const id = contextString(row.id)
        // An old empty body may only be an additive-column default; its old
        // package could be the sole recoverable material. Do not discard it.
        if (row.original_content === '' && row.encrypted_content !== 'server-encrypted:v1') fail('AMBIGUOUS_LEGACY_BODY')
        const body = transform(row.original_content, `feedbacks:${id}:original_content`, row.original_content_storage_version)
        const solution = transform(row.solution, `feedbacks:${id}:solution`, row.solution_storage_version)
        if (row.original_content_storage_version === 0) converted.feedbackBodies++
        if (row.solution_storage_version === 0) converted.solutions++
        if (row.encrypted_content !== 'server-encrypted:v1') converted.obsoletePackages++
        if (feedbackUpdate.run(body, solution, 'server-encrypted:v1', id).changes !== 1) fail('NON_UNIQUE_RECORD')
      })
      const commentUpdate = staged!.prepare('UPDATE feedback_comments SET content=?, content_storage_version=1 WHERE id=?')
      eachContentRow(staged!, 'feedback_comments', row => {
        const parent = contextString(row.feedback_id), role = contextString(row.commenter_type)
        const content = transform(row.content, `feedback_comments:${parent}:${role}:content`, row.content_storage_version)
        if (row.content_storage_version === 0) converted.comments++
        if (commentUpdate.run(content, row.id as number | string).changes !== 1) fail('NON_UNIQUE_RECORD')
      })
      const noticeUpdate = staged!.prepare('UPDATE notifications SET title=?, content=?, content_storage_version=1 WHERE id=?')
      eachContentRow(staged!, 'notifications', row => {
        const parent = row.feedback_id === null ? 'null' : contextString(row.feedback_id)
        const ctx = `notifications:${parent}:${contextString(row.recipient_type)}:${contextString(row.recipient_id)}:${contextString(row.type)}`
        const title = transform(row.title, `${ctx}:title`, row.content_storage_version)
        const content = transform(row.content, `${ctx}:content`, row.content_storage_version)
        if (row.content_storage_version === 0) converted.notifications++
        if (noticeUpdate.run(title, content, row.id as number | string).changes !== 1) fail('NON_UNIQUE_RECORD')
      })
      const afterCounts = countRows(staged!)
      // All existing tables/record counts survive; only the codec marker is additive.
      for (const [table, count] of Object.entries(beforeCounts)) if (afterCounts[table] !== (table === 'content_encryption_metadata' && count === 0 ? 1 : count)) fail('RECORD_COUNT_CHANGED')
    }).immediate()
    if (staged.pragma('integrity_check', { simple: true }) !== 'ok') fail('INTEGRITY_CHECK_FAILED')
    closeSync(openSync(candidatePath, 'wx', 0o600))
    staged.prepare('VACUUM INTO ?').run(candidatePath)
    staged.close(); staged = undefined
    const candidate = new Database(candidatePath, { readonly: true, fileMustExist: true })
    let recordCounts: Record<string, number>
    try {
      if (candidate.pragma('integrity_check', { simple: true }) !== 'ok') fail('INTEGRITY_CHECK_FAILED')
      recordCounts = countRows(candidate)
      for (const [table, count] of Object.entries(beforeCounts)) if (recordCounts[table] !== (table === 'content_encryption_metadata' && count === 0 ? 1 : count)) fail('RECORD_COUNT_CHANGED')
    } finally { candidate.close() }
    const fd = openSync(candidatePath, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    // Atomic, exclusive publication; retains the working file as a hard link.
    // These two paths are NOT independent backups. Never modify either in place.
    linkSync(candidatePath, destinationPath)
    const reportedCounts: Record<string, number> = {}
    for (const table of ['feedbacks', 'feedback_comments', 'notifications', 'client_identities', 'client_identity_sessions', 'client_identity_install_keys']) {
      if (recordCounts[table] !== undefined) reportedCounts[table] = recordCounts[table]
    }
    return { candidatePrepared: true, activated: false, sourceModified: false,
      workingDirectory, recordCounts: reportedCounts, existingTableCountsPreserved: true, converted,
      caveats: ['Real retention mapping, role adoption, activation and old-asset disposal are not approved by this result.',
        'Working snapshots can contain legacy content; retain privately until separately approved disposal.',
        'Candidate and working candidate are hard links, not independent recovery copies.',
        'No per-identity identifiers, plaintext or content key are included in this report.'] }
  } catch (error) {
    const code = error instanceof ContentMigrationPreparationError || error instanceof ContentEncryptionError ? error.code : 'SOURCE_OR_IO_FAILURE'
    throw new ContentMigrationPreparationError(code, workingDirectory)
  } finally {
    staged?.close(); source?.close()
  }
}
