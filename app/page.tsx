'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCrypto } from './hooks/useCrypto'
import ExternalLinks from './components/ExternalLinks'
import { recordCode } from './utils/recordCode'
import type { Feedback, FeedbackComment, FeedbackStatus } from './types'

type View = 'home' | 'category' | 'compose' | 'records' | 'detail'

type Notification = {
  id: string
  feedback_id: string
  type: 'comment' | 'status_update' | 'new_feedback'
  title: string
  content: string
  created_at: string
  is_read: number
}

const categories = [
  { id: 'suggestion', index: '01', name: '建议', description: '提出改进意见，让流程和服务更合理。' },
  { id: 'complaint', index: '02', name: '投诉', description: '反映已经发生、需要处理的具体问题。' },
  { id: 'report', index: '03', name: '举报', description: '提交涉嫌违规事项及可核实线索。' },
] as const

const statusConfig: Record<FeedbackStatus, { label: string; tone: string }> = {
  pending: { label: '待受理', tone: 'pending' },
  in_progress: { label: '处理中', tone: 'progress' },
  resolved: { label: '已办结', tone: 'resolved' },
  no_solution: { label: '暂无法处理', tone: 'muted' },
}

const categoryName = (category: string) =>
  categories.find((item) => item.id === category)?.name ?? '线索'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

async function readJson(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('服务暂时不可用，请稍后重试。')
  }
  try {
    return await response.json()
  } catch {
    throw new Error('服务响应异常，请稍后重试。')
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (!message || /^(failed to fetch|load failed|fetch failed|networkerror)/i.test(message)) {
    return fallback
  }
  return message
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="匿证首页">
      <img
        className="brand-mark"
        src="/anonyproof/brand/anonyproof-mark.svg"
        alt=""
        width="512"
        height="512"
      />
      <span className="brand-copy">
        <strong>匿证</strong>
        <small>ANONYPROOF</small>
      </span>
    </button>
  )
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const config = statusConfig[status] ?? statusConfig.pending
  return (
    <span className={`status status-${config.tone}`}>
      <span aria-hidden="true" />
      {config.label}
    </span>
  )
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export default function HomePage() {
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  const recordsListRef = useRef<HTMLDivElement>(null)
  const recordsScrollTopRef = useRef(0)
  const recordsLoadedRef = useRef(false)
  const notificationsLoadedRef = useRef(false)
  const [view, setView] = useState<View>('home')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; id?: string } | null>(null)
  const [stats, setStats] = useState<{ total: number } | null>(null)
  const [records, setRecords] = useState<Feedback[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState('')
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null)
  const [comments, setComments] = useState<FeedbackComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [newComment, setNewComment] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notificationError, setNotificationError] = useState('')
  const [showIdentity, setShowIdentity] = useState(false)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const { deviceId, recoveryCode, recoverIdentity, identityLoading, identityError, encrypt } = useCrypto()

  const goHome = () => {
    setView('home')
    setShowNotifications(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fetchUnreadCount = useCallback(async () => {
    if (!deviceId) return
    try {
      const response = await fetch(`/anonyproof/api/notifications/unread-count?recipientType=user&recipientId=${deviceId}`)
      const data = await readJson(response)
      if (response.ok && data.success) setUnreadCount(data.count)
    } catch {
      // Notification count is non-critical; keep the rest of the app usable.
    }
  }, [deviceId])

  const fetchRecords = useCallback(async () => {
    if (!deviceId) return []
    setRecordsLoading(true)
    setRecordsError('')
    try {
      const response = await fetch(`/anonyproof/api/feedback/device/${deviceId}`)
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '记录加载失败')
      setRecords(data.feedbacks)
      recordsLoadedRef.current = true
      return data.feedbacks as Feedback[]
    } catch (error) {
      const message = getErrorMessage(error, '无法连接服务，请检查网络后重试。')
      setRecordsError(recordsLoadedRef.current ? `${message} 当前显示上次数据。` : message)
      return []
    } finally {
      setRecordsLoading(false)
    }
  }, [deviceId])

  const fetchComments = useCallback(async (feedbackId: string) => {
    setCommentsLoading(true)
    setCommentError('')
    try {
      const response = await fetch(`/anonyproof/api/feedback/${feedbackId}/comments`)
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '沟通记录加载失败')
      setComments(data.comments)
    } catch (error) {
      setComments([])
      setCommentError(getErrorMessage(error, '无法连接服务，请检查网络后重试。'))
    } finally {
      setCommentsLoading(false)
    }
  }, [])

  const openRecord = useCallback((feedback: Feedback) => {
    recordsScrollTopRef.current = recordsListRef.current?.scrollTop ?? recordsScrollTopRef.current
    setSelectedFeedback(feedback)
    setView('detail')
    fetchComments(feedback.id)
    if (deviceId && (feedback.unread_notifications ?? 0) > 0) {
      fetch(`/anonyproof/api/notifications/read-all?recipientType=user&recipientId=${encodeURIComponent(deviceId)}&feedbackId=${encodeURIComponent(feedback.id)}`, { method: 'PUT' })
        .then(async (response) => {
          const data = await readJson(response)
          if (!response.ok || !data.success) return
          setRecords(items => items.map(item => item.id === feedback.id ? { ...item, unread_notifications: 0 } : item))
          setNotifications(items => items.map(item => item.feedback_id === feedback.id ? { ...item, is_read: 1 } : item))
          await fetchUnreadCount()
        })
        .catch(() => undefined)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [deviceId, fetchComments, fetchUnreadCount])

  const openRecords = useCallback(() => {
    setView('records')
    setShowNotifications(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // 身份初始化或换机恢复完成后，如果用户已经进入列表页，立即读取新身份名下的记录。
  useEffect(() => {
    if (view !== 'records' || !deviceId) return
    fetchRecords()
  }, [view, deviceId, fetchRecords])

  useEffect(() => {
    fetch('/anonyproof/api/stats')
      .then(async (response) => {
        const data = await readJson(response)
        if (!response.ok || data.success === false) throw new Error()
        setStats({ total: data.total ?? 0 })
      })
      .catch(() => setStats(null))
  }, [])

  useEffect(() => {
    fetchUnreadCount()
    const interval = window.setInterval(fetchUnreadCount, 30000)
    return () => window.clearInterval(interval)
  }, [fetchUnreadCount])

  useEffect(() => {
    if (!showNotifications) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNotifications(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showNotifications])

  const fetchNotifications = async () => {
    if (!deviceId) return
    setNotificationError('')
    try {
      const response = await fetch(`/anonyproof/api/notifications?recipientType=user&recipientId=${deviceId}&limit=20`)
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '通知加载失败')
      setNotifications(data.notifications)
      notificationsLoadedRef.current = true
    } catch (error) {
      const message = getErrorMessage(error, '无法连接服务，请检查网络后重试。')
      setNotificationError(
        notificationsLoadedRef.current ? `${message} 当前显示上次通知。` : message,
      )
    }
  }

  const toggleNotifications = () => {
    const next = !showNotifications
    setShowNotifications(next)
    if (next) {
      setNotificationError('')
      fetchNotifications()
    }
  }

  const markAsRead = async (notificationId: string) => {
    setNotificationError('')
    try {
      const response = await fetch(`/anonyproof/api/notifications/${notificationId}/read`, { method: 'PUT' })
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '通知状态更新失败')
      setNotifications((items) => items.map((item) => item.id === notificationId ? { ...item, is_read: 1 } : item))
      await fetchUnreadCount()
    } catch (error) {
      setNotificationError(getErrorMessage(error, '通知状态更新失败，请稍后重试。'))
    }
  }

  const markAllAsRead = async () => {
    setNotificationError('')
    try {
      const response = await fetch(`/anonyproof/api/notifications/read-all?recipientType=user&recipientId=${deviceId}`, { method: 'PUT' })
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '通知状态更新失败')
      setNotifications((items) => items.map((item) => ({ ...item, is_read: 1 })))
      setUnreadCount(0)
    } catch (error) {
      setNotificationError(getErrorMessage(error, '通知状态更新失败，请稍后重试。'))
    }
  }

  const openNotification = async (notification: Notification) => {
    if (!notification.is_read) await markAsRead(notification.id)
    const latestRecords = records.length ? records : await fetchRecords()
    const match = latestRecords.find((record) => record.id === notification.feedback_id)
    if (match) openRecord(match)
    else openRecords()
    setShowNotifications(false)
  }

  const handleSubmit = async () => {
    if (!content.trim()) {
      setSubmitResult({ success: false, message: '请填写事实或线索。' })
      return
    }
    if (!deviceId) {
      setSubmitResult({ success: false, message: '正在准备本机记录，请稍后再试。' })
      return
    }
    setIsSubmitting(true)
    setSubmitResult(null)
    try {
      const encryptedContent = await encrypt(content.trim())
      const response = await fetch('/anonyproof/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, encryptedContent, deviceId, originalContent: content.trim() }),
      })
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '提交未完成，请稍后重试。')
      setContent('')
      setSubmitResult({ success: true, message: '已生成记录编号，可在“我的提交”中查看处理进度。', id: data.id })
      setStats((current) => ({ total: (current?.total ?? 0) + 1 }))
    } catch (error) {
      setSubmitResult({
        success: false,
        message: getErrorMessage(error, '提交未完成，请检查网络后重试。已输入内容仍保留。'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddComment = async () => {
    if (!selectedFeedback || newComment.trim().length < 2) return
    setCommentSending(true)
    setCommentError('')
    try {
      const response = await fetch(`/anonyproof/api/feedback/${selectedFeedback.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.trim(), commenterType: 'user' }),
      })
      const data = await readJson(response)
      if (!response.ok || !data.success) throw new Error(data.error || '补充说明未发送')
      setNewComment('')
      fetchComments(selectedFeedback.id)
    } catch (error) {
      setCommentError(getErrorMessage(error, '补充说明未发送，请检查网络后重试。'))
    } finally {
      setCommentSending(false)
    }
  }

  const copyRecoveryCode = async () => {
    if (!recoveryCode) return
    setRecoveryMessage(null)
    try {
      await navigator.clipboard.writeText(recoveryCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setRecoveryMessage({ tone: 'error', text: '复制失败，请手动选择恢复码。' })
    }
  }

  const handleRecoverIdentity = async () => {
    const code = recoveryInput.trim()
    if (!code) {
      setRecoveryMessage({ tone: 'error', text: '请输入恢复码。' })
      return
    }
    setRecovering(true)
    setRecoveryMessage(null)
    try {
      await recoverIdentity(code)
      setRecoveryInput('')
      setRecoveryMessage({ tone: 'success', text: '已切换到该恢复码对应的提交记录。' })
    } catch (error) {
      setRecoveryMessage({ tone: 'error', text: getErrorMessage(error, '恢复失败，请检查恢复码后重试。') })
    } finally {
      setRecovering(false)
    }
  }

  const filteredRecords = useMemo(() => records.filter((record) => {
    const matchesCategory = filterCategory === 'all' || record.category === filterCategory
    const matchesStatus = filterStatus === 'all' || record.status === filterStatus
    const matchesSearch = !searchKeyword.trim() || record.original_content?.toLowerCase().includes(searchKeyword.trim().toLowerCase())
    return matchesCategory && matchesStatus && matchesSearch
  }), [records, filterCategory, filterStatus, searchKeyword])

  useEffect(() => {
    if (view !== 'records') return
    const frame = window.requestAnimationFrame(() => {
      if (recordsListRef.current) {
        recordsListRef.current.scrollTop = recordsScrollTopRef.current
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view, filteredRecords])

  const recordCounts = useMemo(() => records.reduce((result, record) => {
    result[record.status] = (result[record.status] ?? 0) + 1
    return result
  }, {} as Record<string, number>), [records])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand onClick={goHome} />
          <nav className="topnav" aria-label="主要导航">
            <button className={view === 'home' ? 'is-active' : ''} type="button" onClick={goHome}>首页</button>
            <button className={view === 'records' || view === 'detail' ? 'is-active' : ''} type="button" onClick={openRecords}>我的提交</button>
          </nav>
          <div className="topbar-tools">
            <ExternalLinks linkClassName="topbar-link" />
            <a className="admin-entry" href="/anonyproof/foorpynona">
              <span className="admin-entry-full">管理员入口</span>
              <span className="admin-entry-short">管理</span>
            </a>
            <div className="notification-wrap" ref={notificationPanelRef}>
            <button className="notification-button" type="button" onClick={toggleNotifications} aria-expanded={showNotifications}>
              通知
              {unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {showNotifications && (
              <section className="notification-panel" aria-label="通知中心">
                <div className="notification-head">
                  <div>
                    <strong>通知</strong>
                    <span>{unreadCount ? `${unreadCount} 条未读` : '已全部读完'}</span>
                  </div>
                  {unreadCount > 0 && <button type="button" onClick={markAllAsRead}>全部已读</button>}
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <p className="empty-compact">暂无通知</p>
                  ) : notifications.map((notification) => (
                    <button
                      className={`notification-item ${notification.is_read ? '' : 'is-unread'}`}
                      key={notification.id}
                      type="button"
                      onClick={() => openNotification(notification)}
                    >
                      <span className="notification-meta">
                        <strong>{notification.title}</strong>
                        <time>{formatDate(notification.created_at)}</time>
                      </span>
                      <span>{notification.content}</span>
                    </button>
                  ))}
                </div>
                {notificationError && <p className="notification-error" role="alert">{notificationError}</p>}
              </section>
            )}
            </div>
          </div>
        </div>
      </header>

      <main>
        {view === 'home' && (
          <div className="home-view">
            <section className="hero-band">
              <div className="hero-copy">
                <h1>让重要线索<br />被认真看见。</h1>
                <p className="hero-lead">提交建议、投诉与违规线索，处理进度随时可查。</p>
                <div className="hero-actions">
                  <button className="button button-primary" type="button" onClick={() => { setCategory(''); setSubmitResult(null); setView('category') }}>
                    提交线索 <span aria-hidden="true">→</span>
                  </button>
                  <button className="button button-secondary" type="button" onClick={openRecords}>查看我的提交</button>
                </div>
                <div className="hero-facts" aria-label="平台特点">
                  <span>无需实名</span>
                  <span>本机识别</span>
                </div>
              </div>
              <aside className="flow-board" aria-label="提交处理流程">
                <div className="flow-board-head">
                  <span>处理流程</span>
                  <span className="live-dot"><i />持续可查</span>
                </div>
                <ol>
                  <li><span>01</span><div><strong>描述事实</strong></div></li>
                  <li><span>02</span><div><strong>提交受理</strong></div></li>
                  <li><span>03</span><div><strong>查看进度</strong></div></li>
                </ol>
                <div className="flow-proof">
                  <span>{stats ? stats.total : '—'}</span>
                  <div><strong>已收到的提交</strong><small>公开统计仅展示总量</small></div>
                </div>
              </aside>
            </section>
            <footer className="home-disclaimer" aria-labelledby="home-disclaimer-title">
              <div className="home-disclaimer-inner">
                <h2 id="home-disclaimer-title">声明</h2>
                <p>本平台仅用于学习交流，紧急情况请联系对应紧急服务处理。</p>
                <div className="home-filing">
                  <span>© 2026 匿证</span>
                  <span aria-hidden="true">·</span>
                  <span>MIT 开源</span>
                  <span aria-hidden="true">·</span>
                  <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
                    粤ICP备2025449309号-2
                  </a>
                </div>
              </div>
            </footer>
          </div>
        )}

        {view === 'category' && (
          <section className="task-view narrow-view category-view">
            <button className="back-link" type="button" onClick={goHome} aria-label="返回首页">
              <BackIcon />
              <span className="back-link-label">返回首页</span>
            </button>
            <div className="task-heading">
              <p className="eyebrow">第 1 步，共 2 步</p>
              <h1>选择提交类型</h1>
              <p>选择最接近的类型，进入下一步填写具体内容。</p>
            </div>
            <div className="category-list">
              {categories.map((item) => (
                <button key={item.id} type="button" onClick={() => { setCategory(item.id); setView('compose') }}>
                  <span className="category-index">{item.index}</span>
                  <span><strong>{item.name}</strong><small>{item.description}</small></span>
                  <i aria-hidden="true">→</i>
                </button>
              ))}
            </div>
          </section>
        )}

        {view === 'compose' && (
          <section className="task-view compose-view">
            <button className="back-link" type="button" onClick={() => setView('category')} aria-label="返回选择">
              <BackIcon />
              <span className="back-link-label">返回选择</span>
            </button>
            <div className="task-heading">
              <p className="eyebrow">第 2 步，共 2 步 · {categoryName(category)}</p>
              <h1>描述事实与线索</h1>
              <p>优先写清可核实的信息，不必使用正式措辞。</p>
            </div>
            <div className="compose-layout">
              <div className="compose-main">
                <label htmlFor="evidence-content">提交内容</label>
                <textarea
                  id="evidence-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="请说明发生时间、地点、涉及事项和可核实线索。为保护自己，请勿填写姓名、手机号等可识别身份的信息。"
                  maxLength={10000}
                  autoFocus
                />
                <div className="field-meta"><span>提交失败不会清空已输入内容</span><span>{content.length} / 10000</span></div>
                {submitResult && !submitResult.success && <p className="form-message form-error" role="alert">{submitResult.message}</p>}
                <div className="submit-bar">
                  <button className="button button-secondary" type="button" onClick={() => setView('category')}>上一步</button>
                  <button className="button button-primary" type="button" onClick={handleSubmit} disabled={isSubmitting || !content.trim()}>
                    {isSubmitting ? '正在提交…' : '提交线索'}
                  </button>
                </div>
              </div>
              <aside className="privacy-panel">
                <h2>提交前检查</h2>
                <ul>
                  <li><span />删去姓名、电话、住址等身份信息</li>
                  <li><span />区分亲历事实与转述内容</li>
                  <li><span />保留时间、地点和可核实细节</li>
                </ul>
                <p>平台会保存提交原文、本机识别码、访问 IP 与浏览器信息；这些信息仍可能间接识别提交环境，因此不等于完全匿名。</p>
              </aside>
            </div>
          </section>
        )}

        {view === 'records' && (
          <section className="task-view records-view">
            <div className="records-heading">
              <div>
                <p className="eyebrow">当前浏览器</p>
                <h1>我的提交</h1>
                <p>记录仅关联当前浏览器，请勿公开分享记录编号。</p>
              </div>
              <button className="button button-primary" type="button" onClick={() => setView('category')}>新增提交</button>
            </div>
            <div className="identity-bar">
              <div className="identity-bar-code">
                <span>本机恢复码</span>
                <code>{recoveryCode || '正在生成…'}</code>
              </div>
              <div className="identity-bar-actions">
                <button type="button" onClick={copyRecoveryCode} disabled={!recoveryCode}>{codeCopied ? '已复制' : '复制'}</button>
                <button
                  type="button"
                  aria-expanded={showIdentity}
                  onClick={() => { setShowIdentity((current) => !current); setRecoveryMessage(null) }}
                >
                  {showIdentity ? '收起' : '换机找回'}
                </button>
              </div>
            </div>
            {showIdentity && (
              <div className="identity-recover">
                <p>换浏览器或清除数据后，输入恢复码即可重新打开同一批提交。恢复码只保存在本机，恢复其他身份后需要原恢复码才能回到当前记录。</p>
                <div className="identity-recover-form">
                  <label className="visually-hidden" htmlFor="recovery-code">恢复码</label>
                  <input
                    id="recovery-code"
                    value={recoveryInput}
                    onChange={(event) => setRecoveryInput(event.target.value)}
                    placeholder="输入恢复码，例如 XXXXX-XXXXX-XXXXX-XXXXX"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="button button-primary" type="button" onClick={handleRecoverIdentity} disabled={recovering || !recoveryInput.trim()}>
                    {recovering ? '正在恢复…' : '恢复'}
                  </button>
                </div>
                {recoveryMessage && (
                  <p className={recoveryMessage.tone === 'error' ? 'identity-message is-error' : 'identity-message'} role="alert">
                    {recoveryMessage.text}
                  </p>
                )}
              </div>
            )}
            <div className="record-summary" aria-label="提交状态概览">
              <div><span>{records.length}</span><small>全部提交</small></div>
              <div><span>{recordCounts.pending ?? 0}</span><small>待受理</small></div>
              <div><span>{recordCounts.in_progress ?? 0}</span><small>处理中</small></div>
              <div><span>{recordCounts.resolved ?? 0}</span><small>已办结</small></div>
              <div><span>{recordCounts.no_solution ?? 0}</span><small>暂无法处理</small></div>
            </div>
            <div className="filters" aria-label="筛选提交记录">
              <input aria-label="搜索提交内容" value={searchKeyword} onChange={(event) => { recordsScrollTopRef.current = 0; setSearchKeyword(event.target.value) }} placeholder="搜索提交内容" />
              <select aria-label="按提交类型筛选" value={filterCategory} onChange={(event) => { recordsScrollTopRef.current = 0; setFilterCategory(event.target.value) }}><option value="all">全部类型</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
              <select aria-label="按处理状态筛选" value={filterStatus} onChange={(event) => { recordsScrollTopRef.current = 0; setFilterStatus(event.target.value) }}><option value="all">全部状态</option>{Object.entries(statusConfig).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select>
            </div>
            <div className="records-results">
              {recordsError && <div className="inline-error" role="alert"><span>{recordsError}</span><button type="button" onClick={fetchRecords}>重试</button></div>}
              {identityLoading || recordsLoading ? (
                <div className="records-loading" aria-live="polite"><span /><p>正在读取当前浏览器的提交记录…</p></div>
              ) : identityError ? (
                <div className="inline-error" role="alert"><span>{identityError}</span><button type="button" onClick={() => window.location.reload()}>重新载入</button></div>
              ) : filteredRecords.length === 0 ? (
                <div className="empty-state"><strong>{records.length ? '没有符合当前条件的记录' : '当前浏览器暂无提交记录'}</strong><p>{records.length ? '调整搜索词或筛选条件后重试。' : '提交后，处理状态和沟通记录会显示在这里。'}</p>{!records.length && <button className="button button-primary" type="button" onClick={() => setView('category')}>提交第一条线索</button>}</div>
              ) : (
                <div className="record-list" ref={recordsListRef} onScroll={(event) => { recordsScrollTopRef.current = event.currentTarget.scrollTop }}>
                  {filteredRecords.map((record) => (
                    <button key={record.id} type="button" onClick={() => openRecord(record)}>
                      <span className="record-main">
                        <span className="record-meta">
                          <span className={`category-tag category-tag-${record.category}`}>{categoryName(record.category)}</span>
                          <time>{formatDate(record.created_at)}</time>
                          <small className="record-id">#{recordCode(record.id)}</small>
                          {(record.unread_notifications ?? 0) > 0 && <em className="record-unread">{record.unread_notifications} 条新消息</em>}
                        </span>
                        <strong>{record.original_content || '未提供可预览内容'}</strong>
                      </span>
                      <span className="record-side"><StatusBadge status={record.status} /><i aria-hidden="true">→</i></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {view === 'detail' && selectedFeedback && (
          <section className="task-view detail-view">
            <div className="detail-head">
              <button className="back-link" type="button" onClick={() => setView('records')} aria-label="返回我的提交">
                <BackIcon />
                <span className="back-link-label">返回我的提交</span>
              </button>
              <div className="detail-head-main">
                <h1>提交详情</h1>
                <div className="detail-subline">
                  <span className={`category-tag category-tag-${selectedFeedback.category}`}>{categoryName(selectedFeedback.category)}</span>
                  <span className="detail-code">#{recordCode(selectedFeedback.id)}</span>
                  <time>{formatDate(selectedFeedback.created_at)}</time>
                </div>
              </div>
              <StatusBadge status={selectedFeedback.status} />
            </div>
            <div className="detail-layout">
              <div className="detail-content">
                <section><h2>提交材料</h2><p>{selectedFeedback.original_content}</p></section>
                <section><h2>处理说明</h2>{selectedFeedback.solution ? <p>{selectedFeedback.solution}</p> : <p className="muted-copy">处理人员尚未填写说明，状态更新后会显示在这里。</p>}</section>
              </div>
              <aside className="conversation-panel">
                <div className="conversation-head"><h2>沟通记录</h2><span>{comments.length} 条</span></div>
                <div className="comment-list">
                  {commentsLoading ? <div className="records-loading" aria-live="polite"><span /><p>正在加载沟通记录…</p></div> : comments.length === 0 ? <p className="empty-compact">暂无沟通记录</p> : comments.map((comment) => (
                    <article className={comment.commenter_type === 'admin' ? 'is-admin' : ''} key={comment.id}>
                      <div><strong>{comment.commenter_type === 'admin' ? '处理人员回复' : '提交人补充'}</strong><time>{formatDate(comment.created_at)}</time></div>
                      <p>{comment.content}</p>
                    </article>
                  ))}
                </div>
                {commentError && <p className="form-message form-error" role="alert">{commentError}</p>}
                <div className="comment-composer">
                  <div className="comment-input">
                    <label className="visually-hidden" htmlFor="comment">补充说明</label>
                    <textarea id="comment" value={newComment} onChange={(event) => setNewComment(event.target.value)} placeholder="补充事实、线索或问题；最多 1000 字" maxLength={1000} />
                    {newComment.length >= 800 && <span className="comment-count" aria-live="polite">{newComment.length} / 1000</span>}
                  </div>
                  <button className="button button-primary" type="button" disabled={commentSending || newComment.trim().length < 2} onClick={handleAddComment}>{commentSending ? '正在发送…' : '发送补充'}</button>
                </div>
              </aside>
            </div>
          </section>
        )}

        {submitResult?.success && (
          <div className="dialog-backdrop" role="presentation">
            <section className="success-dialog" role="dialog" aria-modal="true" aria-labelledby="success-title">
              <div className="success-mark" aria-hidden="true">✓</div>
              <p className="eyebrow">已完成</p>
              <h2 id="success-title">提交已收到</h2>
              <p>{submitResult.message}</p>
              <code>{submitResult.id}</code>
              <div><button className="button button-primary" type="button" onClick={() => { setSubmitResult(null); openRecords() }}>查看处理进度</button><button className="button button-secondary" type="button" onClick={() => { setSubmitResult(null); goHome() }}>返回首页</button></div>
            </section>
          </div>
        )}
      </main>

    </div>
  )
}
