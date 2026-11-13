# Task10 本地验证证据

> **2026-11-13 当前状态：用户已确认全部检验完成并授权验收、关闭、提交及推送。最终结果见 [Task10 收尾验收](task10-closeout.md)。下文早期 needs-info、登录归因与待部署描述保留为历史过程，不代表当前状态。**

日期：2026-11-12。实施基线 HEAD `eb244e863bedc5655119af09f9b4daae236dacf8`（miniapp-dev）；按 Issue #10 要求**改动未自动 git 提交**。本机 Node v26.10.0（fnm），`pnpm`/`task` 不在 PATH，改用 `node` 直接调用 `node_modules` 内既有 vitest/eslint/tsc/vue-tsc/uni 二进制与 `scripts/*.mjs`，未增加仓库依赖。Vite/Sass 输出既有 legacy-js-api 弃用提示，不影响检查结果。

## 执行的检查（等价 `task -d miniapp check`）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| uni-id 装配 | `node scripts/assemble-uni-id.mjs --check` | Identity assembly verified，exit 0 |
| 内容装配 | `node scripts/assemble-content-check.mjs --check` | Content assembly verified，exit 0 |
| ESLint | `node node_modules/eslint/bin/eslint.js . --max-warnings 0` | exit 0（零警告） |
| 客户端类型 | `vue-tsc --noEmit -p tsconfig.json` | exit 0 |
| 云端类型 | `tsc --noEmit -p tsconfig.cloud.json` | exit 0 |
| 测试类型 | `vue-tsc --noEmit -p tsconfig.tests.json` | exit 0 |
| 全量测试（默认超时） | `node node_modules/vitest/vitest.mjs run` | 851 通过 + 3 项环境超时（854 项，新增 leave-guard 测试前） |
| 全量测试（延长超时） | `node node_modules/vitest/vitest.mjs run --testTimeout=120000` | 61 套件 / 855 项全通过，exit 0 |
| 微信构建 | `uni build -p mp-weixin` | DONE Build complete，exit 0 |
| 边界产物 | `node scripts/check-boundaries.mjs --artifacts` | Boundaries verified，exit 0 |
| 密钥扫描 | `node scripts/check-secrets.mjs` | Source and artifact secret scan verified，exit 0 |

最终延长超时全量复跑：**61 套件 / 855 项全部通过，exit 0**。3 项默认超时为环境慢、非回归（3 文件单独 `--testTimeout=120000` 复跑 47 项亦全通过）。构建、边界、密钥、三组类型、ESLint、装配检查均 exit 0。

## 三项环境超时（默认 5000ms，非本票改动导致）

以下既有重型门禁测试在本机默认 5s 超时下超时，`--testTimeout=120000` 复跑全部通过；属环境慢，非 task10 回归：

1. `tests/contracts/boundaries.test.ts > artifact_routes_are_exactly_the_implemented_account_family_recipe_and_import_pages`（扫描构建产物路由；复跑 2773ms 通过——证明 pages.json 标题与 submit.vue 改动未破坏产物路由清单）
2. `tests/contracts/task02-ops.test.ts > task02 dry preview does not change files, associate, upload or initialize`
3. `tests/contracts/vendor-assembly.test.ts > repeated_generation_is_byte_identical`

## 本票新增/扩展验证

- 新 `tests/contracts/ai-url.test.ts`（97 项）+ `tests/fixtures/ai-url.json`：SSRF 形状门（localhost/特殊后缀/私网 IP 字面量/0x/十进制/八进制变体/userinfo/非默认端口/超长）、`isPublicAddress` IPv4/IPv6/映射解包、DNS 全公网/重绑定/ENOTFOUND 分类、reader 头精确匹配/Bearer/CRLF/空白正文/HTTP 分类/畸形响应、url 提交 provenance、不可读×2、重定向到私网、私网 DNS 先于 reader、能力开关、幂等重放/CONFLICT、429 退避、reader checkpoint 后 provider 重试只读一次、截断 warning、最终 URL warning、cancel 清理、过期清理。
- `tests/app/imports.test.ts` 新增 4 项页面流程：url 方法提交→status、非法 url 字段错误且不提交、冷启动 url pending 重放原请求、不可读失败降级粘贴正文。先观察 3 项 RED（`data-method-url` 不存在），实现 submit.vue 后 GREEN；第 4 项为 #6 降级文案的回归守卫。
- `tests/app/form-interactions.test.ts` 新增 1 项 url 离开守卫回归：切到网址方法、输入未提交 url 后点返回触发确认弹层且取消不导航，确认后导航回菜谱列表（守卫泛化后的 `url !== urlBaseline` dirty 分支）。
- `tests/app/imports-api.test.ts`：url 形状本地校验后才进传输（11 非法 + trim 接受）、SOURCE_UNREADABLE wire 解析。
- `tests/contracts/boundaries.test.ts`：客户端 JINA_API_KEY/IMPORTS_URL_ENABLED 泄露拒绝、产物泄露拒绝、worker 仍只 `_timing`、jina key 源码拒绝不回显值。
- `tests/contracts/imports-cloud.test.ts`：vm fixture url 提交（无原文泄露、私网字面量 INVALID_INPUT）。
- `tests/domain/imports.test.ts`：`test.each(['image','url'])`→`['image']`（url 不再被拒）。
- 全套从 task08 的 676 项增至 855 项；既有 text 路径回归不变。

测试先红后绿（TDD）；客户端 url 校验独立实现（无 `URL` 全局、不 import 云端 urls.ts），云端权威。没有新增第三方依赖；共享菜谱创建入口继续使用原校验、审核和家庭事务边界。

## 诚实边界（未验收，不声称已通过）

以上均为**本地自动化与 fixture 证据**。未验证：真实 Jina Reader 读取（本地出口探测 `https://r.jina.ai/https://example.com` 出现 `ECONNREFUSED`，环境出口受限；按用户 URL 约束未替换任何代理地址，契约改从官方 jina-ai/reader 仓库核实）、付费 OpenRouter 解析、真实云分钟定时触发、HBuilderX 官方云上传编译、实际费用、真机微信渲染/读屏/状态矩阵。相应 provider/cloud/device 阶段保留 `needs-info`，Issue #10 保留 `needs-info` 直至部署者确认 Jina 可达、配置 `IMPORTS_URL_ENABLED`（imports-co 与 import-worker 两处）与可选 `JINA_API_KEY`、确认预算并完成真实读取验收（1 可读 + 1 不可读 URL）。

task10 **未进入** deploy-preview/doctor 允许清单（无测试强制，ponytail 不加；本轮不部署、不发布）。`task10-acceptance.json` 为独立 needs-info 记录，未接入 doctor 就绪检查，故不含已计算的 source/build 摘要哈希（不伪造）。真实读取验收程序见 `ops/task10-deployment.md`；能力核实见 `docs/design/miniapp/sources.md` S-URL-IMPORT / D-13。