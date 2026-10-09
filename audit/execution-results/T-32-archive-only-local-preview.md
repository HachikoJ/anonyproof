# T-32 archive-only 本地合成预览与格式说明

更新：2026-10-10（增加私有恢复 catalog、唯一 package binding 和整包独立恢复校验）；初版日期 2026-10-09。仅离线工具实现与新建纯合成 fixture 验收；没有读取真实资产/密钥、连 SSH、复制真实 DB、创建真实内容密钥、修改服务器或公开站。未部署、未提交。不能据此把真实 T-32 标成已完成。

## 当前实现边界

新增 `scripts/private-retention-archive.ts`、`scripts/content-retention-adapter.ts` 与 `tests/fix/T-32-retention-adapter.test.ts`。既有 `content-migration-candidate.ts`、server、FIX_PLAN 未修改。

唯一模式是 `archive-only`（省略 mode 也如此）；传 `runtime-projection` 立即失败，不创建输出。库没有 CLI、不加载 `.env`、不扫描备份路径、不连网络、不启动服务、不认领 formal、不修改 flags/身份/行、不删除文件、不代替停写或真实批准映射。

`prepareRetainedVersion` 每次显式接受一个 sourcePath、一个不存在的新 outputDirectory、一个内容根密钥和一个逻辑 versionBinding；路径必须绝对且规范化。每次调用在内部生成 24-byte 随机值编码的唯一 opaque packageBinding，即使逻辑版本名重复也不复用档案 AAD。三个源必须分别调用到独立目录，版本不能合并或去重。公开返回值和 completion report 没有 source/output/staging 路径、版本绑定值、ID、计数、摘要或 key；异常只有固定失败码，没有底层错误原文。

## APRA/1 固定格式

```text
byte 0..7       ASCII APRA0001
byte 8..19      随机 12-byte nonce
byte 20..N-17   AES-256-GCM ciphertext（可为空）
byte N-16..N-1  16-byte authentication tag
```

派生参数（固定 UTF-8，无环境默认值）：

```text
HKDF-SHA256 IKM  = canonical-base64 解码后的 32-byte 内容根密钥
salt            = AnonyProof/private-retention-archive/key-derivation/v1
info            = AnonyProof/private-retention-archive/A256GCM/archive-key/v1
output length   = 32 bytes
AAD             = JSON.stringify([
  "AnonyProof/private-retention-archive", "APRA/1", "A256GCM", kind, packageBinding
])
kind            = snapshot | isolated-rows | manifest
packageBinding  = prepare 内部新生成的 48 个小写 hex 字符；整包三个档案共用
logical versionBinding = 调用者的私有逻辑版本名，不直接用作整包档案 AAD
```

kind/packageBinding 作为 AAD，不以明文写入 APRA header。跨种类、跨 package、错 key、损坏 header/tag/ciphertext 或截断都不能认证。低层 codec 仍接受名为 versionBinding 的 AAD 参数供独立单文件测试；它本身不验证整包或逻辑来源。此格式是离线归档格式，不更改/替代在线 `apc:` codec。根 key 与派生 key 都不写入档案；内部临时 key Buffer 使用后填零，传入 JS string 的生命周期仍由调用者控制。

私有 `recovery-catalog.private.json` 是恢复材料的必需部分，固定格式 `AnonyProof/private-retention-catalog/1`，只含四个字段：format、archiveFormat、packageBinding、逻辑 versionBinding。不含 key、源路径、ID、计数或摘要，不接受额外路径字段。catalog 0700 父目录/0600 文件，必须与档案一起独立备份；根 key 仍单独保管。**只有 key 和三档案、丢失 catalog 时，随机 packageBinding 无法推导，不能保证恢复。** 不能把 catalog 唯一副本留在本次 staging，也不能把内存变量当恢复记录。

认证 manifest 同时保存 packageBinding、逻辑 versionBinding 与 snapshotDigest、isolatedRowsDigest、schemaDigest。高层恢复将 catalog 的声明与这个认证 manifest 对照，拒绝 catalog 逻辑映射错误、合法跨包文件混入或有效认证但摘要关系错误。目录名称/prepare completion JSON 不是完整性凭证。

流式文件加解密与摘要每块最多 64 KiB。typed SQLite 行以 iterate 处理并施加单行 8 MiB/最多 256 列的显式预检，超限失败，不截断或静默丢行；因此不是整库/整文件读入内存。单行预算只限制此本地预览的元数据处理，不暗示超限历史资料可以舍弃。超限需先给出具体无损工具适配方案，不能跳过预检。

## 产物和认证顺序

新输出目录 0700，所有普通文件 0600，当前进程须拥有目录/文件；逐路径组件拒绝 symlink。输出位置独占，existing/racing target 不能覆盖。规范化路径规则会拒绝带 symlink 的路径别名，调用者应提供真实绝对路径；不由工具擅自 chmod 或认领目录。

1. 只读 SQLite source，query_only，使用 SQLite backup API 包含 committed WAL；保留完整原 schema/全部表/所有原值。
2. 私有 staging 生成 snapshot、isolated-rows typed NDJSON 和私有 manifest。typed 值区分 NULL/text/blob/int64/real；原 flags/原角色/身份 hash 仍只在私有材料内。
3. 分别生成 `snapshot.apra`、`isolated-rows.apra`、`manifest.apra`，加密 AAD 绑定此次唯一 package；私有 catalog 另行准备，不含 key。
4. 每个档案独立解密至另一新 inode 的私有 staging；GCM final 认证成功前不发布 destination，不交给 SQLite。失败的未认证 staging 保持私有，不能拿来恢复。
5. 认证通过后全文件 SHA-256 与原 staging 相等；恢复 snapshot 再独立 integrity_check。该字节相等包含所有 NULL、blob、int64、未知列/schema/旧 package，非仅行数相等。
6. 三个档案全部验证后才以独占 hardlink 发布密文和私有 catalog；报告先写 staging 并 fsync，最后独占发布 `archive-only-complete.json`，对目录 fsync。没有有效 completion report 的部分目录不是成功结果。

final 与 staging 的同一个密文或恢复文件可能是 hardlink；这些别名只是一份文件，绝非独立备份。独立恢复比较的是原 snapshot 与解密后不同 inode 的新文件。准备失败保留受限中间物，不自动删除；重复执行不能使用旧 partial 目录。

孤儿归档的四类互相区分：非 NULL parent 缺失的 comment、NULL target comment、非 NULL parent 缺失的 notification、NULL parent notification。最后一类可能是合法 general notice，不伪称损坏，也不制造假 parent。所有原行同时完整保存在 snapshot；单独隔离材料是有意冗余保留，不把两者相加当业务唯一计数。没有从源或投影删除任何行。

## 只凭独立材料恢复整包

`restoreRetainedVersion({archiveDirectory,catalogPath,destinationDirectory,contentKey})` 是客观整包验收入口，不读取原 source、原进程变量或 prepare completion JSON。catalog 可来自独立私有备份位置。新 destinationDirectory 必须不存在，私有权限/路径规则相同。

它先严格校验 catalog，再将三个档案分别认证解密到私有 staging；全三个 GCM tag、认证 manifest/catalog 映射及 snapshot/isolated-rows SHA-256 关系通过后，才打开 restored snapshot 做 SQLite integrity_check 和 schemaDigest 核验。全部通过后才发布 `snapshot.db`、`isolated-rows.private`、`manifest.private` 与最后的 `restore-only-complete.json`。低层 `restorePrivateRetentionFile` 只保证单文件 AEAD，不能据它的 true 说整包恢复通过。

部分发布失败可以留下已经认证的 plaintext 文件，但不会产生新的成功 marker；已有/racing 文件不覆盖，目录不可重试复用。这类失败目录也属于私有 F 清单。若整个 catalog 与三个相配的合法历史包一起替换，本工具只能验证那一个包的内部一致性；实际资产版本是否为批准对象仍由私有执行清单/源映射固定，不能声称提供全局防回滚服务。

本地独立恢复及复制证明不同 inode、无需原进程；不等于异机/独立介质的灾备。真实材料的异机档案+catalog 备份与独立 key 保管仍需实际执行验收。

## 实际验收

执行 Node 22 的以下命令，实际退出码均 0：

```sh
export PATH="/tmp/anonyproof-runtime-22/node_modules/node/bin:$PATH"
npx --no-install tsx --test --test-concurrency=1 tests/fix/T-32.test.ts tests/fix/T-32-candidate.test.ts tests/fix/T-32-retention-adapter.test.ts
npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict scripts/content-retention-adapter.ts scripts/private-retention-archive.ts tests/fix/T-32-retention-adapter.test.ts
```

当前合计 58/58 测试通过，0 failure、0 skip；其中新增 adapter/package 场景 38/38。报告分别在 `T-32-retention-package-final-tests.txt` / `-final-tests-result.json` 和 `-final-typecheck.txt` / `-final-typecheck-result.json`，真实退出码均为 0。此前单文件归档初版 44/44 和中间整包 57/57 日志保留，不作为最终版本的替代验收。

覆盖：原 schema/index/trigger/未审阅非空幂等表仍原样归档；NULL/空 string/文字 null/Unicode/blob/int64；旧 demo marker/NULL flags 不变；独立 typed 孤儿分类；三个同 ID 不同内容的版本分别恢复；错 key/种类/版本、cipher/tag/header corruption/truncation 无公开恢复目标；空文件也认证；12 MiB 流式文件；WAL writer 保持打开而 source main/WAL 字节不变；existing/racing 文件不覆盖；模式/key/binding/权限/symlink 拒绝；巨型行/关系 schema 缺失失败且无 completion marker；只凭分别复制的 key/catalog/三档案在新子进程恢复；同一逻辑版本每次 package 随机唯一；三种合法跨包文件与错误 catalog 拒绝；认证正确但 snapshot/isolation/schema 摘要错误拒绝；发布第二文件遇 racing target 时保留已认证首文件、绝不覆盖目标、无成功 marker。

首次命令包装使用 zsh 保留变量 `status`，包装退出 1；实际 TAP 是 24 pass/0 fail，初始 strict 编译输出为空。没有据此声称命令成功。保留初始输出和 `T-32-retention-adapter-initial-wrapper-failure.txt`，随后改成专用变量并重新执行，最终 JSON 记录真实退出码 0。整包实现首次 strict 编译出现 `ReadStream flags:number` 与声明类型不符（退出码 2），保留在 `T-32-retention-package-typecheck.txt` / `-typecheck-result.json`；改成 O_NOFOLLOW 显式打开 fd 后交给 ReadStream，最终重新测试 58/58、strict 退出 0。

## 真实执行仍缺什么

已批准保留方向及独立 key 保管位置不需要重复确认。真实动作前仍应展示并批准具体 APRA/1 格式、catalog 独立备份及操作 diff、停写窗口、最终逐版本资产清单、受限目录/一致快照操作；拿真实 key/资料做独立恢复比对属于具体受限执行范围，不能由本地合成通过自动授权。

完整 snapshot 只是过渡隔离恢复材料，包含旧 telemetry；`finalBusinessRetentionComplete=false`、`historicalPlaintextDisposalComplete=false`。本工具不是最终可无限期保留原始 IP/UA/query 的业务档案，不覆盖 T-11/T-33 的 7 天策略。对应获批工作候选与最终业务档案仍按 E 独立验收，原 snapshot、所有 staging/明文/sidecar/外部旧副本按 F 精确清单最后另批退役。没有完成这些步骤就不能说历史明文风险已消失。
