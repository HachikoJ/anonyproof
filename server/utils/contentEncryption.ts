import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

// The row's explicit storage version determines interpretation, not this prefix:
// old plaintext is allowed to begin with exactly the same characters.
export const CONTENT_ENVELOPE_PREFIX = 'apc:'
const ALGORITHM = 'A256GCM'
const VERSION = 1
const KEY_CHECK_CONTEXT = 'content_encryption_metadata:key_check'
const KEY_CHECK_VALUE = 'AnonyProof content key verification v1'

type Envelope = { v: 1; alg: 'A256GCM'; kid: string; nonce: string; tag: string; ciphertext: string }

export class ContentEncryptionError extends Error {
  constructor(public readonly code: string) {
    // Deliberately omit content, encoded envelopes and key material from errors.
    super(`Content encryption error: ${code}`)
    this.name = 'ContentEncryptionError'
  }
}

function decodeBase64(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ContentEncryptionError('INVALID_BASE64')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new ContentEncryptionError('INVALID_BASE64_LENGTH')
  }
  return decoded
}

function parseEnvelope(value: string): Envelope {
  let envelope: unknown
  try { envelope = JSON.parse(value.slice(CONTENT_ENVELOPE_PREFIX.length)) } catch {
    throw new ContentEncryptionError('INVALID_ENVELOPE')
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ContentEncryptionError('INVALID_ENVELOPE')
  }
  const object = envelope as Record<string, unknown>
  if (Object.keys(object).sort().join(',') !== 'alg,ciphertext,kid,nonce,tag,v' ||
      object.v !== VERSION || object.alg !== ALGORITHM ||
      typeof object.kid !== 'string' || !/^[a-f0-9]{32}$/.test(object.kid)) {
    throw new ContentEncryptionError('UNSUPPORTED_ENVELOPE')
  }
  decodeBase64(object.nonce, 12)
  decodeBase64(object.tag, 16)
  decodeBase64(object.ciphertext)
  return object as Envelope
}

function aad(keyId: string, context: string) {
  if (typeof context !== 'string' || !context || context.includes('\0')) {
    throw new ContentEncryptionError('INVALID_CONTEXT')
  }
  return Buffer.from(`AnonyProof content envelope\0v1\0${ALGORITHM}\0${keyId}\0${context}`, 'utf8')
}

export interface ContentEncryption {
  readonly keyId: string | null
  readonly storageVersion: 0 | 1
  encrypt(plaintext: string, context: string): string
  decrypt(stored: string, context: string, storageVersion: number): string
  assertDatabaseKey(db: Database.Database): void
}

/** Only demo's synthetic data may use the keyless writer. No environment file is loaded here. */
export function loadContentEncryption(options: { demoMode: boolean; env?: { CONTENT_ENCRYPTION_KEY?: string } }): ContentEncryption {
  const encodedKey = (options.env ?? process.env).CONTENT_ENCRYPTION_KEY
  if (!encodedKey && !options.demoMode) throw new ContentEncryptionError('MISSING_KEY')
  const key = encodedKey ? decodeBase64(encodedKey, 32) : null
  const keyId = key ? createHash('sha256').update(key).digest('hex').slice(0, 32) : null

  function encrypt(plaintext: string, context: string) {
    if (typeof plaintext !== 'string') throw new ContentEncryptionError('INVALID_PLAINTEXT')
    if (!key || !keyId) {
      return plaintext
    }
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    cipher.setAAD(aad(keyId, context))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const envelope: Envelope = {
      v: VERSION, alg: ALGORITHM, kid: keyId, nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    }
    return CONTENT_ENVELOPE_PREFIX + JSON.stringify(envelope)
  }

  function decrypt(stored: string, context: string, storageVersion: number) {
    if (typeof stored !== 'string') throw new ContentEncryptionError('INVALID_STORED_VALUE')
    // Explicit compatibility path: never inspect old plaintext for magic bytes.
    if (storageVersion === 0) return stored
    if (storageVersion !== 1) throw new ContentEncryptionError('UNSUPPORTED_STORAGE_VERSION')
    if (!stored.startsWith(CONTENT_ENVELOPE_PREFIX)) throw new ContentEncryptionError('INVALID_ENVELOPE')
    const envelope = parseEnvelope(stored)
    if (!key || !keyId) throw new ContentEncryptionError('MISSING_KEY')
    if (envelope.kid !== keyId) throw new ContentEncryptionError('KEY_MISMATCH')
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, decodeBase64(envelope.nonce, 12), { authTagLength: 16 })
      decipher.setAAD(aad(keyId, context))
      decipher.setAuthTag(decodeBase64(envelope.tag, 16))
      return Buffer.concat([decipher.update(decodeBase64(envelope.ciphertext)), decipher.final()]).toString('utf8')
    } catch (error) {
      if (error instanceof ContentEncryptionError) throw error
      throw new ContentEncryptionError('AUTHENTICATION_FAILED')
    }
  }

  function assertDatabaseKey(db: Database.Database) {
    // Check before CREATE/INSERT, so the wrong key cannot rewrite the marker.
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_encryption_metadata'").get()
    let hasVerifiedMarker = false
    if (exists) {
      const marker = db.prepare('SELECT key_id, key_check FROM content_encryption_metadata WHERE id = 1').get() as
        { key_id: string; key_check: string } | undefined
      if (marker) {
        if (!keyId || marker.key_id !== keyId) throw new ContentEncryptionError('DATABASE_KEY_MISMATCH')
        if (decrypt(marker.key_check, KEY_CHECK_CONTEXT, 1) !== KEY_CHECK_VALUE) {
          throw new ContentEncryptionError('INVALID_KEY_CHECK')
        }
        hasVerifiedMarker = true
      }
    }
    // Explicit field flags preserve arbitrary historical plaintext and permit
    // changing an old record's solution without migrating its old body. Title
    // and content are always written together for a notification, so share one.
    for (const [table, fields] of [
      ['feedbacks', [['original_content', 'original_content_storage_version'], ['solution', 'solution_storage_version']]],
      ['feedback_comments', [['content', 'content_storage_version']]],
      ['notifications', [['title', 'content_storage_version'], ['content', 'content_storage_version']]],
    ] as const) {
      const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      if (!tableExists) continue
      const present = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name))
      for (const [column, versionColumn] of fields) {
        // Pre-reader schema is explicitly legacy, irrespective of text prefix.
        if (!present.has(column) || !present.has(versionColumn)) continue
        if (db.prepare(`SELECT 1 FROM ${table} WHERE ${versionColumn} NOT IN (0, 1) OR ${versionColumn} IS NULL LIMIT 1`).get()) {
          throw new ContentEncryptionError('UNSUPPORTED_STORAGE_VERSION')
        }
        if (hasVerifiedMarker) continue
        // Markerless databases must not adopt version 1 ciphertext under a
        // different key. Iterate rather than materialize all sensitive rows.
        for (const row of db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${versionColumn} = 1`)
          .iterate() as Iterable<{ value: string }>) {
          if (typeof row.value !== 'string' || !row.value.startsWith(CONTENT_ENVELOPE_PREFIX)) {
            throw new ContentEncryptionError('INVALID_ENVELOPE')
          }
          const envelope = parseEnvelope(row.value)
          if (!keyId || envelope.kid !== keyId) throw new ContentEncryptionError('DATABASE_KEY_MISMATCH')
        }
      }
    }
    if (hasVerifiedMarker) return
    if (!keyId) return
    const check = encrypt(KEY_CHECK_VALUE, KEY_CHECK_CONTEXT)
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS content_encryption_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1), key_id TEXT NOT NULL, key_check TEXT NOT NULL
      )`)
      db.prepare('INSERT INTO content_encryption_metadata (id, key_id, key_check) VALUES (1, ?, ?)').run(keyId, check)
    })()
  }

  return { keyId, storageVersion: keyId ? 1 : 0, encrypt, decrypt, assertDatabaseKey }
}
