import './env'
import express from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import {
  getAccessStatsOverview,
  getRecentAccessLogs,
  getSuspiciousAccessLogs,
  getIPBlacklist,
  unblacklistIP,
  startLogRetention,
} from './utils/accessStats'
import { accessStatsMiddleware } from './middleware/accessStats'
import { adminLoginLimiter, feedbackSubmitLimiter, feedbackIdentityLimiter, identityRecoveryLimiter, identityInitializationLimiter, positiveIntegerEnv, userCommentSourceLimiter, userCommentIdentityLimiter } from './middleware/rateLimit'
import { cookieWriteOriginGuard, exactCorsOrigin, parseAllowedOrigins } from './middleware/requestOrigin'
import { createProxyBoundary } from './middleware/proxyBoundary'
import { CommentPaginationError, getCommentPage, parseCommentPagination } from './utils/commentPagination'
import { getUserFeedbackPage } from './utils/userFeedbackPagination'
import { executeIdempotent, IdempotencyError, initializeIdempotency, startIdempotencyCleanup } from './utils/requestIdempotency'
import { openDatabase, databasePath } from './utils/database'
import { loadContentEncryption } from './utils/contentEncryption'
import { FeedbackPaginationError, getAdminFeedbackPage, parseFeedbackPagination } from './utils/adminFeedbackPagination'
import { createClientIdentity, IdentityCapacityError } from './clientIdentity'
import { createAdminAuth } from './adminAuth'
import { startIdentityRetention } from './utils/identityRetention'
import { logger } from './utils/logger'
import { MAX_ENCRYPTED_CONTENT_BYTES, validateCategory, validateCommentContent, validateDeviceId, validateFeedbackContent, validateSolutionContent, validateStatus } from './utils/validation'
import {
  DEMO_ADMIN_PASSWORD,
  DEMO_NOTICE,
  DEMO_TEMPLATE_IDS, DEMO_USER_COMMENTS, DEMO_ADMIN_COMMENTS, DEMO_SOLUTIONS,
  getDemoExamples, getDemoExample,
  isDemoMode,
  seedDemoData,
} from './demo'

const app = express()
const PORT = Number(process.env.PORT || 4000)
// 生产环境由 Nginx 反向代理到本机端口，默认只监听回环地址，避免后端端口直接暴露到公网。
const HOST = process.env.BIND_HOST || '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const demoMode = isDemoMode()
// Only fixed synthetic demo content may use the keyless codec.
const contentEncryption = loadContentEncryption({ demoMode, env: demoMode ? {} : process.env })
const adminAuth = createAdminAuth({
  env: process.env, demoMode, isProduction,
  getAllowedOrigins: () => allowedOrigins,
  ensureDemoIdentity: (req, res) => ensureDemoIdentity(req, res),
})
const maxIdentityRecords = positiveIntegerEnv('IDENTITY_MAX_RECORDS', 100000)

adminAuth.validateConfiguration()

// 中间件
app.use(['/api/identity', '/api/admin', '/api/feedback', '/api/notifications'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  // Protected JSON must always be re-authorized and returned in full. Express
  // otherwise treats a matching client ETag as a reason to send a 304.
  delete req.headers['if-none-match']
  delete req.headers['if-modified-since']
  next()
})
// Authenticate the proxy before any source quota, origin or business handling.
app.use(createProxyBoundary(process.env))
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS)
app.use(cors({ origin: exactCorsOrigin(allowedOrigins), credentials: true }))
// Reject before parsing/authentication can change sessions or business state.
app.use('/api', cookieWriteOriginGuard(allowedOrigins))
// Admit login POSTs before JSON parsing so malformed/oversized bodies consume
// the same source quota as successful and failed authentication attempts.
app.post(['/api/admin/auth/login', '/api/admin/login'], adminLoginLimiter)
app.post('/api/identity/recover', identityRecoveryLimiter)
// Allows worst-case escaped JSON for the bounded text/envelope, while placing
// an explicit cap on unrelated or malformed request bodies.
app.use(express.json({ limit: '384kb' }))
const jsonErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '无效的 JSON 请求' })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大' })
  next(error)
}
app.use(jsonErrorHandler)
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.use(accessStatsMiddleware)

app.get('/', (_req, res) => {
  const adminUiUrl = process.env.ADMIN_UI_URL || 'http://127.0.0.1:3000/anonyproof/foorpynona'
  res.type('html').send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AnonyProof 服务</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f9fc; color: #172033; }
      main { width: min(520px, calc(100% - 40px)); padding: 36px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 12px 32px rgba(30, 55, 90, .08); }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { color: #5e6b80; line-height: 1.6; }
      .status { display: inline-flex; align-items: center; gap: 8px; margin: 16px 0 24px; color: #087f62; font-weight: 600; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #28c79a; }
      a { display: inline-block; padding: 11px 16px; border-radius: 9px; background: #315efb; color: #fff; text-decoration: none; font-weight: 600; }
      small { display: block; margin-top: 20px; color: #8290a5; }
    </style>
  </head>
  <body>
    <main>
      <h1>AnonyProof API 服务</h1>
      <div class="status"><span class="dot"></span>服务运行正常</div>
      <p>管理员请先登录后台，再查看和处理匿名提交记录。普通用户请打开 AnonyProof 提交页面。</p>
      <a href="${adminUiUrl}">进入管理员后台</a>
      <small>健康检查：<a href="/health">/health</a></small>
    </main>
  </body>
</html>`)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/demo/config', (_req, res) => {
  if (!demoMode) {
    return res.json({ success: true, demoMode: false })
  }

  return res.json({
    success: true,
    demoMode: true,
    adminPassword: DEMO_ADMIN_PASSWORD,
    notice: DEMO_NOTICE,
    examples: getDemoExamples(), userComments: DEMO_USER_COMMENTS,
    adminComments: DEMO_ADMIN_COMMENTS, solutions: DEMO_SOLUTIONS,
  })
})

adminAuth.initializeSessionSigning()
const { cookieName, getCookie, requireSameOrigin, requireAdmin, isAdminAuthenticated } = adminAuth

app.post(['/api/admin/auth/login', '/api/admin/login'], adminAuth.login)
app.get(['/api/admin/auth/session', '/api/admin/session'], adminAuth.session)
app.post(['/api/admin/auth/logout', '/api/admin/logout'], adminAuth.logout)

app.use('/api/admin', requireAdmin)

// Public demo credentials never authorize raw access telemetry or blacklist changes.
app.use('/api/admin/access', (_req, res, next) => {
  if (demoMode) return res.status(403).json({ error: '公开演示不开放原始访问统计和日志' })
  next()
})

// 访问统计管理接口
app.get('/api/admin/access/stats', (_req, res) => {
  res.json({ success: true, data: getAccessStatsOverview() })
})
app.get('/api/admin/access/logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  res.json({ success: true, data: getRecentAccessLogs(limit) })
})
app.get('/api/admin/access/suspicious', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
  res.json({ success: true, data: getSuspiciousAccessLogs(limit) })
})
app.get('/api/admin/access/blacklist', (_req, res) => {
  res.json({ success: true, data: getIPBlacklist() })
})
app.delete('/api/admin/access/blacklist/:ip', (req, res) => {
  const result = unblacklistIP(req.params.ip)
  res.json({ success: true, removed: result.changes })
})

// 初始化数据库
const db = openDatabase()
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

function readFeedback(row: any) {
  const { original_content_storage_version, solution_storage_version, solution_admin_ip, ...record } = row
  return {
    ...record,
    original_content: contentEncryption.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, original_content_storage_version),
    solution: contentEncryption.decrypt(row.solution, `feedbacks:${row.id}:solution`, solution_storage_version),
  }
}
function readComment(row: any) {
  const { content_storage_version, admin_ip, ...record } = row
  return { ...record, content: contentEncryption.decrypt(row.content,
    `feedback_comments:${row.feedback_id}:${row.commenter_type}:content`, content_storage_version) }
}
function readNotification(row: any) {
  const { content_storage_version, admin_ip, ...record } = row
  const context = `notifications:${row.feedback_id}:${row.recipient_type}:${row.recipient_id}:${row.type}`
  return { ...record,
    title: contentEncryption.decrypt(row.title, `${context}:title`, content_storage_version),
    content: row.content === null && content_storage_version === 0 ? null
      : contentEncryption.decrypt(row.content, `${context}:content`, content_storage_version),
  }
}


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

const clientIdentity = createClientIdentity({
  db, demoMode, isProduction, maxIdentityRecords, identityCookieTtlMs,
  getCookie, isAdminAuthenticated, requireSameOrigin,
})
const { hashIdentityValue, identityFromCookie, requireClientIdentity, ensureDemoIdentity,
  demoRequestDevice, canAccessDevice, isDemoDeviceId } = clientIdentity

function mutationScope(req: express.Request, commenterType?: 'user' | 'admin') {
  const identity = commenterType === 'admin' ? null : identityFromCookie(req)
  if (identity) return `user:${identity.device_id}`
  if (isAdminAuthenticated(req)) return `admin:${hashIdentityValue(getCookie(req, cookieName) || '')}${demoMode ? `:sandbox:${demoRequestDevice(req)}` : ''}`
  throw new IdempotencyError(400, 'IDEMPOTENCY_IDENTITY_REQUIRED', '请先验证身份。')
}
function idempotencyHeader(req: express.Request) {
  // rawHeaders prevents repeated header lines being silently coalesced.
  if (req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'idempotency-key').length > 1) {
    throw new IdempotencyError(400, 'IDEMPOTENCY_KEY_INVALID', '请求动作编号不能重复。')
  }
  return req.get('Idempotency-Key')
}
function sendIdempotencyError(error: unknown, res: express.Response) {
  if (!(error instanceof IdempotencyError)) return false
  res.status(error.status).json({ success: false, error: error.message, code: error.code })
  return true
}

type RecordScope = { sql: string; params: string[] }
function adminRecordScope(req: express.Request, alias: string, writable = false): RecordScope {
  if (!demoMode) return { sql: `${alias}.is_demo_template = 0 AND ${alias}.is_demo_clone = 0`, params: [] }
  const markers = DEMO_TEMPLATE_IDS.map(id => `demo-encrypted:${id}`)
  const own = `(${alias}.is_demo_template = 0 AND ${alias}.is_demo_clone = 1 AND ${alias}.device_id = ? AND ${alias}.encrypted_content IN (${markers.map(() => '?').join(',')}))`
  if (writable) return { sql: own, params: [demoRequestDevice(req), ...markers] }
  return { sql: `(${own} OR (${alias}.is_demo_template = 1 AND ${alias}.id IN (${DEMO_TEMPLATE_IDS.map(() => '?').join(',')})))`,
    params: [demoRequestDevice(req), ...markers, ...DEMO_TEMPLATE_IDS] }
}
function userRecordScope(alias: string): RecordScope {
  if (!demoMode) return { sql: `${alias}.is_demo_template = 0 AND ${alias}.is_demo_clone = 0`, params: [] }
  const markers = DEMO_TEMPLATE_IDS.map(id => `demo-encrypted:${id}`)
  return { sql: `${alias}.is_demo_template = 0 AND ${alias}.is_demo_clone = 1 AND ${alias}.encrypted_content IN (${markers.map(() => '?').join(',')})`, params: markers }
}
function notificationVisibilitySql(req: express.Request, recipientType: string, writable = false): RecordScope {
  // Shared read-only templates have no per-browser notification read state.
  const scope = recipientType === 'admin' ? adminRecordScope(req, 'f', writable || demoMode) : userRecordScope('f')
  return { sql: `AND EXISTS (SELECT 1 FROM feedbacks f WHERE f.id = notifications.feedback_id
    ${recipientType === 'user' ? 'AND f.device_id = notifications.recipient_id' : ''} AND ${scope.sql})`, params: scope.params }
}
function notificationRecordVisible(req: express.Request, recipientType: string, recipientId: string, feedbackId: string | null) {
  if (!feedbackId) return false
  const scope = recipientType === 'admin' ? adminRecordScope(req, 'feedbacks', true) : userRecordScope('feedbacks')
  return Boolean(db.prepare(`SELECT 1 FROM feedbacks WHERE id = ?
    ${recipientType === 'user' ? 'AND device_id = ?' : ''} AND ${scope.sql}`)
    .get(feedbackId, ...(recipientType === 'user' ? [recipientId] : []), ...scope.params))
}

// Compatibility read: never create, bind, renew, clone or update last_seen.
// An installation key alone authorizes only the Origin-guarded POST path.
app.get('/api/identity', clientIdentity.readIdentity)
app.post('/api/identity', identityInitializationLimiter, clientIdentity.initializeIdentity)
app.post('/api/identity/recover', clientIdentity.recoverIdentity)

// 工具函数：记录管理员操作
const logAdminAction = (action: string, targetId: string, _ip: string) => {
  const stmt = db.prepare(
    'INSERT INTO admin_logs (action, target_id, admin_ip, created_at) VALUES (?, ?, ?, ?)'
  )
  stmt.run(action, targetId, '', Date.now())
}

// 工具函数：更新统计
const updateStats = () => {
  const feedbacks = db.prepare(`
    SELECT COUNT(*) AS count FROM feedbacks
    WHERE is_demo_clone = 0 AND is_demo_template = ${demoMode ? 1 : 0}${demoMode ? ` AND id IN (${DEMO_TEMPLATE_IDS.map(() => '?').join(',')})` : ''}
  `).get(...(demoMode ? DEMO_TEMPLATE_IDS : [])) as { count: number }
  const stats = db.prepare('UPDATE stats SET total_feedbacks = ?, encrypted_count = ? WHERE id = 1')
  stats.run(feedbacks.count, feedbacks.count)
}

// API: 提交反馈
app.post('/api/feedback', (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: '请求参数必须为对象' })
    }
    const example = demoMode ? getDemoExample(req.body.demoExampleId) : undefined
    if (demoMode && !example) return res.status(400).json({ error: '公开演示只接受固定合成案例' })
    const deviceId = req.body.deviceId
    const category = demoMode ? example!.category : req.body.category
    const originalContent = demoMode ? example!.originalContent : req.body.originalContent
    const encryptedContent = demoMode ? `demo-encrypted:${example!.id}` : req.body.encryptedContent
    const identity = requireClientIdentity(req, res)
    if (!identity) return

    const contentValidation = validateFeedbackContent(originalContent)
    if (!contentValidation.valid) {
      return res.status(400).json({ error: contentValidation.error })
    }
    if (!validateDeviceId(deviceId) || typeof encryptedContent !== 'string' || !encryptedContent.trim()) {
      return res.status(400).json({ error: '无效的身份或加密内容' })
    }
    if (Buffer.byteLength(encryptedContent, 'utf8') > MAX_ENCRYPTED_CONTENT_BYTES) {
      return res.status(413).json({ error: '加密内容过大' })
    }
    if (identity.device_id !== deviceId) {
      return res.status(403).json({ error: '本机身份与提交身份不一致' })
    }
    if (!validateCategory(category)) {
      return res.status(400).json({ error: '无效的提交类型' })
    }

    res.locals.feedbackSubmission = { deviceId, category, originalContent, encryptedContent }
    next()
  } catch (error) {
    console.error('校验反馈失败:', error)
    res.status(500).json({ error: '提交失败' })
  }
}, feedbackSubmitLimiter, feedbackIdentityLimiter, (req, res) => {
  try {
    const { deviceId, category, originalContent, encryptedContent } = res.locals.feedbackSubmission as {
      deviceId: string; category: string; originalContent: string; encryptedContent: string
    }
    const id = uuidv4()
    const createdAt = Date.now()

    const response = executeIdempotent(db, contentEncryption, mutationScope(req), 'feedback', idempotencyHeader(req),
      { category, originalContent, ...(demoMode ? { demoExampleId: req.body.demoExampleId } : {}) }, () => {
      db.transaction(() => {
      const stmt = db.prepare(
        'INSERT INTO feedbacks (id, category, encrypted_content, device_id, created_at, status, original_content, is_demo_clone, original_content_storage_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      // Discard the old client package: its embedded key must never accompany new formal data.
      const storedBody = contentEncryption.encrypt(originalContent, `feedbacks:${id}:original_content`)
      stmt.run(id, category, demoMode ? encryptedContent : 'server-encrypted:v1', deviceId, createdAt, 'pending', storedBody, demoMode ? 1 : 0, contentEncryption.storageVersion)

      updateStats()

      // 创建通知 - 通知管理员有新反馈
      const categoryName = category === 'suggestion' ? '建议' : category === 'complaint' ? '投诉' : '举报'
      const contentSummary = originalContent ? originalContent.substring(0, 50) + (originalContent.length > 50 ? '...' : '') : '（已加密）'
      createNotification(
        'admin',
        'admin',
        id,
        'new_feedback',
        `收到一条${categoryName}线索`,
        contentSummary
      )
      }).immediate()
      return { result: { success: true, id, timestamp: createdAt }, targetType: 'feedback', targetId: id }
    })
    res.json(response)
  } catch (error) {
    if (sendIdempotencyError(error, res)) return
    console.error('提交反馈失败:', error)
    res.status(500).json({ error: '提交失败' })
  }
})

// API: 获取统计（公开）
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT COUNT(*) AS total
      FROM feedbacks
      WHERE is_demo_clone = 0 AND is_demo_template = ${demoMode ? 1 : 0}${demoMode ? ` AND id IN (${DEMO_TEMPLATE_IDS.map(() => '?').join(',')})` : ''}
    `).get(...(demoMode ? DEMO_TEMPLATE_IDS : [])) as { total: number }
    res.json({
      total: stats.total,
      encrypted: stats.total,
      leaks: 0
    })
  } catch (error) {
    console.error('获取统计失败:', error)
    res.status(500).json({ error: '获取统计失败' })
  }
})

db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_admin_cursor ON feedbacks(created_at DESC, id DESC)')

// API: 获取反馈分页（管理员）
app.get('/api/admin/feedbacks', (req, res) => {
  try {
    // Cached parameter-free clients retain legacy fields, bounded to 100 rows.
    // Current clients use summary pagination; rolling UI back keeps this cap.
    const paginated = Object.keys(req.query).length > 0
    const pagination = paginated ? parseFeedbackPagination(req.query, demoMode ? `admin:${demoRequestDevice(req)}` : 'admin:formal') : undefined
    const ip = req.ip || req.socket.remoteAddress || 'unknown'

    // 记录查看操作
    logAdminAction('view_all', 'all', ip)

    const scope = adminRecordScope(req, 'feedbacks')
    if (pagination) return res.json(getAdminFeedbackPage(db, contentEncryption, scope, demoMode, pagination))
    const feedbacks = db.prepare(
      `SELECT id, category, encrypted_content, device_id, created_at, status, original_content, solution, solution_updated_at,
        is_demo_template, is_demo_clone, original_content_storage_version, solution_storage_version,
        CASE WHEN ${demoMode ? 'feedbacks.is_demo_template = 1' : '0'} THEN 0 ELSE
          (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'admin' AND n.recipient_id = 'admin' AND n.is_read = 0) END AS unread_notifications
       FROM feedbacks
       WHERE ${scope.sql}
       ORDER BY created_at DESC, id DESC LIMIT 100`
    ).all(...scope.params) as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...readFeedback(f),
        created_at: new Date(f.created_at).toISOString()
      }))
    })
  } catch (error) {
    if (error instanceof FeedbackPaginationError) return res.status(400).json({ error: error.message })
    console.error('获取反馈列表失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// API: 获取单个反馈详情（管理员）
app.get('/api/admin/feedback/:id', (req, res) => {
  try {
    const { id } = req.params
    const ip = req.ip || req.socket.remoteAddress || 'unknown'

    // 记录查看操作
    logAdminAction('view_detail', id, ip)

    const scope = adminRecordScope(req, 'feedbacks')
    const feedback = db.prepare(`
      SELECT id, category, encrypted_content, device_id, created_at, status,
        original_content, solution, solution_updated_at, solution_admin_ip,
        is_demo_template, is_demo_clone, original_content_storage_version, solution_storage_version
      FROM feedbacks
      WHERE id = ? AND ${scope.sql}
    `).get(id, ...scope.params) as any

    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }

    res.json({
      success: true,
      feedback: {
        ...readFeedback(feedback),
        created_at: new Date(feedback.created_at).toISOString()
      }
    })
  } catch (error) {
    console.error('获取反馈详情失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// API: 更新反馈状态和解决方案（管理员）
app.put('/api/admin/feedback/:id/status', (req, res) => {
  try {
    const { id } = req.params
    const status = req.body?.status
    const fixedSolution = demoMode ? DEMO_SOLUTIONS.find(item => item.id === req.body?.demoSolutionId && item.id === status) : undefined
    const solution = demoMode ? fixedSolution?.content : req.body?.solution
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const scope = adminRecordScope(req, 'feedbacks', true)
    const visibleFeedback = db.prepare(`
      SELECT id, status, solution, solution_storage_version FROM feedbacks
      WHERE id = ? AND ${scope.sql}
    `).get(id, ...scope.params) as { id: string; status: string; solution: string; solution_storage_version: number } | undefined

    if (!visibleFeedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }

    if (demoMode && !fixedSolution) return res.status(400).json({ error: '请选择固定演示处理说明' })
    if (!validateStatus(status)) {
      return res.status(400).json({ error: '无效的状态' })
    }

    const validation = validateSolutionContent(solution, status)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }
    const trimmedSolution = (solution ?? '').trim()

    const updated = db.transaction(() => {
      // Compare only after acquiring the write reservation; concurrent requests
      // must observe the committed status and avoid duplicate notifications.
      const currentFeedback = db.prepare(`
        SELECT id, status, solution, solution_storage_version FROM feedbacks
        WHERE id = ? AND ${scope.sql}
      `).get(id, ...scope.params) as { id: string; status: string; solution: string; solution_storage_version: number } | undefined
      if (!currentFeedback) return false
      // 记录操作
      logAdminAction('update_status', id, ip)

      const statusChanged = currentFeedback.status !== status
      const currentSolution = contentEncryption.decrypt(currentFeedback.solution, `feedbacks:${id}:solution`, currentFeedback.solution_storage_version)
      const solutionChanged = Boolean(trimmedSolution && trimmedSolution !== currentSolution)

      // 状态变化与处理说明相互独立：即使“处理中”暂未填写说明，也必须通知提交人。
      if (trimmedSolution) {
        db.prepare(
          'UPDATE feedbacks SET status = ?, solution = ?, solution_storage_version = ?, solution_updated_at = ?, solution_admin_ip = ? WHERE id = ?'
        ).run(status, contentEncryption.encrypt(trimmedSolution, `feedbacks:${id}:solution`), contentEncryption.storageVersion, Date.now(), '', id)
      } else {
        db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?').run(status, id)
      }

      const feedback = db.prepare('SELECT device_id, category FROM feedbacks WHERE id = ?').get(id) as any
      if (feedback && (statusChanged || solutionChanged)) {
        const categoryName = feedback.category === 'suggestion' ? '建议' : feedback.category === 'complaint' ? '投诉' : '举报'
        const statusLabel = status === 'in_progress' ? '处理中' : status === 'resolved' ? '已办结' : '暂无法处理'
        const solutionSummary = trimmedSolution
          ? trimmedSolution.substring(0, 50) + (trimmedSolution.length > 50 ? '...' : '')
          : ''
        createNotification(
          'user',
          feedback.device_id,
          id,
          'status_update',
          statusChanged ? `提交记录状态已更新：${statusLabel}` : `处理说明已更新：${statusLabel}`,
          `您提交的${categoryName}当前状态为“${statusLabel}”${solutionSummary ? `，处理说明：${solutionSummary}` : ''}`,
        )
      }
      return true
    }).immediate()
    if (!updated) return res.status(404).json({ error: '反馈不存在' })

    res.json({ success: true })
  } catch (error) {
    console.error('更新状态失败:', error)
    res.status(500).json({ error: '更新失败' })
  }
})

// API: 删除反馈（管理员）
app.delete('/api/admin/feedback/:id', (req, res) => {
  try {
    const { id } = req.params
    // 演示模板由服务端种子维护，重启后会重新写入，因此不允许删除；其余可访问记录允许删除。
    const scope = adminRecordScope(req, 'feedbacks', true)
    const deleted = db.transaction(() => {
      // Recheck scope after acquiring the write reservation, including demo
      // ownership and immutable templates. A missing/repeated delete is inert.
      const visibleFeedback = db.prepare(`
        SELECT id FROM feedbacks
        WHERE id = ? AND feedbacks.is_demo_template = 0 AND ${scope.sql}
      `).get(id, ...scope.params)
      if (!visibleFeedback) return false

      // Existing databases have no child foreign keys. Explicit child deletion
      // keeps both notification recipients and private comments in this same
      // transaction without modifying or cleaning historical orphan records.
      db.prepare('DELETE FROM feedback_comments WHERE feedback_id = ?').run(id)
      db.prepare('DELETE FROM notifications WHERE feedback_id = ?').run(id)
      db.prepare('DELETE FROM feedbacks WHERE id = ?').run(id)
      updateStats()
      // Retain only action/target/time; the compatibility NOT NULL IP column
      // stays empty. Never copy the erased business content into an audit row.
      logAdminAction('delete', id, '')
      return true
    }).immediate()
    if (!deleted) return res.status(404).json({ error: '反馈不存在' })

    res.json({ success: true })
  } catch (error) {
    console.error('删除反馈失败:', error)
    res.status(500).json({ error: '删除失败' })
  }
})

// API: 获取操作日志（管理员）
app.get('/api/admin/logs', (req, res) => {
  if (demoMode) return res.status(403).json({ error: '公开演示不开放原始操作日志' })
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'

    // 记录查看日志操作
    logAdminAction('view_logs', 'logs', ip)

    const logs = db.prepare(
      'SELECT id,action,target_id,created_at FROM admin_logs ORDER BY created_at DESC LIMIT 100'
    ).all()

    res.json({
      success: true,
      logs: logs.map((log: any) => ({
        ...log,
        created_at: new Date(log.created_at).toISOString()
      }))
    })
  } catch (error) {
    console.error('获取日志失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

db.exec('CREATE INDEX IF NOT EXISTS idx_comments_thread_cursor ON feedback_comments(feedback_id,created_at DESC,id DESC)')

// API: 获取反馈的评论分页
app.get('/api/feedback/:feedbackId/comments', (req, res) => {
  try {
    const feedbackId = String(req.params.feedbackId)
    const admin = isAdminAuthenticated(req)
    const scope = admin ? adminRecordScope(req, 'feedbacks') : userRecordScope('feedbacks')
    const feedback = db.prepare(`
      SELECT device_id FROM feedbacks
      WHERE id = ? AND ${scope.sql}
    `).get(feedbackId, ...scope.params) as { device_id: string } | undefined

    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }
    if (!admin && !canAccessDevice(req, feedback.device_id)) {
      return res.status(401).json({ error: '无权查看该记录的沟通内容' })
    }

    const options = parseCommentPagination(req.query, JSON.stringify([feedbackId,
      admin ? (demoMode ? `admin:${demoRequestDevice(req)}` : 'admin:formal') : `user:${feedback.device_id}`]))
    if (Object.keys(req.query).length) return res.json(getCommentPage(db, contentEncryption, feedbackId, options))
    // Cached clients retain their response fields, capped to the latest 100
    // comments in chronological order. No parameter-free unbounded path.
    const comments = (db.prepare(
      'SELECT * FROM feedback_comments WHERE feedback_id = ? ORDER BY created_at DESC,id DESC LIMIT 100'
    ).all(feedbackId) as any[]).reverse()

    res.json({
      success: true,
      comments: comments.map(c => ({
        ...readComment(c),
        created_at: new Date(c.created_at).toISOString()
      }))
    })
  } catch (error) {
    if (error instanceof CommentPaginationError) return res.status(400).json({ error: error.message })
    console.error('获取评论失败:', error)
    res.status(500).json({ error: '获取评论失败' })
  }
})

// API: 添加评论
const addFeedbackComment = (req: express.Request, res: express.Response, commenterType: 'user' | 'admin') => {
  try {
    const feedbackId = String(req.params.feedbackId)
    const fixedComment = demoMode ? (commenterType === 'admin' ? DEMO_ADMIN_COMMENTS : DEMO_USER_COMMENTS).find(item => item.id === req.body?.demoCommentId) : undefined
    const content = demoMode ? fixedComment?.content : req.body?.content
    const scope = commenterType === 'admin' ? adminRecordScope(req, 'feedbacks', true) : userRecordScope('feedbacks')
    if (demoMode && !fixedComment) return res.status(400).json({ error: '请选择固定演示回复' })
    const validation = validateCommentContent(content)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    const createdAt = Date.now()
    const adminIp = null

    const response = executeIdempotent(db, contentEncryption, mutationScope(req, commenterType),
      commenterType === 'admin' ? 'admin_comment' : 'user_comment', idempotencyHeader(req),
      { feedbackId, commenterType, content: content.trim(), ...(demoMode ? { demoCommentId: req.body.demoCommentId } : {}) }, () => {
    const feedback = db.prepare(`
      SELECT device_id, category, original_content FROM feedbacks
      WHERE id = ? AND ${scope.sql}
    `).get(feedbackId, ...scope.params) as { device_id: string; category: string; original_content: string } | undefined

    if (!feedback) {
      throw new IdempotencyError(404, 'FEEDBACK_NOT_FOUND', '反馈不存在。')
    }
    if (commenterType === 'user' && !canAccessDevice(req, feedback.device_id)) {
      throw new IdempotencyError(401, 'FEEDBACK_UNAUTHORIZED', '无权补充该记录')
    }
    const result = db.transaction(() => {
      // Recheck the scoped parent while holding the write reservation.
      const currentFeedback = db.prepare(`
        SELECT device_id, category FROM feedbacks
        WHERE id = ? AND ${scope.sql}
      `).get(feedbackId, ...scope.params) as { device_id: string; category: string } | undefined
      if (!currentFeedback) return undefined
      if (commenterType === 'user' && !canAccessDevice(req, currentFeedback.device_id)) return undefined
      const stmt = db.prepare(
        'INSERT INTO feedback_comments (feedback_id, commenter_type, content, created_at, admin_ip, content_storage_version) VALUES (?, ?, ?, ?, ?, ?)'
      )
      const result = stmt.run(feedbackId, commenterType, contentEncryption.encrypt(content.trim(), `feedback_comments:${feedbackId}:${commenterType}:content`), createdAt, adminIp, contentEncryption.storageVersion)

      // 创建通知
      if (commenterType === 'admin') {
        // 管理员评论 -> 通知用户
        const categoryName = currentFeedback.category === 'suggestion' ? '建议' : currentFeedback.category === 'complaint' ? '投诉' : '举报'
        const summary = content.trim().substring(0, 50) + (content.trim().length > 50 ? '...' : '')
        createNotification(
          'user',
          currentFeedback.device_id,
          feedbackId,
          'comment',
          '处理人员回复了您的提交',
          `您提交的${categoryName}收到一条回复：${summary}`
        )
      } else {
        // 用户评论 -> 通知管理员
        const categoryName = currentFeedback.category === 'suggestion' ? '建议' : currentFeedback.category === 'complaint' ? '投诉' : '举报'
        const summary = content.trim().substring(0, 50) + (content.trim().length > 50 ? '...' : '')
        createNotification(
          'admin',
          'admin',
          feedbackId,
          'comment',
          '提交人补充了说明',
          `该${categoryName}线索收到一条补充：${summary}`
        )
      }
      return result
    }).immediate()
    if (!result) throw new IdempotencyError(404, 'FEEDBACK_NOT_FOUND', '反馈不存在。')
    return { result: { id: Number(result.lastInsertRowid), feedback_id: feedbackId, commenter_type: commenterType,
      created_at: new Date(createdAt).toISOString() }, targetType: 'comment', targetId: String(result.lastInsertRowid) }
    })
    res.json({ success: true, comment: { ...response, content: content.trim() } })
  } catch (error) {
    if (sendIdempotencyError(error, res)) return
    console.error('添加评论失败:', error)
    res.status(500).json({ error: '添加评论失败' })
  }
}

app.post('/api/feedback/:feedbackId/comments', (req, res, next) => {
  try {
    const scope = userRecordScope('feedbacks')
    const parent = db.prepare(`SELECT device_id FROM feedbacks WHERE id = ? AND ${scope.sql}`)
      .get(String(req.params.feedbackId), ...scope.params) as { device_id: string } | undefined
    if (!parent && !(req.get('Idempotency-Key') && (isAdminAuthenticated(req) || identityFromCookie(req)))) return res.status(404).json({ error: '反馈不存在' })
    if (parent && !canAccessDevice(req, parent.device_id)) return res.status(401).json({ error: '无权补充该记录' })
    const caller = identityFromCookie(req)
    // Preserve the existing formal-admin access to this user-comment route.
    // Quotas follow the authenticated caller, never a caller-selected record.
    res.locals.commenterQuotaKey = caller ? `user:${caller.device_id}`
      : `admin:${hashIdentityValue(getCookie(req, cookieName) || '')}`
    next()
  } catch (error) {
    console.error('校验评论身份失败:', error)
    res.status(500).json({ error: '添加评论失败' })
  }
}, userCommentSourceLimiter, userCommentIdentityLimiter, (req, res) => addFeedbackComment(req, res, 'user'))
app.post('/api/admin/feedback/:feedbackId/comments', (req, res) => addFeedbackComment(req, res, 'admin'))

db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_device_cursor ON feedbacks(device_id, created_at DESC, id DESC)')

// Compatibility fields are retained for parameter-free cached clients, bounded
// to 100 rows. The current frontend opts into summaries and global counts.
// API: 获取某设备的反馈分页
app.get('/api/feedback/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params
    if (!canAccessDevice(req, deviceId)) {
      return res.status(401).json({ error: '无权查看该浏览器的提交记录' })
    }

    const scope = userRecordScope('feedbacks')
    const options = parseFeedbackPagination(req.query, `user:${deviceId}`)
    if (Object.keys(req.query).length) return res.json(getUserFeedbackPage(db, contentEncryption, deviceId, scope, options))
    const feedbacks = db.prepare(
      `SELECT id, category, original_content, created_at, status, solution, solution_updated_at, original_content_storage_version, solution_storage_version,
        (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'user' AND n.recipient_id = ? AND n.is_read = 0) AS unread_notifications
       FROM feedbacks
       WHERE device_id = ? AND ${scope.sql}
       ORDER BY created_at DESC, id DESC LIMIT 100`
    ).all(deviceId, deviceId, ...scope.params) as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...readFeedback(f),
        created_at: new Date(f.created_at).toISOString()
      }))
    })
  } catch (error) {
    if (error instanceof FeedbackPaginationError) return res.status(400).json({ error: error.message })
    console.error('获取设备反馈失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// Full text is loaded only after record authorization, including notification
// targets outside the currently displayed page and active filters.
app.get('/api/feedback/:feedbackId', (req, res) => {
  try {
    const scope = userRecordScope('feedbacks')
    const row = db.prepare(`SELECT id, device_id, category, created_at, status,
      original_content, solution, solution_updated_at, original_content_storage_version, solution_storage_version,
      (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id=feedbacks.id
        AND n.recipient_type='user' AND n.recipient_id=feedbacks.device_id AND n.is_read=0) AS unread_notifications
      FROM feedbacks WHERE id=? AND ${scope.sql}`).get(String(req.params.feedbackId), ...scope.params) as any
    if (!row) return res.status(404).json({ error: '反馈不存在' })
    if (!canAccessDevice(req, row.device_id)) return res.status(401).json({ error: '无权查看该记录' })
    const record = readFeedback(row)
    res.json({ success: true, feedback: { id: record.id, category: record.category,
      created_at: new Date(record.created_at).toISOString(), status: record.status,
      original_content: record.original_content, solution: record.solution,
      solution_updated_at: record.solution_updated_at, unread_notifications: record.unread_notifications } })
  } catch (error) {
    console.error('获取反馈详情失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// 工具函数：创建通知
const createNotification = (
  recipientType: 'user' | 'admin',
  recipientId: string,
  feedbackId: string,
  type: 'comment' | 'status_update' | 'new_feedback',
  title: string,
  content: string
) => {
  // 演示模板归属内置演示设备，没有真实浏览器能登录该身份，因此不必为它生成用户通知。
  if (recipientType === 'user' && isDemoDeviceId(recipientId)) return

  const stmt = db.prepare(
    'INSERT INTO notifications (recipient_type, recipient_id, feedback_id, type, title, content, created_at, content_storage_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  // Required notification failures propagate into the caller's transaction.
  const context = `notifications:${feedbackId}:${recipientType}:${recipientId}:${type}`
  stmt.run(recipientType, recipientId, feedbackId, type,
    contentEncryption.encrypt(title, `${context}:title`), contentEncryption.encrypt(content, `${context}:content`),
    Date.now(), contentEncryption.storageVersion)
}

// API: 获取未读通知数量
app.get('/api/notifications/unread-count', (req, res) => {
  try {
    const { recipientType, recipientId } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }
    if (!['user', 'admin'].includes(String(recipientType))) {
      return res.status(400).json({ error: '无效的通知接收方' })
    }
    if (recipientType === 'admin' && (recipientId !== 'admin' || !isAdminAuthenticated(req))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (recipientType === 'user') {
      const identity = requireClientIdentity(req, res)
      if (!identity) return
      if (identity.device_id !== recipientId) {
        return res.status(403).json({ error: '无权查看该浏览器的通知' })
      }
    }

    const visibility = notificationVisibilitySql(req, String(recipientType))
    const count = db.prepare(
      `SELECT COUNT(*) as count
       FROM notifications
       WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0 ${visibility.sql}`
    ).get(recipientType, recipientId, ...visibility.params) as { count: number }

    res.json({
      success: true,
      count: count.count
    })
  } catch (error) {
    console.error('获取未读数量失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// API: 获取通知列表
app.get('/api/notifications', (req, res) => {
  try {
    const { recipientType, recipientId, limit = '20' } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }
    if (!['user', 'admin'].includes(String(recipientType))) {
      return res.status(400).json({ error: '无效的通知接收方' })
    }
    if (recipientType === 'admin' && (recipientId !== 'admin' || !isAdminAuthenticated(req))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (recipientType === 'user') {
      const identity = requireClientIdentity(req, res)
      if (!identity) return
      if (identity.device_id !== recipientId) {
        return res.status(403).json({ error: '无权查看该浏览器的通知' })
      }
    }

    const notificationLimit = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN
    if (!Number.isSafeInteger(notificationLimit) || notificationLimit < 1 || notificationLimit > 100 ||
        Object.keys(req.query).some((key) => key.startsWith('limit['))) {
      return res.status(400).json({ error: 'limit 必须是 1 到 100 的整数' })
    }

    const visibility = notificationVisibilitySql(req, String(recipientType))
    const notifications = db.prepare(
      `SELECT * FROM notifications
       WHERE recipient_type = ? AND recipient_id = ? ${visibility.sql}
       ORDER BY created_at DESC LIMIT ?`
    ).all(recipientType, recipientId, ...visibility.params, notificationLimit) as any[]

    res.json({
      success: true,
      notifications: notifications.map(n => ({
        ...readNotification(n),
        created_at: new Date(n.created_at).toISOString()
      }))
    })
  } catch (error) {
    console.error('获取通知列表失败:', error)
    res.status(500).json({ error: '获取失败' })
  }
})

// API: 标记通知为已读
app.put('/api/notifications/:id/read', (req, res) => {
  try {
    const { id } = req.params
    const notification = db.prepare(
      'SELECT recipient_type, recipient_id, feedback_id FROM notifications WHERE id = ?',
    ).get(id) as { recipient_type: string; recipient_id: string; feedback_id: string | null } | undefined
    if (!notification) {
      return res.status(404).json({ error: '通知不存在' })
    }
    if (notification.recipient_type === 'admin' && (notification.recipient_id !== 'admin' || !isAdminAuthenticated(req))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (notification.recipient_type === 'user') {
      const identity = requireClientIdentity(req, res)
      if (!identity) return
      if (identity.device_id !== notification.recipient_id) {
        return res.status(403).json({ error: '无权操作该通知' })
      }
    }
    if (!notificationRecordVisible(
      req,
      notification.recipient_type,
      notification.recipient_id,
      notification.feedback_id,
    )) {
      return res.status(404).json({ error: '通知对应的记录已不可用' })
    }

    const stmt = notification.recipient_type === 'admin'
      ? db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_type = 'admin' AND recipient_id = 'admin'")
      : db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_type = 'user' AND recipient_id = ?")
    const result = notification.recipient_type === 'admin'
      ? stmt.run(id)
      : stmt.run(id, notification.recipient_id)

    res.json({ success: true, updated: result.changes })
  } catch (error) {
    console.error('标记已读失败:', error)
    res.status(500).json({ error: '标记失败' })
  }
})

// API: 标记通知为未读
app.put('/api/notifications/:id/unread', (req, res) => {
  try {
    const { id } = req.params
    const notification = db.prepare(
      'SELECT recipient_type, recipient_id, feedback_id FROM notifications WHERE id = ?',
    ).get(id) as { recipient_type: string; recipient_id: string; feedback_id: string | null } | undefined
    if (!notification) {
      return res.status(404).json({ error: '通知不存在' })
    }
    if (notification.recipient_type === 'admin' && (notification.recipient_id !== 'admin' || !isAdminAuthenticated(req))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (notification.recipient_type === 'user') {
      const identity = requireClientIdentity(req, res)
      if (!identity) return
      if (identity.device_id !== notification.recipient_id) {
        return res.status(403).json({ error: '无权操作该通知' })
      }
    }
    if (!notificationRecordVisible(
      req,
      notification.recipient_type,
      notification.recipient_id,
      notification.feedback_id,
    )) {
      return res.status(404).json({ error: '通知对应的记录已不可用' })
    }

    const stmt = notification.recipient_type === 'admin'
      ? db.prepare("UPDATE notifications SET is_read = 0 WHERE id = ? AND recipient_type = 'admin' AND recipient_id = 'admin'")
      : db.prepare("UPDATE notifications SET is_read = 0 WHERE id = ? AND recipient_type = 'user' AND recipient_id = ?")
    const result = notification.recipient_type === 'admin'
      ? stmt.run(id)
      : stmt.run(id, notification.recipient_id)

    res.json({ success: true, updated: result.changes })
  } catch (error) {
    console.error('标记未读失败:', error)
    res.status(500).json({ error: '标记失败' })
  }
})

// API: 标记所有通知为已读
app.put('/api/notifications/read-all', (req, res) => {
  try {
    const { recipientType, recipientId, feedbackId } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }
    if (!['user', 'admin'].includes(String(recipientType))) {
      return res.status(400).json({ error: '无效的通知接收方' })
    }
    if (recipientType === 'admin' && (recipientId !== 'admin' || !isAdminAuthenticated(req))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }
    if (recipientType === 'user') {
      const identity = requireClientIdentity(req, res)
      if (!identity) return
      if (identity.device_id !== recipientId) {
        return res.status(403).json({ error: '无权操作该浏览器的通知' })
      }
    }

    if (feedbackId && (typeof feedbackId !== 'string' || !notificationRecordVisible(req, String(recipientType), String(recipientId), feedbackId))) {
      return res.status(404).json({ error: '通知对应的记录不可修改' })
    }
    const visibility = notificationVisibilitySql(req, String(recipientType), true)
    const stmt = feedbackId
      ? db.prepare(`UPDATE notifications
          SET is_read = 1
          WHERE recipient_type = ? AND recipient_id = ? AND feedback_id = ? AND is_read = 0 ${visibility.sql}`)
      : db.prepare(`UPDATE notifications
          SET is_read = 1
          WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0 ${visibility.sql}`)
    const result = feedbackId ? stmt.run(recipientType, recipientId, feedbackId, ...visibility.params) : stmt.run(recipientType, recipientId, ...visibility.params)

    res.json({
      success: true,
      count: result.changes
    })
  } catch (error) {
    console.error('标记全部已读失败:', error)
    res.status(500).json({ error: '标记失败' })
  }
})

// Capacity is checked before any new identity/session/demo clone is written,
// including implicit identity issuance during a demo administrator login.
const identityCapacityErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  // Express's default URI decode error includes the raw route parameter in
  // stderr. Keep the 400 response without retaining that identifier.
  if (error instanceof URIError && !res.headersSent) {
    res.status(400).json({ error: 'Invalid request path' })
    return
  }
  if (error instanceof IdentityCapacityError && !res.headersSent) {
    res.status(503).json({ error: error.message })
    return
  }
  next(error)
}
app.use(identityCapacityErrorHandler)

// 启动服务器
const apiServer = app.listen(PORT, HOST, () => {
  const idempotencyCleanup = startIdempotencyCleanup(db)
  apiServer.once('close', () => idempotencyCleanup.close())
  const logRetention = startLogRetention()
  apiServer.once('close', () => logRetention.close())
  const identityRetention = startIdentityRetention(db, demoMode ? 'demo' : 'formal', logger)
  apiServer.once('close', () => identityRetention.close())
  console.log(`AnonyProof API Server running on ${HOST}:${PORT}`)
  console.log(`Database: ${databasePath}`)
  if (demoMode) {
    console.warn(`DEMO MODE ENABLED: ${DEMO_NOTICE}`)
    console.warn(`Demo admin password: ${DEMO_ADMIN_PASSWORD}`)
  }
})
