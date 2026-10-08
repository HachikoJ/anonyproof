# T-28 / T-29 附件旧源码处置预览

日期：2026-10-08（Asia/Shanghai）。状态：仅准备，尚待Q-08具体批准；两任务保持独立，不因清单生成而完成。

## 建议的确切差异

逐字保留三份源文件，移为不参与TS/Next编译的历史文本；不删除内容、不实现上传、不安装/配置图床、不移除依赖。三个目标当前均不存在，具体源字节数、SHA256和Git mode见同目录`T-28-T-29-asset-proposal.json`。

| 任务 | 原位置 | 拟归档位置 |
| --- | --- | --- |
| T-28 | app/components/FileUpload.tsx | archive/unsupported-uploads/FileUpload.tsx.txt |
| T-28 | app/utils/imageUpload.ts | archive/unsupported-uploads/imageUpload.ts.txt |
| T-29 | app/components/LocalFileUpload.tsx | archive/unsupported-uploads/LocalFileUpload.tsx.txt |

`.txt`保留原内容但避免下次被当现成React组件/工具直接导入；不替换为另一套上传实现。新增`archive/unsupported-uploads/README.md`列原路径/hash及“历史不支持、禁止启用；客户端图床变量不是私密凭证；本地上传接口未实现”。README路线图继续标附件未实现，说明归档源码不代表能力已交付。根package/锁文件、react-dropzone、活跃页面/服务器及其它archive资产不改。

按T-28两文件→T-29一文件分别实施、验证并提交；共享README也分别写清每项归属。不得将两个独立任务合成一个已完成状态。已有目标/源码hash变化时停止，不能覆盖用户修改。

## 当前证据的界限

Git基线`a391c00`：三源字节与HEAD一致；未移动、禁用、改写文件。`rg`在app/server/模板/活跃说明/入口搜文件名、上传函数、公开key和upload-local：匹配只在上述三源的声明/内部调用，没有活跃调用方；服务器没有upload-local字面路由，README路线图仍未勾选附件。

额外以已安装TypeScript解析实际16份app TS/TSX，解析import/export及字面dynamic import/require，四个Next入口向下遍历：三源直接caller为0、入口不可达；未解析本地代码导入0、计算式导入0。首次检查因layout的两现存CSS导入无法用TS代码resolver解析而中止，核对后明确归类为非代码样式资产，不以忽略JS缺口求过关。该静态图是“当前源码未接入”的证据，不能替代浏览器网络验收，也不能证明未来代码永远不会启用附件。

## 批准后的客观验收

1. 每项归档后比较源基线和对应目标SHA256/字节完全一致；原路径不再有活跃源，目标未覆盖其它资产。归档README包含原路径、任务编号、不支持范围。README附件路线图仍未实现，不要求任何NEXT_PUBLIC图床凭证。
2. T-28执行 `rg -n 'api\.imgbb|api\.imgur|NEXT_PUBLIC_IMGBB|NEXT_PUBLIC_IMGUR|FileUpload|uploadToImageHost|uploadToImgur|uploadImage' app .env.example`，第三方调用/凭证要求为0；其中LocalFileUpload这个未接入的T-29名字在T-28阶段可能仍有声明，不把它误算作第三方图床调用。历史模式只存在指定.txt文本，不成为第二套受支持接口。
3. T-29执行 `rg -n 'upload-local|LocalFileUpload' app server --glob '!**/node_modules/**'`，活跃调用/路由声明为0。rg无匹配的退出1是预期结果，不算工具故障。两项依赖保持原样，不顺手删react-dropzone或重构组件。
4. 每项实际 `npm run type-check`、`npm run build`、`git diff --check`退出0；不为死源码处置搭建上传测试框架。
5. 使用现有隔离后端/Next fixture，实际浏览器完成既有提交、本人查看、后台处理/回复；采集受影响流程的请求URL，断言无ImgBB/Imgur及upload-local请求、无file input/上传动作。正式文本与已批准demo固定合成流程按所用fixture明确记录，不能用仅页面可见断言证明网络未上传。测试数据均合成；**不发真实或测试文件到第三方来验证**。
6. 分别保存T-28/T-29命令退出码、hash、网络/流程证据，验收通过才标完成；按编号独立提交。未批准前本文件只提供方案和静态盘点。

## 影响及恢复

按当前已核验调用图，现有页面/接口不使用这三源；归档会使未来开发者需要主动从历史文本恢复代码才能导入，防止误当已支持的附件能力。没有新业务能力或运行数据处置。

回滚按manifest/hash将历史文本复制回对应原源路径并重新type/build；如果原路径已被用户新增文件占用，停止并核对，不覆盖。保留归档文本和“不支持”说明，不通过回滚宣称图床/本地上传变成安全或可用。现有数据、环境变量、网络配置、生产服务和Git发布均不受此预览影响。

需要具体确认的依据：用户在本对话提供的AGENTS.md第2节要求“删除，以及明显改变既有功能或行为的重大修改/更新……取得确认”；资产原位置移走与既有开发入口退出须先展示清单/影响/恢复办法。Q-08原计划也明确以具体去留决定为前置。没有把新增文本预览当移动授权。
