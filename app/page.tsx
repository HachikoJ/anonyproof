'use client'

import { useState, useEffect, useRef } from 'react'
import { useCrypto } from './hooks/useCrypto'

export default function HomePage() {
  const notificationPanelRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [category, setCategory] = useState('')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; id?: string } | null>(null)
  const [stats, setStats] = useState<{ total: number; encrypted: number; leaks: number } | null>(null)
  const [myFeedbacks, setMyFeedbacks] = useState<any[]>([])
  const [isMobile, setIsMobile] = useState(false)

  // 筛选相关状态
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchKeyword, setSearchKeyword] = useState<string>('')  // 搜索关键词

  // 单条反馈详情相关状态
  const [singleFeedback, setSingleFeedback] = useState<any>(null)
  const [singleFeedbackComments, setSingleFeedbackComments] = useState<any[]>([])
  const [singleFeedbackNewComment, setSingleFeedbackNewComment] = useState('')

  // 评论相关状态
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null)
  const [feedbackComments, setFeedbackComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')

  // 通知相关状态
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotificationPanel, setShowNotificationPanel] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])

  const { deviceId, encrypt } = useCrypto()

  // 恢复视口缩放的辅助函数（移动端输入完成后）
  const resetViewportZoom = () => {
    // 延迟执行，确保输入框完全失焦
    setTimeout(() => {
      if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        // 方法1: 滚动到顶部，触发浏览器重置缩放
        window.scrollTo(0, 0)
        
        // 方法2: 强制重置页面缩放
        document.body.style.transform = 'scale(1)'
        document.body.style.transformOrigin = 'top left'
        document.body.style.width = '100%'
        
        // 方法3: 隐藏并显示地址栏（iOS Safari）
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
          window.scrollTo(0, 0)
          setTimeout(() => {
            window.scrollTo(0, 1)
          }, 100)
        }
      }
    }, 300)
  }

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const categories = [
    { id: 'suggestion', name: '建议', description: '产品改进建议', icon: '💡' },
    { id: 'complaint', name: '投诉', description: '问题反馈', icon: '⚠️' },
    { id: 'report', name: '举报', description: '违规举报', icon: '🔔' },
  ]

  const statusConfig = {
    pending: { label: '待处理', icon: '⏰', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
    in_progress: { label: '持续跟进', icon: '🔄', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
    resolved: { label: '已解决', icon: '✅', color: '#34c759', bg: 'rgba(52, 199, 89, 0.1)' },
    no_solution: { label: '暂不解决', icon: '⚠️', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.1)' },
  }

  // 计算统计数据
  const statsData = myFeedbacks.reduce((acc, feedback) => {
    acc.total++
    acc[feedback.category] = (acc[feedback.category] || 0) + 1
    acc[feedback.status] = (acc[feedback.status] || 0) + 1
    return acc
  }, { total: 0, suggestion: 0, complaint: 0, report: 0, pending: 0, in_progress: 0, resolved: 0, no_solution: 0 })

  // 计算筛选后的统计数据（用于动态显示数量）
  const getFilteredStats = () => {
    // 如果按分类筛选，计算该分类下各状态的数量
    if (filterCategory !== 'all') {
      const categoryFeedbacks = myFeedbacks.filter(f => f.category === filterCategory)
      return categoryFeedbacks.reduce((acc, feedback) => {
        acc[feedback.status] = (acc[feedback.status] || 0) + 1
        return acc
      }, { pending: 0, in_progress: 0, resolved: 0, no_solution: 0 })
    }
    // 如果按状态筛选，计算该状态下各分类的数量
    if (filterStatus !== 'all') {
      const statusFeedbacks = myFeedbacks.filter(f => f.status === filterStatus)
      return statusFeedbacks.reduce((acc, feedback) => {
        acc[feedback.category] = (acc[feedback.category] || 0) + 1
        return acc
      }, { suggestion: 0, complaint: 0, report: 0 })
    }
    // 未筛选时返回全部统计
    return null
  }

  const filteredStats = getFilteredStats()

  // 筛选后的反馈列表
  const filteredFeedbacks = myFeedbacks.filter((feedback) => {
    const categoryMatch = filterCategory === 'all' || feedback.category === filterCategory
    const statusMatch = filterStatus === 'all' || feedback.status === filterStatus
    // 搜索匹配：标题或内容包含关键词
    const searchMatch = !searchKeyword || 
      searchKeyword.trim() === '' ||
      (feedback.original_content && feedback.original_content.toLowerCase().includes(searchKeyword.toLowerCase()))
    return categoryMatch && statusMatch && searchMatch
  })

  // 获取统计数据
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/anonyproof/api/stats')
        const data = await res.json()
        setStats(data)
      } catch (error) {
        console.error('获取统计失败:', error)
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  // 提交成功后自动返回首页
  useEffect(() => {
    if (submitResult?.success) {
      const timer = setTimeout(() => {
        setSubmitResult(null)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [submitResult?.success])

  // 获取我的反馈列表 - 当deviceId准备好时自动获取
  useEffect(() => {
    if (deviceId && step === 5) {
      const fetchMyFeedbacks = async () => {
        try {
          console.log('=== 调试信息 ===')
          console.log('设备ID:', deviceId)
          console.log('LocalStorage中的设备ID:', localStorage.getItem('anonyproof_device_id'))
          
          // 直接访问后端API
          const res = await fetch(`/anonyproof/api/feedback/device/${deviceId}`)
          const data = await res.json()
          console.log('API响应:', data)
          
          if (data.success) {
            console.log('找到反馈数量:', data.feedbacks.length)
            setMyFeedbacks(data.feedbacks)
          } else {
            console.error('API返回错误:', data)
          }
        } catch (error) {
          console.error('获取我的反馈失败:', error)
        }
      }
      fetchMyFeedbacks()
    }
  }, [deviceId, step])

  // 轮询检查新评论（当展开评论时）
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (selectedFeedbackId && step === 5) {
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

          // 检查状态更新（重新获取反馈列表）
          const feedbackRes = await fetch(`/anonyproof/api/feedback/device/${deviceId}`)
          const feedbackData = await feedbackRes.json()
          if (feedbackData.success) {
            // 检查当前反馈的状态是否改变
            const currentFeedback = feedbackData.feedbacks.find((f: any) => f.id === selectedFeedbackId)
            if (currentFeedback) {
              const oldFeedback = myFeedbacks.find((f: any) => f.id === selectedFeedbackId)
              if (oldFeedback && (oldFeedback.status !== currentFeedback.status || oldFeedback.solution !== currentFeedback.solution)) {
                console.log('检测到状态更新，自动刷新')
                setMyFeedbacks(feedbackData.feedbacks)
              }
            }
          }
        } catch (error) {
          console.error('检查更新失败:', error)
        }
      }, 30000) // 30秒检查一次
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedFeedbackId, feedbackComments.length, step])

  // 轮询未读通知数量
  useEffect(() => {
    if (!deviceId) return

    const fetchUnreadCount = async () => {
      try {
        const res = await fetch(`/anonyproof/api/notifications/unread-count?recipientType=user&recipientId=${deviceId}`)
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
  }, [deviceId])

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

  const handleSubmit = async () => {
    if (!content.trim()) {
      setSubmitResult({ success: false, message: '请输入反馈内容' })
      return
    }

    setIsSubmitting(true)
    setSubmitResult(null)

    try {
      console.log('开始加密...')
      const encryptedContent = await encrypt(content)
      console.log('加密完成，开始提交...')

      const res = await fetch('/anonyproof/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          encryptedContent,
          deviceId,
          originalContent: content,
        }),
      })

      const data = await res.json()
      console.log('提交响应:', data)

      if (data.success) {
        setSubmitResult({
          success: true,
          message: '✅ 提交成功！您的反馈已被加密并安全存储。',
          id: data.id,
        })
        setContent('')
        // 刷新统计数据
        const statsRes = await fetch('/anonyproof/api/stats')
        const statsData = await statsRes.json()
        setStats(statsData)
        // 返回首页
        setStep(0)
      } else {
        setSubmitResult({ success: false, message: data.error || '提交失败，请重试' })
      }
    } catch (error) {
      console.error('提交失败:', error)
      const errorMsg = error instanceof Error ? error.message : '请稍后重试'
      setSubmitResult({ success: false, message: `❌ 提交失败: ${errorMsg}` })
    } finally {
      setIsSubmitting(false)
      resetViewportZoom()
    }
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
          commenterType: 'user'
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewComment('')
        fetchComments(selectedFeedbackId)
        resetViewportZoom()
      } else {
        alert(data.error || '添加失败')
      }
    } catch (error) {
      console.error('添加评论失败:', error)
      alert('添加失败')
    }
  }

  // 获取单条反馈的评论
  const fetchSingleFeedbackComments = async (feedbackId: string) => {
    try {
      const res = await fetch(`/anonyproof/api/feedback/${feedbackId}/comments`)
      const data = await res.json()
      if (data.success) {
        setSingleFeedbackComments(data.comments)
      }
    } catch (error) {
      console.error('获取评论失败:', error)
    }
  }

  // 添加单条反馈的评论
  const handleSingleFeedbackAddComment = async () => {
    if (!singleFeedback) return
    if (!singleFeedbackNewComment.trim() || singleFeedbackNewComment.trim().length < 2) {
      alert('评论内容至少需要 2 个字符')
      return
    }
    if (singleFeedbackNewComment.trim().length > 1000) {
      alert('评论内容不能超过 1000 个字符')
      return
    }
    try {
      const res = await fetch(`/anonyproof/api/feedback/${singleFeedback.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: singleFeedbackNewComment.trim(),
          commenterType: 'user'
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSingleFeedbackNewComment('')
        fetchSingleFeedbackComments(singleFeedback.id)
        resetViewportZoom()
      } else {
        alert(data.error || '添加失败')
      }
    } catch (error) {
      console.error('添加评论失败:', error)
      alert('添加失败')
    }
  }

  // 获取通知列表
  const fetchNotifications = async () => {
    try {
      const res = await fetch(`/anonyproof/api/notifications?recipientType=user&recipientId=${deviceId}&limit=20`)
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
      const countRes = await fetch(`/anonyproof/api/notifications/unread-count?recipientType=user&recipientId=${deviceId}`)
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
      await fetch(`/anonyproof/api/notifications/read-all?recipientType=user&recipientId=${deviceId}`, { method: 'PUT' })
      setUnreadCount(0)
      fetchNotifications()
    } catch (error) {
      console.error('标记全部已读失败:', error)
    }
  }

  // 提交成功提示（短暂显示）
  if (submitResult?.success) {
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
          WebkitBackdropFilter: 'blur(20px)',
          padding: '60px 40px', 
          borderRadius: '24px', 
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
          textAlign: 'center', 
          maxWidth: '500px',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#1d1d1f', marginBottom: '12px' }}>
            提交成功！
          </h2>
          <p style={{ fontSize: '16px', color: '#86868b', lineHeight: '1.5', marginBottom: '0' }}>
            {submitResult.message}
          </p>
        </div>
      </div>
    )
  }

  // 首页
  if (step === 0) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        padding: isMobile ? '20px' : '60px 80px', 
        display: 'flex', 
        flexDirection: 'column',
        position: 'relative'  // 添加相对定位
      }}>
        {/* 通知铃铛 - 右上角 */}
        <div style={{ 
          position: 'absolute',
          top: isMobile ? '20px' : '40px',
          right: isMobile ? '20px' : '80px',
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
              fontSize: '28px',
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
                width: '22px',
                height: '22px',
                fontSize: '12px',
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
                width: '350px',
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
                            const unreadSection = document.getElementById('first-unread-notification-user')
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
                            id={index === 0 ? 'first-unread-notification-user' : undefined}
                            onClick={async () => {
                              markAsRead(notif.id)
                              // 先在本地列表中查找
                              let feedback = myFeedbacks.find(f => f.id === notif.feedback_id)
                              
                              if (!feedback) {
                                // 如果本地找不到，从 API 获取
                                try {
                                  const res = await fetch(`/anonyproof/api/feedback/${notif.feedback_id}`)
                                  const data = await res.json()
                                  if (data.success && data.feedback) {
                                    feedback = data.feedback
                                  }
                                } catch (error) {
                                  console.error('获取反馈详情失败:', error)
                                }
                              }
                              
                              if (feedback) {
                                setSingleFeedback(feedback)
                                fetchSingleFeedbackComments(notif.feedback_id)
                                setShowNotificationPanel(false)
                                setStep(6)  // 跳转到单条反馈详情
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
                            <div style={{ marginBottom: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
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
                                    display: 'inline-block',
                                    flexShrink: 0
                                  }}></span>
                                </div>
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
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0
                                  }}
                                >
                                  标为已读
                                </button>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <span style={{ fontSize: '11px', color: '#86868b', whiteSpace: 'nowrap' }}>
                                  {new Date(notif.created_at).toLocaleString('zh-CN')}
                                </span>
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
                            const readSection = document.getElementById('first-read-notification-user')
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
                            id={index === 0 ? 'first-read-notification-user' : undefined}
                            onClick={async () => {
                              // 先在本地列表中查找
                              let feedback = myFeedbacks.find(f => f.id === notif.feedback_id)
                              
                              if (!feedback) {
                                // 如果本地找不到，从 API 获取
                                try {
                                  const res = await fetch(`/anonyproof/api/feedback/${notif.feedback_id}`)
                                  const data = await res.json()
                                  if (data.success && data.feedback) {
                                    feedback = data.feedback
                                  }
                                } catch (error) {
                                  console.error('获取反馈详情失败:', error)
                                }
                              }
                              
                              if (feedback) {
                                setSingleFeedback(feedback)
                                fetchSingleFeedbackComments(notif.feedback_id)
                                setShowNotificationPanel(false)
                                setStep(6)  // 跳转到单条反馈详情
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
                            <div style={{ marginBottom: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
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
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    // 标记为未读
                                    await fetch(`/anonyproof/api/notifications/${notif.id}/unread`, { method: 'PUT' })
                                    await fetchNotifications()
                                    const countRes = await fetch('/anonyproof/api/notifications/unread-count?recipientType=user&recipientId=' + deviceId)
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
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0
                                  }}
                                >
                                  标为未读
                                </button>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <span style={{ fontSize: '11px', color: '#86868b', whiteSpace: 'nowrap' }}>
                                  {new Date(notif.created_at).toLocaleString('zh-CN')}
                                </span>
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

        <div style={{ 
          flex: 1, 
          maxWidth: isMobile ? '100%' : '1000px', 
          margin: '0 auto', 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '32px' : '100px'
        }}>
          {/* 左侧：标题和按钮 */}
          <div style={{ 
            flex: 1,
            width: isMobile ? '100%' : 'auto'
          }}>
            <div style={{ textAlign: isMobile ? 'center' : 'left', marginBottom: isMobile ? '24px' : '32px' }}>
              <div style={{ 
                display: 'inline-block', 
                padding: '8px 20px', 
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                borderRadius: '20px', 
                marginBottom: '16px', 
                fontSize: '14px', 
                fontWeight: '600',
                color: '#1d1d1f',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.05)'
              }}>
                🔒 端到端加密 · 完全匿名
              </div>
              <h1 style={{ 
                fontSize: isMobile ? 'clamp(40px, 10vw, 56px)' : '64px', 
                fontWeight: '800', 
                margin: '0 0 16px 0',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-1px'
              }}>
                匿证
              </h1>

              <p style={{ fontSize: isMobile ? '16px' : '20px', color: '#86868b', margin: 0, fontWeight: '500' }}>
                安全、匿名的反馈平台
              </p>
            </div>

            {/* CTA按钮 */}
            <div style={{ 
              display: 'flex', 
              flexDirection: isMobile ? 'column' : 'row',
              gap: isMobile ? '12px' : '12px',
              marginBottom: isMobile ? '24px' : '32px',
              justifyContent: isMobile ? 'center' : 'flex-start'
            }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  padding: isMobile ? '14px 32px' : '16px 40px',
                  border: 'none',
                  borderRadius: '50px',
                  fontSize: isMobile ? '16px' : '17px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)',
                  transition: 'all 0.3s ease',
                  width: isMobile ? '100%' : 'auto',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 15px 40px rgba(102, 126, 234, 0.5)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 10px 30px rgba(102, 126, 234, 0.4)'
                }}
              >
                开始匿名反馈 →
              </button>
              <button
                onClick={() => {
                  setSubmitResult(null)
                  setStep(5)
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.5)',
                  color: '#667eea',
                  padding: isMobile ? '14px 32px' : '16px 32px',
                  border: '2px solid rgba(102, 126, 234, 0.2)',
                  borderRadius: '50px',
                  fontSize: isMobile ? '15px' : '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  backdropFilter: 'blur(10px)',
                  width: isMobile ? '100%' : 'auto',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
                }}
              >
                我的反馈
              </button>
            </div>

            {/* 安全提醒 - 只在桌面端显示 */}
            {!isMobile && (
              <p style={{ color: '#86868b', fontSize: '13px', margin: 0 }}>
                🔒 您的内容将在客户端加密，服务器无法查看真实内容
              </p>
            )}
          </div>

          {/* 右侧：统计和特性 */}
          <div style={{ 
            flex: 1,
            width: isMobile ? '100%' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? '20px' : '24px'
          }}>
            {/* 统计数据 */}
            {stats && (
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)', 
                gap: isMobile ? '10px' : '12px'
              }}>
                <div style={{ 
                  background: 'rgba(255, 255, 255, 0.6)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  padding: isMobile ? '16px' : '20px', 
                  borderRadius: '16px', 
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                  textAlign: 'center',
                  border: '1px solid rgba(255, 255, 255, 0.4)'
                }}>
                  <div style={{ fontSize: isMobile ? '28px' : '32px', fontWeight: '800', color: '#667eea', marginBottom: '4px' }}>
                    {stats.total}
                  </div>
                  <div style={{ fontSize: isMobile ? '11px' : '12px', color: '#86868b', fontWeight: '500' }}>总反馈数</div>
                </div>
                <div style={{ 
                  background: 'rgba(255, 255, 255, 0.6)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  padding: isMobile ? '16px' : '20px', 
                  borderRadius: '16px', 
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                  textAlign: 'center',
                  border: '1px solid rgba(255, 255, 255, 0.4)'
                }}>
                  <div style={{ fontSize: isMobile ? '28px' : '32px', fontWeight: '800', color: '#34c759', marginBottom: '4px' }}>
                    {stats.total > 0 ? '100' : '0'}%
                  </div>
                  <div style={{ fontSize: isMobile ? '11px' : '12px', color: '#86868b', fontWeight: '500' }}>加密率</div>
                </div>
                <div style={{ 
                  background: 'rgba(255, 255, 255, 0.6)',
                  backdropFilter: 'blur(10)(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  padding: isMobile ? '16px' : '20px', 
                  borderRadius: '16px', 
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                  textAlign: 'center',
                  border: '1px solid rgba(255, 255, 255, 0.4)'
                }}>
                  <div style={{ fontSize: isMobile ? '28px' : '32px', fontWeight: '800', color: '#ff3b30', marginBottom: '4px' }}>
                    {stats.leaks}
                  </div>
                  <div style={{ fontSize: isMobile ? '11px' : '12px', color: '#86868b', fontWeight: '500' }}>数据泄露</div>
                </div>
              </div>
            )}

            {/* 特性介绍 */}
            <div style={{ display: 'grid', gap: isMobile ? '10px' : '12px' }}>
              <div style={{ 
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: isMobile ? '18px' : '20px', 
                borderRadius: '16px', 
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '12px' : '12px'
              }}>
                <div style={{ fontSize: isMobile ? '26px' : '28px' }}>🔒</div>
                <div>
                  <h3 style={{ fontSize: isMobile ? '15px' : '15px', fontWeight: '700', color: '#1d1d1f', marginBottom: '4px' }}>端到端加密</h3>
                  <p style={{ fontSize: isMobile ? '13px' : '13px', color: '#86868b', lineHeight: '1.4', margin: 0 }}>您的反馈在客户端加密，服务器无法查看真实内容</p>
                </div>
              </div>
              <div style={{ 
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: isMobile ? '18px' : '20px', 
                borderRadius: '16px', 
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '12px' : '12px'
              }}>
                <div style={{ fontSize: isMobile ? '26px' : '28px' }}>🛡️</div>
                <div>
                  <h3 style={{ fontSize: isMobile ? '15px' : '15px', fontWeight: '700', color: '#1d1d1f', marginBottom: '4px' }}>防偷看机制</h3>
                  <p style={{ fontSize: isMobile ? '13px' : '13px', color: '#86868b', lineHeight: '1.4', margin: 0 }}>所有管理员操作都会被记录，确保透明可追溯</p>
                </div>
              </div>
              <div style={{ 
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: isMobile ? '18px' : '20px', 
                borderRadius: '16px', 
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '12px' : '12px'
              }}>
                <div style={{ fontSize: isMobile ? '26px' : '28px' }}>📱</div>
                <div>
                  <h3 style={{ fontSize: isMobile ? '15px' : '15px', fontWeight: '700', color: '#1d1d1f', marginBottom: '4px' }}>设备绑定</h3>
                  <p style={{ fontSize: isMobile ? '13px' : '13px', color: '#86868b', lineHeight: '1.4', margin: 0 }}>您可以查看自己提交的历史反馈，随时跟踪处理进度</p>
                </div>
              </div>
            </div>

            {/* 安全提醒 - 只在手机端显示在底部 */}
            {isMobile && (
              <p style={{ textAlign: 'center', color: '#86868b', fontSize: '12px', margin: '16px 0 0 0' }}>
                🔒 您的内容将在客户端加密，服务器无法查看真实内容
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 选择分类
  if (step === 1) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        padding: '20px' 
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '40px' }}>
          <button
            onClick={() => setStep(0)}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              color: '#667eea',
              padding: '12px 24px',
              border: '2px solid rgba(102, 126, 234, 0.2)',
              borderRadius: '50px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '32px',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.2)'
            }}
          >
            ← 返回首页
          </button>

          <h2 style={{ fontSize: '36px', fontWeight: '800', color: '#1d1d1f', marginBottom: '16px', textAlign: 'center' }}>
            选择反馈类型
          </h2>
          <p style={{ fontSize: '16px', color: '#86868b', textAlign: 'center', marginBottom: '32px' }}>
            请选择最符合您反馈内容的分类
          </p>

          <div style={{ display: 'grid', gap: '16px' }}>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setCategory(cat.id)
                  setStep(2)
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.6)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  padding: '24px 28px',
                  border: '1px solid rgba(255, 255, 255, 0.4)',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '20px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateX(4px)'
                  e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.12)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateX(0)'
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.08)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)'
                }}
              >
                <div style={{ fontSize: '40px' }}>{cat.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#1d1d1f', marginBottom: '6px' }}>
                    {cat.name}
                  </div>
                  <div style={{ fontSize: '14px', color: '#86868b' }}>{cat.description}</div>
                </div>
                <div style={{ fontSize: '24px', color: '#667eea' }}>→</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // 输入内容
  if (step === 2) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        padding: '20px' 
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: '30px' }}>
          <button
            onClick={() => setStep(1)}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              color: '#667eea',
              padding: '12px 24px',
              border: '2px solid rgba(102, 126, 234, 0.2)',
              borderRadius: '50px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '24px',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.2)'
            }}
          >
            ← 返回选择
          </button>

          <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#1d1d1f', marginBottom: '24px' }}>
            请输入反馈内容
          </h2>

          <div style={{ 
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            padding: '28px', 
            borderRadius: '24px', 
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.4)'
          }}>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请详细描述您的反馈内容..."
              style={{
                width: '100%',
                minHeight: '200px',
                padding: '16px',
                fontSize: '16px',
                border: '2px solid rgba(102, 126, 234, 0.15)',
                borderRadius: '16px',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                background: 'rgba(255, 255, 255, 0.5)',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#667eea'
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.15)'
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
                resetViewportZoom()
              }}
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.5)',
                  color: '#86868b',
                  border: '2px solid rgba(0, 0, 0, 0.1)',
                  borderRadius: '14px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                返回
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !content.trim()}
                style={{
                  flex: 2,
                  padding: '14px',
                  background: isSubmitting || !content.trim() ? 'rgba(134, 134, 134, 0.3)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '14px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: isSubmitting || !content.trim() ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting || !content.trim() ? 0.6 : 1,
                }}
              >
                {isSubmitting ? '提交中...' : '提交反馈'}
              </button>
            </div>
          </div>

          <p style={{ textAlign: 'center', color: '#86868b', marginTop: '16px', fontSize: '13px' }}>
            🔒 您的内容将在客户端加密，服务器无法查看
          </p>
        </div>
      </div>
    )
  }

  // 我的反馈
  if (step === 5) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        padding: '20px'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', paddingTop: '40px' }}>
          <button
            onClick={() => setStep(0)}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              color: '#667eea',
              padding: '12px 24px',
              border: '2px solid rgba(102, 126, 234, 0.2)',
              borderRadius: '50px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '24px',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.2)'
            }}
          >
            ← 返回首页
          </button>

          <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#1d1d1f', marginBottom: '16px', textAlign: 'center' }}>
            我的反馈
          </h2>

          {/* 设备ID显示 */}
          {deviceId && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.5)',
              backdropFilter: 'blur(10px)',
              padding: '10px 16px',
              borderRadius: '12px',
              marginBottom: '24px',
              textAlign: 'center',
              border: '1px solid rgba(102, 126, 234, 0.2)',
            }}>
              <div style={{ fontSize: '12px', color: '#667eea', marginBottom: '4px', fontWeight: '600' }}>
                📱 您的设备 ID
              </div>
              <div style={{ 
                fontSize: '14px', 
                color: '#1d1d1f', 
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                fontWeight: '500' 
              }}>
                {deviceId}
              </div>
            </div>
          )}

          {/* 📊 数据看板 */}
          {myFeedbacks.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
              marginBottom: '24px'
            }}>
              <div style={{
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '16px',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.4)'
              }}>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#667eea', marginBottom: '4px' }}>
                  {myFeedbacks.length}
                </div>
                <div style={{ fontSize: '12px', color: '#86868b', fontWeight: '500' }}>全部反馈</div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '16px',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.4)'
              }}>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#ff9500', marginBottom: '4px' }}>
                  {(statsData.pending || 0) + (statsData.in_progress || 0)}
                </div>
                <div style={{ fontSize: '12px', color: '#86868b', fontWeight: '500' }}>处理中</div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '16px',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.4)'
              }}>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#34c759', marginBottom: '4px' }}>
                  {statsData.resolved || 0}
                </div>
                <div style={{ fontSize: '12px', color: '#86868b', fontWeight: '500' }}>已解决</div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '16px',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.4)'
              }}>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#8e8e93', marginBottom: '4px' }}>
                  {statsData.no_solution || 0}
                </div>
                <div style={{ fontSize: '12px', color: '#86868b', fontWeight: '500' }}>暂不解决</div>
              </div>
            </div>
          )}

          {/* 🎯 筛选按钮 */}
          {myFeedbacks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              {/* 搜索框 */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                  🔍 搜索反馈
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onBlur={() => resetViewportZoom()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                        resetViewportZoom()
                      }
                    }}
                    placeholder="输入关键词搜索反馈内容，按回车搜索..."
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      fontSize: '13px',
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
                        resetViewportZoom()
                      }}
                      style={{
                        padding: '10px 16px',
                        background: 'rgba(102, 126, 234, 0.1)',
                        border: '1px solid #667eea',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: '#667eea',
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>

              {/* 类型筛选 */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                  分类筛选
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setFilterCategory('all')}
                    style={{
                      padding: '8px 16px',
                      background: filterCategory === 'all' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255, 255, 255, 0.5)',
                      color: filterCategory === 'all' ? 'white' : '#667eea',
                      border: filterCategory === 'all' ? 'none' : '2px solid rgba(102, 126, 234, 0.2)',
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    全部 ({myFeedbacks.length})
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setFilterCategory(cat.id)}
                      style={{
                        padding: '8px 16px',
                        background: filterCategory === cat.id ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255, 255, 255, 0.5)',
                        color: filterCategory === cat.id ? 'white' : '#667eea',
                        border: filterCategory === cat.id ? 'none' : '2px solid rgba(102, 126, 234, 0.2)',
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      {cat.icon} {cat.name} ({statsData[cat.id as keyof typeof statsData] || 0})
                    </button>
                  ))}
                </div>
              </div>

              {/* 状态筛选 */}
              <div>
                <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                  状态筛选
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setFilterStatus('all')}
                    style={{
                      padding: '8px 16px',
                      background: filterStatus === 'all' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255, 255, 255, 0.5)',
                      color: filterStatus === 'all' ? 'white' : '#667eea',
                      border: filterStatus === 'all' ? 'none' : '2px solid rgba(102, 126, 234, 0.2)',
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    全部
                  </button>
                  {Object.entries(statusConfig).map(([key, config]) => {
                    // 计算该状态的数量（如果已按分类筛选，则显示该分类下该状态的数量）
                    const count = filterCategory !== 'all'
                      ? myFeedbacks.filter(f => f.category === filterCategory && f.status === key).length
                      : statsData[key as keyof typeof statsData] || 0
                    return (
                      <button
                        key={key}
                        onClick={() => setFilterStatus(key)}
                        style={{
                          padding: '8px 16px',
                          background: filterStatus === key ? config.bg : 'rgba(255, 255, 255, 0.5)',
                          color: filterStatus === key ? config.color : '#667eea',
                          border: filterStatus === key ? `2px solid ${config.color}` : '2px solid rgba(102, 126, 234, 0.2)',
                          borderRadius: '20px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          backdropFilter: 'blur(10px)',
                        }}
                      >
                        {config.icon} {config.label} ({count})
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {filteredFeedbacks.length === 0 ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              padding: '60px 40px',
              borderRadius: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
              textAlign: 'center',
              border: '1px solid rgba(255, 255, 255, 0.4)'
            }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>🔍</div>
              <p style={{ fontSize: '17px', color: '#86868b', marginBottom: '24px' }}>
                {myFeedbacks.length === 0 ? '您还没有提交过任何反馈' : '没有符合筛选条件的反馈'}
              </p>
              {myFeedbacks.length === 0 && (
                <button
                  onClick={() => setStep(1)}
                  style={{
                    padding: '14px 40px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50px',
                    fontSize: '16px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)',
                  }}
                >
                  立即提交反馈
                </button>
              )}
              {myFeedbacks.length > 0 && (
                <button
                  onClick={() => {
                    setFilterCategory('all')
                    setFilterStatus('all')
                    setSearchKeyword('')
                  }}
                  style={{
                    padding: '14px 40px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50px',
                    fontSize: '16px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)',
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {filteredFeedbacks.map((feedback) => (
                <div
                  key={feedback.id}
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    padding: '24px', 
                    borderRadius: '20px', 
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.4)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1f' }}>
                        {feedback.category === 'suggestion' ? '💡' : feedback.category === 'complaint' ? '⚠️' : '🔔'} {feedback.category === 'suggestion' ? '建议' : feedback.category === 'complaint' ? '投诉' : '举报'}
                      </div>
                      {/* 状态标签 */}
                      {feedback.status && statusConfig[feedback.status as keyof typeof statusConfig] && (
                        <div style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          background: statusConfig[feedback.status as keyof typeof statusConfig].bg,
                          color: statusConfig[feedback.status as keyof typeof statusConfig].color,
                          border: `1px solid ${statusConfig[feedback.status as keyof typeof statusConfig].color}`,
                        }}>
                          {statusConfig[feedback.status as keyof typeof statusConfig].icon} {statusConfig[feedback.status as keyof typeof statusConfig].label}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#86868b' }}>
                      {new Date(feedback.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  {feedback.original_content && (
                    <div style={{
                      background: 'rgba(255, 255, 255, 0.4)',
                      padding: '16px',
                      borderRadius: '12px',
                      marginBottom: '12px',
                      border: '1px solid rgba(0, 0, 0, 0.05)'
                    }}>
                      <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                        提交内容：
                      </div>
                      <div style={{ fontSize: '15px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                        {feedback.original_content}
                      </div>
                    </div>
                  )}

                  {/* 解决方案/处理意见显示 */}
                  {feedback.status && feedback.status !== 'pending' && feedback.solution && (
                    <div style={{
                      background: feedback.status === 'resolved' ? 'rgba(52, 199, 89, 0.1)' :
                                 feedback.status === 'in_progress' ? 'rgba(255, 149, 0, 0.1)' :
                                 'rgba(142, 142, 147, 0.1)',
                      padding: '16px',
                      borderRadius: '12px',
                      marginBottom: '12px',
                      border: `1px solid ${feedback.status === 'resolved' ? '#34c759' : feedback.status === 'in_progress' ? '#ff9500' : '#8e8e93'}`
                    }}>
                      <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                        {feedback.status === 'resolved' ? '✅ 解决方案' : feedback.status === 'in_progress' ? '🔄 处理进展' : '⚠️ 处理说明'}
                      </div>
                      <div style={{ fontSize: '15px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                        {feedback.solution}
                      </div>
                      {feedback.solution_updated_at && (
                        <div style={{ fontSize: '11px', color: '#86868b', marginTop: '8px' }}>
                          更新时间: {new Date(feedback.solution_updated_at).toLocaleString('zh-CN')}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: '13px', color: '#34c759', fontWeight: '600' }}>
                    ✓ 已加密存储 · ID: {feedback.id.slice(0, 8)}...
                  </div>
                  
                  {/* 评论按钮 */}
                  <div style={{ marginTop: '12px', marginBottom: '12px' }}>
                    <button
                      onClick={() => {
                        if (selectedFeedbackId === feedback.id) {
                          setSelectedFeedbackId(null)
                          setFeedbackComments([])
                        } else {
                          setSelectedFeedbackId(feedback.id)
                          fetchComments(feedback.id)
                        }
                      }}
                      style={{ padding: '8px 16px', background: 'rgba(102, 126, 234, 0.1)', border: '1px solid #667eea', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#667eea' }}
                    >
                      💬 {selectedFeedbackId === feedback.id ? '收起评论' : '查看/添加评论'}
                    </button>
                  </div>

                  {/* 评论区域 */}
                  {selectedFeedbackId === feedback.id && (
                    <div style={{ background: 'rgba(255, 255, 255, 0.3)', padding: '16px', borderRadius: '12px', marginBottom: '12px', border: '1px solid rgba(0, 0, 0, 0.05)' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>💬 讨论与沟通</h4>
                      {feedbackComments.length === 0 ? (
                        <p style={{ color: '#86868b', textAlign: 'center', padding: '20px', fontSize: '13px' }}>暂无评论，开始讨论吧</p>
                      ) : (
                        feedbackComments.map((comment) => (
                          <div key={comment.id} style={{ background: comment.commenter_type === 'admin' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(255, 255, 255, 0.4)', padding: '10px', borderRadius: '8px', marginBottom: '8px', border: comment.commenter_type === 'admin' ? '1px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)' }}>
                            <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '4px' }}>{comment.commenter_type === 'admin' ? '👨‍💼 管理员' : '👤 用户'} · {new Date(comment.created_at).toLocaleString('zh-CN')}</div>
                            <div style={{ fontSize: '13px', color: '#1d1d1f', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{comment.content}</div>
                          </div>
                        ))
                      )}
                      <div style={{ marginTop: '12px' }}>
                        <textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          onBlur={() => resetViewportZoom()}
                          placeholder="💬 在此回复管理员，补充说明或提出疑问..."
                          style={{ width: '100%', minHeight: '60px', padding: '10px', fontSize: '13px', border: '2px solid rgba(0, 0, 0, 0.1)', borderRadius: '8px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#86868b' }}>{newComment.length}/1000 字符</span>
                          <button
                            onClick={handleAddComment}
                            disabled={!newComment.trim()}
                            style={{ padding: '6px 14px', background: !newComment.trim() ? 'rgba(134, 134, 134, 0.3)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: !newComment.trim() ? 'not-allowed' : 'pointer', opacity: !newComment.trim() ? 0.6 : 1 }}
                          >
                            发送评论
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 单条反馈详情
  if (step === 6) {
    // 自动展开评论
    if (singleFeedback && !selectedFeedbackId) {
      setSelectedFeedbackId(singleFeedback.id)
      fetchSingleFeedbackComments(singleFeedback.id)
    }

    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        padding: '20px'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', paddingTop: '40px' }}>
          <button
            onClick={() => {
              setStep(5)
              setSingleFeedback(null)
              setSingleFeedbackComments([])
              setSingleFeedbackNewComment('')
              setSelectedFeedbackId(null)
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              color: '#667eea',
              padding: '12px 24px',
              border: '2px solid rgba(102, 126, 234, 0.2)',
              borderRadius: '50px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '24px',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
              e.currentTarget.style.borderColor = 'rgba(102, 126, 234, 0.2)'
            }}
          >
            ← 返回列表
          </button>

          <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#1d1d1d', marginBottom: '28px', textAlign: 'center' }}>
            反馈详情
          </h2>

          {/* 反馈信息卡片 */}
          {singleFeedback && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(10px)',
              padding: '24px',
              borderRadius: '16px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1f' }}>
                  {singleFeedback.category === 'suggestion' ? '💡' : singleFeedback.category === 'complaint' ? '⚠️' : '🔔'} {singleFeedback.category === 'suggestion' ? '建议' : singleFeedback.category === 'complaint' ? '投诉' : '举报'}
                </div>
                <div style={{ fontSize: '13px', color: '#86868b' }}>
                  {new Date(singleFeedback.created_at).toLocaleString('zh-CN')}
                </div>
              </div>

              {/* 状态标签 */}
              {singleFeedback.status && statusConfig[singleFeedback.status as keyof typeof statusConfig] && (
                <div style={{
                  padding: '6px 12px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  background: statusConfig[singleFeedback.status as keyof typeof statusConfig].bg,
                  color: statusConfig[singleFeedback.status as keyof typeof statusConfig].color,
                  border: `1px solid ${statusConfig[singleFeedback.status as keyof typeof statusConfig].color}`,
                  marginBottom: '16px',
                  display: 'inline-block',
                }}>
                  {statusConfig[singleFeedback.status as keyof typeof statusConfig].icon} {statusConfig[singleFeedback.status as keyof typeof statusConfig].label}
                </div>
              )}

              {/* 反馈内容 */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.4)',
                padding: '16px',
                borderRadius: '12px',
                marginBottom: '12px',
                border: '1px solid rgba(0, 0, 0, 0.05)'
              }}>
                <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                  提交内容：
                </div>
                <div style={{ fontSize: '15px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {singleFeedback.original_content}
                </div>
              </div>

              {/* 解决方案显示 */}
              {singleFeedback.status && singleFeedback.status !== 'pending' && singleFeedback.solution && (
                <div style={{
                  background: singleFeedback.status === 'resolved' ? 'rgba(52, 199, 89, 0.1)' :
                             singleFeedback.status === 'in_progress' ? 'rgba(255, 149, 0, 0.1)' :
                             'rgba(142, 142, 147, 0.1)',
                  padding: '16px',
                  borderRadius: '12px',
                  marginBottom: '12px',
                  border: `1px solid ${singleFeedback.status === 'resolved' ? '#34c759' : singleFeedback.status === 'in_progress' ? '#ff9500' : '#8e8e93'}`,
                }}>
                  <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '8px', fontWeight: '600' }}>
                    {singleFeedback.status === 'resolved' ? '✅ 解决方案' : singleFeedback.status === 'in_progress' ? '🔄 处理进展' : '⚠️ 处理说明'}
                  </div>
                  <div style={{ fontSize: '14px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    {singleFeedback.solution}
                  </div>
                  {singleFeedback.solution_updated_at && (
                    <div style={{ fontSize: '11px', color: '#86868b', marginTop: '8px' }}>
                      更新时间: {new Date(singleFeedback.solution_updated_at).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 评论功能 */}
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
                if (selectedFeedbackId === singleFeedback?.id) {
                  setSelectedFeedbackId(null)
                } else {
                  setSelectedFeedbackId(singleFeedback?.id || null)
                  fetchSingleFeedbackComments(singleFeedback?.id || '')
                }
              }}
              style={{
                marginBottom: '20px',
                padding: '12px 24px',
                background: 'rgba(102, 126, 234, 0.1)',
                border: 'none',
                borderRadius: '50px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)',
              }}
            >
              {selectedFeedbackId === singleFeedback?.id ? '收起评论' : '💬 展开/添加评论'}
            </button>

            {selectedFeedbackId === singleFeedback?.id && (
              <>
                <div style={{ background: 'rgba(255, 255, 255, 0.3)', padding: '16px', borderRadius: '12px', marginBottom: '12px', border: '1px solid rgba(0, 0, 0, 0.05)', maxHeight: '400px', overflowY: 'auto' }}>
                  {singleFeedbackComments.length === 0 ? (
                    <p style={{ color: '#86868b', textAlign: 'center', padding: '20px', fontSize: '13px' }}>暂无评论</p>
                  ) : (
                    singleFeedbackComments.map((comment) => (
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
                    value={singleFeedbackNewComment}
                    onChange={(e) => setSingleFeedbackNewComment(e.target.value)}
                    onBlur={() => resetViewportZoom()}
                    placeholder="💬 回复管理员，说明你的想法或提出疑问..."
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
                    <span style={{ fontSize: '11px', color: '#86868b' }}>{singleFeedbackNewComment.length}/1000 字符</span>
                    <button
                      onClick={handleSingleFeedbackAddComment}
                      disabled={!singleFeedbackNewComment.trim()}
                      style={{
                        padding: '6px 14px',
                        background: !singleFeedbackNewComment.trim() ? 'rgba(134, 134, 134, 0.3)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        opacity: !singleFeedbackNewComment.trim() ? 0.6 : 1,
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
      </div>
    )
  }

  return null
}
