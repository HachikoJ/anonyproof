# 未支持的附件历史源码

这里逐字保留未接入现有页面的附件源码，使用 `.txt` 扩展名，不参与 TypeScript / Next.js 编译。它们不是受支持的组件或接口，禁止直接启用；附件能力仍未实现。

| 任务 | 原位置 | 历史文本 | SHA256 |
| --- | --- | --- | --- |
| T-28 | `app/components/FileUpload.tsx` | `FileUpload.tsx.txt` | `0eb8e346efd86cc5809672fb8892cf8d67cc4fc797e75d95e8c3cef18e87d484` |
| T-28 | `app/utils/imageUpload.ts` | `imageUpload.ts.txt` | `8d1a3f2249c6f3ead0eed1f9195fd8b626610549d3d2282e8ac026a47ea68189` |

T-28 历史代码包含 ImgBB / Imgur 请求及客户端环境变量。`NEXT_PUBLIC_*` 变量会暴露给浏览器，不是私密凭证；当前应用不要求这些图床凭证，也没有第三方附件上传入口。归档不代表该上传方案安全或可用。

恢复时先核对上表 SHA256，再将历史文本复制到对应原路径；原路径已有文件时停止，不覆盖。保留归档文本与此“不支持”说明，恢复后重新执行类型、构建和受影响流程验证。
