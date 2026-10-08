import './env'
import express from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import {
  getAccessStatsOverview,
  getRecentAccessLogs,
  getSuspiciousAccessLogs,
  getIPBlacklist,
  unblacklistIP,
} from './utils/accessStats'
import { accessStatsMiddleware } from './middleware/accessStats'
import { adminLoginLimiter, feedbackSubmitLimiter, feedbackIdentityLimiter, identityRecoveryLimiter, identityInitializationLimiter, positiveIntegerEnv, userCommentSourceLimiter, userCommentIdentityLimiter } from './middleware/rateLimit'
import { cookieWriteOriginGuard, exactCorsOrigin, isTrustedRequestOrigin, parseAllowedOrigins } from './middleware/requestOrigin'
import { openDatabase, databasePath } from './utils/database'
import { loadContentEncryption } from './utils/contentEncryption'
import { MAX_ENCRYPTED_CONTENT_BYTES, validateCategory, validateCommentContent, validateDeviceId, validateFeedbackContent, validateSolutionContent, validateStatus } from './utils/validation'
import {
  DEMO_ADMIN_PASSWORD,
  DEMO_DEVICE_ID,
  DEMO_NOTICE,
  DEMO_TEMPLATE_IDS, DEMO_USER_COMMENTS, DEMO_ADMIN_COMMENTS, DEMO_SOLUTIONS,
  getDemoExamples, getDemoExample,
  DEMO_SECONDARY_DEVICE_ID,
  cloneDemoDataForDevice,
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
const configuredAdminPassword = process.env.ADMIN_PASSWORD?.trim()
// Demo mode always uses the published password so the login hint cannot drift from the server.
const adminPassword = demoMode ? DEMO_ADMIN_PASSWORD : configuredAdminPassword
const sessionSecret = process.env.SESSION_SECRET
const sessionTtlMs = 8 * 60 * 60 * 1000
const loginAttemptLimit = demoMode ? 50 : 5
const sessions = new Map<string, number>()
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const maxIdentityRecords = positiveIntegerEnv('IDENTITY_MAX_RECORDS', 100000)
class IdentityCapacityError extends Error {}

if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error('生产环境必须设置 SESSION_SECRET（至少 32 位）')
}

if (isProduction && !demoMode && (!configuredAdminPassword || configuredAdminPassword.length < 12)) {
  throw new Error('正式环境必须设置 ADMIN_PASSWORD（至少 12 位）')
}

// 中间件
app.use(['/api/identity', '/api/admin', '/api/feedback', '/api/notifications'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  // Protected JSON must always be re-authorized and returned in full. Express
  // otherwise treats a matching client ETag as a reason to send a 304.
  delete req.headers['if-none-match']
  delete req.headers['if-modified-since']
  next()
})
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

const cookieName = 'anonyproof_admin_session'
const secret = sessionSecret || crypto.randomBytes(32).toString('hex')

function signSession(token: string) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex')
  const value = `${token}.${signSession(token)}`
  sessions.set(value, Date.now() + sessionTtlMs)
  return value
}

function getCookie(req: express.Request, name: string) {
  const header = req.headers.cookie || ''
  const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
  if (!entry) return undefined
  try {
    return decodeURIComponent(entry.slice(name.length + 1))
  } catch {
    return undefined
  }
}

function validSession(value?: string) {
  if (!value) return false
  const [token, signature] = value.split('.')
  const expected = token ? signSession(token) : ''
  const signatureBuffer = Buffer.from(signature || '')
  const expectedBuffer = Buffer.from(expected)
  if (!token || !signature || signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false
  const expiresAt = sessions.get(value)
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(value)
    return false
  }
  return true
}

function setSessionCookie(res: express.Response, value: string) {
  const secure = isProduction ? '; Secure' : ''
  res.append('Set-Cookie', `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtlMs / 1000}${secure}`)
}

function clearSessionCookie(res: express.Response) {
  res.append('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

function safePasswordEqual(input: string, expected: string) {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  return inputBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(inputBuffer, expectedBuffer)
}

function requireSameOrigin(req: express.Request, res: express.Response) {
  if (isTrustedRequestOrigin(req.get('origin'), allowedOrigins)) return true
  res.status(403).json({ error: '请求来源不受信任' })
  return false
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!validSession(getCookie(req, cookieName))) {
    return res.status(401).json({ error: '需要管理员登录' })
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !requireSameOrigin(req, res)) return
  res.setHeader('Cache-Control', 'no-store')
  next()
}

app.post(['/api/admin/auth/login', '/api/admin/login'], (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const attempt = loginAttempts.get(ip)
  if (attempt && attempt.resetAt > now && attempt.count >= loginAttemptLimit) {
    res.setHeader('Retry-After', Math.ceil((attempt.resetAt - now) / 1000))
    return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' })
  }
  if (!adminPassword) return res.status(503).json({ error: '管理员认证尚未配置' })
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!safePasswordEqual(password, adminPassword)) {
    const nextAttempt = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60 * 1000 }
    nextAttempt.count += 1
    loginAttempts.set(ip, nextAttempt)
    return res.status(401).json({ error: '密码错误' })
  }
  loginAttempts.delete(ip)
  const demoIdentity = demoMode ? ensureDemoIdentity(req, res) : undefined
  setSessionCookie(res, createSession())
  res.json({ success: true, ...(demoIdentity ? { deviceId: demoIdentity.deviceId, recoveryCode: demoIdentity.recoveryCode } : {}) })
})

app.get(['/api/admin/auth/session', '/api/admin/session'], (req, res) => {
  const authenticated = validSession(getCookie(req, cookieName))
  if (authenticated) res.setHeader('Cache-Control', 'no-store')
  res.json({ authenticated })
})

app.post(['/api/admin/auth/logout', '/api/admin/logout'], (req, res) => {
  const session = getCookie(req, cookieName)
  if (session) sessions.delete(session)
  clearSessionCookie(res)
  res.json({ success: true })
})

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
function readFeedback(row: any) {
  const { original_content_storage_version, solution_storage_version, ...record } = row
  return {
    ...record,
    original_content: contentEncryption.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, original_content_storage_version),
    solution: contentEncryption.decrypt(row.solution, `feedbacks:${row.id}:solution`, solution_storage_version),
  }
}
function readComment(row: any) {
  const { content_storage_version, ...record } = row
  return { ...record, content: contentEncryption.decrypt(row.content,
    `feedback_comments:${row.feedback_id}:${row.commenter_type}:content`, content_storage_version) }
}
function readNotification(row: any) {
  const { content_storage_version, ...record } = row
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

const identityCookieName = 'anonyproof_device_session'
const identityCookieTtlMs = 365 * 24 * 60 * 60 * 1000
const maxIdentitySessions = 20

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

type ClientIdentityRow = {
  device_id: string
  token_hash: string
  recovery_hash: string
  install_key_hash: string | null
  created_at: number
  last_seen_at: number
  demo_initialized: number
}

type ResolvedIdentity = {
  deviceId: string
  recoveryCode?: string
  created: boolean
  adoptedLegacyDevice?: boolean
}

function hashIdentityValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeIdentityHashEqual(value: string, expectedHash: string) {
  const actual = Buffer.from(hashIdentityValue(value))
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function normalizeRecoveryCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function formatRecoveryCode(value: string) {
  const normalized = normalizeRecoveryCode(value)
  return normalized.match(/.{1,5}/g)?.join('-') ?? normalized
}

function isValidRecoveryCode(value: string) {
  return /^[A-F0-9]{20}$/.test(normalizeRecoveryCode(value))
}

function normalizeInstallKey(value: string) {
  return value.trim()
}

function isValidInstallKey(value: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value)
}

function createDeviceId() {
  return `device-${crypto.randomBytes(18).toString('base64url')}`
}

function createRecoveryCode() {
  const value = crypto.randomBytes(10).toString('hex').toUpperCase()
  return formatRecoveryCode(value)
}

const recentRecoveryCodes = new Map<string, { code: string; expiresAt: number }>()
const recentRecoveryCodeTtlMs = 10 * 60 * 1000

function rememberRecoveryCode(deviceId: string, recoveryCode: string) {
  recentRecoveryCodes.set(deviceId, {
    code: formatRecoveryCode(recoveryCode),
    expiresAt: Date.now() + recentRecoveryCodeTtlMs,
  })
}

function getRecentRecoveryCode(deviceId: string) {
  const entry = recentRecoveryCodes.get(deviceId)
  if (!entry) return ''
  if (entry.expiresAt <= Date.now()) {
    recentRecoveryCodes.delete(deviceId)
    return ''
  }
  return entry.code
}

function setIdentityCookie(res: express.Response, deviceId: string, token: string) {
  const secure = isProduction ? '; Secure' : ''
  const value = encodeURIComponent(`${deviceId}.${token}`)
  res.append(
    'Set-Cookie',
    `${identityCookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${identityCookieTtlMs / 1000}${secure}`,
  )
}

function identityFromCookie(req: express.Request, touch = true) {
  const value = getCookie(req, identityCookieName)
  if (!value) return null

  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const deviceId = value.slice(0, separator)
  const token = value.slice(separator + 1)
  if (!deviceId || !token) return null

  const now = Date.now()
  const identity = db.prepare(
    `SELECT i.device_id, i.token_hash, i.recovery_hash, i.install_key_hash,
       i.created_at, i.last_seen_at, i.demo_initialized
     FROM client_identity_sessions s
     JOIN client_identities i ON i.device_id = s.device_id
     WHERE s.token_hash = ? AND s.device_id = ? AND s.expires_at > ?`,
  ).get(hashIdentityValue(token), deviceId, now) as ClientIdentityRow | undefined

  if (!identity) return null

  if (touch) {
    db.prepare('UPDATE client_identity_sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(now, hashIdentityValue(token))
    db.prepare('UPDATE client_identities SET last_seen_at = ? WHERE device_id = ?')
      .run(now, deviceId)
  }
  return identity
}

function issueIdentitySession(res: express.Response, deviceId: string) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashIdentityValue(token)
  const now = Date.now()
  const expiresAt = now + identityCookieTtlMs

  db.transaction(() => {
    db.prepare(`
      INSERT INTO client_identity_sessions (
        token_hash, device_id, created_at, last_seen_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, deviceId, now, now, expiresAt)

    db.prepare('UPDATE client_identities SET token_hash = ?, last_seen_at = ? WHERE device_id = ?')
      .run(tokenHash, now, deviceId)

    db.prepare('DELETE FROM client_identity_sessions WHERE expires_at <= ?').run(now)
    db.prepare(`
      DELETE FROM client_identity_sessions
      WHERE device_id = ?
        AND token_hash NOT IN (
          SELECT token_hash FROM client_identity_sessions
          WHERE device_id = ?
          ORDER BY last_seen_at DESC
          LIMIT ?
        )
    `).run(deviceId, deviceId, maxIdentitySessions)
  })()

  setIdentityCookie(res, deviceId, token)
}

function isDemoDeviceId(deviceId: string) {
  return deviceId === DEMO_DEVICE_ID || deviceId === DEMO_SECONDARY_DEVICE_ID
}

function issueClientIdentity(
  res: express.Response,
  presetDeviceId?: string,
  installKeyHash?: string,
): ResolvedIdentity {
  const now = Date.now()
  const deviceId = presetDeviceId || createDeviceId()
  const recoveryCode = createRecoveryCode()

  db.transaction(() => {
    const current = db.prepare('SELECT COUNT(*) AS count FROM client_identities').get() as { count: number }
    if (current.count >= maxIdentityRecords) throw new IdentityCapacityError('身份容量已达上限，请联系维护人员')
    db.prepare(`
      INSERT INTO client_identities (
        device_id, token_hash, recovery_hash, install_key_hash, created_at, last_seen_at, demo_initialized
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(
      deviceId,
      '',
      hashIdentityValue(normalizeRecoveryCode(recoveryCode)),
      installKeyHash || null,
      now,
      now,
    )

    if (installKeyHash) {
      db.prepare(`
        INSERT INTO client_identity_install_keys (
          install_key_hash, device_id, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?)
      `).run(installKeyHash, deviceId, now, now)
    }
  }).immediate()

  rememberRecoveryCode(deviceId, recoveryCode)
  if (demoMode) cloneDemoDataForDevice(db, deviceId)
  issueIdentitySession(res, deviceId)
  return { deviceId, recoveryCode, created: !presetDeviceId }
}

function findIdentityByInstallKey(installKeyHash: string) {
  return db.prepare(
    `SELECT i.device_id, i.token_hash, i.recovery_hash, i.install_key_hash,
       i.created_at, i.last_seen_at, i.demo_initialized
     FROM client_identity_install_keys k
     JOIN client_identities i ON i.device_id = k.device_id
     WHERE k.install_key_hash = ?`,
  ).get(installKeyHash) as ClientIdentityRow | undefined
}

function bindInstallKey(deviceId: string, installKeyHash: string, reassign = false) {
  if (!deviceId || !installKeyHash) return

  const owner = findIdentityByInstallKey(installKeyHash)
  if (owner?.device_id === deviceId) return
  if (owner && !reassign) return

  const now = Date.now()
  if (owner) {
    db.prepare(`
      UPDATE client_identity_install_keys
      SET device_id = ?, last_seen_at = ?
      WHERE install_key_hash = ?
    `).run(deviceId, now, installKeyHash)
  } else {
    db.prepare(`
      INSERT INTO client_identity_install_keys (
        install_key_hash, device_id, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?)
    `).run(installKeyHash, deviceId, now, now)
  }
}

// 旧版本浏览器只保存了设备 ID，没有服务端身份记录，升级后会丢掉原有提交。
// 只有当该设备 ID 名下确实存在历史提交、且尚未被任何身份占用时才接管；固定演示设备永远不允许被访客认领。
function canAdoptLegacyDevice(deviceId: string) {
  if (!deviceId || isDemoDeviceId(deviceId)) return false
  if (deviceId.length < 10 || deviceId.length > 100) return false

  const claimed = db.prepare('SELECT 1 FROM client_identities WHERE device_id = ?').get(deviceId)
  if (claimed) return false

  const owned = db.prepare(`
    SELECT 1 FROM feedbacks
    WHERE device_id = ? AND is_demo_template = 0 AND is_demo_clone = 0
    LIMIT 1
  `).get(deviceId)

  return Boolean(owned)
}

function resolveClientIdentity(req: express.Request, res: express.Response): ResolvedIdentity {
  const requestedInstallKey = normalizeInstallKey(req.get('x-anonyproof-install-key') || '')
  const installKeyHash = isValidInstallKey(requestedInstallKey)
    ? hashIdentityValue(requestedInstallKey)
    : ''
  const requestedDeviceId = req.get('x-anonyproof-device-id')?.trim()
  const requestedRecoveryCode = normalizeRecoveryCode(req.get('x-anonyproof-recovery-code') || '')
  const matchingRequestedCode = (identity: ClientIdentityRow) => (
    isValidRecoveryCode(requestedRecoveryCode)
    && safeIdentityHashEqual(requestedRecoveryCode, identity.recovery_hash)
      ? formatRecoveryCode(requestedRecoveryCode)
      : ''
  )

  // A cache miss cannot reproduce a persisted one-way recovery hash. Preserve
  // the saved credential and omit its display value instead of revoking it.
  const existing = identityFromCookie(req)
  if (existing) {
    bindInstallKey(existing.device_id, installKeyHash)
    const recoveryCode = matchingRequestedCode(existing)
      || getRecentRecoveryCode(existing.device_id)
      || undefined
    return { deviceId: existing.device_id, recoveryCode, created: false }
  }

  // Cookie 过期或丢失时，使用浏览器本地保存的设备 ID 与恢复码重新签发凭证。
  if (requestedDeviceId && isValidRecoveryCode(requestedRecoveryCode)) {
    const identity = db.prepare(
      `SELECT device_id, token_hash, recovery_hash, install_key_hash,
         created_at, last_seen_at, demo_initialized
       FROM client_identities WHERE device_id = ?`,
    ).get(requestedDeviceId) as ClientIdentityRow | undefined

    if (identity && safeIdentityHashEqual(requestedRecoveryCode, identity.recovery_hash)) {
      issueIdentitySession(res, identity.device_id)
      bindInstallKey(identity.device_id, installKeyHash, true)
      rememberRecoveryCode(identity.device_id, requestedRecoveryCode)
      return {
        deviceId: identity.device_id,
        recoveryCode: formatRecoveryCode(requestedRecoveryCode),
        created: false,
      }
    }
  }

  // 同一浏览器可能同时打开多个标签页。安装密钥在首次访问前就写入 localStorage，
  // 因此并发初始化会复用同一身份，不会因为前后两次 Set-Cookie 产生两套数据。
  if (installKeyHash) {
    const identity = findIdentityByInstallKey(installKeyHash)
    if (identity) {
      issueIdentitySession(res, identity.device_id)
      const recoveryCode = matchingRequestedCode(identity)
        || getRecentRecoveryCode(identity.device_id)
        || undefined
      return {
        deviceId: identity.device_id,
        recoveryCode,
        created: false,
      }
    }

    if (requestedDeviceId && canAdoptLegacyDevice(requestedDeviceId)) {
      return {
        ...issueClientIdentity(res, requestedDeviceId, installKeyHash),
        adoptedLegacyDevice: true,
      }
    }

    try {
      return issueClientIdentity(res, undefined, installKeyHash)
    } catch (error) {
      if (!String((error as Error)?.message || error).includes('UNIQUE constraint failed')) throw error

      const racedIdentity = findIdentityByInstallKey(installKeyHash)
      if (!racedIdentity) throw error
      issueIdentitySession(res, racedIdentity.device_id)
      return { deviceId: racedIdentity.device_id, created: false }
    }
  }

  if (requestedDeviceId && canAdoptLegacyDevice(requestedDeviceId)) {
    return { ...issueClientIdentity(res, requestedDeviceId), adoptedLegacyDevice: true }
  }

  return issueClientIdentity(res)
}

function recoverClientIdentity(
  recoveryCode: string,
  res: express.Response,
  installKeyHash = '',
): ResolvedIdentity | null {
  const normalized = normalizeRecoveryCode(recoveryCode)
  if (!isValidRecoveryCode(normalized)) return null

  const identity = db.prepare(
    `SELECT device_id, token_hash, recovery_hash, install_key_hash,
       created_at, last_seen_at, demo_initialized
     FROM client_identities WHERE recovery_hash = ?`,
  ).get(hashIdentityValue(normalized)) as ClientIdentityRow | undefined

  if (!identity) return null

  issueIdentitySession(res, identity.device_id)
  bindInstallKey(identity.device_id, installKeyHash, true)
  rememberRecoveryCode(identity.device_id, normalized)
  return {
    deviceId: identity.device_id,
    recoveryCode: formatRecoveryCode(normalized),
    created: false,
  }
}

function requireClientIdentity(req: express.Request, res: express.Response) {
  const identity = identityFromCookie(req)
  if (!identity) {
    res.status(401).json({ error: '本机身份已失效，请刷新页面后重试' })
    return null
  }
  return identity
}

function isAdminAuthenticated(req: express.Request) {
  return validSession(getCookie(req, cookieName))
}

const demoRequestIdentities = new WeakMap<express.Request, string>()
function ensureDemoIdentity(req: express.Request, res: express.Response): ResolvedIdentity {
  const existing = identityFromCookie(req)
  const identity = existing ? { deviceId: existing.device_id, created: false } : issueClientIdentity(res)
  if (existing) cloneDemoDataForDevice(db, existing.device_id)
  // This helper intentionally does not call resolveClientIdentity(): a passive
  // administrator request must never rotate an existing user's recovery code.
  demoRequestIdentities.set(req, identity.deviceId)
  return identity
}
function demoRequestDevice(req: express.Request) {
  return demoRequestIdentities.get(req) || identityFromCookie(req)?.device_id || ''
}
function canAccessDevice(req: express.Request, deviceId: string) {
  if (demoMode) return demoRequestDevice(req) === deviceId
  return isAdminAuthenticated(req) || identityFromCookie(req)?.device_id === deviceId
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
app.get('/api/identity', (req, res) => {
  const identity = identityFromCookie(req, false)
  if (!identity) return res.status(401).json({ error: '本机身份已失效，请刷新页面后重试' })
  const requestedCode = normalizeRecoveryCode(req.get('x-anonyproof-recovery-code') || '')
  const recoveryCode = isValidRecoveryCode(requestedCode) && safeIdentityHashEqual(requestedCode, identity.recovery_hash)
    ? formatRecoveryCode(requestedCode) : getRecentRecoveryCode(identity.device_id) || undefined
  res.json({ success: true, deviceId: identity.device_id, recoveryCode,
    created: false, adoptedLegacyDevice: false, demoMode })
})

app.post('/api/identity', identityInitializationLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const identity = resolveClientIdentity(req, res)
  res.json({
    success: true,
    deviceId: identity.deviceId,
    recoveryCode: identity.recoveryCode,
    created: identity.created,
    adoptedLegacyDevice: identity.adoptedLegacyDevice === true,
    demoMode,
  })
})

app.post('/api/identity/recover', (req, res) => {
  if (!requireSameOrigin(req, res)) return
  res.setHeader('Cache-Control', 'no-store')
  const recoveryCode = typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode : ''
  const requestedInstallKey = normalizeInstallKey(req.get('x-anonyproof-install-key') || '')
  const installKeyHash = isValidInstallKey(requestedInstallKey)
    ? hashIdentityValue(requestedInstallKey)
    : ''
  const identity = recoverClientIdentity(recoveryCode, res, installKeyHash)
  if (!identity) {
    return res.status(404).json({ error: '恢复码无效，请检查后重试' })
  }
  res.json({
    success: true,
    deviceId: identity.deviceId,
    recoveryCode: identity.recoveryCode,
  })
})

// 工具函数：记录管理员操作
const logAdminAction = (action: string, targetId: string, ip: string) => {
  const stmt = db.prepare(
    'INSERT INTO admin_logs (action, target_id, admin_ip, created_at) VALUES (?, ?, ?, ?)'
  )
  stmt.run(action, targetId, ip, Date.now())
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

    res.json({
      success: true,
      id,
      timestamp: createdAt
    })
  } catch (error) {
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

// API: 获取所有反馈（管理员）
app.get('/api/admin/feedbacks', (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'

    // 记录查看操作
    logAdminAction('view_all', 'all', ip)

    const scope = adminRecordScope(req, 'feedbacks')
    const feedbacks = db.prepare(
      `SELECT id, category, encrypted_content, device_id, created_at, status, original_content, solution, solution_updated_at,
        is_demo_template, is_demo_clone, original_content_storage_version, solution_storage_version,
        CASE WHEN ${demoMode ? 'feedbacks.is_demo_template = 1' : '0'} THEN 0 ELSE
          (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'admin' AND n.recipient_id = 'admin' AND n.is_read = 0) END AS unread_notifications
       FROM feedbacks
       WHERE ${scope.sql}
       ORDER BY created_at DESC`
    ).all(...scope.params) as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...readFeedback(f),
        created_at: new Date(f.created_at).toISOString()
      }))
    })
  } catch (error) {
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
        ).run(status, contentEncryption.encrypt(trimmedSolution, `feedbacks:${id}:solution`), contentEncryption.storageVersion, Date.now(), ip, id)
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
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    // 演示模板由服务端种子维护，重启后会重新写入，因此不允许删除；其余可访问记录允许删除。
    const scope = adminRecordScope(req, 'feedbacks', true)
    const visibleFeedback = db.prepare(`
      SELECT id FROM feedbacks
      WHERE id = ? AND feedbacks.is_demo_template = 0 AND ${scope.sql}
    `).get(id, ...scope.params)

    if (!visibleFeedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }

    // 记录删除操作
    logAdminAction('delete', id, ip)

    const stmt = db.prepare('DELETE FROM feedbacks WHERE id = ?')
    stmt.run(id)

    updateStats()

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
      'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100'
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

// API: 获取反馈的所有评论
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

    const comments = db.prepare(
      'SELECT * FROM feedback_comments WHERE feedback_id = ? ORDER BY created_at ASC'
    ).all(feedbackId) as any[]

    res.json({
      success: true,
      comments: comments.map(c => ({
        ...readComment(c),
        created_at: new Date(c.created_at).toISOString()
      }))
    })
  } catch (error) {
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
    const feedback = db.prepare(`
      SELECT device_id, category, original_content FROM feedbacks
      WHERE id = ? AND ${scope.sql}
    `).get(feedbackId, ...scope.params) as { device_id: string; category: string; original_content: string } | undefined

    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }
    if (commenterType === 'user' && !canAccessDevice(req, feedback.device_id)) {
      return res.status(401).json({ error: '无权补充该记录' })
    }
    if (demoMode && !fixedComment) return res.status(400).json({ error: '请选择固定演示回复' })
    const validation = validateCommentContent(content)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    const createdAt = Date.now()
    const adminIp = commenterType === 'admin' ? (req.ip || req.socket.remoteAddress || 'unknown') : null

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
    if (!result) return res.status(404).json({ error: '反馈不存在' })

    res.json({
      success: true,
      comment: {
        id: result.lastInsertRowid,
        feedback_id: feedbackId,
        commenter_type: commenterType,
        content: content.trim(),
        created_at: new Date(createdAt).toISOString()
      }
    })
  } catch (error) {
    console.error('添加评论失败:', error)
    res.status(500).json({ error: '添加评论失败' })
  }
}

app.post('/api/feedback/:feedbackId/comments', (req, res, next) => {
  try {
    const scope = userRecordScope('feedbacks')
    const parent = db.prepare(`SELECT device_id FROM feedbacks WHERE id = ? AND ${scope.sql}`)
      .get(String(req.params.feedbackId), ...scope.params) as { device_id: string } | undefined
    if (!parent) return res.status(404).json({ error: '反馈不存在' })
    if (!canAccessDevice(req, parent.device_id)) return res.status(401).json({ error: '无权补充该记录' })
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

// API: 获取某设备的所有反馈
app.get('/api/feedback/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params
    if (!canAccessDevice(req, deviceId)) {
      return res.status(401).json({ error: '无权查看该浏览器的提交记录' })
    }

    const scope = userRecordScope('feedbacks')
    const feedbacks = db.prepare(
      `SELECT id, category, original_content, created_at, status, solution, solution_updated_at, original_content_storage_version, solution_storage_version,
        (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'user' AND n.recipient_id = ? AND n.is_read = 0) AS unread_notifications
       FROM feedbacks
       WHERE device_id = ? AND ${scope.sql}
       ORDER BY created_at DESC`
    ).all(deviceId, deviceId, ...scope.params) as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...readFeedback(f),
        created_at: new Date(f.created_at).toISOString()
      }))
    })
  } catch (error) {
    console.error('获取设备反馈失败:', error)
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
  if (error instanceof IdentityCapacityError && !res.headersSent) {
    res.status(503).json({ error: error.message })
    return
  }
  next(error)
}
app.use(identityCapacityErrorHandler)

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log(`AnonyProof API Server running on ${HOST}:${PORT}`)
  console.log(`Database: ${databasePath}`)
  if (demoMode) {
    console.warn(`DEMO MODE ENABLED: ${DEMO_NOTICE}`)
    console.warn(`Demo admin password: ${DEMO_ADMIN_PASSWORD}`)
  }
})
