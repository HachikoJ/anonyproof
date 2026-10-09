import type Database from 'better-sqlite3'
import type { ContentEncryption } from './utils/contentEncryption'
import { initializeIdempotency } from './utils/requestIdempotency'
import { seedDemoData } from './demo'

// Only the entrypoint's existing business initialization moves here. Database
// role/WAL/foreign-key and access-stat initialization remain in their existing modules.
export function initializeBusinessSchema(db: Database.Database, contentEncryption: ContentEncryption, demoMode: boolean) {
  // Verify an existing marker before business schema or seeds can be changed.
  contentEncryption.assertDatabaseKey(db)

  // 创建表
  db.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    is_demo_template INTEGER NOT NULL DEFAULT 0,
    is_demo_clone INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_feedbacks INTEGER DEFAULT 0,
    encrypted_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    feedback_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id TEXT NOT NULL,
    commenter_type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    admin_ip TEXT,
    attachment_id TEXT
  );

  CREATE TABLE IF NOT EXISTS client_identities (
    device_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    recovery_hash TEXT NOT NULL UNIQUE,
    install_key_hash TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    demo_initialized INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS client_identity_sessions (
    token_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_identity_install_keys (
    install_key_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id ON feedback_comments(feedback_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_type, recipient_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_feedback_id ON notifications(feedback_id);
  CREATE INDEX IF NOT EXISTS idx_client_identity_sessions_device ON client_identity_sessions(device_id);
  CREATE INDEX IF NOT EXISTS idx_client_identity_install_keys_device ON client_identity_install_keys(device_id);

  INSERT OR IGNORE INTO stats (id, total_feedbacks, encrypted_count)
  VALUES (1, 0, 0);
`)

  // Upgrade databases created by earlier versions without changing existing records.
  const feedbackColumns = db.prepare('PRAGMA table_info(feedbacks)').all() as Array<{ name: string }>
  const existingFeedbackColumns = new Set(feedbackColumns.map(column => column.name))
  const feedbackMigrations: Array<[string, string]> = [
    ['original_content', "TEXT NOT NULL DEFAULT ''"],
    ['solution', "TEXT NOT NULL DEFAULT ''"],
    ['original_content_storage_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['solution_storage_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['solution_updated_at', 'INTEGER'],
    ['solution_admin_ip', "TEXT NOT NULL DEFAULT ''"],
    ['is_demo_template', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_demo_clone', 'INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [column, definition] of feedbackMigrations) {
    if (!existingFeedbackColumns.has(column)) db.exec(`ALTER TABLE feedbacks ADD COLUMN ${column} ${definition}`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_demo_visibility ON feedbacks(is_demo_template, is_demo_clone)')
  for (const table of ['feedback_comments', 'notifications']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(column => column.name === 'content_storage_version')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN content_storage_version INTEGER NOT NULL DEFAULT 0`)
    }
  }

  // Storage flags are internal. Authorization is performed by each caller before
  // decrypting; public response shapes continue to return the authorized plaintext.
  initializeIdempotency(db, contentEncryption)

  const identityColumns = db.prepare('PRAGMA table_info(client_identities)').all() as Array<{ name: string }>
  if (!identityColumns.some(column => column.name === 'install_key_hash')) {
    db.exec('ALTER TABLE client_identities ADD COLUMN install_key_hash TEXT')
  }
  db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_client_identity_install_key
  ON client_identities(install_key_hash)
  WHERE install_key_hash IS NOT NULL
`)
  db.prepare(`
  INSERT OR IGNORE INTO client_identity_install_keys (
    install_key_hash, device_id, created_at, last_seen_at
  )
  SELECT install_key_hash, device_id, created_at, last_seen_at
  FROM client_identities
  WHERE install_key_hash IS NOT NULL AND install_key_hash <> ''
`).run()

  if (demoMode) {
    seedDemoData(db)
  }

  const identityCookieTtlMs = 365 * 24 * 60 * 60 * 1000

  // 旧版本只保存了一个 token_hash。升级后把它迁移为独立会话，保证同一身份在多个浏览器
  // 使用恢复码登录时不会互相踢下线，也不会覆盖后续新会话。
  db.prepare(`
  INSERT OR IGNORE INTO client_identity_sessions (
    token_hash, device_id, created_at, last_seen_at, expires_at
  )
  SELECT token_hash, device_id, created_at, last_seen_at, last_seen_at + ?
  FROM client_identities
  WHERE token_hash <> ''
`).run(identityCookieTtlMs)

  return { identityCookieTtlMs }
}

// Called at the original cursor-index registration point in index.ts.
export function initializeAdminCursorIndex(db: Database.Database) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_admin_cursor ON feedbacks(created_at DESC, id DESC)')
}

// Called at the original cursor-index registration point in index.ts.
export function initializeCommentCursorIndex(db: Database.Database) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_thread_cursor ON feedback_comments(feedback_id,created_at DESC,id DESC)')
}

// Called at the original cursor-index registration point in index.ts.
export function initializeDeviceCursorIndex(db: Database.Database) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_device_cursor ON feedbacks(device_id, created_at DESC, id DESC)')
}
