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
import { openDatabase, databasePath } from './utils/database'
import {
  DEMO_ADMIN_PASSWORD,
  DEMO_DEVICE_ID,
  DEMO_NOTICE,
  isDemoMode,
  resetDemoUserNotifications,
  seedDemoData,
} from './demo'

const app = express()
const PORT = Number(process.env.PORT || 4000)
// 生产环境由 Nginx 反向代理到本机端口，默认只监听回环地址，避免后端端口直接暴露到公网。
const HOST = process.env.BIND_HOST || '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const demoMode = isDemoMode()
const configuredAdminPassword = process.env.ADMIN_PASSWORD?.trim()
// Demo mode always uses the published password so the login hint cannot drift from the server.
const adminPassword = demoMode ? DEMO_ADMIN_PASSWORD : configuredAdminPassword
const sessionSecret = process.env.SESSION_SECRET
const sessionTtlMs = 8 * 60 * 60 * 1000
const loginAttemptLimit = demoMode ? 50 : 5
const sessions = new Map<string, number>()
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error('生产环境必须设置 SESSION_SECRET（至少 32 位）')
}

if (isProduction && !demoMode && (!configuredAdminPassword || configuredAdminPassword.length < 12)) {
  throw new Error('正式环境必须设置 ADMIN_PASSWORD（至少 12 位）')
}

// 中间件
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://deline.top')
  .split(',').map(origin => origin.trim()).filter(Boolean)
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json())
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

  // 演示数据由所有访客共用，这里恢复默认未读状态，保证每次打开页面都能看到通知提醒。
  resetDemoUserNotifications(db)

  return res.json({
    success: true,
    demoMode: true,
    adminPassword: DEMO_ADMIN_PASSWORD,
    deviceId: DEMO_DEVICE_ID,
    notice: DEMO_NOTICE,
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
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtlMs / 1000}${secure}`)
}

function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

function safePasswordEqual(input: string, expected: string) {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  return inputBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(inputBuffer, expectedBuffer)
}

function requireSameOrigin(req: express.Request, res: express.Response) {
  const origin = req.get('origin')
  if (!origin) return true
  try {
    return allowedOrigins.includes(new URL(origin).origin)
  } catch {
    res.status(403).json({ error: '请求来源不受信任' })
    return false
  }
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
  setSessionCookie(res, createSession())
  res.json({ success: true })
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

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT DEFAULT 'pending'
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

  CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id ON feedback_comments(feedback_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_type, recipient_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_feedback_id ON notifications(feedback_id);

  INSERT OR IGNORE INTO stats (id, total_feedbacks, encrypted_count)
  VALUES (1, 0, 0);
`)

// Upgrade databases created by earlier versions without changing existing records.
const feedbackColumns = db.prepare('PRAGMA table_info(feedbacks)').all() as Array<{ name: string }>
const existingFeedbackColumns = new Set(feedbackColumns.map(column => column.name))
const feedbackMigrations: Array<[string, string]> = [
  ['original_content', "TEXT NOT NULL DEFAULT ''"],
  ['solution', "TEXT NOT NULL DEFAULT ''"],
  ['solution_updated_at', 'INTEGER'],
  ['solution_admin_ip', "TEXT NOT NULL DEFAULT ''"],
]
for (const [column, definition] of feedbackMigrations) {
  if (!existingFeedbackColumns.has(column)) db.exec(`ALTER TABLE feedbacks ADD COLUMN ${column} ${definition}`)
}

if (demoMode) {
  seedDemoData(db)
}

// 工具函数：记录管理员操作
const logAdminAction = (action: string, targetId: string, ip: string) => {
  const stmt = db.prepare(
    'INSERT INTO admin_logs (action, target_id, admin_ip, created_at) VALUES (?, ?, ?, ?)'
  )
  stmt.run(action, targetId, ip, Date.now())
}

// 工具函数：更新统计
const updateStats = () => {
  const feedbacks = db.prepare('SELECT COUNT(*) as count FROM feedbacks').get() as { count: number }
  const stats = db.prepare('UPDATE stats SET total_feedbacks = ?, encrypted_count = ? WHERE id = 1')
  stats.run(feedbacks.count, feedbacks.count)
}

// API: 提交反馈
app.post('/api/feedback', (req, res) => {
  try {
    const { category, encryptedContent, deviceId, originalContent } = req.body

    if (!category || !encryptedContent || !deviceId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    const id = uuidv4()
    const createdAt = Date.now()

    const stmt = db.prepare(
      'INSERT INTO feedbacks (id, category, encrypted_content, device_id, created_at, status, original_content) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    stmt.run(id, category, encryptedContent, deviceId, createdAt, 'pending', originalContent || '')

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
    const stats = db.prepare('SELECT * FROM stats WHERE id = 1').get() as any
    res.json({
      total: stats.total_feedbacks,
      encrypted: stats.encrypted_count,
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

    const feedbacks = db.prepare(
      `SELECT id, category, encrypted_content, device_id, created_at, status, original_content, solution, solution_updated_at,
        (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'admin' AND n.recipient_id = 'admin' AND n.is_read = 0) AS unread_notifications
       FROM feedbacks ORDER BY created_at DESC`
    ).all() as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...f,
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

    const feedback = db.prepare(
      'SELECT id, category, encrypted_content, device_id, created_at, status, original_content, solution, solution_updated_at, solution_admin_ip FROM feedbacks WHERE id = ?'
    ).get(id) as any

    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' })
    }

    res.json({
      success: true,
      feedback: {
        ...feedback,
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
    const { status, solution } = req.body
    const ip = req.ip || req.socket.remoteAddress || 'unknown'

    if (!['pending', 'in_progress', 'resolved', 'no_solution'].includes(status)) {
      return res.status(400).json({ error: '无效的状态' })
    }

    // 验证解决方案
    if ((status === 'resolved' || status === 'no_solution') && (!solution || solution.trim().length < 10)) {
      return res.status(400).json({ error: '标记为已办结或暂无法处理时，处理说明必须至少 10 个字符' })
    }

    // 记录操作
    logAdminAction('update_status', id, ip)

    // 更新状态和解决方案
    if (status !== 'pending' && solution) {
      const stmt = db.prepare(
        'UPDATE feedbacks SET status = ?, solution = ?, solution_updated_at = ?, solution_admin_ip = ? WHERE id = ?'
      )
      stmt.run(status, solution.trim(), Date.now(), ip, id)

      // 创建通知
      const feedback = db.prepare('SELECT device_id, category FROM feedbacks WHERE id = ?').get(id) as any
      if (feedback) {
        const categoryName = feedback.category === 'suggestion' ? '建议' : feedback.category === 'complaint' ? '投诉' : '举报'
        const statusLabel = status === 'in_progress' ? '处理中' : status === 'resolved' ? '已办结' : '暂无法处理'
        const solutionSummary = solution.trim().substring(0, 50) + (solution.trim().length > 50 ? '...' : '')
        createNotification(
          'user',
          feedback.device_id,
          id,
          'status_update',
          `提交记录状态已更新：${statusLabel}`,
          `您提交的${categoryName}当前状态为“${statusLabel}”${solution ? `，处理说明：${solutionSummary}` : ''}`
        )
      }
    } else {
      const stmt = db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?')
      stmt.run(status, id)
    }

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

    const comments = db.prepare(
      'SELECT * FROM feedback_comments WHERE feedback_id = ? ORDER BY created_at ASC'
    ).all(feedbackId) as any[]

    res.json({
      success: true,
      comments: comments.map(c => ({
        ...c,
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
    if (commenterType === 'admin' && (!validSession(getCookie(req, cookieName)) || !requireSameOrigin(req, res))) return res.status(401).json({ error: '需要管理员登录' })
    const feedbackId = String(req.params.feedbackId)
    const { content } = req.body
    if (!content) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    if (content.trim().length < 2) {
      return res.status(400).json({ error: '评论内容至少需要 2 个字符' })
    }

    if (content.trim().length > 1000) {
      return res.status(400).json({ error: '评论内容不能超过 1000 个字符' })
    }

    const createdAt = Date.now()
    const adminIp = commenterType === 'admin' ? (req.ip || req.socket.remoteAddress || 'unknown') : null

    const stmt = db.prepare(
      'INSERT INTO feedback_comments (feedback_id, commenter_type, content, created_at, admin_ip) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(feedbackId, commenterType, content.trim(), createdAt, adminIp)

    // 创建通知
    if (commenterType === 'admin') {
      // 管理员评论 -> 通知用户
      const feedback = db.prepare('SELECT device_id, category FROM feedbacks WHERE id = ?').get(feedbackId) as any
      if (feedback) {
        const categoryName = feedback.category === 'suggestion' ? '建议' : feedback.category === 'complaint' ? '投诉' : '举报'
        const summary = content.trim().substring(0, 50) + (content.trim().length > 50 ? '...' : '')
        createNotification(
          'user',
          feedback.device_id,
          feedbackId,
          'comment',
          '处理人员回复了您的提交',
          `您提交的${categoryName}收到一条回复：${summary}`
        )
      }
    } else {
      // 用户评论 -> 通知管理员
      const feedback = db.prepare('SELECT category, original_content FROM feedbacks WHERE id = ?').get(feedbackId) as any
      if (feedback) {
        const categoryName = feedback.category === 'suggestion' ? '建议' : feedback.category === 'complaint' ? '投诉' : '举报'
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
    }

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

app.post('/api/feedback/:feedbackId/comments', (req, res) => addFeedbackComment(req, res, 'user'))
app.post('/api/admin/feedback/:feedbackId/comments', (req, res) => addFeedbackComment(req, res, 'admin'))

// API: 获取某设备的所有反馈
app.get('/api/feedback/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params

    const feedbacks = db.prepare(
      `SELECT id, category, original_content, created_at, status, solution, solution_updated_at,
        (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id = feedbacks.id AND n.recipient_type = 'user' AND n.recipient_id = ? AND n.is_read = 0) AS unread_notifications
       FROM feedbacks WHERE device_id = ? ORDER BY created_at DESC`
    ).all(deviceId, deviceId) as any[]

    res.json({
      success: true,
      feedbacks: feedbacks.map(f => ({
        ...f,
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
  try {
    const stmt = db.prepare(
      'INSERT INTO notifications (recipient_type, recipient_id, feedback_id, type, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    stmt.run(recipientType, recipientId, feedbackId, type, title, content, Date.now())
  } catch (error) {
    console.error('创建通知失败:', error)
  }
}

app.post('/api/feedback/:feedbackId/comments', (req, res) => addFeedbackComment(req, res, 'user'))
app.post('/api/admin/feedback/:feedbackId/comments', (req, res) => addFeedbackComment(req, res, 'admin'))

// API: 获取未读通知数量
app.get('/api/notifications/unread-count', (req, res) => {
  try {
    const { recipientType, recipientId } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }
    if (recipientType === 'admin' && (recipientId !== 'admin' || !validSession(getCookie(req, cookieName)))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }

    const count = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
    ).get(recipientType, recipientId) as { count: number }

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
    if (recipientType === 'admin' && (recipientId !== 'admin' || !validSession(getCookie(req, cookieName)))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }

    const notifications = db.prepare(
      'SELECT * FROM notifications WHERE recipient_type = ? AND recipient_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(recipientType, recipientId, Number(limit)) as any[]

    res.json({
      success: true,
      notifications: notifications.map(n => ({
        ...n,
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
    const notification = db.prepare('SELECT recipient_type, recipient_id FROM notifications WHERE id = ?').get(id) as { recipient_type: string; recipient_id: string } | undefined
    if (notification?.recipient_type === 'admin' && (notification.recipient_id !== 'admin' || !validSession(getCookie(req, cookieName)))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }

    const stmt = notification?.recipient_type === 'admin'
      ? db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_type = 'admin' AND recipient_id = 'admin'")
      : db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')
    stmt.run(id)

    res.json({ success: true })
  } catch (error) {
    console.error('标记已读失败:', error)
    res.status(500).json({ error: '标记失败' })
  }
})

// API: 标记通知为未读
app.put('/api/notifications/:id/unread', (req, res) => {
  try {
    const { id } = req.params
    const notification = db.prepare('SELECT recipient_type, recipient_id FROM notifications WHERE id = ?').get(id) as { recipient_type: string; recipient_id: string } | undefined
    if (notification?.recipient_type === 'admin' && (notification.recipient_id !== 'admin' || !validSession(getCookie(req, cookieName)))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }

    const stmt = notification?.recipient_type === 'admin'
      ? db.prepare("UPDATE notifications SET is_read = 0 WHERE id = ? AND recipient_type = 'admin' AND recipient_id = 'admin'")
      : db.prepare('UPDATE notifications SET is_read = 0 WHERE id = ?')
    stmt.run(id)

    res.json({ success: true })
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
    if (recipientType === 'admin' && (recipientId !== 'admin' || !validSession(getCookie(req, cookieName)))) {
      return res.status(401).json({ error: '需要管理员登录' })
    }

    const stmt = feedbackId
      ? db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ? AND feedback_id = ? AND is_read = 0')
      : db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0')
    const result = feedbackId ? stmt.run(recipientType, recipientId, feedbackId) : stmt.run(recipientType, recipientId)

    res.json({
      success: true,
      count: result.changes
    })
  } catch (error) {
    console.error('标记全部已读失败:', error)
    res.status(500).json({ error: '标记失败' })
  }
})

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log(`AnonyProof API Server running on ${HOST}:${PORT}`)
  console.log(`Database: ${databasePath}`)
  if (demoMode) {
    console.warn(`DEMO MODE ENABLED: ${DEMO_NOTICE}`)
    console.warn(`Demo admin password: ${DEMO_ADMIN_PASSWORD}`)
  }
})
