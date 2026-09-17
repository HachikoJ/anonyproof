# 📎 附件功能完整实现指南 - 本地存储方案

## ✅ 已完成的基础设施

1. ✅ 后端API：`/api/upload-local` - 本地文件上传
2. ✅ 数据库字段：
   - `feedbacks.solution_attachment_url` - 解决方案附件
   - `feedback_comments.attachment_url` - 评论附件
3. ✅ 前端组件：`LocalFileUpload.tsx` - 文件上传组件
4. ✅ 存储目录：`/public/uploads/attachments/`

## 📝 用户端实现步骤

### 1. 导入组件（文件开头）

```tsx
import LocalFileUpload from './components/LocalFileUpload'
```

### 2. 添加状态变量

在状态声明区域添加：
```tsx
// 评论附件状态
const [commentAttachmentUrl, setCommentAttachmentUrl] = useState<string>('')
```

### 3. 修改评论提交函数

如果已有评论功能，在提交时添加附件URL：

```tsx
const handleSubmitComment = async () => {
  // ... 验证代码 ...

  const res = await fetch('/anonyproof/api/feedback/' + feedbackId + '/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: commentText,
      commenterType: 'user',
      attachmentUrl: commentAttachmentUrl  // 添加这一行
    }),
  })
  // ... 处理响应 ...

  // 成功后清空附件
  setCommentAttachmentUrl('')
}
```

### 4. 添加文件上传UI

在评论输入框后、发送按钮前添加：

```tsx
{/* 文件上传区域 */}
{!commentAttachmentUrl && (
  <div style={{ marginTop: '12px' }}>
    <LocalFileUpload
      onUploadComplete={(url) => setCommentAttachmentUrl(url)}
      maxSize={10}
    />
  </div>
)}

{/* 已上传的附件显示 */}
{commentAttachmentUrl && (
  <div style={{
    marginTop: '12px',
    padding: '8px',
    background: 'rgba(102, 126, 234, 0.1)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }}>
    {/* 图片附件显示缩略图 */}
    {commentAttachmentUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
      <img
        src={commentAttachmentUrl}
        alt="附件"
        style={{ maxWidth: '60px', maxHeight: '60px', borderRadius: '4px' }}
      />
    ) : (
      <div style={{ fontSize: '24px' }}>📎</div>
    )}
    <span style={{ flex: 1, fontSize: '13px', color: '#1d1d1f' }}>
      {commentAttachmentUrl.split('/').pop()}
    </span>
    <button
      onClick={() => setCommentAttachmentUrl('')}
      style={{
        padding: '4px 8px',
        background: 'rgba(255, 59, 48, 0.1)',
        color: '#ff3b30',
        border: '1px solid #ff3b30',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px'
      }}
    >
      删除
    </button>
  </div>
)}
```

### 5. 显示评论中的附件

在评论列表渲染时，检查并显示附件：

```tsx
{/* 评论附件 */}
{comment.attachment_url && (
  <div style={{ marginTop: '8px' }}>
    {comment.attachment_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
      <img
        src={comment.attachment_url}
        alt="评论附件"
        style={{
          maxWidth: '100%',
          maxHeight: '200px',
          borderRadius: '8px',
          cursor: 'pointer',
          border: '1px solid rgba(0, 0, 0, 0.1)'
        }}
        onClick={() => window.open(comment.attachment_url, '_blank')}
      />
    ) : (
      <a
        href={comment.attachment_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'rgba(102, 126, 234, 0.1)',
          borderRadius: '6px',
          color: '#667eea',
          textDecoration: 'none'
        }}
      >
        📎 {comment.attachment_url.split('/').pop()}
      </a>
    )}
  </div>
)}
```

## 📝 管理后台实现步骤

### 1. 解决方案附件（状态更新时）

在 `app/foorpynona/page.tsx` 中：

```tsx
// 添加状态
const [solutionAttachmentUrl, setSolutionAttachmentUrl] = useState<string>('')

// 在解决方案输入框后添加文件上传
{!solutionAttachmentUrl && (
  <div style={{ marginTop: '12px' }}>
    <LocalFileUpload
      onUploadComplete={(url) => setSolutionAttachmentUrl(url)}
      maxSize={10}
    />
  </div>
)}

// 已上传附件显示（同用户端）
{solutionAttachmentUrl && (
  <div style={{ marginTop: '12px', padding: '8px', ... }}>
    {/* 同用户端的显示代码 */}
  </div>
)}

// 提交时包含附件URL
fetch('/anonyproof/api/admin/feedback/' + feedbackId + '/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: newStatus,
    solution: solutionText,
    attachmentUrl: solutionAttachmentUrl  // 添加附件URL
  })
})
```

### 2. 管理员评论附件

与用户端类似，添加 `adminCommentAttachmentUrl` 状态和相关UI。

## 🗄️ 后端API修改

### 更新评论API保存附件URL

在 `server/index.ts` 中的评论API：

```typescript
app.post('/api/feedback/:id/comments', (req, res) => {
  const { content, commenterType, attachmentUrl } = req.body  // 添加 attachmentUrl

  // ... 验证代码 ...

  // 修改 INSERT 语句
  const stmt = db.prepare(`
    INSERT INTO feedback_comments (feedback_id, commenter_type, content, created_at, admin_ip, attachment_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(id, commenterType, content.trim(), Date.now(), adminIp || null, attachmentUrl || null)
  // ...
})
```

### 更新状态更新API保存附件URL

```typescript
app.post('/api/admin/feedback/:id/status', (req, res) => {
  const { status, solution, attachmentUrl } = req.body  // 添加 attachmentUrl

  // 更新时包含附件URL
  const stmt = db.prepare(`
    UPDATE feedbacks
    SET status = ?, solution = ?, solution_updated_at = ?, solution_admin_ip = ?, solution_attachment_url = ?
    WHERE id = ?
  `)

  stmt.run(status, solution, Date.now(), ip, attachmentUrl || null, id)
  // ...
})
```

## 📊 数据库字段使用

### feedbacks 表
- `solution_attachment_url` - 存储解决方案的附件URL

### feedback_comments 表
- `attachment_url` - 存储评论的附件URL

## 🎯 文件URL格式

上传后的文件URL格式：
```
/uploads/attachments/1712345678900-abc123def456.jpg
```

## 🚀 测试步骤

1. 启动服务
2. 在用户端提交反馈并添加评论
3. 上传图片附件
4. 检查 `/public/uploads/attachments/` 目录
5. 验证附件是否正确显示
6. 在管理后台测试解决方案附件

## ⚠️ 注意事项

1. **文件大小限制**：默认最大 10MB
2. **支持格式**：图片（jpg, png, gif, webp）、PDF
3. **存储位置**：服务器本地 `/public/uploads/attachments/`
4. **定期清理**：建议定期清理旧附件
5. **备份**：附件需要单独备份

## 🔄 后续优化建议

1. 添加文件类型白名单验证
2. 添加文件病毒扫描
3. 实现附件压缩
4. 添加附件过期自动清理
5. 实现附件CDN加速

---

**完成时间估计**：
- 用户端：15分钟
- 管理后台：15分钟
- 后端API：10分钟
- 测试：10分钟

**总计**：约50分钟

需要我帮您实现哪个部分？🦞
