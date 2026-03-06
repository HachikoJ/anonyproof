# 🔧 评论功能实现说明

**状态**: ✅ 后端 API 已完成，前端需要集成

---

## 📊 已完成的工作

### 1. **数据库表创建** ✅

创建了 `feedback_comments` 表：

```sql
CREATE TABLE feedback_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL,
  commenter_type TEXT NOT NULL,  -- 'user' 或 'admin'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  admin_ip TEXT,
  FOREIGN KEY (feedback_id) REFERENCES feedbacks(id)
);
```

### 2. **后端 API** ✅

#### 添加评论
```http
POST /api/feedback/:id/comments

Request:
{
  "content": "这是一条评论",
  "commenterType": "user"  // 或 "admin"
}

Response:
{
  "success": true,
  "commentId": 123
}
```

#### 获取评论
```http
GET /api/feedback/:id/comments

Response:
{
  "success": true,
  "comments": [
    {
      "id": 123,
      "feedback_id": "uuid-xxx",
      "commenter_type": "user",
      "content": "这是一条评论",
      "created_at": "2026-03-04T10:30:00.000Z",
      "admin_ip": null
    }
  ]
}
```

### 3. **状态更新** ✅

状态已改为：
- `pending` - 待处理
- `in_progress` - 持续跟进
- `resolved` - 已解决
- `no_solution` - 暂不解决

---

## 🎨 前端需要集成的功能

### 1. **状态筛选按钮**（管理后台）

将"已关闭"按钮改为"暂不解决"：

```tsx
<button onClick={() => {
  setSelectedStatus('no_solution')
  setSelectedFeedback(null)
}}
style={{
  padding: '8px 16px',
  background: selectedStatus === 'no_solution' ? 'rgba(107, 114, 128, 0.1)' : 'transparent',
  border: selectedStatus === 'no_solution' ? '2px solid #6b7280' : '1px solid rgba(0, 0, 0, 0.1)',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  color: selectedStatus === 'no_solution' ? '#6b7280' : '#86868b',
  cursor: 'pointer',
}}
>
  ⚠️ 暂不解决
</button>
```

### 2. **状态显示逻辑**（管理后台）

更新状态显示：

```tsx
<span style={{
  fontSize: '12px',
  padding: '4px 8px',
  borderRadius: '4px',
  background: 
    feedback.status === 'pending' ? '#fff3cd' :
    feedback.status === 'in_progress' ? '#fff3cd' :
    feedback.status === 'resolved' ? '#34c759' :
    '#6b7280',  // no_solution - 灰色
  color: 
    feedback.status === 'pending' ? '#856404' :
    feedback.status === 'in_progress' ? '#856404' :
    feedback.status === 'resolved' ? '#fff' :
    '#fff',
}}>
  {feedback.status === 'pending' ? '⏰ 待处理' : 
   feedback.status === 'in_progress' ? '🔄 持续跟进' :
   feedback.status === 'resolved' ? '✅ 已解决' : '⚠️ 暂不解决'}
</span>
```

### 3. **状态更新按钮**（管理后台）

更新状态更新逻辑：

```tsx
<button
  onClick={() => {
    const solution = (document.getElementById('solution-input') as HTMLTextAreaElement).value
    if (!solution || solution.trim().length < 10) {
      alert('标记为已解决或暂不解决时必须填写至少 10 个字的解决方案或处理说明')
      return
    }
    handleStatusUpdate(selectedFeedback.id, 'no_solution', solution)
  }}
  style={{
    padding: '8px 16px',
    background: 'rgba(107, 114, 128, 0.1)',
    border: '1px solid #6b7280',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  }}
>
  ⚠️ 暂不解决
</button>
```

### 4. **评论组件**（管理后台 + 用户端）

在反馈详情页添加评论区域：

```tsx
// 添加状态
const [comments, setComments] = useState<any[]>([])
const [newComment, setNewComment] = useState('')

// 获取评论
useEffect(() => {
  if (selectedFeedback) {
    fetchComments(selectedFeedback.id)
  }
}, [selectedFeedback])

const fetchComments = async (feedbackId: string) => {
  try {
    const res = await fetch(`/anonyproof/api/feedback/${feedbackId}/comments`)
    const data = await res.json()
    if (data.success) {
      setComments(data.comments)
    }
  } catch (error) {
    console.error('获取评论失败:', error)
  }
}

const handleAddComment = async () => {
  if (!newComment.trim() || newComment.trim().length < 2) {
    alert('评论内容至少需要 2 个字符')
    return
  }
  
  if (newComment.trim().length > 1000) {
    alert('评论内容不能超过 1000 个字符')
    return
  }

  try {
    const res = await fetch(`/anonyproof/api/feedback/${selectedFeedback.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: newComment.trim(),
        commenterType: 'admin'  // 管理后台用 'admin'，用户端用 'user'
      }),
    })
    const data = await res.json()
    if (data.success) {
      setNewComment('')
      fetchComments(selectedFeedback.id)
    } else {
      alert(data.error || '添加失败')
    }
  } catch (error) {
    console.error('添加评论失败:', error)
    alert('添加失败')
  }
}

// 评论区域 UI
<div style={{ marginTop: '24px' }}>
  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
    💬 讨论与沟通
  </h3>
  
  {/* 评论列表 */}
  {comments.length === 0 ? (
    <p style={{ color: '#86868b', textAlign: 'center', padding: '20px' }}>
      暂无评论，开始讨论吧
    </p>
  ) : (
    comments.map((comment) => (
      <div
        key={comment.id}
        style={{
          background: comment.commenter_type === 'admin' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(255, 255, 255, 0.4)',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '8px',
          border: comment.commenter_type === 'admin' ? '1px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#86868b', marginBottom: '4px' }}>
          {comment.commenter_type === 'admin' ? '👨‍💼 管理员' : '👤 用户'} · {new Date(comment.created_at).toLocaleString('zh-CN')}
        </div>
        <div style={{ fontSize: '14px', color: '#1d1d1f', lineHeight: '1.6' }}>
          {comment.content}
        </div>
      </div>
    ))
  )}
  
  {/* 添加评论 */}
  <div style={{ marginTop: '16px' }}>
    <textarea
      value={newComment}
      onChange={(e) => setNewComment(e.target.value)}
      placeholder="写下你的想法或补充信息..."
      style={{
        width: '100%',
        minHeight: '80px',
        padding: '12px',
        fontSize: '14px',
        border: '2px solid rgba(0, 0, 0, 0.1)',
        borderRadius: '8px',
        resize: 'vertical',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
    <button
      onClick={handleAddComment}
      disabled={!newComment.trim()}
      style={{
        marginTop: '8px',
        padding: '8px 16px',
        background: !newComment.trim() ? 'rgba(134, 134, 134, 0.3)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: !newComment.trim() ? 'not-allowed' : 'pointer',
        opacity: !newComment.trim() ? 0.6 : 1,
      }}
    >
      发送评论
    </button>
  </div>
</div>
```

---

## 📝 API 使用示例

### 管理员添加评论
```bash
curl -X POST http://localhost:4000/api/feedback/feedback-id/comments \
  -H "Content-Type: application/json" \
  -d '{
    "content": "我们正在调查这个问题",
    "commenterType": "admin"
  }'
```

### 用户添加评论
```bash
curl -X POST http://localhost:4000/api/feedback/feedback-id/comments \
  -H "Content-Type: application/json" \
  -d '{
    "content": "请问处理进度如何？",
    "commenterType": "user"
  }'
```

### 获取评论
```bash
curl http://localhost:4000/api/feedback/feedback-id/comments
```

---

## 🎯 下一步

由于管理后台页面代码已经很长，建议：

1. **保持当前状态** - 后端 API 已经完成，可以使用了
2. **逐步集成** - 可以在需要时再集成前端评论功能
3. **优先级** - 评论功能是增值功能，核心的状态管理已经完成

---

**评论功能的 API 已经完全可用，随时可以集成到前端！** 🚀

有任何问题随时找我！🦞
