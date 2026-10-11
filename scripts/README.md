# 本地脚本

- `start.sh`：从仓库根目录启动前后端开发服务，需要 Node.js 20 或更高版本。

# 运行时与安装预检

前后端安装必须使用同一个目标 Node 版本。当前部署说明使用 Node 22；
现有 Node 20 支持范围保持不变，本次没有修改系统或线上 Node。

```bash
node -v
npm ci
npm --prefix server ci
node scripts/check-runtime.cjs
```

预检会检查两个安装树和 SQLite 原生模块，发现版本或 ABI 不一致时停止，
不会自动安装或改写环境变量。升级运行时后需在目标版本下重新安装；
保留原依赖目录可作为环境回滚点。正式环境还须提供至少 32 字符的
`SESSION_SECRET` 和至少 12 字符的 `ADMIN_PASSWORD`，未配置时后端拒绝启动。
