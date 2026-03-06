# GitHub Pages 配置

本项目的 GitHub Pages 部署配置。

## 部署方式

使用 GitHub Pages 从 `docs/` 目录部署。

## 本地预览

```bash
# 进入 docs 目录
cd docs

# 启动简单的 HTTP 服务器
python3 -m http.server 8000

# 或使用 Node.js
npx serve .

# 访问
# http://localhost:8000
```

## 部署步骤

1. 确保所有文件已提交
2. 在 GitHub 仓库设置中启用 GitHub Pages
3. 选择 Source 为 "Deploy from a branch"
4. 选择分支 `main` 和目录 `/docs`
5. 保存设置

## 访问地址

部署完成后访问: https://hachikoj.github.io/anonyproof/
