# T-01..T-43 修复验收阶段复核（2026-10-11）

这是阶段交付，**不是全量完成声明**。原43个任务均保留：35项已解决（已批准任务范围），8项部分解决且已阻塞；没有静默跳过。未发现须扩大范围的新确认问题；原范围外依赖advisory继续记录，未修复或隐去。

## 固定候选与真实检查

产品候选5c23a042e807b92312dac8fa1a9dc2e6037f575d；40808c0只改计划/证据，60个发布源文件逐字节一致。40808c0真实GitHub Actions run38035917776已完成success：252 tests / 251 pass / 0 fail / 1既有T41占位skip。安装/ABI、两types、全后端strict、build通过；两个同SHA非空artifact存在。见 `T-18-current-doc-head-40808c0-actual-CI.json`；完整原始日志私有保留并记录SHA。唯一skip未计通过，不靠绿色元数据替代实际TAP。

30个自动编号任务共有134条直接ok记录；另外T15生产smoke/rollback、T18门禁/artifact、T28/T29归档+构建+浏览器、T30纯文档读取检查按各自原验收核对，不为它们凭空要求编号测试。失败日志均保留。

## 八项未完成与执行门禁

C/E具体问题已发送，尚未收到明确批准。自动继续和方向批准都不替代具体确认。F必须在E最终恢复通过后重新盘点精确资产、取得删除批准，不能用当前只读候选清单直接删除。

| 编号 | 当前分类 | 已有实际证据 | 尚缺批准/验收 |
| --- | --- | --- | --- |
| T-02 | 部分解决/已阻塞 | 两角色/凭证配置矩阵、A/B一致快照和D两地恢复通过；未发布新站 | C具体发布批准及生产隔离验收 |
| T-11 | 部分解决/已阻塞 | T-11-local-result.json：7天边界、500批次、故障、重启通过；旧真实raw仍保留 | E真实保留处置、F逐资产退役、C部署补验 |
| T-24 | 部分解决/已阻塞 | 最新本机Nginx→Next→Express11/11；生产未启用私有代理认证 | C私有代理上线/两来源补验，依赖T35配置 |
| T-25 | 部分解决/已阻塞 | T-25-local-result.json及CI：90/30天策略通过；三版只读候选0，缺表离线例外未批 | E身份保留/no-op映射及独立恢复 |
| T-32 | 部分解决/已阻塞 | APRA/58项与fd回归、D三版两地全量恢复及新helper兼容通过；旧明文/WAL/D过渡包保留 | E最终保留档案、F旧明文和过渡档案退役 |
| T-33 | 部分解决/已阻塞 | T-33本地字段/浏览器文案/Nginx请求隐私通过；旧IP/请求日志及完整D包保留 | C代理日志配置、E最小化、F历史日志/副本退役 |
| T-34 | 部分解决/已阻塞 | T-34.test.ts事务/故障/关联/foreign_key_check通过；实际孤儿尚未采用隔离档案 | E孤儿隔离、F旧关联副本退役 |
| T-35 | 部分解决/已阻塞 | 归档、nginx-t、ACME9项、真实链45项通过；生产仅维护vhost | C唯一vhost启用和公网/端口/业务补验 |

C完整方案：`/private/tmp/anonyproof-release-proposal-20261010-30ej40a9/C-release-preview.md`。固定源包、安装/构建、独立空demo库/秘密、新PM2两进程、精确删除旧两条注册/开机项、唯一本站vhost及独立浏览器/公网验收有具体范围。失败保持/恢复503，不恢复真实材料公开。

E完整方案：`/tmp/anonyproof-E-minimization-proposal-20261010.md`。25/25合成工具测试/strict0、三版×4项只读预览已过；未知业务/NULL/旧包/身份/聚合保留，孤儿分档、adminIP空、最终长期档案无逐请求raw；旧聚合精度/全缺身份表离线例外明确待批。六套主/孤儿APRA须服务器和本机分别独立恢复、按批准映射完整类型/值比对。旧源/D/日志不由E删除。

F只读候选清单：`/private/tmp/anonyproof-F-inventory-20261010/F-current-candidates.private.json`，执行前加入未来E资产并复核。本站30轮转及6项目日志单列；共享日志未找到明确本站Host标签，但旧combined access缺Host而不能证明历史归属，禁止泛删其他站/共享日志。没有声称磁盘、系统快照或未查证第三方备份已物理抹除。

## 35项已完成的逐项证据复核

下面保留各独立编号、原验收覆盖、实际命令/结果和边界。报告是检查索引，具体日志和断言才是执行证据。文件相对路径以 `/Users/wilson/Documents/Codex/anonyproof` 为根，多数结果在 `audit/execution-results/`。没有重复跑已覆盖全量测试/浏览器/benchmark，也未借其绿色结果自动关闭生产/历史资产。

## T-01 公开演示权限与合成沙箱

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/routes.ts:172（adminRecordScope）、:185（通知scope）、:83（demo禁原始日志）；server/demo.ts:238、:542；app/page.tsx、app/foorpynona/page.tsx 固定选择交互。

验收与测试覆盖：T-01.test.ts 双身份/两login alias/模板读写/其他访客详情、评论、通知、旧合成sentinel及原始访问日志拒绝；自由正文无选择400，有固定选择时客户端自由字段不落库；公开Cookie在formal拒绝。formal正常处理由T-19.test.ts完整业务smoke支持。

具体命令/结果文件：T-01-parent-tests.txt：9/9、EXIT 0；T-01-browser.txt、T-01-browser-db.txt：真实UI创建/模板禁写/本人处理和两角色固定评论，并独立SQLite断言EXIT 0；T-01-docs-reconciliation.txt说明对齐。

未覆盖/矛盾/边界：无已批准本地范围缺口。真实硬隔离/生产补验归进行中T-02，不能从权限测试推导已上线。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 311: `ok 1 - T-01: public demo isolates two identities, immutable templates and all legacy/private paths`
- 316: `ok 2 - T-01: existing cookie login after restart preserves recovery hash and upgrades only safe sandbox copies`

## T-03 独立密钥的认证静态加密

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/utils/contentEncryption.ts:69、:75、:91、:111；server/routes.ts:129、:137、:142及反馈/评论/solution/通知事务writer；server/index.ts:27；docs/DEPLOYMENT.md 恢复指导。

验收与测试覆盖：T-03.test.ts 14个测试：独立向量、2000个nonce、nonce/tag/cipher/context/key/版本篡改、错误/缺key失败且marker不改；四类内容及通知title/content认证密文、新旧混合、DB/live WAL/SQL导出/日志marker和key扫描；单独DB不可用正确key以外恢复，正确独立key跨目录恢复/重启/恢复身份精确读回。

具体命令/结果文件：T-03-writer-tests.txt、T-03-backup-guide-regressions.txt、T-03-backup-guide-tests.txt（指导场景1/1）；T-03-browser-verification.txt与T-03-browser-db-assert.txt：真实提交/用户补充/管理搜索处理/回复/通知定位/找回，1反馈/2评论/4通知、v1及扫描通过；T-03-docs-reconciliation.txt。当前分页契约的搜索/通知/线程合成browser结果另保留T-37/38/39-browser-result.json，不依赖build代替UI。

未覆盖/矛盾/边界：无新写入/兼容reader范围缺口。旧版本0历史材料与备份残留仅由T-32关闭；不声称历史全部已加密。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 346: `ok 8 - T-03 module: AES-256-GCM known ciphertext, independently calculated authenticated vector`
- 351: `ok 9 - T-03 module: unique random 96-bit nonces; exact empty/Unicode/max-size round trips`
- 356: `ok 10 - T-03 module: altered cipher/tag/nonce/context/key and unknown versions cannot fall back`
- 361: `ok 11 - T-03 module: explicit old-format reader compatibility and demo keylessness`
- 366: `ok 12 - T-03 module: storage version is mandatory; sealed version rejects missing prefix and unknown flags`
- 371: `ok 13 - T-03 module: missing, noncanonical and wrong-length key configuration fails closed`
- 376: `ok 14 - T-03 module: persisted key marker rejects wrong/lost key without overwriting marker`
- 381: `ok 15 - T-03 module: markerless existing ciphertext cannot be adopted with the wrong key`
- 386: `ok 16 - T-03 module: row flags preserve legacy prefix collisions; old body and new solution coexist`
- 391: `ok 17 - T-03 module: database version 1 bad prefix and unknown storage flags fail without a new marker`
- 396: `ok 18 - T-03 reader: real HTTP preserves legacy literals and independently sealed fields across restart/restore`
- 401: `ok 19 - T-03 writer: four content classes have no plaintext/key copies in DB, WAL, SQL export or logs`
- 406: `ok 20 - T-03 writer: nonce/cipher/tag/field-version tampering is a controlled HTTP failure without plaintext fallback`
- 411: `ok 21 - T-03 backup guide: real sqlite3 readonly online snapshot includes committed WAL and restores using a separate fixture key`

## T-04 伪加密退役与失败关闭

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：app/hooks/useCrypto.ts:172 仅兼容marker；app/page.tsx、app/foorpynona/page.tsx成功后才清draft；server/routes.ts加密writer事务。

验收与测试覆盖：T-04.test.ts SSR/no WebCrypto真实hook不产Base64包；实际cipher及后续通知故障使反馈/两角色评论/状态为500、五类业务表完整快照不变，解除后200/v1；旧Base64仅兼容接收后丢弃。缺/错误key拒启由T-03真实恢复覆盖。

具体命令/结果文件：T-04-tests.txt：2/2；T-04-browser-network.json及T-04-browser-db-assert.txt：真实浏览器subtle被移除，三类动作[500,200]、失败draft保留、fault无部分写入、恢复正常；最终1反馈/1评论/3通知/1审计且v1。

未覆盖/矛盾/边界：无缺口；按已批准服务器加密模型，浏览器WebCrypto缺失仍能安全正常提交，不套用原客户端必须加密的废弃条件。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 416: `ok 22 - T-04: actual submit hook returns only the compatibility marker with no browser WebCrypto`
- 421: `ok 23 - T-04: real cipher failures roll back feedback/comment/status and later required notifications`

## T-05 身份来源限流与持久容量

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/middleware/rateLimit.ts:39；server/routes.ts:115 POST初始化；server/clientIdentity.ts:183 identity事务容量；server/demo.ts:533、:542 clone容量；server/routes.ts:983受控503。

验收与测试覆盖：T-05.test.ts 当前6项：来源阈值2→429/Retry-After、六表snapshot无新增/变更、window恢复；同install key不同Cookie同身份且不重复副本；formal/demo满2后新issuer及无identity demo login503无Cookie；已有Cookie/R1可用；clone1/0有限合法初始化200；默认10/可配1、非法配置拒启；同库跨进程容量不复位。

具体命令/结果文件：T-05-before.txt保留修复前失败；T-05-tests.txt为早期5/5，不能误认为覆盖后加第6项；当前第6项由固定候选真实CI记录覆盖。T-05-regressions.txt和T-05-console-normalization.json保留回归/原始输出关系。

未覆盖/矛盾/边界：无缺口。早期GET已由T-26获批改POST；本项证据按当前tests/helpers实际POST核对，非沿用旧GET动作。身份长期清理另有独立任务。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 426: `ok 24 - T-05: identity source quota rejects before signing/creating/cloning; same install key reuses identity after window`
- 431: `ok 25 - T-05: durable identity capacity rejects all new issuers, keeps existing identities usable and never deletes data`
- 436: `ok 26 - T-05: default source admits ten then rejects eleventh; configurable one rejects second`
- 441: `ok 27 - T-05: zero clone allowance creates identities without copies and never returns 500`
- 446: `ok 28 - T-05: invalid identity or clone capacity configuration fails startup explicitly`
- 451: `ok 29 - T-05: restarting with the same fixture DB cannot reset durable identity capacity`

## T-06 反馈来源与身份双配额

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/middleware/rateLimit.ts:feedbackSubmitLimiter、feedbackIdentityLimiter；server/routes.ts:232验证及:255双limiter。

验收与测试覆盖：T-06.test.ts4项：身份阈值2、来源阈值3分别独立触发；N+1 429/Retry-After、业务feedback/comment/notif/stats完整snapshot不变；更换身份及非信任XFF不可绕过；无身份401、冒用deviceId403、window后恢复；默认10/可配1及非法env。

具体命令/结果文件：T-06-tests.txt：4/4；T-06-regressions.txt和frontend/backend type日志；失败复现T-06-before.txt保留。

未覆盖/矛盾/边界：无缺口。来源socket/非信任XFF测试不单独证明生产代理可信边界；当前候选代理认证的本地代码/测试已通过，生产补验仍属未完成T-24。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 456: `ok 30 - T-06: identity quota spans submissions and caller-supplied device IDs cannot select another quota`
- 461: `ok 31 - T-06: source quota cannot be evaded by changing identities or untrusted forwarded headers`
- 466: `ok 32 - T-06: default quota admits ten and blocks eleventh, boundary one is configurable`
- 471: `ok 33 - T-06: invalid source/identity/window configuration fails startup explicitly`

## T-07 评论身份配额跨反馈

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/middleware/rateLimit.ts:userCommentSourceLimiter、userCommentIdentityLimiter；server/routes.ts:676用户评论挂载。

验收与测试覆盖：T-07.test.ts当前5项：同identity跨两feedback耗同桶、401跨身份/匿名；429评论/通知完整snapshot不变；source跨identity和XFF不可绕过；window恢复；正常admin专用回复及原formal-admin走user-comment路径行为保留；默认20/可配1及非法env。

具体命令/结果文件：T-07-tests.txt早期4/4，T-07-regressions.txt补formal-admin兼容；当前5项真实CI。T-07-before.txt保留真实200应429复现。

未覆盖/矛盾/边界：无缺口；新增第5项不能用早期4/4证据代替，现由CI补齐。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 476: `ok 34 - T-07: user quota spans feedback IDs, unauthorized identities stay rejected and no comments/notices appear on 429`
- 481: `ok 35 - T-07: source quota spans identities and changing untrusted XFF cannot reset it`
- 486: `ok 36 - T-07: default identity quota is twenty; threshold one can be configured`
- 491: `ok 37 - T-07: existing formal-admin access to the user-comment route is preserved and spans target IDs`
- 496: `ok 38 - T-07: invalid limiter configuration fails startup by its name`

## T-08 恢复码尝试限流

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/index.ts:55在JSON parser前挂恢复limiter；server/middleware/rateLimit.ts:29；server/clientIdentity.ts:361、:437恢复处理。

验收与测试覆盖：T-08.test.ts4项：不同invalid codes统一404同文案、无Cookie、身份/session/install绑定/业务六表不变；阈值3后合法R1也429/Retry-After且无写入，window后原身份恢复；成功也计default10限额；畸形/超限body耗桶，Origin拒绝/preflight不耗；非法env拒启。

具体命令/结果文件：T-08-tests.txt：4/4；T-08-regressions.txt：相关28/28；T-08-before.txt与T-08-harness-initial.txt区分修复前产品复现/夹具错误。

未覆盖/矛盾/边界：无缺口；恢复码自动轮换目标由T-21单独证据覆盖。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 501: `ok 39 - T-08: different invalid recovery codes share source quota; rejected recovery cannot issue or rebind credentials`
- 506: `ok 40 - T-08: successful recovery also consumes quota, default ten-per-minute rejects the eleventh`
- 511: `ok 41 - T-08: malformed/oversized recovery POSTs consume quota before parsing; wrong Origin and preflight do not`
- 516: `ok 42 - T-08: invalid recovery limiter values reject startup by the offending configuration name`

## T-09 成功管理员登录限流

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/index.ts:54两个alias共享limiter；server/adminAuth.ts:114 login及logout；server/middleware/rateLimit.ts:21。

验收与测试覆盖：T-09.test.ts6项：success/failure/success共享来源3限额，两alias交替N+1 429无Set-Cookie且session probe不增；default10/demo也受限；注销不释放桶、window后重新login可用；formal错误5次保留15min锁，即正确密码仍429；畸形/超body先耗桶、preflight不耗、非法env拒启。

具体命令/结果文件：T-09-tests.txt：T09/T19/T40组合12/12、EXIT0；T-09-summary.txt、T-22 HTTP时钟TTL保留补验。

未覆盖/矛盾/边界：无缺口。session probe记录创建计数而非容量当前size，注销删除的现size由T-22.integration.test.ts独立断言，二者不矛盾。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 521: `ok 43 - T-09: both login aliases share successful and failed request quota`
- 526: `ok 44 - T-09: default source quota permits ten logins and rejects the eleventh without signing a session`
- 531: `ok 45 - T-09: malformed and oversized JSON consume quota before parsing; preflight does not`
- 536: `ok 46 - T-09: five wrong passwords retain the separate fifteen-minute production lock`
- 541: `ok 47 - T-09: the published demo password is also limited across aliases`
- 546: `ok 48 - T-09: invalid login limiter configuration rejects startup explicitly`

## T-10 访问统计有界增量

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/middleware/accessStats.ts:启动一次迁移事务、hasDailyVisitor覆盖索引、recordAccess原子increment；server/utils/accessStats.ts今日投影只读当日。

验收与测试覆盖：T-10.test.ts3项：独立SQL精确对次数/distinct/bot/可疑/平均/NULL denominator、UTC跨日与重复timestamp；多次重新启动迁移不重复累计；故障回滚新增列/索引后可重试；runtime统计故障response200、log/stats一起rollback；EXPLAIN证明覆盖索引。

具体命令/结果文件：T-10-tests.txt：组合8/8；命令npx --no-install tsx tests/fix/T-10.bench.ts，T-10-bench.txt/T-10-benchmark.json：Node22.23.3/M2 Pro、1万及10万各500个顺序本地/api/stats请求全200、p95 0.538875/0.407084ms、ratio0.755433≤2、事件循环p95 1.307647/1.262591ms；bench源码明确断言无SQLITE_BUSY/LOCKED/Failed to log access且计数匹配；T-10-query-plan.txt覆盖idx_access_logs_ip_created_at。

未覆盖/矛盾/边界：无原验收缺口；性能证据是固定机器旧合成基准，当前源码仍保留同一增量/覆盖索引结构且CI数值/重启测试通过，不外推生产并发吞吐。原逐请求middleware不做全表COUNT/AVG；管理显式查询的汇总不是逐请求日志写入路径。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 551: `ok 49 - T-10: atomic legacy migration, UTC day boundaries, null averages and restart are exact`
- 556: `ok 50 - T-10: failed legacy migration rolls back added columns and remains retryable`
- 561: `ok 51 - T-10: runtime statistics failure preserves responses and atomic log/stat consistency`

## T-12 反馈schema与字符字节边界

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/utils/validation.ts:3、:11；server/routes.ts:232；server/index.ts:58、jsonErrorHandler。

验收与测试覆盖：T-12.test.ts1个主矩阵：1字符200、10000中文/最坏JSON转义200；null/array/object/number/blank/非法类别/超过10000/含空格原始超长400；密文类型/blank拒绝、40080byte边界可用/超byte413；畸形JSON统一400无stack、total-body413；四类业务表计数/stat不变；device身份错403。

具体命令/结果文件：T-12-tests.txt：T12/T19组合6/6；当前CI矩阵pass；T-03兼容存储把client包丢弃且server自身认证加密，不改变1..10000契约。

未覆盖/矛盾/边界：无缺口；MAX_ENCRYPTED_CONTENT_BYTES约束兼容请求包，不能将其宣称为新server密文持久化安全证明，后者已由T03覆盖。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 586: `ok 56 - T-12: feedback input matrix rejects before business writes`

## T-13 评论类型与UTF8边界

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/utils/validation.ts:validateCommentContent；server/routes.ts:584两角色公共评论验证；app/foorpynona/page.tsx:1017 maxLength1000。

验收与测试覆盖：T-13.test.ts1个双角色矩阵：undefined/null/object/array/number/blank/1/1001中文均400且comment/notif不变；2/1000中文200且精确读回；另一identity401无写。

具体命令/结果文件：T-13-tests.txt：组合7/7；T-13-browser.txt真实native type1001中文被限制1000、发送成功、SQLite精确1000中文/3000bytes；当前CI矩阵pass。

未覆盖/矛盾/边界：无缺口；browser虽是早期证据，当前maxlength/验证契约仍一致。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 591: `ok 57 - T-13: both comment routes validate types and preserve bounded UTF-8 text`

## T-14 处理说明上限与状态错误

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/utils/validation.ts:validateSolutionContent；server/routes.ts:414；app/foorpynona/page.tsx:934 maxLength10000与计数。

验收与测试覆盖：T-14.test.ts1个完整状态矩阵：三个状态的object/array/nonstring/超10000均400且feedback字段/log/notif不变；in_progress省略说明200；resolved/no_solution空/9拒绝、10成功；10000中文成功、认证v1存储且user读回准确；非法status400。

具体命令/结果文件：T-14-tests.txt：组合6/6；T-14-browser.txt textarea9999+2实际10000、办结aria-pressed且SQLite精确10000中文/30000bytes；日志诚实注明browser启动早于backend patch，后端拒绝验证由新进程HTTP矩阵完成。

未覆盖/矛盾/边界：无缺口；不把旧browser进程当新后端拒绝证明。前端限长/计数与新HTTP边界相同；故障draft/error展示由T04真实browser覆盖。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 596: `ok 58 - T-14: approved solution length/type boundary rejects before status/log/notification writes`

## T-15 Next目标漏洞最小升级

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：package.json/package-lock.json next16.3.6；lock必须@next/env/swc；tests/fix/T-15.smoke.ts、T-15.rollback.ts；此任务没有T-15.test.ts，原验收指定生产smoke与回滚。

验收与测试覆盖：T-15-main-install.txt clean npm ci、T-15-main-versions.txt树16.3.6/React18.3.1、T-15-main-runtime.txt ABI/tree成功；T-15-main-root-audit.json目标GHSA-vcvr-r3jv-pc5j消失；type和build原始日志真实成功。当前候选CI再次clean安装/build/ABI。

具体命令/结果文件：命令npx --no-install tsx tests/fix/T-15.smoke.ts：T-15-main-http-smoke.txt三页面200/10静态200/API rewrite及用户/admin Cookie/身份/通知正常；T-15-browser-verification.txt真实UI同记录/管理登录/通知定位/统计；npx --no-install tsx tests/fix/T-15.rollback.ts：T-15-rollback-rehearsal.txt实际旧16.3.3安装树/native ABI/旧BUILD_ID另端口运行、三页面和生成静态asset200，主目录仍16.3.6。

未覆盖/矛盾/边界：无目标advisory/功能/恢复验收缺口。当前CI root还有4个已记录advisory、critical0，不把原target消失写成当前Next或全依赖树无告警。

## T-16 HTTP parser/路由依赖漏洞

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：两个package-lock.json：body-parser2.3.0/qs6.16.0、path-to-regexp root8.4.0/server8.4.2；server/index.ts parser及统一错误处理。

验收与测试覆盖：T-16.test.ts3项：root/server实际包版本和有界prototype/stringify、非法body-limit不能静默关闭、过多optional路径编译拒绝、正常match；实际HTTP aliases/identity授权、重复及array query可处理、畸形JSON400/1MiB413且health200，反馈总量仍1；T12/T13复用业务矩阵。

具体命令/结果文件：T-16-root/server-install.txt和tree.txt清洁安装一致；T-16-root/server-audit.json、T-16-summary.txt目标advisories absent、其他告警保留；T-16-tests.txt3/3，type/build成功；当前CI3项重验。

未覆盖/矛盾/边界：无缺口。root/server审计退出1为当时其它告警，不算目标依赖失败；最新server审计0。未把query array正常解析假设成所有业务参数允许array。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 601: `ok 59 - T-16: root HTTP parser dependencies reject known malformed shapes`
- 606: `ok 60 - T-16: server HTTP parser dependencies reject known malformed shapes`
- 611: `ok 61 - T-16: actual backend routes and bounded HTTP parser failures preserve availability`

## T-17 ip-address目标漏洞

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/package-lock.json ip-address10.7.1；server/middleware/rateLimit.ts实际express-rate-limit；tests/fix/T-17.test.ts。

验收与测试覆盖：T-17.test.ts2项实际分类/IPv4/IPv6跨族子网/畸形长输入/IPv6桶归一化；真实loopback Express挂现有limiter，127.0.0.1与::1分别第11请求429/Retry-After且health200。

具体命令/结果文件：T-17-server-install.txt、T-17-server-tree.txt、T-17-summary.txt及T-17-server-audit.json：目标四advisories消失、树10.7.1、clean ci/ABI/types0；当时剩proxy-addr后续另任务；T-17-tests.txt组合10/10。当前CI2项passed/server生产audit0。

未覆盖/矛盾/边界：无缺口。早期独立test route证据未冒充当时尚未挂的生产limiter；现在生产各接口由T05..09已单独证据覆盖。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 616: `ok 62 - T-17: patched IP classifications and malformed inputs preserve address-family boundaries`
- 621: `ok 63 - T-17: existing limiter enforces independent IPv4/IPv6 socket sources on a local route`

## T-18 真实后端CI与失败门禁

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码： .github/workflows/ci.yml：两目录clean npm ci/npm ls、native ABI、frontend type、旧server script加显式strict全部server文件、Next build、tsx全编号测试、审计artifact/构建artifact。

验收与测试覆盖：固定候选真实GitHub pull_request run38033385313/head5c23a042e807b92312dac8fa1a9dc2e6037f575d/build(20.x)success；实际原始log两npm ci第一轮成功、check-runtime、两type/strict/build、repair门禁通过；252 tests/251pass/0fail/1既有T41 skip。

具体命令/结果文件：T-18-candidate-5c23a04-actual-CI.json（job114158747179）、actual-CI-log.txt:178/223/242/243/248/256/305/1582/1626、actual-artifacts.json：dependency-audit1802bytes和build25765862bytes均实际非expired且SHA候选一致。T-18-startup-fault.txt隔离Node20 fixture顶层throw：全tests gate EXIT1/5fail；恢复入口后EXIT0/5pass，满足原允许本地fixture破坏启动的负验收。旧59db49b失败CI保留。

未覆盖/矛盾/边界：无当前候选缺口；failure-only debug step skip正常，T41 placeholder skip不是通过。root audit warning4与server0准确记录；不将后续纯文档提交视为新CI通过，不推导生产已部署。

## T-19 安装树ABI与启动基线

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：scripts/check-runtime.cjs只读两tree/native SELECT；scripts/start.sh预检；tests/fix/helpers.ts显式隔离DB/随机合成密码/key、production与loopback；server/adminAuth.ts:29配置拒绝。

验收与测试覆盖：T-19.test.ts当前6项：显式DB路径重启复用同库；production启动health由helper真实ready确认、身份/跨身份拒绝/评论/管理状态/回复/通知完整业务；SESSION_SECRET缺/短及formal password缺/短均指定错误非0。

具体命令/结果文件：T-19-installation.txt两实际npm ci/npm ls、T-19-runtime.txt Node22.23.3 ABI成功、T-19-wrong-abi.txt Node25预检EXIT1；T-19-tests.txt早期5/5和T-19-fixture-reuse.txt新增DB复用通过。固定候选实际Node20 clean安装native ABI+6项pass，明确runtime结果而不凭现有node_modules。

未覆盖/矛盾/边界：无缺口。旧server npm type script本身继承exclude不覆盖业务入口，不能独立用作全后端证明；当前CI追加strict全文件已补覆盖。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 626: `ok 64 - T-19: restarting an explicit fixture database returns and opens that same database`
- 631: `ok 65 - T-19: isolated production backend and existing authorized flow run`
- 636: `ok 66 - T-19: production rejects missing secret`
- 641: `ok 67 - T-19: production rejects short secret`
- 646: `ok 68 - T-19: production rejects missing password`
- 651: `ok 69 - T-19: production rejects short password`

## T-20 用户敏感API no-store

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/index.ts:38四private前缀统一no-store并去If-None-Match/If-Modified-Since；静态与public stats保留缓存。

验收与测试覆盖：T-20.test.ts2项：owner/other/anonymous/admin真实Cookie矩阵，用户记录/评论/通知/身份/admin data/session/errors均no-store；持原ETag本人200、他人401/403无304；条件日期也完整；Next dev rewrite再次同matrix；Next production start真实build chunk200/public,max-age31536000,immutable且bytes>0，无build即failure。

具体命令/结果文件：T-20-tests.txt组合7/7、EXIT0；T-20-initial-tests.txt保留错误测试目标/修正记录；固定候选CI两项均passed，CI已build保证静态输入。

未覆盖/矛盾/边界：无本地验收缺口；线上header补验需发布后另做，不外推当前公开站。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 656: `ok 70 - T-20: private responses and authorization errors never reuse a conditional cached body`
- 661: `ok 71 - T-20: actual Next rewrite preserves no-store while production static chunks retain caching`

## T-21 缓存丢失不轮换恢复码

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/clientIdentity.ts:274 matchingCode/cache miss返回可选缺码且不改hash；app/hooks/useCrypto.ts:131仅展示本次验证code；app/page.tsx:736明确缺码与禁复制。

验收与测试覆盖：T-21.test.ts7项：Cookie/install-key各缺/错码重启、注入10min cache TTL过期、并行两tab同install key；DB recovery_hash逐次相等、另Cookie保存R1恢复同身份/同记录，正常匹配码继续有效。原GET接口随后改为只读兼容、POST初始化；现tests执行POST。

具体命令/结果文件：T-21-before.txt修复前6fail/1pass；T-21-final-regression.txt关联18/18；T-21-browser-result.json四个真实production build/start UI：只清本地码+重启/缺码提示和Copy disabled、独立Cookie/storage用R1找回原记录、错码不展示、匹配码展示；T-21-final-checks.json最终type/build/tests成功。

未覆盖/矛盾/边界：无缺口。两tab并发为真实HTTP fixture而非UI两个物理标签页；原指定关键真实browser清本地码+重启+独立上下文找回已有直接证据，不用类型检查代替。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 666: `ok 72 - T-21: restart with valid Cookie and missing code preserves R1 and its records`
- 671: `ok 73 - T-21: restart with valid Cookie and mismatching code preserves R1 and its records`
- 676: `ok 74 - T-21: restart with valid installation key and missing code preserves R1 and its records`
- 681: `ok 75 - T-21: restart with valid installation key and mismatching code preserves R1 and its records`
- 686: `ok 76 - T-21: expired display cache with valid Cookie never revokes R1`
- 691: `ok 77 - T-21: expired display cache with valid installation key never revokes R1`
- 696: `ok 78 - T-21: two initializing tabs share one identity and matching codes remain valid`

## T-22 Map自动到期与固定容量

验收是否有客观证据：是，覆盖原已批准完成范围。

当前源码：server/utils/expiringMap.ts；server/adminAuth.ts:24两个Map/预留容量/503/注销；server/clientIdentity.ts recentRecoveryCodes Map FIFO，仅display缓存不改变R1。

验收与测试覆盖：T-22.test.ts11项：注入clock及真实callback、exact expiry、8h/15min/10min TTL、60s/unref/close不挂进程、sessions1000/attempts10000满拒不踢有效项、code10000 deterministic FIFO、capacity过期复用、logout立即delete。T-22.integration.test.ts4项真实HTTP与真实bounds探针：满demo login503无Cookie/identity/clones，TTL前10sec仍合法、无人再lookup sweep清空、invalid signature不影响合法token、logout0；failure-store满拒新source/保留lock、全10k无人lookup过期；code eviction/TTL后R1仍recover、identity失败释放预留session。

具体命令/结果文件：T-22-result.json与T-22-regression.txt组合34/34，T-22-http-boundaries.txt最新4/4（不累计为38）；固定候选CI15个本项测试passed。原夹具错表/状态report写读竞态失败记录保留，最终atomic publication后通过；T-22-backend-type/ frontend-type0。

未覆盖/矛盾/边界：无缺口。进程内存策略符合本项，重启重新登录/单实例产品契约由T23独立验收，不声称persistent/multi-instance session。

固定候选实际CI逐测试结果（actual-CI-log.txt行号）：

- 701: `ok 79 - T-22 HTTP capacity refuses demo login before cookies/identity/clones, preserves valid sessions, timer reclaims and logout deletes`
- 706: `ok 80 - T-22 HTTP full failure store rejects a new source, retains old lockout and automatically expires all 10000 entries`
- 711: `ok 81 - T-22 real display cache evicts oldest at 10000 without changing saved R1, and timer expires entries without reads`
- 716: `ok 82 - T-22 demo identity failure releases the reserved admin session and never signs cookies`
- 721: `ok 83 - T-22 timer frees expired entries without any later lookup and uses unref/60s`
- 726: `ok 84 - T-22 expiry boundary is inclusive and expired gets discard the entry`
- 731: `ok 85 - T-22 session expiry remains exactly 8h, attempts 15min and display codes 10min`
- 736: `ok 86 - T-22 full session storage rejects a new entry without displacing valid sessions`
- 741: `ok 87 - T-22 full source-attempt storage does not discard valid lockouts`
- 746: `ok 88 - T-22 capacity is recovered from expired entries before rejection or eviction`
- 751: `ok 89 - T-22 code display capacity evicts the oldest successful set deterministically`
- 756: `ok 90 - T-22 logout delete is immediate and close cancels cleanup once`
- 761: `ok 91 - T-22 invalid capacity/expiry reject without corrupting valid entries`
- 766: `ok 92 - T-22 real cleanup timer is unrefed so an otherwise idle process exits`
- 771: `ok 93 - T-22 configured 1000 sessions and 10000 attempt/code bounds hold under a full fill`


### T-23 — 有客观证据；覆盖已选单实例/重启重新登录契约

源码：`ecosystem.prod.config.js:27/46` 的两个角色均 instances=1；`server/adminAuth.ts` 保持内存会话；`app/foorpynona/page.tsx:140` 的 clearProtectedState 清空列表/详情/评论/通知/筛选游标/草稿/密码/定位参数并推进请求 epoch；401 提示及页面文案准确；`DEPLOY.md:196` 明示8小时与进程重启失效。

执行：`tests/fix/T-23.test.ts` 的同DB、同内容密钥、同签名密钥真实后端重启→旧会话401→新登录200→注销401，以及两角色配置，共2项，在固定候选CI出现并通过；`T-23-http-tests.txt` 保存单项结果。8小时TTL由既有 T-22 时钟边界覆盖。`T-23-browser-restart-acceptance.json`、`T-23-browser-restart-flow.js` 有独立实际6项返回结果：真实重启、401、受保护DOM和密码清空、重新登录旧草稿不回填、注销；重启前后合成四表计数一致，401/后续200网络事件均记录。

未覆盖/限制：没有持久化或跨实例支持，这是用户选定的契约，不是缺验收；浏览器没有等待8小时，TTL由模块测试覆盖。共享的管理员幂等2项属于T-42，不重复计入6项。

### T-26 — 有客观证据；覆盖全部写路由来源防护及只读GET/HEAD身份分支

源码：`server/index.ts` 在解析、鉴权/写入前注册 `/api` 的 cookieWriteOriginGuard；`server/middleware/requestOrigin.ts` 只接受显式 canonical Origin；身份 handler 位于 `server/clientIdentity.ts`，GET/HEAD只读，POST初始化/恢复走来源防护；前端已切 POST。当前与5c23a04相同。

执行：`tests/fix/T-26.test.ts` 两主测试涵盖14条已有写路由/alias ×7缺失/恶意/畸形来源、Host伪装及formal/demo GET/HEAD/POST、有效/失效/畸形Cookie、到期、安装密钥边界，拒绝/只读前后业务/身份快照不变；`T-26-identity-final-regression.txt` 2 pass/0 fail，固定候选CI也通过。`T-26-identity-browser-network.json` 记录同站恶意子域确实发送两类Cookie但身份POST/logout均403/noSetCookie、身份状态不变；异站未发送Cookie仍403；不可信GET只读200/noACAO/无变更。`T-26-identity-acceptance.json` 与 `T-26-identity-normal-network.json` 记录生产Next+合成backend初始化POST/提交/记录读取正常；先前 `T-26-normal-browser-verification.txt` 与 DB verification 记录双方正常写流程。

未覆盖/限制：浏览器同站/异站Cookie观测使用隔离development域名以观察本地非Secure Cookie，production拒绝另由真实HTTP矩阵验证。无当前阻断缺口，不把CORS/CSRF本地成功称为已部署。

### T-27 — 有客观证据；覆盖显式Origin/CORS及浏览器读取阻断

源码：`server/middleware/requestOrigin.ts` 的 parseAllowedOrigins/exactCorsOrigin 无主域/localhost兜底，缺配置/通配符/路径/凭证/非规范值拒绝；`server/index.ts` 实际使用；`.env.example`/`DEPLOY.md` 明示必须显式配置。

执行：`tests/fix/T-27.test.ts` 4项、`T-27-tests.txt` 4 pass/0 fail，固定候选CI通过：无效配置真实启动非0、准确预检ACAO、凭证读取、无`*`组合。`T-27-browser-network.json` 实际5条事件：准确源登录/读取200有ACAO；同站另一端口Cookie发送/服务返回已认证但无ACAO；外站Cookie未发送/未认证且无ACAO。浏览器夹具 `tests/fix/T-27.browser.ts` 和执行条目记录实际页面 TypeError 阻断读取。

未覆盖/限制：没有利用CORS证明所有外站POST携Cookie；同站读取确实被CORS挡住。隔离本地域名的观测边界已披露，无缺证据的必要检查。

### T-28 — 有客观证据；覆盖危险死图床实现归档/无活跃调用

源码/资产：`archive/unsupported-uploads/FileUpload.tsx.txt`、`imageUpload.ts.txt` 逐字归档；本轮按 `T-28-archive-static-result.json` 重算SHA与3009/1857字节均一致。README仍说附件未实现，归档说明禁止直接启用。当前 `rg -n 'api\.imgbb|api\.imgur|NEXT_PUBLIC_IMGBB|NEXT_PUBLIC_IMGUR|upload-local|LocalFileUpload|FileUpload' app server .env.example --glob '!**/node_modules/**'` 没有活跃上传命中。

执行：`T-28-archive-static-result.json` 保存搜索/引用/归档结果；修正夹具后的 `T-21-final-type.txt` / `T-21-final-build.txt` 两门禁退出0，固定候选CI再次types/build成功。`T-28-browser-result.json` 记录真实浏览器文本提交/详情/双方评论/管理状态及资源观察：外域空、fileInputs0、ImgBB/Imgur请求0；对应 `T-21-browser-request-paths.json` 提供合成路径证据。

未覆盖/限制：浏览器资源摘要只覆盖这些现有流程，不是全站HAR或第三方上传功能验证；当前静态无活跃调用支持原验收。最初类型失败是T21夹具参数，保留失败且后续通过。

### T-29 — 有客观证据；覆盖死本地上传组件归档及文本流程

源码/资产：`archive/unsupported-uploads/LocalFileUpload.tsx.txt` 实测3423字节、SHA与 `T-29-archive-result.json` 相同；README/归档说明明确未实现 `/api/upload-local`。上述当前rg对app/server无命中。

执行：`T-29-checks.json` 保存 active-search exit1（无命中）、type-check/build exit0，日志 `T-29-type.txt`/`T-29-build.txt` 可读，最新固定CI再验types/build。`T-29-archive-result.json` 的实际IAB合成production文本提交成功/记录可见，提交13资源、外域/upload-local/fileInput均0；`T-29-browser-fixture.json` 明示隔离fixture。

未覆盖/限制：不实现上传接口，不以归档验收宣称附件支持；原标准不要求新增上传测试。浏览器为资源观察摘要，未见原目标缺口。

### T-30 — 有客观证据；纯文档边界正确

源码/说明：`.env.example:21`、`README.md:171/295`、`docs/DEPLOYMENT.md:66/81/88` 只保留准确弃用/兼容占位；说明管理Cookie、用户Cookie/归属及公开健康/统计/演示配置。当前对app/server的API_TOKEN搜索无读取点，没有新增token协议。

执行：原命令 `rg -n 'API_TOKEN' .env.example README.md DEPLOY.md docs/DEPLOYMENT.md`，`T-30-active-docs.txt` / `T-30-runtime-lookup.txt` / `T-30-verification.txt` 保存准确说明和无运行读取，文档diff/diff-check通过。当前再次只读检索结果一致。

未覆盖/限制：保留赋值占位由紧邻注释准确标弃用，不能把单独字段出现算失败；纯文档无新增业务测试符合原要求。没有改真实环境。

### T-31 — 有客观证据；覆盖公开有效限流env读取点/实际1与3边界

源码：`server/middleware/rateLimit.ts` 实际读取7个max/5个window，旧RATE_LIMIT_MAX出现时无值弃用警告；`.env.example:57..73`、`DEPLOY.md:162`起配置索引逐项默认/单位/作用域对应。`positiveIntegerEnv` 保持非法启动失败。

执行：`tests/fix/T-31.test.ts` 七个请求最大值分别1与3、其它配额100隔离，前N次200/N+1为429、有RateLimit-Limit/Retry-After、无SetCookie、业务/身份表计数不变；旧字段=1仍按默认10次并警告。`T-31-tests.txt` 16 pass/0 fail；关联 `T-31-regressions.txt` T05..09/T31共41 pass。各窗口恢复及非法/负数配置在T05..09实际测试覆盖，固定CI包含全部这些测试及T31。

未覆盖/限制：单进程env/限流行为有证据，真实代理与生产启用仍由T24/T35独立负责，不在这里关闭。

### T-36 — 有客观证据；四模块/注册/HTTP/重复初始化/最终CI已闭合

当前 `server/index.ts` 显式顺序：配置/统一保护→公开路由→会话签名→管理/访问路由→openDatabase/initializeBusinessSchema→createClientIdentity→身份/业务路由→最终错误处理→listen清理；四模块真实存在：`server/adminAuth.ts`、`server/clientIdentity.ts`、`server/schema.ts`、`server/routes.ts`。统一校验/limiter的路由引用保留，未新增另一套冲突实现。

独立Git提交可查：S1 `ccf3fd0` 管理认证，S2 `4374301` 身份，S3 `b86e798` schema，S4 `bf25a02` routes。`T-36-S1-result.json`、S2、S3、S4及各日志分别保存38/38、42/42、65/65关联通过，S3自身4/4、S4自身5/5。按每文件公开manifest哈希核对：S1 8份、S2 8份、S3 6份、S4 19份，共41份，全部一致。

S0基线43注册由 `T-36-route-baseline.json` 留存；后续 `T-36-S4-runtime-registration-trace.json` 与S0一致且实际应用调用而非源码字符串计数。`tests/fix/T-36.test.ts:210` 的双login/session/logout alias、Cookie原Path=/和Max-Age28800、安全标志、具体参数反馈/评论/状态/通知/删除、401/404/畸形URI400实际HTTP在最新CI通过。S1/S2/S3/S4机械证据保留函数AST、原SQL字节及索引/初始化顺序；它们与实际HTTP共同支撑等价，不单独替代业务验证。

`tests/fix/T-36.test.ts` formal/demo旧合成schema各真实启动3次、直接初始化2次、错钥/缺钥重复拒绝、schema失败不吞错与修正故障后恢复，五项均出现在固定CI并成功。S4本地250 pass/0 fail/1旧skip，两types/strict/build/diff成功。`T-36-final-proxy-chain.txt` 保存最终真实本机Nginx→Next→Express59/59；最新固定CI251 pass/0 fail/1旧skip，`T-36-final-closure.json`绑定同SHA。

未覆盖/限制：先前行为基线失败被保留，采用夹具修正后207 pass/0 fail/1skip的完整基线；S4新Cookie断言错误的失败也保留，未改产品迎合测试。真实生产历史/上线任务仍进行中，不属于四模块等价目标。无缺证据的必要补验。

### T-37 — 有客观证据；API与真实浏览器分页/筛选/通知/处理均覆盖

源码：`server/utils/adminFeedbackPagination.ts` 默认50/最大100、created_at+id稳定cursor、筛选与授权context绑定、160 Unicode codepoint摘要白名单/权威counts；`server/routes.ts`授权详情；`app/foorpynona/page.tsx`服务端筛选、前后页、独立详情/通知定位。

执行：`tests/fix/T-37.test.ts` 1000条含同时间fixture、完整遍历无重漏、边界cursor/权限、全文搜索/过滤/全局概览、demo、旧路径限100、通知/处理，`T-37-final-tests.txt` 6 pass/0 fail，固定CI同六项通过。`T-37-browser-flow.js` 实际UI操作，对应 `T-37-browser-result.json` 14项pass：50条首/次页互斥/前页精确复原、跨页筛选、摘要/全文详情、处理后概览251/249、非当前页通知不插入列表与URL重载。`T-37-browser-network.json` 实际9个列表响应，max rowCount=50，详情>160字符、PUT成功与通知未读0被记录。

未覆盖/限制：无参回滚兼容路径保留旧字段/全文但限100；摘要白名单证据针对新分页契约，不声称旧客户端兼容结果也全改摘要。这是计划明确的兼容步骤，已有单项cutover测试，不是隐藏全量路径。浏览器仅首/次页及目标，完整1000无漏由HTTP覆盖。`bytes`为压缩传输body，解码后JSON体积另由HTTPassert覆盖。

### T-38 — 有客观证据；用户分页/授权与恢复身份隔离覆盖

源码：`server/utils/userFeedbackPagination.ts`从授权identity取范围、稳定cursor/全授权搜索/counts/摘要；`app/page.tsx`列表/详情/通知分离、身份变化推进请求序号并清旧状态。

执行：`tests/fix/T-38.test.ts` 1000总记录/两身份各500、同时间完整翻页、跨身份401、filter/cursor绑定、摘要外全文搜索、全局counts、恢复后归属变化与demo隔离，`T-38-tests.txt` 4 pass/0 fail，固定CI通过。`T-38-browser-flow.js` 与 `T-38-browser-result.json` 实际恢复A（合成浏览器fixture每身份1000）、首/次/前页、跨页组合筛选/全文详情/通知、UI恢复B清A详情/通知与A专属搜索0，共12项pass；`T-38-browser-network.json` 21个列表响应全部≤50，通知未读0。

未覆盖/限制：HTTP每身份500与浏览器每身份1000是两类合成fixture，不是计数冲突；完整无重漏由HTTP遍历。旧无参路径同样限100兼容，摘要保证针对新分页契约。无当前缺证据。

### T-39 — 有客观证据；双方评论完整分页/增量/迟到响应覆盖

源码：`server/utils/commentPagination.ts` 最新/older/after有界、同时间id排序、真实COUNT/线程和reader cursor绑定；`app/hooks/useCommentPagination.ts` 使用owner/thread/request epoch、合并ID去重保留旧页；两页面均接入。

执行：`tests/fix/T-39.test.ts` 250同时间线程完整分页、双方权限、123条增量加载保持旧100、真实total/边界/demo，`T-39-stage1-tests.txt` 4 pass/0 fail，固定CI通过。`T-39-user-flow.js` / `T-39-admin-flow.js` 实际UI对250→251→252条逐页加载/发送/保留旧页排序去重，`T-39-browser-result.json`保存用户7项/管理员3项及恢复B隔离结果。`T-39-browser-network.json` 15个评论响应max50，存在真实delayed=true的A响应；fixture扣留→页面切B显示3条→释放A后仍为B，是迟到响应行为实证。

未覆盖/限制：首轮探针把非唯一子串误认唯一而失败，不计pass，重启新合成fixture后全套通过；未改产品搜索语义。旧接口最新100有界；未引入实时聊天。不需补跑。

### T-40 — 有客观证据；非法limit/权限/数量/存活覆盖

源码：`server/routes.ts:801`附近通知limit解析只接受单十进制string的安全整数1..100，重复/数组/括号key拒绝；默认20，鉴权先于读取，SQL绑定受限。

执行：`tests/fix/T-40.test.ts` 每角色150可见合成通知，20缺省、1/20/30/99/100精确最新序列，26种非法输入×用户/管理52次400，跨身份/匿名401/403、隐藏通知不可见、health200且无SQL500日志；`T-40-tests.txt` T19+T40共6 pass，`T-40-summary.txt`列实际矩阵，固定CI的T40测试通过。

未覆盖/限制：没有新增通知分页；本地关闭负limit问题不代表生产已上线。无本项必要缺验收。

### T-41 — 有客观证据；明确限反馈/双方评论/状态三类事务

源码：`server/routes.ts`反馈/状态/评论使用现有SQLite IMMEDIATE事务，业务/统计/必须通知/状态日志同事务，提交后响应；通知写入不吞错，可选访问日志独立失败。

执行：`tests/fix/T-41.test.ts` 用触发器模拟反馈INSERT/统计UPDATE/通知INSERT、双方评论INSERT/通知INSERT、状态日志INSERT/UPDATE/通知INSERT失败，逐表完整字段快照相同；成功一套、同状态说明不重复通知、可选访问日志失败仍成功。`T-41-before-tests.txt`保留9失败，`T-41-after-tests.txt`14 pass/0 fail/1明确delete占位skip；最新固定CI同矩阵通过。

未覆盖/限制：T34删除是独立任务，旧skip未当通过；历史孤儿处置不在T41中。事务也不证明重试去重，该项由T42独立实证。无本项补检查需要。

### T-42 — 有客观证据；实际页面丢响应重试、生命周期和后台矩阵覆盖

源码：`server/utils/requestIdempotency.ts`scope/action/key唯一、同事务业务/通知/加密快照、7天到期409/5分钟时钟偏差/清理500条、删除目标410；`server/routes.ts`反馈和双方评论POST/alias接入、状态PUT未扩展；`app/utils/pendingAction.ts` sessionStorage仅key/action/target，失败保留、刷新重用、改内容不自动换键、存储失败不发请求；两实际页面发送header。

执行：`tests/fix/T-42.test.ts`10项（同key同payload重复/两进程并发、同结果、409、跨身份scope、新key同正文、故障回滚、7天/清理前后不重建、真实重启user重放、加密泄露扫描、前端存储故障/生命周期），`T-42-main-tests.txt`10 pass/0 fail，固定CI逐项通过。

实际页面：`T-42-browser-acceptance.json/.md`与feedback/user-comment flow、网络/run2-state公开合成证据，19项T42 pass（反馈10/用户7/管理2）；反馈首次提交已落库丢响应、刷新换正文409再原文同键同ID，仅+1反馈/+1通知；用户评论成功正文截断后页面错误/草稿保留，手动重试同key哈希/同ID计数不变，存储故障无HTTP写入、恢复原未发送键只+1；管理员事件30/31同key哈希/ID6，首次确已落库且body截断，明确另作事件35新key/ID7只+1。最终独立只读DB计数4/7/6/4与fixture56条网络/liveState一致；没有合并run1和run2计数。

未覆盖/限制：run1用户评论被Chromium自动重试导致等待UI错误超时，不算成功；run2仅修夹具传输机制后通过。管理员combined flow中断，未返回草稿/编辑断言不计pass；独立 `T-23-browser-restart-flow.js` 实际核对三条管理写事件及7评论才计2项。管理员中间4/6/5/3为已披露网络事件推断，最终完整DB计数重新独立核对；这不影响原“同动作不重复”的证据。浏览器未新验身份B的幂等隔离，已有后端formal/demo scope矩阵覆盖。共享T23六项/T33说明一项不重复计数。无需以中断脚本为理由重跑已覆盖目标。

### T-43 — 有客观证据；两锁/当前实际安装树/目标advisory/IP矩阵均覆盖

当前只读 `npm ls proxy-addr --json` 与 `npm --prefix server ls proxy-addr --json` 均退出0、通过各自Express树显示 **2.0.8**；root/server lock与各自node_modules包元数据均2.0.8，与固定候选一致。

执行：`T-43-main-tree.txt` / main-server-tree及两clean安装/ABI日志保留原安装树结果。`tests/fix/T-43.test.ts`5项两树IPv4/IPv6/mapped正反例、各12种真实Express trust/socket/XFF矩阵及跨身份拒绝；`T-43-parent-integration.txt`保存T43/T09/T17/T19共18 pass/0 fail/0skip，两types及strict实际后端编译退出0。最新固定CI也包含T43五项与关联限流/授权测试。`T-43-negative-control.txt`保留2.0.7错误接受→2.0.8拒绝的两树八对照，实际退出0；首次旧目录解析失败独立保留。

`T-43-main-root-audit.txt`、main-server-audit目标 `GHSA-jqcg-44mw-7w3h`均不存在；固定候选CI server audit0、root有4个非目标残留并有实际artifact。T43原执行记录root critical1为当时依赖树的历史结果，最新固定候选已critical0/high3/low1，不能混写为当前critical1或全安全。

未覆盖/限制：库负对照不证明当前线上trust proxy策略可利用；真实生产链依旧归T24/Q05，不借T43关闭。没有为最新registry重跑audit：本任务核对指定固定候选实际日志/安装版本，目标修复及其既有验收已覆盖。


## 主代理复核与来源

独立复核覆盖20/15项；主代理核对原任务范围、当前代码与固定候选无diff、真实CI TAP/步状态/artifact、每编号ok记录与非测试门禁、关键分页/幂等浏览器原始结果和归档/文档证据。修正独立原报告将T24称已完成的单处措辞：T24仅本地通过，整项仍未完成。未更改产品/范围，未读取或发布真实DB/key/inventory。独立原始报告私有保留：
- `/private/tmp/anonyproof-completion-audit-01-22-20261010.md`，SHA256 `fc47d01702edece78f80b28c374f5d46f2d832ca91c80c842d02f3498e0f18e1`。
- `/private/tmp/anonyproof-completion-audit-23-43-20261010.md`，SHA256 `ce73960f072a4e9676a81d9e0f5cd1076059fb4ff95304e6e94b8f308747d27d`。

全量目标未完成。C/E/F获批并分别实施、对应验收通过后，才能解除阻塞并独立关闭任务。

2026-10-11 04:06:27 UTC 实际低频只读HTTPS探针：根、/anonyproof、/anonyproof/api/demo/config 均503，Retry-After=300、维护标记approved-ab-20261009；未发布新站，未输出响应正文。
