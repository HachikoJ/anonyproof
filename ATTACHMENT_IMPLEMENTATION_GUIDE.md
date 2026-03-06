# 📎 附件功能实现指南 - 图床方案

## ✅ 已完成

1. **依赖安装** ✅
   - axios
   - react-dropzone

2. **工具文件** ✅
   - `app/utils/imageUpload.ts` - 图床上传工具
   - `app/components/FileUpload.tsx` - 文件上传组件

3. **环境变量** ✅
   - 添加了图床API配置到 `.env`

## 📋 需要手动完成的前端修改

### 用户端 - 添加附件上传到评论

在 `app/page.tsx` 中修改：

#### 1. 导入组件（文件开头）
```tsx
import FileUpload from './components/FileUpload'
```

#### 2. 添加附件URL状态
在评论状态后添加：
```tsx
const [attachmentUrl, setAttachmentUrl] = useState<string>('')
```

#### 3. 修改发送评论函数
找到 `handleAddComment` 函数，修改为：
```tsx
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
        commenterType: 'user',
        attachmentUrl: attachmentUrl // 添加附件URL
      }),
    })
    const data = await res.json()
    if (data.success) {
      setNewComment('')
      setAttachmentUrl('') // 清空附件
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

#### 4. 在评论输入框后添加文件上传组件
找到发送评论按钮，在输入框和按钮之间添加：
```tsx
{/* 附件上传 */}
{!attachmentUrl && (
  <div style={{ marginTop: '12px' }}>
    <FileUpload
      onUploadComplete={(url) => setAttachmentUrl(url)}
      maxSize={10}
      accept={['image/jpeg', 'image/png', 'image/gif', 'image/webp']}
    />
  </div>
)}

{/* 已上传的附件 */}
{attachmentUrl && (
  <div style={{ marginTop: '12px', padding: '8px', background: 'rgba(102, 126, 234, 0.1)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
    <img src={attachmentUrl} alt="附件" style={{ maxWidth: '60px', maxHeight: '60px', borderRadius: '4px' }} />
    <span style={{ flex: 1, fontSize: '13px' }}>图片已上传</span>
    <button
      onClick={() => setAttachmentUrl('')}
      style={{ padding: '4px 8px', background: 'rgba(255, 59, 48, 0.1)', color: '#ff3b30', border: '1px solid #ff3b30', borderRadius: '4px', cursor: 'pointer' }}
    >
      删除
    </button>
  </div>
)}
```

#### 5. 显示评论中的附件
在评论列表渲染部分，添加附件显示：
```tsx
{/* 附件 */}
{comment.attachment_url && (
  <div style={{ marginTop: '8px' }}>
    <img
      src={comment.attachment_url}
      alt="附件"
      style={{
        maxWidth: '100%',
        maxHeight: '200px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: '1px solid rgba(0, 0, 0, 0.1)'
      }}
      onClick={() => window.open(comment.attachment_url, '_blank')}
    />
  </div>
)}
```

### 管理后台 - 添加附件上传到解决方案和评论

在 `app/foorpynona/page.tsx` 中做类似修改：

1. 导入 `FileUpload` 组件
2. 为解决方案和评论添加 `attachmentUrl` 状态
3. 添加文件上传组件
4. 在提交时包含 `attachmentUrl`
5. 显示已上传的附件

## 🔑 获取图床API密钥

### ImgBB（推荐，免费）
1. 访问：https://api.imgbb.com/
2. 注册账号
3. 获取 API Key
4. 在 `.env` 文件中设置：`NEXT_PUBLIC_IMGBB_KEY=your_api_key`

### Imgur（备选）
1. 访问：https://api.imgur.com/oauth2/addclient
2. 创建应用
3. 获取 Client ID
4. 在 `.env` 文件中设置：`NEXT_PUBLIC_IMGUR_CLIENT_ID=your_client_id`

## 📝 后端数据库更新（已完成）

```sql
-- 反馈表添加解决方案附件URL字段
ALTER TABLE feedbacks ADD COLUMN solution_attachment_url TEXT;

-- 评论表添加附件URL字段
ALTER TABLE feedback_comments ADD COLUMN attachment_url TEXT;
```

## ✨ 功能特性

- 支持拖拽上传
- 支持图片预览
- 最大10MB文件
- 支持格式：JPEG, PNG, GIF, WebP
- 直接上传到图床，不占用服务器空间
- 响应式设计

## 🚀 使用方法

1. **用户端**：在评论时可以上传图片
2. **管理后台**：在添加解决方案或回复评论时可以上传图片
3. **查看**：点击图片可以在新标签页打开查看原图

## ⚠️ 注意事项

1. 需要先注册图床服务获取API密钥
2. 图片存储在第三方图床，不在本地服务器
3. 如果图床服务出现故障，图片可能无法显示
4. 建议使用可靠的图床服务或自建图床

---

**实现优先级**：
1. 先完成用户端评论附件
2. 再完成管理后台解决方案附件
3. 最后完成管理后台评论附件

需要我帮您实现哪个部分？🦞
