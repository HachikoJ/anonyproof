# T-18 当前代码的本地 Node 20 补验（2026-10-08）

状态：本地通过；T-18 整项仍已阻塞，未运行实际 GitHub Actions，未推送或部署。完成任务数仍23/43。此记录补齐上次 d08b0a2 验证之后的代码，不替代远端验收。

源码为 `git archive dac38cea30fdbac0c2d23ec6a879bd76cd1c51bf`，独立临时目录，无真实.env.local/DB/日志或node_modules。实际局部 Node20.20.2/npm11.21.0。详细目录、命令、逐步骤实际退出码、原始日志路径/SHA256、workflow和runner哈希见 `T-18-current-checkout.json`。

冷缓存首次npm ci下载十多分钟仍有多个tarball持续缓慢增长；明确中断，实际安装退出-15，保留整个checkout/cache/日志，其他门禁未执行。这不是代码失败或验收通过。新建另一个checkout，只把两份锁文件所需且SHA512逐字匹配的207个registry tarball复制到新的私人缓存；55个未命中，仍允许正常网络下载和原生构建，未复用node_modules、用户缓存配置或凭证，未更改共享缓存或主工作区安装树。清单见 `T-18-current-cache-seed.json`。

第二次11个步骤全部实际退出0：

1. root `npm ci --no-audit --no-fund`、`npm ls --depth=0`。
2. server目录同两命令。
3. `node scripts/check-runtime.cjs`，两个安装树原生SQLite实际加载/查询成功。
4. `npm run type-check` 和 `npm --prefix server run type-check`。后者的原N-03覆盖缺口仍存在，另执行下面真实backend编译，不能仅用旧脚本宣称后端通过。
5. `npx --no-install tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts`。
6. `npm run build`。
7. `npx --no-install tsx --test --test-concurrency=1 tests/fix/*.test.ts`，24个文件，124个含嵌套测试：123通过、0失败、0取消、1跳过。唯一SKIP是T-34删除关联数据/事务矩阵，仍待删除语义确认及实现，绝不标完成。包括T-03独立备份恢复与T-32只读盘点/合成候选转换；这些通过不能替代真实资产迁移。
8. 从该snapshot `.github/workflows/ci.yml` 提取原封不动的Audit production dependencies run block，以 `bash -e -o pipefail` 实际执行，退出0。root npm audit退出1，metadata为low1/high3/critical0/total4；server npm audit退出0/all0。告警只按现有workflow策略保留报告，不代表全部安全。新的Next六条advisory逐项列N-04，未顺手修复。

控制台证据为 `T-18-current-{step}.txt`；root/server audit JSON逐字保存。控制台只规范行末空白/多余EOF空行以通过git diff-check，原始字节及SHA256保留；不改写失败/跳过/告警。包缓存包含公开依赖压缩包，Git只存路径/完整性元数据，不上传包、测试库、恢复码或密钥。

只读git ls-remote实际查到checkout/setup-node/upload-artifact三个v7标签，详见 `T-18-current-action-refs.json`。这只证明标签存在，不证明Actions执行、缓存命中、产物上传或Ubuntu native行为。局部npm11预先存在；没有执行workflow的global npm安装、安装失败重试/cache-clean分支、Actions setup/cache/upload，不能称完全等价远端CI。

没有本次新启动失败注入；原T-18启动破坏必失败/恢复通过、审计无效JSON/网络失败阻断证据继续保留。当前补验未改变该门禁实现，无理由再重复注入。没有执行新UI浏览器验收，既有编号浏览器证据保留，不冒充本次Node20 UI验证。

下一步：取得具体推送范围授权后运行真实Ubuntu Actions并记录链接/所有必要步骤结果；取得前不改T-18状态，不越过T-37/T-38/T-39/T-42/T-36依赖。源代码和产品行为本轮未修改；证据/计划独立提交，不需要回滚业务或数据库。
