# 部署说明

## 当前状态

✅ 已完成：
- Next.js 项目创建
- 代码已编写
- 首页界面完成（极简科技风）
- 构建成功

⚠️ 遇到问题：
- Nginx 配置冲突
- 500 内部错误

## 临时解决方案

使用 PM2 启动开发服务器：
```bash
cd /root/.openclaw/workspace/anonyproof
pm2 start npm --name anonyproof -- dev
```

端口：3000
访问：http://www.deline.top:3000

## 下一步

1. 清理 Nginx 配置
2. 使用 PM2 启动服务
3. 或使用域名：anonyproof.deline.top
