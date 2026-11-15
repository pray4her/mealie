# Issue #11 膳食计划 — 续做实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 复选框跟踪。
> **本计划不产生任何 git 提交/推送/关单**（用户已明确选择「停在提交前」）。所有 `Commit` 步骤替换为「记录待提交清单」。

**Goal:** 把已写完但未验收的 #11 膳食计划从「本地一处类型红灯 + 零证据」推进到「本地门禁全绿 + 微信真实渲染证据 + 真实 uniCloud 测试空间验收 + 完整台账」，停在提交前等用户授权。

**Architecture:** 业务实现已完成，本计划**不重写业务代码**。只做四件事：修一处测试类型推断、补齐丢失的真机自动化取证工具、按 #9/#10 先例采集微信开发者工具证据并上传既有支付宝测试空间做真实验收、写台账与规范更新。

**Tech Stack:** uni-app + Vue 3 + TypeScript + Wot UI 2.4.0；uniCloud（支付宝空间）；Vitest；HBuilderX 5.34 CLI + unicloud 插件 3.0.14；微信开发者工具 CLI + miniprogram-automator 0.13.0；Node fnm 22.23.3。

**Spec:**
- 业务规则：[docs/superpowers/specs/2026-11-03-wechat-unicloud-design.md](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/docs/superpowers/specs/2026-11-03-wechat-unicloud-design.md) §10.2、§8 权限、§12 媒体
- 页面规范：[docs/design/miniapp/page-specs.md](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/docs/design/miniapp/page-specs.md) P-12
- 工单约定：[docs/design/miniapp/issue-design.md](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/docs/design/miniapp/issue-design.md)
- 原始任务定义：[docs/superpowers/plans/2026-11-03-wechat-unicloud.md](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/docs/superpowers/plans/2026-11-03-wechat-unicloud.md) Task 11（第 354–371 行）
- 组件约定：[miniapp/AGENTS.md](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/AGENTS.md)
- 工单：https://github.com/pray4her/mealie/issues/11

---

## Context（为什么做这件事）

工单 #11「按日期、餐次和份数安排膳食」仍 OPEN。审计发现：**业务代码已全部写完但一行未提交**，全部躺在 worktree `E:\pray4her\mealie\.qoder\worktrees\issue-11-planning`（分支 `feat/miniapp-planning-11`，与 `miniapp-dev` 同为 `1f9e659f5`）。上一轮会话在 2026-11-14 19:33 中断，正好停在「探测 H5 原生 picker」这一步，没有留下任何验收证据。

本次实测的本地门禁状态：

| 检查 | 结果 |
|---|---|
| `assemble-uni-id.mjs --check` / `assemble-content-check.mjs --check` | ✅ 通过 |
| `eslint . --max-warnings 0` | ✅ exit 0 |
| `vue-tsc --noEmit -p tsconfig.json`（客户端） | ✅ exit 0 |
| `tsc --noEmit -p tsconfig.cloud.json`（云端） | ✅ exit 0 |
| `vue-tsc --noEmit -p tsconfig.tests.json`（测试） | ❌ **exit 2**，3 处 TS2339 |
| `vitest run` | ✅ **71 套件 / 1548 项全通过**，60.29s |

唯一红灯在 [miniapp/tests/app/planning-review.test.ts](file:///E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/tests/app/planning-review.test.ts) 第 28、29、34 行：`fixture()` 里 `{ date, ...planning }` 被 TS 推断成 `{ date: string }`，展开 `Record<string, string>` 时丢了索引签名，于是 `scenario.planning.read` / `.write` 报「属性不存在」。这阻塞 `task -d miniapp check`。

已实现且无需改动的部分（约 3400 行）：云端 `planning-co`（add/list/get/update/remove）+ `home-planning/{index,repository,validation}.ts` + `home-contracts/planning.ts` + `meal_plans` schema/index + `mutation_receipts` 枚举；客户端 `features/planning/{api,dates,validation,use-planning,use-planning-page}.ts` + `pages/planning/{index,edit}.vue` + 第三个 Tab「计划」+ 菜谱详情「安排一餐」入口；8 个新测试套件。三条验收标准均已被自动化测试覆盖（含 `only member fence, plans, receipts and limits are written; recipes are read only`，以写作用域栅栏证明不触碰购物清单）。

缺口：① 上述类型错误；② 完整门禁（含微信构建 + 产物边界 + 密钥扫描）本轮未跑；③ 视觉/状态矩阵证据为零（`ops/task11-local/` 空目录，`review/task11-browser.cjs` 只有一个 probe）；④ 真实云端验收完全未开始；⑤ 取证工具在本 worktree 缺件；⑥ 文档台账未写、`page-specs.md` 仍写「11 页」。

预期结果：#11 达到「本地全绿 + 真实渲染与真实云端证据齐备 + 台账可复核」，等用户一句授权即可提交收尾。

---

## Global Constraints（每个任务都隐含包含）

- **不提交、不推送、不关单、不合并**。用户本轮只授权到「本地门禁 + 真实云验收」。
- **不扩展** `scripts/doctor.mjs` / `scripts/deploy-preview.mjs` 的 ticket 白名单。#10 已明确记录此决定（`ops/task10-deployment.md` 末行：「task10 进入 deploy-preview/doctor 允许清单（无测试强制，ponytail 不加）」），#9/#10 均直接用 HBuilderX CLI + `ops/taskNN-*` 台账。
- **不动**未跟踪的 `review/task11-browser.cjs`（H5 probe）。用户已选择微信开发者工具路线，该文件原样保留、不删不改不跑。
- **不新增依赖、不新增 `wd-*` 组件**。`@wot-ui/ui` 实测 **2.4.0**；`src/wot.d.ts` 已注册 `WdForm`/`WdFormItem`，`edit.vue` 直接 import 官方组件源文件，无需补注册。组件证据按 `miniapp/AGENTS.md` 用 `wot info Form --version 2.4.0 --format json` 等只读查询核对并记录。
- **云端只允许既有支付宝测试空间** `mealie / env-00jy7289et7b`（`ops/project-target.json`）。禁止：生产发布、上传微信版本、初始化/清空数据库、改环境变量值、新建空间。
- 微信 AppID 用正式号 **`wxdf2ca9836263776e`**（`src/manifest.json` 与 `ops/project-target.json` 已一致）；DCloud AppID `__UNI__5FDC0D7`。`publish` 必须显式传 `--appid`，否则会导出 `touristappid`。
- **密钥零外泄**：不打印/不落盘任何 secret 值。#11 不需要新密钥；若意外触及，按 1Password `op` CLI + gitignored 本地文件处理。
- Node 必须是 **fnm 22.23.3**（系统 Node 更新且不兼容）。所有命令在 worktree 内执行，**不要 `cd` 回原仓库根**。
- 回复用中文。证据必须区分「代理直接观察」与「用户确认」，不得把 mock/jsdom/H5/CLI 诊断写成微信或真机已验收。
- 工具实际路径（ops 旧文档里的 `D:/...` 已失效）：HBuilderX `E:\HBuilderX\cli.exe`；微信开发者工具 `E:\Tencent\微信web开发者工具\cli.bat`；Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`。

---

## File Structure（本轮创建/修改的文件及职责）

| 文件 | 动作 | 职责 |
|---|---|---|
| `miniapp/tests/app/planning-review.test.ts` | 修改（1 行） | 给 review fixture 的 scenario 显式标注索引签名，修 3 处 TS2339 |
| `miniapp/review/extract-handlers.cjs` | 修改（1 行） | 页面清单追加 `planning/index`、`planning/edit`，导出编译后事件 id |
| `miniapp/review/task11-capture.cjs` | 新建 | ui-review 产物的微信开发者工具取证：场景切换 × 宽度 × 字号 → 截图 + 布局断言 |
| `miniapp/review/task11-flow.cjs` | 新建 | 生产构建的真实云验收流程：登录 → 安排 → 冲突 → 移除 → 截图 |
| `miniapp/review/node_modules` | 新建符号链接 | 指向 `E:/pray4her/mealie/miniapp/review/node_modules`（automator 0.13.0 + ws 已在该处） |
| `miniapp/ops/task11-local/` | 填充 | 微信渲染证据：截图 + `capture-results.json` |
| `miniapp/ops/task11-real-2026-11-15/` | 新建 | 真实云验收截图 + `readback.jql` / `readback.json` |
| `miniapp/ops/task11-deployment.md` | 新建 | 上传/回读台账（沿用 `task09-deployment.md` 结构） |
| `miniapp/ops/task11-acceptance.json` | 新建 | 验收结构化记录（沿用 `task09-acceptance.json` 键） |
| `miniapp/ops/task11-progress.md` | 新建 | 执行 ledger + 待提交清单 + 未验项 |
| `docs/design/miniapp/page-specs.md` | 修改 | 路由数 11→13、P-12 从「后续页面」改为已实现并链接证据 |
| `docs/superpowers/plans/2026-11-15-miniapp-issue11.md` | 新建 | 本计划落库副本（执行时从 plan 文件复制） |

**不改动**：任何 `src/`、`uniCloud-alipay/` 业务代码（除非验收暴露真实缺陷 —— 那必须先写失败回归再修，并在台账记录）。

---

## Task 1: 修类型红灯并跑完整本地门禁

**Files:**
- Modify: `miniapp/tests/app/planning-review.test.ts:8`
- 只读验证：`miniapp/Taskfile.yml` 的 `check` 目标

**Interfaces:**
- Consumes: `createProductionClient()` / `reviewRecipes`（来自 `miniapp/review/app-client.ts`，已实现 planning 场景）
- Produces: 全绿的 `task -d miniapp check`，后续所有任务的前置

- [ ] **Step 1: 先确认红灯可复现**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp
pnpm exec vue-tsc --noEmit -p tsconfig.tests.json; echo "EXIT=$?"
```

预期：`EXIT=2`，3 条 `tests/app/planning-review.test.ts(28,30|29,23|34,30): error TS2339: Property 'read'/'write' does not exist on type '{ date: string; }'`。
注意：**不要**用 `| tail` 后取 `$?`，那拿到的是 `tail` 的退出码。

- [ ] **Step 2: 最小修复（保留索引签名，不新增导出、不改断言）**

把 `fixture()` 内第 8 行：

```ts
  const scenario = { planning: { date, ...planning } };
```

改为：

```ts
  const scenario: { planning: Record<string, string> } = { planning: { date, ...planning } };
```

理由：`review/app-client.ts` 的 `PlanningScenario` 未导出，且本文件靠 `delete f.scenario.planning.read` / 赋值 `.write` 动态切换场景，需要的就是索引签名而非精确联合类型。显式标注即可，无需改 `review/app-client.ts`，无需 `any`/`ts-ignore`。

- [ ] **Step 3: 确认该检查转绿**

```bash
pnpm exec vue-tsc --noEmit -p tsconfig.tests.json; echo "EXIT=$?"
```

预期：`EXIT=0`，无输出。

- [ ] **Step 4: 跑完整门禁（含微信构建与产物边界）**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning
task -d miniapp check 2>&1 | tee miniapp/dist/task11-check.log; echo "EXIT=${PIPESTATUS[0]}"
```

预期 `EXIT=0`，依次通过：uni-id 装配 → 内容装配 → ESLint 零警告 → 客户端/云端/测试三组类型检查 → Vitest 71 套件 1548 项 → `build:weixin` → `check-boundaries --artifacts` → `check-secrets`。
若 I/O 密集套件在本机 5s 超时（#9 已记录该现象），用 `task -d miniapp test -- --maxWorkers=2 --testTimeout=120000` 复跑并在台账写明校准，不得改断言。

- [ ] **Step 5: 核对产物路由与 Tab（边界脚本已按 13 页/3 Tab 断言，这里做人工复核）**

```bash
node -p "const a=require('./miniapp/dist/build/mp-weixin/app.json'); JSON.stringify({pages:a.pages.length,tabs:a.tabBar.list.map(t=>t.text)},null,1)"
node -p "require('./miniapp/dist/build/mp-weixin/project.config.json').appid"
```

预期：`pages: 13`、`tabs: ["菜谱","计划","家庭"]`、appid `wxdf2ca9836263776e`。

- [ ] **Step 6: 记录待提交清单（不提交）**

在 `miniapp/ops/task11-progress.md` 写下本任务改动文件与门禁实际输出摘要（套件数/项数/耗时/exit code）。**不执行 `git add` / `git commit`。**

---

## Task 2: 补齐真机取证工具件

**Files:**
- Create symlink: `miniapp/review/node_modules` → `/e/pray4her/mealie/miniapp/review/node_modules`
- Modify: `miniapp/review/extract-handlers.cjs:5`
- Create: `miniapp/review/task11-capture.cjs`

**Interfaces:**
- Consumes: `miniprogram-automator@0.13.0`（`connect`/`callWxMethod`/`mockWxMethod`/`systemInfo`/`reLaunch`/`evaluate`/`screenshot`/`currentPage`/`native()`）
- Produces: `handlerMap(page)` → `{ [dataAttr]: compiledEventId }`；`call(id, detail)`（作用于 `getCurrentPages()` 栈顶）；`shot(name)`；`scene(planning)`；`goto(route)`；`waitData(needle, label)`；供 Task 3 与 Task 5 复用

- [ ] **Step 1: 建符号链接并确认 automator 可用**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/review
ln -s /e/pray4her/mealie/miniapp/review/node_modules node_modules
node -p "require('miniprogram-automator/package.json').version"
node -p "require('ws/package.json').version"
```

预期：`0.13.0` 与一个 ws 版本号。这与 `miniapp/node_modules` 已有的符号链接做法一致（`ls -la miniapp` 可见）。**不要 `npm install`**，避免动锁文件。

- [ ] **Step 2: 扩展 handler 提取清单**

`miniapp/review/extract-handlers.cjs` 第 5 行的 `pages` 数组追加两项：

```js
const pages = ['account/login', 'family/onboarding', 'recipes/index', 'imports/submit', 'imports/status', 'recipes/detail', 'planning/index', 'planning/edit'];
```

- [ ] **Step 3: 跑提取，拿到 planning 两页的真实事件 id**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp
node review/extract-handlers.cjs
```

预期输出含 `planning/index {"prev-week":"..","date-picker":..,"next-week":"..","today":"..","add":..,"more":"..","read-retry":"..","resume":"..","edit":"..","source":".."}` 与 `planning/edit {"search":"..","save":"..","remove":"..","reload":"..","back":"..","resume":"..","read-retry":"..","change-recipe":"..","view-plan":"..","input#targetServings":".."}`。
把实际 id 记进台账。**已实测的编译产物事实**：静态属性（`data-resume`/`data-search`/`data-save`/`data-more`/`data-next-week`/`data-remove`/`data-reload`/`data-back`）编译成 `bindclick="{{f}}"` 这类字面量，可静态提取；但 `v-for` 内的 `data-choose`/`data-meal`/`data-day`/`data-add`/`data-edit` 编译成 `bindclick="{{row.c}}"` / `{{meal.d}}` / `{{date.f}}`，是**逐实例数据**，静态正则取不到。这些一律用 Step 4 的 `callByValue(value)` 在运行时反查（按 `data-*` 的值在 page data 中定位同对象的 handler id，并用页面真实方法名校验，歧义即抛错）。

- [ ] **Step 4: 写取证脚本 `miniapp/review/task11-capture.cjs`**

沿用 `review/task09-flow.cjs` 的 automator 模式（第 1–45 行：`connect({wsEndpoint})`、`until` 轮询、`call(id, detail)` 走编译后 guarded handler、`shot`）。核心骨架：

```js
const automator = require('miniprogram-automator');
const fs = require('node:fs'); const path = require('node:path');
const OUT = path.resolve(__dirname, '../ops/task11-local');
const PORT = process.env.AUTO_PORT || '9421';
const WIDTH = process.env.CAP_WIDTH || '390';
const FONT = Number(process.env.CAP_FONT || '1');
// review/app-client.ts 播种 id = (++planSequence).toString(16).padStart(32,'a')，首条即 31 个 a + '1'
const SEED_ID = '1'.padStart(32, 'a');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1200); } throw new Error('timeout: ' + label); }

// 与 extract-handlers.cjs 同一套正则，但按页运行时计算，避免硬编码 id 漂移
// BASE 可由环境变量切换：Task 3 用 ui-review 产物，Task 5 用生产产物
const BASE = process.env.CAP_BASE || path.resolve(__dirname, '../dist/ui-review/mp-weixin/pages');
function handlerMap(page) {
  const wxml = fs.readFileSync(path.join(BASE, page + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(BASE, page + '.js'), 'utf8');
  const map = {};
  for (const tag of wxml.match(/<home-action[^>]*>/g) || []) {
    const data = (tag.match(/data-([a-z-]+)=/) || [])[1];
    const bind = (tag.match(/bindclick="\{\{([A-Za-z]+)\}\}"/) || [])[1];
    if (!bind) continue;
    const id = (js.match(new RegExp(bind + ':e\\.o\\([\\s\\S]*?,"([a-z0-9]+)"\\)')) || [])[1];
    if (data && id) map[data] = id;
  }
  return map;
}

(async () => {
  let mp = await automator.connect({ wsEndpoint: 'ws://localhost:' + PORT });
  const results = { width: WIDTH, font: FONT, platform: 'WeChat devtools simulator / ui-review fixture', cases: [], screenshots: [],
    evidenceBoundary: ['ui-review mock 客户端，非真实云、非真实身份', '字号经 mockWxMethod 模拟，非物理系统设置', '模拟器截图，非实体手机'] };
  const shot = async name => { const file = `wechat-${name}-${WIDTH}-f${FONT}.png`; await mp.screenshot({ path: path.join(OUT, file) }); results.screenshots.push(file); };
  const call = (id, detail) => mp.evaluate((id, detail) => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const key = Object.keys(p).find(k => typeof p[k] === 'function' && k.endsWith('_' + id));
    if (!key) return { ok: false, id, route: p.route };
    p[key].call(p, { type: 'tap', detail: detail || {}, target: { dataset: {} }, currentTarget: { dataset: {} } });
    return { ok: true };
  }, id, detail);
  const dataStr = () => mp.evaluate(() => JSON.stringify(getCurrentPages()[getCurrentPages().length - 1].data));
  const waitData = (needle, label) => until(async () => (await dataStr()).includes(needle) ? needle : null, 30000, label);

  // mp-weixin 的 uni.setStorageSync 直通 wx.setStorageSync，无 H5 的 {type,data} 外壳。
  // 关键：review/app-client.ts 的 `const seed = scenario().planning` 只在 createProductionClient() 时读一次，
  // 而 reLaunch 不会重跑 App.onLaunch。所以换 seed 必须 close + launch 真正重启小程序；
  // read/write/source 是每次调用动态读取的，无需重启。
  const CLI = 'E:/Tencent/微信web开发者工具/cli.bat';
  const PROJECT = path.resolve(__dirname, '../dist/ui-review/mp-weixin');
  // mockWxMethod 是会话级的，每次重启后必须重新注入
  const applyFont = async () => { if (FONT === 1) return; const info = await mp.systemInfo();
    await mp.mockWxMethod('getAppBaseInfo', { ...info, fontSizeScaleFactor: FONT, fontSizeSetting: Math.round(16 * FONT * 10) / 10 }); };
  let lastSeed;
  const scene = async (planning, extra = {}) => {
    await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { ...extra, planning });
    const seed = (planning.seed || 'none') + '|' + (extra.recipes || '');
    if (seed !== lastSeed) {
      await mp.close();
      mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT, port: Number(PORT) });
      lastSeed = seed; await applyFont();
    }
  };
  const goto = async route => { await mp.reLaunch('/' + route); const pathOnly = route.split('?')[0];
    await until(async () => (await mp.currentPage()).path === pathOnly, 30000, 'route ' + pathOnly); await sleep(2000); };

  await applyFont();

  // 小程序无 DOM：断言只用 automator 的 page.data() / page.$$() / element.outerWxml() / element.size()。
  // HomeAction 是 virtualHost 组件，选择器穿不透（#9 已记录），所以点击一律走 call(编译后事件 id)，
  // 断言只针对页面自身 WXML 上的 view/text 节点（data-plan-entry、data-meal-panel 等已确认存在于编译产物）。
  const pg = () => mp.currentPage();
  const count = async sel => (await (await pg()).$$(sel)).length;
  const wxmlOf = async sel => { const el = await (await pg()).$(sel); return el ? await el.outerWxml() : ''; };
  const state = () => pg().then(p => p.data());
  const has = async (sel, needle) => (await wxmlOf(sel)).includes(needle);
  const firstAttr = async (sel, name) => { const el = await (await pg()).$(sel); return el ? await el.attribute(name) : null; };

  // v-for 的 bindclick 是逐实例数据（编译产物实测为 {{row.c}} / {{meal.d}} / {{date.f}}），
  // extract-handlers.cjs 的静态正则只匹配 {{字母}}，拿不到这些 id。
  // 运行时按 data-* 的值在 page data 里反查同对象的 handler id，并用页面真实方法名校验，歧义即抛错。
  async function callByValue(value, detail) {
    const ids = await mp.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1];
      return Object.keys(p).filter(k => typeof p[k] === 'function').map(k => k.split('_').pop()); });
    const found = [];
    const walk = n => { if (!n || typeof n !== 'object') return;
      if (!Array.isArray(n)) { const vs = Object.values(n);
        if (vs.includes(value)) for (const v of vs) if (typeof v === 'string' && ids.includes(v)) found.push(v); }
      for (const v of Object.values(n)) walk(v); };
    walk(await state());
    if (found.length !== 1) throw new Error('ambiguous handler for ' + value + ': ' + JSON.stringify(found));
    return call(found[0], detail);
  }
  const chooseFirst = async () => callByValue(await firstAttr('[data-choose]', 'data-choose'));

  const SCENES = [
    { name: 'index-empty', route: 'pages/planning/index', planning: { seed: 'empty' }, wait: 'loaded',
      checks: [async () => await count('[data-plan-entry]') === 0,
               async () => await has('[data-meal-panel="dinner"]', '还没有安排，添加一道家常菜吧。')] },
    { name: 'index-populated', route: 'pages/planning/index', planning: { seed: 'populated' }, wait: 'titleSnapshot',
      checks: [async () => await count('[data-plan-entry]') === 4,
               async () => await count('[data-meal-panel]') === 4] },
    { name: 'index-long', route: 'pages/planning/index', planning: { seed: 'long' }, wait: '一家人周末',
      checks: [async () => { const el = await (await pg()).$('[data-plan-entry]'); const s = await el.size(); const v = await (await pg()).size(); return s.width <= v.width; }] },
    { name: 'index-source-unavailable', route: 'pages/planning/index', planning: { seed: 'populated', source: 'unavailable' }, wait: 'sourceAvailable',
      checks: [async () => await has('[data-plan-entry]', '菜谱已不可用，保留安排快照'),
               async () => await count('[data-source]') === 0] },
    { name: 'index-pagination', route: 'pages/planning/index', planning: { seed: 'pagination' }, wait: 'nextCursor',
      checks: [async () => await count('[data-plan-entry]') === 20, async () => await count('[data-more]') === 1],
      after: async () => { await call(handlerMap('planning/index').more); await sleep(2500); },
      post: [async () => await count('[data-plan-entry]') === 21, async () => await count('[data-more]') === 0] },
    { name: 'index-read-failure', route: 'pages/planning/index', planning: { seed: 'populated', read: 'failure' }, wait: '暂时无法读取',
      checks: [async () => await has('[data-protected]', '暂时无法读取或确认结果'),
               async () => await count('[data-read-retry]') === 1] },
    { name: 'index-week-cross', route: 'pages/planning/index', planning: { seed: 'populated' }, wait: 'selectedDate',
      checks: [async () => await count('[data-day]') >= 1 || !!(await state()).selectedDate],
      after: async () => { await call(handlerMap('planning/index')['next-week']); await sleep(2000); },
      post: [async () => { const s = await state(); return typeof s.selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.selectedDate); }] },
    { name: 'edit-search', route: 'pages/planning/edit', planning: {}, wait: 'searchReady',
      checks: [async () => await count('[data-search-stage]') === 1, async () => await count('[data-choose]') >= 1] },
    { name: 'edit-search-no-match', route: 'pages/planning/edit', planning: {}, wait: 'searchReady',
      after: async () => { const p = await pg(); await p.setData({ query: '不存在的菜名xyz' }); await call(handlerMap('planning/edit').search); await sleep(2500); },
      post: [async () => await has('[data-search-stage]', '没有匹配的菜谱，请换个关键词。')] },
    { name: 'edit-form', route: 'pages/planning/edit', planning: {}, wait: 'searchReady',
      after: async () => { await chooseFirst(); await sleep(2500); },
      post: [async () => await count('[data-form-stage]') === 1,
             async () => { const s = await state(); return /^\d{4}-\d{2}-\d{2}$/.test(s.draft.date) && s.draft.meal === 'dinner'; }] },
    { name: 'edit-field-error', route: 'pages/planning/edit', planning: {}, wait: 'searchReady',
      after: async () => { await chooseFirst(); await sleep(2000); const p = await pg(); await p.setData({ 'draft.targetServings': '-1' }); await call(handlerMap('planning/edit').save); await sleep(2000); },
      post: [async () => await has('[data-form-stage]', '份数可留空，或填写大于 0 且不超过 10000 的数字。'),
             async () => (await state()).draft.targetServings === '-1'] },
    { name: 'edit-conflict', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'populated', write: 'conflict' }, wait: 'sourceAvailable',
      after: async () => { const p = await pg(); await p.setData({ 'draft.targetServings': '4' }); await call(handlerMap('planning/edit').save); await sleep(3000); },
      post: [async () => await has('[data-protected]', '其他成员或家庭关系已发生变化'),
             async () => (await state()).draft.targetServings === '4',
             async () => await count('[data-reload]') === 1] },
    { name: 'edit-remove-confirm', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'populated' }, wait: 'sourceAvailable',
      after: async () => { await call(handlerMap('planning/edit').remove); await sleep(1500); await mp.native().cancelModal(); await sleep(1500); },
      post: [async () => await count('[data-form-stage]') === 1,
             async () => await count('[data-remove]') === 1] },
    { name: 'edit-source-unavailable', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'long', source: 'unavailable' }, wait: 'sourceAvailable',
      checks: [async () => await has('[data-form-stage]', '菜谱已不可用，保留原安排快照'),
               async () => await count('[data-save]') === 1,
               async () => await count('[data-remove]') === 1] },
  ];

  for (const s of SCENES) {
    const c = { name: s.name, pass: false, checks: [] };
    try {
      await scene(s.planning, s.extra); await goto(s.route); await waitData(s.wait, s.name);
      const run = async (list, phase) => { for (const [i, fn] of (list || []).entries()) { const ok = await fn(); c.checks.push({ phase, i, ok }); if (!ok) throw new Error(`${phase} check ${i} failed`); } };
      await run(s.checks, 'pre');
      if (s.after) await s.after();
      await run(s.post, 'post');
      const v = await (await pg()).size(); c.viewport = v;   // 记录实际逻辑宽度，不假设等于 CAP_WIDTH
      await shot(s.name); c.pass = true;
    } catch (e) { c.error = String(e && e.message || e); await shot(s.name + '-FAILED').catch(() => {}); }
    results.cases.push(c); console.log('CASE', s.name, c.pass);
  }
  results.pass = results.cases.length > 0 && results.cases.every(c => c.pass);
  fs.writeFileSync(path.join(OUT, `capture-results-${WIDTH}-f${FONT}.json`), JSON.stringify(results, null, 2));
  await mp.disconnect();
})().catch(e => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 5: 补齐 4 个「必须由真实写入触发」的场景**

Step 4 的 `SCENES` 已含 14 个可由 fixture 直接播种的场景：`index-empty`、`index-populated`、`index-long`、`index-source-unavailable`、`index-pagination`、`index-read-failure`、`index-week-cross`、`edit-search`、`edit-search-no-match`、`edit-form`、`edit-field-error`、`edit-conflict`、`edit-remove-confirm`、`edit-source-unavailable`。

另外 4 个状态**不能播种**（`review/app-client.ts` 明确注释：pending intent 只能由真实 UI 写入产生），必须在脚本里追加为带 `after` 的场景：

```js
    { name: 'edit-committed', route: 'pages/planning/edit', planning: {}, wait: 'searchReady',
      after: async () => { await chooseFirst(); await sleep(2000); await call(handlerMap('planning/edit').save); await sleep(3000); },
      post: [async () => await has('[data-protected]', '已保存'),
             async () => await count('[data-view-plan]') === 1,
             async () => await count('[data-save]') === 0] },
    { name: 'edit-pending', route: 'pages/planning/edit', planning: { write: 'lost-ack' }, wait: 'searchReady',
      after: async () => { await chooseFirst(); await sleep(2000); await call(handlerMap('planning/edit').save); await sleep(3000); },
      post: [async () => await has('[data-protected]', '结果尚未确认'),
             async () => await count('[data-resume]') === 1] },
    { name: 'index-pending', route: 'pages/planning/edit', planning: { write: 'lost-ack' }, wait: 'searchReady',
      after: async () => { await chooseFirst(); await sleep(2000); await call(handlerMap('planning/edit').save); await sleep(3000);
                           await mp.reLaunch('/pages/planning/index'); await sleep(3000); },
      post: [async () => await has('[data-protected]', '上次操作结果尚未确认'),
             async () => await count('[data-resume]') === 1] },
    { name: 'edit-search-empty-family', route: 'pages/planning/edit', planning: { seed: 'empty' }, extra: { recipes: 'empty' }, wait: 'searchReady',
      // recipes:'empty' 是 review/app-client.ts 已有的 Scenario 字段；经 scene 的 extra 传入并触发重启
      checks: [async () => await has('[data-search-stage]', '家庭还没有菜谱，请先到菜谱页添加。')] },
```

`index-pending` 的 `post` 里还要断言四个 `data-add` 均 disabled：用 `firstAttr('[data-add]', 'data-add')` 取餐次值后 `callByValue` 不应产生跳转（`currentPage().path` 仍为 `pages/planning/index`）。

- [ ] **Step 6: 语法自检（IDE 尚未开启，实跑放 Task 3）**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp
node --check review/task11-capture.cjs && echo SYNTAX_OK
```

预期：`SYNTAX_OK`。真实冒烟在 Task 3 Step 3 执行。

- [ ] **Step 7: 记录待提交清单（不提交）**

台账写下：新增/修改的取证文件、automator 与 ws 实际版本、提取到的 planning 事件 id 表。

---

## Task 3: 微信开发者工具 ui-review 渲染证据

**Files:**
- Create: `miniapp/dist/ui-review/mp-weixin/`（gitignored 构建产物）
- Create: `miniapp/ops/task11-local/*.png` + `capture-results-*.json`

**Interfaces:**
- Consumes: Task 2 的 `review/task11-capture.cjs`
- Produces: P-12 要求的实际渲染证据，供 Task 6 台账引用

- [ ] **Step 1: 构建 ui-review 微信产物（沿用 #10 命令）**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp
pnpm exec uni build -p mp-weixin --mode ui-review --outDir dist/ui-review/mp-weixin
node -p "require('./dist/ui-review/mp-weixin/app.json').pages.length"
ls dist/ui-review/mp-weixin/static/ui-review
```

预期：13 页；`static/ui-review/` 含 `noodles/chicken/rice/salad.jpg`（由 `vite.config.ts` 的 `isolated-ui-review-assets` 插件复制）。
**核对隔离**：`dist/ui-review` 与生产 `dist/build` 是两套产物，`check-boundaries.mjs` 会拒绝生产产物含 `HOME_UI_REVIEW_V11_ONLY`，不得混用。

- [ ] **Step 2: 开 IDE 自动化端口 9421**

```bash
"E:/Tencent/微信web开发者工具/cli.bat" cache --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/ui-review/mp-weixin
"E:/Tencent/微信web开发者工具/cli.bat" close --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/ui-review/mp-weixin
"E:/Tencent/微信web开发者工具/cli.bat" auto --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/ui-review/mp-weixin --auto-port 9421 --disable-gpu
```

若出现「只有菜单栏的黑屏」：这是 GPU 渲染失败，不是登录问题。`cli.bat quit` 后按已知修复把 `C:\Users\pray4her\AppData\Local\微信开发者工具\User Data\<hash>\WeappLocalData\localstorage_b72da75d79277d2f5f9c30c9177be57e.json` 的 `enableGPU` 置 `false` 再启动（或直接用 `--disable-gpu`）。
**验收期间保持 IDE 前台**：模拟器被后台会节流页面定时器（#9 已记录）。

- [ ] **Step 3: 采集 390px 标准字号全场景**

```bash
CAP_WIDTH=390 CAP_FONT=1 AUTO_PORT=9421 node review/task11-capture.cjs
```

预期：Task 2 Step 4–5 的 18 个场景全部 `pass:true`，截图落 `ops/task11-local/`，每轮 JSON 记录 `viewport`（实际逻辑宽度）。
`wait` 字段必须是**页面 data 里会出现的子串**（如 `loaded`/`searchReady`/`sourceAvailable`/`nextCursor`/`titleSnapshot` 或 `message` 文案）；模板里的静态文字不在 data 中，不能用作 `wait`，只能经 `outerWxml()` 断言。若某场景 `wait` 超时，先打印 `await state()` 核对真实 data 键名再调整，不得放宽断言。

**重启机制的实测与降级**：换 `seed` 会触发 `mp.close()` + `automator.launch({cliPath, projectPath, port})`，因为 fixture 的 seed 只在客户端创建时读一次。首次跑先单独验证一次 close→launch 能重新进入小程序并读到新 seed。若 `launch` 因 IDE 已占用该端口而失败，降级为 `mp.close()` 后 `automator.connect({wsEndpoint:'ws://localhost:9421'})`；若仍不行，用 `cli.bat close` → `cli.bat auto --auto-port 9421` 逐 seed 重启，并在台账记录实际耗时与方式。**不得为了省重启而把不同 seed 的断言混在同一客户端实例上跑**（`planning-review.test.ts` 已断言空/满两个客户端必须互相隔离）。

- [ ] **Step 4: 采集其余宽度与放大字号**

在 IDE 模拟器机型选择器里依次切换逻辑宽度 **320 / 375 / 430**（automator 0.13.0 无视口 API，必须经 IDE 机型切换；每轮记录实际达到的逻辑宽度）。每个宽度跑：

```bash
CAP_WIDTH=320 CAP_FONT=1 AUTO_PORT=9421 node review/task11-capture.cjs
CAP_WIDTH=375 CAP_FONT=1 AUTO_PORT=9421 node review/task11-capture.cjs
CAP_WIDTH=430 CAP_FONT=1 AUTO_PORT=9421 node review/task11-capture.cjs
```

再对布局关键场景（`index-populated`、`index-long`、`index-pagination`、`edit-form`、`edit-field-error`、`edit-search`）在 390 与 320 下跑放大字号：

```bash
CAP_WIDTH=390 CAP_FONT=1.4 AUTO_PORT=9421 node review/task11-capture.cjs
CAP_WIDTH=320 CAP_FONT=1.4 AUTO_PORT=9421 node review/task11-capture.cjs
```

`usePageTypography` 把 `fontSizeScaleFactor` 钳到 ≥1 并作为唯一根字号来源（`16 × scale`），1.4 → 22.4px；`singleColumn` 在 scale>1 时为真。**字号是 mock 模拟，不是物理系统设置，台账必须这样写。**

- [ ] **Step 5: 逐张人工复核截图（脚本断言不替代看图）**

用 Read 工具打开关键截图，确认：周日期条窄屏可独立横滚且每日命中区域 ≥44px；四餐次标题层级正确；长标题/长快照换行不遮挡；`data-more`/`data-read-retry` 不被底部安全区裁切；错误文案与字段就地关联；选中态除颜色外有字重/下划线差异。发现真实缺陷 → 先写失败回归再修，并在台账记录（不得直接改断言迁就）。

- [ ] **Step 6: 关闭 ui-review 端口，释放 IDE**

```bash
"E:/Tencent/微信web开发者工具/cli.bat" close --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/ui-review/mp-weixin
```

- [ ] **Step 7: 记录证据边界（不提交）**

台账明确：ui-review mock 客户端 / 非真实云 / 非真实身份 / 模拟器非实体手机 / 字号为模拟。未覆盖项（实体手机、iOS 侧滑返回、真实读屏、物理键盘）逐条列出保留。

---

## Task 4: 上传既有支付宝测试空间并只读回读

**Files:**
- Create: `miniapp/ops/task11-deployment.md`
- Create: `miniapp/dist/task11-deploy/`、`miniapp/dist/task11-readback/`（gitignored 日志）

**Interfaces:**
- Consumes: Task 1 全绿门禁；`ops/project-target.json`（provider/spaceId/spaceAppId/dcloudAppId/weixinAppId）
- Produces: 云端存在 `planning-co` + `meal_plans`，供 Task 5 真实验收

- [ ] **Step 1: 确认 IDE 与空间（只读）**

```bash
"E:/HBuilderX/cli.exe" open
"E:/HBuilderX/cli.exe" unicloud service-space list --json true --protocol-version 1 --request-id task11-readonly-space
```

预期：返回既有 `{provider:'alipay',spaceId:'env-00jy7289et7b',spaceName:'mealie'}`。**只记录公开标识符，不打印/不落盘任何凭据。** HBuilderX CLI 需要 IDE 在运行。

- [ ] **Step 2: 列出本轮实际需上传的资源（先只读盘点，不上传）**

```bash
"E:/HBuilderX/cli.exe" unicloud cloud-resource list --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --json true --protocol-version 1 --request-id task11-readonly-inventory
"E:/HBuilderX/cli.exe" unicloud database list --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --json true --protocol-version 1 --request-id task11-readonly-schema
```

本轮变更面（据 git diff 实测）：
- 新云对象：`planning-co`
- 新公共模块：`home-planning`
- 改公共模块：`home-contracts`（planning 类型 + AppClient）、`home-kernel`（CollectionName 加 `meal_plans`）、`home-recipes`（导出 `readRecipe`）
- 新 Schema/索引：`meal_plans.schema.json`、`meal_plans.index.json`
- 改 Schema：`mutation_receipts.schema.json`（operation 枚举加 `plan-add-v1`/`plan-update-v1`/`plan-remove-v1`）

上传公共模块会触发依赖云函数自动更新（#9/#10 回执均含「被云端云函数依赖，正在更新相关云端云函数…更新成功」），`recipes-co`/`family-co`/`media-co`/`imports-co`/`import-worker` 会随之更新 —— 台账必须记录这一连带影响。

- [ ] **Step 3: 上传公共模块（逐个，取官方回执）**

```bash
"E:/HBuilderX/cli.exe" unicloud common-module upload --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --name home-contracts --force --protocol-version 1 --json true --request-id task11-upload-home-contracts
```

对 `home-kernel`、`home-recipes`、`home-planning` 重复同一命令（改 `--name` 与 `--request-id`）。
预期：每次回执含官方 TS 类型检查通过 + 编译文件数 + 依赖云函数更新成功。日志存 `dist/task11-deploy/`。
若 `--name` 不被支持，用 `--help` 查实际参数名（旧记录提示 `common-module download` 把 `--path` 的 basename 当模块名）；**不要凭记忆猜参数**。

- [ ] **Step 4: 上传云对象 `planning-co`**

```bash
"E:/HBuilderX/cli.exe" unicloud cloud-function upload --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --name planning-co --force --protocol-version 1 --json true --request-id task11-upload-planning-co
```

预期：TS 检查通过、编译成功。`planning-co/package.json` 已声明 `home-contracts`/`home-kernel`/`home-family`/`home-planning`；`home-planning/package.json` 已声明 `home-recipes`（`readRecipe` 依赖），传递依赖应随之解析。

- [ ] **Step 5: 同步 Schema 与索引**

```bash
"E:/HBuilderX/cli.exe" unicloud database upload --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --kind schema --protocol-version 1 --json true --request-id task11-upload-schema
"E:/HBuilderX/cli.exe" unicloud database upload --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --kind index --protocol-version 1 --json true --request-id task11-upload-index
```

预期：`meal_plans` schema + `family_date_created_id` 索引初始化完成；`mutation_receipts` 枚举更新。
#10 曾遇 CLI 误判「跳过上传」，后已解决；若再现，**下载回读确认云端实际版本**，必要时请用户在 HBuilderX GUI 右击 schema → 上传 DB Schema，不得声称已同步。

- [ ] **Step 6: 只读回读，绑定实际云编译产物**

```bash
"E:/HBuilderX/cli.exe" unicloud common-module download --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --path E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/task11-readback/home-planning --protocol-version 1 --json true --request-id task11-readback-home-planning
"E:/HBuilderX/cli.exe" unicloud database download --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --kind schema --path E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/task11-readback --protocol-version 1 --json true --request-id task11-readback-schema
```

核对项：`home-planning/index.js` 含 `plan-add-v1`/`plan-update-v1`/`plan-remove-v1` 与 `createPlanningReads`；`home-planning/validation.js` 含 `parseLocalDate` 的闰年表与 `days > 30` 范围上限；`meal_plans.schema.json` 的 `permission` 四项全 `false`、`date` 正则含 `(?!0000)`；`mutation_receipts.schema.json` 枚举含三个 plan 操作。
**不读取、不打印任何 secret 配置内容。**

- [ ] **Step 7: 写 `ops/task11-deployment.md`（不提交）**

沿用 `ops/task09-deployment.md` 结构：日期/分支/部署基线/目标空间/工具版本 → 已上传（逐个回执）→ 只读回读核对 → 连带更新的云函数 → 环境变量现状（只记名与存在性）→ 未做事项。
明确写：未触碰其他资源、未清空/初始化数据库、未改环境变量值、未上传微信版本、未生产发布。

---

## Task 5: 生产构建真实云验收

**Files:**
- Create: `miniapp/review/task11-flow.cjs`
- Create: `miniapp/ops/task11-real-2026-11-15/`（截图 + `readback.jql` + `readback.json`）

**Interfaces:**
- Consumes: Task 1 的 `dist/build/mp-weixin`（真实 `production-client.ts`）；Task 4 的云端资源
- Produces: 三条验收标准的真实云端证据

- [ ] **Step 1: 用 HBuilderX 重建生产发行候选（显式 AppID）**

```bash
"E:/HBuilderX/cli.exe" publish mp-weixin --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --appid wxdf2ca9836263776e --upload false
node -p "require('./miniapp/dist/build/mp-weixin/project.config.json').appid"
```

预期：日志确认默认空间 `env-00jy7289et7b`；产物 appid 为正式号；`src/manifest.json` 未被回退。**`--upload false`，不上传微信版本。**
若省略 `--appid`，CLI 会把 manifest AppID 置 null 并产出 `touristappid` 包 —— 必须显式传，并核对源码无意外变化。

- [ ] **Step 2: 开发期域名放行核对**

`dist/build/mp-weixin/project.config.json` 与 `project.private.config.json` 的 `urlCheck` 均需为 `false`（后者会覆盖前者，#10 已踩坑）。仅开发期「不校验合法域名」，放行官方 DCloud 云域名 `api.bspapp.com` / `api.next.bspapp.com`。**台账必须写明生产须恢复并配置 MP 后台合法域名。**

- [ ] **Step 3: 开生产自动化端口 9422，并请用户完成真实登录**

```bash
"E:/Tencent/微信web开发者工具/cli.bat" cache --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/build/mp-weixin
"E:/Tencent/微信web开发者工具/cli.bat" auto --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/build/mp-weixin --auto-port 9422 --disable-gpu
"E:/Tencent/微信web开发者工具/cli.bat" islogin
```

**需用户操作**：用近期活跃的真实微信账号扫码登录开发者工具。#10 曾记录模拟器账号被真实微信后端拒绝（`loginByWeixin` 失败 → `AUTH_REQUIRED`），那不是代码缺陷。代理不得伪造身份或 mock 云响应。
登录后确认进入既有家庭（云端已有 #1–#10 留下的家庭与菜谱数据）。若云端无菜谱，先在真实客户端手动建一道带基准份数的菜谱。

- [ ] **Step 4: 写 `review/task11-flow.cjs` 并跑真实流程**

复用 Task 2 的全部 helper（`handlerMap`/`call`/`callByValue`/`chooseFirst`/`until`/`shot`/`pg`/`count`/`wxmlOf`/`state`/`has`/`firstAttr`），但：`OUT` 改为 `ops/task11-real-2026-11-15`；`CAP_BASE=dist/build/mp-weixin/pages`（生产产物）；端口 9422；**不 mock 任何 wx 方法、不写 `home.ui-review.v11`、不用 `SCENES` 播种表**。真实流程里 `data-add`/`data-day`/`data-choose`/`data-edit` 都是 `v-for` 实例，一律用 `callByValue(属性值)`；底部 Tab 用 `mp.switchTab('/pages/planning/index')`。按序采集：

1. `01-tab-planning`：点底部「计划」Tab → `pages/planning/index`，周条为北京今天所在周（周一为首），今天与选中态可区分。
2. `02-add-form`：晚餐「添加」→ `pages/planning/edit?date=<今天>&meal=dinner`，搜索选一道真实菜谱，份数自动带出基准值。
3. `03-saved-first`：保存 → 「已保存」→「查看计划」→ 晚餐出现 1 条，标题为快照、份数正确。
4. `04-same-meal-second`：同一天晚餐再加第二道菜（份数填 `2.5`）→ 晚餐 2 条并存，互不覆盖。**（验收标准 2：同餐多菜）**
5. `05-other-meal`：切到「其他」餐次加一道 → 四餐次均可用。**（P-12 要求保留「其他」）**
6. `06-cross-week`：回 index，点「上一周」「下一周」「今天」，再用原生日期 picker 选一个跨月/跨年日期 → 周条正确平移，选中日不被 UTC 改写。**（验收标准 1：本地日期）**
7. `07-edit-entry`：打开已存条目 → 改日期/餐次/份数 → 保存 → 版本号递增，快照标题不变，菜谱不可更换（提示需先移除）。
8. `08-remove-confirm`：点「移除安排」→ 原生确认框文案含**已保存的**日期/餐次/标题 → 取消后条目仍在；再确认 → 条目消失。
9. `09-detail-entry`：菜谱详情「安排一餐」→ 带 `recipeId` 直达表单 stage，不出现在线搜索。
10. `10-source-unavailable`：请用户在 uniCloud 控制台或经 JQL 把该菜谱标记删除（#17 未实现，用只读方式确认既有已删除菜谱即可；若无样本，此场景保留为未验项，不得伪造）→ 计划仍显示快照 + 「菜谱已不可用」，无「查看菜谱」，仍可编辑/移除。
11. `11-invalid-input`：份数填 `-1` / 日期非法 → 字段就地报错、输入保留、云端拒绝（`INVALID_INPUT`）。

- [ ] **Step 5: 云端只读回读，证明落库语义**

写 `ops/task11-real-2026-11-15/readback.jql`（`unicloud database run-jql` 把 .jql 当表达式求值，返回命令对象，**不能有顶层 await**）：

```js
db.multiSend(
  db.collection('meal_plans').where({ familyId: '<实际家庭ID>' }).orderBy('date', 'asc').orderBy('createdAt', 'asc').getTemp(),
  db.collection('mutation_receipts').where({ operation: 'plan-add-v1' }).limit(5).getTemp()
)
```

```bash
"E:/HBuilderX/cli.exe" unicloud database run-jql --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --file E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/ops/task11-real-2026-11-15/readback.jql --request-id task11-readback-plans --protocol-version 1 --json true
```

核对：`date` 是用户选定的 `YYYY-MM-DD` 字符串（**不是 UTC 截取**）；同餐两条独立 `_id`；`titleSnapshot` 与菜谱标题一致；`targetServings` 保留 `2.5` 与 `null`；`version` 随编辑递增；回执 `payloadHash` 为 64 位 hex。结果脱敏后存 `readback.json`。

- [ ] **Step 6: 证明「改计划不动购物清单」**

云端目前**没有** `shopping_lists` / `shopping_items` 集合（#12 未实现）。用只读盘点确认：

```bash
"E:/HBuilderX/cli.exe" unicloud database list --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp --provider alipay --space env-00jy7289et7b --json true --protocol-version 1 --request-id task11-readonly-collections
```

预期：无 shopping 集合。结合已通过的 `only member fence, plans, receipts and limits are written; recipes are read only`（写作用域恰为 `family_members`/`meal_plans`/`mutation_receipts`/`request_limits`），台账写清：**本票以写作用域栅栏 + 云端集合盘点证明不触碰购物清单；真实清单交互属 #12/#14，不在本票伪造。**

- [ ] **Step 7: 共享编辑冲突的真实边界**

云端当前只有一个真实微信账号（#3/#4 先例：多成员并发由云对象/API/领域测试证明，非两个真实账号）。因此：
- 真实采集：同一账号两次快速提交同一条目（旧 version）→ 第二次 `CONFLICT`，草稿保留，`data-reload` 后按最新 version 保存成功。
- 台账明确：**「两个真实微信账号并发」未实测**，由 `same-version concurrent updates have exactly one winner`、`different entries edited concurrently never overwrite each other`、`update versus remove CAS race rejects stale deletion after update commits` 覆盖。若用户能提供第二个近期活跃账号，再补真实双成员采集。

- [ ] **Step 8: 跨 UTC 日界的真实边界**

北京 00:05 的真实时刻不可按需复现。台账写：真实采集覆盖「选定日不被 UTC 改写」（Step 4.6 + Step 5 回读）；**跨午夜瞬间切换**由 `derives Beijing date from the instant ... rather than UTC or host date`（含 `2026-11-14T00:05:00+08:00` 用例）与 `first Today activation after Beijing midnight selects and requests the new day without midnight changing the selected date` 覆盖。不得声称已实测午夜。

- [ ] **Step 9: 关闭 IDE 端口并记录（不提交）**

```bash
"E:/Tencent/微信web开发者工具/cli.bat" close --project E:/pray4her/mealie/.qoder/worktrees/issue-11-planning/miniapp/dist/build/mp-weixin
```

台账区分「代理直接观察」与「用户确认」，逐条列出未验项。

---

## Task 6: 台账、规范更新与收尾（停在提交前）

**Files:**
- Create: `miniapp/ops/task11-acceptance.json`、`miniapp/ops/task11-progress.md`
- Create: `docs/superpowers/plans/2026-11-15-miniapp-issue11.md`（本计划副本）
- Modify: `docs/design/miniapp/page-specs.md:5`、`docs/design/miniapp/page-specs.md:98-104`

**Interfaces:**
- Consumes: Task 1–5 的全部实际输出
- Produces: 可复核的验收记录 + 待提交清单，等用户授权

- [ ] **Step 1: 写 `ops/task11-acceptance.json`**

沿用 `ops/task09-acceptance.json` 的键：`ticket, title, date, branch, baseline, uncommittedChanges, environment, method, criteria, screenshots, validation, openItems, git`。
- `baseline`: `1f9e659f5293488f27904c9edc3f6fa340e70f8b`；`branch`: `feat/miniapp-planning-11`（== `miniapp-dev`）
- `uncommittedChanges`: 本轮全部改动仍未提交
- `method`: 驱动方式（编译后事件 id）、picker 处理（`call(id,{detail:{value}})` 走同一 guarded handler；原生选择器 UI 本身不模拟）、真实部分（`wx.login`/uni-id、真实云对象、真实 DB）、观察方式（automator 截图 + 页面 data + `run-jql` 回读）
- `criteria`: 三条验收标准逐条 → 证据文件 + 覆盖方式（真实/自动化）+ 未验边界
- `validation`: `command: "task -d miniapp check"`、实际 `exitCode`、套件/项数、耗时、各步骤、超时校准说明
- `git`: **`{committed:false, pushed:false, issueClosed:false, reason:"用户本轮只授权到本地门禁+真实云验收"}`**

- [ ] **Step 2: 写 `ops/task11-progress.md`**

含：本轮起点与审计结论、逐任务实际结果、组件证据（`@wot-ui/ui` 2.4.0、Wot CLI 版本、用到的 `WdForm`/`WdFormItem` props `model`/`schema`/`error-type`/`disabled`/`reset-on-change` 与 `layout="vertical"`/`prop`/`custom-class`，以及实际 `wot info` 查询命令与关键结果）、**待提交文件清单**、未验项清单。

- [ ] **Step 3: 更新 `page-specs.md`**

第 5 行：`当前路由有 11 页：#20 的 9 页和 AI 导入 2 页` → 改为 13 页（#20 九页 + AI 导入两页 + #11 计划两页），并说明第三个原生 Tab「计划」。
P-12 段（第 98–104 行）：从「后续页面与组合交互 / 尚未有生产实现」改为已实现，链接 `ops/task11-local/` 与 `ops/task11-real-2026-11-15/` 证据，保留仍未验项（实体手机、真实读屏、双账号并发、午夜瞬间）。
**只改这两处**，不重写其他页规范，不动 `README.md` 的视觉令牌。

- [ ] **Step 4: 复制本计划到 `docs/superpowers/plans/2026-11-15-miniapp-issue11.md`**

从 `C:\Users\pray4her\.qoder\plans\windy-swamp-otter.md` 复制，并在开头补「实际执行结果」小节链接台账。

- [ ] **Step 5: 最终复跑门禁 + 文档链接核对**

```bash
cd E:/pray4her/mealie/.qoder/worktrees/issue-11-planning
task -d miniapp check 2>&1 | tee miniapp/dist/task11-final-check.log; echo "EXIT=${PIPESTATUS[0]}"
git diff --check
git status --short
```

预期：`EXIT=0`；`git diff --check` 无空白错误；`git status` 显示本轮改动 + 原有未提交 planning 实现。
核对新增文档里的相对链接可达（注意 `ops/ui-visual-v11/`、`ops/ui-accessibility-2026-11-10/`、`review/capture-wechat.mjs` 被 gitignore 且**在本 worktree 不存在**，不要引用它们作为本轮证据）。

- [ ] **Step 6: 向用户汇报并请求授权（不提交）**

汇报：门禁实际结果、真实云验收覆盖了什么/没覆盖什么、待提交文件清单、建议的提交标题 `feat(miniapp): 按本地日期、餐次和份数安排膳食 (#11)`。
**等用户明确说「提交/推送/关单」后才执行**，沿用 #9/#10 先例。

---

## Verification（端到端如何验证）

1. **本地门禁**：`task -d miniapp check` exit 0，含 71 套件 / 1548 项 Vitest、三组类型检查、ESLint 零警告、微信构建、产物边界（13 页 / 3 Tab / 无 ui-review 夹具 / 无源码与密钥泄漏）、密钥扫描。
2. **渲染证据**：`miniapp/ops/task11-local/` 含 320/375/390/430px × 标准/1.4 字号的微信开发者工具截图 + 每轮 `capture-results-*.json`（`pass:true`），并经人工看图复核。
3. **云端存在性**：`unicloud cloud-resource list` / `database list` 显示 `planning-co`、`home-planning`、`meal_plans`；下载回读绑定实际云编译产物，含三个 plan 回执操作与 `permission` 全 false。
4. **真实业务**：`ops/task11-real-2026-11-15/` 截图证明同餐多菜、四餐次、跨周选日、编辑/移除、字段错误、来源失效快照；`readback.json` 证明 `date` 为本地 `YYYY-MM-DD` 字符串、快照与份数正确、版本递增。
5. **购物清单独立**：云端集合盘点无 shopping 集合 + 写作用域栅栏测试通过。
6. **台账可复核**：`task11-acceptance.json` 的 `criteria` 三条各指向具体证据文件，`openItems` 诚实列出未验项，`git.committed=false`。

## Out of Scope（本轮明确不做）

- 任何 git 提交、推送、合并、关闭 #11、生产发布、上传微信版本。
- #12 购物清单、#13 加购换算、#14 计划加入清单、#15/#16 评论评分、#17 删除清理 —— 计划页不提前出现这些假按钮。
- 扩展 `doctor.mjs` / `deploy-preview.mjs` ticket 白名单（#10 已定 ponytail 不加）。
- 修改/删除/运行未跟踪的 H5 probe `review/task11-browser.cjs`。
- 新增依赖、新增 `wd-*` 组件、改 Wot 主题令牌、改第三方源码。
- 改环境变量值、初始化/清空数据库、新建云空间、调用付费 AI。
- 重写已完成的 planning 业务代码（除非验收暴露真实缺陷，且必须先写失败回归）。