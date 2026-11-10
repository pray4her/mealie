# Task07：测试空间部署与回读

当前交付状态见 [收束记录](task07-closeout.md)：用户随后确认已完成真机验证并授权 Git 提交、推送及关闭工单。本文是当时的部署与回读记录，不覆盖后续客户端修复或用户真机结论；严格存储读取隔离要求已由 [用户接受的读取边界](task07-storage-gate.md) 取代。

日期：2026-11-09（America/Los_Angeles；最终验证 UTC 2026-11-10）。用户明确要求未部署则部署云端，本轮已部署至既有支付宝测试空间 `env-00jy7289et7b`。微信平台上传、生产发布及 Git 提交推送未执行。

## 已通过：上传和回读

`task07-upload-scope.json` 固定 10 项资源及源码摘要，全部取得官方 HBuilderX 5.34 CLI 上传成功回执：

- 公共模块：`home-contracts`、`home-kernel`、`home-media`、`home-recipes`。
- 云对象及函数：`media-co`、`media-review-callback`、`recipes-co`。
- Schema：`media_files`、`media_audit_traces`、`mutation_receipts`。

两个媒体集合为新增；回执集合的唯一语义变化为增加 `recipe-images-v1`。未初始化、清空或重建数据库，未上传索引，未修改环境变量。公共模块上传时，官方工具同步更新依赖它们的既有云函数。

官方 TypeScript 编译首次遇到 HBuilderX TS 5.2 与较新 Node 声明的 Buffer 继承兼容问题。`home-media/platform.d.ts` 补足声明继承，并通过仅类型导入加载；不改变运行逻辑。修复后四个公共模块、三个入口均通过官方检查和编译并成功上传。工具提示上传本地运行时 Node 18.20.0、云端 Node 18.18.2，未调整云运行时。

上传后官方下载并逐项核对：

- 五个身份、配置和 bridge 依赖共 34 个文件与上传前逐字节一致。私有配置仅作字节比较，未解析、输出或复制入仓库。
- `account-co`、`family-co`、`uni-id-co` 源码及 `home-family` 编译模块与上传前逐字节一致。
- 三个上传 Schema 与仓库 JSON 语义一致；既有 `recipes`、`recipe_favorites` 同样保持一致。上述五个集合的 clientDB 读、创建、修改、删除权限均为 false。
- 三个入口官方下载恢复的 TypeScript 与批准源码逐字节一致。下载过程中捕获实际部署 ZIP 的 `__dist__` 入口，未使用本地重编译替代。
- 最终清单为 7 个函数、11 个公共模块、19 个 Schema，恰好增加两个入口、一个模块、两个集合。历史探针 `task07-storage-e50713853130` 保持停用，本轮没有上传探针。

忽略目录 `dist/task07-normal-cloud` 保存 43 个实际部署 JS，静态装载其中 37 个关联模块，未在静态检查中装载平台 SDK 或执行业务方法。公开方法核对如下：

| 入口 | 实际公开方法 |
| --- | --- |
| media-co | complete、read、requestUpload、status、upload |
| recipes-co | bindImages、create、favorite、get、list、update |
| media-review-callback | main |

源码摘要：`6f9788606f7281ac2158a7a2dfa4b65dfdabff6aced0832c53985373f9536316`。
实际云 JS 工件摘要：`de193417c5e3743a10ce119eaad8f3bd79788af41880201b2f21f8be7ae4af77`。
逐项工件摘要、清单和核对结果见 `task07-deployment.json`，官方回执见 `task07-upload-results.json`、`task07-readback-results.json`。完整下载包和私有配置保留在仓库外的本地临时目录。

## 已通过：真实网络入口冒烟

使用已安装的官方 uniCloud SDK、关联开发包的公开客户端配置和隔离的空登录态，通过真实网络调用部署后的五个媒体方法及 `recipes-co.bindImages`，六次均收到 `AUTH_REQUIRED`。未创建账号、使用用户 token 或写入业务数据。

实际调用 `media-review-callback`，空 POST 得到 503，符合缺少有效回调配置时的拒绝行为。此项只验证入口可加载及配置缺失时的响应，不是微信 HTTP 投递、握手或真实内容审核验收。脱敏结果见 `task07-cloud-smoke.json`。

## 本地验证及待验边界

Buffer 声明修复后完整重新执行 `task -d miniapp check -- --maxWorkers=2`：48 套件、607 项通过，ESLint、三组类型检查、微信构建、源码/产物边界和密钥扫描通过。日志为 `dist/task07-deployment-check.log`。文档更新后另执行 `git diff --check`、离线 preview 和 doctor。

内容审核默认关闭，本轮未配置审核凭据或回调条件；未绑定专用业务账号会话，真实上传、校验、绑定、跨家庭和撤权场景仍待验，微信真机选图与预览也待验。模拟回调与本地适配器结果继续仅归为自动化证据。

历史存储探针发现公开 SDK 可凭公开配置和已知文件标识签发可读 URL，因此严格存储层读取隔离仍未通过。原始 URL 的历史 403 不消除该限制；覆盖/删除拒绝、实际到期和撤权后的残余访问仍需实测。部署完成不代表已满足严格私有存储验收。

`task07-acceptance.json` 已登记本次部署、实际云工件与空登录态入口验证，cloud/device 的业务场景继续 pending。`task07:doctor` 的 NON-READY 表示真实验收未齐备；离线 preview 的禁止上传标志仅属于该预览命令，不代表本次部署没有执行。物理文件清理由 #18 负责。
