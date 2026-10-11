# T-42 本地真实浏览器验收

2026-10-09，用户明确允许终端 Playwright 独立浏览器后，在 `http://127.0.0.1:3044` 的合成正式实例执行。仅涉及本地夹具，没有生产部署、真实材料迁移或远端 CI。结构化原始结果、断言、键哈希及网络事件见 `T-42-browser-acceptance.json`；这份材料不替主代理决定整个任务的完成状态。

实际返回的 T-42 断言共 **19 项通过**：反馈 10 项、用户评论 7 项、管理员评论 2 项。另有反馈页面的 T-33 提交前隐私说明 1 项，以及共享执行中的 T-23 重启验收 6 项，分别列出，未重复计入 T-42。

## 两次夹具运行与真实计数

计数顺序均为 `feedbacks / feedback_comments / notifications / request_idempotency`。两次运行使用不同的临时数据库，不能相加。

| 运行和操作 | 操作前 | 操作后 | 实际结果 |
| --- | --- | --- | --- |
| run1 反馈提交、刷新后的冲突和重放 | 4 / 3 / 2 / 0 | 5 / 3 / 3 / 1 | 仅创建一条反馈和一条通知。三次请求为 200、409、200；三次键哈希相同，首末 acceptedId 相同。 |
| run2 用户评论丢响应后重放 | 4 / 3 / 2 / 0 | 4 / 4 / 3 / 1 | 首次真正提交后截断响应，原页重试返回同一评论，计数没有再次增加。 |
| run2 用户评论存储故障后恢复 | 4 / 4 / 3 / 1 | 4 / 5 / 4 / 2 | 存储故障时无网络写请求、无 DB 新行；恢复存储后沿用原本未发送动作的键，只增加一条评论。 |
| run2 管理员评论丢响应后重放 | 4 / 5 / 4 / 2 | 4 / 6 / 5 / 3 | 网络事件 30、31 均为 200，键哈希相同、acceptedId 均为 6；首次事件确认数据库已提交。 |
| run2 管理员明确另作一次提交 | 4 / 6 / 5 / 3 | 4 / 7 / 6 / 4 | 网络事件 35 使用不同键哈希、acceptedId 为 7；评论仅增加一条。随后独立 flow 核对真实网络事件和页面 7 条评论。 |

管理员两步之间的 `4 / 6 / 5 / 3` 是由已确认的唯一提交事件、相同键/ID 重放，以及前后实测总数推导的中间值，没有另存该时刻的 SQLite 快照。最终 7 条评论和全部最终表计数均已重新核对。

run1 反馈 acceptedId 为 `912018aa-63e4-487b-a2f2-0887825d973e`，对应键 SHA256 为 `1cb237a5c51eac6cc626ff8d0a20d28ace282277da2da3d93dc02692dd8f929d`。用户评论重放 acceptedId 为 4，管理员重放 acceptedId 为 6。完整哈希见 JSON，未保存原始动作键。

最终只读查询 SQLite 得到 `4 / 7 / 6 / 4`，与运行中 `/__fixture/state` 一致。状态中的 56 条网络事件与 `T-42-browser-network.json` 完全一致，已分别留存为 `T-42-browser-run2-state.json` 和 `T-42-browser-run2-network.json`。夹具未被本次证据整理停止。

## 通过的页面行为

反馈流程实际验证：丢响应前数据库已提交；失败时草稿仍在；`sessionStorage` 只保存动作键、动作类别和目标；原页修改失败草稿不会自动换键或发送新请求；刷新后草稿为空；刷新后用不同正文重试返回 409；再次刷新并输入原正文重试返回原记录，通知和幂等记录均不重复；成功弹窗显示原 ID，成功后清除 pending 动作。

用户评论流程实际验证：提交成功后正文读取失败；失败草稿保留；原页重试复用相同键和 ID；页面只显示一份评论；模拟 pending 键的 `sessionStorage.setItem` 失败时不发送写请求、不增加数据库记录；恢复存储后仍使用此前未发送的动作键；最终页面 5 条评论均唯一。

管理员评论的最终独立结果验证两项：丢响应后的实际重试使用相同键和 ID；明确另作提交使用新键和新 ID，只增加一条评论。此前 combined flow 没有返回完整 Result，不能用其未返回的草稿或修改内容断言冒充通过。

## 失败尝试与夹具修正

run1 原夹具在响应头到达前断开连接。反馈场景确实出现了页面错误，反馈的 11 个返回断言（含 T-33 说明）有效。随后用户评论场景出现 Chromium 自动重试：网络事件 28、29 均为 200，键哈希和 acceptedId 均相同，没有数据库重复行，但页面未出现脚本等待的错误，故该用户评论尝试超时，**不计为通过**。原失败记录复制为 `T-42-browser-run1-user-comment-timeout.txt`，原 run1 fixture/network/result 均保留。

仅调整测试夹具的故障注入方式：先消费成功上游响应并用独立 SQLite 连接确认行已提交，然后转发真实成功状态及响应头，明确完整 `Content-Length`，仅发送一个正文字节，再断开 socket。run2 事件记录 `dropMode=committed-success-body-truncated`。它模拟已提交成功响应的正文传输失败，没有伪造业务错误，也没有撤销提交。run2 使用全新合成库验收用户和管理员评论；没有将 run1 超时改写为通过。

管理员 combined flow 的原输出停在确认弹窗，且后续代码使用了错误的 `.notification-panel` 选择器。原 flow 与原输出保留，脱敏副本明确标记 interrupted。最终 `T-23-browser-restart-flow.js` 独立核对了已经发生的三条管理员写请求、7 条评论以及后续重启行为；只有这个实际返回的 Result 被采用。详情见 `T-42-browser-admin-interrupted-execution.json`。

## 可复现入口及材料

先释放本地 4000、3042、3044 端口，使用 Node 22 启动 `tests/fix/T-42.browser.ts`。现有 production `.next` 必须指向本地 4000；需要构建时显式使用 `--build`，不能与其他 fixture 构建并发。恢复码由夹具写入临时目录 0600 文件，通过恢复 UI 使用；没有复制进验收材料。

```bash
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
node --import tsx tests/fix/T-42.browser.ts
```

控制接口是 GET `/__fixture/state`、POST `/__fixture/drop-next/feedback`、POST `/__fixture/drop-next/user_comment`、POST `/__fixture/drop-next/admin_comment`，以及 POST `/__fixture/restart-backend`。业务动作均通过真实页面操作。每类动作每次运行仅允许一次成功响应截断；需要独立重验同类不同重试场景时另启合成夹具，不删除旧证据。

- `T-42-browser-feedback-flow.js`：原 run1 成功流程，需要页面已进入反馈选择界面。
- `T-42-browser-user-comment-flow.js`：原 run2 成功流程，需要恢复 A，停留在“我的提交”，A1 初始 3 条评论。
- `T-42-browser-admin-T23-interrupted-flow.js`：原 combined flow 的脱敏副本，**不是成功验收脚本**，保留错误选择器作为失败历史。
- `T-23-browser-restart-flow.js`：最终成功的共享验证流程，需要管理员已打开 A1，评论已通过前述 UI 操作增加至 7 条。
- 管理员 flow 的密码字面量替换为 `process.env.T42_BROWSER_ADMIN_PASSWORD`，运行器在本地提供夹具合成值；文档和证据没有记录值。该替换及原文件 SHA256 见 JSON。
- 截图：`T-42-feedback-replay-success.png`、`T-42-user-comments-final.png`、`T-42-admin-final.png`。均人工检查，仅含本地合成材料，无密码或恢复码。

共享 T-23 的独立 JSON、flow 和截图分别是 `T-23-browser-restart-acceptance.json`、`T-23-browser-restart-flow.js`、`T-23-restart-login-cleared.png`，供主代理按独立任务验收和提交。T-23 的实际重启保留同一数据库、内容密钥和 SESSION_SECRET；旧管理请求实际返回 401，页面清空受保护内容与草稿，重新登录后受保护请求恢复 200，注销仍可用。8 小时期限边界属于此前后端测试，没有在这次浏览器运行中等候 8 小时。

本材料未新增验证身份 B 的浏览器隔离，也不代替已有后端故障矩阵、类型检查、构建、远端 CI 或生产验收。不存在“命令退出 0 即全部通过”的推导。
