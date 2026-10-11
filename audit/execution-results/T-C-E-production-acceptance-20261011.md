# C / E 实际执行与独立验收（2026-10-11）

用户明确回复“确认C，E”，两份既有具体提案获准。本记录不把F未执行的删除、未查证的物理擦除、范围外依赖风险算完成。当前39/43完成；T-11/T-32/T-33/T-34仅余F历史资产退役。

## C 已发布的实际候选

公网： https://anonyproof.deline.top/anonyproof 。候选固定 `5c23a042e807b92312dac8fa1a9dc2e6037f575d`，此前真实CI run38033385313成功；后续提交仅计划/证据，没有修改60个发布源文件。源包 SHA256 `a40d78b7376c28b87b1a5da671ec47a337c20ed8b948c2f5e301ef6dedc3935c`，解包前及安装构建后逐文件SHA一致。

release：`/home/ubuntu/anonyproof-releases/5c23a042e807b92312dac8fa1a9dc2e6037f575d`；runtime：`/home/ubuntu/anonyproof-demo-private`。独占新建合成DB，仅初始七个确切demo-v2模板；旧七个DB/sidecar逐SHA未变。归档内容根密钥不载入demo。独立随机session/proxy keys只保存在私有runtime，前端没有这些keys。没有formal HTTP实例。

服务器原有Node22.23.2依次执行，所有退出0（完整日志仅私有）：

```sh
npm ci --no-audit --no-fund
npm --prefix server ci --no-audit --no-fund
npm ls --depth=0
npm --prefix server ls --depth=0
node scripts/check-runtime.cjs
node node_modules/next/dist/bin/next typegen
npm run type-check
npm --prefix server run type-check
node node_modules/typescript/bin/tsc --noEmit --target ES2017 --module commonjs --esModuleInterop --skipLibCheck --strict server/*.ts server/middleware/*.ts server/utils/*.ts
API_PROXY_TARGET=http://127.0.0.1:4000 npm run build
```

没有全局Node/npm/PM2升级、旧依赖重装或其他项目操作。新PM2名字为anonyproof-demo-frontend/backend，各单实例；旧两条按name/id/cwd核对后移除。主dump和fallback dump.pm2.bak均独立核验只含这两个demo、0600；旧两份启动配置私有备份保留至F审批。PM2识别`.config.cjs`，因此审阅wrapper按此文件名部署，字节仍与冻结wrapper完全相同。

唯一本站vhost来自T35模板，仅接线本站root-owned私有proxy include。shadow nginx-t、安装后全配置nginx-t及reload实际通过，其他include集合/SHA和deline.top对照响应不变。本站HTTP308、HTTPS根301、三页面和静态资源实测。3000/4000仅127.0.0.1监听，外网连接均不可达；直连backend缺/错代理键403，health本机200。

### 每个新增完成任务的独立结论

| 任务 | 客观验收 | 结果/证据 |
| --- | --- | --- |
| T-02 | 新demo空库初始化确切七模板；独立路径/凭证/keys；旧DB不改；公开只能访问本人合成沙箱与只读模板 | 已完成。C-approved-release-20261011.json、C-public-browser-20261011.json；旧材料仅私有保全 |
| T-24 | 公网与server回环两个真实来源不同；同源单/多值XFF/Forwarded/Real-IP和访客认证头被覆盖，来源不变；直连不能伪造 | 已完成。实际5次低频错误login来源核对；相同候选本地真实链T-24-authenticated-chain-result.json 11/11覆盖共享/独立配额429边界。未在生产压测或声称生产耗尽配额 |
| T-35 | 唯一vhost通过真实nginx-t并启用；端口/跳转/三页面全部资源/Cookie及状态PUT、合成副本DELETE | 已完成。C上线摘要及两份browser结果；对照站与其他配置未变 |
| T-25 | 三版本批准保守保留/no-op、全缺身份表离线例外；完整身份typed值和schema不减；六套两机恢复 | 已完成。E-approved-six-package-recovery-20261011.json。实际零候选不伪称删除了身份 |

### C 浏览器与日志补验

独立终端Playwright使用已有Chromium1243，无安装、无个人profile或现有Cookie。业务/安全51/51：真实UI提交后server已经落库再故意丢响应，手动重试同键同ID且仅一条；双方评论/状态/通知；双身份沙箱隔离；模板只读；自由正文/评论/说明拒绝；raw日志五接口403；通知读/未读；新测试副本删除及评论/通知不可见，重复删除无副作用。三轮新测试副本都精确删除、会话退出/清空/关闭。

三页只读补验24个静态响应均200/304，包含access-stats专属chunk；0failedRequests、0uncaughtErrors。详见C-public-browser-20261011.json和C-three-page-static-20261011.json。

两site server块请求access/error日志off；实际四个请求前后新鲜本站日志文件metadata完全相同。新应用日志未包含观察到的来源IP或探针材料；runtime目录0700、当次文件0600。新DB integrity_check=ok、foreign_key_check空，七模板仍在。历史旧日志尚未删除，T33仍未完成。

安全回滚只允许恢复A/B验证的503维护vhost并停止新两个demo；不得恢复旧真实站。当前新站已正常运行且必要验收通过，无须回滚。

## E 私有最终档案实际验收

只在D认证恢复源的新私有工作副本处理，固定时点与冻结工具SHA复核：T11七天/500批次；T25零候选no-op且只有全缺三身份表才离线映射；T34孤儿先单独快照保留再从新主副本移除，NULL通用通知不移；T33批准旧adminIP置空和长期最终档案不保留逐请求raw。没有改旧源DB、D材料或日志。

三个版本分别有retained/isolated两套APRA/1（六套）。服务器与本机各独立取回key/catalog、完整GCM认证恢复；使用不同inode的恢复比对副本，独立Python核对完整schema/所有表typed值，Node独立比较器核对批准映射后的业务联合、NULL、int64/blob/sqlite_sequence、身份/聚合原值、无raw/主库无已确认孤儿/孤儿档案只有批准行。三版全通过。比较器9/9正负合成测试（含正文/blob/int64/NULL/聚合/身份/raw/schema/通用通知篡改）及strict通过。主代理核验执行工具SHA并读独立比较器。

最终目录：

- server：`/home/ubuntu/anonyproof-private/20261009-v2/E-final/version-{1,2,3}/{retained,isolated}/`
- local：`/Users/wilson/Documents/AnonyProof-Private-Archives/20261010/E-final/version-{1,2,3}/{retained,isolated}/`
- 独立根key仍在之前批准的server/local secrets目录，目录0700、文件0600，不入Git。

公开结果E-approved-six-package-recovery-20261011.json仅布尔。完整typed值、原业务计数/摘要/key/catalog及真实内容均仅私有。APRA helper原保守transitional metadata未改；当前E验收确认六包实际无raw，但F未完前不声称完整历史风险消除。

## 保留的失败与明确边界

C第一次启动验收脚本误用旧ID前缀，已保持503/停新，改成确切七demo-v2 IDs后通过；来源路径在统计中已归一化/unmatched，校验改按当次401行；旧日log inode metadata因轮转不能作今天不写证明，改用实际请求前后新鲜metadata。浏览器三次中间错误是Cookie名、成功弹窗、无效幂等键格式，失败证据保留，未改产品或放宽正确断言。

E首轮隔离目录SQLite模块搜索路径缺失；第二轮SQLite backup页布局变化导致过严字节断言失败。失败材料保留；显式已有模块搜索路径和独立完整schema/typed比较后通过，无业务断言绕过、无新安装。

本次是既有公开L2产品的安全修复版本更新，沿用之前可验证基线，仅复核本次部署/业务/隐私变化；没有增加范围外展示功能。根依赖原记录的4个advisory（0critical，3high/1low）仍为非本次范围，server审计0；不声称零漏洞或绝对匿名。真实历史共享combined日志缺Host，不能证明归属，不泛删其他站；SSD/系统快照/未知第三方备份物理擦除未证明。

## 下一轮唯一路径：F

F具体提案：`/tmp/anonyproof-F-final-exact-proposal-20261011.md`；机器清单：`/private/tmp/anonyproof-F-final-20261011-o443odej/F-exact-assets.private.json`，SHA256 `d42b0c6c494199a665aa8293b804d770ac3f4324bd864c9701161c76a275acf0`。

同次审批总768文件（server416/local352），包括单列两份旧PM2备份；不递归删目录。双机各24最终包/catalog及独立根key/最小布尔receipt保留。删除后无法D原样恢复旧raw/IP，只能E六包恢复保留业务。执行前再次核验保留档案、精确路径/inode/hash/mode/size/硬链接完整别名、无占用；硬链接预期nlink随已删别名数变化。任何范围或当前状态变化须停止，而非用旧清单盲删。

F尚未批准/执行。T11/T32/T33/T34各保留独立验收，必须实际逐资产删除与保留档案核验通过后才关闭。无需再读上一轮审查或重跑已通过的整个UI/全量测试。

完整私有C执行与receipt：`/private/tmp/anonyproof-C-approved-20261011-sra6ml5b/`，server同名`/tmp`目录；E工具/receipt：`/private/tmp/anonyproof-approved-E-20261011-eegsce0o/`。这些含私有材料，不可整体stage、上传或打印。
