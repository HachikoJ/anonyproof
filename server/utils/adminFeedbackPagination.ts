import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ContentEncryption } from './contentEncryption'

export class FeedbackPaginationError extends Error {}
type Cursor = { v: 1; time: number; id: string; filters: string }
export type FeedbackPaginationOptions = { limit: number; category: string; status: string; search: string; filters: string; cursor?: Cursor }
type Row = {
  id: string; category: string; device_id: string; created_at: number; status: string;
  original_content: string; original_content_storage_version: number;
  is_demo_template: number; is_demo_clone: number; unread_notifications: number;
}

export function parseFeedbackPagination(query: Record<string, unknown>, context = ''): FeedbackPaginationOptions {
  const supported = new Set(['pagination', 'limit', 'cursor', 'category', 'status', 'search'])
  if (Object.keys(query).some(key => !supported.has(key))) throw new FeedbackPaginationError('无效的分页参数')
  for (const value of Object.values(query)) if (typeof value !== 'string') throw new FeedbackPaginationError('分页参数必须为单个字符串')
  if (query.pagination !== undefined && query.pagination !== '1') throw new FeedbackPaginationError('pagination 必须为 1')
  const limit = query.limit === undefined ? 50 : /^\d+$/.test(query.limit as string) ? Number(query.limit) : NaN
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new FeedbackPaginationError('limit 必须是 1 到 100 的整数')
  const category = (query.category as string | undefined) || 'all'
  const status = (query.status as string | undefined) || 'all'
  if (!['all', 'suggestion', 'complaint', 'report'].includes(category)) throw new FeedbackPaginationError('无效的分类')
  if (!['all', 'pending', 'in_progress', 'resolved', 'no_solution'].includes(status)) throw new FeedbackPaginationError('无效的状态')
  const search = ((query.search as string | undefined) || '').trim().toLowerCase()
  if (search.length > 10000) throw new FeedbackPaginationError('搜索词不能超过 10000 字符')
  const filters = createHash('sha256').update(JSON.stringify([context, category, status, search])).digest('hex')
  let cursor: Cursor | undefined
  if (query.cursor !== undefined) {
    const encoded = query.cursor as string
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) throw new Error()
      const bytes = Buffer.from(encoded, 'base64url')
      if (bytes.toString('base64url') !== encoded) throw new Error()
      const value = JSON.parse(bytes.toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).sort().join(',') !== 'filters,id,time,v' || value.v !== 1 ||
          !Number.isSafeInteger(value.time) || value.time < 0 ||
          typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || value.filters !== filters) throw new Error()
      cursor = value
    } catch { throw new FeedbackPaginationError('无效或与筛选条件不匹配的 cursor') }
  }
  return { limit, category, status, search, filters, cursor }
}

// Scope is computed by the authenticated route. Never derive authorization
// from a cursor, filter, caller-provided device identifier or query parameter.
export function getAdminFeedbackPage(db: Database.Database, encryption: ContentEncryption,
  scope: { sql: string; params: string[] }, demoMode: boolean, options: FeedbackPaginationOptions) {
  return db.transaction(() => {
    const statusRows = db.prepare(`SELECT status, COUNT(*) n FROM feedbacks WHERE ${scope.sql} GROUP BY status`)
      .all(...scope.params) as { status: string; n: number }[]
    const counts = { total: 0, pending: 0, processing: 0, resolved: 0, noSolution: 0 }
    for (const row of statusRows) {
      counts.total += row.n
      if (row.status === 'pending') counts.pending = row.n
      if (row.status === 'in_progress') counts.processing = row.n
      if (row.status === 'resolved') counts.resolved = row.n
      if (row.status === 'no_solution') counts.noSolution = row.n
    }
    const where = [scope.sql], params: (string | number)[] = [...scope.params]
    if (options.category !== 'all') { where.push('category = ?'); params.push(options.category) }
    if (options.status !== 'all') { where.push('status = ?'); params.push(options.status) }
    const select = `SELECT id, category, device_id, created_at, status, original_content, original_content_storage_version,
      is_demo_template, is_demo_clone,
      CASE WHEN ${demoMode ? 'feedbacks.is_demo_template = 1' : '0'} THEN 0 ELSE
        (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id=feedbacks.id
          AND n.recipient_type='admin' AND n.recipient_id='admin' AND n.is_read=0) END AS unread_notifications
      FROM feedbacks WHERE ${where.join(' AND ')}`
    const plaintext = new Map<string, string>()
    let rows: Row[], total = 0
    if (!options.search) {
      total = (db.prepare(`SELECT COUNT(*) n FROM feedbacks WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n
      const after = options.cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''
      const cursorParams = options.cursor ? [options.cursor.time, options.cursor.time, options.cursor.id] : []
      rows = db.prepare(`${select}${after} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...params, ...cursorParams, options.limit + 1) as Row[]
    } else {
      // At-rest encryption rules out plaintext SQL LIKE. Iterate one row at a
      // time and retain only a page; do not create an unapproved plaintext index.
      rows = []
      for (const row of db.prepare(`${select} ORDER BY created_at DESC, id DESC`).iterate(...params) as Iterable<Row>) {
        const content = encryption.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, row.original_content_storage_version)
        if (!`${content} ${row.device_id}`.toLowerCase().includes(options.search)) continue
        total += 1
        if (options.cursor && (row.created_at > options.cursor.time ||
            (row.created_at === options.cursor.time && row.id >= options.cursor.id))) continue
        if (rows.length <= options.limit) { rows.push(row); plaintext.set(row.id, content) }
      }
    }
    const hasMore = rows.length > options.limit
    const page = rows.slice(0, options.limit)
    const last = page.at(-1)
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, time: last.created_at, id: last.id, filters: options.filters })).toString('base64url') : null
    const feedbacks = page.map(row => {
      const body = plaintext.get(row.id) ?? encryption.decrypt(row.original_content,
        `feedbacks:${row.id}:original_content`, row.original_content_storage_version)
      // Explicit whitelist. Detail is fetched separately before showing a body
      // or processing a record; storage metadata/ciphertext never leave here.
      return { id: row.id, category: row.category, device_id: row.device_id,
        created_at: new Date(row.created_at).toISOString(), status: row.status,
        original_content: Array.from(body).slice(0, 160).join(''),
        content_truncated: Array.from(body).length > 160,
        is_demo_template: row.is_demo_template, is_demo_clone: row.is_demo_clone,
        unread_notifications: row.unread_notifications }
    })
    return { success: true, feedbacks, pagination: { limit: options.limit, total, hasMore, nextCursor }, counts }
  }).deferred()
}
