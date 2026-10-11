# T-33 访问数据与可关联性

无需实名；运营者可关联本机记录，服务器与获授权管理员可读取内容。访问与限流日志保留来源 IP 7 天、浏览器家族或机器人分类及路由模板，不保存完整浏览器信息、查询参数或含业务编号的路径；处理说明、评论与操作审计不保存管理员 IP。活动 IP 黑名单按到期或人工取消规则保留，因此不等于不可追踪的完全匿名。

这是提交前页面和 README 的同一说明。正文静态加密模型不变，身份标识仍用于归属授权；最小化不等于抵抗有服务器权限的运营者识别或关联用户。

新 `access_logs` 的 `user_agent` 只保存固定 `browser:<family>` / `bot:<class>` / `client:script` / `unknown` 分类，不保存版本、设备型号或任意 UA 文本。`path` 只保存已知静态路由或 `:id` / `:feedbackId` / `:deviceId` / `:ip` 模板；未知路径统一 `/unmatched`。查询参数及片段不会进入数据库。来源 IP 仍用于限流、当天去重及已有黑名单判断，来源信任策略由 T-24 负责，不因本任务改变。检测逻辑在请求内临时使用原 UA/路径，判断机器人和可疑行为的规则保持。

`recordAccess` 和 `logRateLimit` 底层写入也执行分类，避免调用者绕过中间件保存原值。可疑原因及限流原因只允许固定分类，其它值替换为 `Other` / `Rate limit exceeded`。Winston 的可疑/黑名单告警不写来源 IP、完整 UA、原始路径或查询参数；访问统计失败只写固定、受限的 SQLite 错误码，不写原始异常消息或栈。进程 stdout/stderr 也属于验证范围。已复现的 Express malformed URI 参数默认错误会回显原始业务编号，因此最后错误处理器对 URIError 返回固定 400 JSON，不再交给默认 stderr 输出；其它错误的处理语义保持。

访问日志 HTTP 读取限制最近 7 天，并转换旧行的 UA/路径/可疑原因输出；读取不会重写或删除旧行。当前管理员处理说明写 `solution_admin_ip=''`，评论写 `admin_ip=NULL`，审计兼容列写空字符串。反馈、评论及审计读接口不返回旧管理员 IP 字段。动作、目标编号及时间保留，用于管理员操作审计；这不承诺操作不可关联。

IP 7 天清理由 T-11 的分批调度验证；日统计聚合保留。活动 IP 黑名单继续按到期/人工取消策略生效，永久条目不自动按 7 天删除。历史库、WAL、旧 Winston/PM2 文件及备份中的完整 UA、路径和管理员 IP 未物理处置，必须按真实资产清单、快照恢复证据及对应确认另行处理。只转换 HTTP 展示不能说明历史值已擦除。

本地验收使用固定合成 IP、UA、业务标记及独立临时数据库；测试中的 `TRUST_PROXY=1` 只用于模拟受信任单层代理，不证明实际生产代理链安全。

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-33.test.ts tests/fix/T-10.test.ts tests/fix/T-11.test.ts tests/fix/T-34.test.ts
npm run type-check
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts
```

回滚应维持新写最小化及授权展示规则；不能恢复额外标识的写入。真实部署及历史值处置未在本地验收中执行。
