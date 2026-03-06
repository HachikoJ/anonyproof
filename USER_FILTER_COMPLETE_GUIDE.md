# 用户端筛选功能和数据看板 - 完整实现指南

**目标**: 为用户端"我的反馈"页面添加筛选功能和数据看板

**需要添加的功能**:
1. ✅ 类型筛选（建议/投诉/举报）
2. ✅ 状态筛选（待处理/持续跟进/已解决/暂不解决）
3. ✅ 数据看板（统计卡片）
4. ✅ 状态标记显示

---

## 📋 实现步骤

### 步骤 1: 添加筛选状态变量

在 `HomePage` 组件中，找到状态变量声明部分（大约在第 10-20 行），在 `[myFeedbacks, setMyFeedbacks]` 后面添加：

```typescript
// 筛选相关状态
const [filterCategory, setFilterCategory] = useState<string>('all')
const [filterStatus, setFilterStatus] = useState<string>('all')
```

### 步骤 2: 添加状态配置对象

在 `categories` 数组后面（大约在第 40 行），添加状态配置：

```typescript
const statusConfig = {
  pending: { label: '待处理', icon: '⏰', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
  in_progress: { label: '持续跟进', icon: '🔄', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.1)' },
  resolved: { label: '已解决', icon: '✅', color: '#34c759', bg: 'rgba(52, 199, 89, 0.1)' },
  no_solution: { label: '暂不解决', icon: '⚠️', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.1)' },
}
```

### 步骤 3: 添加筛选和统计逻辑

在 `categories` 数组后面（大约在第 40 行），添加筛选和计算逻辑：

```typescript
// 计算统计数据
const statsData = myFeedbacks.reduce((acc, feedback) => {
  acc.total++
  acc[feedback.category] = (acc[feedback.category] || 0) + 1
  acc[feedback.status] = (acc[feedback.status] || 0) + 1
  return acc
}, { total: 0, suggestion: 0, complaint: 0, report: 0, pending: 0, in_progress: 0, resolved: 0, no_solution: 0 })

// 筛选后的反馈列表
const filteredFeedbacks = myFeedbacks.filter((feedback) => {
  const categoryMatch = filterCategory === 'all' || feedback.category === filterCategory
  const statusMatch = filterStatus === 'all' || feedback.status === filterStatus
  return categoryMatch && statusMatch
})
```

### 步骤 4: 修改"我的反馈"页面 - 添加数据看板

找到 `// 我的反馈` 部分（`step === 5`，大约在第 670 行），在 `return` 语句的开始处修改。

将：
```tsx
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
          // ... 省略鼠标事件
        >
          ← 返回首页
        </button>

        <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#1d1d1f', marginBottom: '28px', textAlign: 'center' }}>
          我的反馈
        </h2>
```

改为：
```tsx
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

        <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#1d1d1f', marginBottom: '28px', textAlign: 'center' }}>
          我的反馈
        </h2>

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
                  全部
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
                    {cat.icon} {cat.name}
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
                {Object.entries(statusConfig).map(([key, config]) => (
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
                    {config.icon} {config.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
```

### 步骤 5: 添加状态标签显示

在反馈卡片的标题部分（找到 `{feedback.category === 'suggestion' ? '💡' : ...}` 这一行），修改为：

```tsx
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
```

### 步骤 6: 显示解决方案/处理意见

在 `{feedback.original_content && ...}` 块后面、加密信息前面，添加：

```tsx
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
```

### 步骤 7: 修改反馈列表渲染

将 `{myFeedbacks.map((feedback) => (` 改为：

```tsx
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
```

---

## ✅ 完成检查清单

完成修改后，确认以下功能已实现：

- [ ] 筛选状态变量已添加
- [ ] 状态配置对象已添加
- [ ] 统计数据计算逻辑已添加
- [ ] 筛选逻辑已添加
- [ ] 数据看板（4个统计卡片）已显示
- [ ] 类型筛选按钮已显示
- [ ] 状态筛选按钮已显示
- [ ] 反馈卡片显示状态标签
- [ ] 反馈卡片显示解决方案/处理意见
- [ ] 空状态提示已优化
- [ ] 清除筛选按钮已添加

---

## 🎨 效果预览

### 数据看板
```
┌─────────┬─────────┬─────────┬─────────┐
│ 全部反馈 │ 处理中  │ 已解决  │ 暂不解决│
│   12    │   5     │   6     │   1     │
└─────────┴─────────┴─────────┴─────────┘
```

### 筛选按钮
```
分类筛选: [全部] [💡 建议] [⚠️ 投诉] [🔔 举报]
状态筛选: [全部] [⏰ 待处理] [🔄 持续跟进] [✅ 已解决] [⚠️ 暂不解决]
```

### 反馈卡片
```
┌─────────────────────────────────────────┐
│ 💡 建议    [✅ 已解决]        2026-03-05 │
│                                         │
│ ┌───────────────────────────────────┐  │
│ │ 提交内容：                        │  │
│ │ 这是用户提交的建议内容...         │  │
│ └───────────────────────────────────┘  │
│                                         │
│ ┌───────────────────────────────────┐  │
│ │ ✅ 解决方案                       │  │
│ │ 管理员已经解决了这个问题...       │  │
│ │ 更新时间: 2026-03-05 10:00:00     │  │
│ └───────────────────────────────────┘  │
│                                         │
│ [💬 查看/添加评论]                      │
│                                         │
│ ✓ 已加密存储 · ID: 12345678...          │
└─────────────────────────────────────────┘
```

---

**修改完成后，运行 `npm run build` 检查是否有错误，然后重启服务！**

有任何问题随时找我！🦞
