# 受支持的 Nginx 配置

唯一受支持的入口模板是 `anonyproof.deline.top.conf`，在 Nginx `http` 上下文中明确 include。不能用通配符加载本目录及 `legacy/`，不能复制历史配置作为替代入口。模板保留 Nginx → Next（回环 3000）→ Express（回环 4000）和 `/anonyproof` basePath，HTTP 308 保留写入方法，未知 Host 或业务路径之外返回 404。

模板以 Nginx 直接接受公网连接为前提。在确认 CDN／负载均衡、真实证书、服务角色、TRUST_PROXY 和实际 socket 前，不能当作生产可直接启用的配置。`X-Forwarded-For` 在此前提下由入口覆盖为 socket 来源；有前置代理时必须按 T-24 验证来源与头部契约，不能仅改成 append。正式启用与 reload 需单独授权，并先备份当前生效 vhost、运行实际 `nginx -t`。

证书路径是既有部署约定，不代表证书或 SAN 已验证。此模板不改变响应 Cookie 或 Cache-Control，不额外启用缓存、限流、图床或 WebSocket。

`legacy/` 保留 21 份逐字归档的历史配置。回滚仓库资产可按 `audit/execution-results/T-35-assets.json` 的原路径与 SHA256 移回；资产恢复不使历史配置重新成为受支持入口。线上回滚须使用另存的原生效配置并先验证语法，不能用这些历史变体覆盖。

本地隔离验证只使用 127.0.0.1 高位端口、独立临时目录和自签测试证书；不启动 Homebrew 系统服务、不改 hosts、不接触真实库或真实证书。T-35 完成还需真实 Next／Express 合成链路、UI、DELETE 和外部端口验收，纯代理 fixture 或 `nginx -t` 通过不等于整项完成。具体执行入口见根目录 `DEPLOY.md`。

T-24代理模式另要求受限私有include中的独立代理键与后端PROXY_AUTH_KEY一致；入口覆盖访客认证头，直接backend API缺/错键403。缺include时nginx -t失败，缺后端键时服务失败启动。实际生成/部署方式见DEPLOY.md；仓库与fixture公开报告不保存真实键。
