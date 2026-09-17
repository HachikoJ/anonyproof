#!/bin/bash
# 快速部署脚本

echo "正在启动匿证项目..."

cd /root/.openclaw/workspace/anonyproof

# 删除旧进程
pm2 delete anonyproof 2>/dev/null

# 启动服务
pm2 start npm --name anonyproof -- --start

echo "服务已启动，等待初始化..."
sleep 8

# 检查状态
pm2 list | grep anonyproof

echo ""
echo "访问地址："
echo "  http://www.deline.top/anonyproof"
echo "  http://localhost:3000"
