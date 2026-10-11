# T-36 S4 本地验收结果

基线：`b86e79873b2b9c144f378af8b97a3dc1ea02b70b`。仅移动路由至六个明确 registrar；index 保留 env、runtime 中间件、组装、listen 和后台调度关闭。未修改 auth/identity/schema、其他测试断言或 FIX_PLAN；未提交、推送、部署或操作真实资产。

- 全量 40 个编号测试文件：251 tests，250 pass、0 fail、1 既存 skip；实际退出 0。T41 占位 skip 原因见 JSON，未计为通过。
- T36 自身 5/5；root/server/CI strict 三编译及 production build 均实际退出 0。
- 真实 Express 注册 trace 与 S0 的 43 项完全一致；两组 auth alias 与反馈/评论/通知/设备/管理员参数化路径均通过真实 HTTP 请求。
- AST 核对 43 注册调用、15 helper 和 listen cleanup closure 完全相同；56 SQL 字面量片段逐字节一致；cursor 锚点仍为 27/32/35。
- git diff --check 实际 0。未跟踪 routes 的 no-index --check 实际 1（新增文件差异），无空白诊断；三个 own 文件另行扫描也无行尾空白。
- 测试期间快照内 95 个源码 SHA 均未变；不宣称整棵工作树包括忽略产物不变。

首次新增 HTTP 测试误把既有 Cookie Path=/ 写作 /api；原失败 TAP 已保留。修正新断言并精确检查 Max-Age=28800，未改产品行为。所有命令/退出码/时间、SHA、跳过说明与证据索引见 T-36-S4-result.json。

当前仅 S4 本地门禁通过。T36 完成状态由主代理在逐文件复核、独立提交、最终本地代理链路及对应提交的真实 CI/契约验收后判定。R4 可独立反向提交路由移动，不撤销 S1-S3 或安全修复；无数据库倒迁移。
