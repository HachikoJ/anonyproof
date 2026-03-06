# 部署指南

本文档介绍如何将 AnonyProof 部署到生产环境。

## 📋 部署前准备

### 系统要求

- **操作系统**: Linux (Ubuntu 20.04+, CentOS 7+, Debian 10+)
- **Node.js**: >= 18.0.0
- **内存**: >= 1GB
- **磁盘**: >= 10GB
- **域名**: 已注册域名（可选）

### 服务器初始化

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
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

**必须修改的配置**:
```env
# 修改为强密码（至少16位，包含大小写字母、数字、特殊字符）
ADMIN_PASSWORD=your_strong_password_here

# API Token（生产环境必须修改）
API_TOKEN=your_api_token_here
```

### 4. 构建前端

```bash
npm run build
```

### 5. 启动服务

```bash
# 使用 PM2 启动后端
pm2 start server/index.ts --name anonyproof-backend --interpreter tsx

# 使用 PM2 启动前端
pm2 start npm --name anonyproof-frontend -- start

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

    # 匿证 API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
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
FROM node:18-alpine

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
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
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

```bash
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
