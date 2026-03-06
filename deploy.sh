#!/bin/bash
# 匿证项目部署脚本

echo "=========================================="
echo "部署进度："
echo "=========================================="

# 1. 检查构建
echo "1. 检查构建产物..."
if [ -d ".next" ]; then
    echo "✅ 构建目录存在"
else
    echo "❌ 构建目录不存在，重新构建..."
    npm run build
fi

# 2. 启动 PM2
echo "2. 启动 PM2 服务..."
pm2 delete anonyproof 2>/dev/null
pm2 start npm --name anonyproof -- -- 3000

# 等待服务启动
echo "3. 等待服务启动..."
sleep 5

# 3. 测试服务
echo "4. 测试服务..."
curl -I http://localhost:3000

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "访问地址："
echo "  - 外网: http://www.deline.top/anonyproof"
echo "  - 内网: http://localhost:3000"
echo ""
echo "PM2 管理："
echo "  pm2 status"
echo "  pm2 logs anonyproof"
echo "  pm2 reload anonyproof"
echo ""
