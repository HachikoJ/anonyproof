# T-32 合成候选库转换准备

2026-10-07。依据Q-02已批准“新旧格式迁移准备可推进”；实际保留映射/资产操作仍等待Q-04/Q-07及具体确认。不是正式历史迁移完成记录。

## 入口及行为

`scripts/content-migration-candidate.ts`只导出 `prepareContentMigrationCandidate({ sourcePath, destinationPath, contentKey })`，不注册CLI、不加载env、不被业务服务导入。路径必须显式绝对路径，源为已存在普通文件，目标为全新`.db`且父目录已存在；目标已存在（含坏symlink）拒绝，不覆盖源、目标或备份。独立32字节Base64内容key仅作为调用参数，不写报告/日志。当前仅在新随机合成fixture中调用，不提供实际资产执行命令。

工具用于**已选定保留的正式数据快照**；演示/副本/未知标记拒绝，不从行标记推断实际实例归属。三个内容表必须有已审阅字段和单列id主键；缺列、不支持主键、未知/非integer字段版本、任何未审阅触发器拒绝。当前旧schema缺版本列可在候选快照内补默认0；原库不加列。不自动修复孤儿/清空字段/改身份或决定历史去留。

1. readonly+query_only连接源，用SQLite在线backup取得一致快照（包含提交WAL），在目标父目录创建独立0700工作目录并预留0600快照。内存不一次读取整个库。
2. 仅工作快照使用DELETE回滚日志、secure_delete、FULL同步；日志在私人工作目录，避免大库将全部回滚页放入内存。temp_store使用MEMORY；内容按id一次128行读完后更新，避免通过活动iterate游标写库。
3. 一个同步IMMEDIATE事务内补版本列、验证/创建既有T-03内容key marker、转换正文/说明/评论/通知title+content。显式0按现有reader的原文字段密封，包括`apc:`样式的字面原文；显式1逐条认证且保持原密文，不重复生成nonce。AAD与现有reader完全一致。
4. 新复制的反馈`encrypted_content`仅保存`server-encrypted:v1`，不继续公开保留旧自带key包。当前reader使用`original_content`为正文依据；**原文字段缺失或NULL拒绝，旧原文为空且仍有非标准旧包亦拒绝**，不能把新增列默认空串当成正文已经保存。旧包与原文字段其它语义冲突仍需实际映射核对；工具不解读任意旧客户端包、不授权销毁唯一源。NULL说明/通知内容也明确拒绝，不能擅自变成空串或更改HTTP null语义。
5. 所有已有表数量不变，唯一可新增/初始化的记录为内容key marker；其它表/身份/状态/时间/审计原样保留。源内非NULL孤儿保留，不由转换顺手清理。报告只输出固定业务/身份表计数及转换数量；未知schema名字、内容、ID、设备、恢复码、key不导出。
6. 提交后integrity_check；VACUUM INTO新的0600候选，重建页以去掉已替换字段的旧页残留；重开检查完整性和数量、fsync、hard link原子且不覆盖地发布目标。工作candidate与目标为同inode，**不能当两个独立备份，也不能原地修改任一后声称另一仍可恢复**。

任一步失败不激活、不删除任何旧资产；事务阶段失败撤销新版本列/marker/已改字段，目标未发布。异常只含固定code和工作目录，原SQLite/加密错误不转发。工作快照/回滚页可能含原文和旧key，失败后保留在受限工作目录；这也是以后必须列入具体资产处置清单的副本，不能忽略。发布遭遇另一个已创建目标时保留该文件，返回失败；操作者查当前状态，不盲目再次覆盖。

`sourceModified:false`指源业务数据未更新；只读连接仍可能参与SQLite锁/共享内存协调，不能据此普遍宣称所有sidecar字节都不变。本轮DB/WAL hash不变只是对应合成fixture的实际结果。

## 验收与剩余门禁

`npx --no-install tsx --test --test-concurrency=1 tests/fix/T-32-candidate.test.ts tests/fix/T-32.test.ts tests/fix/T-03.test.ts`：以独立合成源验证当前准备工具，原始失败/修正后的最终结果分别保留。类型和diff-check另记。不得把测试文件名T-32或candidatePrepared=true当整项完成。

验收包含旧无版本schema三反馈/两身份/四评论/四通知；精确字段及每身份数量保留；大正文/Unicode/空说明/`apc:`字面原文；源主文件hash不变；原库短原文/旧key扫描为正，而候选主文件和字段导出原文/旧包Base64片段/新旧key扫描为负；新文件权限及无candidate WAL/journal。复制候选到独立恢复文件，以相同**独立fixture key**启动真实后端：两恢复码各只得到自己的记录，正文、说明、双方评论和管理员通知可读。重复转换新候选零新增/零再密封；错误key/篡改认证失败；晚期NULL错误前面的转换及DDL/marker完整回滚，修正合成输入后新尝试成功；源writer持续打开且WAL非空时当前提交内容被快照包含，源DB/WAL hash不变。257条增量跨两批边界，三内容表每行认证读回不重不漏。目标发布竞态保留原文件。

剩余事项：实际资产/备份清单及授权、Q-04/Q-07保留映射、无法保持现有语义的NULL/空正文/混合demo历史情况、T-02正式角色adoption与基础设施隔离、来源实际大库时间/磁盘/内存与失败恢复演练、全量per-identity映射/审计核对、停写/入口切换、物理旧副本及备份处置。当前在线backup是某时点快照，**不会复制完成之后的新写入**；真正切换必须停写后取得最终一致快照并验证，不能直接用早先候选替换继续写入的源。没有自动delta合并或清理功能，不新增这些产品/架构决定。

只证明测试候选主文件及已检字段没有合成敏感标记，不声称已抹除源库、工作目录、OS/磁盘块、日志或未知字段/其它备份。unknown表/日志未最小化，不能把保留数量等同其隐私政策已批准。没有实际DB、key或在线服务操作。未启用库可停止调用准备模块；现有源和配置是恢复基线，真实旧资产销毁仍需独立批准。

实现依据：[better-sqlite3 backup/transaction](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)、[SQLite在线备份](https://www.sqlite.org/backup.html)、[SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)、[secure_delete](https://www.sqlite.org/pragma.html#pragma_secure_delete)。本地所装backup实现已读取，预留文件使其按已有目标打开；规范说明不能替代上述实际fixture验收。
