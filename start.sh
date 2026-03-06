#!/bin/bash

# AnonyProof 启动脚本

echo "🚀 启动 AnonyProof..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js >= 18.0.0"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
fi

if [ ! -d "server/node_modules" ]; then
    echo "📦 安装后端依赖..."
    cd server && npm install && cd ..
fi

# 创建数据目录
mkdir -p data

# 检查环境变量
if [ ! -f ".env.local" ]; then
    echo "⚠️  未找到 .env.local 文件，从示例创建..."
    cp .env.example .env.local
    echo "📝 请编辑 .env.local 文件，设置管理员密码！"
fi

# 启动服务
echo "🔧 启动后端服务..."
cd server
npx tsx index.ts &
BACKEND_PID=$!
cd ..

echo "🔧 启动前端服务..."
npm run dev &
FRONTEND_PID=$!

echo "✅ AnonyProof 已启动！"
echo "   前端: http://localhost:3000"
echo "   后端: http://localhost:4000"
echo ""
echo "按 Ctrl+C 停止服务"

# 等待用户中断
trap "echo '🛑 停止服务...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
