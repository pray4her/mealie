# Task10 网址导入验收与收尾

日期：2026-11-13（北京时间）。工单：[Issue #10](https://github.com/pray4her/mealie/issues/10)。实施基线：`eb244e863bedc5655119af09f9b4daae236dacf8`，分支 `miniapp-dev`。

## 验收决定与证据来源

用户明确确认：“已完成全部检验，关闭工单，验收，生成git提交信息，提交并推送。”据此接受本票并授权 Git 提交、推送和关闭工单。以下区分代理直接观察与用户确认；不把后者写成代理独立执行的测试。

设计遵循 D-06 / D-10 / D-12 / D-13、S-URL-IMPORT / S-WOT-AI：保留家庭鉴权、原请求恢复、并发与私有素材边界；沿用 HomeAction、scope-tab 和原生输入兼容方式。实际核对 `@wot-ui/ui` 2.4.0、Wot CLI 1.2.1，执行 `wot info Button --version 2.4.0 --format json`，检索本地 llms 的 Button/Form 索引。没有新增组件库或依赖。

## 本轮修复

- 白屏根因是未提交的 `main.ts` 手动初始化使用了不完整的支付宝云配置，运行时报 `spaceAppId required`，应用未挂载。移除该三行改动，`main.ts` 恢复基线；使用 HBuilderX 的既有空间关联注入配置。
- 将 18 个源码目录中的未跟踪编译 JS 及过期 `uni-id-co.param.js` 移到忽略目录 `dist/repair-backup`，保留备份。这些 JS 曾覆盖 TS 模块解析，导致错误类型识别和 lint 失败；不提交生成物或调试参数。
- Reader 显式发送 `X-Base: final`，使最终网址校验使用真实最终地址；发送 `X-Assert-Status-Code: 200` 并拒绝目标 HTTP 错误 warning，避免把错误页当菜谱正文。
- DNS/Reader 失败且尚未调用模型时按零 OpenRouter 费用结算，释放预留；进入模型调用前恢复未知费用语义，保留网络失败的保守计费边界。
- 接受 OpenRouter 合法的空 `tool_calls` 数组，继续拒绝非空或畸形工具调用及不合格菜谱。

Reader 参数依据：[官方参数定义](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts)、[最终地址选择](https://github.com/jina-ai/reader/blob/main/src/api/crawler.ts)、[目标状态 warning](https://github.com/jina-ai/reader/blob/main/src/services/snapshot-formatter.ts)。空工具列表依据：[OpenRouter OpenAPI](https://openrouter.ai/openapi.json)。新增行为先观察失败回归，再修复通过；既有云端权限与领域校验保留。

## 代理直接采集的真实流程

使用 HBuilderX 5.34、本项目真实生产客户端、微信开发者工具 2.02.2611092 / SDK 3.17.5。未使用 `ui-review` 客户端、模拟云响应或伪造身份。

1. `publish mp-weixin --project <miniapp> --appid wx68649810a6f363f3 --upload false` 成功，日志确认默认空间 `env-00jy7289et7b`。必须显式传 AppID，避免 HBuilderX 导出为 `touristappid`。编译输出仍为 `dist/build/mp-weixin`；未上传微信版本。
2. 经工具原生自动化接口打开正式构建，点击真实“微信登录”，成功读取现有家庭与菜谱。此前“微信后端拒绝账号”的归因不成立。
3. 从“添加菜谱 → AI 导入 → 网址导入”填写公开菜谱网址并提交，任务由真实分钟触发器处理。
4. 可读样本 `https://extension.umaine.edu/food-health/recipes/hard-boiled-eggs/` 的任务 `88666cbc03798cb2b17f5e1e79879c4a` 成功，attempts=1，保存菜谱 `5525f92495bf4f04d49782adcdddac49`。已观察完整成功页：[截图](task10-real-2026-11-13/10-short-status.png)。云端 `ai_usage` 回读费用 USD `0.00157224375`，请求 ID `gen-1794557763-KONR1gWB5X15W29dLFId`，settled=true；见[脱敏计费证据](task10-real-2026-11-13/readable-usage.json)。这证明托管读取、模型解析和保存真实发生，不是模型仅收到 URL。
5. 较长 BBC 样本返回 `INVALID_OUTPUT`、recipeId=null，终态 sourceText/sourceUrl/candidate 均回读为 null，没有保存虚构菜谱。本地直接 Reader 观察到正文约 27.8 KiB，前 16 KiB 不含 method；这说明输入截断限制，不能据此断言模型响应的具体失败字段。
6. 不可读样本 `https://example.com/task10-missing-recipe-20261113` 在旧 Reader 参数下返回 `UNRECOGNIZED`、recipeId=null；随后修复目标状态断言与错误 warning 检查。最终不可读复验及其余流程由用户确认完成，不将旧错误码当作新版本 `SOURCE_UNREADABLE` 的实测证据。

截图目录：[真实流程截图](task10-real-2026-11-13/)。均为开发者工具模拟器截图，保留原始内容；不是实体手机证据。用户按 Esc 停止过代理电脑操控，随后确认全部检验完成并授权本次收尾。

## 部署与本地门禁

- 已将 `home-imports` 修复上传到既有支付宝测试空间，官方 TypeScript 检查、8 文件编译和依赖云函数更新成功。
- 使用 HBuilderX `unicloud database upload --kind schema --protocol-version 1` 成功同步 `import_jobs`；下载回读已含 `sourceKind` / `sourceUrl` / `sourceWarnings` / `SOURCE_UNREADABLE`。旧 CLI 的“跳过上传”缺口已解决，未回填存量数据。
- 最终本地复跑：uni-id/内容装配、ESLint（零警告）、客户端/云端/测试三组类型检查均 exit 0；Vitest **61 套件 / 862 项全部通过**，`--maxWorkers=2 --testTimeout=120000`，耗时 70.04 秒。完整输出留在忽略目录 `dist/task10-closeout-tests.log`。
- 收尾生产构建再次成功，日志确认默认测试空间和正确 AppID；产物边界、源码/产物密钥扫描、`git diff --check` 均通过。构建 SHA256 记录在 `task10-acceptance.json` 的 `build.files`；日志保留在忽略目录 `dist/task10-closeout-build.log`。

## 保留的边界

- 其余设备、弱网恢复、状态矩阵和安全检验依据用户本次确认；代理未另造逐项截图或供应商日志。
- 提交地址、DNS 和返回最终地址受到应用校验；这不等于托管 Reader 逐跳阻断已获证明。上游有公开的[重定向安全报告](https://github.com/jina-ai/reader/issues/1252)，不能声称本票消除了供应商侧风险。
- Reader 费用不计入 OpenRouter USD 预算；原文最多 16 KiB，长页可能缺失关键信息；模型输出仍须通过领域校验与内容审核。
- 未发布微信版本、未实现 #9 图片导入、未将 task10 接入旧 doctor 的就绪清单，也未独立回读早期远程 egress 探针的清理状态。
