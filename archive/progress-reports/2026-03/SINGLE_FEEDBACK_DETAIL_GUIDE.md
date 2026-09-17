# 单条反馈详情页面 - 设计文档

**目标**: 用户端点击通知后，直接显示该反馈的详情（而非显示全部反馈列表）

---

## 🎯 设计方案

### 当前流程

```
1. 用户点击通知
   ↓
2. 跳转到 step 5（我的反馈列表）
   ↓
3. 用户需要从列表中找到对应的反馈
   ↓
4. 再次点击才能查看详情
```

### 优化后的流程

```
1. 用户点击通知
   ↓
2. 直接跳转到 step 6（单条反馈详情）
   ↓
3. 直接查看该反馈的详情和评论
   ↓
4. 可以直接回复，无需查找
```

---

## 📋 需要添加的内容

### 1. 新增状态变量（已完成）

```typescript
// 单条反馈详情相关状态
const [singleFeedback, setSingleFeedback] = useState<any>(null)
const [singleFeedbackComments, setSingleFeedbackComments] = useState<any[]>([])
const [singleFeedbackNewComment, setSingleFeedbackNewComment] = useState('')
```

### 2. 新增函数（已完成）

```typescript
// 获取单条反馈的评论
const fetchSingleFeedbackComments = async (feedbackId: string) => { ... }

// 添加单条反馈的评论
const handleSingleFeedbackAddComment = async () => { ... }
```

### 3. 修改通知跳转逻辑（已完成）

```typescript
// 点击通知时
onClick={() => {
  markAsRead(notif.id)
  const feedback = myFeedbacks.find(f => f.id === notif.feedback_id)
  if (feedback) {
    setSingleFeedback(feedback)
    fetchSingleFeedbackComments(notif.feedback_id)
    setShowNotificationPanel(false)
    setStep(6)  // 跳转到单条反馈详情 ✅
  }
}}
```

### 4. 添加 step === 6 渲染（待添加）

需要在 `return null` 之前添加：

```typescript
// 单条反馈详情
if (step === 6) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', paddingTop: '40px' }}>
        <button
          onClick={() => {
            setStep(5)  // 返回反馈列表
            setSingleFeedback(null)
            setSingleFeedbackComments([])
            setSingleFeedbackNewComment('')
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
```

---

## ✅ 完成检查清单

- [x] 新增状态变量
- [x] 新增函数
- [x] 修改通知跳转逻辑
- [ ] 添加 step === 6 渲染

---

**由于代码较长，建议手动添加 step === 6 的渲染逻辑。**

我已准备好完整的代码，准备好继续了吗？🦞
