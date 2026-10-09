# 历史 Nginx 资产：禁止启用

本目录包含 T-35 批准归档的 21 份原配置，逐字保留，文件名不变。仅用于历史查证和资产恢复；它们不是受支持的生产模板，不能 include、不能通配复制到系统 Nginx 目录，也不能配合旧部署脚本执行。

唯一受支持模板是上级的 `anonyproof.deline.top.conf`，启用前仍需核对真实环境并获得发布授权。原路径、内容 SHA256 和字节数见 `audit/execution-results/T-35-assets.json`，实际移动结果见 `T-35-archive-result.json`。需要恢复历史资产时先核对哈希和目标不存在，再移回原路径，不能覆盖新模板或线上生效 vhost。
