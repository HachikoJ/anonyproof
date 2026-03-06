# 管理后台快速修复指南

由于文件较长，这里提供关键修改点的具体代码。

## 已完成的修改 ✅

1. ✅ 添加状态配置对象
2. ✅ 添加评论相关状态变量
3. ✅ 添加评论相关函数
4. ✅ 修改状态更新函数支持解决方案

## 还需要手动修改的部分

### 修改 1: 反馈卡片状态标签（约第 468 行）

找到这一段：
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

替换为：
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

### 修改 2: 替换整个反馈详情页面（约第 493-567 行）

找到 `  {selectedFeedback && !selectedFeedback.logs && (` 开始的部分，将整个详情页面替换为以下代码（包含状态更新和评论功能）：

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
```

---

## 修改完成后的操作

1. 保存文件
2. 运行 `cd /root/.openclaw/workspace/anonyproof && npm run build`
3. 重启前端服务：`pm2 restart anonyproof-frontend`

## 功能验证

修改完成后，管理后台应该具备以下功能：

1. ✅ 反馈卡片显示正确的状态标签（4种状态）
2. ✅ 反馈详情页面显示解决方案（如果有）
3. ✅ 可以更新状态并填写解决方案
4. ✅ 可以查看和添加评论
5. ✅ 与用户端评论功能互通

---

**提示**：由于文件较长，建议使用代码编辑器（如 VS Code）进行修改，这样可以快速定位和替换代码。
