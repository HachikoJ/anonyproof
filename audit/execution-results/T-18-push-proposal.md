# T-18 真实CI推送/草稿PR具体方案（待确认，2026-10-08）

目标：解除T-18实际GitHub Actions未验收的门禁，为后续T-37/T-38/T-39/T-42和最终T-36提供真实远端结果。当前只有本地代码/验证，用户未授权push或PR，本预览不执行这些动作。

接收仓库：[HachikoJ/anonyproof](https://github.com/HachikoJ/anonyproof)。官方仓库页显示Public，推送内容和草稿PR会公开。匿名API查询403限流记录保留；使用官方公开网页核验，不换账户/凭证。仅改变此仓库的新测试分支与草稿PR。

精确候选：`25e1c6aca958a5d414dc1956dd1e23cd2dd9f9bb`（短号25e1c6a），基线 `67a344af597bbeb3ec5f8ee3e6dbb7fcb2d697ba`；39个本地修复/准备/证据提交，360个变更文件（529跟踪文件）。逐提交及逐文件完整清单/字节/SHA256/候选tree在 `T-18-push-scope.json`。本方案文件自身和之后未批准的变更不包含在候选中；若要更换SHA/扩大文件范围须重新展示。

候选覆盖已批准的本地修复及现有fixture/证据：公开演示固定合成权限、正式新写AES-GCM/兼容reader、校验/配额/事务/CORS/no-store、目标依赖补丁、CI和文档；T-32盘点/候选转换工具仅准备且不接入业务；T-02角色硬隔离/T-21身份行为/T-26身份POST/分页/清理/资产归档等待确认改动未实施。候选保持23完成、2进行中、5阻塞、13待办，不是假称完成版本或上线发布。

已实际可审阅检查：

- `git ls-remote origin HEAD refs/heads/main refs/heads/codex/fix-plan-ci-20261008`退出0，main/HEAD仍基线，建议分支未advertise。推送前必须再核对；若分支已出现/提交变更，不force或覆盖，停下报告差异。
- 当前产品与测试/workflow源等于已测dac38ce；Node20.20.2/npm11.21.0两树clean npm ci/ls、SQLite ABI、前端type、原server type加真实全backend strict tsc、build、123通过/0失败/1明确T-34SKIP以及audit有效报告门禁全部0；Node22/浏览器/基准/回滚证据在逐任务审计中独立对应。
- candidate最终529跟踪路径和39提交全部393个新blob版本未出现真实env、DB/SQLite/WAL/私钥、node_modules或.next路径；改动audit JSON敏感字符串字段0、格式化恢复码0；定义的私钥/GitHub/AWS/Bearer/Cookie/env值模式发现13个历史版本命中，均为明确文档占位（最终3处），未输出raw敏感值。具体覆盖/模式/路径/hash记录 `T-18-push-privacy-precheck.json`、`T-18-push-history-privacy.json`；这不是对所有秘密格式的无限保证，不把有限模式扫描叫全量证明。
- 将公开的是代码、FIX_PLAN.md全部已修/未修问题与确认账本、固定合成fixture、公开依赖元数据及控制台/本机临时目录路径；在线站尚未部署这些修复，推送草稿不会自动关闭站上风险；没有上传私有测试库、真实.env.local、内容key文件、Cookie或真实访客材料。证据文件含本机路径这一影响已明确列入批准范围，不在未确认时先发布。
- 仓库只有一个CI workflow；push只覆盖main/develop，故只push新codex分支不会运行本门禁，必须新建base=main的Draft PR触发现有pull_request。workflow没有部署步骤/生产secrets引用，不增加部署流程，不操作外部站点。
- root audit仍low1/high3/critical0四包告警，server0；新Next六项N-04没有借此扩展升级。真实CI可能失败，失败留在Draft状态，不能用本地绿替代。

身份/认证门禁（只读实查）：本机gh2.97.0存在，当前keyring账号HachikoJ；`gh auth status --hostname github.com`实际退出1，CLI明确报告stored token invalid，诊断未报告rate limit/network failure。只保存脱敏状态/诊断布尔值，未运行gh auth token、换账号、logout或login。记录 `T-18-push-auth-status.json`。因此发布批准到达后，还需用户在本机用同一HachikoJ恢复登录（`gh auth login --hostname github.com`）；不要求粘贴令牌/密码给代理。若恢复的是其它身份，应先核对该身份是否获得本次仓库操作授权。不能以公共repo的ls-remote成功当写入/PR权限有效。

待批准的操作序列：

1. 再核对远端和已批准候选hash/清单，使用当前配置的origin/现有GitHub身份，非force执行 `git push origin 25e1c6aca958a5d414dc1956dd1e23cd2dd9f9bb:refs/heads/codex/fix-plan-ci-20261008`。不push main/develop、不移动本地main/覆盖用户改动。
2. 使用现有身份创建 `head=codex/fix-plan-ci-20261008`、`base=main` 的Draft PR，题目“修复计划：已验证修复与CI验收”，正文说明旧CI未验证server安装/native/实际类型/运行，候选的具体修复、123pass/1有意SKIP、23/43状态、新范围外告警及尚未上线。附到当前chat，不合并；这同时是公开PR文字发送授权的一部分。
3. 实际等待该精确head的Ubuntu CI结果，逐步核对两安装树/native/类型/build/tests/audit上传及实际URL。失败记录原输出，按T-18原范围修正/再验，不顺手部署或修N-04；新代码修复需要额外推送时从已获批准候选/测试分支使用隔离checkout，只续传T-18必要修正并核对新head；本地后来新增的本预览/认证记录等未在候选清单中的提交不能顺手一起push。
4. 必要项实际通过后才关闭T-18，并分别按依赖实施已批准边界的分页/幂等；T-42保留策略和其它问题依然阻塞各自任务，不由push批准代替。

影响/恢复：原main和在线实例不变，无真实库/schema/密钥/配置写入；测试失败保留分支、Draft PR、日志和本地提交，不删除资源。需要结束PR时可关闭但保留代码分支，关闭/删除不是本次默认操作；公共push难以保证互联网副本撤回，因此不能把删分支当隐私恢复办法。批准的只是此明确候选及T-18范围内必要后续CI修正的测试分支/草稿PR，不授权合并、部署、其它任务的重大行为或资产删除。

确认依据：用户提供AGENTS.md第7节“质量要求不授予 commit、push、PR、发布或公开数据的权限；按用户请求执行对应动作。”持续目标已明确授权独立commit，但没有push/PR。这次确认只补齐真实远端验收必要的发布边界，不重复请求已批准的本地修复。
