# 设计事实来源与决策记录

基线：v1，2026-11-10。[完整规范](README.md)。来源分为用户批准、业务规则、产品参考、官方技术资料和本地设计方法；它们的证据职责不同。

## 用户与项目事实

### S-USER：已认可方向

- 2026-11-10 用户指定“家庭菜谱小程序为主”。
- 随后要求“根据上述推荐内容，生成一版 html 网页……适配手机分辨率”。
- 预览交付后明确表示“认同该设计”，要求将设计沉淀进项目，并新增不被 blocked 的既有页面重构工单。
- 该记录批准视觉方向与本轮规范/工单工作；不声称用户批准了示例购物计算、假评分或新云业务。

### S-PREVIEW：项目视觉样本

- [HTML](../../../miniapp/design-preview/index.html)、[样例资产与来源](../../../miniapp/design-preview/README.md)、[交互自检](../../../miniapp/design-preview/verify.cjs)。
- 实际令牌：白色表面、`#216840` 品牌绿、`#202923` 主文字、`#667269` 辅助文字；菜图 `4:3`、普通控件约 8–10px 圆角、图片约 12px。
- 研究方式：上一轮无可调用 Refero MCP，使用技能附带 craft 资料和产品官网；不能写成已经检索过 Refero styles/screens/flows 数据库。
- 验证边界：jsdom 交互自检可重跑；自动浏览器审阅因 Windows URL 识别失败而未完成。人类认可视觉方向不替代生产 QA。

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
- 本地还有 #8 的未提交工作；不把它作为新工单可启动的必要条件，不随设计文档发布。

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

### S-UNI：uni-app 官方资料

- [pages.json / easycom](https://uniapp.dcloud.net.cn/collocation/pages.html#easycom)
- [路由 API](https://uniapp.dcloud.net.cn/api/router.html)
- [布局与样式](https://uniapp.dcloud.net.cn/tutorial/syntax-css.html)
- 使用角色：核对小程序可用组件、导航/TabBar、单位和平台限制；HTML 可运行不是小程序可运行的证据。

### S-A11Y：W3C WCAG 2.2 参考

- [普通文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [非文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [最小目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [重排](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)、[文字缩放](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- 项目采用可测试的对应要求，不声称微信小程序通过网页 WCAG 认证。44px 触摸要求是项目的更严格选择，AA 最小目标条款是 24px（另有例外）。

## 设计方法与适用 skills

- `refero-design`：研究、参考锁定、来源职责、决策记录和渲染 QA。
- 该 skill 的 `typography.md`、`color.md`、`craft-details.md`、`anti-ai-slop.md`：字体层次、色彩职责、交互细节与避免泛化；已采用的要求写入本基线，读取环境 skill 不是理解规范的前置条件。
- `uni-app`、`vue-best-practices`：实施时使用，保持平台兼容、Composition API 和 TypeScript。
- Context7：执行时核对实际使用版本的第三方 API；不能用一次文档查询替代构建和设备验证。

本环境中上述 skill 位于 `.agents/skills/`，该目录通过 `.git/info/exclude` 排除，不随本次发布。其他环境按其技能目录加载；不可用时使用本文记录的工作方法及链接的官方资料，不凭空声称已调用 skill。Skill 提供工作方法；事实与功能权限仍来自用户需求、实际代码、官方资料及验证证据。

## 决策记录

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

新的重大决定追加 D-ID；记录来源和影响。现有决定变更时保留原因和用户确认状态，不静默覆盖。
