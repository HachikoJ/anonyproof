#!/bin/bash
# 最终修复 - 使用备用方案

echo "正在使用备用方案..."

# 1. 停止 PM2 的匿证进程
pm2 delete anonyproof_dev 2>/dev/null

# 2. 先删除旧的配置文件
rm /etc/nginx/conf.d/anonyproof-dev.conf 2>/dev/null

# 3. 创建新的配置
cat > /etc/nginx/conf.d/anonyproof.conf << 'EOF'
server {
    listen 8080;
    server_name anonyproof.deline.top;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# 4. 测试
echo ""
echo "✅ 配置完成！"
echo ""
echo "测试访问："
echo "  - 内网: curl -I http://localhost:8080"
echo "  - 外网: curl -I http://anonyproof.deline.top"
echo ""

# 5. 测试
curl -I http://localhost:8080 2>&1 | head -10
