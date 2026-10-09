# 受支持的 Nginx 配置

唯一受支持的入口模板是 `anonyproof.deline.top.conf`，在 Nginx `http` 上下文中明确 include。不能用通配符加载本目录及 `legacy/`，不能复制历史配置作为替代入口。模板保留 Nginx → Next（回环 3000）→ Express（回环 4000）和 `/anonyproof` basePath，HTTP 业务请求以 308 保留写入方法，保留已核实的 `/.well-known/acme-challenge/` 与 `/var/www/_acme-challenge` 证书验证 webroot；未知 Host、缺失 challenge 或其他业务路径之外返回 404。正式适配时先核对实际续期 webroot，不能把 server 级 return 放在 challenge location 前使其失效。

模板以 Nginx 直接接受公网连接为前提。在确认 CDN／负载均衡、真实证书、服务角色、TRUST_PROXY 和实际 socket 前，不能当作生产可直接启用的配置。`X-Forwarded-For` 在此前提下由入口覆盖为 socket 来源；有前置代理时必须按 T-24 验证来源与头部契约，不能仅改成 append。正式启用与 reload 需单独授权，并先备份当前生效 vhost、运行实际 `nginx -t`。

证书路径是既有部署约定，不代表证书或 SAN 已验证。此模板不改变响应 Cookie 或 Cache-Control，不额外启用缓存、限流、图床或 WebSocket。

`legacy/` 保留 21 份逐字归档的历史配置。回滚仓库资产可按 `audit/execution-results/T-35-assets.json` 的原路径与 SHA256 移回；资产恢复不使历史配置重新成为受支持入口。线上回滚须使用另存的原生效配置并先验证语法，不能用这些历史变体覆盖。

本地隔离验证只使用 127.0.0.1 高位端口、独立临时目录和自签测试证书；不启动 Homebrew 系统服务、不改 hosts、不接触真实库或真实证书。T-35 完成还需真实 Next／Express 合成链路、UI、DELETE 和外部端口验收，纯代理 fixture 或 `nginx -t` 通过不等于整项完成。具体执行入口见根目录 `DEPLOY.md`。

T-24代理模式另要求受限私有include中的独立代理键与后端PROXY_AUTH_KEY一致；入口覆盖访客认证头，直接backend API缺/错键403。缺include时nginx -t失败，缺后端键时服务失败启动。实际生成/部署方式见DEPLOY.md；仓库与fixture公开报告不保存真实键。

T-33 在本站 HTTP 和 HTTPS 两个 vhost 均显式设置 `access_log off; error_log /dev/null;`，不再继承全局请求日志；其他站和全局日志不变。本站代理请求级错误明细随之不可用，排障使用应用层已批准的7天最小字段、聚合统计、进程状态和本地合成探针。该变更不删除既有日志，历史文件仍需独立确认处置。启动/语法诊断仍可能由 Nginx master 写入全局日志，不把它作为本站访问记录保存。

本地日志验收命令为 `python3 audit/execution-results/T-33-nginx-privacy-runner.py`，只启动独立高位回环 echo fixture；报告含本站正常、未知路径、无效请求、上游故障无请求标记的断言，以及独立对照 vhost 仍继承全局 access/error 日志的正向断言。真实 Next/Express 链路另外运行 `T33_NGINX_PRIVACY=1 npx --no-install tsx tests/fix/T-24.chain.ts`，保留 T-24/T-35 回归并写入新的 T-33 证据，不覆盖旧报告。均不代表生产已启用。
