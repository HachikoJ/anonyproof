# 部署指南

本文档介绍如何将 AnonyProof 部署到生产环境。功能说明对齐已在本地验收的修复代码，尚未发布；T-02实例硬隔离和T-35唯一配置仍待验收，文档示例不代表当前线上已经应用。

## 📋 部署前准备

### 系统要求

- **操作系统**: Linux (Ubuntu 20.04+, CentOS 7+, Debian 10+)
- **Node.js**: 20 LTS
- **内存**: >= 1GB
- **磁盘**: >= 10GB
- **域名**: 已注册域名（可选）

### 服务器初始化

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2
sudo npm install -g pm2

# 安装 Nginx
sudo apt install -y nginx

# 安装 Git
sudo apt install -y git
```

## 🚀 快速部署

### 1. 克隆代码

```bash
git clone https://github.com/HachikoJ/anonyproof.git
cd anonyproof
```

### 2. 安装依赖

```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server
npm install
cd ..
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env.local

# 编辑配置
nano .env.local
```

**实际鉴权相关配置**（`API_TOKEN`仅保留旧模板兼容占位，不必设置）:
```env
# 演示部署可保持 1，正式上线前必须改为 0
DEMO_MODE=1

# 正式部署时修改为强密码（至少 12 位）
ADMIN_PASSWORD=your_strong_password_here

# 至少 32 位随机字符
SESSION_SECRET=your_random_secret_at_least_32_characters

# 正式实例DEMO_MODE=0时必填：独立配置的32字节Base64内容密钥；演示保持空
# 生成方式：openssl rand -base64 32；不得存入数据库或与数据库同包备份
CONTENT_ENCRYPTION_KEY=

# API_TOKEN 已弃用：服务端不读取，不提供API鉴权，不必设置
API_TOKEN=your_api_token_here

# 经 Nginx 等反向代理部署时启用
TRUST_PROXY=1
```

管理接口依赖管理员HttpOnly Cookie；用户记录、评论和通知依赖用户Cookie及归属校验，或合法管理员的授权范围。健康检查、公开汇总统计和演示配置为公开接口。`API_TOKEN`不参与这些权限判断，也不会限制公开接口；不要将占位值视为已启用的安全措施。

### 演示部署说明

演示模式用于功能展示，管理员默认密码为 `demo12345678`。开启后：

- 服务端会自动写入 7 条示例线索模板（覆盖企业、学校、组织等场景）及评论、通知、访问统计
- 每个浏览器首次访问时会复制一份独立的示例副本，示例记录、未读状态和补充回复跨浏览器互不影响
- 公开演示只允许固定合成案例、固定补充和固定处理说明；后台只看只读模板及当前浏览器自己的沙箱，不能接收自由输入的真实材料或读取其它浏览器记录/原始日志
- 用户端数据由 HttpOnly Cookie 与浏览器安装密钥绑定，恢复码用于换浏览器或清除数据后找回记录
- 登录页会明确显示演示密码和清理提醒
- 需要一份只含演示数据的干净数据库时，把 `DATABASE_PATH` 指向新文件（例如 `./data/anonyproof-demo.db`），首次启动会建库并写入示例数据，原有 `./data/anonyproof.db` 不受影响

**正式实例使用独立库、凭证和内容密钥，关闭演示模式**（不把演示库切换为正式库）：

```env
DEMO_MODE=0
ADMIN_PASSWORD=your_real_strong_password
SESSION_SECRET=your_real_random_secret_at_least_32_characters
CONTENT_ENCRYPTION_KEY=<独立安全配置的32字节Base64密钥>
DATABASE_PATH=/absolute/path/to/formal.db
```

正式实例提供真实管理员流程；公开演示密码不会在正式demo/config中发布。固定模板和沙箱的界面过滤不等于数据库硬隔离，须分别部署对应库，T-02启动角色检查方案仍待具体确认。历史库、备份或演示记录均不按本段自动清除；保留/迁移/销毁范围由T-32及相关保留策略单独确认。

正式服务使用已批准的AES-256-GCM静态加密，授权服务/管理员可读取原文。缺失、错误内容密钥必须失败关闭；密钥遗失无法恢复密文。版本0历史内容仍需T-32另行迁移，不因新写入加密便认为旧库/旧备份安全。新密文产生后，回滚需保留兼容reader和同一独立密钥，关闭正式写入；不得退回旧reader或以写明文作为回滚。

### 4. 构建前端

```bash
npm run build
```

### 5. 启动服务

```bash
# 使用项目内的 PM2 配置启动前后端
npm run pm2:prod

# 保存 PM2 配置
pm2 save
pm2 startup
```

### 6. 配置 Nginx

创建 Nginx 配置文件：

```bash
sudo nano /etc/nginx/sites-available/anonyproof
```

添加以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # 匿证前端
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-ForwardedProto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # /anonyproof/api 由 Next.js 转发到后端，无需额外暴露 4000 端口
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/anonyproof /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. 配置 HTTPS（可选但推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 获取证书
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

## 🐳 Docker 部署

### 创建 Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制代码
COPY . .

# 构建前端
RUN npm run build

# 安装后端依赖
WORKDIR /app/server
RUN npm install

WORKDIR /app

# 暴露端口
EXPOSE 3000 4000

# 启动脚本
CMD ["pm2-runtime", "start", "deploy/pm2/ecosystem.config.js"]
```

### 构建和运行

```bash
# 构建镜像
docker build -t anonyproof:latest .

# 运行容器
docker run -d \
  --name anonyproof \
  -p 3000:3000 \
  -p 4000:4000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env.local:/app/.env.local \
  --restart unless-stopped \
  anonyproof:latest
```

## 📊 监控和维护

### 查看日志

```bash
# PM2 日志
pm2 logs

# 查看特定应用
pm2 logs anonyproof-backend
pm2 logs anonyproof-frontend

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 数据备份

SQLite启用WAL。运行中只复制`.db`可能漏掉已提交的WAL数据；批准备份后使用SQLite在线backup或停写的一致性快照。数据库与内容密钥须分别保存，不把`.env.local`、key或明文导出混入数据库备份包；先在隔离环境用备份与独立相同key验证身份恢复和内容读回，错误/缺key应拒绝。密钥恢复与历史副本处置参见根目录DEPLOY及T-03/T-32。

下面仅示范在线快照命令。路径必须替换为已确认的源和**全新**目标（不要覆盖现有备份）；目标目录应受限，示例路径中不要使用单引号或换行。该命令不会删除源库或历史备份，保留期限/销毁尚待Q-04和逐项资产确认：

```bash
sqlite3 -readonly /absolute/path/to/formal.db ".backup '/absolute/path/to/separate-backup/formal-YYYYMMDD.db'"
```

以下保留为**历史不支持示例，禁止直接复制执行**。它的运行中`cp`和自动七天删除未满足当前一致性/保留审批要求，不是现行备份流程，也未由本轮运行或删除任何资产：

```text
# 创建备份脚本
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/anonyproof"
mkdir -p $BACKUP_DIR

# 备份数据库
cp /root/anonyproof/data/anonyproof.db $BACKUP_DIR/anonyproof_$DATE.db

# 保留最近7天的备份
find $BACKUP_DIR -name "anonyproof_*.db" -mtime +7 -delete
EOF

chmod +x backup.sh

# 添加定时任务（每天凌晨2点备份）
crontab -e
# 添加以下行
0 2 * * * /root/anonyproof/backup.sh
```

### 服务管理

```bash
# 重启服务
pm2 restart all

# 停止服务
pm2 stop all

# 查看状态
pm2 status

# 查看监控
pm2 monit
```

## 🔒 安全建议

1. **修改默认密码**
   - 必须修改管理员密码
   - 使用强密码（16+位，包含大小写、数字、特殊字符）

2. **配置防火墙**
   ```bash
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   ```

3. **启用 Rate Limiting**
   - 已内置速率限制中间件
   - 建议根据实际情况调整限制

4. **定期更新**
   ```bash
   # 更新系统
   sudo apt update && sudo apt upgrade -y
   
   # 更新依赖
   npm update
   cd server && npm update
   ```

5. **数据库权限**
   ```bash
   chmod 600 /root/anonyproof/data/anonyproof.db
   chown root:root /root/anonyproof/data/anonyproof.db
   ```

## 🐛 故障排除

### 前端无法访问

```bash
# 检查服务状态
pm2 status

# 重启前端
pm2 restart anonyproof-frontend

# 查看日志
pm2 logs anonyproof-frontend --lines 50
```

### 后端 API 无响应

```bash
# 检查端口占用
netstat -tlnp | grep 4000

# 重启后端
pm2 restart anonyproof-backend

# 检查数据库
ls -lh data/anonyproof.db
```

### Nginx 502 错误

```bash
# 检查后端是否运行
pm2 status

# 检查 Nginx 配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

## 📈 性能优化

### 启用 Gzip 压缩

在 Nginx 配置中添加：

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript 
           application/x-javascript application/xml+rss 
           application/json application/javascript;
```

### 配置缓存

```nginx
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 📞 获取帮助

- GitHub Issues: [https://github.com/HachikoJ/anonyproof/issues](https://github.com/HachikoJ/anonyproof/issues)
- 文档: [README.md](../README.md)
- 贡献指南: [CONTRIBUTING.md](../CONTRIBUTING.md)

### 限流配置的实际边界（T-31）

`RATE_LIMIT_MAX`已弃用且不生效，不能按旧注释理解为“每15分钟总上限”；启动时有明确警告。当前实际启用的是登录、身份初始化、恢复码、反馈提交和用户补充各自的次数/窗口配置，默认值、单位、来源/身份作用域及失败规则以根目录 [DEPLOY.md 的有效限流配置索引](../DEPLOY.md#有效限流配置索引t-31) 为准，`.env.example`已列出真实字段。所有窗口单位为毫秒；已有单进程限流不等于多跳代理或多实例限流已经验收。
