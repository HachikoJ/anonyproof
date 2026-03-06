'use client'

import { useState, useEffect, useRef } from 'react'
import { useCrypto } from '../hooks/useCrypto'

export default function AdminPage() {
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [stats, setStats] = useState({ total: 0, encrypted: 0, leaks: 0 })
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [categoryStats, setCategoryStats] = useState({ suggestion: 0, complaint: 0, report: 0 })

  // 评论相关状态
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null)
  const [feedbackComments, setFeedbackComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')

  // 搜索相关状态
  const [searchKeyword, setSearchKeyword] = useState<string>('')

  // 通知相关状态
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotificationPanel, setShowNotificationPanel] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])

  const statusConfig = {
    pending: { label: '待处理', icon: '⏰', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
    in_progress: { label: '持续跟进', icon: '🔄', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
    resolved: { label: '已解决', icon: '✅', color: '#34c759', bg: 'rgba(52, 199, 89, 0.1)' },
    no_solution: { label: '暂不解决', icon: '⚠️', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.1)' },
  }

  const ADMIN_PASSWORD = 'anonyproof_admin_2026'

  // 当选择反馈时自动展开评论
  useEffect(() => {
    if (selectedFeedback && !selectedFeedback.logs) {
      setSelectedFeedbackId(selectedFeedback.id)
      fetchComments(selectedFeedback.id)
    }
  }, [selectedFeedback])

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      fetchData()
    } else {
      alert('密码错误')
    }
  }

  const fetchData = async () => {
    try {
      const feedbacksRes = await fetch('/anonyproof/api/admin/feedbacks')
      const feedbacksData = await feedbacksRes.json()
      if (feedbacksData.success) {
        setFeedbacks(feedbacksData.feedbacks)
        // 计算分类统计
        const stats = {
          suggestion: feedbacksData.feedbacks.filter((f: any) => f.category === 'suggestion').length,
          complaint: feedbacksData.feedbacks.filter((f: any) => f.category === 'complaint').length,
          report: feedbacksData.feedbacks.filter((f: any) => f.category === 'report').length
        }
        setCategoryStats(stats)
      }

      const logsRes = await fetch('/anonyproof/api/admin/logs')
      const logsData = await logsRes.json()
      if (logsData.success) {
        setLogs(logsData.logs)
      }

      const statsRes = await fetch('/anonyproof/api/stats')
      const statsData = await statsRes.json()
      setStats(statsData)
    } catch (error) {
      console.error('获取数据失败:', error)
      alert('获取数据失败')
    }
  }

  // 计算统计数据
  const statsData = feedbacks.reduce((acc, feedback) => {
    acc.total++
    acc[feedback.category] = (acc[feedback.category] || 0) + 1
    acc[feedback.status] = (acc[feedback.status] || 0) + 1
    return acc
  }, { total: 0, suggestion: 0, complaint: 0, report: 0, pending: 0, in_progress: 0, resolved: 0, no_solution: 0 })

  // 计算筛选后的统计数据（用于动态显示数量）
  const getFilteredStats = () => {
    // 如果按分类筛选，计算该分类下各状态的数量
    if (selectedCategory !== 'all') {
      const categoryFeedbacks = feedbacks.filter(f => f.category === selectedCategory)
      return categoryFeedbacks.reduce((acc, feedback) => {
        acc[feedback.status] = (acc[feedback.status] || 0) + 1
        return acc
      }, { pending: 0, in_progress: 0, resolved: 0, no_solution: 0 })
    }
    // 如果按状态筛选，计算该状态下各分类的数量
    if (selectedStatus !== 'all') {
      const statusFeedbacks = feedbacks.filter(f => f.status === selectedStatus)
      return statusFeedbacks.reduce((acc, feedback) => {
        acc[feedback.category] = (acc[feedback.category] || 0) + 1
        return acc
      }, { suggestion: 0, complaint: 0, report: 0 })
    }
    // 未筛选时返回全部统计
    return null
  }

  const filteredStats = getFilteredStats()

  const handleStatusUpdate = async (id: string, newStatus: string, solution?: string) => {
    try {
      const res = await fetch(`/anonyproof/api/admin/feedback/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, solution }),
      })
      const data = await res.json()
      if (data.success) {
        alert('状态已更新')
        fetchData()
        setSelectedFeedback(null)
        setSelectedFeedbackId(null)
        setFeedbackComments([])
        setNewComment('')
      } else {
        alert(data.error || '更新失败')
      }
    } catch (error) {
      console.error('更新状态失败:', error)
      alert('更新失败')
    }
  }

  const handleExportData = () => {
    const filteredFeedbacks = selectedCategory === 'all'
      ? feedbacks
      : feedbacks.filter(f => f.category === selectedCategory)

    // 准备 CSV 数据
    const headers = ['ID', '分类', '设备ID', '提交时间', '状态', '内容']
    const rows = filteredFeedbacks.map(f => [
      f.id,
      f.category === 'suggestion' ? '建议' : f.category === 'complaint' ? '投诉' : '举报',
      f.device_id,
      new Date(f.created_at).toLocaleString('zh-CN'),
      f.status === 'pending' ? '待处理' : f.status === 'in_progress' ? '持续跟进' : f.status === 'resolved' ? '已解决' : '暂不解决',
      f.original_content || ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // 创建下载
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `anonyproof_export_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 获取评论
  const fetchComments = async (feedbackId: string) => {
    try {
      const res = await fetch('/anonyproof/api/feedback/' + feedbackId + '/comments')
      const data = await res.json()
      if (data.success) {
        setFeedbackComments(data.comments)
      }
    } catch (error) {
      console.error('获取评论失败:', error)
    }
  }

  // 获取通知列表
  const fetchNotifications = async () => {
    try {
      const res = await fetch('/anonyproof/api/notifications?recipientType=admin&recipientId=admin&limit=20')
      const data = await res.json()
      if (data.success) {
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('获取通知列表失败:', error)
    }
  }

  // 标记通知为已读
  const markAsRead = async (notificationId: string) => {
    try {
      await fetch(`/anonyproof/api/notifications/${notificationId}/read`, { method: 'PUT' })
      // 刷新未读数量和通知列表
      const countRes = await fetch('/anonyproof/api/notifications/unread-count?recipientType=admin&recipientId=admin')
      const countData = await countRes.json()
      if (countData.success) {
        setUnreadCount(countData.count)
      }
      fetchNotifications()
    } catch (error) {
      console.error('标记已读失败:', error)
    }
  }

  // 标记所有为已读
  const markAllAsRead = async () => {
    try {
      await fetch('/anonyproof/api/notifications/read-all?recipientType=admin&recipientId=admin', { method: 'PUT' })
      setUnreadCount(0)
      fetchNotifications()
    } catch (error) {
      console.error('标记全部已读失败:', error)
    }
  }

  // 轮询未读通知数量
  useEffect(() => {
    // 只有登录后才轮询
    if (!isAuthenticated) return

    const fetchUnreadCount = async () => {
      try {
        const res = await fetch('/anonyproof/api/notifications/unread-count?recipientType=admin&recipientId=admin')
        const data = await res.json()
        if (data.success) {
          setUnreadCount(data.count)
        }
      } catch (error) {
        console.error('获取未读数量失败:', error)
      }
    }

    // 立即获取一次
    fetchUnreadCount()

    // 每30秒检查一次
    const interval = setInterval(fetchUnreadCount, 30000)

    return () => clearInterval(interval)
  }, [isAuthenticated])

  // 点击外部关闭通知面板
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target as Node)) {
        setShowNotificationPanel(false)
      }
    }

    if (showNotificationPanel) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showNotificationPanel])

  // 轮询检查新评论（当展开评论时）
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (selectedFeedbackId && selectedFeedback && !selectedFeedback.logs) {
      // 每30秒检查一次新评论和新状态
      interval = setInterval(async () => {
        try {
          // 检查新评论
          const res = await fetch(`/anonyproof/api/feedback/${selectedFeedbackId}/comments`)
          const data = await res.json()
          if (data.success) {
            const newComments = data.comments
            // 如果评论数量增加，自动更新
            if (newComments.length > feedbackComments.length) {
              console.log('检测到新评论，自动刷新')
              setFeedbackComments(newComments)
            }
          }

          // 检查当前反馈的状态是否改变（用户可能提交了新反馈）
          fetchData()
        } catch (error) {
          console.error('检查更新失败:', error)
        }
      }, 30000) // 30秒检查一次
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedFeedbackId, feedbackComments.length, selectedFeedback])

  // 添加评论
  const handleAddComment = async () => {
    if (!selectedFeedbackId) return
    if (!newComment.trim() || newComment.trim().length < 2) {
      alert('评论内容至少需要 2 个字符')
      return
    }
    if (newComment.trim().length > 1000) {
      alert('评论内容不能超过 1000 个字符')
      return
    }
    try {
      const res = await fetch('/anonyproof/api/feedback/' + selectedFeedbackId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          commenterType: 'admin'
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewComment('')
        fetchComments(selectedFeedbackId)
      } else {
        alert(data.error || '添加失败')
      }
    } catch (error) {
      console.error('添加评论失败:', error)
      alert('添加失败')
    }
  }

  const filteredFeedbacks = feedbacks.filter((f) => {
    const categoryMatch = selectedCategory === 'all' || f.category === selectedCategory
    const statusMatch = selectedStatus === 'all' || f.status === selectedStatus
    // 搜索匹配：反馈内容或设备ID包含关键词
    const searchMatch = !searchKeyword || 
      searchKeyword.trim() === '' ||
      (f.original_content && f.original_content.toLowerCase().includes(searchKeyword.toLowerCase())) ||
      (f.device_id && f.device_id.toLowerCase().includes(searchKeyword.toLowerCase()))
    return categoryMatch && statusMatch && searchMatch
  })

  if (!isAuthenticated) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          padding: '40px',
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
          maxWidth: '400px',
          width: '100%',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1d1d1f', marginBottom: '24px', textAlign: 'center' }}>
            🔐 管理员登录
          </h1>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入管理员密码"
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                border: '2px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '12px',
                marginBottom: '20px',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              登录
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
      padding: '24px',
      position: 'relative'
    }}>
      {/* 通知铃铛 - 右上角，在按钮旁边 */}
      <div style={{ 
        position: 'absolute',
        top: '24px',
        right: '24px',
        zIndex: 100
      }}>
        <button
          onClick={() => {
            if (showNotificationPanel) {
              setShowNotificationPanel(false)
            } else {
              setShowNotificationPanel(true)
              fetchNotifications()
            }
          }}
          style={{
            fontSize: '24px',
            background: 'rgba(255, 255, 255, 0.5)',
            backdropFilter: 'blur(10px)',
            border: 'none',
            borderRadius: '50%',
            width: '48px',
            height: '48px',
            cursor: 'pointer',
            position: 'relative',
            padding: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🔔
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              background: '#ff3b30',
              color: 'white',
              borderRadius: '50%',
              width: '20px',
              height: '20px',
              fontSize: '11px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid white',
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* 通知面板 */}
        {showNotificationPanel && (
          <div 
            ref={notificationPanelRef}
            style={{
              position: 'absolute',
              top: '55px',
              right: '0',
              width: '380px',
              maxHeight: '500px',
              background: 'white',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
              zIndex: 1000,
              overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '16px',
              borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>🔔 通知中心</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(102, 126, 234, 0.1)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    color: '#667eea',
                  }}
                >
                  全部已读
                </button>
              )}
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#86868b' }}>
                  暂无通知
                </div>
              ) : (
                <>
                  {/* 未读通知 */}
                  {notifications.filter(n => !n.is_read).length > 0 && (
                    <>
                      <div
                        onClick={() => {
                          // 滚动到未读通知区域
                          const unreadSection = document.getElementById('first-unread-notification')
                          if (unreadSection) {
                            unreadSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }
                        }}
                        style={{
                          padding: '10px 16px',
                          fontSize: '13px',
                          fontWeight: '700',
                          color: '#667eea',
                          background: 'rgba(102, 126, 234, 0.2)',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          borderBottom: '1px solid rgba(102, 126, 234, 0.3)',
                          position: 'sticky',
                          top: 0,
                          zIndex: 10,
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        未读通知 ({notifications.filter(n => !n.is_read).length})
                      </div>
                      {notifications.filter(n => !n.is_read).map((notif, index) => (
                        <div
                          key={notif.id}
                          id={index === 0 ? 'first-unread-notification' : undefined}
                          onClick={async () => {
                            markAsRead(notif.id)
                            
                            // 先尝试在当前列表中查找
                            let feedback = feedbacks.find(f => f.id === notif.feedback_id)
                            
                            // 如果找不到，直接从 API 获取所有反馈
                            if (!feedback) {
                              try {
                                const res = await fetch('/anonyproof/api/admin/feedbacks')
                                const data = await res.json()
                                
                                if (data.success && data.feedbacks) {
                                  // 更新状态
                                  setFeedbacks(data.feedbacks)
                                  
                                  // 从返回的数据中查找
                                  feedback = data.feedbacks.find((f: any) => f.id === notif.feedback_id)
                                }
                              } catch (error) {
                                console.error('获取反馈列表失败:', error)
                              }
                            }
                            
                            if (feedback) {
                              setSelectedFeedback(feedback)
                              setSelectedFeedbackId(notif.feedback_id)
                              fetchComments(notif.feedback_id)
                              setShowNotificationPanel(false)
                            } else {
                              alert('无法找到该反馈，请稍后重试')
                            }
                          }}
                          style={{
                            padding: '16px',
                            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
                            cursor: 'pointer',
                            background: 'rgba(102, 126, 234, 0.08)',
                            transition: 'all 0.2s ease',
                            borderRadius: '8px',
                            marginBottom: '8px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(102, 126, 234, 0.12)'
                            e.currentTarget.style.transform = 'translateX(4px)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(102, 126, 234, 0.08)'
                            e.currentTarget.style.transform = 'translateX(0)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ 
                                fontSize: '14px', 
                                fontWeight: '700', 
                                color: notif.type === 'comment' ? '#667eea' : notif.type === 'status_update' ? '#34c759' : '#ff9500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                {notif.type === 'new_feedback' && '📝'}
                                {notif.type === 'comment' && '💬'}
                                {notif.type === 'status_update' && '✅'}
                                {notif.title}
                              </span>
                              <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#667eea',
                                display: 'inline-block'
                              }}></span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#86868b', whiteSpace: 'nowrap' }}>
                                {new Date(notif.created_at).toLocaleString('zh-CN')}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  markAsRead(notif.id)
                                }}
                                style={{
                                  padding: '2px 8px',
                                  background: 'rgba(102, 126, 234, 0.15)',
                                  border: '1px solid rgba(102, 126, 234, 0.3)',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  color: '#667eea',
                                }}
                              >
                                标为已读
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '13px', color: '#1d1d1f', lineHeight: '1.6', marginBottom: '10px' }}>
                            {notif.content}
                          </div>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end'
                          }}>
                            <span style={{
                              padding: '4px 12px',
                              background: 'rgba(102, 126, 234, 0.1)',
                              border: '1px solid rgba(102, 126, 234, 0.3)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#667eea',
                            }}>
                              查看详情 →
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  
                  {/* 已读通知 */}
                  {notifications.filter(n => n.is_read).length > 0 && (
                    <>
                      <div
                        onClick={() => {
                          // 滚动到已读通知区域
                          const readSection = document.getElementById('first-read-notification')
                          if (readSection) {
                            readSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }
                        }}
                        style={{
                          padding: '10px 16px',
                          fontSize: '13px',
                          fontWeight: '700',
                          color: '#86868b',
                          background: 'rgba(134, 134, 134, 0.2)',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          borderBottom: '1px solid rgba(134, 134, 134, 0.3)',
                          position: 'sticky',
                          top: notifications.filter(n => !n.is_read).length > 0 ? '40px' : '0',
                          zIndex: 10,
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        已读通知 ({notifications.filter(n => n.is_read).length})
                      </div>
                      {notifications.filter(n => n.is_read).map((notif, index) => (
                        <div
                          key={notif.id}
                          id={index === 0 ? 'first-read-notification' : undefined}
                          onClick={async () => {
                            // 先尝试在当前列表中查找
                            let feedback = feedbacks.find(f => f.id === notif.feedback_id)
                            
                            // 如果找不到，直接从 API 获取所有反馈
                            if (!feedback) {
                              try {
                                const res = await fetch('/anonyproof/api/admin/feedbacks')
                                const data = await res.json()
                                
                                if (data.success && data.feedbacks) {
                                  // 更新状态
                                  setFeedbacks(data.feedbacks)
                                  
                                  // 从返回的数据中查找
                                  feedback = data.feedbacks.find((f: any) => f.id === notif.feedback_id)
                                }
                              } catch (error) {
                                console.error('获取反馈列表失败:', error)
                              }
                            }
                            
                            if (feedback) {
                              setSelectedFeedback(feedback)
                              setSelectedFeedbackId(notif.feedback_id)
                              fetchComments(notif.feedback_id)
                              setShowNotificationPanel(false)
                            } else {
                              alert('无法找到该反馈，请稍后重试')
                            }
                          }}
                          style={{
                            padding: '16px',
                            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
                            cursor: 'pointer',
                            background: 'transparent',
                            transition: 'all 0.2s ease',
                            borderRadius: '8px',
                            marginBottom: '8px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(102, 126, 234, 0.06)'
                            e.currentTarget.style.transform = 'translateX(4px)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.transform = 'translateX(0)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ 
                                fontSize: '14px', 
                                fontWeight: '600', 
                                color: '#86868b',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                {notif.type === 'new_feedback' && '📝'}
                                {notif.type === 'comment' && '💬'}
                                {notif.type === 'status_update' && '✅'}
                                {notif.title}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#86868b', whiteSpace: 'nowrap' }}>
                                {new Date(notif.created_at).toLocaleString('zh-CN')}
                              </span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  // 标记为未读
                                  await fetch(`/anonyproof/api/notifications/${notif.id}/unread`, { method: 'PUT' })
                                  await fetchNotifications()
                                  // 立即更新未读数量
                                  const countRes = await fetch('/anonyproof/api/notifications/unread-count?recipientType=admin&recipientId=admin')
                                  const countData = await countRes.json()
                                  if (countData.success) {
                                    setUnreadCount(countData.count)
                                  }
                                }}
                                style={{
                                  padding: '2px 8px',
                                  background: 'rgba(134, 134, 134, 0.1)',
                                  border: '1px solid rgba(134, 134, 134, 0.2)',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  color: '#86868b',
                                }}
                              >
                                标为未读
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '13px', color: '#86868b', lineHeight: '1.6', marginBottom: '10px' }}>
                            {notif.content}
                          </div>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end'
                          }}>
                            <span style={{
                              padding: '4px 12px',
                              background: 'rgba(134, 134, 134, 0.1)',
                              border: '1px solid rgba(134, 134, 134, 0.2)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#86868b',
                            }}>
                              查看详情 →
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
          paddingBottom: '20px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#1d1d1f', margin: 0 }}>
              🔐 匿证管理后台
            </h1>
            <p style={{ fontSize: '14px', color: '#86868b', margin: '4px 0 0 0' }}>
              总反馈: {stats.total} · 加密率: 100% · 数据泄露: {stats.leaks}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleExportData}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              📥 导出数据
            </button>
            <button
              onClick={() => {
                setIsAuthenticated(false)
                setPassword('')
                setSelectedFeedback(null)
                setFeedbacks([])
                setLogs([])
              }}
              style={{
                padding: '10px 20px',
                background: 'rgba(255, 255, 255, 0.5)',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              退出登录
            </button>
          </div>
        </div>

        {/* 分类统计卡片 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '24px',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>全部反馈</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{stats.total}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>💡 建议</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.suggestion}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>⚠️ 投诉</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.complaint}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>🔔 举报</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.report}</div>
          </div>
        </div>

        {/* 分类筛选按钮 */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#86868b', marginRight: '12px' }}>分类筛选:</span>
          <button
            onClick={() => {
              setSelectedCategory('all')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'all' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'all' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'all' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            全部 ({stats.total})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('suggestion')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'suggestion' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'suggestion' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'suggestion' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            💡 建议 ({categoryStats.suggestion})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('complaint')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'complaint' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'complaint' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'complaint' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            ⚠️ 投诉 ({categoryStats.complaint})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('report')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'report' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'report' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'report' ? '#667eea' : '#86868b',
              cursor: 'pointer',
            }}
          >
            🔔 举报 ({categoryStats.report})
          </button>
        </div>

        {/* 搜索框 */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#86868b', marginBottom: '8px' }}>
            🔍 搜索反馈
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                }
              }}
              placeholder="输入关键词搜索反馈内容或设备ID..."
              style={{
                flex: 1,
                padding: '10px 12px',
                fontSize: '14px',
                border: '2px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                boxSizing: 'border-box',
              }}
            />
            {searchKeyword && (
              <button
                onClick={() => {
                  setSearchKeyword('')
                }}
                style={{
                  padding: '10px 16px',
                  background: 'rgba(102, 126, 234, 0.1)',
                  border: '1px solid #667eea',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  color: '#667eea',
                }}
              >
                清除搜索
              </button>
            )}
          </div>
        </div>

        {/* 状态筛选按钮 */}
        <div style={{ marginBottom: '24px' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#86868b', marginRight: '12px' }}>状态筛选:</span>
          <button
            onClick={() => {
              setSelectedStatus('all')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedStatus === 'all' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedStatus === 'all' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedStatus === 'all' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            全部
          </button>
          {Object.entries(statusConfig).map(([key, config]) => {
            // 计算该状态的数量（如果已按分类筛选，则显示该分类下该状态的数量）
            const count = selectedCategory !== 'all'
              ? feedbacks.filter(f => f.category === selectedCategory && f.status === key).length
              : statsData[key as keyof typeof statsData] || 0
            return (
              <button
                key={key}
                onClick={() => {
                  setSelectedStatus(key as any)
                  setSelectedFeedback(null)
                }}
                style={{
                  padding: '8px 16px',
                  background: selectedStatus === key ? (key === 'pending' || key === 'in_progress' ? 'rgba(255, 149, 0, 0.1)' : key === 'resolved' ? 'rgba(52, 199, 89, 0.1)' : 'rgba(142, 142, 147, 0.1)') : 'transparent',
                  border: selectedStatus === key ? `2px solid ${config.color}` : '1px solid rgba(0, 0, 0, 0.1)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: selectedStatus === key ? config.color : '#86868b',
                  cursor: 'pointer',
                  marginRight: '8px',
                }}
              >
                {config.icon} {config.label} ({count})
              </button>
            )
          })}
        </div>

        {/* 视图切换按钮 */}
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={async () => {
              setSelectedFeedback(null)
              // 返回列表时刷新数据
              await fetchData()
              await fetchNotifications()
            }}
            style={{
              padding: '10px 20px',
              background: !selectedFeedback ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: !selectedFeedback ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: !selectedFeedback ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '12px',
            }}
          >
            反馈列表
          </button>
          <button
            onClick={() => setSelectedFeedback({logs: true})}
            style={{
              padding: '10px 20px',
              background: selectedFeedback?.logs ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedFeedback?.logs ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedFeedback?.logs ? '#667eea' : '#86868b',
              cursor: 'pointer',
            }}
          >
            操作日志
          </button>
        </div>

        {!selectedFeedback && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '16px'
          }}>
            {filteredFeedbacks.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '60px 20px',
                color: '#86868b',
                fontSize: '16px',
              }}>
                暂无{selectedCategory !== 'all' ? (selectedCategory === 'suggestion' ? '建议' : selectedCategory === 'complaint' ? '投诉' : '举报') : ''}反馈
              </div>
            ) : (
              filteredFeedbacks.map((feedback) => (
                <div
                  key={feedback.id}
                  onClick={() => setSelectedFeedback(feedback)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(10px)',
                    padding: '20px',
                    borderRadius: '16px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.4)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontSize: '12px', color: '#86868b' }}>
                      {new Date(feedback.created_at).toLocaleString('zh-CN')}
                    </span>
                    {feedback.status && statusConfig[feedback.status as keyof typeof statusConfig] && (
                      <span style={{
                        fontSize: '12px',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        background: statusConfig[feedback.status as keyof typeof statusConfig].bg,
                        color: statusConfig[feedback.status as keyof typeof statusConfig].color,
                        border: `1px solid ${statusConfig[feedback.status as keyof typeof statusConfig].color}`,
                      }}>
                        {statusConfig[feedback.status as keyof typeof statusConfig].icon} {statusConfig[feedback.status as keyof typeof statusConfig].label}
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '8px' }}>
                    {feedback.category === 'suggestion' ? '💡 建议' : feedback.category === 'complaint' ? '⚠️ 投诉' : '🔔 举报'}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#86868b', margin: 0 }}>
                    设备ID: {feedback.device_id?.slice(0, 16)}...
                  </p>
                  <p style={{ fontSize: '13px', color: '#86868b', margin: '0' }}>
                    ID: {feedback.id}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {selectedFeedback && !selectedFeedback.logs && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.4)'
          }}>
            <button
              onClick={() => {
                setSelectedFeedback(null)
                setSelectedFeedbackId(null)
                setFeedbackComments([])
                setNewComment('')
              }}
              style={{
                marginBottom: '16px',
                padding: '8px 16px',
                background: 'rgba(102, 126, 234, 0.1)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#667eea',
                fontSize: '14px',
                fontWeight: '600',
              }}
            >
              ← 返回列表
            </button>

            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                反馈详情
              </h2>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <p style={{ fontSize: '14px', color: '#86868b', margin: 0 }}>
                  提交时间: {new Date(selectedFeedback.created_at).toLocaleString('zh-CN')}
                </p>
                <p style={{ fontSize: '14px', color: '#86868b', margin: 0 }}>
                  设备ID: {selectedFeedback.device_id?.slice(0, 16)}...
                </p>
                <p style={{ fontSize: '14px', color: '#86868b', margin: 0 }}>
                  反馈ID: {selectedFeedback.id?.slice(0, 8)}...
                </p>
              </div>
              {selectedFeedback.status && statusConfig[selectedFeedback.status as keyof typeof statusConfig] && (
                <div style={{
                  display: 'inline-block',
                  padding: '6px 12px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  background: statusConfig[selectedFeedback.status as keyof typeof statusConfig].bg,
                  color: statusConfig[selectedFeedback.status as keyof typeof statusConfig].color,
                  border: `1px solid ${statusConfig[selectedFeedback.status as keyof typeof statusConfig].color}`,
                }}>
                  {statusConfig[selectedFeedback.status as keyof typeof statusConfig].icon} {statusConfig[selectedFeedback.status as keyof typeof statusConfig].label}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                📝 反馈内容
              </h3>
              <div style={{
                background: 'rgba(255, 255, 255, 0.8)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
              }}>
                <div style={{ fontSize: '14px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {selectedFeedback.original_content}
                </div>
              </div>
            </div>

            {/* 已有解决方案显示 */}
            {selectedFeedback.status && selectedFeedback.status !== 'pending' && selectedFeedback.solution && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                  {selectedFeedback.status === 'resolved' ? '✅ 已有解决方案' : selectedFeedback.status === 'in_progress' ? '🔄 已有处理进展' : '⚠️ 已有处理说明'}
                </h3>
                <div style={{
                  background: selectedFeedback.status === 'resolved' ? 'rgba(52, 199, 89, 0.1)' :
                             selectedFeedback.status === 'in_progress' ? 'rgba(255, 149, 0, 0.1)' :
                             'rgba(142, 142, 147, 0.1)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: `1px solid ${selectedFeedback.status === 'resolved' ? '#34c759' : selectedFeedback.status === 'in_progress' ? '#ff9500' : '#8e8e93'}`,
                }}>
                  <div style={{ fontSize: '14px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    {selectedFeedback.solution}
                  </div>
                  {selectedFeedback.solution_updated_at && (
                    <div style={{ fontSize: '12px', color: '#86868b', marginTop: '8px' }}>
                      更新时间: {new Date(selectedFeedback.solution_updated_at).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 更新状态和解决方案 */}
            {selectedFeedback.status === 'pending' || selectedFeedback.status === 'in_progress' ? (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                  更新状态
                </h3>
                <div style={{
                  background: 'rgba(255, 255, 255, 0.5)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                }}>
                  <textarea
                    id="solution-input"
                    placeholder="解决方案 / 处理意见（标记为已解决或暂不解决时必填，≥10字）"
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '10px',
                      fontSize: '13px',
                      border: '2px solid rgba(0, 0, 0, 0.1)',
                      borderRadius: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      marginBottom: '12px',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => {
                        const input = document.getElementById('solution-input') as HTMLTextAreaElement
                        handleStatusUpdate(selectedFeedback.id, 'in_progress', input?.value)
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'rgba(255, 149, 0, 0.1)',
                        border: '1px solid #ff9500',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: '#ff9500',
                      }}
                    >
                      🔄 持续跟进
                    </button>
                    <button
                      onClick={() => {
                        const input = document.getElementById('solution-input') as HTMLTextAreaElement
                        if (!input?.value || input.value.trim().length < 10) {
                          alert('标记为已解决时，解决方案必须至少 10 个字符')
                          return
                        }
                        handleStatusUpdate(selectedFeedback.id, 'resolved', input?.value)
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'rgba(52, 199, 89, 0.1)',
                        border: '1px solid #34c759',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: '#34c759',
                      }}
                    >
                      ✅ 已解决
                    </button>
                    <button
                      onClick={() => {
                        const input = document.getElementById('solution-input') as HTMLTextAreaElement
                        if (!input?.value || input.value.trim().length < 10) {
                          alert('标记为暂不解决时，处理说明必须至少 10 个字符')
                          return
                        }
                        handleStatusUpdate(selectedFeedback.id, 'no_solution', input?.value)
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'rgba(142, 142, 147, 0.1)',
                        border: '1px solid #8e8e93',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: '#8e8e93',
                      }}
                    >
                      ⚠️ 暂不解决
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* 评论功能 */}
            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', margin: 0 }}>
                  💬 讨论与沟通
                </h3>
                <button
                  onClick={() => {
                    if (selectedFeedbackId === selectedFeedback.id) {
                      setSelectedFeedbackId(null)
                      setFeedbackComments([])
                    } else {
                      setSelectedFeedbackId(selectedFeedback.id)
                      fetchComments(selectedFeedback.id)
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(102, 126, 234, 0.1)',
                    border: '1px solid #667eea',
                    borderRadius: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: '#667eea',
                  }}
                >
                  {selectedFeedbackId === selectedFeedback.id ? '收起评论' : '展开评论'}
                </button>
              </div>

              {selectedFeedbackId === selectedFeedback.id && (
                <>
                  <div style={{ background: 'rgba(255, 255, 255, 0.3)', padding: '16px', borderRadius: '12px', marginBottom: '12px', border: '1px solid rgba(0, 0, 0, 0.05)', maxHeight: '400px', overflowY: 'auto' }}>
                    {feedbackComments.length === 0 ? (
                      <p style={{ color: '#86868b', textAlign: 'center', padding: '20px', fontSize: '13px' }}>暂无评论</p>
                    ) : (
                      feedbackComments.map((comment) => (
                        <div key={comment.id} style={{
                          background: comment.commenter_type === 'admin' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(255, 255, 255, 0.4)',
                          padding: '10px',
                          borderRadius: '8px',
                          marginBottom: '8px',
                          border: comment.commenter_type === 'admin' ? '1px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)'
                        }}>
                          <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '4px' }}>
                            {comment.commenter_type === 'admin' ? '👨‍💼 管理员' : '👤 用户'} · {new Date(comment.created_at).toLocaleString('zh-CN')}
                          </div>
                          <div style={{ fontSize: '13px', color: '#1d1d1f', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                            {comment.content}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="💬 回复用户，说明处理情况或提出疑问..."
                      style={{
                        width: '100%',
                        minHeight: '60px',
                        padding: '10px',
                        fontSize: '13px',
                        border: '2px solid rgba(0, 0, 0, 0.1)',
                        borderRadius: '8px',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#86868b' }}>{newComment.length}/1000 字符</span>
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim()}
                        style={{
                          padding: '6px 14px',
                          background: !newComment.trim() ? 'rgba(134, 134, 134, 0.3)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: !newComment.trim() ? 'not-allowed' : 'pointer',
                          opacity: !newComment.trim() ? 0.6 : 1,
                        }}
                      >
                        发送评论
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {selectedFeedback?.logs && (
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.4)'
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1d', marginBottom: '20px' }}>
              📋 操作日志
            </h2>
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {logs.map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                    fontSize: '13px',
                    display: 'grid',
                    gridTemplateColumns: '150px 1fr 1fr',
                    gap: '12px',
                  }}
                >
                  <div style={{ color: '#86868b' }}>
                    {new Date(log.created_at).toLocaleString('zh-CN')}
                  </div>
                  <div style={{ color: '#667eea', fontWeight: '600' }}>
                    {log.action}
                  </div>
                  <div style={{ color: '#86868b' }}>
                    {log.target_id ? `反馈ID: ${log.target_id.slice(0, 8)}...` : '-'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
