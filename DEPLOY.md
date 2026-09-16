# 腾讯云部署说明

演示站地址：https://anonyproof.deline.top/anonyproof
管理入口：https://anonyproof.deline.top/anonyproof/foorpynona

## 架构

- 域名 `anonyproof.deline.top` 解析到腾讯云服务器 `106.55.13.245`（SSH 用户 `ubuntu`，`sudo` 免密）。
- Nginx 监听 80/443，80 全量跳转 HTTPS；`https://域名/` 会 301 到 `/anonyproof`（前端 `basePath` 固定为 `/anonyproof`）。
- Nginx 把 `/anonyproof/**` 全部反代到 `127.0.0.1:3000`，其中 `/anonyproof/api/*` 由 Next 的 rewrite 再转发到 `127.0.0.1:4000` 的 Express 后端。
- 前端 3000、后端 4000 都只监听回环地址（`BIND_HOST` 默认 `127.0.0.1`），公网只能经 Nginx 访问，端口不对外暴露。

## 服务器路径

| 用途 | 路径 |
| --- | --- |
| 项目目录 | `/home/ubuntu/anonyproof` |
| 环境变量 | `/home/ubuntu/anonyproof/.env.local`（`chmod 600`） |
| 演示数据库 | `/home/ubuntu/anonyproof/data/anonyproof-demo.db` |
| PM2 配置 | `/home/ubuntu/anonyproof/ecosystem.prod.config.js` |
| Nginx 站点 | `/etc/nginx/conf.d/anonyproof.deline.top.conf` |
| 证书 | `/etc/nginx/ssl/deline.top/fullchain.pem`（SAN 含 `anonyproof.deline.top`） |
| 访问日志 | `/var/log/nginx/anonyproof.deline.top.access.log` |

## 环境变量（.env.local）

```
DEMO_MODE=1
ADMIN_PASSWORD=demo12345678
SESSION_SECRET=<openssl rand -hex 32 生成>
DATABASE_PATH=./data/anonyproof-demo.db
CORS_ORIGINS=https://anonyproof.deline.top
TRUST_PROXY=1
ADMIN_UI_URL=https://anonyproof.deline.top/anonyproof/foorpynona
API_PROXY_TARGET=http://127.0.0.1:4000
```

- `DEMO_MODE=1` 时，管理员密码固定为 `demo12345678`，并在 `/api/demo/config` 暴露给登录页提示；同时首次连接空库时会写入示例数据。
- 正式项目必须把 `DEMO_MODE` 置为 `0`、设置 12 位以上 `ADMIN_PASSWORD`，并删除演示数据库。
- `API_PROXY_TARGET` 在 `next build` 时写进产物，改完需要重新构建前端。

## 进程管理

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
cd ~/anonyproof

pm2 list                  # anonyproof-frontend / anonyproof-backend
pm2 logs anonyproof-frontend
pm2 reload anonyproof-frontend anonyproof-backend
pm2 save                  # 同步开机自启快照（systemd 单元 pm2-ubuntu 已启用）
```

## 更新发布流程

```bash
# 1. 本地打包（排除依赖、构建产物、环境变量与本地数据库）
cd "/Users/wilson/Documents/Codex/AnonyProof /anonyproof-main"
tar czf /tmp/anonyproof-src.tar.gz \
  --exclude='node_modules' --exclude='.next' --exclude='.env.local' \
  --exclude='data' --exclude='logs' \
  app public server package.json package-lock.json next.config.js \
  next-env.d.ts tsconfig.json ecosystem.prod.config.js

# 2. 上传并解包
scp -i ~/Downloads/secret.pem /tmp/anonyproof-src.tar.gz ubuntu@106.55.13.245:/tmp/
ssh -i ~/Downloads/secret.pem ubuntu@106.55.13.245 \
  'tar xzf /tmp/anonyproof-src.tar.gz -C ~/anonyproof'

# 3. 服务器端安装依赖并构建
ssh -i ~/Downloads/secret.pem ubuntu@106.55.13.245 bash -s <<'EOS'
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
cd ~/anonyproof
npm install --no-audit --no-fund && npm run build
cd server && npm install --no-audit --no-fund
EOS

# 4. 重启并验证
ssh -i ~/Downloads/secret.pem ubuntu@106.55.13.245 \
  'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; pm2 reload anonyproof-frontend anonyproof-backend'
curl -s -o /dev/null -w "%{http_code}\n" https://anonyproof.deline.top/anonyproof
```

## 演示数据

- 种子逻辑在 `server/demo.ts`，只在 `DEMO_MODE` 开启且库中无反馈时写入 7 条记录。
- 覆盖企业、学校、协会/组织、工地、商业楼等场景，状态含待受理 2、处理中 2、已办结 2、暂无法处理 1，沟通记录 1~4 轮不等。
- 浏览器侧设备标识由 `/api/demo/config` 统一下发为 `demo-device-anonyproof-2026`，因此任何访客打开“我的提交”都能看到同一批演示记录。

## 上线自检

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://anonyproof.deline.top/
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://anonyproof.deline.top/
curl -s https://anonyproof.deline.top/anonyproof/api/stats
curl -s https://anonyproof.deline.top/anonyproof/api/demo/config
curl -s --max-time 6 http://106.55.13.245:4000/health   # 应当连接失败
```

自动化回归脚本：`output/verify-detail.mjs`（本地布局 94 项）与 `output/verify-prod.mjs`（线上 25 项）。
