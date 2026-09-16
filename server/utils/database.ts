import '../env'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

const projectRoot = path.resolve(__dirname, '../..')
const configuredPath = process.env.DATABASE_PATH?.trim()

export const databasePath = configuredPath
  ? path.resolve(projectRoot, configuredPath)
  : path.join(projectRoot, 'data/anonyproof.db')

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

export function openDatabase() {
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
