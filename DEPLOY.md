# 腾讯云部署说明

本文的路径取自既有部署资料，未作为2026-10-07线上状态证明。下述功能说明对齐已在本地验收的修复代码；修复尚未发布，T-02实例硬隔离和T-35部署配置仍需分别验收。

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
INSTANCE_ROLE=demo
DEMO_MODE=1
CONTENT_ENCRYPTION_KEY=
ADMIN_PASSWORD=demo12345678
SESSION_SECRET=<openssl rand -hex 32 生成>
DATABASE_PATH=/home/ubuntu/anonyproof-demo/data/demo.db
CORS_ORIGINS=https://anonyproof.deline.top
TRUST_PROXY=1
ADMIN_UI_URL=https://anonyproof.deline.top/anonyproof/foorpynona
API_PROXY_TARGET=http://127.0.0.1:4000
DEMO_MAX_CLONES=3000
```

- `DEMO_MODE=1` 时，管理员密码固定为 `demo12345678`，并在 `/api/demo/config` 暴露给登录页提示；首次连接空库时会写入 7 条示例线索模板。
- 正式实例使用独立数据库/管理员凭证/内容密钥及 `DEMO_MODE=0`，公开演示只连接其合成沙箱库。不得通过把现有演示库切到正式开关来替代硬隔离；不按此说明自动清理历史数据，旧资产处置仍需单独确认。
- `API_PROXY_TARGET` 在 `next build` 时写进产物，改完需要重新构建前端。
- `CORS_ORIGINS` 必须显式设置；缺失、空值、通配符、路径、凭证或非规范 Origin 会使后端启动失败。生产仅配置本站的准确 Origin（如 `https://anonyproof.deline.top`），不要默认加入主域或 localhost。开发时单独列出实际本地前端 Origin；多个值用逗号分隔。端口属于 Origin，不能以 Host/X-Forwarded-Host 扩展 CORS 读取权限。CORS 不代替接口鉴权或写请求来源防护。

## T-02 隔离部署契约（本地代码已实现，未切生产）

现在线上旧进程目录仍是 `/home/ubuntu/anonyproof`；本节是待批准切换目标，不能把路径表当作已经部署的证据。演示与正式各用独立 checkout、`.env.local`、`.next`、DB、管理员/SESSION_SECRET/内容密钥备份和 PM2 进程。演示建议目录 `/home/ubuntu/anonyproof-demo`（3000/4000），正式另用 `/home/ubuntu/anonyproof-formal`（3100/4100）；正式域名和真实历史资产映射仍待具体确认，不用当前演示域名默认接正式库。

启动必须配置 `INSTANCE_ROLE=demo|formal`、严格相符的 `DEMO_MODE=1|0` 及显式绝对 `DATABASE_PATH`，不按 NODE_ENV 或域名猜测。demo 不得配置内容密钥；formal 必须配置 32 字节 Base64 内容密钥及至少 12 字符私有管理员口令，公开演示密码和文档占位口令会拒绝。每次打开 DB 在访问/业务建表之前检查永久 `instance_metadata` 角色及内容密钥；角色冲突或未标角色的非空旧库保持关闭。不能靠切开关或复制旧库自动认领，迁移前须另行审批对应资产和归属。

分别在对应 checkout 执行已授权发布步骤，前端 build 时明确设置本角色 `API_PROXY_TARGET`。PM2 配置读取启动命令中的角色，进程名为 `anonyproof-demo-frontend/backend` 或 `anonyproof-formal-frontend/backend`；默认端口按角色区分，可用显式 FRONTEND_PORT/BACKEND_PORT 覆盖，但不允许同端口。示例启动命令 `INSTANCE_ROLE=demo pm2 start ecosystem.prod.config.js`，正式在另一个 checkout 使用 `INSTANCE_ROLE=formal`。不要在原线上目录直接执行这些命令或自动停旧进程；实际切换需先备份/恢复演练、核对监听与代理目标，然后取得发布批准。开发启动也必须显式角色/开关/绝对测试 DB；本地 Origin 单独配置。

这些检查不能发现任意其它机器重复使用同一个签名/内容密钥；部署时必须独立生成并用配置清单验证，禁止密钥注册中心或仓库中保存真实值。回滚保留各角色对应的旧发布、配置、库快照，不能删角色标记或把正式库接公开演示；公开旧材料未处置时不能重开公开读取。

## 旧实例进程管理（历史操作参考）

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
cd ~/anonyproof

pm2 list                  # anonyproof-frontend / anonyproof-backend
pm2 logs anonyproof-frontend
pm2 reload anonyproof-frontend anonyproof-backend
pm2 save                  # 同步开机自启快照（systemd 单元 pm2-ubuntu 已启用）
```

## 旧原位更新流程（历史参考，禁止用于本轮隔离切换）

下述旧流程直接覆盖原 checkout，缺少 T-02 的隔离和资产恢复门禁；保留作历史参考，本轮不执行。新角色按前文在独立目录准备，待资产/发布方案获批后再切入口。

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
- 本地修复版公开后台只读固定合成模板，并能处理当前浏览器自己的合成沙箱；其它浏览器、旧非受支持记录和原始访问/管理日志不能读取或修改。演示提交、补充和处理说明仅选择固定示例，不能自由接收真实材料。首页统计只计当前版本的固定模板，不公布沙箱或历史真实记录总数。
- `DEMO_MAX_CLONES` 控制副本上限，达到上限后只签发身份不再复制，避免爬虫反复创建身份把库撑大。
- 正式流程在独立正式实例中使用；示例/沙箱数据不会因开关自动删除。两库隔离及启动防误用属于T-02，不把界面隐藏当作数据隔离已经完成。

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

所有API的POST/PUT/PATCH/DELETE在解析正文、鉴权和状态修改前都要求准确匹配`CORS_ORIGINS`的Origin；缺失、null、其它子域、路径伪装或Host/X-Forwarded-Host不能放行。合法客户端仅本站浏览器及显式配置的本地前端，无Origin脚本写请求不再受支持。需要复验的合成fixture必须显式附可信Origin，并单独测试无Origin403。身份初始化、安装密钥绑定、续期和沙箱创建使用同样防护的 POST `/api/identity`。兼容 GET/HEAD 只读取有效身份 Cookie，不签发 Cookie、不更新活动时间；缺失或失效 Cookie 返回401，旧页面需刷新。

## 恢复码接口限流（T-08）

`POST /api/identity/recover`默认每个后端识别的来源IP每60秒最多10次请求；成功、无效码和JSON解析失败都计数，超限429并返回`Retry-After`，不签发Cookie或修改身份/安装密钥。来源不受信任的请求由T-26先拒绝，OPTIONS不占写入配额。可显式配置`RECOVERY_RATE_LIMIT_MAX`与`RECOVERY_RATE_LIMIT_WINDOW_MS`（毫秒）；必须为正安全整数，窗口最多2147483647毫秒，非法值启动失败。当前为单进程内存窗口；实际多跳代理IP配置仍须T-24验收，不因本地限流通过宣称线上各访客已正确区分。

## 反馈提交限额（T-06）

合法身份、归属和参数校验通过后，反馈提交在进入事务前同时受来源IP和Cookie身份两种限额约束，默认各10次/60秒。超限429、`Retry-After`，反馈/统计/通知不写入；窗口结束恢复。无效身份保持401，伪造body.deviceId保持403。数据库/加密失败的提交尝试也占配额，防止失败重试无限放大；读取、评论和后台处理不占此配额。

`FEEDBACK_RATE_LIMIT_MAX`配置来源次数，`FEEDBACK_IDENTITY_RATE_LIMIT_MAX`配置身份次数，`FEEDBACK_RATE_LIMIT_WINDOW_MS`配置两者的窗口毫秒。全部为正安全整数，窗口最多2147483647；非法配置启动失败。来源配额先判定，不能通过换身份或不可信XFF绕过直连来源上限。此处不表示拒绝请求完全没有日志或身份last_seen更新；业务写入不发生。实际代理链和跨实例配额仍由T-24/T-23分别约束。

## 用户补充限额（T-07）

`POST /api/feedback/:feedbackId/comments`在反馈可见性/调用者归属校验后、评论与通知事务前限流；每来源默认60次/60秒，每已验证用户身份默认20次/60秒。换反馈ID仍共用调用者配额，超限429与`Retry-After`且不写评论/通知，窗口后恢复。合法归属下的无效内容尝试也计数；跨身份访问维持401，不存在记录维持404。专用管理员回复路由保持现有行为；正式管理员原先可调用用户补充路由的权限保留，该路径按调用者Cookie身份或管理员session哈希及来源限流，不按目标反馈另开额度。

可配置`COMMENT_RATE_LIMIT_MAX`（来源次数）、`COMMENT_IDENTITY_RATE_LIMIT_MAX`（身份次数）、`COMMENT_RATE_LIMIT_WINDOW_MS`（共同窗口毫秒）；必须为正安全整数，窗口最多2147483647，非法值启动失败。拒绝请求仍可能更新last_seen/访问日志；没有业务评论与通知写入。代理链及多实例边界同T-06说明。

## 身份初始化与容量（T-05）

当前`POST /api/identity`默认每个来源10次/60秒，限流在解析/签发身份前执行；超过返回429与`Retry-After`，不写身份/session/安装密钥/演示副本。正常身份初始化和续接都计数，OPTIONS不计数；兼容 GET/HEAD 为只读，不签发或续接身份。可配置正整数`IDENTITY_RATE_LIMIT_MAX`、`IDENTITY_RATE_LIMIT_WINDOW_MS`（毫秒，最多2147483647）。

每库身份记录总容量`IDENTITY_MAX_RECORDS`默认100000，必须为正安全整数；在创建事务取得写锁后判定，达到上限新身份初始化及演示登录中的隐式新身份签发均503，无新Cookie或记录。不清除已有身份；已有Cookie/安装密钥续接与有效恢复码仍可用（也受各请求窗口约束）。要提高容量须评估存储后显式改配置；降低到现有数量以下也不删数据，只停止新签发。长期保留/清理仍由T-25按确认策略实施。

`DEMO_MAX_CLONES`默认3000份完整模板副本，须非负安全整数，0表示不复制；达到上限后仍可签发身份直到身份总容量，不会因缺副本返回500。复制在写事务内重查配额，避免最后一个名额被并发重复消耗。仅控制已列资源，未假设此计数等于全部反馈记录容量。来源代理链/多实例运行仍须对应任务验收。

## 有效限流配置索引（T-31）

旧`RATE_LIMIT_MAX`从未控制请求上限，现明确弃用；为保留旧模板兼容占位不删除字段，启动时遇到它会警告“不生效”，不打印值。调整它不能替代下面的配置。

| 接口/资源 | 次数或容量配置（默认） | 窗口配置（默认毫秒） | 主体与计数边界 |
| --- | --- | --- | --- |
| 两个登录alias | LOGIN_RATE_LIMIT_MAX（10） | LOGIN_RATE_LIMIT_WINDOW_MS（60000） | 共享来源；成功/失败/解析失败均计数 |
| 身份初始化 | IDENTITY_RATE_LIMIT_MAX（10） | IDENTITY_RATE_LIMIT_WINDOW_MS（60000） | 来源；签发/续接初始化计数 |
| 全库身份容量 | IDENTITY_MAX_RECORDS（100000） | 无时间窗口 | 超额拒绝新建，不删除已有记录 |
| 恢复码尝试 | RECOVERY_RATE_LIMIT_MAX（10） | RECOVERY_RATE_LIMIT_WINDOW_MS（60000） | 来源；成功/失败/解析失败均计数 |
| 反馈提交来源 | FEEDBACK_RATE_LIMIT_MAX（10） | FEEDBACK_RATE_LIMIT_WINDOW_MS（60000） | 合法身份/参数后、业务事务前 |
| 反馈提交身份 | FEEDBACK_IDENTITY_RATE_LIMIT_MAX（10） | 同上 | 验证后的Cookie身份 |
| 用户补充来源 | COMMENT_RATE_LIMIT_MAX（60） | COMMENT_RATE_LIMIT_WINDOW_MS（60000） | 可见性/归属通过后，内容校验/业务事务前 |
| 用户补充身份 | COMMENT_IDENTITY_RATE_LIMIT_MAX（20） | 同上 | 已认证调用者；换反馈ID不另开额度 |
| 完整演示副本 | DEMO_MAX_CLONES（3000） | 无时间窗口 | 0禁用复制；副本满不停止既有身份使用 |

请求次数/身份容量必须正安全整数，演示副本容量允许0；窗口为正整数且不超过2147483647。非法有效配置启动失败，不静默关闭；429返回`Retry-After`，容量满是503且不擅自清理。未挂载的通用/管理员limiter常量不作为部署保护对外声明。当前单进程内存窗口，代理IP准确性和多实例会话/配额契约仍分别由T-24/T-23验证。

## 历史迁移的只读盘点准备（T-32，迁移未实施）

先在合成/已授权的隔离源上运行，不默认连接项目实际库。命令要求一个显式数据库路径；源必须已存在，工具以readonly+query_only和单一读事务统计，不读取内容密钥/环境文件，不创建迁移目标，也不执行转换或删除：

```bash
npx --no-install tsx scripts/content-migration-inventory.ts /absolute/approved-source.db
```

报告包含业务/身份表计数、四类内容的version0/标记version1/未知版本/NULL计数、演示标记分类及有明确父记录的孤儿计数；缺表/字段或无法判断关系时保留缺口，未输出正文、记录/设备标识、恢复码或key。version1仅表示字段标记，不能证明能通过认证解密；演示/正式行标记也不证明部署归属或硬隔离。

退出0只表示盘点可生成，不表示T-32完成。下一步仍需Q-04/Q-07、批准保留映射/实际资产清单、独立key和一致性快照的恢复验证，再实施新库迁移、核对计数/解密/导出/物理残留并确认入口切换；旧源/备份销毁单独确认，不能同时丢失唯一回滚源。该盘点入口的验收仅覆盖合成库的只读/脱敏/异常报告，不将其替代迁移与资产处置验收。

### 合成候选库转换准备（未激活真实历史库）

`scripts/content-migration-candidate.ts`是尚未接入业务/CLI的准备模块，仅在合成fixture调用：readonly源→0700/0600私人工作快照→T-03同格式转换/逐条认证→VACUUM INTO新候选→不覆盖的发布。不会删除源、旧备份或失败工作目录，不加载环境文件；需要显式绝对source/全新`.db`目标和独立内容key。演示/混合行、触发器、未知版本、不支持schema、NULL字段、旧空正文但有非标准旧包均拒绝；不擅自决定数据映射或把NULL改空串。

工作快照可能含原文/旧包key，需受限保存并纳入以后逐项资产确认；目标与工作candidate是hard link，不能充当独立备份。在线快照不包含之后的写入，真实切换前须停写、最终快照与恢复/映射核对；T-02角色接入、Q-04/Q-07和实际处置/发布仍未完成。验证步骤/失败恢复及完整限制见 `audit/execution-results/T-32-candidate-design.md`；可复验合成准备的命令为 `npx --no-install tsx --test --test-concurrency=1 tests/fix/T-32-candidate.test.ts tests/fix/T-32.test.ts tests/fix/T-03.test.ts`，不提供未获准的真实迁移命令。
