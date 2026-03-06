// 访问统计 API 工具
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(__dirname, '../../data/anonyproof.db')
const db = new Database(dbPath)

// 获取访问统计概览
export function getAccessStatsOverview() {
  const today = new Date().toISOString().split('T')[0]
  
  // 今日统计
  const todayStats = db.prepare(
    'SELECT * FROM access_stats WHERE date = ?'
  ).get(today) as any || {
    total_visits: 0,
    unique_visitors: 0,
    bot_visits: 0,
    suspicious_visits: 0,
    avg_response_time: 0,
  }

  // 总统计
  const totalStats = db.prepare(`
    SELECT
      COUNT(*) as total_visits,
      COUNT(DISTINCT ip) as unique_visitors,
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_visits,
      SUM(CASE WHEN is_suspicious = 1 THEN 1 ELSE 0 END) as suspicious_visits,
      AVG(response_time) as avg_response_time
    FROM access_logs
  `).get() as any

  // 黑名单 IP 数量
  const blacklistedCount = db.prepare(
    'SELECT COUNT(*) as count FROM ip_blacklist WHERE expires_at IS NULL OR expires_at > ?'
  ).get(Date.now()) as { count: number }

  // 最近 7 天统计
  const last7Days = db.prepare(`
    SELECT date, total_visits, unique_visitors, bot_visits, suspicious_visits
    FROM access_stats
    ORDER BY date DESC
    LIMIT 7
  `).all()

  return {
    today: todayStats,
    total: totalStats,
    blacklistedIPs: blacklistedCount.count,
    last7Days: last7Days.reverse(),
  }
}

// 获取最近访问日志
export function getRecentAccessLogs(limit: number = 100) {
  return db.prepare(`
    SELECT
      id,
      ip,
      user_agent,
      path,
      method,
      status_code,
      response_time,
      is_bot,
      is_suspicious,
      suspicious_reason,
      datetime(created_at / 1000, 'unixepoch', 'localtime') as created_at
    FROM access_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit)
}

// 获取可疑访问日志
export function getSuspiciousAccessLogs(limit: number = 50) {
  return db.prepare(`
    SELECT
      id,
      ip,
      user_agent,
      path,
      method,
      status_code,
      suspicious_reason,
      datetime(created_at / 1000, 'unixepoch', 'localtime') as created_at
    FROM access_logs
    WHERE is_suspicious = 1
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit)
}

// 获取爬虫访问日志
export function getBotAccessLogs(limit: number = 50) {
  return db.prepare(`
    SELECT
      id,
      ip,
      user_agent,
      path,
      method,
      datetime(created_at / 1000, 'unixepoch', 'localtime') as created_at
    FROM access_logs
    WHERE is_bot = 1
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit)
}

// 获取热门路径
export function getTopPaths(limit: number = 10) {
  return db.prepare(`
    SELECT
      path,
      COUNT(*) as visits,
      COUNT(DISTINCT ip) as unique_visitors,
      AVG(response_time) as avg_response_time
    FROM access_logs
    GROUP BY path
    ORDER BY visits DESC
    LIMIT ?
  `).all(limit)
}

// 获取活跃 IP
export function getActiveIPs(limit: number = 20) {
  return db.prepare(`
    SELECT
      ip,
      COUNT(*) as visits,
      MAX(created_at) as last_visit,
      SUM(CASE WHEN is_suspicious = 1 THEN 1 ELSE 0 END) as suspicious_count
    FROM access_logs
    WHERE created_at > ?
    GROUP BY ip
    ORDER BY visits DESC
    LIMIT ?
  `).all(Date.now() - 24 * 60 * 60 * 1000, limit)
}

// 获取黑名单
export function getIPBlacklist() {
  return db.prepare(`
    SELECT
      id,
      ip,
      reason,
      attempts,
      datetime(blacklisted_at / 1000, 'unixepoch', 'localtime') as blacklisted_at,
      datetime(expires_at / 1000, 'unixepoch', 'localtime') as expires_at
    FROM ip_blacklist
    WHERE expires_at IS NULL OR expires_at > ?
    ORDER BY blacklisted_at DESC
  `).all(Date.now())
}

// 从黑名单移除 IP
export function unblacklistIP(ip: string) {
  const stmt = db.prepare('DELETE FROM ip_blacklist WHERE ip = ?')
  return stmt.run(ip)
}

// 手动添加 IP 到黑名单
export function blacklistIP(ip: string, reason: string, durationHours: number = 24) {
  const expiresAt = Date.now() + durationHours * 60 * 60 * 1000
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ip_blacklist (ip, reason, attempts, blacklisted_at, expires_at)
    VALUES (?, ?, 1, ?, ?)
  `)
  return stmt.run(ip, reason, Date.now(), expiresAt)
}

// 获取访问趋势（按小时）
export function getAccessTrend(hours: number = 24) {
  return db.prepare(`
    SELECT
      datetime(created_at / 1000, 'unixepoch', 'localtime') as hour,
      COUNT(*) as visits,
      COUNT(DISTINCT ip) as unique_visitors,
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_visits
    FROM access_logs
    WHERE created_at > ?
    GROUP BY strftime('%Y-%m-%d %H', datetime(created_at / 1000, 'unixepoch', 'localtime'))
    ORDER BY hour DESC
    LIMIT ?
  `).all(Date.now() - hours * 60 * 60 * 1000, hours)
}

// 清理旧日志（保留 30 天）
export function cleanupOldLogs() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  
  const stmt = db.prepare('DELETE FROM access_logs WHERE created_at < ?')
  const result = stmt.run(thirtyDaysAgo)
  
  return result.changes
}
