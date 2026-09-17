# 通知中心 UI 实现指南

## 用户端实现

### 步骤 1: 添加通知相关状态

在 `app/page.tsx` 的状态变量部分添加：

```typescript
// 通知相关状态
const [unreadCount, setUnreadCount] = useState(0)
const [showNotificationPanel, setShowNotificationPanel] = useState(false)
const [notifications, setNotifications] = useState<any[]>([])
```

### 步骤 2: 添加轮询未读通知数量

在现有的 `useEffect` 之后添加：

```typescript
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
```

### 步骤 3: 添加获取通知列表的函数

```typescript
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
```

### 步骤 4: 在首页添加通知铃铛

在首页标题部分添加：

```tsx
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

{/* 新增：通知铃铛 */}
<div style={{ position: 'relative', display: 'inline-block', marginLeft: '16px' }}>
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
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      position: 'relative',
    }}
  >
    🔔
    {unreadCount > 0 && (
      <span style={{
        position: 'absolute',
        top: '-8px',
        right: '-8px',
        background: '#ff3b30',
        color: 'white',
        borderRadius: '50%',
        width: '20px',
        height: '20px',
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
    <div style={{
      position: 'absolute',
      top: '40px',
      right: '0',
      width: '350px',
      maxHeight: '500px',
      background: 'white',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      zIndex: 1000,
      overflow: 'hidden',
    }}>
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
          notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => markAsRead(notif.id)}
              style={{
                padding: '16px',
                borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                cursor: 'pointer',
                background: notif.is_read ? 'transparent' : 'rgba(102, 126, 234, 0.05)',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = notif.is_read ? 'transparent' : 'rgba(102, 126, 234, 0.05)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ 
                  fontSize: '13px', 
                  fontWeight: '600', 
                  color: notif.type === 'comment' ? '#667eea' : notif.type === 'status_update' ? '#34c759' : '#ff9500' 
                }}>
                  {notif.title}
                </span>
                <span style={{ fontSize: '11px', color: '#86868b' }}>
                  {new Date(notif.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#1d1d1f', lineHeight: '1.5', marginBottom: '8px' }}>
                {notif.content}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  markAsRead(notif.id)
                  // 跳转到反馈详情
                  setSelectedFeedback(notif.feedback_id)
                  fetchComments(notif.feedback_id)
                  setShowNotificationPanel(false)
                  setStep(5)
                }}
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
                查看详情
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )}
</div>
```

---

## 管理后台实现

### 与用户端类似，但 `recipientType='admin'` 和 `recipientId='admin'`

---

**由于代码较长，建议分步实现。我已经准备好了所有后端 API 和完整的设计文档。**

你希望我继续完成前端部分吗？还是你想先看看这个设计？
