# 设计事实来源与决策记录

基线：v1，2026-11-10。[完整规范](README.md)。来源分为用户批准、业务规则、产品参考、官方技术资料和本地设计方法；它们的证据职责不同。

## 用户与项目事实

### S-USER：已认可方向

- 2026-11-10 用户指定“家庭菜谱小程序为主”。
- 随后要求“根据上述推荐内容，生成一版 html 网页……适配手机分辨率”。
- 预览交付后明确表示“认同该设计”，要求将设计沉淀进项目，并新增不被 blocked 的既有页面重构工单。
- 该记录批准视觉方向与本轮规范/工单工作；不声称用户批准了示例购物计算、假评分或新云业务。
- 同日用户加入 Wot `llms.txt` / `llms-full.txt`、`wot-ui-v2` skill 并安装 CLI，要求将官方实践写入开发约定，保证后续 UI/组件开发可定位事实依据；流程见 [miniapp/AGENTS.md](../../../miniapp/AGENTS.md)。

### S-PREVIEW：项目视觉样本

- [HTML](../../../miniapp/design-preview/index.html)、[样例资产与来源](../../../miniapp/design-preview/README.md)、[交互自检](../../../miniapp/design-preview/verify.cjs)。
- 实际令牌：白色表面、`#216840` 品牌绿、`#202923` 主文字、`#667269` 辅助文字；菜图 `4:3`、普通控件约 8–10px 圆角、图片约 12px。
- 研究方式：上一轮无可调用 Refero MCP，使用技能附带 craft 资料和产品官网；不能写成已经检索过 Refero styles/screens/flows 数据库。
- 验证边界：初次自动浏览器审阅因 Windows URL 识别失败而未完成；本次已通过本地 HTTP 完成部分浏览器审阅，具体页面、尺寸和限制见 S-REVIEW。人类认可视觉方向及 HTML 浏览器观察均不替代生产 QA。

### S-BUSINESS：已批准业务

- [2026-11-03 总体业务设计](../../superpowers/specs/2026-11-03-wechat-unicloud-design.md)：第 2/3 节范围，第 8 节家庭权限，第 9 节 AI，第 10 节计划与购物，第 11 节评论评分，第 12 节媒体，第 14 节验收。
- [原工单与发布记录](../../superpowers/plans/2026-11-03-wechat-unicloud-ticket-draft.md)：历史发布记录，工单状态以 GitHub 实时回读为准。
- 2026-11-10 GitHub 回读：#1–#7 为 closed；#8 为 open/needs-info；#9–#19 为 open。新 UI 重构不得以关闭 #8–#19 为前提。

### S-CODE：生产代码基线

已推送基线提交：`0dc31abfff4cfd53df90ad5a8161ed7498c0eaa2`，分支 `miniapp-dev`。固定事实参考：

- [页面路由](https://github.com/pray4her/mealie/blob/0dc31abfff4cfd53df90ad5a8161ed7498c0eaa2/miniapp/src/pages.json)：登录、家庭引导/首页/邀请/加入/成员、菜谱列表/详情/编辑。
- [当前主题](https://github.com/pray4her/mealie/blob/0dc31abfff4cfd53df90ad5a8161ed7498c0eaa2/miniapp/src/App.vue)：深绿色按钮，原偏米色背景；UI 重构允许调整视觉，须保留业务。
- [菜谱契约](https://github.com/pray4her/mealie/blob/0dc31abfff4cfd53df90ad5a8161ed7498c0eaa2/miniapp/uniCloud-alipay/cloudfunctions/common/home-contracts/recipes.ts)：标题、标签、未知数量/份数/时间、版本、私有图片 ID 和收藏。
- [依赖](https://github.com/pray4her/mealie/blob/0dc31abfff4cfd53df90ad5a8161ed7498c0eaa2/miniapp/package.json)：uni-app + Vue 3 + TypeScript；Wot 尚未接入。
- 原工单发布时本地还有 #8 的未提交工作；这是当时的范围说明，不代表当前 #8 仍未提交。此次审阅的实际 HEAD 和工作区边界见 S-REVIEW。

这些链接证明记录时已有的接口和页面，不承诺以后不变；执行者必须核对自己的实际基准提交。

## 产品参考

以下为产品官方展示资料，研究/记录日期 2026-11-10。它们只提供视觉或任务模式，不提供本项目的功能授权。

### S-KITCHEN：Kitchen Stories — 主视觉参考

- https://pages.kitchenstories.com/de/app
- 观察对象：官方 App 展示的菜谱查找、烹饪图片和步骤表达。
- 采用：照片为主体、清楚的标题与正文区分、按步骤阅读。
- 不采用：官网黄色装饰背景、营销外壳、订阅和公开内容分发。

### S-ANYLIST：AnyList — 清单局部参考

- https://www.anylist.com/
- https://www.anylist.com/recipes
- 观察对象：购物清单、食材与菜谱/配餐关系的官方功能展示。
- 采用：名称与数量的行布局、清楚的勾选状态。
- 不采用：其他平台的导航细节、其账户/订阅业务。

### S-SAMSUNG：Samsung Food — 任务衔接参考

- https://samsungfood.com/recipe-box-app/
- 观察对象：保存菜谱、用餐计划和购物清单的官方说明。
- 采用：从菜谱进入计划，再显式加入清单的任务关系。
- 不采用：公开社区、营养服务、推荐算法、自动配餐。

## 官方技术与可访问性资料

### S-WOT：Wot UI

- [官方快速开始](https://wot-ui.cn/guide/quick-use)、[主题](https://wot-ui.cn/guide/custom-theme)、[v2 迁移](https://wot-ui.cn/guide/migration-v2)。
- 官方仓库本轮核对提交：`9bde898bcf227b3aac3fee2001e7c6c27f3861c2`。
- [固定版本迁移资料](https://github.com/wot-ui/wot-ui/blob/9bde898bcf227b3aac3fee2001e7c6c27f3861c2/docs/guide/migration-v2.md)、[固定快速开始](https://github.com/wot-ui/wot-ui/blob/9bde898bcf227b3aac3fee2001e7c6c27f3861c2/docs/guide/quick-use.md)。本轮也通过 Context7 的 `/wot-ui/wot-ui` 核对。
- 可据此说明：v2 包名 `@wot-ui/ui`、easycom 路径、Sass 与主题配置；不能据此宣称已在本项目成功构建。
- 文档中 Sass 推荐版本与实际 uni-app 兼容性需实施时验证；不为追随文档直接升级整套框架。

### S-WOT-AI：组件知识与 Agent 工具

- 官方职责说明：[AI 指南](https://wot-ui.cn/guide/ai.html)、[LLMs.txt](https://wot-ui.cn/guide/llms-txt.html)、[Open Wot / CLI](https://wot-ui.cn/guide/open-wot.html)、[Skills](https://wot-ui.cn/guide/skills.html)；2026-11-10 通过官网与 Context7 `/wot-ui/wot-ui` 核对。
- 本地快照：[llms.txt](../../../miniapp/llms.txt) 为索引，[llms-full.txt](../../../miniapp/llms-full.txt) 为全文；官方来源分别为[官方索引](https://wot-ui.cn/llms.txt)和[官方全文](https://wot-ui.cn/llms-full.txt)。用户提供的文件已核对索引和内容结构，未附独立的下载时间/精确版本声明，不声称与某个发布包逐字匹配。更新时在此补核对日期、可确认版本与差异，不自动覆盖。
- 当前集成另于 2026-11-10 核对：工作区 HEAD 为 `4f4b56702d884d660ea49b92d88b1cc7e554e49f`；`miniapp/package.json`、锁文件与本地安装包均为 `@wot-ui/ui@2.4.0`，使用 npm 包、`src/pages.json` easycom 和 `src/wot.d.ts` 的按需官方类型声明。该记录补充当前事实，不覆盖上文 S-CODE 的历史基线，也不表示工作区未提交 UI 已验收。
- 本机 CLI `wot -V` 为 `1.2.1`；已实际查询 Button 的 list/info/demo/doc/token，`--version 2.4.0` 可用；demo 列表使用 `demo-1` 等名称，不能直接假设官网示例 `basic` 可用。CLI 离线知识与安装 UI 包的版本分别核对。
- 对当前 `miniapp/` 实际运行 `wot doctor . --format json`（6 项基础检查 pass）、`wot usage src --format json`（扫描 40 个 Vue 文件，识别 5 类 Wot 组件）、`wot lint src --format json`（issues 为空）。这些是本次静态诊断记录，不是完整 API、构建、可访问性、真机或云业务验收；后续结果需重跑。
- `wot-ui-v2` skill、CLI 和可选 MCP 各提供方法/知识入口；CLI 安装不证明 MCP 已配置。详细查询顺序、冲突处理、来源记录和验收边界统一维护于 [miniapp/AGENTS.md](../../../miniapp/AGENTS.md)，工单引用 D-02 / D-09 / D-10 与本 S-ID。

### S-UNI：uni-app 官方资料

- [pages.json / easycom](https://uniapp.dcloud.net.cn/collocation/pages.html#easycom)
- [路由 API](https://uniapp.dcloud.net.cn/api/router.html)
- [布局与样式](https://uniapp.dcloud.net.cn/tutorial/syntax-css.html)
- 使用角色：核对小程序可用组件、导航/TabBar、单位和平台限制；HTML 可运行不是小程序可运行的证据。

### S-WECHAT：微信设计与无障碍

- [微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/)：本轮采用页面任务重点、连续导航、局部加载、可恢复异常、字段报错与一致控件的原则；不为追随示例新增搜索历史等业务。
- [适老化设计指南](https://developers.weixin.qq.com/miniprogram/design/elderly.html)：按微信字体设置适配文字与控件，区分平台的标准字号/缩放信息；不能只改布局而保持全部自绘字号固定。优先查询 `getAppBaseInfo` 对应能力，具体 uni-app 封装和兼容性实施时核对。
- [无障碍设计指南](https://developers.weixin.qq.com/miniprogram/design/accessibility.html)、[ARIA 属性](https://developers.weixin.qq.com/miniprogram/dev/component/aria-component.html)：原生界面已有部分支持，自绘内容核对平台支持的 `aria-role`、名称和状态属性，部分角色在移动端可能无效；Android/iOS 分别实测。
- 核对日期 2026-11-10。网页检索工具未能读取微信页面，改以 PowerShell `Invoke-WebRequest` 读取上述官方原文，HTTP 均为 200；没有用第三方转载代替官方规则，也没有由“支持 ARIA”推断当前组件已经可读屏。

### S-A11Y：W3C WCAG 2.2 参考

- [普通文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [非文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [最小目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [重排](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)、[文字缩放](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- 项目采用可测试的对应要求，不声称微信小程序通过网页 WCAG 认证。44px 触摸要求是项目的更严格选择，AA 最小目标条款是 24px（另有例外）。

## S-REVIEW：2026-11-10 逐页技术审阅

- 授权与范围：用户要求审阅并确定本目录作为后续前端设计事实来源；本轮补技术、组件、交互与可访问性规范，保留已认可 v1 方向。没有将新重大视觉方向或新云业务写成已获批准。
- 后续用户明确要求修复 R-03～R-07，实施代码、原生 ARIA 兼容例外、版本/API、微信产物与浏览器矩阵见[实施证据](../../../miniapp/ops/ui-accessibility-2026-11-10/README.md)。该更新不改写下列“仅审阅文档”的历史边界，也不代表真机验收通过。
- 当前代码：HEAD `4f4b56702d884d660ea49b92d88b1cc7e554e49f`，工作区有预存未提交的规范、#20 页面/主题/测试及 Wot 约定文件；报告审阅的是当时工作区，不能全部归因于 HEAD。此次仅修改本目录文档，没有修复生产页面、覆盖预存业务改动或改写 #20 历史验收。
- 安装核对：声明/锁文件/安装包 `@wot-ui/ui@2.4.0`、Vue `3.4.21`、Sass `1.98.0`；CLI `1.2.1`。当前 Node 22 shell 的 PATH 没有 `wot`，使用本机 Node 26 安装目录内已有的 `wot.cmd` 查询，未重新安装工具。
- 本地文档：先查 `miniapp/llms.txt`，再查全文 Form、Cell、Button、Input、Popup、Search、Upload、Root Portal、主题/样式及设计价值观等章节。文档快照精确发行版本未知；此次未覆盖快照。`llms.txt` SHA-256：`DA833DA700D667B7BC7E61BB9D596EC598C2639924EBB0AA0AC115C0A5BB2E66`；全文：`4F7D3CDAF997E8DB8CFCDDFAAD52FDD42DB616066CC1E990F3CAA93B21229506`。
- Context7：实际查询 `/wot-ui/wot-ui` 的主题、Form v2 校验和 Popup/反馈实例三个主题，交叉核对[主题](https://wot-ui.cn/guide/custom-theme.html)、[Form](https://wot-ui.cn/component/form.html)、[v2 迁移](https://wot-ui.cn/guide/migration-v2.html)、[Popup](https://wot-ui.cn/component/popup.html)、[useDialog](https://wot-ui.cn/component/use-dialog.html)。查询指向上游 main，关键 API 另核对当前安装包，不能称为版本锁定的运行验证。
- CLI：实际执行 `wot list Form/Tab --format json`；对 Button、Form、Input、Textarea、Popup、Search、Cell、Checkbox、Rate、InputNumber、Upload、Dialog、Toast、ConfigProvider、Tab、SelectPicker 执行 `info --version 2.4.0 --format json`；另执行 `demo Popup`、`doc Popup --version 2.4.0`、`token Button --version 2.4.0 --format json`。命令中的组件逐一替换执行，不把 `Form/Tab` 作为单个参数。
- 关键核对：Button `type` / `variant`，Form `schema` / `validate` / `error-type` / FormItem `prop`，Popup `v-model` / `close-on-click-modal` / `safe-area-inset-bottom` / `root-portal`，SelectPicker `v-model:visible`，反馈 hooks 的页面实例/selector，数字输入空值与上传服务边界。
- 实际安装包核对位置：`@wot-ui/ui/components/wd-button/types.ts`、`wd-form/types.ts`、`wd-form-item/types.ts`、`wd-cell/types.ts`、`wd-input/wd-input.vue`、`wd-search/wd-search.vue`、`wd-popup/types.ts`、`wd-root-portal/wd-root-portal.vue`。发现全文 Cell 示例残留 `<wd-button plain>`，而安装包 Button 使用 `variant="plain"`；CLI Cell 的 props 摘要遗漏了安装包中存在的 `isLink` 等字段。CLI 中 Tabs 的查询名是 `Tab`。因此知识摘要不替代类型/源码。
- 浏览器：以本地 Vite 静态服务查看认可预览，观察菜谱首页、详情、计划、购物、家庭、添加菜单与 AI 输入弹层；首页实际 viewport 为 320/375/390/430 × 844，未见整页横向溢出。390px 下标签命中高度 34px、排序 32px；320px 下菜名 14px 且仍双列，均须按生产规范适配。未进行所有页面×全部屏宽、大字号、软键盘或微信运行验证。
- 方法：本次无可用 Refero MCP，复用既有参考锁及 Refero craft 的表单/焦点/命中区/图片和颜色职责规则，并实际查看预览；没有声称新增 Refero 数据库研究。Web Interface Guidelines 仅辅助 HTML 表单/焦点检查，不能替代微信语义；平台裁决以 S-WECHAT / S-UNI 为准。
- 结果入口：[逐页规范](page-specs.md)、[审阅结论及验证边界](review-2026-11-10.md)。本次通过的原型自检和 CLI 基础诊断不升级为真机、云业务或生产视觉通过。

## 设计方法与适用 skills

- `refero-design`：研究、参考锁定、来源职责、决策记录和渲染 QA。
- 该 skill 的 `typography.md`、`color.md`、`craft-details.md`、`anti-ai-slop.md`：字体层次、色彩职责、交互细节与避免泛化；已采用的要求写入本基线，读取环境 skill 不是理解规范的前置条件。
- `uni-app`、`vue-best-practices`：实施时使用，保持平台兼容、Composition API 和 TypeScript。
- `wot-ui-v2`：Wot 选型、API、主题及排错时使用；按 `miniapp/AGENTS.md` 查询离线知识并核对版本，不能用 skill 摘要替代组件事实。
- Context7：执行时核对实际使用版本的第三方 API；不能用一次文档查询替代构建和设备验证。

本环境中上述 skill 位于 `.agents/skills/`，该目录通过 `.git/info/exclude` 排除，不随本次发布。其他环境按其技能目录加载；不可用时使用本文记录的工作方法及链接的官方资料，不凭空声称已调用 skill。Skill 提供工作方法；事实与功能权限仍来自用户需求、实际代码、官方资料及验证证据。

## 决策记录

### S-V11：用户批准的视觉校正与微信运行证据

- 2026-11-11 实施用户批准的 v1.1 计划，目标仍为图1及已认可 HTML 的照片主导方向，当前11页/原生导航/双Tab，无未来业务。Figma 是可编辑对照文件，仓库文档仍为事实来源。
- [节点映射及本轮证据](../../../miniapp/ops/ui-visual-v11/README.md)记录实际实现基线 `4f4b56702d884d660ea49b92d88b1cc7e554e49f`、未提交候选、截图与未验项目。Figma Starter MCP 达到额度上限，窄屏大字的已发现修正尚未完成，不能视为全稿验收。
- 实测 WeChat IDE 2.02.2611092 / SDK3.17.5：`fontSizeSetting=16`、`fontSizeScaleFactor=0.4`。旧算法得到 root 6.4px；修正为标准下限16px，保留有效大字放大。文档/浏览器截图不能替代这一运行证据。
- Wot 2.4.0 的 Button padding token用于四边，`0 16px`才是水平16px；实测曾把48px搜索行撑为76px。外层原生语义目标和内层 Wot `custom-class`会同时匹配，几何CSS须定位外层`.home-action`。
- 组件证据：`wot info Button/Popup --version 2.4.0 --format json`；本地 llms 的 Form/Popup/Button 章节；已装 `components/wd-form/types.ts`、`wd-form-item`、`wd-button/index.scss`；Context7 `/wot-ui/wot-ui` 的 FormSchema文档（validate 返回path/message，非Zod）。当前包类型优先于主分支文档，不修改依赖。
- 返回能力：[微信 enableAlertBeforeUnload](https://developers.weixin.qq.com/miniprogram/dev/api/ui/interaction/wx.enableAlertBeforeUnload.html)，应用内导航另行确认，不依赖不支持微信的`onBackPress`。用户明确选择不新增跨页草稿，接受侧滑/强退限制。
- 最终本地检查：60套749项，两个worker、原超时，组装/ESLint/三组类型/微信正式构建/边界和secret扫描通过；独立review构建通过。390真实微信开发工具11页标准、11页1.4字体夹具及18状态共40图逐图复核，不能替代其它屏宽或实体微信。[检查](../../../miniapp/ops/ui-visual-v11/validation.md)、[逐图差异](../../../miniapp/ops/ui-visual-v11/visual-review.md)与候选指纹记录其适用范围。
- 首页最初约18px流式偏差已通过压紧品牌行、保留44px命中区修正；真实微信标准网格top342.0，入口与问候区间隔2.8px。Figma窄屏大字及组件命中标注仍待补，未宣称全稿全几何2px内或最终冻结。共享原生字段的错误名称/状态/描述关联已留节点证据，真实朗读效果仍待iOS/Android验收。

| ID | 决策 | 来源 | 职责与原因 |
| --- | --- | --- | --- |
| D-01 | 照片主导、白色内容面、深绿操作 | S-USER / S-PREVIEW / S-KITCHEN / S-CODE | 保留认可方向；照片表达食欲，颜色提示动作 |
| D-02 | Wot UI 为通用业务控件主库，原生能力负责平台交互 | S-USER / S-WOT / S-UNI | 匹配现有 Vue3 uni-app；兼容性由实施构建证明 |
| D-03 | 系统中文字体、内容层次、窄屏/大字号重排 | S-PREVIEW / S-A11Y / typography | 阅读做法和实际操作优先于像素复刻 |
| D-04 | 计划、清单、评论和评分随业务工单交付 | S-BUSINESS / S-CODE | 静态预览不能冒充已有业务；不制造重构依赖 |
| D-05 | 自动保存后的 AI 成功页提供查看与编辑 | S-BUSINESS | 不改变已批准自动保存行为 |
| D-06 | 保留家庭鉴权、并发、私有图片与恢复语义 | S-BUSINESS / S-CODE | 视觉重构不能牺牲安全或数据完整性 |
| D-07 | 已有页面重构不等待 #8–#19 或新云资源 | S-USER / S-CODE | Wot 接入和 fixture 渲染可立即启动；关闭前仍验证 UI |
| D-08 | 不把原型的模拟、硬编码、购物去重写入生产 | S-PREVIEW / S-BUSINESS | 演示行为不满足真实份数、合并、权限和统计契约 |
| D-09 | 每个新 UI 工单列出来源、状态与真实依赖 | S-USER / refero-design | 后续实施能独立定位事实，不依赖聊天记忆 |
| D-10 | UI/组件实施前查证 API，交付记录版本与具体来源 | S-USER / S-WOT-AI / S-CODE | 文档、CLI、skill 各有职责；当前能力由安装包和实际验证确认 |
| D-11 | 令牌按背景配对、正文与控件随微信字号适配、验证真实内部节点语义 | S-A11Y / S-WECHAT / S-REVIEW | 修正候选色及原型/代码的可访问性缺口，不改变 v1 视觉方向 |
| D-12 | 明确逐页任务、表单字段错误、弹层关闭、原请求恢复和主次/危险操作 | S-BUSINESS / S-WOT / S-WECHAT / S-REVIEW | 把既有原则变成实施约束，保留平台能力和各业务票的交付边界 |

新的重大决定追加 D-ID；记录来源和影响。现有决定变更时保留原因和用户确认状态，不静默覆盖。
