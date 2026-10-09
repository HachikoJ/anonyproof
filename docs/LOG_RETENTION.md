# T-11 原始日志保留

原始 `access_logs` / `rate_limit_logs` 保留 7 天：`created_at < now - 7天` 才过期，等于边界保留。后端监听成功后启动清理，每小时一轮；重启重新启动调度。每个事务每表最多删除 500 条，批次间让出事件循环，直到当前轮固定截止时间之前的记录清空。失败记入现有 error 日志并于下一轮重试，不抛到业务请求。

清理只涉及上述两表，不删除 `access_stats` 的非个人日聚合、不修改黑名单、身份、会话或业务记录。overview 的累计访问、爬虫、可疑访问和加权响应时间来自日聚合；`total.unique_visitors` 只代表最近 7 天原始日志去重，响应中 `unique_visitors_window_days: 7` 明示范围。逐日去重数不能相加冒充全历史独立访客。

`countExpiredRawLogs(db, now)` 是只读数量预览；`cleanupOldLogs(now)` 只执行单批次，返回两表删除数量。自动调度会排空所有过期批次；管理员手工逐批执行需要先完成资产批准。

本地验证：

```sh
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-11.test.ts tests/fix/T-10.test.ts
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts
```

未部署此调度、未执行真实历史删除。真实资产执行前必须对批准的数据库路径只读预览计数，制作含 WAL 的一致性快照并验证独立恢复，批准后才启用清理。失败关闭或停调度不会恢复已删除记录；需要从快照恢复到独立副本，核对计数后决定切换，不能覆盖清理后的新写入。SQLite DELETE 不承诺数据库文件/WAL/旧备份中的字节安全擦除，历史备份处置另行批准。
