// 访问统计中间件
import { logger } from '../utils/logger'
import { openDatabase } from '../utils/database'

const db = openDatabase()

// 创建访问统计表
db.exec(`
  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    user_agent TEXT,
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER,
    response_time INTEGER,
    is_bot BOOLEAN DEFAULT 0,
    is_suspicious BOOLEAN DEFAULT 0,
    suspicious_reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip);
  CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_access_logs_is_suspicious ON access_logs(is_suspicious);

  CREATE TABLE IF NOT EXISTS access_stats (
    date TEXT PRIMARY KEY,
    total_visits INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    bot_visits INTEGER DEFAULT 0,
    suspicious_visits INTEGER DEFAULT 0,
    avg_response_time INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ip_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    reason TEXT,
    attempts INTEGER DEFAULT 1,
    blacklisted_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    path TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_created_at ON rate_limit_logs(created_at);
`)

// 检测是否为爬虫
function detectBot(userAgent: string): { isBot: boolean; botName?: string } {
  if (!userAgent) return { isBot: false }

  const botPatterns = [
    { pattern: /googlebot/i, name: 'Google Bot' },
    { pattern: /bingbot/i, name: 'Bing Bot' },
    { pattern: /slurp/i, name: 'Yahoo Bot' },
    { pattern: /duckduckbot/i, name: 'DuckDuck Bot' },
    { pattern: /baiduspider/i, name: 'Baidu Spider' },
    { pattern: /yandexbot/i, name: 'Yandex Bot' },
    { pattern: /facebookexternalhit/i, name: 'Facebook Bot' },
    { pattern: /twitterbot/i, name: 'Twitter Bot' },
    { pattern: /linkedinbot/i, name: 'LinkedIn Bot' },
    { pattern: /whatsapp/i, name: 'WhatsApp Bot' },
    { pattern: /applebot/i, name: 'Apple Bot' },
    { pattern: /semrushbot/i, name: 'Semrush Bot' },
    { pattern: /ahrefsbot/i, name: 'Ahrefs Bot' },
    { pattern: /mj12bot/i, name: 'MJ12 Bot' },
    { pattern: /dotbot/i, name: 'Dot Bot' },
    { pattern: /crawler/i, name: 'Crawler' },
    { pattern: /spider/i, name: 'Spider' },
    { pattern: /bot/i, name: 'Generic Bot' },
  ]

  for (const bot of botPatterns) {
    if (bot.pattern.test(userAgent)) {
      return { isBot: true, botName: bot.name }
    }
  }

  return { isBot: false }
}

// 检测可疑行为
function detectSuspicious(
  ip: string,
  userAgent: string,
  path: string
): { isSuspicious: boolean; reason?: string } {
  const reasons: string[] = []

  // 1. 空 User-Agent
  if (!userAgent || userAgent.trim() === '') {
    reasons.push('Empty User-Agent')
  }

  // 2. 常见爬虫特征但不在白名单
  const suspiciousPatterns = [
    /curl/i,
    /wget/i,
    /python/i,
    /java/i,
    /perl/i,
    /ruby/i,
    /php/i,
    /go-http/i,
    /requests/i,
    /http.rb/i,
    /okhttp/i,
    /axios/i,
    /node-fetch/i,
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(userAgent)) {
      reasons.push('Script-like User-Agent')
      break
    }
  }

  // 3. 访问敏感路径
  const sensitivePaths = [
    '/api/admin',
    '/admin',
    '/.env',
    '/config',
    '/backup',
    '/wp-admin',
    '/phpmyadmin',
  ]

  for (const sensitivePath of sensitivePaths) {
    if (path.includes(sensitivePath)) {
      reasons.push('Sensitive path access')
      break
    }
  }

  return {
    isSuspicious: reasons.length > 0,
    reason: reasons.join(', '),
  }
}

// 检查 IP 是否在黑名单中
function isIPBlacklisted(ip: string): boolean {
  const stmt = db.prepare(
    'SELECT * FROM ip_blacklist WHERE ip = ? AND (expires_at IS NULL OR expires_at > ?)'
  )
  const result = stmt.get(ip, Date.now())
  return !!result
}

// 记录速率限制触发
function logRateLimit(ip: string, path: string, reason: string) {
  const stmt = db.prepare(
    'INSERT INTO rate_limit_logs (ip, path, reason, created_at) VALUES (?, ?, ?, ?)'
  )
  stmt.run(ip, path, reason, Date.now())

  // 检查是否需要加入黑名单
  const countStmt = db.prepare(
    'SELECT COUNT(*) as count FROM rate_limit_logs WHERE ip = ? AND created_at > ?'
  )
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  const result = countStmt.get(ip, oneHourAgo) as { count: number }

  // 1 小时内触发 10 次速率限制，加入黑名单 24 小时
  if (result.count >= 10) {
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000
    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO ip_blacklist (ip, reason, attempts, blacklisted_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    insertStmt.run(ip, 'Exceeded rate limit 10 times in 1 hour', result.count, Date.now(), expiresAt)
    logger.warn(`IP ${ip} blacklisted for 24 hours due to excessive rate limit violations`)
  }
}

// Keep exact cumulative values: multiplying a rounded historical average would
// lose precision. Legacy logs are rebuilt once during this additive migration,
// never from the request path. Taking the write lock before inspecting columns
// also makes two starting processes agree on whether migration is needed.
db.transaction(() => {
  db.exec('CREATE INDEX IF NOT EXISTS idx_access_logs_ip_created_at ON access_logs(ip, created_at)')
  const columns = db.prepare('PRAGMA table_info(access_stats)').all() as { name: string }[]
  const hasTotal = columns.some(column => column.name === 'response_time_total')
  const hasCount = columns.some(column => column.name === 'response_time_count')
  if (!hasTotal) db.exec('ALTER TABLE access_stats ADD COLUMN response_time_total REAL NOT NULL DEFAULT 0')
  if (!hasCount) db.exec('ALTER TABLE access_stats ADD COLUMN response_time_count INTEGER NOT NULL DEFAULT 0')
  if (!hasTotal || !hasCount) {
    db.exec(`
      INSERT INTO access_stats (date, total_visits, unique_visitors, bot_visits,
        suspicious_visits, avg_response_time, response_time_total, response_time_count)
      SELECT DATE(created_at / 1000, 'unixepoch'), COUNT(*), COUNT(DISTINCT ip),
        SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END),
        SUM(CASE WHEN is_suspicious = 1 THEN 1 ELSE 0 END),
        ROUND(COALESCE(AVG(response_time), 0)), COALESCE(SUM(response_time), 0), COUNT(response_time)
      FROM access_logs GROUP BY DATE(created_at / 1000, 'unixepoch')
      ON CONFLICT(date) DO UPDATE SET total_visits = excluded.total_visits,
        unique_visitors = excluded.unique_visitors, bot_visits = excluded.bot_visits,
        suspicious_visits = excluded.suspicious_visits, avg_response_time = excluded.avg_response_time,
        response_time_total = excluded.response_time_total, response_time_count = excluded.response_time_count
    `)
  }
}).immediate()

export interface AccessLogEntry {
  ip: string
  userAgent: string
  path: string
  method: string
  statusCode: number
  responseTime: number
  isBot: boolean
  isSuspicious: boolean
  suspiciousReason: string | null
  createdAt: number
}

const hasDailyVisitor = db.prepare(`SELECT 1 FROM access_logs
  WHERE ip = ? AND created_at >= ? AND created_at < ? LIMIT 1`)
const insertAccessLog = db.prepare(`INSERT INTO access_logs (
  ip, user_agent, path, method, status_code, response_time,
  is_bot, is_suspicious, suspicious_reason, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const incrementDailyStats = db.prepare(`
  INSERT INTO access_stats (date, total_visits, unique_visitors, bot_visits,
    suspicious_visits, avg_response_time, response_time_total, response_time_count)
  VALUES (?, 1, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(date) DO UPDATE SET
    total_visits = total_visits + 1,
    unique_visitors = unique_visitors + excluded.unique_visitors,
    bot_visits = bot_visits + excluded.bot_visits,
    suspicious_visits = suspicious_visits + excluded.suspicious_visits,
    response_time_total = response_time_total + excluded.response_time_total,
    response_time_count = response_time_count + 1,
    avg_response_time = ROUND((response_time_total + excluded.response_time_total) / (response_time_count + 1))
`)

// The same transaction commits the source log and its increment exactly once.
// A crash or statistics failure cannot leave a logged request awaiting replay.
export const recordAccess = db.transaction((entry: AccessLogEntry) => {
  const date = new Date(entry.createdAt).toISOString().slice(0, 10)
  const dayStart = Date.parse(date + 'T00:00:00Z')
  const unique = hasDailyVisitor.get(entry.ip, dayStart, dayStart + 86400000) ? 0 : 1
  insertAccessLog.run(entry.ip, entry.userAgent, entry.path, entry.method,
    entry.statusCode, entry.responseTime, entry.isBot ? 1 : 0,
    entry.isSuspicious ? 1 : 0, entry.suspiciousReason, entry.createdAt)
  incrementDailyStats.run(date, unique, entry.isBot ? 1 : 0,
    entry.isSuspicious ? 1 : 0, Math.round(entry.responseTime), entry.responseTime)
})

// 访问统计中间件
export function accessStatsMiddleware(req: any, res: any, next: any) {
  const startTime = Date.now()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent'] || ''
  const path = req.path || req.url

  // 检查是否在黑名单中
  if (isIPBlacklisted(ip)) {
    logger.warn(`Blacklisted IP attempted access: ${ip}`)
    return res.status(403).json({ error: 'Access denied' })
  }

  // 检测爬虫
  const { isBot, botName } = detectBot(userAgent)

  // 检测可疑行为
  const { isSuspicious, reason } = detectSuspicious(ip, userAgent, path)

  // 记录响应时间
  res.on('finish', () => {
    const responseTime = Date.now() - startTime

    try {
      recordAccess.immediate({
        ip, userAgent, path, method: req.method, statusCode: res.statusCode,
        responseTime, isBot, isSuspicious, suspiciousReason: reason || null,
        createdAt: Date.now(),
      })

      // 记录可疑访问
      if (isSuspicious) {
        logger.warn(`Suspicious access detected: IP=${ip}, Reason=${reason}, Path=${path}`)
      }
    } catch (error) {
      logger.error('Failed to log access:', error)
    }
  })

  next()
}

// 导出黑名单检查函数
export { isIPBlacklisted, logRateLimit }
