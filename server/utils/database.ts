import '../env'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { readInstanceConfiguration, verifyDatabaseRole, initializeDatabaseRole } from './instanceIsolation'

const configuration = readInstanceConfiguration(process.env)
export const databasePath = configuration.databasePath

export function openDatabase() {
  if (fs.existsSync(databasePath)) {
    const preflight = new Database(databasePath, { readonly: true, fileMustExist: true })
    try { verifyDatabaseRole(preflight, configuration.role) } finally { preflight.close() }
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new Database(databasePath)
  try {
    initializeDatabaseRole(db, configuration.role, configuration.encryption)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
