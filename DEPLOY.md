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
DEMO_MAX_CLONES=3000
```

- `DEMO_MODE=1` 时，管理员密码固定为 `demo12345678`，并在 `/api/demo/config` 暴露给登录页提示；首次连接空库时会写入 7 条示例线索模板。
- 正式项目必须把 `DEMO_MODE` 置为 `0` 并设置 12 位以上 `ADMIN_PASSWORD`；关闭演示模式后示例数据只是从界面隐藏，仍在库中，可按需再单独清理。
- `API_PROXY_TARGET` 在 `next build` 时写进产物，改完需要重新构建前端。
- `CORS_ORIGINS` 必须显式设置；缺失、空值、通配符、路径、凭证或非规范 Origin 会使后端启动失败。生产仅配置本站的准确 Origin（如 `https://anonyproof.deline.top`），不要默认加入主域或 localhost。开发时单独列出实际本地前端 Origin；多个值用逗号分隔。端口属于 Origin，不能以 Host/X-Forwarded-Host 扩展 CORS 读取权限。CORS 不代替接口鉴权或写请求来源防护。

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
cd /Users/wilson/Documents/Codex/anonyproof
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

- 种子逻辑在 `server/demo.ts`，只在 `DEMO_MODE` 开启时写入 7 条示例模板（`is_demo_template=1`），重启不会重复插入。
- 覆盖企业、学校、协会/组织、工地、商业楼等场景，状态含待受理 2、处理中 2、已办结 2、暂无法处理 1，沟通记录 1~4 轮不等。
- 每个浏览器身份首次访问时，服务端复制一份独立示例副本（`is_demo_clone=1`）及用户端通知，未读状态、补充回复、后台处理都只影响该浏览器，互不串数据。
- 用户端只能访问本机身份名下的记录；换浏览器或清空浏览器数据后需用“我的提交”页面的恢复码找回，设备 ID 不再作为访问凭证。
- 后台列表默认过滤逐浏览器副本（避免淹没真实线索），但可查看示例模板与全部真实提交；首页统计排除副本，保持示例总量稳定。
- `DEMO_MAX_CLONES` 控制副本上限，达到上限后只签发身份不再复制，避免爬虫反复创建身份把库撑大。
- 置 `DEMO_MODE=0` 后不再生成副本，示例模板与副本自动隐藏且不会丢失真实数据，通知与已读逻辑回到正式行为。

## 上线自检

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://anonyproof.deline.top/
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://anonyproof.deline.top/
curl -s https://anonyproof.deline.top/anonyproof/api/stats
curl -s https://anonyproof.deline.top/anonyproof/api/demo/config
curl -s --max-time 6 http://106.55.13.245:4000/health   # 应当连接失败
```

线上验收建议：用两个独立浏览器分别打开站点，确认“我的提交”只显示各自记录；再用其中一个浏览器的恢复码在第三个浏览器验证能找回同一批记录；后台登录后应能看到访客新提交，并能更新状态触发对应用户的未读提醒。

## 正式内容密钥与恢复（T-03）

`DEMO_MODE=0` 的服务必须由独立部署环境提供 `CONTENT_ENCRYPTION_KEY`，值为32字节随机密钥的规范Base64（生成命令 `openssl rand -base64 32`）。不要写入仓库、数据库、SQL导出、普通日志或随数据库打包的备份。内容密钥与SESSION_SECRET用途不同。内容key遗失后密文无法恢复；不能通过新生成key或清空字段继续运行。

首次启用/升级前保存一致数据库快照（SQLite在线backup或停写备份），内容key另存并验证恢复。用测试环境恢复数据库，再独立提供相同key，验证身份找回、列表、评论、处理说明、通知读回；错误/缺key必须拒绝启动。四个新增字段版本列默认0，不会自动改写旧内容；历史迁移/旧资产处置属于T-32，需另行批准。

新writer写入版本1后，回滚必须保留已验收的兼容reader；先停写正式服务，只运行兼容reader读取已保存数据。不得恢复到旧reader，或以继续写明文作为回滚。demo keyless模式只能处理已批准固定合成材料；不可拿正式密文库作为demo库运行。

## Cookie 写请求来源（Q-03 / T-26）

所有API的POST/PUT/PATCH/DELETE在解析正文、鉴权和状态修改前都要求准确匹配`CORS_ORIGINS`的Origin；缺失、null、其它子域、路径伪装或Host/X-Forwarded-Host不能放行。合法客户端仅本站浏览器及显式配置的本地前端，无Origin脚本写请求不再受支持。需要复验的合成fixture必须显式附可信Origin，并单独测试无Origin403。GET identity创建/续接的旧兼容行为仍等待具体POST/readonlyGET迁移确认，不因普通写路由已保护而宣称整个T-26完成。

## 恢复码接口限流（T-08）

`POST /api/identity/recover`默认每个后端识别的来源IP每60秒最多10次请求；成功、无效码和JSON解析失败都计数，超限429并返回`Retry-After`，不签发Cookie或修改身份/安装密钥。来源不受信任的请求由T-26先拒绝，OPTIONS不占写入配额。可显式配置`RECOVERY_RATE_LIMIT_MAX`与`RECOVERY_RATE_LIMIT_WINDOW_MS`（毫秒）；必须为正安全整数，窗口最多2147483647毫秒，非法值启动失败。当前为单进程内存窗口；实际多跳代理IP配置仍须T-24验收，不因本地限流通过宣称线上各访客已正确区分。

## 反馈提交限额（T-06）

合法身份、归属和参数校验通过后，反馈提交在进入事务前同时受来源IP和Cookie身份两种限额约束，默认各10次/60秒。超限429、`Retry-After`，反馈/统计/通知不写入；窗口结束恢复。无效身份保持401，伪造body.deviceId保持403。数据库/加密失败的提交尝试也占配额，防止失败重试无限放大；读取、评论和后台处理不占此配额。

`FEEDBACK_RATE_LIMIT_MAX`配置来源次数，`FEEDBACK_IDENTITY_RATE_LIMIT_MAX`配置身份次数，`FEEDBACK_RATE_LIMIT_WINDOW_MS`配置两者的窗口毫秒。全部为正安全整数，窗口最多2147483647；非法配置启动失败。来源配额先判定，不能通过换身份或不可信XFF绕过直连来源上限。此处不表示拒绝请求完全没有日志或身份last_seen更新；业务写入不发生。实际代理链和跨实例配额仍由T-24/T-23分别约束。

## 用户补充限额（T-07）

`POST /api/feedback/:feedbackId/comments`在反馈可见性/调用者归属校验后、评论与通知事务前限流；每来源默认60次/60秒，每已验证用户身份默认20次/60秒。换反馈ID仍共用调用者配额，超限429与`Retry-After`且不写评论/通知，窗口后恢复。合法归属下的无效内容尝试也计数；跨身份访问维持401，不存在记录维持404。专用管理员回复路由保持现有行为；正式管理员原先可调用用户补充路由的权限保留，该路径按调用者Cookie身份或管理员session哈希及来源限流，不按目标反馈另开额度。

可配置`COMMENT_RATE_LIMIT_MAX`（来源次数）、`COMMENT_IDENTITY_RATE_LIMIT_MAX`（身份次数）、`COMMENT_RATE_LIMIT_WINDOW_MS`（共同窗口毫秒）；必须为正安全整数，窗口最多2147483647，非法值启动失败。拒绝请求仍可能更新last_seen/访问日志；没有业务评论与通知写入。代理链及多实例边界同T-06说明。
