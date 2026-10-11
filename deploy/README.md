# 部署配置

根目录 `DEPLOY.md` 为部署流程入口；`ecosystem.prod.config.js` 是正式 PM2 入口，保持在仓库根目录，避免影响 PM2 自启快照。文档路径不能作为当前线上进程／配置已经核验的证据。

- `pm2/ecosystem.config.js`：本地 PM2 开发配置，由 `npm run pm2:dev` 调用。
- `pm2/legacy/`：早期生产 PM2 配置，其中路径已过期，仅作参考。
- `nginx/anonyproof.deline.top.conf`：唯一受支持的 Nginx 模板，保留 `/anonyproof` basePath；启用前核对入口代理链、证书、回环端口和环境角色。
- `nginx/legacy/`：21 份逐字保留的历史配置，禁止生产 include 或通配复制。原路径／哈希及恢复办法见该目录 README。
- `scripts/legacy/`：早期脚本均假设旧服务器目录 `/root/.openclaw/workspace/anonyproof`。其中 `fix-nginx.sh` 和 `final-fix.sh` 已在副作用之前非零退出，原正文保留供查证。其它旧脚本也不应直接用于生产部署。

本地 Nginx 测试与线上启用分别验收。不会运行 `brew services`、系统 reload 或旧脚本；真实上线需另获授权、保存原生效 vhost 并先完成 `nginx -t`。不要将纯代理测试通过当作真实 Next／API、DELETE、UI 或公网端口关闭的证明。
