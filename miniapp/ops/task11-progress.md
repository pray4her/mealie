# Issue #11 执行 ledger（膳食计划续做）

工单：[#11 按日期、餐次和份数安排膳食](https://github.com/pray4her/mealie/issues/11)（OPEN，`ready-for-agent`）。
计划：`docs/superpowers/plans/2026-11-15-miniapp-issue11.md`（源：Qoder plan `windy-swamp-otter.md`）。
分支：`feat/miniapp-planning-11`（与 `miniapp-dev` 同为 `1f9e659f5293488f27904c9edc3f6fa340e70f8b`）。
工作区：worktree `E:\pray4her\mealie\.qoder\worktrees\issue-11-planning`。

**本轮授权边界（用户明确选择）**：本地门禁 + 真实云验收。**不提交、不推送、不关单、不合并、不生产发布。**

## 起点审计（2026-11-15）

上一轮会话在 2026-11-14 19:33 中断，停在「探测 H5 原生 picker」，未留任何验收证据。#11 业务代码（约 3400 行）已全部写完但一行未提交：

- 云端：`planning-co`（add/list/get/update/remove）、`home-planning/{index,repository,validation}.ts`、`home-contracts/planning.ts`、`meal_plans.{schema,index}.json`、`mutation_receipts` 枚举扩展、`CollectionName` 加 `meal_plans`。
- 客户端：`features/planning/{api,dates,validation,use-planning,use-planning-page}.ts`、`pages/planning/{index,edit}.vue`、第三个原生 Tab「计划」、菜谱详情「安排一餐」入口、`copy.planningErrors`、`navigation.enterPage` switchTab。
- 测试：8 个新套件（domain/planning、domain/planning-dates、app/planning、app/planning-api、app/planning-controller、app/planning-review、contracts/planning-cloud、contracts/planning-reads）。

审计时实测：装配 ✅、ESLint ✅、客户端 tsc ✅、云端 tsc ✅、Vitest 71/1548 ✅、**测试 tsc ❌ exit 2**（3 处 TS2339）。
缺口：类型红灯、完整门禁未跑、视觉证据为零（`ops/task11-local/` 空、`review/task11-browser.cjs` 只有 probe）、真实云端验收未开始、取证工具缺件、文档未更新。

## Task 1：修类型红灯并跑完整本地门禁 — 完成

**改动（1 行）**：`miniapp/tests/app/planning-review.test.ts:8`

```ts
const scenario: { planning: Record<string, string> } = { planning: { date, ...planning } };
```

根因：`{ date, ...planning }` 展开 `Record<string, string>` 时 TS 推断为 `{ date: string }`，丢索引签名，导致第 28/29/34 行访问 `.read` / `.write` 报 TS2339。显式标注即修复；未改断言、未改 `review/app-client.ts`、未用 `any`/`ts-ignore`。

**验证（代理直接执行）**：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 修前红灯 | `pnpm exec vue-tsc --noEmit -p tsconfig.tests.json` | exit **2**，3 条 TS2339（28,30 / 29,23 / 34,30） |
| 修后绿灯 | 同上 | exit **0**，无输出 |
| 完整门禁 | `task -d miniapp check` | **CHECK_EXIT=0** |

门禁各步骤均通过：`assemble-uni-id --check`（Identity assembly verified）、`assemble-content-check --check`（Content assembly verified）、ESLint `--max-warnings 0`、客户端 `vue-tsc`、云端 `tsc`、测试 `vue-tsc`、Vitest、`build:weixin`（DONE Build complete）、`check-boundaries --artifacts`（Boundaries verified）、`check-secrets`（Source and artifact secret scan verified）。

Vitest：**71 套件 / 1548 项全通过**，Duration 33.54s。**未触发超时校准**，沿用默认配置，未改任何断言。
完整日志：`dist/task11-check.log`（gitignored）。

**产物人工复核**：`dist/build/mp-weixin/app.json` → `pages: 13`、`tabBar: ["菜谱","计划","家庭"]`；`project.config.json` → appid `wxdf2ca9836263776e`（正式号，与 `src/manifest.json`、`ops/project-target.json` 一致）。

## Task 2：补齐真机取证工具件 — 进行中

- `miniapp/review/node_modules` → 符号链接指向 `/e/pray4her/mealie/miniapp/review/node_modules`（与 `miniapp/node_modules` 同一做法）。实测 `miniprogram-automator` **0.13.0**、`ws` **6.2.7**。未执行 `npm install`，未动锁文件。
- `miniapp/review/extract-handlers.cjs:4` 页面清单追加 `planning/index`、`planning/edit`。
- 新建 `miniapp/review/task11-capture.cjs`（`node --check` → SYNTAX_OK）。

**编译产物实测事实（决定取证方式）**：

- 静态 `data-*` 编译为字面量 `bindclick="{{f}}"`，可静态提取。实际 id：
  - `planning/index`：`prev-week=eb`、`next-week=fd`、`today=54`、`resume=00`、`more=d1`、`read-retry=f0`、`check=b6`
  - `planning/edit`：`resume=0e`、`view-plan=1a`、`search=9f`、`search-more=f2`、`change-recipe=b8`、`save=0d`、`reload=d5`、`remove=2c`、`read-retry=02`、`back=00`、`check=ce`、`input#targetServings=b8`
  - `recipes/detail`：新增 `plan=c7`（「安排一餐」入口）
- `v-for` 内的 `data-choose`/`data-meal`/`data-day`/`data-add`/`data-edit` 编译为**逐实例数据** `bindclick="{{row.c}}"` / `{{meal.d}}` / `{{date.f}}`，静态正则取不到 → 脚本用 `callByValue(value)` 运行时反查（按 `data-*` 值在 page data 定位同对象的 handler id，并用页面真实方法名校验，歧义即抛错）。
- 小程序**无 DOM**：断言只用 `page.data()` / `page.$$()` / `element.outerWxml()` / `element.size()`，不用 `document.*`。
- fixture 的 `seed` 只在 `createProductionClient()` 时读一次，`reLaunch` 不重跑 `App.onLaunch` → 换 seed 必须 `mp.close()` + `automator.launch()` 真重启；`read`/`write`/`source` 每次调用动态读取，无需重启。
- `mockWxMethod` 是会话级的，每次重启后重新注入字号。

**未动**：未跟踪的 H5 probe `review/task11-browser.cjs` 原样保留，不删不改不跑（用户已选微信开发者工具路线）。

## Task 3：微信开发者工具渲染证据 — 进行中

### 取证方式实测修正（与计划不同之处，均为实测后修正）

计划里假定的几件事被实测推翻，已按事实调整脚本：

1. **automator 不支持属性选择器**。`p.$$('[data-plan-entry]')` 返回 0，尽管 `outerWxml()` 里确有 `data-protected="true"`。`view[data-protected]` 同样为 0。**改用 class 选择器**：`.page` / `.meal-panel`(4) / `.plan-entry` / `.search-row`(4) / `.date-target` / `.field-error` / `.home-input` 均可选中。
2. **后代选择器穿不进组件**。`.search-row button`、`.search-row .wd-button`、`.search-row .home-action`、甚至 `button` 全部返回 0（HomeAction 是 virtualHost）。所以**无法真实 tap 内部按钮**，点击仍走编译后事件 id（与 #9 同一边界）。
3. **页面 data 键名被压缩**（`a`/`b`/`c`/`m`/`t`…），`waitData('loaded')` 这类按键名等待永远超时。**改为按渲染内容等待**（`outerWxml()` 文本 + class 计数）。
4. **`automator.launch()` 在本机不可用**：它 `spawn(cli.bat)` 不带 shell，Windows 下失败；改走 `cmd.exe` 又会因安装路径含中文而失败。最终**复刻 `cli.bat` 自身的 bootstrap**（`ELECTRON_RUN_AS_NODE=1` + `-e BOOTSTRAP_JS` + `resources/app.asar.unpacked/js/common/cli/index.js`），直接 spawn `微信开发者工具.exe`，成功。
5. **开发者工具重启会清空 storage**（实测 `setStorageSync` → 重启 → `getStorageSync` 返回 `""`），且**启动需约 10s**（login → 默认 tab）。因此放弃「换 seed 就重启」的方案。
6. **`switchTab` 到当前已显示的 tab 页不会重新触发 `onShow`**，列表不会重载。**统一用 `reLaunch`**（实测 tab 页与非 tab 页都可用），并在开头 `settle()` 重试直到停在 `pages/recipes/index`。
7. **IDE 会改派端口**：请求 9421 时若被旧窗口占用，实际返回 `autoPort: 9422`。脚本解析 CLI 输出里的真实端口，不假定请求值。
8. **构建产物会被 IDE 锁住**：`rm -rf dist/ui-review` 报 `Device or resource busy`，导致 `&&` 短路、构建根本没跑，进而读到**陈旧产物**（表现为 seed 不生效、列表恒为空）。改为输出到全新目录 `dist/ui-review-v2/mp-weixin`，问题消失。**这是本轮最耗时的误判来源，记录以免重犯。**

### 为取证而做的唯一 fixture 改动

`miniapp/review/app-client.ts`：把 planning 播种从「`createProductionClient()` 时一次性」改为 **`ensureSeed()` 惰性播种**（首次 `planningAccess()` 时按当前 scenario 播种，seed 名变化则重置 plans/receipts/cursors/competingEdits）。
原因：开发者工具重启会清 storage，而 `reLaunch` 不重跑 `App.onLaunch`，一次性播种无法在启动后写入的场景下生效。
影响面：仅 review 夹具，不进生产产物（`check-boundaries` 会拒绝生产产物含 `HOME_UI_REVIEW_V11_ONLY`）。
回归：`planning-review` / `v11-review-regressions` / `visual-v11` / `issue20-ui` 四套件 **55 项全通过**，含「空/满两个客户端互相隔离」断言。

### v-for 事件 id 的运行时解析

编译产物实测：静态属性 → `bindclick="{{f}}"`（字面量，可静态提取）；`v-for` 内 → `bindclick="{{row.c}}"` / `{{meal.d}}` / `{{date.f}}`（逐实例数据）。
实例的 handler id 后缀恰等于其 `data-*` 值（如 `e4_2026-11-09`、搜索行 `e?_<recipeId>`），故 `callByValue(value)` 在 page data 中定位含该值的对象，取其中**确为页面方法 id 后缀**的兄弟字段，歧义即抛错。`chooseFirst()` 取首个「32 位 hex 且是活 handler id」的值。实测可用（`edit-form`、`index-pagination` 通过）。

### HBuilderX uniCloud CLI 参数实测（读插件 manifest，未启动 IDE）

`E:/HBuilderX/plugins/unicloud/package.json` 的 `contributes.clicommands`（58 条）确认：

- `unicloud common-module upload` / `cloud-function upload` / `common-module download`：参数为 `project, provider, space, **path**, force, protocol-version, request-id, json` —— **用 `--path`，没有 `--name`**（计划里写的 `--name` 是错的）。
- `unicloud database upload` / `download`：`project, provider, space, path, **kind**, force, protocol-version, request-id, json`。
- `unicloud database run-jql`：`project, **path**, **content-file**, schema-source, **run-id**, force, protocol-version, request-id, json` —— 用 `--content-file`，不是 `--file`。
- `unicloud cloud-resource list` / `database list`：`project, provider, space, kind, force, protocol-version, request-id, json`。

### 环境

- 开发者工具已登录（`cli islogin` → `{"login":true}`），AppID 自动识别为 `wxdf2ca9836263776e`。
- 模拟器机型 `iPhone 12/13 (Pro)`，`screenWidth 390`、`windowWidth 390`、`pixelRatio 3`、`safeArea top 47 / bottom 810`。
- `cache` 命令在本版本需 `--clean <storage|file|compile|auth|network|session|all>`（旧文档写法无参数会报 `Missing required argument: clean`）。本轮用 `--clean storage`。

## 2026-11-15 续：ui-review 渲染证据（390px 标准字号）与人工目视

### 自动化截图矩阵

- `ops/task11-local/capture-results-390-f1.json`：**18/18 pass**，产物 `dist/ui-review-v3/mp-weixin`，自动化端口 9422。
  每例记录实测 `viewport`（390×671）与 `rootFontSize`（`16px`）；18 张 `wechat-*-390-f1.png` 同目录。
- 边界（JSON `evidenceBoundary` 原文）：ui-review mock 客户端，无云、无真实身份；字号经 `mockWxMethod` 注入，**不是物理系统设置**；模拟器截图，**不是真机**；逻辑宽度来自 IDE 机型选择，逐例记录实测值。
- 本轮修复的两个取证工具缺陷（均先复现再修，未放宽断言）：
  1. 编译器把 `planning/edit` 的「更换菜谱」与份数输入复用同一事件 id `b8`（`e0_b8` / `e6_b8`），按 id 调用会误触更换菜谱并退回搜索阶段。改为 `element.trigger('input', {value})` 走元素自身绑定（`#targetServings` / `.home-input`，id 选择器实测可用）。
  2. `review/app-client.ts` 的 `ensureSeed()` 原先只按 seed 名去重，写场景残留行会泄漏到下一个同名 seed 场景。改为对整个 scenario 签名（`JSON.stringify`）去重；55 项回归复跑通过。
- 宽度/字号切换机制：IDE 退出后编辑 `WeappLocalData/localstorage_<hash>.json`（`hash_key_map_2.json` 映射到 v3 工程），先备份 `.task11-backup`；`cli quit` 后必须等 24220 端口关闭（`dist/task11-waitquit.cjs`，实测约 4s）再改，否则 IDE 退出 flush 会覆盖修改。375px 已验证生效。

### 人工目视（Read 截图，390px / 标准字号）

通过项：周历横向滚动（第 7 列裁切形成可滚动暗示）；餐次层级（早餐/午餐/… 加粗标题 + 右侧「添加」）；长标题在内容列内换行 4 行不溢出（`index-long`）；字段错误就地红字且输入保留 `0`、另有汇总「请检查标出的字段。」（`edit-field-error`）；冲突态保留输入 `4` 并提示「其他成员或家庭关系已发生变化…」（`edit-conflict`）；移除确认弹窗点名已保存餐次「2026-11-15 · 早餐 · 鲜虾溏心蛋汤面。移除后不可撤销，未保存的输入将丢失。」（`edit-remove-confirm`）；选中态非纯颜色（餐次下划线 + 加粗，周历 `已选/今天` 注记 + `aria-pressed`）；点击目标 CSS 实测 `.home-action--text { min-height: 44px }`、`.home-action { min-width: 44px; min-height: 48px }`（`src/styles` 全局）；底部内容止于 home indicator 之上，无安全区裁切。

观察项（非阻塞，未改代码，留待工单评审决定）：

1. **周历不自动滚到选中日**：`scroll-view scroll-x` 无 `scroll-into-view`/`scroll-left`（`src/pages/planning/index.vue:108`）。周日为最后一列，首屏落在周一~周六，选中列在屏外；选中日期仍由上方日期按钮「2026-11-15 · 选日期」表达，功能不受影响。
2. **校验错误后出现「重试读取」**：`src/pages/planning/edit.vue:525` 以 `message || committed` 显示该动作，纯份数校验错误也会带出它。语义略误导（它只重读、不重提交），无功能危害。

### 真实云验收脚本（Task 5 预备）

`review/task11-flow.cjs` 的 id 提取改为运行时来源：编译 WXML 中 `data-edit="{{row.h}}"` 是模板，不能 grep；uni-app 逐实例 handler id 后缀即 `data-*` 值，故新增 `entryIds()`（活方法 id 中过滤 32 位 hex）取安排 id；菜谱详情改为真实点击 `.recipe-open` 后读 `page.query.id`。三个文件 `node --check` 通过，残留 markup-id grep 为 0。

### 宽度矩阵（续跑）

- `capture-results-375-f1.json`：**18/18 pass**，实测 viewport 宽 375（高 639/722 随页面），根字号 16px。
- `capture-results-430-f1.json`：**18/18 pass**，实测宽 430（高 792），根字号 16px。
- `capture-results-320-f1.json`：**18/18 pass**，实测宽 320（高 455/504），根字号 16px（custom `Task11 320x568`，全局目录 index 29）。
- **字号控制的完整实测链（本轮纠错，取代此前「mock 注入」假设）**：
  1. `uni.getAppBaseInfo()` 在 **app service 启动时缓存** `wx.getAppBaseInfo()`（`uni.api.esm.js` 模块顶层），启动后 `mockWxMethod` 改不到该缓存；mock 也**不随重编译存活**。
  2. 本 devtools 版本的 `wx.getAppBaseInfo()` 在标准字号下**不含** font 字段；textSize 23 时返回 `fontSizeScaleFactor: 0.8`（反向倍率），被 `use-page-typography` 的 `Math.max(1, factor)` 钳回 1 → 根字号仍 16px。**IDE 真实字号与启动后 mock 两条路都走不通**（计划原假设被实测推翻）。
  3. 首轮 320「标准字号」曾实测根字号 19.2px（custom 机型自报倍率 1.2），该轮证据作废。
  4. 最终方案（仍属 **mock 模拟，非物理系统设置**，且只改 ui-review 产物、不碰生产产物）：`review/task11-capture.cjs` 在启动 IDE 前向 `dist/ui-review-v3/mp-weixin/app.js` 顶部注入 boot 前 shim（`/* HOME_UI_REVIEW_FONT_SHIM */` 标记，幂等），包装 `wx.getAppBaseInfo` 返回 `fontSizeScaleFactor=CAP_FONT`。实测 1.4 → 根字号 **22.4px**、`singleColumn` 生效。
  5. 结果 JSON 记录 `baseInfo.reported`（boot 自报）/`shimScale`/`ideTextSize`，并新增 `fontCheck` 门禁：f1 轮必须全 16px、大字轮必须出现 ≠16px，否则整轮判 fail（防止「标大字实标准」的无效证据）。
  6. 390/375/430 的 f1 轮为模拟器自然 16px（无 shim）；320 f1 与全部大字轮带 shim。两种路径实测根字号一致，台账按此区分。
- **后台节流坑**：devtools 窗口在后台时模拟器节流，automator 调用报 `timeout waiting for automator response`（本轮多次误判为脚本缺陷）。capture 现在启动后按安装路径匹配进程并 `AppActivate` 置前（`focusDevtools()`）；人工排查时 likewise 置前即恢复。
- 放大字号轮（`CAP_FONT=1.4`，子集 `index-populated,index-long,index-pagination,edit-form,edit-field-error,edit-search`）：
  - `capture-results-390-f1.4.json`：**6/6 pass**，`fontCheck.roots=["22.4px"]`，实测 390×671/754。
  - `capture-results-320-f1.4.json`：**6/6 pass**，`fontCheck.roots=["22.4px"]`，实测 320×455/504。
  - 目视：390 大字周历控件换行重排、条目动作独立成行；320 大字字段错误换两行、输入保留、按钮满宽、无横向裁切；`singleColumn` 生效。
- **automator 两个实测坑（ shim  era 排查结论）**：`mp.callWxMethod('getAppBaseInfo')` 在 shim 存在时**挂起**（改用 `mp.evaluate` 读字段）；shim 存在时以 `reLaunch` 作为连接后首个调用会挂起（`settle()` 先做 `currentPage()` 握手）。另：被 kill 的 capture 进程会留下 zombie node 客户端占用自动化会话，排查前先 `Get-CimInstance Win32_Process` 清理；**不要**在 capture 运行期间 spawn 任何会抢焦点的子进程。
- 收尾：IDE 已 quit；per-project 与全局 toolbar 均从 `.task11-backup` 恢复（机型回到 iPhone 12/13 (Pro) 390、字号 16、全局 28 机型无 custom）；ui-review 产物 `app.js` 的 shim 已剥离。`ops/task11-local/` 共 84 张截图（4 宽度×18 + 2 宽度×6 大字）。
- **机型切换的真正机制（本轮实测纠错）**：只改 per-project toolbar（`localstorage_ecc0087….json`）对 375/390 有效，但 430 的内建条目（`iPhone 14/15 Pro Max`，index 3）会在 IDE 启动时被重置回默认 390；追加到 per-project list 的 custom 条目也会被丢弃（启动时按**全局目录** `reduxPersist:toolbar`（`localstorage_2176782898a3f9a1a468ececce49ab9c.json`）重建 list）。正确做法：custom 机型追加进**全局** list，并同步 per-project list 与 `current`/`deviceInfo`。`dist/task11-device.cjs` 已改为双写（两份 `.task11-backup`）。实测 custom `Task11 430x932` → 430×792 生效。
- **并发教训**：HBuilderX `publish mp-weixin` 会重启微信开发者工具；与截图矩阵并发会把模拟器机型冲回默认，产出「标 430 实 390」的无效证据（已作废重跑）。**截图期间不得跑 publish / 任何会碰 devtools 的命令。**
- 每轮宽度切换流程固定为：`cli quit` → `dist/task11-waitquit.cjs`（等 24220 关闭，实测约 4s）→ `dist/task11-device.cjs <width> 16` → 读回文件核对 `current` →  capture。`&&` 链中 waitquit 失败会静默跳过后续步骤并留下旧结果，须逐段核对输出。

### 生产发行候选（Task 5 Step 1–2 预备）

- `cli publish mp-weixin --project <worktree>/miniapp --appid wxdf2ca9836263776e --upload false` 退出 0；产物 `dist/build/mp-weixin/project.config.json` appid 为正式号。**未上传微信版本**（日志末行「请在微信小程序开发者工具中点击上传」为 CLI 固定提示，未执行）。
- publish 会把 `src/manifest.json` 重写为 LF（内容不变，appid 未被置 null）；重写后与索引内容一致，`git update-index --refresh` 后状态干净，**源码无实质改动**。
- `urlCheck`：产物 `project.config.json` 原为 true，已改 false；并新建 `project.private.config.json`（`setting.urlCheck:false`，私有配置覆盖公有，#10 先例）。**仅开发期放行；生产须恢复并配置 MP 后台合法域名 `api.bspapp.com` / `api.next.bspapp.com`。**
- 只读 JQL 回读的前置阻塞：worktree 工程未在 HBuilderX 关联云空间（`run-jql` 报「项目还未关联云服务空间」；`project open --path` 导入成功仍不够）。CLI 无关联命令（manifest 58 条无 space/bind/assoc）。**需用户在 HBuilderX UI 为 worktree 工程关联 alipay 空间 env-00jy7289et7b**，或改以已关联的原工程为 `--project` 锚点（待用户选择）。上传/list/download 不受影响（显式 `--space`）。

## 2026-11-15 续：Task 5 真实云验收（进行中）

- **release 与 dev 产物的空间配置差异（实测）**：`publish mp-weixin` 产物 `common/vendor.js` 的混淆配置块（`String.fromCharCode` 包装，解码脚本 `dist/task11-configprobe.cjs`）**不含 alipay 空间**；`launch mp-weixin --compile true` 的 `dist/dev/mp-weixin` 含 `env-00jy7289et7b`。两者客户端同为 `production-client.ts`（仅 `mode==='ui-review'` 才 alias 到 mock，见 `vite.config.ts:8`）。故真实验收按 #10 先例改跑 dev bundle；偏差与理由记录在此。dev 的两处 `urlCheck` 已置 false。
- **dev 编译产物的事件注册格式不同**：release 为 `am:e.o(fn,"0d")`，dev 为 `am: common_vendor.o(fn, "0d")`（helper 名带前缀、冒号与逗号后有空格）。`handlerMap`/`bindId`/`extract-handlers` 的正则已改为 `bind + ':\\s*[\\w.$]*o\\([\\s\\S]*?,\\s*"([a-z0-9]+)"\\)'`，两种产物提取结果一致（首轮真实流程因旧正则取不到 id 而静默失败，已修）。
- **planning-co 契约核对**：`list` 入参为 `{from,to[,cursor,limit]}`（`home-planning/validation.ts:69`），不是 `{date}`；用 `{date}` 探针得到 `INVALID_INPUT` 属正确拒绝。正确入参实测 `{errCode:0,data:{items:[],nextCursor:null}}`，云对象与公共模块链接正常。
- 只读集合盘点回执：`ops/task11-real-2026-11-15/collections.json`（23 个 schema，**无 shopping 集合**）。
- 登录：用户在模拟器完成真实微信登录（代理未伪造身份）；登录页云网关可达后由用户点击进入菜谱首页。
- **原生弹窗自动化在本版本无效（实测）**：`mp.native().confirmModal()/cancelModal()` 返回成功但对话框不关闭（截图为证）；弹窗按钮也不在页面元素树（`.weui-dialog__btn` 等选择器 0 命中）。改用 `mockWxMethod('showModal', fn)` 函数 mock：记录应用真实弹窗参数并按 `globalThis.__modalConfirm` 回答 confirm/cancel；页面逻辑与云写入保持真实。实测拦截到文案 `{"title":"移除这项安排？","content":"2026-11-15 · 晚餐 · 土豆炖牛腩。移除后不可撤销，未保存的输入将丢失。","confirmText":"确认移除","cancelText":"继续编辑"}`，取消保留条目、确认后端到端删除成功（「已移除」+ 列表减少）。另有真实原生弹窗截图 `probe-remove-modal.png` 佐证渲染文案。
- `entryIds()` 去重（dev 产物同一 entry id 出现两个方法键）。
- 首轮真实流程 10/11 通过（01–07、09、11），08 因上述原生弹窗问题失败；修复后整轮重跑 **12/12 pass**（`flow-results.json`）。
- **真实云回读**（`readback.json`，家庭 `9ab1b26b…`＝登录账号当前家庭）：4 条 meal_plans，`_id` 互异、同餐（dinner）多菜并存；`date` 均为本地 `2026-11-15` 字符串；`targetServings` 保留 `2.5` 与 `null`；被编辑行 `version=3`；`titleSnapshot` 与菜谱标题一致；5 条 `plan-add-v1` 回执 `payloadHash` 均 64 位 hex。注意：`field({_id:true,…})` 投影会使带 where 的查询静默返回空（实测），盘点改用不带 `_id` 投影或无过滤查询。
- **同账号旧版本冲突（真实云，全 UI 路径）**：同一入口叠两个编辑实例（`navigateTo` 同 id），上层提交 v+1，下层持 v 保存 → 「其他成员或家庭关系已发生变化…」且草稿 `5` 保留；`reload()` 自带原生确认（首轮探针漏答导致误判「reload 后保存无响应」，**非业务缺陷**），经拦截 showModal 应答后加载服务端值 `4`，再存 `6` 成功。`conflict.json` pass=true。
- **购物清单独立性**：`collections.json` 23 个 schema、无 shopping 集合；结合写作用域栅栏测试（仅写 family_members/meal_plans/mutation_receipts/request_limits，recipes 只读）。真实清单交互属 #12/#14，不伪造。
- **source-unavailable**：登录家庭内无已删除/缺失菜谱样本（`source-availability.json`），该场景**真实云未验**，由 ui-review 两场景与领域测试覆盖；台账如实保留。
- 收尾：`cli close --project dist/dev/mp-weixin` + `cli quit`，24220 已关闭。验收汇总见 `ops/task11-acceptance.json`（含 `git:{committed:false,pushed:false,issueClosed:false,merged:false}`）。

## 2026-11-15 收尾（Task 6，停在提交前）

- 最终门禁：worktree 根 `task -d miniapp check` **exit 0**（eslint 0 警告、三个 typecheck 项目、**71 套件 / 1548 测试全过**、build:weixin、`check-boundaries --artifacts`、`check-secrets` 均通过；日志 `dist/task11-final-check.log`）。`git diff --check` exit 0。
- 规范同步：`docs/design/miniapp/page-specs.md` 路由数 11→13（+#11 计划两页），P-12 增补实施与证据段及未验项/观察项。
- 计划归档：`docs/superpowers/plans/2026-11-15-miniapp-issue11.md`。
- 验收汇总：`ops/task11-acceptance.json`（`git:{committed:false,pushed:false,issueClosed:false,merged:false}`）。
- 变更集快照：206 个修改（含 #1–#10 遗留的 uni_modules 组装产物与 #11 实现）、28 个未跟踪（planning 功能/测试/云模块/ops 证据/review 脚本/计划文档）。**用户授权后已提交 `c6558c63e`（171 文件，+7873/−60）**；未推送、未关单、未合并。`.qoder/` 与 `review/task11-browser.cjs`（H5 探针）按要求保持未跟踪；dist/ 被 gitignore 排除。uni_modules/uni-id-co/vendor 组装产物为门禁 `assemble --check` 所需的确定性生成物，随本提交入库（先例 #2）。
- 生产提醒：release 产物 `urlCheck` 会被 build 重置为 true；上线前须恢复并配置 MP 后台合法域名 `api.bspapp.com` / `api.next.bspapp.com`；release 包不含空间配置的问题需在发布流程中解决（dev 编译注入，见上文）。

## 待提交清单（累计，本轮不提交）

见 Task 6 汇总。