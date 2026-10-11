import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ContentEncryption } from './contentEncryption'

export class CommentPaginationError extends Error {}
type Cursor = { v: 1; time: number; id: number; context: string }
export type CommentPaginationOptions = { limit: number; context: string; cursor?: Cursor; after?: Cursor }
type Row = { id: number; feedback_id: string; commenter_type: 'user' | 'admin'; content: string;
  content_storage_version: number; created_at: number }

export function parseCommentPagination(query: Record<string, unknown>, scope: string): CommentPaginationOptions {
  const supported = new Set(['pagination', 'limit', 'cursor', 'after'])
  if (Object.keys(query).some(k => !supported.has(k)) || Object.values(query).some(v => typeof v !== 'string'))
    throw new CommentPaginationError('无效的评论分页参数')
  if (query.pagination !== undefined && query.pagination !== '1') throw new CommentPaginationError('pagination 必须为 1')
  const limit = query.limit === undefined ? 50 : /^\d+$/.test(query.limit as string) ? Number(query.limit) : NaN
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CommentPaginationError('limit 必须为 1 到 100 的整数')
  if (query.cursor !== undefined && query.after !== undefined) throw new CommentPaginationError('cursor 与 after 不能同时使用')
  const context = createHash('sha256').update(scope).digest('hex')
  function parse(value: unknown): Cursor | undefined {
    if (value === undefined) return
    try {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error()
      const bytes = Buffer.from(value, 'base64url')
      if (bytes.toString('base64url') !== value) throw new Error()
      const cursor = JSON.parse(bytes.toString('utf8'))
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).sort().join(',') !== 'context,id,time,v' ||
          cursor.v !== 1 || !Number.isSafeInteger(cursor.id) || cursor.id < 1 || !Number.isSafeInteger(cursor.time) || cursor.time < 0 ||
          cursor.context !== context) throw new Error()
      return cursor
    } catch { throw new CommentPaginationError('无效或与记录/身份不匹配的评论 cursor') }
  }
  return { limit, context, cursor: parse(query.cursor), after: parse(query.after) }
}

// Authorization of the parent is performed by the route before parsing a cursor.
// Return ascending chronology within each bounded page. Newest-first retrieval
// allows the initial render to include recent replies; older pages prepend.
export function getCommentPage(db: Database.Database, encryption: ContentEncryption, feedbackId: string,
  options: CommentPaginationOptions) {
  return db.transaction(() => {
    const total = (db.prepare('SELECT COUNT(*) n FROM feedback_comments WHERE feedback_id=?').get(feedbackId) as { n: number }).n
    const cursor = options.after || options.cursor
    const op = options.after ? '>' : '<'
    const boundary = cursor ? ` AND (created_at ${op} ? OR (created_at=? AND id ${op} ?))` : ''
    const params = cursor ? [cursor.time, cursor.time, cursor.id] : []
    const rows = db.prepare(`SELECT id,feedback_id,commenter_type,content,content_storage_version,created_at
      FROM feedback_comments WHERE feedback_id=?${boundary} ORDER BY created_at ${options.after ? 'ASC' : 'DESC'},id ${options.after ? 'ASC' : 'DESC'} LIMIT ?`)
      .all(feedbackId, ...params, options.limit + 1) as Row[]
    const hasMore = rows.length > options.limit
    const page = rows.slice(0, options.limit)
    if (!options.after) page.reverse()
    const encode = (row?: Row) => row ? Buffer.from(JSON.stringify({ v: 1, time: row.created_at, id: row.id, context: options.context })).toString('base64url') : null
    return { success: true, comments: page.map(row => ({ id: row.id, feedback_id: row.feedback_id,
      commenter_type: row.commenter_type, content: encryption.decrypt(row.content,
        `feedback_comments:${row.feedback_id}:${row.commenter_type}:content`, row.content_storage_version),
      created_at: new Date(row.created_at).toISOString() })), pagination: {
      limit: options.limit, total, hasMore, nextCursor: hasMore ? encode(options.after ? page.at(-1) : page[0]) : null,
      latestCursor: encode(page.at(-1)),
    } }
  }).deferred()
}
