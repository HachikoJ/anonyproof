# T-35 本地执行证据（部分验收）

2026-10-08。用户 A 批准后执行。此文件不关闭 T-35，也不证明线上环境。

## 已执行的授权范围

- 安装前 `command -v nginx` 无结果，Homebrew 无 nginx；已有 openssl@3 3.6.3 和 pcre2 10.47_1。
- `/opt/homebrew/bin/brew install nginx` 实际 exit 0，安装 nginx 1.31.6、必要 openssl@4 4.0.3，升级必要 ca-certificates 到 2026-09-25、pcre2 到 10.49。旧版本均保留；安装器 unlink 了 openssl@3 的全局链接，`/opt/homebrew/opt/openssl@3` 旧版本仍可用。自动更新阶段在既有清华镜像 fetch 约 3 分 40 秒无输出，仅向这次安装的 update/fetch 子进程发送 SIGINT；原安装随后继续并成功。未改镜像或 tap 信任配置。
- 未运行 brew services、系统 nginx、系统 reload、旧部署脚本或线上变更。安装后只读 `launchctl print gui/501/homebrew.mxcl.nginx` exit 113，报告该服务不存在。
- 对批准的 21 个源文件先检查内容 SHA256、字节数与目标不存在，再移动到 `deploy/nginx/legacy/`；逐个复验 hash／大小一致，源路径已移动。目标未覆盖。
- 两个批准的 legacy 脚本保留 shebang 与全部原正文，在正文前增加错误提示及 `exit 1`。重构出的原文 SHA256 与清单一致；只执行 `bash -n`，未执行脚本正文。
- `deploy/nginx/anonyproof.deline.top.conf` 是支持目录唯一 `.conf`。README 明确禁止 legacy 通配 include，记录 direct-edge 前提和回滚边界。模板另外拒绝缺 Host 的 HTTP/1.0 请求；HTTP/1.1 缺 Host 由 Nginx 400 拒绝。

## 实际隔离测试

```bash
python3 audit/execution-results/T-35-fixture-runner.py
bash -n deploy/scripts/legacy/fix-nginx.sh deploy/scripts/legacy/final-fix.sh
git diff --check
```

最后一次 fixture 实际 exit 0，111 项断言通过，`T-35-fixture-result.json` 保存命令、版本／编译选项、每项实际值及期望值。执行的是本模板，仅换成回环高位 HTTP／TLS 端口、测试证书与合成 echo upstream。证书独立生成在私有临时目录、测试私钥 0600，客户端显式信任该证书并检查 SAN，没有 `-k` 或关闭校验。

验证覆盖：`nginx -V`、`nginx -t`、特定 fixture 启停；HTTP GET/POST/PUT/DELETE/OPTIONS/HEAD 308 与 path/query 保留；HTTPS 根路径 301 与 query 保留；未知 Host 和 basePath 之外 404；basePath 原样代理；GET/POST/PUT/DELETE/OPTIONS 的方法、正文及 query 保留；入口覆盖 Host、Proto、Port、XFF、Real-IP 并清除其它 Forwarded 变体；两枚合成 Set-Cookie 和 no-store 原样返回；缺 Host 400；TLS 1.2 和 1.3 分别协商成功；TLS HEAD 无正文；master exit 0、pid 文件移除及两个 fixture socket 关闭。echo 服务也已关闭。

最终保留的 fixture 前缀见 JSON。此前两次成功 fixture 也留在临时目录；没有资产清理。报告只含合成 Cookie，测试私钥、真实密钥和证书未写入仓库。`T-35-local-assets-validation.json` 单独保存 21 项归档和两脚本原文检查及静态命令结果。

## 仍不能作为已完成的原因

- echo fixture 不是 Next／Express；三页面、实际 manifest 静态缓存、受保护 API、Origin、真实 Cookie、UI 登录／提交／回复／状态／通知定位和经代理 DELETE 一致性由主代理进一步执行。
- direct-edge 为模板前提，真实 CDN／负载均衡／生效 vhost 尚需只读查证；此处的 XFF echo 不能证明 Express 的真实 req.ip 或 T-24。
- 未核验生产证书链／SAN、真实端口暴露、已有 PM2 快照、当前配置 include；未复制模板或 reload 生产。
- 线上启用、真实数据处置及部署仍需各自授权，不能把 A 对本地归档／测试的批准扩大成发布授权。

本次没有修改 FIX_PLAN、DEPLOY.md、docs/DEPLOYMENT.md，没有 git add／commit／push，也没有运行共享 Next build。

## 2026-10-09 真实 Next / Express 链路补验

`T24_SECOND_SOURCE=::1 npx --no-install tsx tests/fix/T-24.chain.ts` 实际45项T35通过/0失败。三页面、全部引用静态、实际身份和管理员Cookie属性、no-store、Origin拒绝后状态不变、提交、双方评论、状态PUT与DELETE关联清除均通过。T24同时发现直连backend伪造XFF，独立失败仍保留；Nginx继承combined日志marker为T33缺口，未修改产品策略。

首次runner在429之前未生成access行时误认为故障中止；第二次对HTTP头名称大小写敏感误报Cache-Control。两个原报告逐份保留，第三次修正fixture并完成业务矩阵。只改验收器，不改产品响应来迎合测试。报告为T-24-T35-real-chain-result.json及first/second-result.json；服务与socket退出经证据核验。仍缺真实浏览器UI、生产证书/公网端口/最终启用授权，整项不关闭。
