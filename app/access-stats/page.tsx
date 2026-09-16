'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDemoConfig } from '../hooks/useDemoConfig'
import { demoPageSessionHeaders } from '../utils/pageSession'
import ExternalLinks from '../components/ExternalLinks'
import type {
  AccessLog,
  AccessStatsData,
  BlacklistedIP,
} from '../components/accessStats'

type Tab = 'overview' | 'logs' | 'suspicious' | 'blacklist'
type MessageTone = 'info' | 'success' | 'error'

type Notification = {
  id: number
  feedback_id: string
  title: string
  content: string
  created_at: string
  is_read: number
}

class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const api = (path: string, init?: RequestInit) =>
  fetch(`/anonyproof/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...demoPageSessionHeaders(),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })

async function readResponseJson(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError('服务响应异常，请稍后重试', response.status)
  }

  try {
    return await response.json()
  } catch {
    throw new ApiError('服务响应异常，请稍后重试', response.status)
  }
}

async function readApiJson(response: Response) {
  const data = await readResponseJson(response)

  if (response.status === 401) {
    throw new ApiError(data.error || '需要管理员登录', 401)
  }
  if (!response.ok || data.success === false) {
    throw new ApiError(data.error || '请求失败，请稍后重试', response.status)
  }

  return data
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message
    ? error.message
    : fallback
}

export default function AccessStatsPage() {
  const { config: demoConfig } = useDemoConfig()
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const dataLoadedRef = useRef(false)
  const notificationsLoadedRef = useRef(false)
  const logTableScrollTopRef = useRef(0)
  const suspiciousTableScrollTopRef = useRef(0)
  const blacklistTableScrollTopRef = useRef(0)
  const tabScrollPositionsRef = useRef<Record<Tab, number>>({
    overview: 0,
    logs: 0,
    suspicious: 0,
    blacklist: 0,
  })

  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [stats, setStats] = useState<AccessStatsData | null>(null)
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [suspicious, setSuspicious] = useState<AccessLog[]>([])
  const [blacklist, setBlacklist] = useState<BlacklistedIP[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<MessageTone>('info')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)

  const resetProtectedState = useCallback(() => {
    setStats(null)
    setLogs([])
    setSuspicious([])
    setBlacklist([])
    setNotifications([])
    setUnreadCount(0)
    setNotificationError('')
    setShowNotifications(false)
    setMessage('')
    dataLoadedRef.current = false
    notificationsLoadedRef.current = false
    logTableScrollTopRef.current = 0
    suspiciousTableScrollTopRef.current = 0
    blacklistTableScrollTopRef.current = 0
  }, [])

  const handleRequestError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.status === 401) {
        setAuthenticated(false)
        resetProtectedState()
        return
      }

      setMessage(getRequestErrorMessage(error, fallback))
      setMessageTone('error')
    },
    [resetProtectedState],
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsResponse, logsResponse, suspiciousResponse, blacklistResponse] =
        await Promise.all([
          api('/admin/access/stats'),
          api('/admin/access/logs?limit=100'),
          api('/admin/access/suspicious?limit=50'),
          api('/admin/access/blacklist'),
        ])
      const [statsData, logsData, suspiciousData, blacklistData] =
        await Promise.all([
          readApiJson(statsResponse),
          readApiJson(logsResponse),
          readApiJson(suspiciousResponse),
          readApiJson(blacklistResponse),
        ])

      setStats(statsData.data)
      setLogs(logsData.data)
      setSuspicious(suspiciousData.data)
      setBlacklist(blacklistData.data)
      dataLoadedRef.current = true
      setMessage('')
      setMessageTone('info')
    } catch (error) {
      handleRequestError(
        error,
        dataLoadedRef.current
          ? '无法连接管理服务，当前显示上次数据'
          : '无法连接管理服务，请检查网络后重试',
      )
    } finally {
      setLoading(false)
    }
  }, [handleRequestError])

  const fetchNotifications = useCallback(async () => {
    setNotificationError('')
    try {
      const [countResponse, listResponse] = await Promise.all([
        api('/notifications/unread-count?recipientType=admin&recipientId=admin'),
        api('/notifications?recipientType=admin&recipientId=admin&limit=30'),
      ])
      const [countData, listData] = await Promise.all([
        readApiJson(countResponse),
        readApiJson(listResponse),
      ])

      setUnreadCount(countData.count)
      setNotifications(listData.notifications)
      notificationsLoadedRef.current = true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthenticated(false)
        resetProtectedState()
        return
      }

      setNotificationError(
        getRequestErrorMessage(
          error,
          notificationsLoadedRef.current
            ? '通知暂时无法加载，当前显示上次通知'
            : '通知暂时无法加载，访问数据不受影响',
        ),
      )
    }
  }, [resetProtectedState])

  useEffect(() => {
    let active = true

    const checkSession = async () => {
      try {
        const response = await api('/admin/auth/session')
        if (response.status === 401) {
          if (active) {
            setAuthenticated(false)
            resetProtectedState()
          }
          return
        }

        const data = await readApiJson(response)
        if (!active) return

        const isAuthenticated = Boolean(data.authenticated)
        setAuthenticated(isAuthenticated)
        if (isAuthenticated) {
          await Promise.all([fetchData(), fetchNotifications()])
        }
      } catch (error) {
        if (active) {
          setLoginError(
            getRequestErrorMessage(error, '无法连接管理服务，请稍后重试'),
          )
        }
      } finally {
        if (active) setChecking(false)
      }
    }

    checkSession()
    return () => {
      active = false
    }
  }, [fetchData, fetchNotifications, resetProtectedState])

  useEffect(() => {
    if (!authenticated) return
    const interval = window.setInterval(fetchData, 30000)
    return () => window.clearInterval(interval)
  }, [authenticated, fetchData])

  useEffect(() => {
    if (!authenticated) return
    const interval = window.setInterval(fetchNotifications, 20000)
    return () => window.clearInterval(interval)
  }, [authenticated, fetchNotifications])

  useEffect(() => {
    if (!showNotifications) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        notificationPanelRef.current &&
        !notificationPanelRef.current.contains(event.target as Node)
      ) {
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = tabScrollPositionsRef.current[tab]
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [tab])

  const changeTab = (nextTab: Tab) => {
    if (nextTab === tab) return
    tabScrollPositionsRef.current[tab] = contentRef.current?.scrollTop ?? 0
    setTab(nextTab)
  }

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const response = await api('/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await readResponseJson(response)
      if (!response.ok || !data.success) {
        setLoginError(data.error || '登录失败，请检查密码')
        return
      }

      setAuthenticated(true)
      setPassword('')
      await Promise.all([fetchData(), fetchNotifications()])
    } catch (error) {
      setLoginError(getRequestErrorMessage(error, '无法连接管理服务，请稍后重试'))
    } finally {
      setLoginLoading(false)
    }
  }

  const logout = async () => {
    try {
      const response = await api('/admin/auth/logout', { method: 'POST' })
      if (response.status !== 401) await readApiJson(response)
    } catch {
      // The local session is cleared even if the server is temporarily unavailable.
    } finally {
      setAuthenticated(false)
      resetProtectedState()
    }
  }

  const unblacklist = async (ip: string) => {
    if (!window.confirm(`解除后，IP ${ip} 将恢复访问。确定继续吗？`)) return

    setMessage('')
    try {
      const response = await api(
        `/admin/access/blacklist/${encodeURIComponent(ip)}`,
        { method: 'DELETE' },
      )
      await readApiJson(response)
      await fetchData()
      setMessage('访问限制已解除')
      setMessageTone('success')
    } catch (error) {
      handleRequestError(error, '操作失败，请稍后重试')
    }
  }

  const markNotificationRead = async (item: Notification) => {
    try {
      if (!item.is_read) {
        const response = await api(`/notifications/${item.id}/read`, {
          method: 'PUT',
        })
        await readApiJson(response)
        setNotifications((items) =>
          items.map((entry) =>
            entry.id === item.id ? { ...entry, is_read: 1 } : entry,
          ),
        )
        await fetchNotifications()
      }

      setShowNotifications(false)
      window.location.href = `/anonyproof/foorpynona?feedback=${encodeURIComponent(item.feedback_id)}`
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthenticated(false)
        resetProtectedState()
        return
      }
      setNotificationError(
        getRequestErrorMessage(error, '通知状态更新失败，请稍后重试'),
      )
    }
  }

  const markAllNotificationsRead = async () => {
    setNotificationError('')
    try {
      const response = await api(
        '/notifications/read-all?recipientType=admin&recipientId=admin',
        { method: 'PUT' },
      )
      await readApiJson(response)
      setUnreadCount(0)
      setNotifications((items) =>
        items.map((item) => ({ ...item, is_read: 1 })),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthenticated(false)
        resetProtectedState()
        return
      }
      setNotificationError(
        getRequestErrorMessage(error, '通知状态更新失败，请稍后重试'),
      )
    }
  }

  if (checking) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        正在验证管理员会话
      </div>
    )
  }

  if (!authenticated) {
    return (
      <main className="admin-auth-page">
        <nav className="admin-auth-links" aria-label="外部链接">
          <ExternalLinks linkClassName="admin-external-link" />
        </nav>
        <section
          className="admin-auth-panel"
          aria-labelledby="access-login-title"
        >
          <div className="admin-auth-intro">
            <div className="brand-lockup">
              <img
                className="brand-mark"
                src="/anonyproof/brand/anonyproof-mark.svg"
                alt=""
                width="36"
                height="36"
              />
              <span>AnonyProof 管理台</span>
            </div>
            <div>
              <p className="eyebrow">管理入口</p>
              <h1 id="access-login-title">管理员登录</h1>
              <p className="admin-auth-copy">验证身份后进入访问与风控。</p>
            </div>
          </div>
          <div className="admin-auth-form-panel">
            {demoConfig?.demoMode && demoConfig.adminPassword && (
              <aside className="admin-demo-notice" role="status">
                <strong>演示默认密码</strong>
                <code>{demoConfig.adminPassword}</code>
                <p>
                  {demoConfig.notice ||
                    '仅用于效果演示，正式部署前必须清除预设管理员密码。'}
                </p>
              </aside>
            )}
            <form onSubmit={handleLogin} className="admin-auth-form">
              <label htmlFor="access-password">访问密码</label>
              <input
                id="access-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入管理员密码"
                required
              />
              {loginError && (
                <p className="form-error" role="alert">
                  {loginError}
                </p>
              )}
              <button
                className="admin-primary-button"
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading ? '正在登录…' : '登录管理台'}
              </button>
            </form>
            <p className="admin-auth-footnote">会话仅保留在当前浏览器。</p>
          </div>
        </section>
      </main>
    )
  }

  const tabs: Array<[Tab, string]> = [
    ['overview', '概览'],
    ['logs', '访问日志'],
    ['suspicious', '风控命中'],
    ['blacklist', `访问限制名单 (${blacklist.length})`],
  ]
  const max = Math.max(
    1,
    ...(stats?.last7Days || []).map((day) => day.total_visits),
  )

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <a href="/anonyproof" className="brand-lockup">
            <img
              className="brand-mark"
              src="/anonyproof/brand/anonyproof-mark.svg"
              alt=""
              width="36"
              height="36"
            />
            <span>AnonyProof</span>
          </a>
          <nav className="admin-nav" aria-label="管理导航">
            <a href="/anonyproof/foorpynona">线索管理</a>
            <a className="is-active" href="/anonyproof/access-stats">
              访问与风控
            </a>
          </nav>
          <div className="admin-tools">
            <ExternalLinks linkClassName="admin-external-link" />
            <div className="admin-notification-wrap" ref={notificationPanelRef}>
              <button
                className="admin-notification-button"
                onClick={() => {
                  setShowNotifications(!showNotifications)
                  if (!showNotifications) fetchNotifications()
                }}
                aria-expanded={showNotifications}
              >
                通知
                {unreadCount > 0 && (
                  <span>{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>
              {showNotifications && (
                <section
                  className="admin-notification-panel"
                  aria-label="管理员通知中心"
                >
                  <div className="notification-head">
                    <div>
                      <strong>通知中心</strong>
                      <span>
                        {unreadCount ? `${unreadCount} 条未读` : '已全部读完'}
                      </span>
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllNotificationsRead}>全部已读</button>
                    )}
                  </div>
                  <div className="notification-list">
                    {notifications.length ? (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          className={`notification-item ${item.is_read ? '' : 'is-unread'}`}
                          onClick={() => markNotificationRead(item)}
                        >
                          <span className="notification-meta">
                            <strong>{item.title}</strong>
                            <time>
                              {new Date(item.created_at).toLocaleString('zh-CN')}
                            </time>
                          </span>
                          <span>{item.content}</span>
                        </button>
                      ))
                    ) : (
                      <p className="empty-compact">暂无通知</p>
                    )}
                  </div>
                  {notificationError && (
                    <p className="notification-error" role="alert">
                      {notificationError}
                    </p>
                  )}
                </section>
              )}
            </div>
            <button className="admin-quiet-button" onClick={logout}>
              退出登录
            </button>
          </div>
        </div>
      </header>

      <section className="admin-content" ref={contentRef}>
        <div className="admin-heading-row">
          <div>
            <h1>访问与风控</h1>
          </div>
          <button
            className="admin-secondary-button"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                正在刷新
              </>
            ) : (
              '刷新'
            )}
          </button>
        </div>

        <div className="admin-tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'is-active' : ''}
              onClick={() => changeTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {message && (
          <div
            className={`admin-message is-${messageTone}`}
            role={messageTone === 'error' ? 'alert' : 'status'}
          >
            {message}
          </div>
        )}

        {tab === 'overview' && stats && (
          <>
            <div className="admin-metric-grid access-metrics">
              <div>
                <span>今日访问</span>
                <strong>{stats.today.total_visits}</strong>
                <small>请求总量</small>
              </div>
              <div>
                <span>独立 IP</span>
                <strong className="metric-info">
                  {stats.today.unique_visitors}
                </strong>
                <small>今日访客</small>
              </div>
              <div>
                <span>爬虫请求</span>
                <strong className="metric-warn">
                  {stats.today.bot_visits}
                </strong>
                <small>特征判断</small>
              </div>
              <div>
                <span>风控命中</span>
                <strong className="metric-danger">
                  {stats.today.suspicious_visits}
                </strong>
                <small>待排查</small>
              </div>
              <div>
                <span>限制 IP</span>
                <strong className="metric-success">
                  {stats.blacklistedIPs}
                </strong>
                <small>当前名单</small>
              </div>
            </div>
            <section className="admin-panel access-trend">
              <div className="panel-heading">
                <div>
                  <h2>近 7 天访问趋势</h2>
                  <span>按天汇总请求量</span>
                </div>
              </div>
              {stats.last7Days.length ? (
                <div className="bar-chart">
                  {stats.last7Days.map((day) => (
                    <div className="bar-item" key={day.date}>
                      <div className="bar-value">{day.total_visits}</div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            height: `${Math.max(
                              4,
                              (day.total_visits / max) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <span>{day.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="admin-empty">
                  <strong>暂无趋势数据</strong>
                  <span>有访问记录后会显示近 7 天请求量。</span>
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'logs' && (
          <LogTable
            title="最近访问日志"
            logs={logs}
            scrollPositionRef={logTableScrollTopRef}
          />
        )}

        {tab === 'suspicious' && (
          <>
            <div className="admin-callout warning">
              <strong>风控命中线索</strong>
              <span>
                记录可能命中了空 User-Agent、脚本特征或敏感路径规则。命中结果仅供排查，不代表已确认恶意行为。
              </span>
            </div>
            <LogTable
              title="可疑访问日志"
              logs={suspicious}
              scrollPositionRef={suspiciousTableScrollTopRef}
            />
          </>
        )}

        {tab === 'blacklist' && (
          <>
            <div className="admin-callout">
              <strong>访问限制名单</strong>
              <span>
                名单中的 IP 将被拒绝访问平台。解除前请确认对应来源和近期行为。
              </span>
            </div>
            <BlacklistTable
              items={blacklist}
              onRemove={unblacklist}
              scrollPositionRef={blacklistTableScrollTopRef}
            />
          </>
        )}
      </section>
    </main>
  )
}

function LogTable({
  title,
  logs,
  scrollPositionRef,
}: {
  title: string
  logs: AccessLog[]
  scrollPositionRef: { current: number }
}) {
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (tableScrollRef.current) {
        tableScrollRef.current.scrollTop = scrollPositionRef.current
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scrollPositionRef, logs.length])

  return (
    <section className="admin-panel table-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span>{logs.length} 条记录</span>
        </div>
      </div>
      {logs.length === 0 ? (
        <div className="admin-empty">
          <strong>暂无记录</strong>
          <span>当前筛选范围内没有访问数据。</span>
        </div>
      ) : (
        <div
          className="table-scroll"
          ref={tableScrollRef}
          onScroll={(event) => {
            scrollPositionRef.current = event.currentTarget.scrollTop
          }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>IP</th>
                <th>方法</th>
                <th>路径</th>
                <th>状态</th>
                <th>响应</th>
                <th>标记</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className={log.is_suspicious ? 'is-warning' : ''}
                >
                  <td>{log.created_at}</td>
                  <td className="mono">{log.ip}</td>
                  <td>{log.method}</td>
                  <td className="mono">{log.path}</td>
                  <td>{log.status_code}</td>
                  <td>{log.response_time}ms</td>
                  <td>
                    <span className="table-tags">
                      {log.is_bot ? (
                        <em className="tag tag-sun">爬虫特征</em>
                      ) : null}
                      {log.is_suspicious ? (
                        <em className="tag tag-coral">风控命中</em>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function BlacklistTable({
  items,
  onRemove,
  scrollPositionRef,
}: {
  items: BlacklistedIP[]
  onRemove: (ip: string) => void
  scrollPositionRef: { current: number }
}) {
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (tableScrollRef.current) {
        tableScrollRef.current.scrollTop = scrollPositionRef.current
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scrollPositionRef, items.length])

  return (
    <section className="admin-panel table-panel">
      <div className="panel-heading">
        <div>
          <h2>访问限制名单</h2>
          <span>{items.length} 个 IP</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="admin-empty">
          <strong>名单为空</strong>
          <span>目前没有被限制访问的 IP。</span>
        </div>
      ) : (
        <div
          className="table-scroll"
          ref={tableScrollRef}
          onScroll={(event) => {
            scrollPositionRef.current = event.currentTarget.scrollTop
          }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>IP</th>
                <th>原因</th>
                <th>触发次数</th>
                <th>加入时间</th>
                <th>过期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.ip}</td>
                  <td>{item.reason}</td>
                  <td>{item.attempts}</td>
                  <td>{item.blacklisted_at}</td>
                  <td>{item.expires_at || '永久'}</td>
                  <td>
                    <button
                      className="table-action"
                      onClick={() => onRemove(item.ip)}
                    >
                      解除限制
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
