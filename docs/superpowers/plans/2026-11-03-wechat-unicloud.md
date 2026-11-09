# 微信家庭菜谱小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从空数据库构建仅依赖 uni-app、uniCloud 和外部 AI 的微信家庭菜谱应用，交付已批准的七类首版功能。

**Architecture:** 新工程隔离于 `miniapp/`。云对象是客户端业务入口，领域模块封装家庭权限、校验和原子业务，数据库与 AI/存储通过窄接口适配；后台定时 worker 负责可恢复的 AI 导入和清理。以端到端功能切片推进，不先交付一套脱离页面的数据库或接口层。

**Tech Stack:** uni-app Vue 3 + TypeScript/Vite，uniCloud TypeScript 云对象及公共模块（HBuilderX >= 5.25），uni-id，私有存储，供应商 AI API，Vitest，Vue Test Utils，Task，pnpm。

**Spec:** `docs/superpowers/specs/2026-11-03-wechat-unicloud-design.md`（2026-11-03 用户批准；执行者须同时阅读设计和计划）。

## Global Constraints

- “从空数据库开始，不迁移旧用户、菜谱、图片及历史记录，不兼容旧 REST API。”
- “最终彻底下线 Python/FastAPI，不保留独立 Python 抓取或解析服务。”
- “一个用户同一时间最多属于一个家庭，不做多家庭切换。”
- “家庭内共享，不做公开社区；成员身份及跨家庭访问在云端校验。”
- “评分为 1～5 星整数，每人每道菜谱一份，可修改或撤销；展示平均分、评分人数和评论列表。”
- “首版不做评论嵌套回复、点赞及举报系统。”
- “新工程放在仓库新增的 `miniapp/` 内，保持旧 `frontend/`、`mealie/`、生成文件和依赖不变。”
- “首版仅微信登录；不采集非必要手机号，不提供密码账户。”
- “家庭角色仅 `owner` 与 `member`，不使用 uni-id 全局 `admin` 代表家庭所有者。”
- “AI 校验成功后自动保存为可编辑菜谱，不要求用户再次确认才能保存”。
- “首版每个导入请求最多生成一道菜谱”；“默认最多初次加两次重试”。
- “基础调度按每分钟运行设计，不承诺秒级开始”；原始输入/响应“最长保留 7 天”。
- “首版默认北京时间”；本地日期以 `YYYY-MM-DD` 表示。
- 不改原有 Crowdin 管理的 locale、自动生成类型、旧 Taskfile 或现有依赖。新应用中文文案集中在自己的 `src/shared/copy.ts`，不借修改旧 locale 实现。
- 用户已确认工单粒度并明确授权发布：19 个 GitHub Issues 和 31 条原生阻塞关系已创建、核对。执行方式仍未选择；开始实现、账户开通、付费、密钥设置、生产部署、Git 提交和旧服务停用均不由工单发布授权涵盖。

## Review Focus

1. 成员退出后重新加入同一家庭的 ABA 情况：旧成员代次创建的任务不得借重新加入恢复授权；Task 04、08 的测试固定此行为。
2. AI 取消、租约过期和旧 worker 完成同时发生：只允许一个终态/一份菜谱，重试仍计入预算；Task 08 固定竞争测试。
3. “适量”、缺份数、小数和不兼容单位混合：不猜数量、不把 mL 转成 g、不重复累计；Task 13 固定计算及并发测试。
4. 上传/内容审核结果迟到且成员已被移除：不得签发新下载链接或绑定外家庭文件；Task 07 固定检查。
5. 注销/家庭解散中途失败且成员已加入别处：只清理原目标与应删除的个人贡献，不误删另一家庭数据；Task 18 固定恢复测试。

---

## 0. 计划使用方式与外部条件

### 范围与拆分

这是一个共享身份与家庭权限的应用，不是若干可独立部署的产品；保留一份总计划，拆为 19 个可分别审阅的垂直切片。每个切片包含它需要的 Schema、业务、云对象、页面和测试。工程搭建/工具配置并入 Task 01，媒体能力并入 Task 07，不设“数据库搭建”“接口开发”等横向票。无需预先重构旧 Mealie。

所有任务本轮都未开始。先批准拆分与执行方式，再逐票执行；完成一票不等于完成整个首版。

### 外部条件不是已完成任务

- H0：部署者提供微信测试 AppID、DCloud AppID、可登录 HBuilderX >= 5.25 和隔离的测试服务空间；不要求将密钥贴进会话。
- H1：对应任务首次触及云能力时，实测并记录运行时、公共模块 TS 上传、事务/条件写、Schema/索引和所选私有存储支持；不从文档推导“测试已通过”。
- H2：Task 08/09/10 需要部署者配置可达的 AI 文本/视觉/指定网页读取服务及允许的费用预算；普通聊天接口不算网页读取能力。
- H3：正式发布需要微信主体/类目/备案/内容安全权限、生产空间和备份目标；这是 Task 19 的人工发布前置。

未具备外部条件时可做不消耗真实资源的本地实现和 fixture 测试，但相关云端验收保持未通过，不能把 mock 成功记成真实成功。不得自动创建付费资源、上传密钥或部署生产。

### 版本、构建与测试约定

- 客户端采用官方 Vue 3 `vite-ts` CLI 模板的目录形态，源码在 `miniapp/src/`，产物在 `miniapp/dist/build/mp-weixin/`；不把微信原生云开发的 `cloudfunctions` 复制插件误当 uniCloud 部署方式。
- `miniapp/uniCloud/` 是项目云目录；Task 01 在 HBuilderX 导入 CLI 项目并验证识别后固定布局。官方插件放在 `miniapp/src/uni_modules/`，保留其云资源和公共模块依赖声明。
- 锁定模板来源 revision、彼此匹配的 DCloud 包版本、本地受支持 Node LTS、pnpm 和云端运行时，写入能力记录；不照抄旧前端版本，不对云运行时作未验证的版本承诺。
- 全新工程的配置和测试工具随 Task 01 创建；本计划不会执行安装。Vitest 使用独立 `vitest.config.ts`，不加载小程序构建插件；领域测试用 Node 环境，Vue 页面测试另设 DOM 环境与 uni 组件/API stubs。
- `task -d miniapp test -- <test paths>` 转发为 `pnpm exec vitest run {{.CLI_ARGS}}`；`check` 包括 lint、客户端/云端本地类型检查、单元/页面测试、客户端构建、边界与密钥扫描。`build:weixin` 调用模板的 `build:mp-weixin`。
- 云对象 TS 编译/公共模块部署另由 HBuilderX 验证；本地 `tsc` 和客户端构建不能替代云端编译。`doctor` 只检查环境、脱敏配置和证据缺口，不擅自开通或上传资源。
- 每票红绿周期使用本地测试；涉及事务/身份/文件的票还须在测试空间通过对应实测案例。云端验收以 HBuilderX 测试空间调用、微信真机结果及脱敏记录为准，不伪造不存在的 headless uniCloud CLI。
- 每票 Step 5 仅在用户另行允许 Git 提交时执行；只 stage 本票列出的文件，不使用 `git add .`，不混入当前用户添加的技能与代理配置。

## 1. 文件结构与接口约定

### 1.1 先固定职责，随所属切片创建

| 路径 | 职责/首次创建任务 |
| --- | --- |
| `miniapp/package.json`, `pnpm-lock.yaml`, `Taskfile.yml`, `.gitignore`, `.env.example`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.cloud.json`, `eslint.config.js` | 独立工具链和忽略规则；Task 01 |
| `miniapp/src/main.ts`, `App.vue`, `pages.json`, `manifest.json` | 应用入口、路由、非秘密 AppID；Task 01 |
| `miniapp/src/shared/copy.ts`, `cloud-client.ts`, `route-guard.ts` | 中文文案、统一云调用/错误/续期、页面身份守卫；Task 01 |
| `miniapp/src/features/<feature>/api.ts`, `use-<feature>.ts` | 功能接口与页面状态；随票创建，不引入全局大 store |
| `miniapp/src/pages/<feature>/<page>.vue` | 可演示页面；随票创建，评论/评分使用领域组件 |
| `miniapp/src/components/Domain/RecipeComments.vue`, `RecipeRating.vue` | 评论/评分；Task 15/16；新增通用组件以 `Base` 开头 |
| `miniapp/uniCloud/cloudfunctions/common/home-contracts/index.ts` 及 `identity.ts`, `family.ts`, `recipes.ts`, `media.ts`, `imports.ts`, `planning.ts`, `shopping.ts`, `feedback.ts`, `lifecycle.ts` | 分功能 wire 类型，逐票扩展；客户端只做 type-only 引入 |
| `miniapp/uniCloud/cloudfunctions/common/home-kernel/index.ts`, `auth.ts`, `database.ts`, `errors.ts`, `clock.ts`, `idempotency.ts`, `content.ts` | 窄平台适配、鉴权/事务/时钟/审核端口；由使用它的任务逐步创建 |
| `miniapp/uniCloud/cloudfunctions/common/home-<feature>/index.ts` 及该票列出的职责文件 | 功能业务模块；不跨文件复制身份/家庭检查 |
| `miniapp/uniCloud/cloudfunctions/<feature>-co/index.obj.ts` | 薄云对象入口，token 与可信调用上下文从平台取得 |
| `miniapp/uniCloud/cloudfunctions/import-worker/index.obj.ts`, `maintenance-worker/index.obj.ts` | 私有 `_timing` 入口，禁止导出客户端可调用的执行方法；Task 08/18 |
| `miniapp/uniCloud/database/<collection>.schema.json`, `<collection>.index.json` | 集合级 clientDB 默认拒绝、数据声明和经验证的索引格式；随票创建 |
| `miniapp/tests/support/harness.ts`, `fixtures.ts`, `uni-stubs.ts` | 同一业务模块的内存适配测试夹具及页面 stubs；Task 01 起扩展 |
| `miniapp/tests/domain/`, `tests/app/`, `tests/contracts/`, `tests/fixtures/` | 领域/页面/供应商契约测试；不默认调用付费 AI |
| `miniapp/scripts/doctor.mjs`, `check-boundaries.mjs`, `check-secrets.mjs` | 环境与工程隔离检查；Task 01 |
| `miniapp/ops/capabilities.md`, `test-evidence.md`, `release.md`, `restore.md` | 脱敏实测记录与运行手册；不存真实 token/密钥 |

每个新公共模块和云对象均创建自己的 `package.json`，显式声明公共模块依赖；Task 01 检查 HBuilderX 支持的打包方式。云对象不得引用部署包外的相对源码。`home-contracts` 的客户端导入必须被类型擦除；不能把云配置、Node 实现或密钥打入小程序。

### 1.2 所有任务遵循的接口

以下类型从首次需要的任务创建，不提前生成全部空模块：

- `Id = string`；`Mutation = { requestId: string }`；`VersionedMutation = Mutation & { expectedVersion: number }`；时间点为 UTC 毫秒，本地用餐日独立为日期字符串。
- `Identity = { uid: Id; refreshedToken?: { token: string; tokenExpired: number } }`。
- `FamilyContext = { uid: Id; familyId: Id; role: 'owner' | 'member'; generation: Id }`；`generation` 每次加入随机重建，成员槽以 UID 唯一，防退出重入的旧授权复活。
- 领域函数成功返回业务 DTO，失败抛 `AppError`；云对象转换为 `{ errCode: 0, data: T, newToken? }` 或 uniCloud 错误，客户端 `invoke<T>(object, method, input): Promise<T>` 统一解包，不在各页面各写一套 token 逻辑。
- 错误最少覆盖 `AUTH_REQUIRED`, `FAMILY_REQUIRED`, `ALREADY_IN_FAMILY`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_INPUT`, `QUOTA_EXCEEDED`, `SOURCE_UNREADABLE`, `PROVIDER_UNAVAILABLE`。跨家庭资源统一 `NOT_FOUND`。
- `requireIdentity(token, clientInfo): Promise<Identity>`；`requireFamily(identity): Promise<FamilyContext>`；每次请求重新读取成员槽和家庭状态。
- `DatabasePort.transaction<T>(fn: (tx: TransactionPort) => Promise<T>): Promise<T>`；`tx.get<T>(collection, id)`, `tx.insert<T>(collection, id, value)`, `tx.replace<T>(collection, id, value)`, `tx.remove(collection, id)`。外部查询封装有界 family-scoped query；事务只逐文档操作，显式提交/回滚与有限冲突重试。
- `guardMutation(tx, ctx): Promise<void>` 在事务内重新验证家庭与成员 generation，并写成员操作序号作为冲突栅栏；移除/转移与业务写不能绕过同一栅栏。AI 网络调用在事务外。
- `ContentPort.checkText(text: string): Promise<'allowed' | 'rejected'>`，图片审核通过媒体票扩展；拒绝/审核服务不可用不发布未经审核内容。测试 fixture 不能用于生产绕过审核。
- `createHarness(options?: { now?: number; ai?: AiPort; storage?: StoragePort }): Harness` 提供 `client(uid): AppClient`, `advance(ms): void`, `rows<T>(collection): Promise<T[]>` 和可信 seed 方法；Task 01 仅有 `now`，`storage`/`ai` 分别在 07/08 引入其类型时扩展。`AppClient` 随票扩展精确接口，不使用 `any`。内存端口与真实云端端口运行同一领域函数，不在测试里重新实现业务。
- `familyFixture(): Promise<{ h: Harness; owner: AppClient; member: AppClient; outsider: AppClient; familyId: Id }>`（Task 02 以可信 seed 建立，Task 03 增加真实邀请流程场景）；`recipeFixture(): Promise<上述字段 & { recipe: Recipe }>`（Task 05）；每票测试中按其依赖初始化，不能引用尚未完成的后继功能。

内部新增 `mutation_receipts`、`quota_buckets`、`maintenance_jobs` 用于持久化幂等、配额和清理，不新增用户功能。所有请求标识按用户/家庭/操作限定，重用同一 requestId 却改变 payload 返回冲突，不跨用户命中别人回执。

幂等回执只存 payload 摘要和安全业务结果，不复制原始 AI 输入/响应、邀请明文、上传签名或注销查询 token。邀请和操作查询凭据采用服务端独立密钥、用途域和随机记录 ID 派生的高熵 capability，只存摘要；需要重放响应时重新派生，密钥版本在凭据有效期内保留。上传凭据只在重新检查成员、用途和 pending 状态后重签，不回放已失效授权。任何回执查询前仍做当前身份/权限校验，注销后的查询例外仅限其独立 capability。

### 1.3 DTO、端口和测试夹具的补充决策

这些是计划锁定的接口，不是待执行的代码。各类型在所属任务的 contracts 文件定义并从 `home-contracts/index.ts` 导出；不另建未被任务使用的大类型层。

| 类型/端口 | 必需形状或行为 | 所属任务 |
| --- | --- | --- |
| `AppClient` | 对象属性为 `account`、`family`、`recipes`、`media`、`imports`、`planning`、`shopping`、`feedback`、`lifecycle`，各为对应 `*Api`；随任务实现，无全局假成功方法 | 01 起 |
| `Page<T>` | `{items:T[];nextCursor:string|null}` | 05 |
| `MemberView` | `{uid:Id;nickname:string;role:'owner'|'member'}`，不带邮箱/openid/token | 03 |
| `Recipe` | `RecipeInput & {id:Id;familyId:Id;createdBy:Id|null;version:number;imageIds:Id[];source:{kind:'manual'|'text'|'image'|'url';url:string|null;importJobId:Id|null;warnings:string[]}}` | 05；初期 imageIds 为空 |
| `UploadGrant` / `FileStat` | `{mediaId:Id;expiresAt:number;upload:{url:string;headers:Record<string,string>;fields:Record<string,string>}}` / `{bytes:number;mime:string;exists:boolean}`；上传以 `uni.uploadFile` 可消费的受限 POST 表单适配 | 07 |
| `MediaView` | `{id:Id;purpose:'recipe-image'|'import-input';state:'pending'|'ready'|'deleting';bytes:number;mime:string}`，不返回供应商桶配置 | 07 |
| `AiUsage` | `{inputTokens:number|null;outputTokens:number|null;amountMicros:number|null;currency:string|null;estimated:boolean}`；未知计量为 null，不伪造精确费用 | 08 |
| `JobView` | `{id:Id;state:'queued'|'running'|'succeeded'|'failed'|'cancelled';recipeId:Id|null;error:{code:string;message:string}|null;attempts:number}` | 08 |
| `BatchResult` | `{claimed:number;succeeded:number;failed:number;deferred:number}` | 08 |
| `ProviderImage` | `{url:string;mime:string}`；临时地址仅发送供应商，不写入公开任务 DTO | 09 |
| `ValidatedSource` | `{url:string;hostname:string;validatedAt:number}`，每次跳转/实际读取仍检查，不能复用旧 DNS 结果声称安全 | 10 |
| `PlanEntry` | `{id:Id;familyId:Id;date:string;meal:MealType;recipeId:Id;recipeTitle:string;targetServings:number|null;sourceUnavailable:boolean;version:number}` | 11 |
| `ShoppingList` / `ShoppingItem` | `{id:Id;name:string;state:'active'|'archived';version:number}` / `{id:Id;listId:Id;raw:string;quantity:number|null;unit:string|null;checked:boolean;version:number;sources:ContributionSnapshot[]}` | 12 |
| `ContributionSnapshot` | `{operationId:Id;recipeId:Id|null;recipeTitle:string|null;quantity:number|null;unit:string|null}`；数量的精确内部表示由计算模块决定，wire 输出有界十进制 | 12～13 |
| `ScaledIngredient` | `Ingredient & {warnings:string[]}` | 13 |
| `AdditionView` | `{id:Id;state:'pending'|'running'|'succeeded'|'failed';completedContributions:number;totalContributions:number;warnings:string[]}` | 13 |
| `CommentView` | `{id:Id;recipeId:Id;authorLabel:string;mine:boolean;text:string;version:number;createdAt:number}` | 15 |
| `MaintenanceView` | `{id:Id;state:'pending'|'running'|'succeeded'|'failed';errorCode:string|null}`，不暴露已注销资料 | 18 |
| `OperationReceipt` | `{operationId:Id;receiptToken:string;expiresAt:number}`；token 仅允许查询该次操作，摘要保存，有效期 24 小时 | 18 |

`tx.get<T>` 返回 `Promise<T|null>`；`insert/replace/remove` 返回 `Promise<void>`。`StoragePort.issueUpload(input:{mediaId:Id;key:string;mime:string;maxBytes:number;expiresInSeconds:number}): Promise<UploadGrant>`；其他 storage 方法如 Task 07。选型时若供应商不支持这一受限表单，不让页面适配任意供应商秘密：报告能力限制或在 storage 适配器内转换为同一契约。

Task 05 锁定 `RecipeInput` 还包括 `prepMinutes:number|null`、`cookMinutes:number|null`，已知份数/数量必须大于 0、已知时间不得为负。最小菜谱为非空标题、至少一条有名称的食材和至少一个非空步骤；说明、数量、单位、份数和时间均可空。Task 07 使用单独的 `RecipesApi.bindImages(input:VersionedMutation & {id:Id;imageIds:Id[]}): Promise<Recipe>`，避免文字编辑覆盖媒体授权状态。

测试夹具中的可信 seed 只向内存端口写记录，用于不依赖其他功能页面的隔离测试；不能导出为生产云对象、不能伪造真实云端证据。`h.client(uid)` 仅对已 seed 的身份模拟有效 token，未知用户（如 `'forged'`）模拟无效凭据，不能把任意 UID 自动当已登录。页面测试通过 `mountPage(component, {client})` 注入同一 `AppClient`；该 helper 在 Task 01 的 `tests/support/uni-stubs.ts` 定义。测试场景中的 owner/member/outsider、recipe、job、list 均由该票测试本地 arrange 或其已声明依赖的 fixture 创建，后文断言片段仅省略这些安排代码，不是要求复制未定义变量。

请求节流从 Task 01 的调用边界起执行，Task 02 增加持久化家庭/用户限流桶 `request_limits`；AI 的费用/次数限额另归 Task 08。具体阈值进非秘密配置，重试不能绕过同一限额。

领域模块由 `createFamilyService(deps, identity): FamilyApi`、`createRecipesService(deps, ctx): RecipesApi` 等对应工厂构造，`ctx` 为可信 `FamilyContext`，`identity` 为已验证 `Identity`。`deps` 的领域类型只包含该功能实际需要的 `DatabasePort`、时钟、审核及其后引入的 AI/存储端口；不把 `uniCloud` 全局对象或可控客户端上下文当依赖传入。云对象和内存 harness 均调用这些同名工厂。Task 08 另定义 `createImportRunner(deps): {runBatch(now:number): Promise<BatchResult>}`，Task 18 定义 `createMaintenanceRunner(deps): {runMaintenance(now:number): Promise<BatchResult>}`，不把后台方法混入客户端 API。

## 2. 依赖与工单映射

任务编号沿用原草案编号，真实 GitHub issue 链接见发布记录；本次恰好对应 #1～#19，不应在其他发布中依赖编号相同。仅列直接依赖，闭包由依赖图推导。

| 任务 | 直接阻塞 | 独立完成时可演示的行为 |
| --- | --- | --- |
| 01 | 无 | 微信登录后看到未加入家庭引导，退出登录受保护页面不可用 |
| 02 | 01 | 用户创建唯一家庭，重复创建不产生第二家庭 |
| 03 | 02 | 所有者邀请第二成员，邀请码安全消费与撤销 |
| 04 | 03 | 成员退出/移除，所有权转移后权限立即更新 |
| 05 | 02 | 家庭成员创建、查看和共同编辑文字菜谱 |
| 06 | 05 | 家庭内搜索、分页和个人收藏 |
| 07 | 05 | 私有菜谱图片上传/预览，未授权无法绑定或取链接 |
| 08 | 05 | AI 文本导入可恢复任务、限额、取消和自动保存 |
| 09 | 07、08 | 上传截图/照片后 AI 识别并保存菜谱 |
| 10 | 08 | AI 读取公开网址导入，失败可改用粘贴正文 |
| 11 | 05 | 按北京时间日期和餐次安排多道菜、目标份数 |
| 12 | 02 | 多张家庭购物清单、手动条目及多人共享勾选 |
| 13 | 05、12 | 菜谱按份数加入清单，单位合并和幂等恢复 |
| 14 | 11、13 | 日期/餐次计划显式加购，不自动联动既有清单 |
| 15 | 05 | 家庭内纯文本评论及作者/所有者管理 |
| 16 | 05 | 1～5 星唯一评分、修改撤销与可信聚合 |
| 17 | 06、07、08、11、13、15、16 | 安全删除菜谱，恢复清理且保留计划/购物快照 |
| 18 | 04、17 | 注销账户/解散家庭，清理可恢复且不误删他家数据 |
| 19 | 09、10、14、18 | 在独立空间恢复全应用，并完成真机与发布门禁 |

01、02 是启动主线；随后 03、05、12 可以并行，05 后的搜索、图片、AI、计划、评论、评分没有人为串行依赖。共同修改少量基础文件时协调合并，不把“可能改同一文件”写成业务阻塞边。

## 3. 垂直切片任务

### Task 01: 微信登录与未加入家庭引导

**当前执行入口：**#1 已由用户于 2026-11-04 确认验收并关闭。详细记录以 `docs/superpowers/plans/2026-11-03-wechat-unicloud-task01.md` 和 `miniapp/ops/test-evidence.md` 为准。下文保留原始切片摘要。该补充同时修正本票的逻辑 `uniCloud/` 为实际厂商物理云根，并补齐官方身份对象最小部署面，不影响其他票的业务范围。不开始 #2。

**Files:** Create `miniapp/` 工具链及入口（第 1.1 节第一、二行完整文件）；Create `miniapp/src/shared/{copy,cloud-client,route-guard}.ts`, `src/features/auth/{api,use-auth}.ts`, `src/pages/account/login.vue`, `src/pages/family/onboarding.vue`；Create `miniapp/uniCloud/cloudfunctions/account-co/{index.obj.ts,package.json}`, `common/home-contracts/{index,identity}.ts`, `common/home-kernel/{index,auth,errors,clock}.ts` 及各公共模块 `package.json`；Create 第 1.1 节 support/scripts/capabilities 文件；导入官方 `uni-id-pages` 及配套云资源，不手改其内部生成文件。

**Test:** `miniapp/tests/domain/identity.test.ts`, `tests/app/auth.test.ts`, `tests/contracts/boundaries.test.ts`。

**Interfaces:** Consumes 平台 uni-id 登录/token 校验；Produces `AccountApi.signInWeixin(): Promise<Identity>`, `session(): Promise<Identity>`, `signOut(): Promise<void>`、统一 `invoke<T>`、`requireIdentity` 和基础 `Harness`。不在 session 中回传供应商/云配置；本票只显示尚无家庭业务的引导，Task 02 才接入真实家庭查询，不能预置永远返回 null 的假 API。

- [ ] **Step 0 — 建立测试基线：**只建立本票所需的官方模板目录、锁定依赖和独立 Vitest/Vue 测试配置；不实现账号业务，不以占位测试返回 PASS。依赖安装属于将来获准执行后的本票动作，不在本轮运行。
- [ ] **Step 1 — 写失败测试：**`rejects_missing_or_forged_token`、`returns_only_identity`、`redirects_on_expired_login`、`does_not_bundle_cloud_code`；断言 `await expect(h.client('forged').account.session()).rejects.toMatchObject({code:'AUTH_REQUIRED'})`，页面退出后不能停留受保护内容。测试文件先于账号业务实现。
- [ ] **Step 2 — 确认红灯：**运行 `task -d miniapp test -- tests/domain/identity.test.ts tests/app/auth.test.ts tests/contracts/boundaries.test.ts`；预期因未实现 session/守卫失败，而不是网络、语法或无法安装依赖。
- [ ] **Step 3 — 最小实现：**封装当前 uni-id-co 微信登录、平台上下文 token 校验及刷新回传；关闭密码/注册管理员等非首版入口；引导页不提供业务数据。加入 `Taskfile` 的 `test/check/build:weixin/doctor` 和边界/密钥扫描；不自动注入假用户。
- [ ] **Step 4 — 验证绿灯：**同一命令 PASS，`task -d miniapp check` 通过；在 H0 的测试项目完成真实微信登录与 TS 公共模块部署，记录版本及测试空间，缺账号则保留该验收未完成。
- [ ] **Step 5 — 提交边界：**获准后只 stage 本票新文件，提交 `feat(miniapp): add WeChat sign-in and onboarding`。

### Task 02: 创建唯一家庭

**Files:** Create `miniapp/uniCloud/cloudfunctions/family-co/{index.obj.ts,package.json}`, `common/home-family/{index,create,repository}.ts`, `common/home-contracts/family.ts`, `common/home-kernel/{database,idempotency}.ts`；Create `database/{families,family_members,mutation_receipts,request_limits}.schema.json` 及对应 `.index.json`；Create `miniapp/src/features/family/{api,use-family}.ts`, `src/pages/family/home.vue`；Modify onboarding、路由守卫及测试 fixtures。

**Test:** `miniapp/tests/domain/family-create.test.ts`, `tests/app/family-create.test.ts`。

**Interfaces:** Consumes Task 01 identity；Produces `FamilyApi.current(): Promise<FamilyContext|null>`, `create(input: Mutation & {name:string}): Promise<FamilyContext>`，`requireFamily`、`guardMutation` 与数据库事务端口。`current()` 可返回 null，不能生成默认共享家庭。

- [ ] **Step 1 — 写失败测试：**`creates_one_owner_and_one_slot`、`concurrent_creates_allow_only_one_family`、`same_request_replays_original_result`；断言成功创建后 `expect((await h.rows('family_members')).length).toBe(1)`，不同 payload 重用 requestId 返回 `CONFLICT`，并发失败不留下孤儿家庭。
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/family-create.test.ts tests/app/family-create.test.ts`，预期缺 create/事务保护而失败。
- [ ] **Step 3 — 最小实现：**逐文档事务创建 family、UID 成员槽和回执；生成成员 generation。客户端创建后进入家庭页；家庭 ID/owner UID 全由云端确定。Schema 对 clientDB 全拒绝。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间并发两次创建/事务回滚/唯一槽实测通过，记录不能批量事务写的厂商差异；公共 check 通过。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): create a single household per user`，仅包含本票及本票扩展的 kernel/fixtures。

### Task 03: 邀请成员加入家庭

**收束（2026-11-09）：**实现已包含于 `a3482ed24`（miniapp-dev），按用户指定的相关及其他验收均已完成前提接受交付、关闭 [#3](https://github.com/pray4her/mealie/issues/3)。最终依据和本地复核见 `miniapp/ops/task03-closeout.md`；以下保留原计划步骤，不将历史预期或未附原始证据的场景改写成本轮实测。Task04 尚未启动。

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-family/invitations.ts`, `database/family_invitations.{schema,index}.json`；Create `miniapp/src/pages/family/{invite,join,members}.vue`；Modify family-co、family contracts/API、`home-family/index.ts`、fixtures 和 pages 配置。

**Test:** `miniapp/tests/domain/family-invitations.test.ts`, `tests/app/family-invitations.test.ts`。

**Interfaces:** Consumes Task 02；Produces `FamilyApi.invite(input: Mutation): Promise<{invitationId:Id;token:string;expiresAt:number}>`, `revokeInvite(input: Mutation & {invitationId:Id}): Promise<void>`, `join(input: Mutation & {token:string}): Promise<FamilyContext>`, `members(): Promise<MemberView[]>`；完善 `familyFixture()`。

- [ ] **Step 1 — 写失败测试：**`expires_after_24_hours`、`single_use_even_under_race`、`rejects_member_inviting`、`does_not_log_or_store_raw_token`；`h.advance(24*60*60*1000)` 后 join 拒绝；两个用户并发 join 只一人成功，已有家庭用户拒绝。
  ```ts
  expect(invitation.expiresAt - issuedAt).toBe(24 * 60 * 60 * 1000);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  await expect(member.family.invite({requestId:'denied'})).rejects.toMatchObject({code:'FORBIDDEN'});
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/family-invitations.test.ts tests/app/family-invitations.test.ts`，预期邀请消费/到期检查未实现。
- [ ] **Step 3 — 最小实现：**高熵单次凭据只存摘要，事务消费邀请与成员唯一槽；重复成功请求按回执返回，不重复消费。UI 展示一次性邀请入口/到期状态，token 不进日志或统计。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；第二微信用户实际加入，普通成员/第三家庭不能枚举邀请码或成员信息；测试空间确认竞争消费。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): invite members into a household`。

### Task 04: 退出、移除成员与转移所有权

**收束（2026-11-09）：**本票实现和四项隔离资源部署已交付；用户明确确认云端业务、并发及真机验收完成，并要求关闭 [#4](https://github.com/pray4her/mealie/issues/4)、收束文档及提交推送。最终依据见 `miniapp/ops/task04-closeout.md`，实际执行方案见 `2026-11-09-wechat-unicloud-task04.md`。#3 小节中“Task04 尚未启动”为当时的历史记录。

**Files:** 新增 home-family/membership-actions、客户端成员操作控制器及持久意图；复用既有成员页，不新增 settings 页。更新 contracts/API/云对象、回执 Schema、权限失效处理、测试与 Task04 独立部署/验收记录。

**Test:** `miniapp/tests/domain/family-membership.test.ts`, `tests/app/family-membership.test.ts`。

**Interfaces:** `MembershipMutation = Mutation & {familyId:Id;generation:Id}`；`MemberMutation = MembershipMutation & {uid:Id;targetGeneration:Id}`。`FamilyApi.leave(MembershipMutation):Promise<void>`、`removeMember(MemberMutation):Promise<void>`、`transferOwner(MemberMutation):Promise<FamilyContext>`；转移返回发起者新的 member 上下文，MemberView 增加 generation。退出删除成员槽，重入生成新代次。解散/注销仍属 Task18。

- [x] **Step 1 — 写失败测试：**所有者退出限制、旧 token 权限、原子转移、重入新代次、并发与回执恢复测试先失败再实现。
- [x] **Step 2 — 确认红灯：**领域、API/控制器、真实 SFC 和 Task04 门禁均记录 RED→GREEN；独立审阅的四项 SFC 回归亦先失败再修复。
- [x] **Step 3 — 最小实现：**成员与 owner 原子事务、共用写栅栏、代次前置条件、完整原请求恢复和客户端权限失效处理已完成；家庭历史数据保留。
- [x] **Step 4 — 验证绿灯：**本地完整检查通过；云端业务、并发及真机由用户明确确认验收完成，原始独立证据与最终确认分开记录。
- [x] **Step 5 — 提交边界：**用户明确授权本票全部实现和收束文档，以 `feat(miniapp): 实现家庭成员退出与所有权管理 (#4)` 交付至 upstream/miniapp-dev。

### Task 05: 创建、查看和共同编辑文字菜谱

**Files:** Create `miniapp/uniCloud/cloudfunctions/recipes-co/{index.obj.ts,package.json}`, `common/home-recipes/{index,recipes,repository,validation}.ts`, `common/home-contracts/recipes.ts`, `common/home-kernel/content.ts`, `database/recipes.{schema,index}.json`；Create `miniapp/src/features/recipes/{api,use-recipes}.ts`, `src/pages/recipes/{index,detail,edit}.vue`；Modify fixtures/导航/文案。

**Test:** `miniapp/tests/domain/recipes.test.ts`, `tests/app/recipes.test.ts`。

**Interfaces:** Produces `RecipeInput = {title:string;description:string|null;baseServings:number|null;prepMinutes:number|null;cookMinutes:number|null;ingredients:Ingredient[];steps:string[];tags:string[]}`，`Ingredient = {raw:string;name:string;quantity:number|null;unit:string|null;note:string|null}`；`Recipe` 和 `Page<T>` 如第 1.3 节；`RecipesApi.create(input: Mutation & {recipe:RecipeInput}): Promise<Recipe>`, `get(id:Id): Promise<Recipe>`, `list(input:{cursor?:string;limit?:number}): Promise<Page<Recipe>>`, `update(input: VersionedMutation & {id:Id;recipe:RecipeInput}): Promise<Recipe>`。本票含基础列表，Task 06 扩展筛选，媒体绑定 Task 07，删除 Task 17。

- [ ] **Step 1 — 写失败测试：**`rejects_foreign_family_resource`、`preserves_unknown_quantity`、`rejects_stale_edit`、`does_not_allow_client_to_change_owner_or_family`；未知数量断言 `quantity === null`；两个 version=1 编辑仅首个成功；审核拒绝/故障不保存。
  ```ts
  await expect(outsider.recipes.get(recipe.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(recipe.ingredients[0].quantity).toBeNull();
  await expect(staleEdit).rejects.toMatchObject({code:'CONFLICT'});
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/recipes.test.ts tests/app/recipes.test.ts`，预期缺菜谱持久化/页面动作。
- [ ] **Step 3 — 最小实现：**单家庭条件查询与字段白名单、版本更新、回执、受限 steps/ingredients/文本；接入 `ContentPort`，cloud 配置未就绪时不使用 production allow-all。slug 从规范标题和稳定 ID 生成，数据库约束兜底。页面可保存、读取、编辑并展示冲突。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；两家庭实测越权拒绝，同家庭第二成员可编辑；没有媒体/AI 也可完成本票演示。内容安全实测结果与模板未开通状态分开记录。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): manage shared household recipes`。

### Task 06: 搜索、分页与个人收藏

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-recipes/{search,favorites}.ts`, `database/recipe_favorites.{schema,index}.json`, `miniapp/src/pages/recipes/favorites.vue`；Modify recipes contracts/API/云对象、列表页/详情页。

**Test:** `miniapp/tests/domain/recipe-discovery.test.ts`, `tests/app/recipe-discovery.test.ts`。

**Interfaces:** Consumes Task 05 的 `Page<T>`；扩展 `RecipesApi.list(input:{query?:string;tag?:string;cursor?:string;limit?:number;favoritesOnly?:boolean}): Promise<Page<Recipe>>`, `favorite(input: Mutation & {id:Id;enabled:boolean}): Promise<void>`；cursor 与 family/query 绑定，不能跨过滤器复用。

- [ ] **Step 1 — 写失败测试：**`searches_only_current_family`、`pages_without_duplicate_titles`、`favorites_are_private_and_idempotent`；同名不同 ID 跨页不漏/不重复；另一用户不能查看本人收藏关系，query 长度和页大小越界拒绝。
  ```ts
  expect(new Set(allPages.map(recipe => recipe.id)).size).toBe(allPages.length);
  expect((await member.recipes.list({favoritesOnly:true})).items).toHaveLength(0);
  expect((await owner.recipes.list({favoritesOnly:true})).items).toHaveLength(1);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/recipe-discovery.test.ts tests/app/recipe-discovery.test.ts`，预期无搜索/收藏状态。
- [ ] **Step 3 — 最小实现：**有界标题/标签查询、稳定 ID tie-breaker 游标、收藏确定性主键；不承诺全库模糊中文搜索，不用客户端过滤实现隔离。UI 支持搜索、加载下一页、收藏视图。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间索引/分页扫描有界，第二成员看不到本人收藏但可见共享菜谱。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): search and favorite household recipes`。

### Task 07: 私有图片上传与预览

**Files:** Create `miniapp/uniCloud/cloudfunctions/media-co/{index.obj.ts,package.json}`, `common/home-media/{index,media,storage,moderation}.ts`, `common/home-contracts/media.ts`, `database/media_files.{schema,index}.json`；Create `miniapp/src/features/media/api.ts`, `src/components/Domain/RecipeImagePicker.vue`；Modify recipes 输入/绑定逻辑/编辑详情页。

**Test:** `miniapp/tests/domain/media.test.ts`, `tests/app/media.test.ts`, `tests/contracts/private-storage.test.ts`。

**Interfaces:** `StoragePort.issueUpload(input): Promise<UploadGrant>` 的 input 如第 1.3 节；`stat(fileId:Id): Promise<FileStat>`, `signRead(fileId:Id,ttlSeconds:number): Promise<string>`, `delete(fileId:Id): Promise<void>`；`MediaApi.requestUpload(input: Mutation & {purpose:'recipe-image'|'import-input';mime:string;bytes:number}): Promise<UploadGrant>`, `complete(input: Mutation & {mediaId:Id}): Promise<MediaView>`, `read(mediaId:Id): Promise<{url:string;expiresAt:number}>`；`RecipesApi.bindImages` 将已有空 imageIds 安全绑定，输入素材仅发起者/worker 可读。

- [ ] **Step 1 — 写失败测试：**`rejects_external_file_binding`、`checks_actual_mime_and_size`、`late_moderation_cannot_publish_after_removal`；撤销成员再完成上传必须失败；本地断言 `await expect(outsider.media.read(mediaId)).rejects.toMatchObject({code:'NOT_FOUND'})`，真正匿名 HTTP 与签名到期行为留在 Step 4 的私有存储实测，不让默认单元测试访问真实桶。
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/media.test.ts tests/app/media.test.ts tests/contracts/private-storage.test.ts`，预期无受控上传/授权；本地契约测试只断言调用授权端口，不假装证明真实存储 ACL。
- [ ] **Step 3 — 最小实现：**临时上传→验证元数据/内容安全→可绑定状态，派发短签名 URL；原始材料不共享。云能力记录明确私有 ACL 与过期策略；若内置不满足则适配私有扩展存储，不改成公共桶。未关联文件记为可清理。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；真机上传/预览成功，匿名请求、跨家庭绑定、过期链接和迟到审核实测拒绝；已签发链接短期有效的边界如实记录。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): protect household recipe images`。

### Task 08: 可恢复的 AI 文本导入

**Files:** Create `miniapp/uniCloud/cloudfunctions/imports-co/{index.obj.ts,package.json}`, `import-worker/{index.obj.ts,package.json}`, `common/home-imports/{index,jobs,runner,validation,provider,quota}.ts`, `common/home-contracts/imports.ts`, `database/{import_jobs,quota_buckets,ai_usage}.{schema,index}.json`；Create `miniapp/src/features/imports/{api,use-imports}.ts`, `src/pages/imports/{create,status}.vue`, `miniapp/tests/fixtures/ai-text.json`；Modify recipes 内部创建入口及能力记录。

**Interfaces:** Consumes Task 05 的菜谱验证/保存与 kernel；Produces `ImportInput = {kind:'text';text:string} | {kind:'image';mediaIds:Id[]} | {kind:'url';url:string}`（后两种初期明确不可用，不能伪装成功）；`RecipeImportResult = {schemaVersion:1;recipe:RecipeInput;warnings:string[];source:{kind:ImportInput['kind'];verifiedRead:boolean}}`；`AiPort.parse(input, options:{attemptId:Id;timeoutMs:number}): Promise<{result:unknown;usage:AiUsage}>`；`ImportsApi.submit(input: Mutation & {source:ImportInput}): Promise<JobView>`, `get(id:Id): Promise<JobView>`, `cancel(input: Mutation & {id:Id}): Promise<JobView>`；`runBatch(now:number): Promise<BatchResult>` 仅内部使用。`JobView` 含 id/state/recipeId?/error?/attempts，不包含供应商响应或秘密。

**Test:** `miniapp/tests/domain/import-jobs.test.ts`, `tests/domain/import-races.test.ts`, `tests/app/imports.test.ts`, `tests/contracts/ai-text.test.ts`。

- [ ] **Step 1 — 写失败测试：**`auto_saves_one_valid_recipe`、`rejects_invalid_or_truncated_json`、`quota_reservation_is_atomic`；断言同 requestId 返回同 jobId，重跑 worker 后菜谱总数仍 1。Review Focus：`cancel_wins_against_old_lease`、`expired_lease_cannot_finalize`、`rejoin_does_not_revive_old_generation`；终态仅一个，旧 worker 不覆盖。
  ```ts
  expect(replayed.id).toBe(job.id);
  expect(await h.rows('recipes')).toHaveLength(1);
  expect((await owner.imports.get(cancelled.id)).state).toBe('cancelled');
  expect((await owner.imports.get(failed.id)).attempts).toBe(3);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/import-jobs.test.ts tests/domain/import-races.test.ts tests/app/imports.test.ts tests/contracts/ai-text.test.ts`，预期任务/配额/保存尚未实现；fixture 不访问真实 AI。
- [ ] **Step 3 — 最小实现：**提交只写任务/预留配额；`_timing` 只调用内置 runner，不导出公共 run。按分钟领取租约，事务外请求供应商、回到事务核对 generation/租约/取消/预算后保存确定性菜谱 ID。最多 3 次尝试，网络/429/可恢复 5xx 退避，内容错误终止；用量按尝试计量，全局关闭仅停止 AI。完成前执行菜谱校验/审核。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间执行真实文本解析并自动保存可编辑菜谱，停止页面后任务继续，旧租约不能保存。记录供应商/模型/结构化能力与脱敏费用；未授权费用不调用。状态页轮询隐藏/卸载时停止，重进可查询恢复。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): import recipes through durable AI jobs`。

### Task 09: AI 图片导入

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-imports/images.ts`, `miniapp/tests/contracts/ai-image.test.ts`, `tests/fixtures/ai-image.json`；Modify provider、media 内部读取接口、imports 页面/API/输入校验。

**Interfaces:** Consumes Task 07、08；Produces `resolveImportImages(ctx:FamilyContext,mediaIds:Id[]): Promise<ProviderImage[]>`、`AiPort.parse` 对 image 分支的真实支持；URL 只由存储适配器签发，`ProviderImage` 不包含桶密钥。

- [ ] **Step 1 — 写失败测试：**`extracts_image_recipe_without_inventing_quantities`、`cannot_import_other_users_raw_media`、`expired_media_url_fails_safely`；原文“适量”解析后仍 `quantity:null`，跨家庭/其他成员的原始输入均拒绝。
  ```ts
  expect(saved.ingredients[0]).toMatchObject({raw:'盐适量',quantity:null});
  await expect(member.media.read(ownersInputId)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(expiredResult.state).toBe('failed');
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/contracts/ai-image.test.ts tests/app/imports.test.ts`，预期 image 输入尚未支持。
- [ ] **Step 3 — 最小实现：**按供应商真实多模态字段适配，不假设改 model 名即可；受限素材读取和输入上限，任务最终仍走同一校验/配额/幂等流程。页面提供照片/截图选择和明确错误。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间视觉模型+微信真机截图解析成功，非菜谱图片、过期素材或审核失败不伪造正式菜谱。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): import recipes from private images`。

### Task 10: AI 可读取网址导入与失败降级

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-imports/urls.ts`, `miniapp/tests/contracts/ai-url.test.ts`, `tests/fixtures/ai-url.json`；Modify provider、imports 页面及能力记录。

**Interfaces:** Produces `validatePublicSource(url:string): Promise<ValidatedSource>`（HTTPS/HTTP、DNS/重定向策略），`UrlReaderPort.read(source:ValidatedSource): Promise<{sourceUrl:string;read:boolean;content:string|null}>`；可调用供应商托管读取能力，不实现站点抓取器。没有独立 reader 时，供应商需给出可验证读取元数据，不能靠模型在 JSON 自称已读取。

- [ ] **Step 1 — 写失败测试：**`rejects_private_and_metadata_urls`、`redirect_to_private_address_is_rejected`、`unreadable_source_cannot_succeed`；localhost、回环 IPv4/IPv6、私网、重绑定和元数据地址拒绝，只有 URL 没有实际读取证据返回 `SOURCE_UNREADABLE`。
  ```ts
  await expect(validatePublicSource('http://169.254.169.254/')).rejects.toMatchObject({code:'INVALID_INPUT'});
  expect(unreadable.error.code).toBe('SOURCE_UNREADABLE');
  expect(await h.rows('recipes')).toHaveLength(0);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/contracts/ai-url.test.ts tests/app/imports.test.ts`，预期 URL reader/失败入口未实现。
- [ ] **Step 3 — 最小实现：**云端调用明确具备读取能力的托管 AI/reader，验证实际来源，不跟随未校验重定向；读取失败提示粘贴正文/截图并复用输入页面。云端无下载任意 AI 图片的副作用，不尝试绕过限制。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；在测试空间实测一个公开菜谱 URL 和一个不可读取 URL，后者不生成菜谱。记录已测域名与能力；不可用则报告供应商替代或请求改范围，不能把 URL 支持默默后置。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): import readable recipe URLs safely`。

### Task 11: 日期、餐次与份数膳食计划

**Files:** Create `miniapp/uniCloud/cloudfunctions/planning-co/{index.obj.ts,package.json}`, `common/home-planning/{index,plans}.ts`, `common/home-contracts/planning.ts`, `database/meal_plans.{schema,index}.json`；Create `miniapp/src/features/planning/{api,use-planning}.ts`, `src/pages/planning/index.vue`。

**Test:** `miniapp/tests/domain/planning.test.ts`, `tests/app/planning.test.ts`。

**Interfaces:** `MealType='breakfast'|'lunch'|'dinner'|'other'`；`PlanningApi.add(input: Mutation & {date:string;meal:MealType;recipeId:Id;targetServings:number|null}): Promise<PlanEntry>`, `list(input:{from:string;to:string}): Promise<PlanEntry[]>`, `update(input: VersionedMutation & {id:Id;date:string;meal:MealType;targetServings:number|null}): Promise<PlanEntry>`, `remove(input: VersionedMutation & {id:Id}): Promise<void>`；entry 保存标题快照和引用。

- [ ] **Step 1 — 写失败测试：**`preserves_YYYY_MM_DD_across_UTC_boundary`、`allows_multiple_dishes_in_one_meal`、`rejects_foreign_recipe`、`changing_plan_does_not_change_shopping`；在北京时间 00:05/UTC 前日仍保留用户选定日，非法日期与负份数拒绝。
  ```ts
  expect(created.date).toBe('2026-11-03');
  expect((await owner.planning.list({from:'2026-11-03',to:'2026-11-03'})).length).toBe(2);
  expect(await h.rows('shopping_items')).toEqual(beforeShopping);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/planning.test.ts tests/app/planning.test.ts`，预期计划方法/页面缺失。
- [ ] **Step 3 — 最小实现：**日期按字符串校验，查询有范围上限，引用当前家庭菜谱，条目版本冲突提示；页面按日期餐次排列，保留标题快照。此票不依赖购物功能。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS，真机跨日视图及同餐多菜实测通过；共享修改不覆盖另一条计划。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): plan household meals by local date`。

### Task 12: 共享手动购物清单与勾选

**Files:** Create `miniapp/uniCloud/cloudfunctions/shopping-co/{index.obj.ts,package.json}`, `common/home-shopping/{index,lists,items}.ts`, `common/home-contracts/shopping.ts`, `database/{shopping_lists,shopping_items}.{schema,index}.json`；Create `miniapp/src/features/shopping/{api,use-shopping}.ts`, `src/pages/shopping/{index,detail}.vue`；若先于 Task 05 落地，则本票创建 `common/home-kernel/content.ts` 的同一 `ContentPort` 和审核适配，后落地者复用而非另造接口。

**Test:** `miniapp/tests/domain/shopping-manual.test.ts`, `tests/app/shopping-manual.test.ts`。

**Interfaces:** `ShoppingApi.create(input:Mutation & {name:string}): Promise<ShoppingList>`, `lists(): Promise<ShoppingList[]>`, `items(listId:Id): Promise<ShoppingItem[]>`, `addManual(input: Mutation & {listId:Id;raw:string;quantity:number|null;unit:string|null}): Promise<ShoppingItem>`, `updateItem(input: VersionedMutation & {id:Id;raw:string;quantity:number|null;unit:string|null}): Promise<ShoppingItem>`, `removeItem(input: VersionedMutation & {id:Id}): Promise<void>`, `setChecked(input:Mutation & {id:Id;checked:boolean}): Promise<ShoppingItem>`。

- [ ] **Step 1 — 写失败测试：**`supports_multiple_lists`、`independent_item_checks_do_not_overwrite_each_other`、`replayed_check_does_not_toggle_twice`；两成员同时勾不同条目后都为 true；同条目使用显式 checked 值而不是 toggle；跨家庭 listId 拒绝。
  ```ts
  expect((await owner.shopping.items(list.id)).every(item => item.checked)).toBe(true);
  expect((await owner.shopping.items(list.id))).toHaveLength(2);
  await expect(outsider.shopping.items(list.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/shopping-manual.test.ts tests/app/shopping-manual.test.ts`，预期手动清单/勾选无实现。
- [ ] **Step 3 — 最小实现：**条目独立存储和原子更新，编辑文字走审核，其他编辑用版本；页面支持多清单、手动条目和共享勾选。无 AI/菜谱也可演示。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；两个微信账户操作同清单，重新进入后持久化状态正确，跨家庭拒绝。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): share household shopping lists`。

### Task 13: 菜谱按份数加购与可恢复合并

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-shopping/{quantities,additions}.ts`, `database/shopping_additions.{schema,index}.json`；Modify shopping contracts/API/云对象、菜谱详情和清单来源展示。

**Test:** `miniapp/tests/domain/shopping-additions.test.ts`, `tests/app/shopping-additions.test.ts`。

**Interfaces:** `scaleIngredients(recipe:Recipe,targetServings:number|null): ScaledIngredient[]`；`ShoppingApi.addRecipe(input: Mutation & {listId:Id;recipeId:Id;targetServings:number|null}): Promise<AdditionView>`, `getAddition(id:Id): Promise<AdditionView>`；`AdditionView` 有 pending/running/succeeded/failed、贡献快照及警告。补偿 `resumeAddition(id:Id): Promise<AdditionView>` 为内部方法，由同请求重入及 Task 18 worker 使用。

- [ ] **Step 1 — 写失败测试：**`scales_half_servings_exactly`、`merges_kg_and_g`、`never_merges_mass_and_volume`、`keeps_to_taste_unknown`；原菜 2 份 100g，目标 3 份得 150g；1kg+500g 得 1500g，100mL 不合入；“适量”仍 null。Review Focus：`crash_after_first_contribution_replay_does_not_duplicate`。
  ```ts
  expect(scaleIngredients(twoServingRecipe,3)[0]).toMatchObject({quantity:150,unit:'g'});
  expect(mergedMass.quantity).toBe(1500);
  expect(unknownQuantity.quantity).toBeNull();
  expect(afterReplay).toEqual(afterFirstSuccessfulCompletion);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/shopping-additions.test.ts tests/app/shopping-additions.test.ts`，预期计算/贡献幂等未实现。
- [ ] **Step 3 — 最小实现：**使用精确十进制/有界有理数计算，禁止浮点长尾和质量体积猜测；合并键含规范名和量纲/单位。每操作持久化固定输入快照，每条贡献写入与数量更新同事务；相同 requestId 不重复增加，新 requestId 可再次加购。部分成功展示处理中，可恢复而非假成功。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间故障注入恢复，双成员同食材并发不丢增量；缺份数/单位显示警告，不调用 AI 做算术。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): add scaled recipe ingredients idempotently`。

### Task 14: 从膳食计划显式加入购物清单

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-shopping/plan-additions.ts`；Modify shopping API/contracts/云对象、planning 页面、additions 的来源联合类型。

**Test:** `miniapp/tests/domain/plan-shopping.test.ts`, `tests/app/plan-shopping.test.ts`。

**Interfaces:** `ShoppingApi.addPlans(input: Mutation & {listId:Id;planIds:Id[]}): Promise<AdditionView>`；对所选计划固定版本、标题、菜谱及份数快照，每份计划派生稳定子操作 ID，复用 Task 13 引擎。

- [ ] **Step 1 — 写失败测试：**`replaying_plan_batch_does_not_add_twice`、`plan_changes_do_not_rewrite_existing_items`、`deleted_recipe_does_not_abort_other_valid_entries`；重复批次总量不变，混入外家庭 planId 整体拒绝；来源不可用单项有明确警告。
  ```ts
  expect(second.id).toBe(first.id);
  expect(await owner.shopping.items(list.id)).toEqual(beforePlanEdit);
  expect(result.warnings.length).toBeGreaterThan(0);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/plan-shopping.test.ts tests/app/plan-shopping.test.ts`，预期缺批次入口。
- [ ] **Step 3 — 最小实现：**计划页面选择日期/餐次与清单后显式确认加购，展示各项状态；同请求恢复使用原始快照，不重新按已变更计划累计。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；多菜计划按各自份数加购，随后改计划不改变已保存购物量。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): add meal plans to shopping lists`。

### Task 15: 家庭菜谱评论

**Files:** Create `miniapp/uniCloud/cloudfunctions/feedback-co/{index.obj.ts,package.json}`, `common/home-feedback/{index,comments}.ts`, `common/home-contracts/feedback.ts`, `database/recipe_comments.{schema,index}.json`；Create `miniapp/src/features/feedback/api.ts`, `src/components/Domain/RecipeComments.vue`；Modify 菜谱详情。

**Test:** `miniapp/tests/domain/comments.test.ts`, `tests/app/comments.test.ts`。

**Interfaces:** `FeedbackApi.comments(input:{recipeId:Id;cursor?:string}): Promise<Page<CommentView>>`, `addComment(input:Mutation & {recipeId:Id;text:string}): Promise<CommentView>`, `editComment(input:VersionedMutation & {id:Id;text:string}): Promise<CommentView>`, `removeComment(input:VersionedMutation & {id:Id}): Promise<void>`；展示作者标签，不暴露邮箱/微信 openid。

- [ ] **Step 1 — 写失败测试：**`allows_multiple_comments`、`owner_can_delete_but_not_rewrite_others`、`rejects_cross_family_comment_id`、`renders_markup_as_plain_text`；本人可改，所有者改别人评论 `FORBIDDEN`，删除允许；HTML 字符串绝不进入富文本执行，审核拒绝不发布。
  ```ts
  await expect(owner.feedback.editComment(editOthers)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(owner.feedback.removeComment(deleteOthers)).resolves.toBeUndefined();
  expect(page.find('script').exists()).toBe(false);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/comments.test.ts tests/app/comments.test.ts`，预期评论业务/组件缺失。
- [ ] **Step 3 — 最小实现：**家庭+菜谱范围分页、版本检查、文本白名单/长度和审核；UI 仅对应权限显示编辑删除，云端仍完整检查，不做回复/点赞/举报。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；同家庭双用户/所有者操作实测，跨家庭拒绝；退出者标签遵守历史规则。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): comment on household recipes`。

### Task 16: 唯一评分与统计

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-feedback/ratings.ts`, `database/recipe_ratings.{schema,index}.json`, `miniapp/src/components/Domain/RecipeRating.vue`；Modify feedback contracts/API/云对象（若 Task 15 未落地则本票创建该共享入口）、菜谱详情/列表的统计接口。

**Test:** `miniapp/tests/domain/ratings.test.ts`, `tests/app/ratings.test.ts`。

**Interfaces:** `FeedbackApi.rate(input:Mutation & {recipeId:Id;stars:1|2|3|4|5}): Promise<RatingSummary>`, `withdrawRating(input:Mutation & {recipeId:Id}): Promise<RatingSummary>`, `summaries(recipeIds:Id[]): Promise<Record<Id,RatingSummary>>`；`RatingSummary={count:number;average:number|null;myStars:1|2|3|4|5|null}`。

- [ ] **Step 1 — 写失败测试：**`rejects_zero_fractional_and_six_stars`、`concurrent_upserts_keep_one_rating`、`withdraw_recomputes_summary`；[3,4] 得 `{count:2,average:3.5}`，撤完得 `{count:0,average:null}`，页面显示“暂无评分”；owner 不得传 UID 代改他人。
  ```ts
  expect(summary).toMatchObject({count:2,average:3.5});
  expect(afterAllWithdraw).toMatchObject({count:0,average:null});
  expect(page.text()).toContain('暂无评分');
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/ratings.test.ts tests/app/ratings.test.ts`，预期唯一评分/汇总未实现。
- [ ] **Step 3 — 最小实现：**确定性主键按家庭/菜谱/UID，服务端严格数值校验，原始评分为唯一事实来源，当前页批量聚合而非 N+1；统计不存易漂移缓存，允许作者自评。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；真实测试空间并发评分仅一行，所有客户端统计一致。无 Task 15 时本票也能独立显示评分，不额外添加人为依赖。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): rate household recipes consistently`。

### Task 17: 删除菜谱与关联清理

**Files:** Create `miniapp/uniCloud/cloudfunctions/common/home-recipes/deletion.ts`, `common/home-kernel/maintenance.ts`, `database/maintenance_jobs.{schema,index}.json`；Modify recipes API/云对象/详情页、已有关联模块的清理接口和 snapshot 读取。

**Test:** `miniapp/tests/domain/recipe-deletion.test.ts`, `tests/app/recipe-deletion.test.ts`。

**Interfaces:** `RecipesApi.remove(input:VersionedMutation & {id:Id}): Promise<{operationId:Id}>`；`enqueueMaintenance(input:{kind:'recipe-delete';familyId:Id;recipeId:Id}): Promise<Id>`；各 feature 导出 `cleanupRecipe(recipeId:Id,familyId:Id,cursor:string|null): Promise<{nextCursor:string|null}>`，仅 kernel 维护任务可调。

- [ ] **Step 1 — 写失败测试：**`non_author_member_cannot_delete`、`tombstone_denies_reads_immediately`、`cleanup_can_resume`、`plans_and_shopping_keep_snapshots`；注入清理中断再跑不删错文件、不重复改已购物量，旧 AI worker 不能重建已删除结果。
  ```ts
  await expect(member.recipes.remove(deleteByNonAuthor)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(owner.recipes.get(recipe.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await owner.shopping.items(list.id)).toEqual(beforeDeleteShopping);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/recipe-deletion.test.ts tests/app/recipe-deletion.test.ts`，预期删除/补偿尚无实现。
- [ ] **Step 3 — 最小实现：**作者或 owner 事务落 tombstone 与清理任务，立即隐藏并停止新关联；按游标分批清理收藏/互动/媒体引用，计划仅标记来源不可用、购物保留贡献快照；文件删除前检查剩余合法引用。本票通过重入请求恢复，Task 18 加定时兜底。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间中断恢复可复现，成员看不到 tombstone，跨家庭资源和来源快照不被误删。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): delete recipes with recoverable cleanup`。

### Task 18: 注销、解散与定时清理恢复

**Files:** Create `miniapp/uniCloud/cloudfunctions/lifecycle-co/{index.obj.ts,package.json}`, `maintenance-worker/{index.obj.ts,package.json}`, `common/home-lifecycle/{index,accounts,families,cleanup}.ts`, `common/home-contracts/lifecycle.ts`；Create `miniapp/src/features/lifecycle/api.ts`, `src/pages/account/deactivate.vue`；Modify family settings、各模块有界清理注册及 import 输入留存逻辑。

**Test:** `miniapp/tests/domain/lifecycle.test.ts`, `tests/domain/cleanup-races.test.ts`, `tests/app/lifecycle.test.ts`。

**Interfaces:** `LifecycleApi.deactivate(input:Mutation): Promise<OperationReceipt>`, `dissolveFamily(input:Mutation): Promise<OperationReceipt>`, `operation(input:{id:Id;receiptToken:string}): Promise<MaintenanceView>`；后者为独立 capability 校验入口，允许无普通 token 但必须校验操作摘要/到期/唯一范围。客户端只为此方法使用 `invoke` 的 `allowUnauthenticated:true` 选项，不能扩散成业务免登录。`runMaintenance(now:number): Promise<BatchResult>` 私有定时入口，分批清理 Task 17 队列、孤立文件、超过 7 天的原始输入、过期素材及卡住的加购操作。账号标记注销立即拒绝后续认证，不为查询状态保留通用登录权限。

- [ ] **Step 1 — 写失败测试：**`owner_must_transfer_or_dissolve_before_deactivation`、`deactivation_removes_personal_feedback_but_anonymizes_shared_content`；Review Focus：`resume_old_family_cleanup_does_not_delete_new_membership`、`cleanup_does_not_remove_other_family_media`；7 天前原始响应被清理，验证后菜谱仍在。
  ```ts
  expect((await newFamilyClient.family.current())?.generation).toBe(newGeneration);
  expect(await h.rows('recipe_ratings')).toEqual(expectedRemainingRatings);
  expect(preservedRecipe.createdBy).toBeNull();
  expect(rawInputAfterSevenDays).toBeNull();
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/domain/lifecycle.test.ts tests/domain/cleanup-races.test.ts tests/app/lifecycle.test.ts`，预期注销/解散/定时恢复缺失。
- [ ] **Step 3 — 最小实现：**捕获目标家庭/成员 generation，先撤销权限再做游标清理；离家保留历史互动、清理个人收藏，注销删除个人评论评分和素材并匿名化共享内容。解散删除当前家庭所有数据/文件；`_timing` 不依赖 `_before`，禁止公共 run/客户端伪造调度来源；清理重试不越过原目标范围。
- [ ] **Step 4 — 验证绿灯：**同命令 PASS；测试空间逐阶段故障注入、重跑及定时触发实测；多家庭数据保持完整，注销后旧 token 不能读业务，供应商残留数据处理与隐私条款一致。
- [ ] **Step 5 — 提交边界：**获准后提交 `feat(miniapp): recover household and account cleanup`。

### Task 19: 空环境恢复、真机验收与发布门禁

**Files:** Create `miniapp/ops/{release,restore,privacy-checklist}.md`, `miniapp/scripts/{release-check,restore-check}.mjs`, `miniapp/tests/contracts/release.test.ts`；Modify `miniapp/Taskfile.yml`, `ops/capabilities.md`, `ops/test-evidence.md`；在授权时部署测试/生产，不修改旧系统。

**Interfaces:** Consumes 全部叶子任务；Produces `task -d miniapp release:check`（只读门禁）、`task -d miniapp restore:check -- <redacted-evidence-file>`（验证恢复证据格式/范围，不擅自恢复生产）。备份清单包含数据库、媒体对象/引用、Schema/索引、函数版本、定时配置与安全另存的密钥恢复说明。

- [ ] **Step 1 — 写失败测试：**`release_rejects_missing_private_storage_proof`、`release_rejects_missing_domain_or_privacy_checks`、`restore_requires_all_data_classes`；缺 AI 网址实测/备案材料/关键密钥恢复来源均使门禁失败，不输出假 PASS。
  ```ts
  expect(missingPrivateProof.exitCode).not.toBe(0);
  expect(completeReadiness.exitCode).toBe(0);
  expect(restoreWithoutMedia.exitCode).not.toBe(0);
  ```
- [ ] **Step 2 — 确认红灯：**`task -d miniapp test -- tests/contracts/release.test.ts`，预期门禁尚未实现。
- [ ] **Step 3 — 最小实现：**建立非秘密证据格式和缺口报告；文档写明域名、内容安全、第三方 AI 隐私告知、许可审查、预算报警和版本回退操作。门禁不自动调用发布 API，不要求把真实密钥放备份清单。
- [ ] **Step 4 — 验证绿灯：**`task -d miniapp check` 与 release 测试 PASS；在获准的全新隔离空间从备份恢复，至少两个家庭多用户微信真机重验登录、私有图片、AI 三输入、计划加购、评论评分与退出隔离。只有人工确认 H3 后才创建体验版/提交审核；真实发布是需另行授权的操作。
- [ ] **Step 5 — 提交边界：**获准后提交 `chore(miniapp): verify release and recovery readiness`。不关闭旧服务、不删除旧数据和代码。

## 4. 自审覆盖与执行交接

### 4.1 需求追踪

| 设计部分 | 实施任务 |
| --- | --- |
| 工程隔离、无 Python、身份、配置和运行时 | 01；跨任务边界检查 |
| 单家庭关系、邀请、退出、owner 和成员撤权 | 02～04；并发栅栏贯穿写操作 |
| 菜谱、输入边界、搜索、收藏 | 05～06 |
| 私有媒体、审核、素材访问和留存 | 07、09、18 |
| AI 文本/图片/网址、结构校验、配额、重试、取消、恢复 | 08～10 |
| 日期餐次和确定性购物计算/幂等 | 11～14 |
| 评论评分、权限和统计 | 15～16 |
| tombstone、快照、注销/解散及恢复清理 | 17～18 |
| 限流/日志/费用 | 01/02 的请求边界、08 配额与尝试计量、19 门禁 |
| 云能力、真机、域名/备案/隐私、恢复与许可 | 各任务实测 + 19 汇总 |

### 4.2 自审记录

- 已逐节对照设计；无计划性范围删除，未把生产上线当作当前授权。
- 19 票均包含可观察行为、Schema/API/UI/测试或完整运维验收；没有独立横向脚手架票。
- 共享接口名统一；Task 16 可先于 15 创建 feedback 入口；Task 05 的 fixture 不要求 Task 03 已实现，可可信 seed 同家庭第二用户，不伪造端到端登录验收。
- 五个 Review Focus 均在所属任务有具名测试；平台 SDK 的真实行为仍需要测试空间证据。
- 文档结构检查通过：19 个任务与 19 个工单草案的直接依赖一致、依赖图无环、最终验收的依赖闭包覆盖全部 18 个前置；本检查没有执行产品测试。
- 没有以查询/批量修改替代厂商受限的逐文档事务；外部 AI/存储不放进数据库长事务。
- 任务完成后频繁审阅；Git 提交本身仍需用户另行允许，且不得混入用户工作。

### 4.3 工单发布与执行方式

工单草案及发布映射位于同目录的 `2026-11-03-wechat-unicloud-ticket-draft.md`。用户已确认粒度并授权发布，目标为 GitHub `pray4her/mealie`，已创建 #1～#19；没有来源父 issue，未创建或改动父 issue。

已通过 GitHub CLI 按依赖顺序发布，使用 UTF-8 body 文件并设置原生阻塞关系；19 份正文、标题、标签、无父 issue 状态及 31 条阻塞边均已读回核对。14 票为 `ready-for-agent`（仍受前置工单阻塞）；#1、#8、#9、#10、#19 为 `needs-info`，分别等待测试环境、AI 能力/预算或正式发布材料确认。没有把 mock 通过当作云端验收，也没有关闭或认领任何工单。

执行方法尚未选择：推荐 **Subagent-driven**，因为 19 个切片共享权限、事务和任务接口，逐票独立审阅能较早发现越权与幂等错误；备选 **Native**，在本会话实现全部任务后做一次独立整体审阅，成本较低。用户审阅计划、工单粒度/阻塞边并选择执行方式后，再加载相应执行技能；本轮不调用执行技能。

## 5. 本轮文档依据

- 已读取仓库 issue tracker、triage 与 domain 指引；当前无 `GLOSSARY.md` 或 `docs/adr/`，未创建空占位文档。本文采用已批准设计的“用户/家庭/成员/菜谱/膳食计划/购物清单”等术语。
- 已通过 Context7 resolve/query 核对 [uni-app CLI](https://uniapp.dcloud.net.cn/quickstart-cli.html)、[uniCloud 快速上手](https://doc.dcloud.net.cn/uniCloud/quickstart.html)、[TS 公共模块](https://doc.dcloud.net.cn/uniCloud/cf-common.html#typescript)、[事务限制](https://doc.dcloud.net.cn/uniCloud/cf-database.html)、[定时入口](https://doc.dcloud.net.cn/uniCloud/trigger.html)、[Vitest 独立配置](https://vitest.dev/config/) 与 [Task 参数](https://taskfile.dev/docs/reference/cli)。供应商特定 AI/存储文档在选定服务时继续核对，不能从统一适配接口推定供应商能力。
- 计划编写时未创建 GitHub Issues；随后获得单独发布授权并完成 19 票发布与依赖核对。仍未安装依赖、搭建工程、调用付费 AI、连接云数据库或部署；计划内产品测试 PASS 都是后续执行时的预期，不是本轮测试结果。
