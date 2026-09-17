# 匿证平台轻量级通知系统 - 设计文档

## 系统设计

### 核心理念
- **用户无需注册** - 设备ID即为账户
- **管理员密码登录** - 唯一的管理账号
- **消息通知** - 实时通知对方的新评论和状态更新

---

## 数据库表设计

### 1. 通知表 (notifications)

```sql
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL,  -- 'user' 或 'admin'
  recipient_id TEXT NOT NULL,      -- 设备ID (用户) 或 'admin' (管理员)
  feedback_id TEXT NOT NULL,      -- 关联的反馈ID
  type TEXT NOT NULL,             -- 'comment' 或 'status_update'
  title TEXT NOT NULL,            -- 通知标题
  content TEXT NOT NULL,          -- 通知内容
  is_read INTEGER DEFAULT 0,      -- 是否已读: 0=未读, 1=已读
  created_at INTEGER NOT NULL,    -- 创建时间
  
  FOREIGN KEY (feedback_id) REFERENCES feedbacks(id)
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, recipient_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
```

---

## 通知触发场景

### 用户端通知

1. **管理员评论**
   - 触发：管理员添加评论
   - 通知对象：该反馈的用户
   - 标题："管理员回复了您的反馈"
   - 内容：评论内容摘要

2. **状态更新**
   - 触发：管理员更新反馈状态
   - 通知对象：该反馈的用户
   - 标题："您的反馈状态已更新"
   - 内容：新状态 + 解决方案（如有）

### 管理端通知

1. **用户评论**
   - 触发：用户添加评论
   - 通知对象：管理员
   - 标题："用户回复了您的评论"
   - 内容：评论内容摘要

2. **新反馈**
   - 触发：用户提交新反馈
   - 通知对象：管理员
   - 标题："收到新的反馈"
   - 内容：反馈类型 + 内容摘要

---

## API 设计

### 1. 获取未读通知数量

```typescript
GET /api/notifications/unread-count?recipientType=user&recipientId={deviceId}

响应:
{
  success: true,
  count: 5
}
```

### 2. 获取通知列表

```typescript
GET /api/notifications?recipientType=user&recipientId={deviceId}&limit=20

响应:
{
  success: true,
  notifications: [
    {
      id: 1,
      feedback_id: 'abc123',
      type: 'comment',
      title: '管理员回复了您的反馈',
      content: '您的问题已解决...',
      is_read: 0,
      created_at: '2026-03-05T10:00:00Z'
    }
  ]
}
```

### 3. 标记通知为已读

```typescript
PUT /api/notifications/:id/read

响应:
{
  success: true
}
```

### 4. 标记所有通知为已读

```typescript
PUT /api/notifications/read-all?recipientType=user&recipientId={deviceId}

响应:
{
  success: true,
  count: 5  // 标记为已读的数量
}
```

---

## 前端实现

### 用户端

#### 1. 通知铃铛（首页顶部）

```
┌─────────────────────────────────────────┐
│ 匿证                        🔔 3 [≡]   │
└─────────────────────────────────────────┘
```

#### 2. 通知中心面板

```
┌─────────────────────────────────────────┐
│ 🔔 通知中心                    [全部已读]│
├─────────────────────────────────────────┤
│                                         │
│ 📢 新通知 (3)                          │
│                                         │
│ ┌───────────────────────────────────┐ │
│ │ 管理员回复了您的反馈        2分钟前│ │
│ │ 您的问题已解决，请查看详情...     │ │
│ │ [查看详情]                         │ │
│ └───────────────────────────────────┘ │
│                                         │
│ ┌───────────────────────────────────┐ │
│ │ 您的反馈状态已更新        5分钟前│ │
│ │ 状态：✅ 已解决                   │ │
│ │ [查看详情]                         │ │
│ └───────────────────────────────────┘ │
│                                         │
│ ┌───────────────────────────────────┐ │
│ │ 管理员回复了您的反馈       1小时前│ │
│ │ 正在调查中，请耐心等待...         │ │
│ │ [查看详情]                         │ │
│ └───────────────────────────────────┘ │
│                                         │
│ 📋 更早的通知                         │
│ ...                                   │
└─────────────────────────────────────────┘
```

### 管理端

#### 1. 通知铃铛（顶部导航）

```
┌─────────────────────────────────────────┐
│ 🔐 匿证管理后台              🔔 12    │
└─────────────────────────────────────────┘
```

#### 2. 通知列表（与用户端类似）

---

## 轮询优化

### 当前：30秒检查一次更新
### 优化后：
- **有未读通知时**：每 15 秒检查一次
- **无未读通知时**：每 60 秒检查一次
- **页面隐藏时**：停止轮询
- **页面显示时**：恢复轮询

---

## 实现步骤

### 步骤 1: 创建通知表
### 步骤 2: 实现通知 API
### 步骤 3: 添加通知触发逻辑
### 步骤 4: 实现前端通知中心
### 步骤 5: 优化轮询策略

---

## 用户体验

### 用户端
1. 用户提交反馈
2. 用户离开页面
3. 管理员处理并回复
4. 用户再次打开页面
5. 看到通知铃铛上有数字 "3"
6. 点击铃铛，查看通知
7. 点击"查看详情"，跳转到对应反馈
8. 看到管理员回复和最新状态

### 管理端
1. 管理员登录后台
2. 看到通知铃铛上有数字 "12"
3. 点击查看新反馈和用户评论
4. 快速处理和回复

---

**准备好开始实现了吗？** 🚀

我会按照这个设计，逐步实现所有功能。
