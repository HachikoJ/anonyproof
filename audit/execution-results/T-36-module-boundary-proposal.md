# T-36 最小模块拆分具体批准提案

日期：2026-10-09。状态：**用户已于2026-10-09批准具体四模块方案，尚未实施**。本文件不解除 FIX_PLAN.md 中 T-36 的依赖，不把已有局部测试或历史 CI 当作最终候选的验收。

## 原任务与授权边界

FIX_PLAN.md 的 Q-09 要求先展示文件归属与依赖图，确认确切清单。T-36 原始严重度 P3、优先级 C、工作量 M；前置为 Q-09、全部已选择的行为修复及对应 API 回归、T-18。问题是 server/index.ts 混合建表/迁移、认证、身份、演示、路由和通知，容易漏挂保护。目标是让已验证的鉴权、校验、限流具有可定位的入口，并保持 HTTP/DB 行为不变。

本提案仅移动现有服务器代码到下述四个边界。没有框架、ORM、数据库、依赖、前端、公共接口、权限、数据格式、生产配置、默认流程或留存策略变更；不借拆分修复其他问题。真实历史库迁移、生产发布及清理不在本提案授权内。

只读核实依据：当前工作区 server/index.ts（包括已经批准的 T-24 代理认证接线）、server/utils/database.ts、现有编号测试及 .github/workflows/ci.yml。分析期间主代理仍在提交其他已批准任务，因此执行前须锁定最终基线提交并重新生成注册顺序清单；不把某个移动中的 HEAD 写成固定验收基线。

## 拟修改文件与函数归属

新增文件均放在 server/ 第一层，使现有 CI 的 `server/*.ts` 严格类型检查自然覆盖，不引入新的目录扫描或构建配置。

| 文件 | 唯一职责与拟导出入口 | 移动来源及边界 |
| --- | --- | --- |
| server/adminAuth.ts | `createAdminAuth(options)`，返回现有登录、session、logout handlers，以及 `getCookie`、`isAdminAuthenticated`、`requireAdmin`、`requireSameOrigin` 等实际调用入口 | index.ts 中管理员密码配置校验、8 小时内存会话、HMAC/常量时间比较、Cookie 处理、登录尝试 Map 和现有认证 handlers；不复制 limiter 或另建 session store |
| server/clientIdentity.ts | `createClientIdentity(options)`，返回身份读写/恢复、演示身份请求归属、身份容量错误识别及现有身份 handlers | 身份规范化、hash、恢复码、安装键、身份 session、20 会话限制、短期恢复码 Map、`identityFromCookie`、`resolveClientIdentity`、`recoverClientIdentity`、`requireClientIdentity`、`ensureDemoIdentity`、`demoRequestDevice`、`canAccessDevice`；现有 SQL/事务保持原样 |
| server/schema.ts | `initializeBusinessSchema(db, contentEncryption, demoMode)`；三个按原位置调用的 cursor index 初始化函数 | 内容密钥标记核验、现有业务建表、PRAGMA 检查/ADD COLUMN、idempotency 初始化、install-key 回填、demo seed、legacy token→session 回填；分页索引单独暴露，仍在原注册位置执行。无新增 migration engine/version table |
| server/routes.ts | `registerPublicRoutes`、`registerAdminRoutes`、`registerAccessRoutes`、`registerIdentityRoutes`、`registerBusinessRoutes`、`registerFinalErrorHandler` | 保留当前路由及 alias 的注册顺序；业务路由用到的 `readFeedback/readComment/readNotification`、scope/可见性、幂等 header/错误转换、`logAdminAction`、`updateStats`、`createNotification`、`addFeedbackComment` 同迁入该文件。不把每个 handler 再拆文件 |
| server/index.ts（已有） | 唯一进程入口及显式组装 | 保留 env 首次导入、Express app、运行参数、内容 codec 配置、全局中间件、上述模块的明确调用顺序、listen、三类后台清理启动/close 绑定、启动日志 |
| tests/fix/T-36.test.ts（新增） | 本次移动特有的差分与重复初始化验收 | 仅补充当前编号测试没有覆盖的注册/初始化等价证据；不建立第二套业务测试体系 |

现有 middleware、utils、demo 实现继续复用，避免第二份校验/限流逻辑。`openDatabase()` 的角色校验/WAL/foreign_keys、访问统计模块已有 import 时初始化不在本次重写范围。不能声称所有 SQLite 打开和统计 schema 已集中到新 schema.ts。

schema.ts 集中的是入口当前已有业务初始化；沿用 instance_metadata、已有字段 storage version、PRAGMA 列存在检查和 INSERT OR IGNORE 语义，以测试记录迁移版本/重复执行结果。不得趁机替换为新的版本迁移制度。

## 依赖与组装方式

```text
index.ts
  ├─ adminAuth.ts → crypto / ExpiringMap / requestOrigin（现有）
  ├─ schema.ts → 传入 db / contentEncryption；现有 demo、idempotency 工具
  ├─ clientIdentity.ts → 传入 db / demoMode / auth 的 cookie 和认证函数
  └─ routes.ts → 传入 auth / identity / db / codec / demoMode
                 → 现有 validation、rateLimit、pagination、idempotency 工具
```

禁止模块互相导入 index.ts，禁止通过 routes.ts 导出 DB 单例让其他模块反向依赖。每个注册函数仅接收它真正使用的依赖；不引入通用容器、服务定位器、插件层或新的业务抽象。

管理员 demo 登录需要身份服务，而客户端 `canAccessDevice` 需要管理员认证。解决方式是现有同步 factory 的显式函数参数：先创建 auth，登录 handler 接收延迟调用的 `ensureDemoIdentity` 回调；随后创建 identity 并注入 auth 的查询函数。回调只在 listen 后处理请求时调用，等同当前 index.ts 的闭包，不在模块求值或路由注册阶段签发身份。auth 与 identity 不互相 import，不额外创建会话或预初始化演示沙箱。

## 必须保持的初始化与注册顺序

以下列出当前顺序，实施时按函数调用显式保留。没有“统一注册”导致鉴权位置后移的自由裁量。

1. env / 现有依赖导入；运行参数和 demo/formal codec；管理员生产配置校验及既有 Map 初始化。
2. 受保护前缀 no-store 并移除条件请求头。
3. T-24 私有代理认证；随后 CORS、`/api` Cookie 写请求 Origin 防护。
4. 登录 POST 两个 alias 的来源 limiter；identity/recover 来源 limiter；JSON 384kb parser；JSON 400/413 错误 handler；trust proxy 设置；accessStats middleware。
5. `/`、`/health`、`/api/demo/config`。
6. login/session/logout 的全部既有 alias；然后且仅然后 `/api/admin` requireAdmin；再 `/api/admin/access` demo 禁止规则及访问管理路由。
7. `openDatabase()` → 内容密钥核验（在业务建表/seed 前）→现有业务建表/字段迁移→idempotency 初始化→install-key 字段/索引/回填→demo seed（仅 demo）→legacy token session 回填。
8. 身份服务闭包初始化；`GET /api/identity`（隐式 HEAD）→ POST identity（初始化 limiter）→ POST recover。GET/HEAD 保持不签发、不回填、不触碰 last_seen。
9. feedback POST（原来源/身份限流位置）→stats GET→admin cursor index→admin list/detail/status/delete/logs→comment cursor index→comment GET/user POST/admin POST→device cursor index→device list→feedback detail→notification unread/list/read/unread/read-all。
10. 最后容量/URI 错误 handler；listen。仅 listen callback 启动 idempotency、日志、身份留存；close 时分别 close。无提前定时器、重复定时器或模块 import 即监听端口。

业务函数内部鉴权→取 scope→查记录→解密、事务边界、限流调用、返回顺序均原样移动。反馈 status PUT 不加入 T-42 幂等；不改变已有 alias、参数、JSON 形状、Cookie Path/SameSite/Secure/Max-Age 或 401/403/409/410/429/503 条件。

## 分步实施、验收与回滚点

先等既有依赖闭合并取得对本文件的批准。每步只改该模块和入口接线，独立提交；当步检查失败先修正该移动或回退当步，不能带失败进入下一步。所有测试只使用本地合成数据、独立临时 DB/密钥，不操作生产库。

统一运行环境（不安装/升级依赖，不在主工作区混用 SQLite Node ABI）：

```sh
cd /Users/wilson/Documents/Codex/anonyproof
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
node --version
node scripts/check-runtime.cjs
```

**S0：锁定基线，尚不移动。** 记录最终基线 commit、worktree diff、安全检查、上述注册顺序及所有 API/alias 清单。运行下面最终门禁命令并保存退出码/TAP/构建输出。现有 skip 必须逐项记录，不能把 skip 报为通过。此前已有完整测试日志只能作为参考，不能替代包含最后行为修复的基线。

**S1：管理员认证。** 新增 adminAuth.ts，仅移动认证。执行：

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-01.test.ts tests/fix/T-07.test.ts tests/fix/T-09.test.ts tests/fix/T-22.test.ts tests/fix/T-22.integration.test.ts tests/fix/T-23.test.ts tests/fix/T-24.test.ts tests/fix/T-27.test.ts
```

验收：alias 登录/session/logout 与基线一致；未登录保护、错误密码、来源/容量限制、8h 到期、重启失效、demo 认证不开放访问日志、Origin/代理前置拒绝均保持。执行两项 type-check/diff-check。回滚点 R1：独立反向提交该模块移动，恢复原入口认证闭包；不变更 DB 或密钥。

**S2：客户端身份。** 新增 clientIdentity.ts，保持 GET 只读、POST 初始化、恢复/安装键规则、沙箱归属、Map 容量和 SQL 事务。执行：

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-01.test.ts tests/fix/T-02.test.ts tests/fix/T-05.test.ts tests/fix/T-21.test.ts tests/fix/T-22.integration.test.ts tests/fix/T-25.test.ts tests/fix/T-26.test.ts tests/fix/T-42.test.ts
```

验收：跨身份拒绝/演示隔离、GET/HEAD 无副作用、恢复身份保持、身份容量/20 session 边界、原留存事务及幂等身份 scope 均不变。两项 type-check/diff-check。R2：仅反向提交身份移动，保留已经通过的 R1。

**S3：业务 schema 初始化。** 新增 schema.ts，保持上述核验/建表/回填/seed 顺序；分页索引仍在原位置调用。执行：

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-02.test.ts tests/fix/T-03.test.ts tests/fix/T-05.test.ts tests/fix/T-25.test.ts tests/fix/T-32.test.ts tests/fix/T-32-candidate.test.ts tests/fix/T-42.test.ts tests/fix/T-36.test.ts
```

新增 T-36 的客观验收：用同一密钥和明确标注角色的合成旧 schema 启动、停服、再启动至少两次；比较 sqlite_master/PRAGMA table_info/index_list、迁移后的业务字段/主键/行数（排除既定时钟字段或留存变化，fixture 使用固定时间/不触发过期条件），确认没有重复 seed、重复 legacy session、重复通知/幂等记录。错误/缺密钥在业务 schema/seed 改写前失败；启动失败重试不吞错。不能用数据库文件 SHA 等同于逻辑 schema 比较。两项 type-check/diff-check。R3：独立回退 schema 代码移动；本次没有新 schema 版本、列/索引或实际数据迁移，不需要倒迁移。

**S4：路由归属与最终集成。** 新增 routes.ts，按六个明确注册入口移动上述现有 route blocks；保留内部函数体、SQL、错误捕获和中间件位置，不用 Router 统一 mount 改写 path/baseUrl。新增 T-36 检查注册前后 HTTP method/path/alias 顺序与 S0 清单一致，并对 alias/参数化路径保留实际 HTTP 行为断言；不能以纯源码字符串匹配替代请求测试。只有源文件路径变化的现有测试引用可同步更新，断言强度不降低。

最终门禁（命令来自当前项目 CI；失败不得标记完成）：

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/*.test.ts
npm run type-check
npm --prefix server run type-check
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts
npm run build
git diff --check
```

结果必须与 S0 对照：测试无新增失败/skip；所有编号任务实际验收仍成立；HTTP 路由/alias、状态码、Cookie、通知/DB 事务和初始化结果一致。按已有 T-18 远端契约在获授权且 Cloudflare 分支部署策略已核实安全后，提交最终候选至修复分支并验证对应提交的真实 CI。历史其他提交的 CI 成功不替代最终候选。

R4：独立回退路由移动；必要时按 R4→R3→R2→R1 逆序回退整个 T-36。每次回退后至少执行相关模块回归与 type-check；涉及完整恢复则重跑最终门禁。不撤销前置行为修复，不复制回旧有安全漏洞版本。

## 风险与完成标准

主要风险是模块加载/闭包初始化时序、认证挂载顺序、demo 回调循环依赖、schema/seed 重复执行，以及移动 handler 时遗失个别 limiter/alias/错误处理。通过四个独立模块提交、明确函数注入和原顺序调用隔离；每个提交都必须可运行、可测试，失败不进入下一步。

批准本文件只批准上述最小结构变化和合成验收；不批准行为变更、生产部署或历史资产操作。任何需要改变行为才能完成的发现，停止对应移动并另报待确认，其他独立已授权任务继续。

T-36 只有在所有前置闭合、四步代码已完成、最终门禁及对应候选的契约验收通过、无重复校验/限流实现、初始化重复运行保留数据、回滚差异可定位后，才可在 FIX_PLAN.md 标记“已完成”。Q-09已批准；目前仍为“待办（等前置行为/API基线闭合）”。
