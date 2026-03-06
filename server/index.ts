import express from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import path from 'path'

const app = express()
const PORT = 4000

// 中间件
app.use(cors())
app.use(express.json())

// 初始化数据库
const dbPath = path.join(__dirname, '../data/anonyproof.db')
const db = new Database(dbPath)

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

  INSERT OR IGNORE INTO stats (id, total_feedbacks, encrypted_count)
  VALUES (1, 0, 0);
`)

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
      `收到新的${categoryName}`,
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
      'SELECT id, category, encrypted_content, device_id, created_at, status, original_content, solution, solution_updated_at FROM feedbacks ORDER BY created_at DESC'
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
      return res.status(400).json({ error: '标记为已解决或暂不解决时，解决方案必须至少 10 个字符' })
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
        const statusLabel = status === 'in_progress' ? '持续跟进' : status === 'resolved' ? '已解决' : '暂不解决'
        const solutionSummary = solution.trim().substring(0, 50) + (solution.trim().length > 50 ? '...' : '')
        createNotification(
          'user',
          feedback.device_id,
          id,
          'status_update',
          `您的反馈状态已更新：${statusLabel}`,
          `您的${categoryName}状态已更新为"${statusLabel}"${solution ? `，处理说明：${solutionSummary}` : ''}`
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
    const { feedbackId } = req.params

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
app.post('/api/feedback/:feedbackId/comments', (req, res) => {
  try {
    const { feedbackId } = req.params
    const { content, commenterType } = req.body

    if (!content || !commenterType) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    if (content.trim().length < 2) {
      return res.status(400).json({ error: '评论内容至少需要 2 个字符' })
    }

    if (content.trim().length > 1000) {
      return res.status(400).json({ error: '评论内容不能超过 1000 个字符' })
    }

    if (!['user', 'admin'].includes(commenterType)) {
      return res.status(400).json({ error: '无效的评论者类型' })
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
          '管理员回复了您的反馈',
          `您的${categoryName}收到了新的回复：${summary}`
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
          '用户回复了您的评论',
          `${categoryName}收到了新的回复：${summary}`
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
})

// API: 获取某设备的所有反馈
app.get('/api/feedback/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params

    const feedbacks = db.prepare(
      'SELECT id, category, original_content, created_at, status, solution, solution_updated_at FROM feedbacks WHERE device_id = ? ORDER BY created_at DESC'
    ).all(deviceId) as any[]

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

// API: 获取未读通知数量
app.get('/api/notifications/unread-count', (req, res) => {
  try {
    const { recipientType, recipientId } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
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

    const stmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')
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

    const stmt = db.prepare('UPDATE notifications SET is_read = 0 WHERE id = ?')
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
    const { recipientType, recipientId } = req.query

    if (!recipientType || !recipientId) {
      return res.status(400).json({ error: '缺少必要参数' })
    }

    const stmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0')
    const result = stmt.run(recipientType, recipientId)

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
app.listen(PORT, () => {
  console.log(`🚀 AnonyProof API Server running on port ${PORT}`)
  console.log(`📊 Database: ${dbPath}`)
})
app.get('/api/feedback/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params

    const feedbacks = db.prepare(
      'SELECT id, category, original_content, created_at, status FROM feedbacks WHERE device_id = ? ORDER BY created_at DESC'
    ).all(deviceId) as any[]

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
