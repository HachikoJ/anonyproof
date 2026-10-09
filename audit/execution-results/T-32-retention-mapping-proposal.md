# T-32 历史保留映射适配提案（仅本地准备，未实施）

> 历史未实施提案：本文件的 formal 认领、flags 映射与 runtime-projection（S2/S3/S4）均未实现，也未进入当前执行范围。当前唯一可执行本地预览是 `T-32-archive-only-local-preview.md` 所述 archive-only + 私有恢复 catalog + 整包认证恢复；不能按本文件伪代码执行真实映射。

日期：2026-10-09。此文档只有代码定位与合成示例；不包含真实资产路径、计数、记录标识、源摘要或密钥。真实执行清单必须另存私有位置，不进入 Git、PR 或 CI artifact。

用户已批准的方向：全部未知旧业务私有保留；主版本与两份备份分别保留版本，不凭旧 demo/template/clone 标志删除或去重；无父评论和通知另行隔离保留；独立内容密钥保存在服务器私有位置和已批准的本机私有位置，目录 0700、文件 0600；材料不接回公开演示。批准方向不等于已经完成快照、迁移、恢复、远程目录创建、维护停写或上线。本文不申请额外功能，不改变公开演示。

## 1. 为什么现有 candidate 不能直接运行

| 定位 | 当前准确约束 | 对适配的要求 |
| --- | --- | --- |
| `scripts/content-migration-candidate.ts:checkSchema` | 所有 feedback 的两个 demo 标志都必须恰好为整数 0；否则 `UNAPPROVED_SCOPE`。触发器、非预期主键/版本、非空 `request_idempotency` 也分别失败。 | 只在获批工作副本做有证据的保留映射；不修改/关闭原 guard，不伪称旧标志证明合成数据。 |
| `prepareContentMigrationCandidate` | 这是库函数，没有 CLI，不加载环境，不自动认领角色，不激活，不删除源。 | 单独的准备 adapter 编排它，不把它描述成可直接生产执行的工具。 |
| `transform` | 正文、说明、评论、通知 title/content 都必须为 string，NULL 失败 `UNSUPPORTED_NULL_OR_CONTENT_TYPE`。 | NULL 保持 NULL，不能 `COALESCE(..., '')` 或 stringify 为 `'null'` 后声称无损。 |
| feedback 转换 | 正文为空且旧 package 不是已有 server marker 时失败 `AMBIGUOUS_LEGACY_BODY`；旧 package 可含唯一可恢复材料。 | 归档完整旧 package；没有无损解释时只出档案，不输出可运行投影。 |
| comment 转换 | feedback_id 与 commenter_type 都要求 string；非 NULL 无父评论当前仍可被封装。 | 无父/无目标评论只进入隔离档案，不能把“可加密”当“可服务”。 |
| notification 转换 | feedback_id=NULL 被编码为 AAD 中的 `null`；title/content 仍要求 string。 | NULL parent 与 NULL content 分别处理，不混成同一类孤儿。 |
| `server/utils/instanceIsolation.ts:verifyDatabaseRole` | 非空未标角色库拒绝自动认领；demo/formal 角色不匹配拒绝。 | 在工作副本显式认领 formal，记录原角色及批准的映射；不让服务启动过程自动认领。 |
| `server/index.ts:adminRecordScope/userRecordScope` | formal 可见反馈要求两个 demo 标志为 0/0。 | 映射 0/0 的语义是“未知历史私有保留”，并非“已证实真实”或“已获准开放”。 |
| `readNotification` | 仅 legacy version=0 的 content=NULL 有显式保留 NULL 的读路径；通用 codec 只支持 string。 | 此次不扩充 HTTP/codec 数据类型；遇无法兼容的 NULL，完整归档并阻止该版本产生运行候选。 |
| `notificationVisibilitySql` | 读通知需要存在且可见的父反馈，NULL parent 通知不会成为普通业务通知。 | 保留合法无目标通知原值，不创建假反馈或改变 recipient 来让它显示。 |
| candidate 输出 | 工作 candidate 与输出路径是硬链接，不是两个恢复副本；现有 count 校验只比较各表数量。 | 另做独立字节副本恢复、行级 typed 比较和计数守恒；不能只看 integrity_check/foreign_key_check。 |

现有合成回归已经覆盖 NULL 拒绝、旧 scope 拒绝、模糊正文拒绝、WAL 一致快照、错钥/篡改拒绝、重复转换不再密封及合成授权 HTTP 恢复。那些结果不证明真实历史已经迁移。

## 2. 最小策略：先完整加密档案，再可选私有运行投影

默认执行模式只允许 `archive-only`：产出完整私有加密档案并完成独立恢复比对，不尝试认领 formal，不生成运行投影。只有另行批准运行恢复的具体用途与映射后，才允许显式 `runtime-projection`；“字段恰好都是 string”也不能自动升级模式。

每个资产版本独立运行，使用稳定合成命名示例 `version-current`、`version-backup-a`、`version-backup-b`。三个源不能合并数据库、合并身份或按反馈 ID 去重；相同 ID 的不同内容仍分别保留。只有私有执行清单保存这些代号到真实资产的映射。

每版本的必需产物：

1. **完整保留档案**：一致 SQLite snapshot 的全部字节与私有 manifest 都经独立档案格式 AES-256-GCM 验证加密。保留原 schema、NULL、原 flags、旧 package、身份映射及未知字段。档案是离线恢复材料，不是 HTTP 服务数据库。
2. **孤儿隔离档案**：保留完整 typed 原始行、所属版本及原因；有非 NULL parent 却不存在父反馈的评论/通知，及本来没有目标的评论，分别分类。NULL parent 通知单列“无目标通知”，不武断视为缺父损坏；它也只保留私有，不伪造关联。
3. **映射 manifest**：版本标识、snapshot 逻辑摘要、全部表/schema 摘要、每条 feedback 原 flags/目标 flags、源角色/目标角色、隔离行索引与 typed 行摘要、源和投影守恒结果；其真实值全放进加密档案。公开报告只有合成来源标记、布尔验收结果和脱敏失败码。
4. **可选运行投影**：只有全部内容/关联/字段都通过既有 candidate guard，且映射语义确认后才产生。只用于获批私有恢复演练；不能挂公开演示域名。任何一个字段无法无损处理，该版本仍保留完整加密档案，但 `runtimeCandidatePrepared=false`，不输出半份可运行候选。

完整 snapshot 档案是停写版本的无损隔离与恢复材料，可能包含尚待 T-11/T-33/F 分别处理的旧 telemetry；它不是获准永久保留原始 IP/UA/query 的最终业务档案。业务保留方向不能覆盖日志 7 天策略。最终只保留业务/身份映射/已批准最小审计的独立业务档案，应在获批工作副本完成对应 E 阶段并验证后形成；原全量 snapshot 及中间明文/密文副本按 F 的精确清单退役，仍需最后批准，不能悄悄永久留存全量原始请求日志。

完整档案允许保留源 schema 的所有信息，解决 NULL/未知列/旧包的无损保存。运行投影不承担唯一备份责任，因此不需要在此次范围内扩展通用 codec 或公共接口。不同产物的“完整保留”与“适合运行”必须分别报告。

安全格式只新增最小离线档案能力：固定格式版本、随机 12-byte nonce、16-byte tag、AES-256-GCM；AAD 绑定档案种类、格式版本和私有资产版本标识。档案域与现有字段 codec 的 AAD 域分开，不能拿档案密文冒充 `apc:` 字段。大文件按流处理，不能整库读入内存；恢复到独占 0600 私有临时文件，认证成功前不得 SQLite 打开、启动服务或公布目标路径。错误/中断只留下受限临时文件，保留至另批退役，不自动删除。

密钥由已批准的私有保管机制读取，不能出现在 argv、日志、manifest 明文、DB、Git 或 PM2 共享 dump。档案可使用由本次内容根密钥以 HKDF-SHA256 固定域派生的专用子密钥，使密钥材料保管仍是一套 32-byte 根密钥，同时区分档案与字段用途；该新增格式需先确认。也可单独生成档案密钥，但会增加必须独立备份的资产，不默认采用。

## 3. 工作副本映射步骤与事务边界

### S0：只读源预检，先固定批准对象

源必须来自停写后获批的一致 snapshot；不能靠复制 `.db` 而漏 WAL。检查显式绝对路径、真实常规文件、非 symlink、独立新输出位置、目录 0700/文件 0600、schema/主键、所有表/触发器清单、storage version 与角色状态。批准清单绑定版本代号与预期 snapshot 摘要；实际对象/版本/结构不符即 `SOURCE_APPROVAL_MISMATCH`，不扩大范围。所有表可完整归档，不等于所有表可以不经审阅进入运行投影。

S0 不输出正文/ID/恢复 hash/旧 package/密钥。源只读；工作副本失败不改变源。在线只读盘点不是未来停写快照的执行凭证。

### S1：先完整档案，独立解密恢复对照

用 SQLite backup API 创建一致 snapshot，以原始类型序列化 manifest；旧 snapshot 只在获批私有 staging。加密封装完成后，恢复到另一个独立 0600 文件，检查 inode 不同、SHA-256 与 snapshot 字节一致、integrity_check=ok、schema/各表 typed 行摘要一致。SQLite snapshot 的逐字节相等验证从同一 snapshot 对照，不拿 source 主文件字节与包含 WAL 的 snapshot 比较。

只有全量恢复通过才允许后续 S2；错钥、tag 篡改、跨版本/AAD 交换、截断全部失败关闭，不生成已认证输出。三个版本分别保留与验证，不输出真实摘要到公共报告。

### S2：明确映射工作副本（待具体语义批准）

从已验证 snapshot 创建**另一份**工作 SQLite 文件。在一个 immediate transaction 中：

- manifest 先收集所有 feedback 原 flags、原角色及归属关系；不以 flags 决定删行、不改 feedback ID/device_id，不合并身份。
- 将全部获批保留 feedback 的运行投影 flags 显式设为 0/0，并逐行核验变化只在这两列。原 flags 仅保存在加密 manifest/完整档案，不新增可由 API 泄漏的列。
- 将已归档并逐行比较通过的无父评论/无父通知从运行投影隔离出去。删除仅作用于新工作副本；原始源与完整档案均保留。此操作的授权对象/数量在私有清单固定，不执行通用 orphan cleanup，不扩展 T-34 删除范围。
- 对 NULL parent 通知保留完整档案记录；不更改 NULL、不把它关联到任意 feedback。若当前投影不能无损支持其 NULL 内容，整版本只归档，不生成运行投影，错误码 `RUNTIME_SEMANTICS_UNRESOLVED`。
- 角色未标记时，仅在新工作副本以原表定义插入唯一 `(id=1, role=formal, version=1)`。已标 formal 原样保持；已标 demo 或异常元数据失败 `EXPLICIT_ROLE_TRANSITION_REQUIRED`，另给具体角色迁移 diff 确认，不能 UPDATE 所有角色。
- 对有父业务保留各 content 原值与对应 storage version。任意 NULL/Blob/非 string、未知 version、ambiguous 旧包都停止运行投影；不自动修正、不丢行、不以日志输出原值。
- 事务提交前验证唯一允许差异集、身份归属摘要不变、反馈全量保留、子行守恒、角色唯一；失败 rollback 整个工作映射。

NULL 的类型保留由完整档案保证。S2 不承诺 NULL 行的运行恢复；避免把归档成功误报为 HTTP 恢复成功。

### S3：复用既有 candidate，原 guards 不动

把 S2 映射副本交给 `prepareContentMigrationCandidate`。它必须继续拒绝未映射 demo flags、未知 trigger/version、非空未审阅幂等元数据和歧义旧包。成功后再独立校验每个字段的解密值与原 snapshot string 相等、原已标 v1 密文未变、原非内容列除批准差异外相等。再次运行零新增、零再密封。任何失败不激活、不回写源，也不输出“部分完成”的服务 DB。

S1 完整档案是原样保留；S3 candidate 只覆盖服务投影。二者分别使用相应验收标准，不能把 candidate 对旧 package 的替换误说成档案也删除了 package。

### S4：独立私有恢复演练，不上线

S3 成功后将 candidate 的字节复制至另一 inode 的新 restore DB，不能使用现有 publication 硬链接冒充备份。在显式回环地址、随机空闲端口与独立临时测试凭证下启动 formal 服务，核验角色/错钥拒绝、经批准授权后原文可读、跨身份拒绝、孤儿不可读、公开演示未连接此路径。

此处不自动启用真实旧 session/token/recovery code。不在此提案中改旧凭证、不生成替代恢复码，也不替用户选择正式内容未来的访问政策。真实身份恢复演练的凭证/可见性需另列具体批准；纯合成回归可完整覆盖该行为。

## 4. 计数、类型与恢复必须同时验收

按每版本、每表分别验证；不能把三个版本相加当唯一记录数。

```text
feedback source rows = projected feedback rows
comment source rows = projected comments + quarantined comments
notification source rows = projected notifications + quarantined notifications
identity source rows = projected identity rows
all original rows = authenticated full archive rows
```

“quarantined” 包括明确选择只进档案的无目标类，私有 manifest 中各类别互斥且穷尽。完整档案同时保存源全量，属于故意冗余备份，不再加进上述投影分区公式。

对每个 typed 值，比较时区分 NULL、空 string、文字 `'null'`、integer、real 与 Blob；不得用 `JSON.stringify` 默认把 Blob/大整数/特殊浮点折叠。SQLite int64 必须用 bigint-safe 模式/类型标签；不支持无损编码就失败。原主键集合/归属关系/内容字段由进程内比较，只报告 bool；不打印 row diff。合法通知 NULL parent 与非 NULL 无父两类必须独立统计。

## 5. 具体代码改动建议（尚未实施）

| 文件 | 最小改动 | 明确不改 |
| --- | --- | --- |
| 新 `scripts/content-retention-adapter.ts` | 默认 archive-only；导出 `prepareRetainedVersion`；只接收一个显式已批准版本的绝对源/独占输出目录、私有批准映射与进程内 key；只读预检→档案恢复验证→事务工作映射→调用现有 candidate→行级核验。一次调用仅一个版本。 | 不默认读 `.env`/真实路径，不连 SSH，不自动处理所有 backup，不直接改生产源，不负责停写/部署/清理。 |
| 新 `scripts/private-retention-archive.ts` | 固定类型/流式加密与认证恢复；仅给 adapter 用；类型安全私有 manifest；失败码脱敏。 | 不引入通用 key vault/下载接口/公开归档浏览器。 |
| `scripts/content-migration-candidate.ts` | 原逻辑不变；最多把准备报告的“尚未批准”描述改成与输入上下文无关的“本结果不授予……”防止过时措辞。 | 不增加 `skipScopeCheck`/`allowNull`/`forceRole`/绕 marker；不删除现有失败测试。 |
| 新 `tests/fix/T-32-retention-adapter.test.ts` | 全部合成：三个版本、同 ID 不同内容、旧 flags/NULL/孤儿/无目标通知/身份关系/WAL/失败与恢复矩阵。 | 不读取本机或服务器真实资产/密钥/历史日志。 |
| 现有 T-32 candidate/inventory 测试 | 保持原失败约束；跑回归确保 adapter 没削弱已有 guard。 | 不把拒绝场景改为静默成功。 |

编排伪代码（不是已存在的可执行 API）：

```ts
async function prepareRetainedVersion(input: ApprovedRetainedVersion) {
  assertExplicitVersionApproval(input) // exact version/source/schema/mapping
  const snapshot = await createPrivateConsistentSnapshot(input)
  const archive = await sealAndIndependentlyRestore(snapshot, input.privateManifest, input.key)
  assertFullTypedSnapshotEqual(snapshot, archive.restoredSnapshot)
  if (input.mode === 'archive-only') return { archivePrepared: true,
    runtimeCandidatePrepared: false, activated: false, sourceModified: false,
    runtimeProjection: 'not-requested' }
  assertSeparateRuntimeMappingApproval(input)
  const check = preflightRuntimeSemantics(snapshot)
  if (!check.lossless) return { archivePrepared: true, runtimeCandidatePrepared: false,
    activated: false, sourceModified: false, code: 'RUNTIME_SEMANTICS_UNRESOLVED' }
  const mapped = await mapApprovedWorkingCopy(snapshot, input.approval)
  const candidate = await prepareContentMigrationCandidate({ sourcePath: mapped.path,
    destinationPath: input.newCandidatePath, contentKey: input.key })
  await independentlyVerifyProjection(snapshot, mapped.privateMapping, candidate)
  return { archivePrepared: true, runtimeCandidatePrepared: true,
    activated: false, sourceModified: false }
}
```

所有 path/key/IDs 留在内存和受限私有文件；公开返回值也不能沿用现有 candidate 的 workingDirectory 原样打印。不得执行此伪代码处理真实源，直至适配实现和对应真实窗口/资产批准齐备。

## 6. 验收命令与场景

以下现有命令可直接运行；新 adapter 文件的命令需实现对应文件后运行，本文没有声称其已通过。

```sh
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-32.test.ts tests/fix/T-32-candidate.test.ts
# 实现后追加，不是当前已有测试：
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-32-retention-adapter.test.ts
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict scripts/content-retention-adapter.ts scripts/private-retention-archive.ts
npm --prefix server run type-check
git diff --check
```

必须覆盖的客观断言：

- 原合成源及所有 table/row typed 摘要不变；committed WAL 内容在档案和投影中一致；输出均新建且拒绝覆盖/symlink/路径冲突。
- 三个合成版本分别成功归档；同 ID 不同正文各自恢复到对应版本，交叉 AAD/密文交换失败；不合并 identity，不遗漏独有版本。
- 合成 flags 的 0/0、1/0、0/1、NULL/未知值分别保留在完整档案；仅获批映射允许进投影；未经批准运行现有 candidate 仍为 `UNAPPROVED_SCOPE`。
- NULL、空 string、`'null'`、Unicode、Blob/int64 各自 round trip；archive-only 在全部字段为 string 时也不认领 formal/不生成运行候选；含无法运行 NULL 的版本档案成功而运行候选不存在，结果明确 false，所有源行仍在档案中。
- 非 NULL 无父、无目标评论、合法 NULL parent 通知各归正确分类；隔离 typed 行等于源，投影/隔离分区守恒；API 不读隔离材料，无假关联。
- 错 key、损坏 tag、截断、未批准源摘要/角色/trigger、非空幂等元数据、权限不符、输出竞争文件均失败关闭；错误/CLI/stdout/stderr 无合成秘密 marker、ID、真实路径与 key；失败不存在“已认证/可运行”输出。
- 并发或中途抛错导致映射事务全部回滚；角色/flags/隔离同时提交，不能部分认领；已有 demo marker 拒绝隐式改为 formal。
- 重跑仅允许显式新目标；既有目标绝不覆盖；candidate 再转换 `converted` 全为 0，原 v1 字段密文逐字不变。
- 独立恢复 inode 不同、快照字节一致、integrity_check=ok；合成 formal HTTP 自有业务可读/跨身份拒绝、错 key 无监听、孤儿无公开入口；公开 demo 的 DB/schema/数据摘要不变。

真实验收还需要停写后的逐资产私有最终清单、一致快照、独立钥匙备份可取回和每版本独立 restore；本地合成测试通过不会自动完成这些验收。旧明文 snapshot/staging/sidecar 的退役属于另批 F，未完成不能宣称历史明文风险消失。

## 7. 风险、回滚点与仍需确认

低风险阶段：纯本地合成实现/测试，不访问真实密钥或资料。中风险阶段：离线档案格式/恢复器，先故障注入与认证失败验收。高风险阶段：角色与投影映射、真实资产操作，拆分提交；只从经验证的 snapshot 创建新工作副本，失败退回“完整加密档案已保留、运行候选不存在”。不回写源、不原地修 candidate、不删除任何资产。

已批准的“全部私有保留/独立密钥位置”不用重复问。尚需具体确认的重大语义：

1. **离线档案格式**：批准新增上述 AES-GCM 全量档案与派生档案子密钥格式，以原始类型完整保留 NULL/旧 package/未知字段；这只扩充 T-32 的保留工具，不改变在线 codec。阻塞真实加密档案准备；不阻塞纯合成预览。
2. **运行投影映射**：全部未知 feedback 在新私有工作副本映射为 0/0、原 flags 加密留档、孤儿仅隔离、未标角色副本显式 formal 认领；任何无法无损运行字段使该版本“只归档”。这是具体角色/数据可见性变化，用户批准方向尚未替代此逐项方案确认。阻塞 S2/S3 的真实运行投影；不阻塞完整归档或新空 demo。
3. **未来真实身份恢复/正式服务访问**：保留原身份映射不等于批准继续启用旧 session/recovery credentials。当前仅离线保留；若要授权真实恢复演练/正式上线，再提交具体账户和访问边界。阻塞真实 HTTP 恢复/正式历史接管，不阻塞纯合成 HTTP 验证。
4. **远程窗口与资产操作**：停旧入口/写入、创建受限目录/一致备份、恢复演练/部署与明文退役各依此前 A/B/C/F 分开形成最终可审核清单并批准。此文不代替它们，不修改 FIX_PLAN 状态。

没有新增范围外任务；以上适配只补齐 T-32 已选保留方向所需工具，T-02/T-34/T-33/T-11/T-25 仍各按独立任务和批准验证，不合成“全库清理”。
