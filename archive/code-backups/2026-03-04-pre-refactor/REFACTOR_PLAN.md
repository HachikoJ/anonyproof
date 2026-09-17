# AnonyProof 完整重构计划

## 目标
今晚之前完成一个真正可用的匿名反馈平台

## 核心功能
1. **真实反馈提交** - 不再是 alert 弹窗
2. **后端 API** - Node.js + Express
3. **数据库** - SQLite（简单快速）
4. **端到端加密** - 用 Web Crypto API
5. **管理后台** - 查看反馈（带防偷看日志）
6. **真实统计** - 动态数据

## 技术栈
- **前端**: Next.js 14 + TypeScript + Tailwind
- **后端**: Node.js + Express
- **数据库**: SQLite (better-sqlite3)
- **加密**: Web Crypto API (前端) + crypto (后端)
- **部署**: PM2 管理两个服务（前端 3000，后端 4000）

## 目录结构
```
anonyproof/
├── app/                 # Next.js 前端
├── server/              # Express 后端
│   ├── api/
│   ├── db/
│   └── index.ts
├── shared/              # 共享类型
└── data/                # SQLite 数据库文件
```

## 时间线
- 21:55 - 设计数据库和 API
- 22:00 - 搭建后端
- 22:30 - 实现加密逻辑
- 23:00 - 重构前端
- 23:30 - 实现管理后台
- 00:00 - 测试和修复
- 00:30 - 部署配置
- 验收完成

## 数据库设计
```sql
-- 反馈表
CREATE TABLE feedbacks (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  encrypted_content TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'
);

-- 管理员操作日志（防偷看）
CREATE TABLE admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  admin_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```
