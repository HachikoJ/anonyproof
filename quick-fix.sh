#!/bin/bash
# 快速修复匿证项目

echo "正在修复匿证项目..."

# 1. 清理构建目录
rm -rf /root/.openclaw/workspace/anonyproof/.next

# 2. 重新构建（只构建，不启动）
echo "重新构建..."
cd /root/.openclaw/workspace/anonyproof
npm run build > /dev/null 2>&1

# 3. 测试构建结果
if [ -d "/root/.openclaw/workspace/anonyproof/.next" ]; then
    echo "✅ 构建成功"
else
    echo "❌ 构建失败"
    exit 1
fi

# 4. 检查 index.html
if [ -f "/root/.openclaw/workspace/anonyproof/.next/index.html" ]; then
    echo "✅ index.html 已生成"
else
    echo "❌ index.html 未生成"
    exit 1
fi

echo ""
echo "部署说明："
echo "内网测试: curl http://localhost:3000"
echo "外网访问: http://www.deline.top/anonyproof"
echo ""
echo "注意：不影响现有项目（费曼读书、培训）"
