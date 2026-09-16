# AnonyProof Logo

## 设计概念

标识由三层语义组成：

- **盾牌**代表隐私、安全与可信。
- **对话气泡**代表匿名反馈与双向沟通。
- **指纹弧线与勾选**代表隐藏身份，同时保留可验证、可追溯的证明。

图形优先保证小尺寸识别度，英文与中文标准字用于需要完整品牌名称的场景。

## 文件

- `public/brand/anonyproof-logo.svg`：横版主标识，浅色背景使用。
- `public/brand/anonyproof-logo-white.svg`：横版反白标识，深色背景使用。
- `public/brand/anonyproof-mark.svg`：图标版，用于头像、应用图标和社交平台。
- `public/brand/anonyproof-mark-mono.svg`：单色图标版，颜色继承 `currentColor`。
- `app/icon.svg`：Next.js favicon 资源。
- `app/apple-icon.png`：Apple 设备主屏图标。
- `docs/brand/anonyproof-logo.png`：横版 PNG 预览。
- `docs/brand/anonyproof-mark.png`：图标 PNG 预览。

## 品牌色

| 用途 | 色值 |
| --- | --- |
| 品牌主色 | `#667EEA` |
| 品牌深色 | `#764BA2` |
| 深色文字 | `#111827` |
| 次级文字 | `#64748B` |
| 验证强调色 | `#34D399` |

## 使用规则

- 横版标识建议最小显示宽度为 `180px`，图标建议最小显示尺寸为 `24px`。
- 标识周围应保留不小于图标宽度 `10%` 的空白区域。
- 深色背景使用反白版；单色印刷使用 `currentColor` 版本。
- 不要拉伸、旋转、加描边、加投影，或把渐变改为无依据的第三种颜色。
- 中文名称为“匿证”，英文名称为“AnonyProof”，两者不要混写成不同大小写形式。

## 字体

英文标准字使用 `Avenir Next` / `Inter` 风格的几何无衬线字体，中文使用 `PingFang SC` / `Noto Sans CJK SC`。当前 SVG 保留可编辑文字；如需对外交付固定字型，可将文字转为轮廓后再导出。
