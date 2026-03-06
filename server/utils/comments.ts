// 评论 API 工具
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(__dirname, '../../data/anonyproof.db')
const db = new Database(dbPath)

// 添加评论
export function addComment(feedbackId: string, commenterType: 'user' | 'admin', content: string, adminIp?: string, attachmentId?: number) {
  const stmt = db.prepare(`
    INSERT INTO feedback_comments (feedback_id, commenter_type, content, created_at, admin_ip, attachment_id)
    VALUES (?, ?, ?, ?, ?)
  `)
  const result = stmt.run(feedbackId, commenterType, content, Date.now(), adminIp || null)
  return {
    success: true,
    id: result.lastInsertRowid
  }
}

// 获取反馈的所有评论
export function getComments(feedbackId: string) {
  const stmt = db.prepare(`
    SELECT 
      id,
      feedback_id,
      commenter_type,
      content,
      created_at,
      admin_ip
    FROM feedback_comments
    WHERE feedback_id = ?
    ORDER BY created_at ASC
  `)
  const comments = stmt.all(feedbackId) as any[]
  
  return comments.map(c => ({
    ...c,
    created_at: new Date(c.created_at).toISOString()
  }))
}
