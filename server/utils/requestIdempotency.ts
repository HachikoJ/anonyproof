import type Database from 'better-sqlite3'
import type { ContentEncryption } from './contentEncryption'

export const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const IDEMPOTENCY_FUTURE_SKEW_MS = 5 * 60 * 1000
export class IdempotencyError extends Error {
  constructor(public readonly status: 400 | 401 | 404 | 409 | 410, public readonly code: string, message: string) {
    super(message)
  }
}
export type IdempotencyAction = 'feedback' | 'user_comment' | 'admin_comment'
type MutationResult<T> = { result: T; targetType: 'feedback' | 'comment'; targetId: string }
type Stored = { snapshot: string; snapshot_storage_version: number; target_type: string; target_id: string }

export function parseIdempotencyKey(value: string | undefined, now = Date.now()) {
  if (value === undefined) return undefined // Compatibility: old clients have no retry guarantee.
  const match = value.length <= 80 && /^v1:([0-9]{1,16}):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(value)
  if (!match || !Number.isSafeInteger(Number(match[1])) || String(Number(match[1])) !== match[1]) {
    throw new IdempotencyError(400, 'IDEMPOTENCY_KEY_INVALID', '请求动作编号格式无效，请先检查已有提交。')
  }
  const time = Number(match[1])
  if (time > now + IDEMPOTENCY_FUTURE_SKEW_MS) throw new IdempotencyError(400, 'IDEMPOTENCY_CLOCK_SKEW', '设备时间超前，请校准时间并先检查已有提交，不要自动重新提交。')
  if (time + IDEMPOTENCY_WINDOW_MS <= now) throw new IdempotencyError(409, 'IDEMPOTENCY_KEY_EXPIRED', '该动作已超过7天重试期限。请先检查已有提交或沟通记录，再决定是否另作提交。')
  return { key: value, createdAt: time, expiresAt: time + IDEMPOTENCY_WINDOW_MS }
}

export function initializeIdempotency(db: Database.Database, encryption: ContentEncryption) {
  // openDatabase verifies the instance/key before any application schema writes.
  // Recheck here too: importing this module cannot adopt a foreign content key.
  encryption.assertDatabaseKey(db)
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='request_idempotency'").get()
  if (existing) {
    const columns = (db.prepare('PRAGMA table_info(request_idempotency)').all() as { name: string }[]).map(row => row.name).sort().join(',')
    if (columns !== 'action,created_at,expires_at,id,request_key,scope,snapshot,snapshot_storage_version,target_id,target_type') {
      throw new Error('Unsupported idempotency metadata schema')
    }
  }
  db.transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS request_idempotency (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('feedback','user_comment','admin_comment')),
    request_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('feedback','comment')), target_id TEXT NOT NULL,
    snapshot TEXT NOT NULL, snapshot_storage_version INTEGER NOT NULL CHECK(snapshot_storage_version IN (0,1)),
    UNIQUE(scope, action, request_key)
  ); CREATE INDEX IF NOT EXISTS idx_request_idempotency_expiry ON request_idempotency(expires_at,id)`)).immediate()
}

export function executeIdempotent<T>(db: Database.Database, encryption: ContentEncryption,
  scope: string, action: IdempotencyAction, value: string | undefined, semantic: unknown,
  mutate: () => MutationResult<T>, now = Date.now()): T {
  const key = parseIdempotencyKey(value, now) // Expired keys are rejected even after cleanup.
  return db.transaction(() => {
    if (!key) return mutate().result
    const context = `request_idempotency:${scope}:${action}:${key.key}:snapshot`
    const prior = db.prepare(`SELECT snapshot,snapshot_storage_version,target_type,target_id FROM request_idempotency
      WHERE scope=? AND action=? AND request_key=?`).get(scope, action, key.key) as Stored | undefined
    if (prior) {
      const snapshot = JSON.parse(encryption.decrypt(prior.snapshot, context, prior.snapshot_storage_version)) as { semantic: unknown; result: T }
      if (JSON.stringify(snapshot.semantic) !== JSON.stringify(semantic)) {
        throw new IdempotencyError(409, 'IDEMPOTENCY_CONFLICT', '原动作与本次内容或目标不同。请先检查旧结果，明确另作提交后再更换动作编号。')
      }
      const exists = prior.target_type === 'feedback'
        ? db.prepare('SELECT 1 FROM feedbacks WHERE id=?').get(prior.target_id)
        : db.prepare('SELECT 1 FROM feedback_comments c INNER JOIN feedbacks f ON f.id=c.feedback_id WHERE c.id=?').get(prior.target_id)
      if (!exists) throw new IdempotencyError(410, 'IDEMPOTENCY_TARGET_GONE', '原动作对应的记录已删除，不会重新创建。')
      return snapshot.result
    }
    const created = mutate()
    db.prepare(`INSERT INTO request_idempotency(scope,action,request_key,created_at,expires_at,target_type,target_id,snapshot,snapshot_storage_version)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(scope, action, key.key, key.createdAt, key.expiresAt, created.targetType, created.targetId,
      encryption.encrypt(JSON.stringify({ semantic, result: created.result }), context), encryption.storageVersion)
    return created.result
  }).immediate()
}

export function cleanupIdempotency(db: Database.Database, now = Date.now()) {
  return db.transaction(() => db.prepare(`DELETE FROM request_idempotency WHERE id IN
    (SELECT id FROM request_idempotency WHERE expires_at<=? ORDER BY expires_at,id LIMIT 500)`).run(now).changes).immediate()
}
export function startIdempotencyCleanup(db: Database.Database, report: (message: string) => void = console.error) {
  const run = () => { try { cleanupIdempotency(db) } catch { report('Idempotency metadata cleanup failed; deleted=0') } }
  run()
  const timer = setInterval(run, 60000)
  timer.unref()
  return { close() { clearInterval(timer) } }
}
