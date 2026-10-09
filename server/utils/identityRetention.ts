import type Database from 'better-sqlite3'
import { DEMO_TEMPLATE_IDS } from '../demo'

export const IDENTITY_RETENTION_INTERVAL_MS = 60 * 60 * 1000
export const IDENTITY_RETENTION_BATCH_SIZE = 100
export const IDENTITY_RETENTION_ROW_BATCH_SIZE = 500
const DAY_MS = 86400000
export type IdentityRetentionRole = 'demo' | 'formal'
export interface IdentityRetentionCounts {
  expiredSessions: number
  identitySessions: number
  installKeys: number
  identities: number
  feedbacks: number
  comments: number
  notifications: number
}
const emptyCounts = (): IdentityRetentionCounts => ({ expiredSessions: 0, identitySessions: 0,
  installKeys: 0, identities: 0, feedbacks: 0, comments: 0, notifications: 0 })

export function initializeIdentityRetention(db: Database.Database) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_retention_activity ON client_identities(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_identity_sessions_expiry ON client_identity_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_identity_sessions_activity ON client_identity_sessions(device_id,last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_identity_keys_activity ON client_identity_install_keys(device_id,last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_identity_retention ON feedbacks(device_id);`)
}

function candidates(role: IdentityRetentionRole, now: number) {
  if (role !== 'formal' && role !== 'demo') throw new Error('Invalid identity retention role')
  if (!Number.isSafeInteger(now) || now < 90 * DAY_MS) throw new Error('Invalid identity retention time')
  const cutoff = now - (role === 'formal' ? 90 : 30) * DAY_MS
  const markers = DEMO_TEMPLATE_IDS.map(id => `demo-encrypted:${id}`)
  const safeFeedback = (alias: string) => `${alias}.is_demo_template = 0 AND ${alias}.is_demo_clone = 1
    AND ${alias}.encrypted_content IN (${markers.map(() => '?').join(',')})`
  // A clone flag alone is not proof of synthetic data. Unknown historical
  // markers, templates, and unassociated user notices preserve the identity.
  const businessGuard = role === 'formal'
    ? 'NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.device_id = i.device_id) AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_type = \'user\' AND n.recipient_id = i.device_id)'
    : `NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.device_id = i.device_id AND NOT (${safeFeedback('f')}))
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_type = 'user' AND n.recipient_id = i.device_id
        AND NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.id = n.feedback_id AND f.device_id = i.device_id AND ${safeFeedback('f')}))`
  return {
    sql: `SELECT i.device_id FROM client_identities i WHERE i.last_seen_at < ? AND i.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM client_identity_sessions s WHERE s.device_id = i.device_id
        AND (s.last_seen_at >= ? OR s.created_at >= ?))
      AND NOT EXISTS (SELECT 1 FROM client_identity_install_keys k WHERE k.device_id = i.device_id
        AND (k.last_seen_at >= ? OR k.created_at >= ?)) AND ${businessGuard}`,
    params: [cutoff, cutoff, cutoff, cutoff, cutoff, cutoff, ...(role === 'demo' ? [...markers, ...markers] : [])],
  }
}

// Read-only exact counts, not a historical cleanup authorization.
export function countIdentityRetention(db: Database.Database, role: IdentityRetentionRole, now = Date.now()): IdentityRetentionCounts {
  const eligible = candidates(role, now)
  const cte = `WITH eligible AS (${eligible.sql}), doomed_feedback AS (
    SELECT id FROM feedbacks WHERE device_id IN (SELECT device_id FROM eligible))`
  return db.transaction(() => db.prepare(`${cte} SELECT
    (SELECT COUNT(*) FROM client_identity_sessions WHERE expires_at <= ?) AS expiredSessions,
    (SELECT COUNT(*) FROM client_identity_sessions WHERE expires_at > ? AND device_id IN (SELECT device_id FROM eligible)) AS identitySessions,
    (SELECT COUNT(*) FROM client_identity_install_keys WHERE device_id IN (SELECT device_id FROM eligible)) AS installKeys,
    (SELECT COUNT(*) FROM eligible) AS identities,
    (SELECT COUNT(*) FROM doomed_feedback) AS feedbacks,
    (SELECT COUNT(*) FROM feedback_comments WHERE feedback_id IN (SELECT id FROM doomed_feedback)) AS comments,
    (SELECT COUNT(*) FROM notifications WHERE feedback_id IN (SELECT id FROM doomed_feedback)) AS notifications
  `).get(...eligible.params, now, now) as IdentityRetentionCounts)()
}

export function cleanupIdentityBatch(db: Database.Database, role: IdentityRetentionRole, now = Date.now()): IdentityRetentionCounts {
  const eligible = candidates(role, now)
  return db.transaction(() => {
    const result = emptyCounts()
    // Persist activity before removing an expired child row: otherwise its
    // last successful auth could disappear from the MAX activity decision.
    const expired = db.prepare(`SELECT token_hash,device_id,created_at,last_seen_at
      FROM client_identity_sessions WHERE expires_at <= ?
      ORDER BY expires_at, token_hash LIMIT ?`).all(now, IDENTITY_RETENTION_ROW_BATCH_SIZE) as
      { token_hash: string; device_id: string; created_at: number; last_seen_at: number }[]
    const preserveActivity = db.prepare(`UPDATE client_identities SET
      token_hash = CASE WHEN token_hash = ? THEN '' ELSE token_hash END,
      last_seen_at = MAX(last_seen_at, ?, ?) WHERE device_id = ?`)
    for (const session of expired) {
      // Only the matching expired compatibility credential is cleared. Valid
      // sessions and the independent recovery hash are never overwritten.
      preserveActivity.run(session.token_hash, session.last_seen_at, session.created_at, session.device_id)
    }
    if (expired.length) {
      result.expiredSessions = db.prepare(`DELETE FROM client_identity_sessions WHERE token_hash IN (
        ${expired.map(() => '?').join(',')})`).run(...expired.map(row => row.token_hash)).changes
    }
    if (role === 'demo') {
      const doomed = db.prepare(`SELECT id FROM feedbacks WHERE device_id IN (${eligible.sql} ORDER BY i.last_seen_at,i.device_id LIMIT ?)
        ORDER BY id LIMIT ?`).all(...eligible.params, IDENTITY_RETENTION_BATCH_SIZE, IDENTITY_RETENTION_ROW_BATCH_SIZE) as { id: string }[]
      if (doomed.length) {
        const placeholders = doomed.map(() => '?').join(',')
        const ids = doomed.map(row => row.id)
        result.comments = db.prepare(`DELETE FROM feedback_comments WHERE feedback_id IN (${placeholders})`).run(...ids).changes
        result.notifications = db.prepare(`DELETE FROM notifications WHERE feedback_id IN (${placeholders})`).run(...ids).changes
        result.feedbacks = db.prepare(`DELETE FROM feedbacks WHERE id IN (${placeholders})`).run(...ids).changes
      }
    }
    const identities = db.prepare(`SELECT device_id FROM (${eligible.sql}) AS eligible
      WHERE NOT EXISTS (SELECT 1 FROM feedbacks f WHERE f.device_id = eligible.device_id)
      ORDER BY device_id LIMIT ?`).all(...eligible.params, IDENTITY_RETENTION_BATCH_SIZE) as { device_id: string }[]
    if (identities.length) {
      const placeholders = identities.map(() => '?').join(',')
      const ids = identities.map(row => row.device_id)
      // All session deletion shares one 500-row transaction budget. An old
      // identity with a large historical backlog remains until a later batch
      // removes its remaining sessions; no child row is left orphaned.
      result.identitySessions = db.prepare(`DELETE FROM client_identity_sessions WHERE token_hash IN (
        SELECT token_hash FROM client_identity_sessions WHERE device_id IN (${placeholders})
        ORDER BY device_id,token_hash LIMIT ?
      )`).run(...ids, IDENTITY_RETENTION_ROW_BATCH_SIZE - result.expiredSessions).changes
      const retired = db.prepare(`SELECT device_id FROM client_identities WHERE device_id IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM client_identity_sessions s WHERE s.device_id=client_identities.device_id)`).all(...ids) as { device_id: string }[]
      if (retired.length) {
        const retiredIds = retired.map(row => row.device_id)
        const retiredPlaceholders = retired.map(() => '?').join(',')
        result.installKeys = db.prepare(`DELETE FROM client_identity_install_keys WHERE device_id IN (${retiredPlaceholders})`).run(...retiredIds).changes
        result.identities = db.prepare(`DELETE FROM client_identities WHERE device_id IN (${retiredPlaceholders})`).run(...retiredIds).changes
      }
    }
    return result
  }).immediate()
}

interface RetentionOptions {
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  cancel?: (handle: NodeJS.Timeout) => void
}
interface RetentionLogger {
  info(message: string, metadata: IdentityRetentionCounts): unknown
  error(message: string, metadata: { code: string }): unknown
}
export function startIdentityRetention(db: Database.Database, role: IdentityRetentionRole, logger: RetentionLogger, options: RetentionOptions = {}) {
  initializeIdentityRetention(db)
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? setTimeout
  const cancel = options.cancel ?? clearTimeout
  let timer: NodeJS.Timeout | undefined
  let closed = false
  let runAt: number | undefined
  let totals = emptyCounts()
  const enqueue = (milliseconds: number) => {
    if (closed) return
    timer = schedule(tick, milliseconds)
    timer.unref?.()
  }
  const tick = () => {
    if (closed) return
    timer = undefined
    try {
      runAt ??= now()
      const deleted = cleanupIdentityBatch(db, role, runAt)
      for (const key of Object.keys(totals) as (keyof IdentityRetentionCounts)[]) totals[key] += deleted[key]
      if (Object.values(deleted).some(value => value > 0)) { enqueue(0); return }
      if (Object.values(totals).some(value => value > 0)) logger.info('Identity retention completed', totals)
    } catch (error) {
      const value = (error as { code?: unknown } | null)?.code
      const code = typeof value === 'string' && /^SQLITE_[A-Z_]+$/.test(value) ? value : 'RETENTION_ERROR'
      logger.error('Identity retention failed; will retry', { code })
    }
    totals = emptyCounts()
    runAt = undefined
    enqueue(IDENTITY_RETENTION_INTERVAL_MS)
  }
  enqueue(0)
  return { close() { closed = true; if (timer) cancel(timer); timer = undefined } }
}
