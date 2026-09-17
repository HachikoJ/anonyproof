#!/bin/bash
# 匿证项目正确部署脚本

echo "=========================================="
echo "部署进度："
echo "=========================================="

# 1. 删除旧进程
echo "1. 删除旧的 PM2 进程..."
pm2 delete anonyproof 2>/dev/null

# 2. 启动服务（正确方式）
echo "2. 启动开发服务器..."
cd /root/.openclaw/workspace/anonyproof

# 先删除 .next 目录重新构建
rm -rf .next

# 重新构建
echo "3. 重新构建..."
npm run build

# 启动 PM2（不用 -- 3000）
echo "4. 启动 PM2..."
pm2 start npm --name anonyproof -- --start

# 等待启动
echo "5. 等待服务启动..."
sleep 8

# 测试
echo "6. 测试服务..."
curl -I http://localhost:3000

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "访问地址："
echo "  - 内网: http://localhost:3000"
echo "  - 外网: http://www.deline.top/anonyproof"
echo ""
echo "PM2 管理："
echo "  pm2 status"
echo "  pm2 logs anonyproof"
echo "  pm2 reload anonyproof"
echo ""
