#!/bin/bash
# 测试 Next.js 服务是否正常运行

echo "正在测试 Next.js 服务..."

# 1. 检查端口占用
echo "1. 检查端口占用..."
netstat -tuln | grep ":3000" | grep LISTEN

echo ""
echo "2. 测试 Next.js 服务..."
curl -I http://localhost:3000

echo ""
echo "3. 检查 PM2 进程..."
pm2 list | grep anonyproof

echo ""
echo "如果没有输出，说明服务正在启动中，请稍等..."
