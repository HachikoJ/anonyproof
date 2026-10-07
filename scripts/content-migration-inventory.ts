// T-32 preparation only: metadata/count dry-run, never a migration or key reader.
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type DatabaseType from 'better-sqlite3'
const Database = createRequire(path.resolve(__dirname, '../server/package.json'))('better-sqlite3') as typeof DatabaseType

type StorageCount = {
  table: string; fields: string[]; rows: number; legacyRows: number
  markedVersion1Rows: number; unknownVersionRows: number; nullContentRows: number
  versionColumnPresent: boolean
}
export function inventoryContentMigration(sourcePath: string) {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('SOURCE_NOT_FOUND')
  const db = new Database(path.resolve(sourcePath), { readonly: true, fileMustExist: true, timeout: 1000 })
  try {
    db.pragma('query_only = ON')
    db.exec('BEGIN')
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name))
    // Only these fixed, source-reviewed identifiers are used in SQL. No report
    // includes body text, IDs, recovery codes, key IDs or stored key packages.
    const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name))
    const specs = [
      { table: 'feedbacks', fields: ['original_content'], version: 'original_content_storage_version' },
      { table: 'feedbacks', fields: ['solution'], version: 'solution_storage_version' },
      { table: 'feedback_comments', fields: ['content'], version: 'content_storage_version' },
      { table: 'notifications', fields: ['title', 'content'], version: 'content_storage_version' },
    ]
    const storage: StorageCount[] = [], schemaGaps: string[] = []
    for (const spec of specs) {
      if (!tables.has(spec.table)) { if (!schemaGaps.includes(spec.table)) schemaGaps.push(spec.table); continue }
      const available = columns(spec.table)
      const missing = spec.fields.filter(field => !available.has(field))
      if (missing.length) { schemaGaps.push(...missing.map(field => `${spec.table}.${field}`)); continue }
      const hasVersion = available.has(spec.version)
      const version = hasVersion ? spec.version : '0'
      const row = db.prepare(`SELECT COUNT(*) AS rows,
        COALESCE(SUM(CASE WHEN typeof(${version}) = 'integer' AND ${version} = 0 THEN 1 ELSE 0 END), 0) AS legacyRows,
        COALESCE(SUM(CASE WHEN typeof(${version}) = 'integer' AND ${version} = 1 THEN 1 ELSE 0 END), 0) AS markedVersion1Rows,
        COALESCE(SUM(CASE WHEN ${version} IS NULL OR typeof(${version}) != 'integer' OR ${version} NOT IN (0, 1) THEN 1 ELSE 0 END), 0) AS unknownVersionRows,
        COALESCE(SUM(CASE WHEN ${spec.fields.map(field => `${field} IS NULL`).join(' OR ')} THEN 1 ELSE 0 END), 0) AS nullContentRows
        FROM ${spec.table}`).get() as Omit<StorageCount, 'table' | 'fields' | 'versionColumnPresent'>
      storage.push({ table: spec.table, fields: spec.fields, versionColumnPresent: hasVersion, ...row })
    }
    const count = (table: string, where = '') => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n
    const recordCounts: Record<string, number> = {}
    for (const table of ['feedbacks', 'feedback_comments', 'notifications', 'client_identities', 'client_identity_sessions', 'client_identity_install_keys']) {
      if (tables.has(table)) recordCounts[table] = count(table)
    }
    const feedbackFlags = tables.has('feedbacks') ? columns('feedbacks') : new Set<string>()
    const feedbackScopeCounts = feedbackFlags.has('is_demo_template') && feedbackFlags.has('is_demo_clone') ? {
      formal: count('feedbacks', 'WHERE is_demo_template = 0 AND is_demo_clone = 0'),
      templates: count('feedbacks', 'WHERE is_demo_template = 1 AND is_demo_clone = 0'),
      clones: count('feedbacks', 'WHERE is_demo_template = 0 AND is_demo_clone = 1'),
      unknown: count('feedbacks', 'WHERE is_demo_template IS NULL OR is_demo_clone IS NULL OR is_demo_template NOT IN (0, 1) OR is_demo_clone NOT IN (0, 1) OR (is_demo_template = 1 AND is_demo_clone = 1)'),
    } : null
    const orphanCounts: Record<string, number | null> = { comments: null, commentsWithoutTarget: null, notifications: null, notificationsWithoutTarget: null }
    if (tables.has('feedbacks') && feedbackFlags.has('id')) {
      for (const [table, key] of [['feedback_comments', 'comments'], ['notifications', 'notifications']] as const) {
        if (tables.has(table) && columns(table).has('feedback_id')) {
          orphanCounts[key] = count(table, `WHERE feedback_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.id = ${table}.feedback_id)`)
          orphanCounts[table === 'notifications' ? 'notificationsWithoutTarget' : 'commentsWithoutTarget'] = count(table, 'WHERE feedback_id IS NULL')
        }
      }
    }
    return {
      readOnly: db.readonly, migrationPerformed: false,
      schemaVersion: db.pragma('schema_version', { simple: true }),
      recordCounts, storage, feedbackScopeCounts, orphanCounts, schemaGaps,
      caveats: ['Storage version flags do not prove authenticated decryption.',
        'Counts are one read transaction; they do not approve retention, conversion or deletion.',
        'Demo/formal row flags do not prove deployment or database ownership isolation.',
        'No source content, identifiers or content key were exported.'],
    }
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK')
    db.close()
  }
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: npx --no-install tsx scripts/content-migration-inventory.ts /absolute/approved-source.db')
    process.exitCode = 2
  } else {
    try { console.log(JSON.stringify(inventoryContentMigration(process.argv[2]), null, 2)) }
    catch { console.error('T-32 inventory failed: source unavailable or unsupported; no migration performed'); process.exitCode = 1 }
  }
}
