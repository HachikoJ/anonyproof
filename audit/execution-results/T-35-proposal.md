# T-35：部署配置及旧资产处置预览

日期：2026-10-07。状态：待确认、未启用、未通过 nginx 验收。对应 FIX_PLAN.md 的 T-35；不代表线上配置已取得或新配置已可用。

## 具体范围

建议保留当前的 Nginx → Next 3000 → Express 4000 链路。域名仅为 `anonyproof.deline.top`，保留 Next 的 `/anonyproof` basePath；不改主域、培训或其它应用的 vhost。HTTP 采用 308 跳转到同域 HTTPS，以保留写请求方法；HTTPS 根路径仍 301 到 `/anonyproof`。未知 Host 不交给本应用。

新建唯一受支持文件 `deploy/nginx/anonyproof.deline.top.conf`。下列草案只是文档预览，不能复制到生产，不能以静态阅读代替 `nginx -t` 或实际链路测试。证书路径来自既有说明，须验证实际证书/SAN及私钥权限；不申请、上传或轮换证书。

草案**以 Nginx 直接接受公网连接、前面没有 CDN/负载均衡为前提**。在此前提下入口覆盖客户端 XFF，使用 socket 来源；若有上游代理，先确认其来源及头部契约，不能照抄此段。Express 的 TRUST_PROXY 保持待 T-24 证据决定，不在 T-35 中默认改为 true 或宣称 1 已正确。

```nginx
# PREVIEW ONLY: intended for the http context after approval and testing.
server {
    listen 80;
    listen [::]:80;
    server_name anonyproof.deline.top;
    if ($host != anonyproof.deline.top) { return 404; }
    return 308 https://anonyproof.deline.top$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name anonyproof.deline.top;
    ssl_certificate /etc/nginx/ssl/deline.top/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/deline.top/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    if ($host != anonyproof.deline.top) { return 404; }

    # Preserve the upstream's Cookie and Cache-Control decisions.
    proxy_cache off;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host anonyproof.deline.top;
    proxy_set_header X-Forwarded-Host anonyproof.deline.top;
    proxy_set_header X-Forwarded-Port 443;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Forwarded "";
    proxy_set_header X-ForwardedFor "";
    proxy_set_header X-ForwardedProto "";

    location = / { return 301 https://anonyproof.deline.top/anonyproof$is_args$args; }
    location = /anonyproof { proxy_pass http://127.0.0.1:3000; }
    location ^~ /anonyproof/ { proxy_pass http://127.0.0.1:3000; }
    location / { return 404; }
}
```

这里只保留业务路径、HTTPS、方法和头部所需设置，不加入另一套限流、全站静态缓存、图床、WebSocket或证书自动管理。API继续由Next rewrite转发，不在本任务悄悄缩短代理链。`proxy_pass`不加URI，以保留basePath；HTTP→HTTPS的308保留方法。Nginx官方依据：[proxy_pass / proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[return](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)、[TLS配置](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)。这些说明只支持草案原理，不能证明实际配置已验收。

## 旧资产建议处置

具体21个源文件、SHA256、目标见同目录 `T-35-assets.json`，摘要同步列在 FIX_PLAN.md。建议**逐字保留并移动**到 `deploy/nginx/legacy/`，文件名不变，不删除任何文件。目标已存在或源hash变化时停止并重新核对，不覆盖。归档目录增加“不支持、禁止生产include或通配复制”的README。

当前 `deploy/scripts/legacy/fix-nginx.sh` 和 `final-fix.sh` 是两处实际写/重载Nginx配置的旧入口，含其它项目域名、错误头、rm或PM2删除动作。建议保留文件和原脚本文本，在开头增加明确的历史/禁止执行提示并非0退出；不运行其中任何动作。其余7个历史脚本无Nginx写入引用，本任务不顺手修改它们。

`DEPLOY.md`、`docs/DEPLOYMENT.md`、`deploy/README.md`在具体方案批准后只指向新的唯一模板；保留旧教学片段作为明确不支持的历史文字，不提供第二套可执行启用命令。`ecosystem.prod.config.js`与package.json无需为此移动；前后端start现已默认回环，仍必须通过实际socket/外部探针验证，不能以默认值证明生产端口关闭。

## 验收环境及执行顺序

本机 `command -v nginx` 失败，没有可用nginx。Docker daemon可读，但现有image列表为空；未拉取镜像、安装nginx、启动容器、改系统服务或线上配置。下一步须有获准的Nginx验证环境，记录具体版本和编译选项。没有工具时不能将T-35标完成。

1. 确认上述域名/代理前提、具体21文件移动和两脚本禁执行方案；确认可用验证环境。线上启用另依赖T-02及发布授权。
2. 在独立临时目录生成主配置（pid、error/access log、client/proxy temp目录均在该目录），使用新自签**测试**证书，HTTP/TLS均监听127.0.0.1高位空闲端口。只修改草案端口/测试证书/fixture upstream及精确测试域名，保留生产路径规则。不改hosts、真实证书、系统nginx或真实库。
3. 执行 `"$NGINX_BIN" -V`、`"$NGINX_BIN" -t -p "$FIX_NGINX_PREFIX/" -c "$FIX_NGINX_CONF"`。变量均为操作者确认的绝对路径；任何非0停止。启动同一配置，退出时仅停止该fixture进程，保留临时资产。
4. 固定测试Host，HTTP请求断言308、Location同域且完整保留path/query；HTTPS `/`断言301到`/anonyproof`，未知Host/其它路径404。TLS测试显式信任fixture证书，不以curl -k通过充当正式证书验收。
5. 真实Next生产构建/start及独立Express合成库：三页面200、manifest指定静态资源200且immutable、公开API正常；受保护API拒绝未授权，授权响应no-store。实际浏览器登录/提交/回复/状态PUT及通知定位；Cookies逐项检查Secure/HttpOnly/SameSite与原响应未被代理改写。Origin矩阵沿用T-26/T-27，缺Origin403且业务表不变。
6. 使用仅合成记录验证DELETE可经代理到达并按**当时已批准的T-34语义**生效。T-34未确认/完成时不由本任务创造删除语义；不得把现有孤儿残留当“删除一致性通过”。另捕获最小脱敏headers证明Host、Proto正确；真实来源/XFF伪造及Express req.ip归T-24独立验收，不只用伪造请求头推断。
7. 归档后源/目标hash逐项一致，支持目录只有唯一模板及README、无wildcard legacy引用，两旧脚本静态检查开头非0guard。运行相关API回归、type-check、build、git diff --check；禁止运行旧脚本做“测试”。
8. 线上只在另获批准后保存原生效vhost快照、`nginx -t`再reload；补HTTPS证书链/SAN、跳转、三页面/静态资源/API及公网3000/4000不可达证据。未授权/未补验时如实保留未完成项。

## 风险与回滚

高风险改动独立T-35提交。仓库回滚可按hash将21文件移回原位并还原文档/脚本guard；这只是恢复历史资产，不允许重新作为受支持配置。上线回滚恢复**已保存的原生效vhost**并先nginx -t再reload，不重装PM2、不切换数据库/角色、不清理数据。原生效配置若不满足已批准沙箱隔离则关闭公开写入，不能靠回滚重新暴露真实材料。证书、源DB和内容key均不属于此次移动/改写清单。
