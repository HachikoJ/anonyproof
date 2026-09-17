# 项目截图

README 与项目介绍页使用的截图统一放在 `docs/images/`，文件名以 `current-` 开头，取自线上演示站 <https://anonyproof.deline.top/anonyproof>。

## 📸 截图清单

| 文件 | 页面 | 尺寸 |
| --- | --- | --- |
| `current-user-home-desktop.webp` | 用户端首页 | 1440 × 900 |
| `current-user-submissions-desktop.webp` | 我的提交列表 | 1440 × 900 |
| `current-user-detail-desktop.webp` | 提交详情（材料 / 沟通分栏） | 1440 × 900 |
| `current-user-home-mobile.webp` | 移动端首页 | 390 × 844 |
| `current-user-detail-mobile.webp` | 移动端提交详情 | 390 × 844 |
| `current-admin-login-desktop.webp` | 管理端登录（演示密码提示） | 1440 × 900 |
| `current-admin-records-desktop.webp` | 管理端线索管理 | 1440 × 900 |
| `current-admin-detail-desktop.webp` | 管理端提交处理 | 1440 × 900 |

历史截图（2026-08）保留在 `docs/images/` 中，仅作对比参考，不再被 README 与介绍页引用。

## ♻️ 重新生成截图

界面改版后需要同步更新截图，用 Playwright CLI 从演示站抓取：

```bash
export PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"

# 桌面端
"$PWCLI" -s=shots open https://anonyproof.deline.top/anonyproof
"$PWCLI" -s=shots resize 1440 900
"$PWCLI" -s=shots screenshot --filename=output/playwright/current-home-desktop.png

# 移动端
"$PWCLI" -s=mobile open https://anonyproof.deline.top/anonyproof
"$PWCLI" -s=mobile resize 390 844
"$PWCLI" -s=mobile screenshot --filename=output/playwright/current-home-mobile.png

# 压缩为 WebP 后放入 docs/images/
cwebp -q 82 -m 6 -metadata none \
  output/playwright/current-home-desktop.png \
  -o docs/images/current-user-home-desktop.webp
```

管理端截图需要先登录：在 `/anonyproof/foorpynona` 填入演示密码 `demo12345678` 后再截图。

## 🧾 相关链接

- [项目 README](../README.md)
- [在线演示](https://anonyproof.deline.top/anonyproof)
- [管理端](https://anonyproof.deline.top/anonyproof/foorpynona)
- [部署文档](DEPLOYMENT.md)
