import type Database from 'better-sqlite3'

export const RAW_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const LOG_RETENTION_INTERVAL_MS = 60 * 60 * 1000
export const LOG_RETENTION_BATCH_SIZE = 500

export interface LogRetentionCounts {
  accessLogs: number
  rateLimitLogs: number
}

function cutoffAt(now: number) {
  if (!Number.isSafeInteger(now) || now < RAW_LOG_RETENTION_MS) {
    throw new Error('Invalid log retention time')
  }
  return now - RAW_LOG_RETENTION_MS
}

// Counts only: this does not authorize or perform historical asset deletion.
export function countExpiredRawLogs(db: Database.Database, now = Date.now()): LogRetentionCounts {
  const cutoff = cutoffAt(now)
  return db.transaction(() => ({
    accessLogs: (db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE created_at < ?').get(cutoff) as { n: number }).n,
    rateLimitLogs: (db.prepare('SELECT COUNT(*) AS n FROM rate_limit_logs WHERE created_at < ?').get(cutoff) as { n: number }).n,
  }))()
}

// Two bounded deletes commit together. No aggregate, blacklist or business table
// participates, and the exact seven-day boundary is retained.
export function cleanupRawLogBatch(db: Database.Database, now = Date.now()): LogRetentionCounts {
  const cutoff = cutoffAt(now)
  return db.transaction(() => ({
    accessLogs: db.prepare(`DELETE FROM access_logs WHERE id IN (
      SELECT id FROM access_logs WHERE created_at < ? ORDER BY created_at, id LIMIT ?
    )`).run(cutoff, LOG_RETENTION_BATCH_SIZE).changes,
    rateLimitLogs: db.prepare(`DELETE FROM rate_limit_logs WHERE id IN (
      SELECT id FROM rate_limit_logs WHERE created_at < ? ORDER BY created_at, id LIMIT ?
    )`).run(cutoff, LOG_RETENTION_BATCH_SIZE).changes,
  })).immediate()
}

interface RetentionLogger {
  info(message: string, metadata: LogRetentionCounts): unknown
  error(message: string, metadata: { code: string }): unknown
}

interface RetentionOptions {
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  cancel?: (handle: NodeJS.Timeout) => void
}

// A fresh process starts a fresh schedule. Each batch yields to the event loop;
// missed runs resume on restart rather than relying on traffic to trigger work.
export function scheduleRawLogRetention(
  db: Database.Database,
  logger: RetentionLogger,
  options: RetentionOptions = {},
) {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? setTimeout
  const cancel = options.cancel ?? clearTimeout
  let closed = false
  let timer: NodeJS.Timeout | undefined
  let runAt: number | undefined
  let totals: LogRetentionCounts = { accessLogs: 0, rateLimitLogs: 0 }

  const enqueue = (delayMs: number) => {
    if (closed) return
    timer = schedule(tick, delayMs)
    timer.unref?.()
  }
  const tick = () => {
    if (closed) return
    timer = undefined
    try {
      runAt ??= now()
      const removed = cleanupRawLogBatch(db, runAt)
      totals.accessLogs += removed.accessLogs
      totals.rateLimitLogs += removed.rateLimitLogs
      if (removed.accessLogs || removed.rateLimitLogs) {
        enqueue(0)
        return
      }
      if (totals.accessLogs || totals.rateLimitLogs) {
        logger.info('Raw log retention completed', totals)
      }
    } catch (error) {
      // SQLite messages may contain paths or user-controlled trigger contents.
      // Record a whitelisted code only; retry on the next scheduled run.
      const rawCode = (error as { code?: unknown } | null)?.code
      const code = typeof rawCode === 'string' && /^SQLITE_[A-Z_]+$/.test(rawCode)
        ? rawCode : 'RETENTION_ERROR'
      logger.error('Raw log retention failed; will retry', { code })
    }
    runAt = undefined
    totals = { accessLogs: 0, rateLimitLogs: 0 }
    enqueue(LOG_RETENTION_INTERVAL_MS)
  }
  enqueue(0)
  return {
    close() {
      closed = true
      if (timer) cancel(timer)
      timer = undefined
    },
  }
}
