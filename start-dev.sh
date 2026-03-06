#!/bin/bash
# 快速启动 Next.js 开发服务器

echo "正在启动 Next.js 开发服务器..."

cd /root/.openclaw/workspace/anonyproof

# 删除旧进程
pm2 delete anonyproof 2>/dev/null

# 启动开发服务器（直接使用 npm）
nohup npm run dev > /dev/null 2>&1 &
echo "服务已启动，PID: $!"
echo ""
echo "等待服务启动..."
sleep 10

# 测试
echo "测试服务..."
curl -I http://localhost:3000

echo ""
echo "访问地址："
echo "  - 内网: http://localhost:3000"
echo "  - 外网: http://www.deline.top/anonyproof"
echo ""
echo "PM2 管理："
echo "  pm2 logs anonyproof"
echo "  pm2 reload anonyproof"
echo ""
