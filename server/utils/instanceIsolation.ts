import path from 'node:path'
import type Database from 'better-sqlite3'
import { DEMO_ADMIN_PASSWORD } from '../demo'
import { loadContentEncryption, type ContentEncryption } from './contentEncryption'

export type InstanceRole = 'demo' | 'formal'

export function readInstanceConfiguration(env: NodeJS.ProcessEnv): {
  role: InstanceRole; databasePath: string; encryption: ContentEncryption
} {
  const role = env.INSTANCE_ROLE
  if (role !== 'demo' && role !== 'formal') throw new Error('INSTANCE_ROLE must be demo or formal')
  if (env.DEMO_MODE !== (role === 'demo' ? '1' : '0')) {
    throw new Error('DEMO_MODE must exactly match INSTANCE_ROLE')
  }
  const databasePath = env.DATABASE_PATH?.trim()
  if (!databasePath || !path.isAbsolute(databasePath) || databasePath === ':memory:') {
    throw new Error('DATABASE_PATH must be an explicit absolute file path')
  }
  if (role === 'demo' && env.CONTENT_ENCRYPTION_KEY) {
    throw new Error('Demo must not receive CONTENT_ENCRYPTION_KEY')
  }
  if (role === 'formal') {
    const password = env.ADMIN_PASSWORD?.trim()
    if (!password || password.length < 12 || password === DEMO_ADMIN_PASSWORD ||
        /^(replace[_ -]|your[_ -]|<)/i.test(password)) {
      throw new Error('Formal ADMIN_PASSWORD must be private and must not be a demo or placeholder password')
    }
  }
  // Decode/validate before touching the database or creating its directory.
  const encryption = loadContentEncryption({ demoMode: role === 'demo', env })
  return { role, databasePath: path.resolve(databasePath), encryption }
}

function storedRole(db: Database.Database) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='instance_metadata'").get()
  if (!exists) return undefined
  const rows = db.prepare('SELECT id, role, version FROM instance_metadata').all() as
    { id: number; role: string; version: number }[]
  if (rows.length !== 1 || rows[0].id !== 1 || rows[0].version !== 1 ||
      !['demo', 'formal'].includes(rows[0].role)) throw new Error('Invalid instance_metadata')
  return rows[0].role
}

/** Read-only preflight. Never adopts an unlabelled historical database. */
export function verifyDatabaseRole(db: Database.Database, role: InstanceRole) {
  const persisted = storedRole(db)
  if (persisted && persisted !== role) throw new Error('Database INSTANCE_ROLE mismatch')
  if (!persisted && db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
    throw new Error('Unlabelled nonempty database: explicit controlled migration required')
  }
  return persisted
}

/** Must run before business/access schemas, within the database opening path. */
export function initializeDatabaseRole(db: Database.Database, role: InstanceRole, encryption: ContentEncryption) {
  db.transaction(() => {
    const persisted = verifyDatabaseRole(db, role)
    // Key checks precede business writes; transaction also rolls back a new marker.
    encryption.assertDatabaseKey(db)
    if (!persisted) {
      db.exec(`CREATE TABLE instance_metadata (
        id INTEGER PRIMARY KEY CHECK(id=1), role TEXT NOT NULL CHECK(role IN ('demo','formal')),
        version INTEGER NOT NULL CHECK(version=1)
      )`)
      db.prepare('INSERT INTO instance_metadata(id,role,version) VALUES(1,?,1)').run(role)
    }
  }).immediate()
}
