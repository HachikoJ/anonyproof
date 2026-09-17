#!/bin/bash
# 最终部署脚本

echo "正在重新构建和启动..."

cd /root/.openclaw/workspace/anonyproof

# 1. 重新构建
echo "1. 重新构建..."
npm run build

# 2. 删除旧进程
pm2 delete anonyproof 2>/dev/null

# 3. 启动服务
echo "2. 启动服务..."
pm2 start npm --name anonyproof --start

# 等待启动
echo "3. 等待启动..."
sleep 10

# 4. 检查状态
pm2 list | grep anonyproof

# 5. 测试
echo ""
echo "测试服务..."
curl -I http://localhost:3000

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "🎉 访问地址："
echo "  http://www.deline.top/anonyproof"
echo "  http://www.deline.top"
echo ""
echo "📊 PM2 管理："
echo "  pm2 logs anonyproof"
echo "  pm2 reload anonyproof"
echo ""
