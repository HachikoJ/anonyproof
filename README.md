# 🔒 AnonyProof - 匿证

<div align="center">

**完全匿名 · 端到端加密 · 防偷看机制**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black)](https://nextjs.org/)
[![Node](https://img.shields.io/badge/Node-%3E=18.0.0-green)](https://nodejs.org/)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [技术架构](#%EF%B8%8F-技术架构) • [部署指南](#-部署指南) • [贡献指南](#-贡献指南)

</div>

---

## ✨ 项目简介

**AnonyProof（匿证）** 是一个现代化的匿名反馈平台，旨在为用户提供一个安全、私密的意见反馈渠道。采用端到端加密技术，确保用户的反馈内容在传输和存储过程中完全保密，即使是服务器管理员也无法查看真实内容。

### 🎯 核心价值

- **🔒 完全匿名** - 无需注册登录，基于设备 ID 识别，彻底保护用户身份
- **🛡️ 端到端加密** - 采用 AES-256 加密算法，客户端加密，服务器无法解密
- **👁️ 防偷看机制** - 所有管理员操作都被记录，确保透明可追溯
- **💬 实时沟通** - 内置评论系统，支持用户与管理员双向交流
- **🔔 智能通知** - 实时通知系统，及时跟进反馈进度

---

## 🌟 功能特性

### 用户端

- ✅ **匿名反馈提交** - 支持建议/投诉/举报三种类型
- ✅ **我的反馈管理** - 查看所有历史反馈及处理状态
- ✅ **智能筛选搜索** - 按分类/状态筛选，关键词搜索
- ✅ **评论互动** - 与管理员实时沟通，补充说明
- ✅ **实时通知** - 新消息即时提醒
- ✅ **响应式设计** - 完美适配桌面端和移动端

### 管理端

- ✅ **安全管理** - 密码保护的管理后台
- ✅ **反馈管理** - 查看所有反馈，批量处理
- ✅ **状态更新** - 待处理/持续跟进/已解决/暂不解决
- ✅ **解决方案** - 记录处理意见和解决方案
- ✅ **操作日志** - 完整记录所有管理操作，防偷看
- ✅ **数据导出** - 支持 CSV 格式导出
- ✅ **统计面板** - 实时查看反馈统计数据

---

## 📸 界面预览

### 用户端主页
> 简洁大方的反馈提交界面，支持三种反馈类型

### 用户端 - 我的反馈
> 清晰展示所有反馈，支持筛选和搜索

### 管理端后台
> 专业的管理界面，高效处理反馈

### 通知中心
> 实时通知，不错过任何重要消息

---

## 🏗️ 技术架构

### 前端技术栈

```
Next.js 14.2.5          - React 框架
React 18.3.1            - UI 库
TypeScript 5.0          - 类型安全
Tailwind CSS            - 样式框架
Crypto-JS               - 客户端加密
```

### 后端技术栈

```
Express 5.2.1           - Web 框架
Node.js 22+             - 运行环境
SQLite                  - 数据库
better-sqlite3          - SQLite 驱动
UUID                    - 唯一标识生成
```

### 部署架构

```
Nginx                   - 反向代理
PM2                     - 进程管理
Docker                  - 容器化（可选）
```

### 加密方案

```
AES-256-GCM             - 对称加密算法
随机 IV                 - 初始化向量
Key Derivation          - 密钥派生
```

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- SQLite 3

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/HachikoJ/anonyproof.git
cd anonyproof
```

2. **安装依赖**
```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server && npm install
```

3. **配置环境变量**
```bash
# 创建 .env.local 文件
cp .env.example .env.local

# 编辑配置
nano .env.local
```

```env
# 管理员密码（必须修改）
ADMIN_PASSWORD=your_secure_password_here

# API 密钥（可选）
API_TOKEN=your_api_token_here

# 数据库路径
DATABASE_PATH=./data/anonyproof.db
```

4. **启动开发服务器**
```bash
# 启动后端（端口 4000）
cd server && npm run dev

# 启动前端（端口 3000）
npm run dev
```

5. **访问应用**
- 用户端: http://localhost:3000
- 管理端: http://localhost:3000/foorpynona

---

## 📦 部署指南

### 生产环境部署

1. **构建前端**
```bash
npm run build
```

2. **使用 PM2 启动**
```bash
# 启动后端
pm2 start server/index.ts --name anonyproof-backend --interpreter tsx

# 启动前端
pm2 start npm --name anonyproof-frontend -- start
```

3. **配置 Nginx**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

### Docker 部署

```bash
# 构建镜像
docker build -t anonyproof .

# 运行容器
docker run -d \
  --name anonyproof \
  -p 3000:3000 \
  -p 4000:4000 \
  -v $(pwd)/data:/app/data \
  anonyproof
```

---

## 📁 项目结构

```
anonyproof/
├── app/                      # Next.js 应用目录
│   ├── page.tsx             # 用户端主页
│   ├── foorpynona/          # 管理端
│   ├── hooks/               # 自定义 Hooks
│   ├── components/          # React 组件
│   ├── utils/               # 工具函数
│   └── globals.css          # 全局样式
├── server/                   # Express 后端
│   ├── index.ts             # 入口文件
│   ├── middleware/          # 中间件
│   └── utils/               # 工具函数
├── data/                     # SQLite 数据库
├── public/                   # 静态资源
├── next.config.js           # Next.js 配置
├── package.json             # 前端依赖
├── tsconfig.json            # TypeScript 配置
└── README.md                # 项目说明
```

---

## 🔒 安全性说明

### 加密流程

1. **客户端加密**
   - 用户提交反馈时，使用 AES-256-GCM 加密内容
   - 生成随机 IV（初始化向量）
   - 加密后的内容传输到服务器

2. **服务器存储**
   - 服务器只存储加密后的内容
   - 即使数据库泄露，也无法解密查看原始内容

3. **管理员查看**
   - 管理员只能看到加密内容（base64 编码）
   - 所有查看和操作都被记录到日志

### 防偷看机制

- ✅ 记录所有管理员操作
- ✅ 操作日志不可删除
- ✅ IP 地址和时间戳记录
- ✅ 定期审计日志

---

## 🧪 测试

```bash
# 运行单元测试
npm test

# 运行 E2E 测试
npm run test:e2e

# 生成测试覆盖率报告
npm run test:coverage
```

---

## 📊 性能优化

- ✅ React 18 并发渲染
- ✅ Next.js 自动代码分割
- ✅ 图片懒加载
- ✅ API 响应缓存
- ✅ 数据库查询优化
- ✅ Gzip 压缩

---

## 🗺️ 路线图

### v1.1（计划中）
- [ ] WebSocket 实时通知
- [ ] 图片/文件上传
- [ ] 深色模式
- [ ] 多语言支持

### v1.2（未来）
- [ ] 匿名投票功能
- [ ] 匿名问卷调查
- [ ] 移动端 App
- [ ] 数据可视化仪表板

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 开发规范

- 遵循 ESLint 配置
- 添加单元测试
- 更新相关文档
- 遵循 Conventional Commits 规范

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 👥 作者

**Wilson** - [@HachikoJ](https://github.com/HachikoJ)

---

## 🙏 致谢

- [Next.js](https://nextjs.org/) - React 框架
- [Express](https://expressjs.com/) - Web 框架
- [Crypto-JS](https://cryptojs.gitbook.io/) - 加密库
- [Better SQLite3](https://github.com/WiseLibs/better-sqlite3) - SQLite 驱动

---

## 📞 联系方式

- 项目主页: [https://github.com/HachikoJ/anonyproof](https://github.com/HachikoJ/anonyproof)
- 问题反馈: [GitHub Issues](https://github.com/HachikoJ/anonyproof/issues)
- 邮箱: your-email@example.com

---

## ⭐ Star History

如果这个项目对你有帮助，请给个 Star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=HachikoJ/anonyproof&type=Date)](https://star-history.com/#HachikoJ/anonyproof&Date)

---

<div align="center">

**Made with ❤️ by Wilson**

[⬆ 返回顶部](#-anonyproof---匿证)

</div>
