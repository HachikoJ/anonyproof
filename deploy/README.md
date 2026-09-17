# 部署配置

当前线上部署以根目录的 `DEPLOY.md` 为准；`ecosystem.prod.config.js` 是线上 PM2 入口，保持在本仓库根目录，避免影响 PM2 自启快照。

- `pm2/ecosystem.config.js`：本地 PM2 开发配置，由 `npm run pm2:dev` 调用。
- `pm2/legacy/`：早期生产 PM2 配置，其中路径已过期，仅作参考。
- `nginx/`：域名接入和反向代理的历史配置变体；当前服务器配置位于 `/etc/nginx/conf.d/anonyproof.deline.top.conf`。
- `scripts/legacy/`：早期部署脚本，均假设旧服务器目录 `/root/.openclaw/workspace/anonyproof`，不要直接在生产服务器执行。
