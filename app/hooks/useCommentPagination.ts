'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ThreadComment = { id: number; feedback_id: string; created_at: string }
type Mode = 'latest' | 'older' | 'newer'

// Both user and admin views share the same bounded thread protocol. Owner and
// thread epochs prevent a late request from restoring a previous selection.
export function useCommentPagination<T extends ThreadComment>(owner: string,
  readResponse: (response: Response) => Promise<any>, onError: (error: unknown) => void) {
  const [comments, setComments] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const storedOwnerRef = useRef(owner)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const readerRef = useRef(readResponse)
  readerRef.current = readResponse
  const errorRef = useRef(onError)
  errorRef.current = onError
  const requestRef = useRef(0)
  const threadRef = useRef<string | null>(null)
  const olderRef = useRef<string | null>(null)
  const latestRef = useRef<string | null>(null)
  const reset = useCallback(() => {
    requestRef.current++
    storedOwnerRef.current = ownerRef.current
    threadRef.current = null
    olderRef.current = latestRef.current = null
    setComments([])
    setTotal(0)
    setLoading(false)
    setHasOlder(false)
  }, [])
  useEffect(reset, [owner, reset])

  const merge = useCallback((rows: T[]) => {
    setComments(previous => Array.from(new Map([...previous, ...rows].map(row => [row.id, row])).values())
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id))
  }, [])

  const load = useCallback(async (id: string, mode: Mode = 'latest') => {
    if (mode !== 'latest' && threadRef.current !== id) return false
    if (mode === 'older' && !olderRef.current) return false
    if (mode === 'latest') {
      reset()
      threadRef.current = id
    }
    const request = ++requestRef.current, requestOwner = ownerRef.current
    const current = () => request === requestRef.current && threadRef.current === id && ownerRef.current === requestOwner
    setLoading(true)
    const incremental = mode === 'newer' && latestRef.current !== null
    let cursor = mode === 'older' ? olderRef.current : mode === 'newer' ? latestRef.current : null
    try {
      // A burst of new replies may take several bounded requests. Merge each
      // page while retaining loaded older pages; never refetch an entire thread.
      let more: boolean
      do {
        const query = new URLSearchParams({ pagination: '1', limit: '50' })
        if (cursor) query.set(incremental ? 'after' : 'cursor', cursor)
        const response = await fetch(`/anonyproof/api/feedback/${encodeURIComponent(id)}/comments?${query}`, { credentials: 'same-origin' })
        const data = await readerRef.current(response)
        if (!current()) return false
        if (!response.ok || !data.success) throw new Error(data.error || '沟通记录加载失败')
        merge(data.comments)
        setTotal(data.pagination.total)
        if (!incremental) {
          olderRef.current = data.pagination.nextCursor
          setHasOlder(data.pagination.hasMore)
        }
        if (mode !== 'older' && data.pagination.latestCursor) latestRef.current = data.pagination.latestCursor
        cursor = data.pagination.nextCursor
        more = incremental && data.pagination.hasMore
      } while (more && current())
      return true
    } catch (error) {
      if (current()) errorRef.current(error)
      return false
    } finally {
      if (current()) setLoading(false)
    }
  }, [merge, reset])

  const appendPosted = useCallback((comment: T, requestOwner: string) => {
    if (threadRef.current !== comment.feedback_id || ownerRef.current !== requestOwner) return false
    merge([comment])
    setTotal(value => value + 1)
    return true
  }, [merge])
  const visible = storedOwnerRef.current === owner
  return { comments: visible ? comments : [], total: visible ? total : 0, loading: visible && loading,
    hasOlder: visible && hasOlder, reset, load, appendPosted }
}
