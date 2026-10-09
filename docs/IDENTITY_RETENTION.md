# T-25 身份、安装密钥及数据库会话保留

正式实例：最后活动严格早于当前轮开始时间减 90 天，且没有任何反馈记录、没有指向该身份的用户通知，才允许清理身份。等于 90 天边界保留。任何反馈都阻止清理，包括带演示标志的历史记录，不以标志推断其内容是合成数据。

演示实例：最后活动严格早于当前轮开始时间减 30 天，才允许清理。该身份的每条反馈必须同时满足 `is_demo_template=0`、`is_demo_clone=1`、`encrypted_content` 等于当前 `DEMO_TEMPLATE_IDS` 对应的 `demo-encrypted:<id>` 标记。模板、未知旧标记、混有未知反馈、无法关联到上述安全反馈的用户通知，均保守保留整个身份及其反馈。合格副本删除关联评论、用户及管理员通知，再删除反馈；安装密钥、会话、身份按关联顺序删除。

最后活动取身份、会话、安装密钥的 `created_at` / `last_seen_at` 最大值；成功认证、恢复和绑定会更新活动。到期会话以 `expires_at <= 当前轮开始时间` 判定，独立于身份是否仍有业务。删除到期会话时保留其活动时间到身份表，并只清除匹配该到期会话的旧 `token_hash` 兼容缓存，防止重启迁移适配器复活已到期凭证。其它有效 Cookie 和恢复码不受影响。

后端监听成功后开始一轮清理，之后每小时一轮。每轮固定时间，每个事务最多删除 500 个会话、500 条反馈、100 个身份。关联评论及通知在对应反馈的同一事务内删除，因此它们的条数可能超过 500。事务之间让出事件循环；身份有剩余会话或反馈时，保留身份待后续批次，避免孤儿。失败完整回滚该批、记录受限 SQLite 错误码并在下一小时重试；日志仅包含各表清理数量，不包含身份、凭证、正文、IP 或原始错误文本。定时器 `unref()`，服务关闭时取消定时器。

`countIdentityRetention(db, role, now)` 只读预览同一时间点的预计数量；并发业务会改变之后的实际数量。它不执行建索引或清理，也不意味着获准处置历史资产。在仓库根目录使用 Node 22，对**已核验、获准的独立快照**执行：

```sh
DATABASE_PATH=/absolute/path/to/approved-snapshot.db INSTANCE_ROLE=formal npx --no-install tsx -e '
const Database = require("better-sqlite3");
const { countIdentityRetention } = require("./server/utils/identityRetention");
const { verifyDatabaseRole } = require("./server/utils/instanceIsolation");
const role = process.env.INSTANCE_ROLE;
if (role !== "formal" && role !== "demo") throw new Error("Explicit role required");
const db = new Database(process.env.DATABASE_PATH, { readonly: true, fileMustExist: true });
try { db.pragma("query_only = ON"); verifyDatabaseRole(db, role); console.log(JSON.stringify(countIdentityRetention(db, role))); }
finally { db.close(); }
'
```

未标注角色的历史库必须先按 T-02/T-32 的确认流程处理；不得为了运行预览直接改历史库。上面命令仅适用于已标注角色的快照，不导入 `database.ts` 或启动业务服务器。

验证命令：

```sh
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-25.test.ts tests/fix/T-21.test.ts tests/fix/T-05.test.ts tests/fix/T-08.test.ts tests/fix/T-26.test.ts
npm run type-check
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts
```

本轮只实施及验证本地合成 fixture。正式启用意味着会在启动时执行删除；真实数据库必须先只读计数、制作包含 WAL 的一致性快照、验证独立恢复并取得对应资产确认，再部署此版本。回滚代码只能停止后续清理，不能恢复已删记录。恢复应先在独立路径完成并核对关联和计数，再决定切换，不能直接覆盖清理后的新增业务。SQLite DELETE 不承诺擦除主文件、WAL、旧快照或备份中的历史字节；历史资产销毁另行确认。
