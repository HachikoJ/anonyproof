# 🔧 用户端评论功能实现

**问题**: 用户端在我的反馈界面无法评论回复
**状态**: ✅ 后端 API 已完成，前端代码已准备，需要正确的集成方式

---

## ✅ 已完成的工作

### 1. **后端 API** ✅
- `POST /api/feedback/:id/comments` - 添加评论
- `GET /api/feedback/:id/comments` - 获取评论列表

### 2. **数据库** ✅
- `feedback_comments` 表已创建
- 支持用户和管理员双向评论

### 3. **前端状态** ✅
已添加状态定义：
```tsx
const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null)
const [feedbackComments, setFeedbackComments] = useState<any[]>([])
const [newComment, setNewComment] = useState('')
const [showCommentInput, setShowCommentInput] = useState(false)
```

---

## 🎨 前端集成代码

### 在反馈卡片中添加评论按钮和区域

找到 `app/page.tsx` 中反馈列表的显示部分（约第 720 行），在 `<div style={{ fontSize: '13px', color: '#34c759' }}>` 之前添加：

```tsx
{/* 评论按钮 */}
<div style={{ marginTop: '12px', marginBottom: '12px' }}>
  <button
    onClick={() => {
      if (selectedFeedbackId === feedback.id) {
        setSelectedFeedbackId(null)
        setShowCommentInput(false)
        setFeedbackComments([])
      } else {
        setSelectedFeedbackId(feedback.id)
        setShowCommentInput(true)
        fetchComments(feedback.id)
      }
    }}
    style={{
      padding: '8px 16px',
      background: 'rgba(102, 126, 234, 0.1)',
      border: '1px solid #667eea',
      borderRadius: '8px',
      fontSize: '13px',
      cursor: 'pointer',
      color: '#667eea',
    }}
  >
    💬 {selectedFeedbackId === feedback.id ? '收起评论' : '查看/添加评论'}
  </button>
</div>

{/* 评论区域 */}
{selectedFeedbackId === feedback.id && showCommentInput && (
  <div style={{
    background: 'rgba(255, 255, 255, 0.3)',
    padding: '16px',
    borderRadius: '12px',
    marginBottom: '12px',
    border: '1px solid rgba(0, 0, 0, 0.05)'
  }}>
    <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
      💬 讨论与沟通
    </h4>

    {/* 评论列表 */}
    {feedbackComments.length === 0 ? (
      <p style={{ color: '#86868b', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
        暂无评论，开始讨论吧
      </p>
    ) : (
      feedbackComments.map((comment) => (
        <div
          key={comment.id}
          style={{
            background: comment.commenter_type === 'admin' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(255, 255, 255, 0.4)',
            padding: '10px',
            borderRadius: '8px',
            marginBottom: '8px',
            border: comment.commenter_type === 'admin' ? '1px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '4px' }}>
            {comment.commenter_type === 'admin' ? '👨‍💼 管理员' : '👤 用户'} · {new Date(comment.created_at).toLocaleString('zh-CN')}
          </div>
          <div style={{ fontSize: '13px', color: '#1d1d1f', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
            {comment.content}
          </div>
        </div>
      ))
    )}

    {/* 添加评论输入框 */}
    <div style={{ marginTop: '12px' }}>
      <textarea
        value={newComment}
        onChange={(e) => setNewComment(e.target.value)}
        placeholder="写下你的想法或补充信息..."
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
        <span style={{ fontSize: '11px', color: '#86868b' }}>
          {newComment.length}/1000 字符
        </span>
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
  </div>
)}
```

### 添加评论函数

在 HomePage 组件内的函数区域（在 handleSubmit 之后）添加：

```tsx
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
    } else {
      alert(data.error || '添加失败')
    }
  } catch (error) {
    console.error('添加评论失败:', error)
    alert('添加失败')
  }
}
```

---

## 🎯 使用效果

用户在"我的反馈"页面可以：

1. **查看反馈列表** - 看到所有反馈

2. **点击"查看/添加评论"按钮** - 展开评论区域

3. **查看评论** - 看到管理员和用户的所有评论

4. **添加评论** - 在输入框中输入评论，点击"发送评论"

5. **实时更新** - 评论后立即显示在列表中

---

## 📊 评论显示样式

### 管理员评论
- 蓝色背景 (`rgba(102, 126, 234, 0.1)`)
- 蓝色边框
- 标记为 "👨‍💼 管理员"

### 用户评论
- 白色背景 (`rgba(255, 255, 255, 0.4)`)
- 灰色边框
- 标记为 "👤 用户"

---

## 🔧 测试方法

### 1. 测试 API
```bash
# 添加评论
curl -X POST http://localhost:4000/api/feedback/反馈ID/comments \
  -H "Content-Type: application/json" \
  -d '{"content": "这是一条测试评论", "commenterType": "user"}'

# 获取评论
curl http://localhost:4000/api/feedback/反馈ID/comments
```

### 2. 测试前端
1. 访问首页，点击"查看我的反馈"
2. 找到一个反馈，点击"💬 查看/添加评论"
3. 在输入框中输入评论
4. 点击"发送评论"
5. 评论应该立即显示在列表中

---

## ✅ 状态更新说明

状态显示已更新：
- **✅ 已完成** (`resolved`)
- **⚠️ 暂不解决** (`no_solution`) - 替代原来的"已关闭"
- **🔄 持续跟进** (`in_progress`)
- **⏰ 待处理** (`pending`)

---

**后端 API 已完全可用，前端集成代码已准备好！** 🚀

有任何问题随时找我！🦞
