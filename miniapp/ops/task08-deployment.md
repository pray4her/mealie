# Task08：文本导入部署与验收

状态：2026-11-10 已按用户要求部署至既有支付宝测试空间 `mealie / env-00jy7289et7b`，完成上传和回读核对。真实 AI、定时执行及真机业务验收继续 `needs-info`；未调用付费 AI、上传微信版本或操作真机。

本次定向上传 10 项：四个公共模块 `home-contracts`、`home-kernel`、`home-recipes`、`home-imports`；两个云对象 `imports-co`、`import-worker`；三个新集合 Schema；一个任务索引文件。均取得官方 HBuilderX 5.34 CLI 成功回执。云端最终清单为 9 个函数、12 个公共模块、22 个 Schema。新对象实际部署 ZIP 的编译入口已捕获，并与仓库 TypeScript 源码逐字节核对。实际云 JS 工件位于忽略目录 `dist/task08-normal-cloud`，装载 43 个关联模块确认入口方法分别只有 submit/get/cancel 和私有 _timing。

回读证明：现有 6 个业务入口、`home-family`、`home-media`、五个身份/配置/bridge 依赖（共 34 个文件）与部署前逐字节一致；现有菜谱、收藏和回执 Schema 未变。三个新 Schema 与源码语义一致且 clientDB 四种 CRUD 权限全关。两个扫描索引取得官方上传成功回执；分钟触发配置及 120 秒超时已随 worker 上传、回读，实际分钟触发尚待云日志验收。三个 imports-co 方法通过真实网络空登录态冒烟，均拒绝为 AUTH_REQUIRED，未写业务数据。

HBuilderX 内置 TS 5.2 与较新 Node Buffer 声明不兼容，新模块复用已有纯类型声明补丁后通过官方检查和编译；无运行逻辑变化。修复后完整 `task -d miniapp check -- --maxWorkers=2` 再次通过：54 套件 / 676 项、lint、三组类型检查、微信构建、边界与密钥扫描。日志 `dist/task08-deploy-check.log`。

## 现在填写 API Key 的位置

登录 uniCloud Web 控制台，选择支付宝服务空间 **mealie（env-00jy7289et7b）** → 左侧 **云函数/云对象** → **import-worker** → 详情页最下方 **环境变量** → **编辑**，添加：

- `OPENROUTER_API_KEY`：填入你自己的 OpenRouter API Key。
- `IMPORTS_ENABLED`：填入字符串 `true`。

保存后，再进入同一空间的 **imports-co** → **环境变量**，添加 `IMPORTS_ENABLED=true` 并保存。API Key 只需要配置在 import-worker，imports-co 不需要 Key。其他配额变量可留空，沿用测试环境无限制的缺省值。

也可在 HBuilderX 中右击项目 `miniapp/uniCloud-alipay/cloudfunctions/import-worker` → **配置云函数环境变量**，填写**远程值**并保存到远程；imports-co 同理只设置启用开关。不要填到根目录 `.env`、VITE_*、客户端或源码里，也不需要把 Key 发到聊天中。官方配置说明：`https://doc.dcloud.net.cn/uniCloud/cf-env-variables.html`。

部署后通过官方 CLI 只检查了两对象的配置项名称与远程支持状态：远程配置受支持、当前配置项均为空，未读取任何密钥值。因此 AI 当前仍默认关闭；完成上面两处配置后再在小程序里提交文本，验证约一分钟内开始并自动保存。

运行 `task -d miniapp task08:preview` 生成离线资源清单；运行 `task -d miniapp task08:doctor` 查看缺失证据。Preview 只读源码，不关联空间、不初始化数据库、不执行上传。`task08-acceptance.json` 分别记录本地 fixture、真实 OpenRouter、真实云定时和真机证据；任何模拟结果不能替代后三项。

部署前先与测试空间的只读清单逐项比对资源名、内容摘要、版本、运行时和触发器，确认现有身份、配置及 bridge 模块保持原样。预览目标来自 `ops/project-target.json`。不得清空集合或全量初始化插件。

新增公共模块 `home-imports`；新增 `imports-co`（仅 submit/get/cancel）和 `import-worker`（仅私有 _timing，无公开工作方法、无 HTTP 地址）。修改 `home-contracts`、`home-kernel` 和 `home-recipes`；共享模块的依赖入口需同步核对。新增关闭 clientDB 四种 CRUD 权限的 `import_jobs`、`quota_buckets`、`ai_usage`，以及 `import_jobs.state_next_id`、`purge_id` 索引。唯一语义依赖数据库内建 `_id` 唯一约束。

Worker 平台超时 120 秒、返回后继续执行关闭，定时配置 `0 * * * * * *`。必须上传后回读并在控制台确认每分钟触发 _timing，不能把私有方法的本地调用算作真实定时证据。单轮最多处理两个任务；剩余执行预算不足 55 秒时不启动下一项，给 45 秒请求、5 秒审核及事务保存留出时间。租约 90 秒，过期 worker 不能保存。

仅在云端安全环境配置下列值，验收只记录存在性，不输出值、Authorization、用户原文或原始响应：

- `OPENROUTER_API_KEY`：供应商凭据。不得写入仓库、客户端、VITE_* 或日志。
- `IMPORTS_ENABLED=true`：允许新任务及新调用；缺省 false。关闭后已开始的合法结果可以保存，清理仍执行。
- `IMPORTS_USER_TASKS`、`IMPORTS_FAMILY_TASKS`：按 UTC 自然日的提交次数上限；本次测试设 `unlimited`，缺省同样无限制。失败或取消仍消耗提交次数，重放不重复计算。
- `IMPORTS_USER_USD`、`IMPORTS_FAMILY_USD`、`IMPORTS_GLOBAL_USD`：按 UTC 自然日的调用预算；本次测试设 `unlimited`。调用前原子预留，已知费用转换为实际支出；未知费用保留预留占用，不能视为零。
- `IMPORTS_RESERVE_USD`：每次调用保守预留 USD，缺省 1；有限预算必须覆盖该预留额。跨日的结算写回原调用日。

固定模型 `deepseek/deepseek-v4.1-flash-1017`，非流式、8192 输出 token、严格 JSON Schema、`require_parameters: true`，没有工具调用或数据库能力。2026-11-10 的无凭据公开目录查询能找到该模型与 `response_format`/`structured_outputs` 支持；这不是付费完成请求的验收。真实验收须核实模型可路由、Schema 生效、有效 token/费用/请求 ID 可记录且没有敏感日志。原始响应不落库，任务只保留验证后的中间菜谱；成功、失败或取消时清除原文和中间结果，其他原文由 worker 每轮最多 20 条清理，领取和保存也独立检查七天过期时间。

微信审核沿用可信服务端 openid、版本 2、scene 3、5 秒超时。认证的小程序提交和查询记录最近访问；任务访问记录超过两小时则在调用 AI 前失败。微信审核仍是最终判断，若访问资格无法确认会明确失败并提示重新导入。必须使用近期访问小程序的真实账号验收。

实际云验收须覆盖：关闭页面后定时开始、成功自动保存唯一菜谱、详情读取及编辑、同 requestId 重放、取消竞争、撤销成员、超时重试与用量、未知费用占用、停用与清理。最后回读云入口、公共模块、Schema、索引、触发器和配置存在性，绑定实际云编译产物摘要；本地 tsc 不替代 HBuilderX 上传编译。

真机验收须覆盖：粘贴、弱网原请求重放、关闭重进、隐藏停止轮询、取消费用提示、终态停止、打开和编辑已保存菜谱、退出重入、账号切换及旧成员代次隔离。只保留最近任务，不增加历史、图片或网址导入。
