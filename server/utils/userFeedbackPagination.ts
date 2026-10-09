import type Database from 'better-sqlite3'
import type { ContentEncryption } from './contentEncryption'
import type { FeedbackPaginationOptions } from './adminFeedbackPagination'

type Row = {
  id: string; category: string; created_at: number; status: string;
  original_content: string; original_content_storage_version: number; unread_notifications: number;
}

// Device and visibility scope come from the authenticated route. The cursor
// only controls ordering and never selects ownership or decrypting authority.
export function getUserFeedbackPage(db: Database.Database, encryption: ContentEncryption,
  deviceId: string, scope: { sql: string; params: string[] }, options: FeedbackPaginationOptions) {
  return db.transaction(() => {
    const baseParams = [deviceId, ...scope.params]
    const statusRows = db.prepare(`SELECT status, COUNT(*) n FROM feedbacks WHERE device_id=? AND ${scope.sql} GROUP BY status`)
      .all(...baseParams) as { status: string; n: number }[]
    const counts = { total: 0, pending: 0, in_progress: 0, resolved: 0, no_solution: 0 }
    for (const row of statusRows) {
      counts.total += row.n
      if (row.status in counts && row.status !== 'total') counts[row.status as Exclude<keyof typeof counts, 'total'>] = row.n
    }
    const where = ['device_id=?', scope.sql], params: (string | number)[] = [...baseParams]
    if (options.category !== 'all') { where.push('category=?'); params.push(options.category) }
    if (options.status !== 'all') { where.push('status=?'); params.push(options.status) }
    const select = `SELECT id, category, created_at, status, original_content, original_content_storage_version,
      (SELECT COUNT(*) FROM notifications n WHERE n.feedback_id=feedbacks.id
        AND n.recipient_type='user' AND n.recipient_id=? AND n.is_read=0) AS unread_notifications
      FROM feedbacks WHERE ${where.join(' AND ')}`
    const plaintext = new Map<string, string>()
    let rows: Row[], total = 0
    if (!options.search) {
      total = (db.prepare(`SELECT COUNT(*) n FROM feedbacks WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n
      const after = options.cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''
      const cursorParams = options.cursor ? [options.cursor.time, options.cursor.time, options.cursor.id] : []
      rows = db.prepare(`${select}${after} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(deviceId, ...params, ...cursorParams, options.limit + 1) as Row[]
    } else {
      // Content is encrypted at rest. Scan/decrypt one authorized row at a
      // time; retain only one response page and never create a plaintext index.
      rows = []
      for (const row of db.prepare(`${select} ORDER BY created_at DESC, id DESC`).iterate(deviceId, ...params) as Iterable<Row>) {
        const content = encryption.decrypt(row.original_content, `feedbacks:${row.id}:original_content`, row.original_content_storage_version)
        if (!content.toLowerCase().includes(options.search)) continue
        total++
        if (options.cursor && (row.created_at > options.cursor.time ||
            (row.created_at === options.cursor.time && row.id >= options.cursor.id))) continue
        if (rows.length <= options.limit) { rows.push(row); plaintext.set(row.id, content) }
      }
    }
    const hasMore = rows.length > options.limit
    const page = rows.slice(0, options.limit), last = page.at(-1)
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({
      v: 1, time: last.created_at, id: last.id, filters: options.filters,
    })).toString('base64url') : null
    const feedbacks = page.map(row => {
      const body = plaintext.get(row.id) ?? encryption.decrypt(row.original_content,
        `feedbacks:${row.id}:original_content`, row.original_content_storage_version)
      const characters = Array.from(body)
      return { id: row.id, category: row.category, created_at: new Date(row.created_at).toISOString(), status: row.status,
        original_content: characters.slice(0, 160).join(''), content_truncated: characters.length > 160,
        unread_notifications: row.unread_notifications }
    })
    return { success: true, feedbacks, pagination: { limit: options.limit, total, hasMore, nextCursor }, counts }
  }).deferred()
}
