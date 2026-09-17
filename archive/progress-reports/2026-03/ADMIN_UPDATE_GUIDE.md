# 管理后台更新指南 - 添加评论和完整状态更新功能

**目标**: 在管理后台添加评论功能和完整的状态更新界面（与用户端对齐）

---

## 📋 需要添加的功能

### 1. 状态配置和筛选
- 状态配置对象（待处理、持续跟进、已解决、暂不解决）
- 状态筛选按钮

### 2. 反馈卡片显示
- 状态标签显示
- 解决方案显示

### 3. 反馈详情页面
- 完整的状态更新界面（3个按钮：持续跟进、已解决、暂不解决）
- 解决方案输入框
- 解决方案显示
- 评论功能（查看/添加）

---

## 🔧 实现步骤

### 步骤 1: 添加状态配置

在 `AdminPage` 组件开头，状态变量后面添加：

```typescript
const statusConfig = {
  pending: { label: '待处理', icon: '⏰', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
  in_progress: { label: '持续跟进', icon: '🔄', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
  resolved: { label: '已解决', icon: '✅', color: '#34c759', bg: 'rgba(52, 199, 89, 0.1)' },
  no_solution: { label: '暂不解决', icon: '⚠️', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.1)' },
}
```

### 步骤 2: 添加评论相关状态

在状态变量部分添加：

```typescript
const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null)
const [feedbackComments, setFeedbackComments] = useState<any[]>([])
const [newComment, setNewComment] = useState('')
```

### 步骤 3: 添加评论相关函数

在 `handleExportData` 函数后面添加：

```typescript
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
```

### 步骤 4: 修改状态更新函数

将 `handleStatusUpdate` 函数改为：

```typescript
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
    } else {
      alert(data.error || '更新失败')
    }
  } catch (error) {
    console.error('更新状态失败:', error)
    alert('更新失败')
  }
}
```

### 步骤 5: 修改反馈卡片显示状态标签

找到反馈卡片的渲染部分（`filteredFeedbacks.map`），修改状态标签显示：

将：
```tsx
<span style={{
  fontSize: '12px',
  padding: '4px 8px',
  borderRadius: '4px',
  background: feedback.status === 'pending' ? '#fff3cd' : '#34c759',
  color: feedback.status === 'pending' ? '#856404' : '#fff',
}}>
  {feedback.status === 'pending' ? '待处理' : '已完成'}
</span>
```

改为：
```tsx
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
```

### 步骤 6: 完全重写反馈详情页面

将 `{selectedFeedback && !selectedFeedback.logs && (` 开始的整个详情页面替换为：

```tsx
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
    <StatusUpdateForm feedback={selectedFeedback} onUpdate={handleStatusUpdate} />

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
```

### 步骤 7: 添加状态更新表单组件

在组件内部，`handleAddComment` 函数后面添加：

```typescript
// 状态更新表单组件
const StatusUpdateForm = ({ feedback, onUpdate }: { feedback: any; onUpdate: (id: string, status: string, solution?: string) => void }) => {
  const [solution, setSolution] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  const handleSubmit = (status: string) => {
    if ((status === 'resolved' || status === 'no_solution') && (!solution || solution.trim().length < 10)) {
      alert('标记为已解决或暂不解决时，解决方案必须至少 10 个字符')
      return
    }
    onUpdate(feedback.id, status, status !== 'pending' ? solution : undefined)
  }

  return (
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
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
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
        <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '12px' }}>
          {solution.length}/1000 字符
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleSubmit('in_progress')}
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
            onClick={() => handleSubmit('resolved')}
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
            onClick={() => handleSubmit('no_solution')}
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
  )
}
```

---

## ✅ 完成检查清单

- [ ] 状态配置对象已添加
- [ ] 评论相关状态变量已添加
- [ ] 评论相关函数已添加
- [ ] 状态更新函数已修改
- [ ] 反馈卡片状态标签已更新
- [ ] 反馈详情页面已完全重写
- [ ] 状态更新表单组件已添加
- [ ] 评论功能已集成

---

**修改完成后，运行 `npm run build` 检查是否有错误，然后重启前端服务！**
