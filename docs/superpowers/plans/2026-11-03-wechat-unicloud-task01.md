# Task 01 微信登录与家庭引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `pray4her/mealie#1`：真实微信登录进入无家庭业务的引导，凭据无效或退出后不能恢复受保护状态，并交付隔离工程、测试及真实验收记录。

**Architecture:** 客户端账号门面调用受控 `uni-id-co` 登录/退出，`account-co` 经共享身份守卫返回当前身份。官方身份源码只读归档、确定性装配最小公开部署包；本地端口替身与真实适配调用相同身份逻辑。一次只交付 #1，不拆成横向工单，不开始 #2。

**Tech Stack:** 官方 uni-app Vue 3 `vite-ts`、TypeScript、uniCloud/uni-id、uni-helper 模板类型、Vitest 3、Vue Test Utils 2、Task、pnpm；HBuilderX 5.34 用于另行获准的真实云端验证。

**Spec:** `docs/superpowers/specs/2026-11-03-wechat-unicloud-task01-design.md`（用户 2026-11-03 批准），同时遵守总设计 `docs/superpowers/specs/2026-11-03-wechat-unicloud-design.md`。本文件细化并替代总计划 Task 01 的步骤；总计划其他任务保持不变。

## Global Constraints

- “所有产品代码及依赖新增在 `miniapp/`；不修改旧 `frontend/`、`mealie/`、根 Taskfile、旧依赖和生成类型。”
- “首版仅微信登录、不要求手机号、不提供密码账户或全局管理员注册入口。”
- “不实现创建/加入家庭、个人资料管理、账户注销或其他后续功能，不造一个恒为 null 的家庭 API。”
- “Task 01 只公开 `uni-id-co.loginByWeixin`、`uni-id-co.logout` 和 `account-co.session`”。
- “不得改写上游压缩发行库、内部 lib 或生成文件，不重新实现微信 code 交换或 JWT 签名。”
- “旧请求排空前不开始另一轮登录”；“不能仅用 Promise.race 的超时就认定底层请求已经结束”。
- “Task 01 不新增‘全设备退出/整条历史续期链撤销’功能”。
- “实际上传测试空间前先列出目标及资源清单另行确认；不清空测试数据库、不覆盖空间已有同名资源。”
- “Git 提交、生产部署、付费资源开通和旧服务停用均未获授权。”
- 文案集中于 `miniapp/src/shared/copy.ts`；客户端只 type-only 引入云端 contracts；不运行旧代码生成器或修改 Crowdin locale。
- 本文件获审阅前不创建工程、安装依赖或调用云空间；任何 mock、静态检查和本地编译都不能代替真实云端/真机证据。

## Review Focus

1. JWT 签名仍有效但 token 已移除、账户禁用/注销或 `valid_token_date` 更新：`identity.test.ts` 必须拒绝，且拒绝前不续期。
2. SDK 在 Promise 完成前写入迟到 `newToken`：`session-boundary.test.ts` 覆盖退出、下一次登录及冷启动；不能只断言 Vue ref。
3. 近续期阈值 logout 经上游中间件偷偷 mint token：`uni-id-entry.test.ts` 断言刷新次数为 0、响应无 `newToken`，云端另实测。
4. 插件虚拟合并、上游升级或装配失败重新暴露完整对象/用户集合：`boundaries.test.ts` 及 `vendor-assembly.test.ts` 覆盖重复对象、导出变化、恢复开放的 clientDB 权限、摘要不符和重复生成。
5. 直接进入/返回受保护页及 onShow 恢复时的弱网：`auth.test.ts` 显式驱动真实注册的生命周期，未经会话确认不显示内容，网络故障不伪装成认证失败。

---

## 0. 执行边界、前置与版本

### 0.1 单票交付与执行方式

保留用户选择 **A：一位新子代理实施 #1，另一位新子代理独立审阅本票全部变更**。本计划的步骤是同一垂直切片内部的红绿周期，不新增工单或发布边。实施者不得自审后直接宣布完成；独立审阅发现问题时由实施者修复、复验，再交回审阅。所有共享文件由同一实施者协调，不并行改写。

计划本身由主代理自审，不把 writing-plans 自审委托出去。本计划批准后才加载执行技能；若指定执行技能在本机缺失，明确报告并征得按本会话直接编排等价子代理流程的同意，不安装未知技能或把缺失当作已执行。

实施前用 GitHub CLI 读回 #1 及直接阻塞；首次 tracker 写入前验证 `gh repo view pray4her/mealie --json nameWithOwner`。开工时依仓库规则认领 #1；H0 已由用户确认，但标签仍为 `needs-info`，只能按真实缺口更新，不能据环境声明关闭工单。当前本轮没有 tracker 写入。所有 tracker 命令显式指向 `pray4her/mealie`。

### 0.2 测试目标与唯一云根

测试目标沿用批准设计：微信 `wx68649810a6f363f3`、DCloud `__UNI__5FDC0D7`、服务空间 `mealie` / `env-00jy7289et7b` / space appid `2021007114656325`。密钥只由部署者安全配置，不能要求粘贴到会话。

先在 HBuilderX 只读核对现有空间厂商/地域及可用运行时，再把 `miniapp/ops/project-target.json` 写成非秘密目标记录。本文路径中的 **`CLOUD` 是唯一精确路径别名**，按核验结果取下表之一，禁止创建字面目录 `CLOUD` 或并存三套源码：

| 核验厂商 | CLOUD |
| --- | --- |
| aliyun | `miniapp/uniCloud-aliyun` |
| tencent | `miniapp/uniCloud-tcb` |
| alipay | `miniapp/uniCloud-alipay` |

`project-target.json` 固定 `{provider, cloudRoot, spaceId, spaceAppId, dcloudAppId, weixinAppId}`；provider 为上述枚举，cloudRoot 必须与之匹配。它不接受任意路径、密钥或 API endpoint。厂商无法确认时可做客户端/测试工具准备，但不猜测或生成正式云根；云端文件步骤暂停。

整个 `miniapp/` 导入 HBuilderX；不只导入 `src/`。缺完整 uniCloud/TS 编译插件时报告并请用户确认安装。IDE 启动、登录或界面操作需人工配合时提供实际步骤，不伪造已完成。

### 0.3 固定候选工具链，不把元数据相容当作实测

| 项目 | 本票基线 |
| --- | --- |
| 官方模板 | `dcloudio/uni-preset-vue` revision `f747e3b11c51b3bff6c05e2b54f9a3173a590044`，`vite-ts` |
| DCloud 编译包 | 模板整套 `3.0.0-5030420261029002`，不混用版本 |
| Vue / runtime-core | `3.4.21`（安装冲突后经用户批准修正）；模板其他运行依赖按锁文件固定 |
| Vite / 测试 Vue 插件 | `5.2.8` / `@vitejs/plugin-vue@5.2.4` |
| 本地 Node / pnpm | `22.23.3` / `10.20.0`，不使用旧 frontend 的 pnpm 版本约束 |
| TypeScript / vue-tsc | `5.8.3` / `3.0.8`，替换模板旧 TS 4.9 / vue-tsc 1，仅影响新工程 |
| uni-helper | `@uni-helper/uni-app-types@1.4.2`，仅 dev 类型依赖 |
| Vitest / Vue Test Utils / DOM | `3.2.6` / `2.4.6` / `jsdom@26.1.0` |
| lint | ESLint `9.39.1`、`@eslint/js@9.39.1`、typescript-eslint `8.46.3`、eslint-plugin-vue `10.5.1`、vue-eslint-parser `10.2.0` |
| Node / uni 声明 | `@types/node@22.15.30`、`@dcloudio/types@3.4.31`（安装冲突后经用户批准修正） |
| 官方 uni-id 源码 | `dcloud/hello_uni-id-pages` revision `993791b9eb298be8013f22daa9f2efee6c50cc23`，uni-id-pages 1.1.29；配套模块随同一归档 |

这些版本已只读查询官方源码及 registry 元数据，尚未安装或执行兼容性测试。获准实施时校验下载完整性、记录归档 SHA-256、各插件版本和许可。下载版本不存在、peer 冲突或模板整套构建不兼容时停止并记录；不得静默改用 alpha 模板、升级 Vite 大版本或忽略类型错误。

2026-11-03 执行时修正：原候选 Vue／runtime-core `3.4.38`、uni 声明 `3.4.19` 的严格 peer 安装实际失败后已停工。主会话核对官方 npm registry 与包声明，用户明确批准将前两者对齐 DCloud 固定编译器链至 `3.4.21`，uni 声明改为 `3.4.31`；仅修改这两项候选，其他版本、严格 peer、测试及授权边界不变。这是经批准的基线修正，不是兼容性实测 PASS；仍须重新安装和验证，若再遇冲突继续停止报告。

uni-helper 官方说明需 TS 5/6、`moduleResolution:'Bundler'`；客户端 types 为 `vite/client`、`@dcloudio/types`、`@uni-helper/uni-app-types`。`.npmrc` 仅在新工程按文档设置 `shamefully-hoist=true`，仍显式声明直接依赖。v1 类型插件为可选，默认不配置；若负向模板测试证明原生同名标签未受检查，仅启用同一包的官方 volar-plugin 并复验、记录，不跳过检查。它不是 Vite/运行时插件。不引入 create-uni、自动路由、middleware、network、Pinia 或 UnoCSS 来替换已批准路线。

Task 使用现有可运行的 v3；不存在时经实施授权把官方 Windows 二进制和校验信息放入已批准的会话工具目录，只调整本会话 PATH，不改全机配置。pnpm 同理采用固定版本，不全局升级用户工具。云运行时不照抄本地 Node 22，由目标厂商实测后单独记录。

## 1. 文件结构与精确接口

### 1.1 本票文件清单（CLOUD 按 0.2 唯一展开）

| 创建路径 | 单一职责 |
| --- | --- |
| `miniapp/{package.json,pnpm-lock.yaml,.npmrc,.node-version,.gitignore,.env.example}` | 独立依赖、固定工具版本、忽略本地秘密与产物；env 示例仅工具路径/非秘密值，不设置 VITE_APPSECRET 等客户端秘密入口 |
| `miniapp/{Taskfile.yml,vite.config.ts,vitest.config.ts,tsconfig.json,tsconfig.cloud.json,tsconfig.tests.json,eslint.config.js}` | 生产构建与测试分离、客户端/云端/测试类型环境隔离 |
| `miniapp/src/{main.ts,App.vue,pages.json,manifest.json,env.d.ts,uni.scss}` | 模板入口、两个页面路由、公开 AppID、类型声明及基础样式 |
| `miniapp/src/shared/{copy,app-client,cloud-client,session-boundary,route-guard}.ts` | 中文文案、依赖注入、统一云调用、会话栅栏、页面守卫 |
| `miniapp/src/features/auth/{api,use-auth}.ts` | AccountApi 适配及应用实例级只读身份状态，不使用大 store |
| `miniapp/src/pages/account/login.vue`, `miniapp/src/pages/family/onboarding.vue` | 真实微信登录动作、会话确认后的引导及退出；无家庭假 API |
| `CLOUD/cloudfunctions/account-co/{index.obj.ts,package.json}` | 只公开 session，平台上下文与响应转换 |
| `CLOUD/cloudfunctions/common/home-contracts/{index.ts,identity.ts,package.json}` | 客户端/云端共享 wire 类型，无运行时平台实现 |
| `CLOUD/cloudfunctions/common/home-kernel/{index.ts,auth.ts,uni-id-adapter.ts,errors.ts,clock.ts,request-limit.ts,package.json,platform.d.ts}` | 同一身份守卫、窄 uni-id/账户读取适配及有限节流；无 Task02 通用数据库层 |
| `miniapp/cloud-policies/{uni-id-entry,before-register}.cjs` | 自有公开入口装配策略和纯注册钩子，绝不修改上游 lib |
| `miniapp/cloud-policies/clientdb-permissions.json` | 导入身份集合的 clientDB 默认全拒绝策略，不修改只读归档 |
| `miniapp/vendor/uni-id/{upstream.tar.gz,lock.json,README.md}` | 官方完整只读源码归档、revision/摘要/许可及再现说明，不解压为可发现的完整云对象 |
| `miniapp/scripts/{assemble-uni-id,check-boundaries,check-secrets,check-template-types,doctor}.mjs` | 本地确定性装配、边界/密钥/模板类型检查及只读环境缺口报告 |
| `miniapp/src/uni_modules/<plugin-id>/...`, `CLOUD/cloudfunctions/uni-id-co/...` | 上述归档+自有策略生成的必要官方资源和唯一受控对象；生成文件禁止手改 |
| `miniapp/tests/support/{harness,fixtures,uni-stubs,sdk-transport}.ts` | 可信 seed、同一业务逻辑、真实页面生命周期驱动和 SDK 写入顺序替身 |
| `miniapp/tests/domain/{identity,request-limit}.test.ts`, `tests/app/{auth,session-boundary}.test.ts` | 身份/有界节流和两个页面、退出/续期竞争 |
| `miniapp/tests/contracts/{boundaries,vendor-assembly,uni-id-entry,template-types}.test.ts`, `tests/fixtures/invalid-button.vue` | 部署公开面、供应链/导入图、装配及负向类型测试；错误 SFC 不进正式 src |
| `miniapp/ops/{project-target.json,capabilities.md,test-evidence.md,deploy-preview.json}` | 非秘密目标、兼容性记录、红绿/云端/真机证据及上传前资源清单 |

装配时保留官方源码中声明的配套插件与公共模块，不能凭本表猜一个删减依赖列表。排除示例数据库数据、真实配置和其他产品页面；必要 schema 的安装与现有集合冲突逐项列入部署预览，不“初始化全部”。归档不得从用户本地含密钥的已有项目打包。

官方固定源码的 uni-id-users Schema 含集合级 read=true，不能把“关闭云方法”误认为“关闭所有数据库入口”。生成资源对本票导入的身份集合统一设置 clientDB read/create/update/delete=false，保留其他结构与索引；策略显式记录于 clientdb-permissions.json，不能手改上游归档。身份云对象使用传统服务器数据库 API，仍负责自己的身份/字段校验；Schema 权限不当作服务器自动鉴权。真实验证同时证明 clientDB 拒绝与官方微信登录成功。

### 1.2 保留总计划的 wire 契约

```ts
type Id = string;
type TokenPair = { token: string; tokenExpired: number };
type Identity = { uid: Id; refreshedToken?: TokenPair };
interface AccountApi {
  signInWeixin(): Promise<Identity>;
  session(): Promise<Identity>;
  signOut(): Promise<void>;
}
interface AppClient { account: AccountApi }
type CloudSuccess<T> = { errCode: 0; data: T; newToken?: TokenPair };
```

`account-co.session()` 的 data 只为 `{uid}`；内部 Identity.refreshedToken 转到顶层 newToken，不把整份平台结果展开。`invoke<T>(object:string,method:string,input:unknown):Promise<T>` 是统一解包边界；只转发公开参数，不传 UID/本地角色作为身份。AccountApi 验证身份 DTO 字段，错误统一为 `AppError` 的 code/message，平台内部错误及网络正文不能原样展示。

### 1.3 身份、平台和客户端端口

- `ClientInfo = {appId:string;uniPlatform:string;deviceId?:string;clientIP?:string;locale?:string}`；入口验证 DCloud AppID 和 `mp-weixin` 平台，其他字段不能授予 UID、角色或家庭。
- `VerifiedToken = {uid:Id;issuedAtSeconds:number;expiresAtSeconds:number}`；`TokenPort.verify(token,clientInfo):Promise<VerifiedToken>` 必须以 `checkToken(...,{autoRefresh:false})` 成功为前提。若需读取 iat/exp，须在签名校验后解析并检查有限整数，不能以 decode 代替 verify。守卫也拒绝 expiresAtSeconds×1000≤now 的结果，测试端口与真实端口使用同一时钟约定。
- `TokenPort.refreshIfNeeded(token,clientInfo):Promise<TokenPair|null>`；仅在当前账户检查后调用官方续期能力，不自签 JWT。`AccountStatusPort.get(uid):Promise<{status:number|null;tokens:string[];validTokenDateMs:number|null}|null>`；读取只投影这些字段，缺省 status 归一为 null。
- `createRequireIdentity(deps:{tokens:TokenPort;accounts:AccountStatusPort;now:()=>number}): (token:string|undefined,clientInfo:ClientInfo,options?:{refresh?:boolean})=>Promise<Identity>`；产生的 requireIdentity 保持总计划的两个必需参数，options 为云内用途、默认允许必要续期，logout 固定 false。
- `createUniIdPorts(clientInfo:ClientInfo):{tokens:TokenPort;accounts:AccountStatusPort}` 在方法调用时建立官方实例/数据库投影；模块导入时不连接云端。窄平台声明无 DOM、无客户端 uniCloud，全程不用 `any` 或全局 `uniCloud:any`。
- `createRequestLimiter({now,windowMs,maxPerWindow,maxKeys}):{consume(key:string):void}`；仅当前云实例内的有界桶。初始 windowMs=60_000、maxKeys=1_024、登录/会话每键分别 10/60 次；实例内复用同一 limiter，不在每请求中重建。登录按平台上下文的 clientIP 与方法取桶，会话经验证后按 UID 与方法取桶；不把 token、客户端自报 UID 或日志中的原始个人信息作为键。桶到期淘汰，容量满时拒绝而非无限增长。退出不受登录按钮节流阻断。跨实例持久限流属于 Task02，不宣称本票已实现。
- 客户端 `createCloudClient({transport,boundary}):{invoke<T>(object,method,input):Promise<T>;account:AccountWireApi}`；`AccountWireApi={loginByWeixin(code:string):Promise<void>;session():Promise<Identity>;logout():Promise<void>}` 是仅注入账号门面的私有调用能力，不作为 AppClient 的新增公开入口。transport 的调用结果为 unknown，由统一边界解包；普通 invoke 只登记 business 请求，不能因参数 object/method 恰为身份对象就自动获得绕过关闭状态的权限。
- `createSessionBoundary(storage):SessionBoundary` 提供 `run<T>(kind:'login'|'session'|'logout'|'business',action:()=>Promise<T>):Promise<T>`、`login(flow:()=>Promise<Identity>):Promise<Identity>`、`close(revoke:()=>Promise<void>):Promise<void>` 和只读 `closing/epoch`。login 包住整条取 code→登录→session 流程，持有同一代次/独占屏障，成功且代次仍有效才清 closed 标记，失败则清 SDK 已写的 token；close 也要等旧登录流程安全结算。只有私有 AccountWireApi 登记 login/logout 类型；业务代码只能使用普通 invoke。
- `createAccountApi({wire:AccountWireApi,platformLogin,boundary}):AccountApi`；platformLogin 只返回微信 code，生产实现用 uni.login，不返回伪造用户。signInWeixin 使用 boundary.login 包住完整流程，不能在 await code 返回后漏做旧代次检查。`createAuthController(account:AccountApi)` 提供只读 `identity`、`phase` 和 `signIn/restore/signOut`；phase 为 `anonymous|authenticating|checking|authenticated|signing-out|unavailable`。
- `app-client.ts` 提供类型化 InjectionKey、`provideAppClient/useAppClient` 与同实例 auth controller；生产由 createApp 构造，测试按 mount 注入，避免跨实例/跨测试状态污染。`route-guard.ts` 的 `ensureAuthenticated():Promise<boolean>` 仅在服务器确认成功后为 true；认证失败 reLaunch 登录，网络失败隐藏保护内容、提供重试，不清成已注销。

`createHarness(options?:{now?:number}):Harness`：`seedIdentity(input:{uid:Id;status?:number;issuedAtSeconds?:number;validTokenDateMs?:number}):Promise<void>`、`revokeToken(uid):void`、`client(uid):AppClient`、`advance(ms):void`、`rows<T>(collection):Promise<T[]>`。仅 seed 的身份拥有 fixture token；未知 UID、未知 token 一律 AUTH_REQUIRED。seed/revoke 只存在 tests，不导出到生产对象。fixture 中 session 调用同一 createRequireIdentity，signOut 撤销该 fixture 请求 token；不在测试重写一套身份规则。

`mountPage(component,{client})` 注入同一 AppClient 并返回 `{wrapper,show,hide,unload,navigation}`；这些方法驱动 SFC 通过 `@dcloudio/uni-app` 真正注册的回调。SDK 替身提供 `deferCall()` / `resolveWithNewToken()`：先写 storage，再 resolve，模拟已核对的顺序，而非在 Promise 后假装写 token。

## 2. Task 01：完成登录—会话—退出闭环

**Files:** 上述清单全部归本票；除本文及批准状态记录外，不涉及仓库旧工程。

**Consumes:** 已批准两份设计、微信/DCloud 标识、现有隔离测试空间、官方固定源码及端口。

**Produces:** 1.2/1.3 的精确接口、两个可操作页面、只有三个公开方法的部署资源，以及分别标注本地/云端/真机状态的证据。

### 准备与身份红绿周期

- [ ] **Step 0 — 确定本票工作基线。**记录 `git status --short`，读回并认领 #1；完成 0.2 只读厂商核验后固定 CLOUD。不能清理当前未跟踪的设计/技能文件，不新建另一个 Git 仓库。
- [ ] **Step 1 — 建立唯一独立测试工具链。**从固定模板 revision 提取到 `miniapp/`，按 0.3 锁定依赖并生成锁文件；立即建立 Taskfile 的 test 转发 `pnpm exec vitest run {{.CLI_ARGS}}`，供后续红绿命令使用，Step 20 再扩展完整门禁。Vitest 独立配置只加载测试用 plugin-vue，默认 Node、页面文件用 `@vitest-environment jsdom`。所有 TS 配置 strict；客户端按 0.3，云端独立采用 Node-only types、无 DOM/客户端 uniCloud，测试配置才包含 Vitest/jsdom。自有 CJS 策略以 JSDoc/checkJs 纳入检查。不要使用 passWithNoTests，也不添加“expect(true)”占位测试。云端包按 CLOUD 建立真实依赖路径，生产业务暂不实现；根 pnpm 安装不负责安装尚未装配的云包 file 依赖。

  本地 TS/Vitest 可将 home-kernel/home-contracts 别名映射到选定 CLOUD 的真实源码，客户端仅保留 type-only 契约映射；真实上传依赖另由 package.json 与 HBuilderX 验证，不能拿别名成功当部署成功。每轮红灯允许先创建可加载、明确抛未实现异常的函数/SFC 壳，不能因缺文件、配置或依赖而把测试加载失败当业务红灯。
- [ ] **Step 2 — 为身份与对象策略写失败测试。**建立 1.2/1.3 的类型、纯端口替身及最小可加载测试夹具；未实现函数可以明确抛未实现错误，不返回成功。写下列业务断言，另外在 `uni-id-entry.test.ts` 覆盖三个公开方法及 logout 不续期。

  ```ts
  await expect(h.client('forged').account.session())
    .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(await seeded.account.session()).toEqual({ uid: 'alice' });
  h.revokeToken('alice');
  await expect(seeded.account.session())
    .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(refreshCallsAfterRejectedAccount).toBe(0);
  expect(logoutResponse).not.toHaveProperty('newToken');
  expect(logoutRefreshCalls).toBe(0);
  ```

  每条断言在其测试中单独 arrange，不直接复制未定义变量。具名场景：`rejects_missing_or_forged_token`、`rejects_expired_token`、`returns_only_identity`、`rejects_revoked_token_before_refresh`、`rejects_disabled_or_closed_account`、`checks_valid_token_date_in_milliseconds`、`accepts_missing_or_zero_status`、`logout_does_not_refresh_near_threshold`。撤销界限比较已验证 iat 秒×1000，早于界限拒绝、相等允许；过期边界 exp 秒×1000等于 now 时拒绝。入口另有 `rejects_non_code_fields_and_oversized_code`：空 code、1_025 字符 code 及夹带 role/uid/inviteCode 均在供应商调用前失败，调用次数为 0。

  request-limit.test.ts 另固定 `login_bucket_rejects_eleventh_call`、`bucket_expires_after_60000ms`、`key_capacity_fails_closed`；登录同键前 10 次允许、第 11 次 QUOTA_EXCEEDED，60_000ms 后恢复；maxKeys=2 时第三新键被拒绝，过期可释放容量。断言退出不误走登录限流。

- [ ] **Step 3 — 确认身份业务红灯。**运行 `task -d miniapp test -- tests/domain/identity.test.ts tests/domain/request-limit.test.ts tests/contracts/uni-id-entry.test.ts`；预期因未实现守卫/节流/策略失败。模块无法加载、缺依赖或 TS 语法错误先修测试基线，不计作业务红灯。记录命令、失败断言与原因。
- [ ] **Step 4 — 实现共享身份守卫。**在 auth.ts 实现 createRequireIdentity；依次验证 token、账户状态、请求 token 当前存在、撤销时间，再决定续期，拒绝时不触发刷新。uni-id-adapter.ts 仅适配 verify/refresh/账户投影，clock/errors/request-limit 各自专职；所有异常转安全 AppError，不记录 token、账户整行或 AppSecret。
- [ ] **Step 5 — 实现薄 account-co。**仅具名导出 session 及必要私有生命周期，用 getUniIdToken/getClientInfo 建立真实端口并调用相同守卫；顶层回传 newToken。package.json 显式声明 home-kernel/home-contracts 及平台公共依赖；home-kernel 显式依赖实际物理插件中的 uni-id-common，不靠 Vitest alias 代替部署依赖。
- [ ] **Step 6 — 验证身份绿灯。**运行 `task -d miniapp test -- tests/domain/identity.test.ts tests/domain/request-limit.test.ts`；全部身份/节流场景应 PASS，域测试不会访问云网络。对象策略在 Step 11 验证，不在此声称整条 Step 3 命令已通过。

### 官方资源装配红绿周期

- [ ] **Step 7 — 写装配与导入边界失败测试。**`vendor-assembly.test.ts` 验证归档摘要错即拒绝、重复生成字节一致、未知来源/路径逃逸拒绝、已有非生成文件不覆盖；`boundaries.test.ts` 验证自有云根和插件云目录中恰有一个 uni-id-co、禁止运行时云实现进入 src、vendor/test 不进产物，以及 `identity_clientdb_permissions_are_closed`：所有生成身份 Schema 的四项集合权限均为 false，恢复 read=true 即失败。`uni-id-entry.test.ts` 验证实际生成入口只有 loginByWeixin/logout，account-co 只有 session，未知/密码/管理员/closeAccount 调用均失败，不只扫描按钮文案。
- [ ] **Step 8 — 确认装配红灯。**运行 `task -d miniapp test -- tests/contracts/vendor-assembly.test.ts tests/contracts/boundaries.test.ts tests/contracts/uni-id-entry.test.ts`；预期装配/策略未实现导致断言失败，不让缺归档或网络下载错误充当红灯。小 fixture 使用固定测试源，正式归档另校验真实摘要。
- [ ] **Step 9 — 实现确定性装配。**归档锁定官方 revision 和 SHA-256，完整源码不改；assemble-uni-id.mjs 导出 `assembleUniId({archivePath,lockPath,targetPath}):Promise<{outputs:string[];sha256:string}>` 并提供 `--check` 只读比对。仅创建清单内可追踪生成资源，按 clientdb-permissions.json 生成拒绝 clientDB 的身份 Schema；原版完整对象不出现在虚拟合并目录，生成的受控包包含 `upstream/entry.js` 及原有相对依赖结构，自有 index.obj.js 显式装配方法和生命周期，不展开上游全部导出。
- [ ] **Step 10 — 收敛官方入口及注册钩子。**uni-id-entry.cjs 拒绝非目标 appId/platform、未知方法及 loginByWeixin 的 code 以外参数（包括 inviteCode/role/uid）；code 须为非空、最长 1_024 字符的字符串，在供应商调用前拒绝越界。通过上游生命周期初始化所需中间件。logout 先调用共享 requireIdentity(refresh:false)，给上游 auth 中间件传递已验证 authInfo 防止再次自动续期，再复用官方退出模块；在锁定源码的契约测试中验证这一提前返回机制，升级不匹配即停止。自有 after 只返回允许字段，logout 无 newToken，错误不回放供应商正文。

  before-register.cjs 通过官方 `uni-config-center/uni-id/hooks/index.js` 接入，拒绝密码/用户名密码属性及 admin，检查微信注册来源并固定 status=0。配置模板固定 userRegisterDefaultRole 为空，不手改上游源码。官方配置中心的真实 config.json 与任何本地秘密明确 gitignore；装配 --check 比对生成代码/模板，不读取或要求真实密钥值。官方示例秘密不复制为有效配置。

- [ ] **Step 11 — 验证装配绿灯。**重跑 Step 8 和 Step 3；生成物导出集合为精确 allowlist，双对象、源摘要变化和重新引入完整对象均失败。依赖声明指向真实物理资源，部署包运行时不能 require 包外源码。此步骤不声称 HBuilderX 已上传成功。

### 客户端、页面与退出竞争红绿周期

- [ ] **Step 12 — 写真实页面与 SDK 顺序失败测试。**在 auth.test.ts 挂载真实两个 SFC，使用带 slot、disabled、tap 语义的 uni stubs；逐一驱动 show/hide/unload。session-boundary.test.ts 的替身先更新 uni_id_token/uni_id_token_expired 再返回 Promise，覆盖下列断言，不能使用吞掉受保护内容的空组件。

  ```ts
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  expect(storage.get('uni_id_token')).toBeUndefined();
  expect(storage.get('uni_id_token_expired')).toBeUndefined();
  expect(nextLoginCallsWhileOldRequestPending).toBe(0);
  expect(afterOldResponse.identity).toBeNull();
  expect(afterColdStart.phase).not.toBe('authenticated');
  ```

  具名场景：`calls_weixin_then_server_session`、`redirects_on_expired_login`、`clears_state_even_when_logout_fails`、`late_sdk_refresh_cannot_restore_logout`、`new_login_waits_for_old_calls_to_settle`、`cold_start_respects_closed_marker`、`network_failure_hides_protected_content_without_revoking_token`、`direct_entry_and_return_run_guard`、`login_double_tap_shares_one_attempt`。登录成功但 session 检查失败时也清理 SDK 已写 token，不能留下可冷启动恢复的半登录态。

- [ ] **Step 13 — 确认页面业务红灯。**运行 `task -d miniapp test -- tests/app/auth.test.ts tests/app/session-boundary.test.ts`；预期身份动作、守卫或栅栏未实现失败，先排除无效生命周期替身等测试基线故障。
- [ ] **Step 14 — 实现统一云调用与会话栅栏。**storage 使用 SDK 两个标准 key 和自有 `home.auth.closed`；close 在任何 await 前持久化 true、递增 epoch 并通知 controller 隐藏内容。只允许本次受控 revoke 调用穿过关闭状态，排空关闭前登记的旧请求；每个迟到结果落地后清凭据，最后再清一次。关闭结束前新登录等待同一屏障，失败/未知结果仍保持关闭标记；只有明确发起的微信登录且 session 验证成功才清标记。底层 SDK Promise 未结算的自设超时不能释放屏障；界面提示等待/重试，不偷偷进入保护页。
- [ ] **Step 15 — 实现账号门面与身份状态。**api.ts 按 uni.login→受控 uni-id-co.loginByWeixin→account-co.session 调用；signOut 调受控 uni-id-co.logout，finally 清本机状态。云对象用 customUI 统一处理错误，不启动会自动导航的另一套 uni-id-pages 登录状态；不配置与自有守卫竞争的 uniIdRouter。use-auth.ts 采用 ref/computed、readonly、单次登录/恢复请求共享，不缓存全用户表；AppClient 与 controller 按应用实例注入。
- [ ] **Step 16 — 实现两个页面和生命周期守卫。**SFC 使用 `<script setup lang="ts">`、uni 组件与 rpx 基础样式。login 只有微信登录、进行中/失败/重试状态；onboarding 只在 phase=authenticated 时显示带 data-protected 的引导和退出，不做创建/加入假动作。App.vue 无 template，在 onLaunch/onShow 触发可合并会话检查；页面 onShow 控制安全导航，避免 onLaunch 尚未就绪时跳页。退出用 reLaunch 清页面栈，直接打开及返回页面仍须重新检查；卸载清除自身监听器。
- [ ] **Step 17 — 验证客户端绿灯。**重跑 Step 13，再执行 `task -d miniapp test -- tests/domain/identity.test.ts tests/app/auth.test.ts tests/app/session-boundary.test.ts tests/contracts/uni-id-entry.test.ts`；所有本地业务断言 PASS，不用延迟/重试掩盖不稳定测试。

### 工程门禁、真实验收与审阅

- [ ] **Step 18 — 写类型/秘密/只读门禁失败测试。**template-types.test.ts 让 uni button 的 `:loading="true"` 检查通过，fixture 的 `:loading="123"` 必须产生定位到该行的 number→boolean 类型诊断；排除配置/路径错误，不只断言退出码非零。boundaries.test.ts 增加动态 import/require、值导入 type-only 契约、插件云路径及构建产物检查；密钥 fixture 只用明显合成值，检测失败不把值打印到日志。doctor 在缺 provider/密钥配置状态/证据时返回具体缺口，不能调用 HBuilderX 的 upload/assignspace/initdatabase。
- [ ] **Step 19 — 确认门禁红灯。**运行 `task -d miniapp test -- tests/contracts/template-types.test.ts tests/contracts/boundaries.test.ts`，预期未实现扫描/负向类型检查失败；不以“没有生成物所以跳过”报告通过。
- [ ] **Step 20 — 实现统一 Task 门禁。**Taskfile 的 test 精确转发 `pnpm exec vitest run {{.CLI_ARGS}}`；build:weixin 调模板 build:mp-weixin。check 按顺序执行装配 --check、lint、客户端/云端/测试类型检查、全部测试、微信构建、源及产物边界/密钥扫描；依赖产物的测试在本地临时目录生成最小产物夹具，不依赖尚未执行的 build。check-template-types.mjs 在忽略的 `miniapp/.type-probes/<random-id>/` 中运行正常/错误 SFC 的独立 vue-tsc 配置，继承新工程客户端类型设置并解析其 node_modules；错误 fixture 永不进真实 src。只清理本脚本创建的确切临时目录，不递归删除用户目录。doctor 只读，不把未跑真实验收变成 check 的 mock PASS。
- [ ] **Step 21 — 验证本地完整绿灯并记录。**执行 `task -d miniapp check`、`task -d miniapp doctor`；前者须 PASS，后者在云/真机证据缺失时可以明确 NON-READY。记录版本、实际锁文件、红灯/绿灯命令与输出摘要、生成物清单、dist/build/mp-weixin/ 扫描结果。HBuilderX 本地编译/公共模块和微信真机栏仍为未通过，不用本地 PASS 勾选它们。
- [ ] **Step 22 — 生成测试部署预览并请求单独确认。**deploy-preview.json 列出测试空间、厂商、运行时、每个对象/公共模块/schema、SHA-256、是否存在同名资源及动作；现有资源清单经 HBuilderX 只读核验，无读取权限记为 unknown 并阻断上传。严禁批量全量上传、--force、默认初始化数据库或上传原版完整 uni-id-co。已有同名资源时停止，由用户决定新隔离空间或单独批准更替；本计划不预先授予覆盖权限。
- [ ] **Step 23 — 在获准资源范围内完成 HBuilderX 实测。**由用户安全配置 AppSecret/tokenSecret；验证整个 CLI 项目与唯一云目录识别、TS account-co→home-kernel→home-contracts/uni-id-common 编译/部署/调用及依赖更新。仅使用官方 GUI 或经过本机版本/厂商验证的 HBuilderX CLI，完整记录实际命令，不编造 npm uniCloud CLI；类型或依赖失败即停止，不把本地 tsc 冒充上传。未获部署确认则标记此步骤 blocked，不执行。
- [ ] **Step 24 — 记录云端安全与微信真机结果。**空间关联/配置落地后重跑本地 check，扫描并使用这次构建的微信产物，不拿关联前的旧 dist 当真机版本。验证真实 code 登录、合法域名、退出/过期/无效凭据、直接打开/返回保护页、弱网恢复；用捕获的本次请求 token 验证成功退出后 session 拒绝，账户状态更新后旧 token 拒绝。直调 registerAdmin/login/registerUser/closeAccount/其他未允许方法均拒绝，clientDB 无法直接枚举/改写身份集合；近阈值退出不返回/生成新 token；真实 SDK 迟到 token 场景不能恢复退出状态。只在该测试身份上做可恢复的状态/撤销验证，不修改其他账户。证据不得包含 token、微信 code、AppSecret、openid、用户整行或敏感截图；未执行/无法稳定重现的项保留 blocked，不以替身补绿。
- [ ] **Step 25 — 独立审阅并修复本票。**新审阅子代理读取两份设计、本计划、所有本票差异和脱敏证据，对 Standards/Spec/权限与竞态一起检查；实施子代理修复并重跑相关红绿周期和 check。审阅者不能拿环境已声明存在代替真实结果，不审完就推进 #2。独立审阅无阻塞问题、本地/云端/真机验收全部完成，才可建议结票；否则交付已完成部分与明确缺口。
- [ ] **Step 26 — 条件提交及工单交接。**只有用户另行允许 Git 提交时，按文件清单显式 stage 本票文件（包括生成物、锁文件和许可），不使用 git add .，提交 `feat(miniapp): add WeChat sign-in and onboarding`。不得把缺授权记成失败或擅自提交。只在实际验收完整且符合仓库 tracker 流程时贴脱敏结果并关闭 #1；缺云端/真机证据保持开放，不自动开始 #2。

## 3. 自审覆盖与当前状态

| 批准设计约束 | 本计划落实 |
| --- | --- |
| 独立目录、不迁移/兼容旧后端、无假家庭 API | Global Constraints、文件清单、Step 0/1/16 |
| 官方登录调用链、当前账户/token/撤销检查 | 1.2/1.3、Step 2～6 |
| 最小公开面、只读上游/再现装配、注册钩子 | Step 7～11 |
| SDK 先写 token、退出屏障/下一次登录/冷启动 | Step 12～17 |
| uni-helper、TS 工具链、类型边界、页面真实生命周期 | 0.3、Step 12/16/18～21 |
| 实际物理云根、HBuilderX TS/CLI 与真实验收 | 0.2、Step 22～24 |
| 子代理实施+独立审阅、未授权提交/生产/覆盖 | 0.1、Step 22/25/26 |

自审已逐项核对：五个 Review Focus 均有具名场景；接口在生产与 harness 使用相同名字/字段；步骤没有借用 Task02 的家庭或通用数据库 API；不存在“最新工具默认兼容”“JWT 验签=当前登录”“只有按钮隐藏=云端禁用”的假设。准备、测试和代码步骤仍属于 #1 一个可验收的垂直切片。

**当前状态：用户已于 2026-11-04 确认云端与真机验收完成，#1 关闭；不开始 #2。**本机缺少指定的两项执行技能，已如 §0.1 要求明确报告；用户另行同意由本会话直接编排等价 A 流程（一位新子代理实施，另一位新子代理独立审阅），不安装未知技能、不声称已执行缺失技能。用户同时允许通过 HBuilderX 官方机制安装必要 uniCloud／TS 编译插件，仅用于补齐能力及只读核验，不包含空间关联或上传授权。

已记录工作区基线 `git status --short`（仅 `?? docs/superpowers/`）；通过 GitHub CLI 读回 #1（OPEN，直接阻塞数为 0），验证 `pray4her/mealie` 后认领 `@me`，未更改标签或关闭工单。HBuilderX `5.34.2026102909` 已通过官方 `cli.exe installPlugin --name unicloud` 报告安装成功，插件版本为 `3.0.14-2026102820`。随后用本机支持的只读命令 `cli.exe unicloud service-space list --json true --protocol-version 1 --request-id task01-readonly-space-verified` 读回目标 `{provider: "alipay", spaceId: "env-00jy7289et7b", spaceName: "mealie"}`，据此固定唯一云根 `miniapp/uniCloud-alipay`，不是根据 spaceID 推断。该列表未提供地域和运行时，这两项仍待核验，未执行空间关联。全部产品测试、云端和真机验收仍须由实际命令及脱敏证据分别确认；文中验收要求不代表已经 PASS。未获 Git 提交、云资源上传／覆盖或生产操作授权。

Step 1 首次实际 `pnpm install`（Node 22.23.3 / pnpm 10.20.0，strict peers）退出 1：固定 DCloud `uni-app` 要求 `@dcloudio/types@3.4.31`，与原候选 `3.4.19` 不符；同版 `uni-cli-shared` 固定 Vue 编译器／server-renderer 为 `3.4.21`，后者 peer 精确要求 Vue `3.4.21`，与原候选 `3.4.38` 不符。已遵照停止条件暂停，没有 override、忽略 peer 或修改上游；候选锁文件不代表成功安装。随后用户批准 §0.3 所记录的两项最小修正，已写入 `miniapp/package.json`，尚待重新安装验证。独立审阅者已只读审阅全部 20 个非忽略准备文件并复算来源摘要，未发现准备阶段阻塞缺陷；该结论不代表业务、安全装配或云端验收通过。恢复调用曾因订阅共享用量上限中断，不是产品测试失败。2026-11-04 用户要求继续后，同一实施子代理完成了本地实现检查点。主会话随后独立复跑 `task -d miniapp check`，结果为装配校验、lint、三套类型检查、54 项测试、微信构建及源/产物边界与密钥扫描全部通过；`task -d miniapp doctor` 按预期以 NON-READY 退出，缺口为地域、运行时、现有资源、云端验收、真机验收和秘密配置。首次全量独立审阅因订阅共享用量上限中断且没有产出结论。重新发起后，新审阅者未发现可复现的本地阻塞问题，五个审阅焦点在本地代码和测试中对齐；该结论不代替云端或真机验收。Step 23～24 仍 blocked，#1 保持开放，不开始 #2。2026-11-04 用户另行允许导入整个 `miniapp/` 并关联已有测试空间，不允许上传或初始化数据库。HBuilderX 已导入项目并完成关联；只读清单确认云函数、Schema 和 clientDB action 为 0，但已有同名公共模块 `uni-config-center`、`uni-id-common`、`uni-open-bridge-common`。按计划停止，未覆盖。用户随后要求暂不换空间，并先只读核对这三个模块。核对后用户要求继续，但仍禁止覆盖和数据库初始化。已在不使用 `--force` 的前提下，由 HBuilderX 完成 `home-contracts`、`home-kernel` 的 TypeScript 检查、编译和新增上传；`account-co` 已存在于云端，重试被非强制上传拒绝。三个既有公共模块未被替换，`uni-id-common` 仍为 1.0.19。上传警告给出云端 Node `18.18.2`，地域仍未知。未上传声明了 Redis、短信、实人认证和扩展存储的 `uni-id-co`，未初始化数据库，未提交 Git。随后用户用微信模拟器连接云端调用：`account-co.session` 无 token 时返回 `AUTH_REQUIRED`；未部署的 `uni-id-co` 返回系统码 `50004`。调用网关主机为 `api-hz`，空间检查接口仍未返回地域字段。请求号和供应商正文未入库。登录、退出、真机及结票仍未完成，#1 保持开放。用户随后接受 `uni-id-co` 的扩展开通风险。未使用 `--force` 新增上传了 `uni-captcha`、`uni-cloud-s2s` 和 `uni-id-co`，Schema 仍为空。但上传后的只读回读显示受保护的 `uni-id-common` 已从云端 1.0.19 变为本地 1.0.17，`uni-config-center` 现在包含本地 `uni-id/config.json`。`uni-open-bridge-common` 仍为插件 1.2.1。未执行恢复。用户随后授权初始化数据库并恢复这两个模块。`--force` 只用于这两项。初始化前云端集合为空，已创建 10 个身份集合并上传对应 Schema 和 2 个索引；没有初始数据、Schema 扩展、校验函数或 clientDB action。集合级权限均为拒绝。随后用上传前副本强制恢复：`uni-id-common` 回到 1.0.19，`uni-config-center` 不再包含 `config.json`。`uni-open-bridge-common` 仍为 1.2.1。平台报告更新了依赖这两个模块的云函数；下载的函数树不含 `config.json`。密钥未打印，也未由本会话重新上传。用户随后在对话外配置了云端密钥，并在微信模拟器报告：登录进入已确认身份页，重新进入仍保持；`logout` 返回 0，原 token 再调 `session` 返回 `AUTH_REQUIRED`，再次进入回到登录页。这只证明该次退出及该 token 被拒绝。用户随后报告未登录直调 `registerAdmin`、`login`、`registerUser`、`closeAccount` 均为 `AUTH_REQUIRED`，`uni-id-users` 的 clientDB `get` 和 `add` 为权限拒绝；具体权限码和直达页面未记录。禁用账户、真机及结票仍未完成，#1 保持开放。2026-11-04 开发者工具自动化补测已写入 `miniapp/ops/test-evidence.md`：未登录直接打开引导页会回到登录页；伪造 token 与把唯一测试用户 `status` 改为 1 后的旧 token 均得到 `AUTH_REQUIRED` 且没有 `newToken`，随后已把 `status` 恢复为 0 并确认会话再次成功，再退出并回到登录页。已登录与未登录的 clientDB `update`/`delete` 被拒绝。未导出方法在这次调用里返回 `SYS_ERR`，没有复现早先手工记录的 `AUTH_REQUIRED`。签名有效的过期 token、弱网、合法域名、隐私配置、真实 SDK 迟到 token 和真机仍未执行。doctor 仍为 NON-READY，未写 `acceptance.json`，未提交，未开始 #2。2026-11-04 用户确认剩余云端与真机验收已经完成，并授权据此结票。已写入 `miniapp/ops/acceptance.json`，证据见 `miniapp/ops/test-evidence.md` 末节。关闭 GitHub #1 并移除 `needs-info`。没有开始 #2，也没有授权生产部署。

## 4. 官方依据与技能边界

- Context7 已 resolve/query 核对 uni-app Vue3 生命周期、Vitest 3 独立配置/文件环境、Task CLI_ARGS；uni-typed 没有找到专门匹配的 Context7 库，改查其官方站点和源码，不用相似库冒充。
- [固定官方模板](https://github.com/dcloudio/uni-preset-vue/tree/f747e3b11c51b3bff6c05e2b54f9a3173a590044)、[uni-app CLI](https://uniapp.dcloud.net.cn/quickstart-cli.html)、[项目目录](https://uniapp.dcloud.net.cn/tutorial/project.html)。
- [uni-helper 类型安装与 TS5/6、Bundler、pnpm 约定](https://uni-typed.netlify.app/guide/uni-app-types)、[源码](https://github.com/uni-helper/uni-typed)。技能中旧站地址不能代替当前维护者文档。
- [uni-id-co](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-object.html)、[uni-id-common](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-common.html)、[注册钩子与配置](https://doc.dcloud.net.cn/uniCloud/uni-id/summary.html)、[固定身份源码](https://gitcode.com/dcloud/hello_uni-id-pages/tree/993791b9eb298be8013f22daa9f2efee6c50cc23)、[固定用户 Schema](https://raw.gitcode.com/dcloud/hello_uni-id-pages/raw/993791b9eb298be8013f22daa9f2efee6c50cc23/uni_modules/uni-id-pages/uniCloud/database/uni-id-users.schema.json)。
- [TS 云编译](https://doc.dcloud.net.cn/uniCloud/cf-functions.html#typescript)、[TS 公共模块](https://doc.dcloud.net.cn/uniCloud/cf-common.html#typescript)、[HBuilderX uniCloud CLI](https://hx.dcloud.net.cn/cli/uniCloud)。
- [Vitest 3 配置](https://v3.vitest.dev/config/)、[环境](https://v3.vitest.dev/guide/environment.html)、[Vue Test Utils 2](https://test-utils.vuejs.org/)、[Task 参数](https://taskfile.dev/docs/guide/arguments)。
- 当前工具目录没有 `search-docs-by-Uniapp-official`，本轮采用 Context7 + 官方页面，不安装 MCP。需要该可选检索工具时按 [uni-helper/mcp](https://github.com/uni-helper/mcp) 配置，不把它当成产品运行依赖或开工硬前置。
