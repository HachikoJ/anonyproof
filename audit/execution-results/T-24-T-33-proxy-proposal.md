# T-24 / T-33 代理边界具体方案（待确认）

2026-10-09。只准备方案，没有更改生产或产品代理策略。实际依据为 T-24-T35-real-chain-result.json：两实际loopback来源经Nginx→Next→Express均保持来源且伪造单/多XFF不变；同来源更换XFF共享登录配额、另一来源独立。直连Express携带XFF能选择任意来源，T24验收失败。45项T35真实页面/静态/API业务检查通过。模板继承默认combined日志，合成query和UA marker实际出现在Nginx访问日志中，T33尚未关闭。

## A：T-24 私有代理认证

范围：server/middleware/proxyBoundary.ts（新增）、server/index.ts的首个请求边界、.env.example、deploy/nginx/anonyproof.deline.top.conf、部署说明和T24合成测试。不改变公共URL、业务鉴权、CORS、配额或trust proxy为true。

- 继续支持无代理的显式TRUST_PROXY=0（开发/隔离测试）；清除所有forwarded来源头后仅使用socket来源。
- TRUST_PROXY=1启动必须有独立随机至少32字节PROXY_AUTH_KEY。Nginx从受限私有include覆盖X-AnonyProof-Proxy-Auth，不转发访客同名值；Next现有rewrite只转发此内部头。Express仅允许loopback socket且内部键常量时间比较成功的API请求使用规范XFF；缺失/错误/重复键403，业务、身份及来源配额不变。接收后移除内部键，响应和日志均不输出。
- /health保留本机只读探针，无论header都只按socket处理；其余直连API在代理模式下403。正式与演示实例各自独立代理键，不能用内容密钥、GitHub令牌或会话密钥代替。
- 私有include与环境文件0600、仓库只放占位指引，不写实际键。代理模式旧配置缺键将失败关闭：必须先准备配置，再启后端并复核链路；无生产发布或配置写入包含在本次批准中。

验收：两来源/无、单、多伪造XFF；伪造内部头被Nginx覆盖；同源共享429、另一源独立；直连缺/错/重复键403且DB无业务写；健康探针正常；正确键仅loopback可用；缺启动键失败；7天日志和输出中无键。保留45项真实T35回归。先本地fixture，生产另行展示差异并批准。

风险/回滚：内部部署配置新增强制键，错误配置会使API不可用。独立T24提交；回退到此前兼容代码和原本地配置可恢复服务，但直连伪造风险仍在，任务不得标完成。实际上线回滚必须保持3000/4000仅loopback且不得回用追加外来XFF的旧vhost。

## B：T-33 Nginx 请求日志最小化

范围：唯一支持vhost和说明、合成日志验收。建议在此vhost显式access_log off、error_log /dev/null，避免继承combined或错误堆栈记录原始IP/UA/query/业务编号。应用层仍保存已批准的来源IP7天、浏览器家族/机器人分类及路由模板和聚合；Nginx启动/配置检查由进程级运维记录承担。

影响：该站不再有Nginx逐请求访问与错误日志，排障使用受限应用指标/日志和nginx -t；这是明确的可观察性取舍，待用户批准，不能暗改。只改本vhost，其他站和全局日志不变；不删除任何历史日志，真实历史资产处置仍单独确认。

验收：在继承combined全局fixture中向未知路径/异常上游/错误请求发送固定合成IP/完整UA/query marker，站点访问/错误日志无marker，应用DB仅批准分类/路由字段；实际HTTP、Cookie、Origin、PUT/DELETE回归通过。错误场景退出码与HTTP状态必须如实记录。

回滚：独立T33配置提交，恢复上一模板会恢复日志泄露，因此只作为临时排障操作且任务重开；默认安全回滚为保留日志关闭、回退产品代码，不重新开放历史原始日志。
