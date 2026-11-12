# 小程序 UI 与组件开发约定

适用于本目录的页面、组件、主题、交互、UI 重构、评审与排错。继承[根开发约定](../AGENTS.md)；本客户端使用 uni-app + Vue 3 + TypeScript + Wot UI，旧网页端的 Nuxt/Vuetify 约定不替代这里的集成方式。

## 开始前

- 先读[设计基线](../docs/design/miniapp/README.md)、[来源与决策](../docs/design/miniapp/sources.md)、[工单约定](../docs/design/miniapp/issue-design.md)，定位本次相关的 D-ID/S-ID、业务规则与实际代码。
- Vue 实施使用 `vue-best-practices`、`uni-app`；涉及组件选型、`wd-*`、hooks、主题或 Wot 排错时必须加载 `wot-ui-v2`（本环境为 `.agents/skills/wot-ui-v2/SKILL.md`，路径相对仓库根目录）。设计变更使用 `refero-design` 做研究与参考锁定。
- Skills 是工作方法，不是组件 API、业务授权或运行成功的证据。当前 `.agents/` 被本地 Git exclude 排除；其他环境缺少 skill 时执行本文流程并查官方资料，明确记录不可用项。

## 事实来源及冲突处理

1. **需求与视觉**：已批准业务、设计基线及其 D-ID/S-ID 决定行为和视觉；组件库 demo 不增加业务需求。
2. **当前集成**：[package.json](package.json)、[pnpm-lock.yaml](pnpm-lock.yaml)、实际安装包、[pages.json](src/pages.json)、[wot.d.ts](src/wot.d.ts)、[App.vue](src/App.vue) 及调用方代码决定本项目现状。先查调用方、相关测试和配置，再修改。
3. **本地文档**：[llms.txt](llms.txt) 是组件和指南索引；[llms-full.txt](llms-full.txt) 是完整文档快照，含示例及实现说明。文件名是 `llms`，不要另建 `llm.txt` / `llm-full.txt`。先检索索引，再按组件标题或 `url:` 定位完整文档的相关段落，不每次加载全文。
4. **CLI/MCP 知识**：`@wot-ui/cli` 提供随包安装的离线 API、demo 和 token；可用的 Wot MCP tools 是同类查询入口。安装 CLI 不代表 MCP 已接入，也不代表知识库与运行包完全一致。
5. **官方核对**：使用 [Open Wot](https://wot-ui.cn/guide/open-wot.html)、[AI 指南](https://wot-ui.cn/guide/ai.html)、[LLMs 指南](https://wot-ui.cn/guide/llms-txt.html)，组件链接见本地索引；Context7 使用 `/wot-ui/wot-ui`，避免混用旧 `wot-design-uni` v1 示例。平台行为查 uni-app/微信官方资料。

2026-11-10 核对时，项目声明、锁文件及本地安装的 `@wot-ui/ui` 均为 **2.4.0**，CLI 为 **1.2.1**；后续以执行时核对为准，CLI 版本与 UI 包版本不是同一个概念。本地文档没有独立的版本/下载时间声明，不能仅凭文件存在认定与安装包完全匹配。

资料冲突时，先核对实际安装版本与该版本的组件源码/类型，再查对应版本官方文档、changelog。记录差异并使用当前包已支持的 API；不按记忆补 props，不为匹配最新文档自动升级依赖或改第三方源码。无法确认的能力写明待验证，不能声称已支持。Skill 中属于 Open Wot 工具仓库的 `scripts/extract.ts`、`data/v2.json` 等路径不是本项目文件。

## 查询与实施流程

以下命令在 `miniapp/` 下执行，组件名按任务替换；结构化输出只提取所需字段，避免把完整知识库放入上下文。

```bash
node -p "require('./node_modules/@wot-ui/ui/package.json').version"
wot -V
wot list Button --format json
wot info Button --format json
wot demo Button
wot doc Button
wot token Button --format json
```

- `wot -V` 查 CLI 版本；查询命令的 `--version` 选择 UI 知识版本。必要时显式指定核对过的版本，例如 `wot info Button --version 2.4.0 --format json`。CLI 的 fallback 结果不证明检测到了本项目版本。
- `wot demo Button` 先列出可用 demo 名称，再用 `wot demo Button <name>` 查询代码。当前 CLI 的名称如 `demo-1`；不要假设官网示例中的 `basic` 一定存在。需要追查差异时运行 `wot changelog`，参数以已安装 CLI 的 `--help` 为准。
- CLI 不可用时用本地文档、已安装包源码/类型与官方文档继续核对；网络或 Context7 不可用时记录限制。切换 Node 环境后全局 `wot` 可能不在 PATH，先检查命令路径与 Node 版本，不将其误判为项目未安装 Wot UI。
- 若已有 Wot MCP tools，可用 `wot_list` / `wot_info` / `wot_demo` / `wot_doc` / `wot_token` 完成等价查询；无需为本流程额外修改用户级客户端配置。
- 先查库已有能力，再复用项目业务组件；通用控件优先用 Wot，不另造通用组件库。原生登录、授权、导航、TabBar 等平台能力及 uni-id 所需模块按基线保留。例外记录具体平台或 API 限制。
- 使用 `<script setup lang="ts">`。本项目采用 npm 包，hooks/类型从 `@wot-ui/ui` 导入，不照搬 `@/uni_modules/wot-ui`。沿用 `pages.json` 的 easycom；新增 `wd-*` 时检查 `src/wot.d.ts` 是否需要补官方组件类型及相关测试，避免无依据替换为全量全局类型注册。
- props、事件、插槽、`v-model` 参数、实例方法和 CSS token 必须逐项从查询结果及当前类型核实，不能根据其他组件推断。例如反馈 hooks 要核对页面内对应实例/selector；弹层内依赖尺寸的组件要核对初始化时机。
- 主题先复用 `src/styles/theme.css`，按官方语义/组件 CSS 变量及 `ConfigProvider` 能力映射设计令牌；查 `wot token`/文档确认名称，核对页面、弹层的实际作用域，不默认生成另一套 SCSS 主题或深度覆盖内部类。

## 验证与交付证据

在 issue、实施计划或 PR 记录本次实际使用的最小证据集，不要求为每行代码加引用：

- 相关 D-ID/S-ID、业务规则、实际基准提交、页面与调用方。
- UI 包版本、CLI 版本（若使用）、组件名和用到的 props/events/slots/hooks/tokens；对应官方链接或本地文档路径及标题，以及实际查询命令/关键结果。新能力或冲突同时给出当前包的源码/类型位置。
- 执行的验证、结果、适用平台和未验证项；不要把“文档说支持”写成“微信已验收”。

组件变更可在 `miniapp/` 下补充以下只读诊断；它们不替代项目检查：

```bash
wot doctor . --format json
wot usage src --format json
wot lint src --format json
```

`doctor` 检查基础依赖/集成，`usage` 统计组件使用，`lint` 只覆盖工具已有规则；空结果或退出码 0 不证明完整 API、可访问性、云业务或微信渲染正确。

生产改动从仓库根目录运行 `task -d miniapp check`，以 [Taskfile.yml](Taskfile.yml) 为准；任务运行器不可用时执行其中对应原命令并记录。仅文档变更检查链接、格式与命令准确性即可。涉及行为的变更补必要回归，UI 按基线提交状态矩阵、320/375/390/430px、大字号、安全区、键盘与可访问性的实际渲染证据。未执行的设备/云验收明确保留，不以 mock、jsdom 或 CLI 诊断替代。

## 文档快照维护

更新 `llms.txt` / `llms-full.txt` 时从 [官方索引](https://wot-ui.cn/llms.txt) 与[官方全文](https://wot-ui.cn/llms-full.txt) 获取，保留原文结构；在 [S-WOT-AI](../docs/design/miniapp/sources.md#s-wot-ai组件知识与-agent-工具) 记录来源、核对日期、可确认的版本与差异。先审阅差异，不在每次任务中自动下载覆盖，不把上游 demo 当作本项目验收记录。本文流程由根 AGENTS、设计规范、Cursor 规则和 UI 工单模板共同引用；调整要求时同步这些入口。
