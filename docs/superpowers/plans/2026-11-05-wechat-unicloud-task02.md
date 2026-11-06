# Task 02 创建唯一家庭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 #2：微信登录用户创建唯一家庭、成为 owner 并进入家庭页；重复、并发及结果不确定的请求不会多建家庭或留下孤儿数据。

**Architecture:** `family-co.current/create` 复用现有身份与会话保护，调用同一 `home-family` 服务。成员 `_id=uid`，家庭、成员和成功回执在逐文档事务中提交；持久化限流独立提交，名称审核在业务事务外执行。客户端保存按 UID 隔离的创建意图，未知结果只恢复原请求。

**Tech Stack:** 现有 uni-app Vue 3 / TypeScript、uni-helper 模板类型、uniCloud alipay、uni-id、官方 uni-sec-check、Vitest / Vue Test Utils、Task / pnpm；不引入 Python 运行依赖。

**Spec:** [本票设计](../specs/2026-11-05-wechat-unicloud-task02-design.md)（用户 2026-11-05 已批准），同时遵守 [整体设计](../specs/2026-11-03-wechat-unicloud-design.md)。本文件替代总计划 Task 02 的实施步骤，不变更其他工单。

## Global Constraints

- “只修改 `miniapp/` 和本票设计、计划文档”；“不实现邀请、加入、改名、所有权转移、退出家庭或解散”。
- “云根固定为 `miniapp/uniCloud-alipay`”；“沿用已锁定的 uni-app Vue 3、TypeScript、uni-helper 模板类型、pnpm/Task 和 Node 22.23.3”。
- “新增 `family-co` 的生产公开方法仅 `current` 和 `create`”；“客户端仅 type-only 引用 `home-contracts`”。
- “四个集合的 Schema 对 clientDB `read/create/update/delete` 全部设为 false”。
- “家庭名称 trim 后为 1～40 个 Unicode 码点，拒绝控制字符及非法类型”；“requestId 是 16～128 位 ASCII 字母、数字、`-` 或 `_` 组成的非空随机标识”。
- “已提交回执可在当前权限确认后重放”；“相同 requestId 换内容返回 CONFLICT”。
- “不同 requestId 并发时，只能一个创建成功；其余返回 ALREADY_IN_FAMILY”。
- “提议最多 3 次总尝试加有界抖动”；批准设计后作为本票默认值实施，不允许叠加另一层无限重试。
- “不得清空空间、删除已有数据、自动开通付费资源、生产部署、Git 提交或关闭旧服务”。
- “本票专用 `ops/task02-*` 文件”；“不把 #1 的 accepted 标记或旧 doctor READY 当成本票通过”。

## Review Focus

1. 空白、非 BMP 字符、控制字符和未知字段：Task 2 的输入测试按码点判长，禁止对象注入，不将客户端 owner/UID 当身份。
2. commit 已落库但响应丢失、同一 ID 的内容竞争：Task 1/2/4 同时断言恢复回执、零孤儿及客户端原 requestId；查不到回执不等于旧请求失败。
3. 审核等待期间另一设备建家或身份撤销：Task 2/3 在写事务前重新鉴权、事务内重读槽；明确拒绝或审核不可用均不能偷偷写入。
4. 回执存在但 generation/owner/家庭状态已变化：Task 2/4 不重放旧权限，损坏关系不能显示新的创建入口。
5. SDK 迟到续期、隐藏页面导航和冷启动草稿串号：Task 4/5 覆盖真实 storage 顺序、生命周期和账户切换，不只断言 ref。

---

## 0. 执行准备与文件结构

用户于 2026-11-05 审阅后选择 A，授权本票分任务子代理实施及独立审阅。已搜索用户技能目录、系统技能目录、仓库技能目录及插件缓存，未找到 `superpowers:subagent-driven-development`；已告知用户，按其选择的 A 直接编排等价流程，不声称加载过缺失技能。本票测试边界已随设计和计划确认，不重复询问。#2 的直接前置 #1 已关闭，目标仓库验证后已认领 #2；没有上传或提交 Git。

获准执行后的第一步读回 `gh issue view 2 --repo pray4her/mealie --json number,title,body,labels,comments` 和 `gh api repos/pray4her/mealie/issues/2/dependencies/blocked_by`，确认所有直接前置仍关闭、当前工作树可安全增量编辑。首次 tracker 写入先 `gh repo view pray4her/mealie --json nameWithOwner`；认领 #2，不自动改验收状态或关闭工单。

使用本机已有 Node 22.23.3、pnpm 10.20.0、Task 3 工具；校验版本，避免继承 PATH 中 Node 26。先运行 `task -d miniapp check` 留下基线；已有故障单独记录，不通过降级检查处理。下面命令均从仓库根运行；需要单独 `pnpm exec` 时以 `miniapp/` 为工作目录。任务结尾记录可审阅差异，不执行技能模板中的自动 commit。

以下路径均是精确物理路径；表内花括号只表示列举文件，不创建字面花括号路径。

| 创建文件 | 职责 |
| --- | --- |
| `miniapp/uniCloud-alipay/cloudfunctions/common/home-kernel/{database,database-platform,idempotency,persistent-request-limit,content}.ts` | 窄事务接口、平台适配、回执摘要、跨实例限流、审核端口 |
| `miniapp/uniCloud-alipay/cloudfunctions/common/home-contracts/family.ts` | Mutation、FamilyContext/View/API 的 type-only 契约 |
| `miniapp/uniCloud-alipay/cloudfunctions/common/home-family/{index,model,repository,current,create,membership,validation,weixin-content}.ts` 及 `package.json` | 家庭领域、记录校验、只读上下文、创建、操作栅栏、微信审核适配 |
| `miniapp/uniCloud-alipay/cloudfunctions/family-co/{index.obj.ts,package.json}` | 仅两个公开方法，建立可信依赖和安全响应 |
| `miniapp/uniCloud-alipay/database/{families,family_members,mutation_receipts,request_limits}.schema.json` | 业务字段结构及 clientDB 全拒绝 |
| `miniapp/uniCloud-alipay/database/family_members.index.json` | 普通 familyId 索引；其余集合本票点读依赖平台主键，不造重复主键索引 |
| `miniapp/vendor/content-check/{upstream.zip,lock.json,generated.json,README.md}`、`miniapp/scripts/assemble-content-check.mjs` | 官方审核插件固定归档、许可、摘要和可重复导入；不覆写身份归档 |
| `miniapp/src/uni_modules/uni-sec-check/...` | 上述脚本生成的官方插件/云公共模块，禁止手改；仅云函数依赖，不引入客户端运行代码 |
| `miniapp/src/features/family/{api,intents,use-family,validation}.ts` | DTO 解包校验、UID 意图存储、应用级控制器、表单校验 |
| `miniapp/src/pages/family/home.vue` | 只在身份和家庭确认后显示名称、本人角色、退出登录 |
| `miniapp/tests/support/{memory-database,family-fixtures}.ts` | MVCC/原子提交替身与可信家庭 seed，无可部署测试身份入口 |
| `miniapp/tests/domain/{database,family-current,family-create,membership,persistent-request-limit}.test.ts` | 数据原子性、家庭不变量、幂等和配额 |
| `miniapp/tests/contracts/{database-platform,family-cloud,weixin-content,content-assembly,task02-ops}.test.ts` | 真实适配边界、公开面、审核来源、装配与验收记录门禁 |
| `miniapp/tests/app/{family-api,family-controller,family-create,family-home}.test.ts` | 客户端门面、意图恢复与真实 SFC 生命周期 |
| `miniapp/tests/cloud/{task02-probes.ts,task02-client-checks.ts}` | 仅供隔离云空间的测试工件和实际 SDK 检查函数；不放入正式云根/客户端 src |
| `miniapp/ops/task02-{capabilities.md,test-evidence.md,cloud-checks.md,deploy-preview.json,acceptance.json}` | 本票独立能力、结果、实测步骤、上传清单和验收状态 |

| 修改文件 | 改动 |
| --- | --- |
| `miniapp/uniCloud-alipay/cloudfunctions/common/home-kernel/{index.ts,errors.ts,platform.d.ts}` | 导出新端口/适配器、补安全错误；保留原身份适配形状 |
| `miniapp/uniCloud-alipay/cloudfunctions/common/home-contracts/{index.ts,identity.ts}` | 导出 Family 类型；Task 4 才将 AppClient.family 设为必需 |
| `miniapp/src/shared/{errors,production-client,app-client,route-guard,copy}.ts` | 错误保真、实例注入、家庭路由和中文文案 |
| `miniapp/src/pages/family/onboarding.vue`、`miniapp/src/pages.json` | 创建表单和家庭路由；登录页仍先进入引导，由云端家庭结果分流 |
| `miniapp/tests/support/{harness,uni-stubs}.ts`、`miniapp/vitest.config.ts` | 同一领域服务、真实 input 事件语义和 home-family 测试别名 |
| `miniapp/tests/app/{auth,session-boundary}.test.ts`、其他显式 AppClient fixture | 加入真实 fixture family 门面，保留 #1 全部回归 |
| `miniapp/{tsconfig.cloud.json,tsconfig.tests.json,Taskfile.yml}` | 新云对象/公共模块类型覆盖、审核装配检查和只读 task02 运维命令 |
| `miniapp/scripts/{check-boundaries,deploy-preview,doctor}.mjs`、`miniapp/tests/contracts/boundaries.test.ts` | 三个正式对象/五个公开方法、业务 Schema/新云模块导入边界、独立验收门禁 |

依赖仅新增官方审核模块和必要的真实 file 依赖。候选锁定官方 `uni-sec-check@2.0.2`（插件市场 #5460）；执行时先核对下载包内版本与全部递归依赖，再记录官方 URL、原始归档 SHA-256、license 和生成文件摘要。若官方包不可得或依赖冲突，报告实际缺口，不静默换版本或改写 #1 上游归档。当前已有 bridge-common 的来源/版本按真实包与云端清单确认，满足官方 ≥1.1.2；不得用文档记录的旧版本号冒充实测。

## 1. 共用接口约定

所有下列类型在所属任务引入，没有生产占位实现。记录接口字段逐项对应设计第 4 节；记录含 `_id`，`insert/replace` 校验参数 id 与记录 `_id` 相同，ID 不可被普通修改覆盖。

```ts
type CollectionName = 'families' | 'family_members' | 'mutation_receipts' | 'request_limits';
interface TransactionPort {
  get<T>(collection: CollectionName, id: string): Promise<T | null>;
  insert<T>(collection: CollectionName, id: string, value: T): Promise<void>;
  replace<T>(collection: CollectionName, id: string, value: T): Promise<void>;
  remove(collection: CollectionName, id: string): Promise<void>;
}
interface DatabasePort {
  transaction<T>(fn: (tx: TransactionPort) => Promise<T>): Promise<T>;
}
interface ContentPort { checkText(text: string): Promise<'allowed' | 'rejected'> }
type Mutation = { requestId: string };
type FamilyContext = { uid: string; familyId: string; role: 'owner' | 'member'; generation: string };
type FamilyView = FamilyContext & { name: string };
interface FamilyApi {
  current(): Promise<FamilyView | null>;
  create(input: Mutation & { name: string }): Promise<FamilyView>;
}
type FamilyDeps = {
  database: DatabasePort; now: () => number; newId: () => string;
  content: ContentPort; revalidateIdentity: () => Promise<void>;
};
```

`database.ts` 还定义内部 `DatabaseFault`，kind 为 `conflict | commit-unknown | unavailable`；只在平台适配内部保留底层原因，不发给客户端。冲突总尝试数为 3；commit-unknown 不盲重放回调，由创建服务验证回执后恢复。业务 AppError 不在数据库层重试。

`createFamilyService(deps: FamilyDeps, identity: Identity): FamilyApi` 只接受已验证身份。其内部 current/create 均应用持久化限流；云对象不再额外消耗相同配额。数据库适配负责事务冲突重试，服务不叠加冲突循环。

## Task 1：数据库原子性与业务集合

**Files:** 创建 `home-kernel/database.ts`、`database-platform.ts`、四份 Schema、普通成员索引、`tests/support/memory-database.ts`、`tests/domain/database.test.ts`、`tests/contracts/database-platform.test.ts`；修改 kernel 导出/平台声明、TS 和 Vitest 配置。集合路径见第 0 节。

**Interfaces:** Produces `DatabasePort/TransactionPort/DatabaseFault`、`createDatabasePort(platform: DatabasePlatform, options: { maxAttempts: number; backoff: (attempt: number) => Promise<void> }): DatabasePort`。`DatabasePlatform` 在 database-platform.ts 声明为 `uniCloud.database()` 返回数据库句柄的窄子集，包含 collection 点读及 startTransaction，事务句柄仅包含本票实际使用的 collection/add/doc.get/update/remove、commit/rollback；不能传整个云全局对象。`createMemoryDatabase()` 返回 `{database, seed(collection,id,row), rows(collection), failNext(stage), barrierNextCommit()}`。测试故障点以命名阶段表达，不向生产平台对象增加故障参数。

- [x] **Step 1 — 写红灯测试。** `database.test.ts` 覆盖 `commits_all_records_or_none`、`insert_never_overwrites_existing_id`、`competing_uid_inserts_cannot_both_commit`、`read_set_changes_abort_stale_writer`、`absence_read_detects_concurrent_insert`。核心断言：

  ```ts
  expect(await memory.rows('families')).toHaveLength(0); // 任一插入阶段失败后
  expect(await memory.rows('family_members')).toHaveLength(0);
  expect(await memory.rows('mutation_receipts')).toHaveLength(0);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); // 同槽裸 insert 竞争
  ```

  `database-platform.test.ts` 覆盖普通 get 的数组与事务 get 的对象/缺失返回、commit/rollback 次数、回滚失败保留原错误、冲突最多尝试 3 次、未知 commit 不自动重跑回调。畸形返回必须拒绝，不能“解析为空”。
- [x] **Step 2 — 确认红灯。** `task -d miniapp test -- tests/domain/database.test.ts tests/contracts/database-platform.test.ts`；预期缺少事务适配/原子内存实现，失败点对应上述行为。
- [x] **Step 3 — 实现端口与适配。** 在上列 kernel 文件实现精确接口；startTransaction 后只对 doc 逐条读写，insert 使用指定 `_id` 的单条 add，replace 只修改已存在的固定字段记录，updated=0 拒绝，不用 upsert 弥补缺记录。统一规范化点读返回，保留 #1 账户读取的数组语义。仅对核验过的冲突/唯一键竞争分类重试，最多 3 次，退避默认 10/20ms 加 0～20ms 抖动；所有外部调用不在回调中。错误码映射表由官方资料/包与随后云端错误样本共同校准，未核验错误先归 unavailable，不能用宽泛消息子串冒充可靠分类。
- [x] **Step 4 — 实现测试数据库。** `createMemoryDatabase` 采用快照、读集合版本（含不存在记录）、暂存写和提交时原子比较；失败不泄漏暂存写。`seed` 仅测试用，`rows` 返回拷贝。用 barrier 强制两个回调在提交前相遇，不能用全程互斥串行化来代替竞争测试。
- [x] **Step 5 — 建立 Schema/索引。** 四集合字段白名单、必需字段和四种 CRUD=false；成员只有 `_id` 唯一及普通 familyId 索引，不给 role 或 ownerUid 加全局唯一索引。业务 ID/日期仍由服务验证。暂不上传。
- [x] **Step 6 — 验证绿灯。** 重跑 Step 2 同命令，全部 PASS；运行 cloud TS noEmit 和现有 identity 测试确认平台声明未破坏 #1。记录差异与红绿证据，不提交 Git。

## Task 2：唯一家庭、当前归属、幂等与持久化配额

**Files:** 创建 `home-contracts/family.ts`、`home-family/{index,model,repository,current,create,membership,validation}.ts` 及 package；创建 kernel `idempotency.ts`、`persistent-request-limit.ts`、`content.ts`；创建四份相关 domain 测试（family-current/create、membership、persistent-request-limit）及 `family-fixtures.ts`；修改 kernel/contracts 导出与两端 errors、harness、测试解析配置。

**Interfaces:** Consumes Task 1；Produces 第 1 节类型和 `createFamilyService`，以及 `readFamily(tx: TransactionPort, uid: string): Promise<FamilyView|null>`、`requireFamily(database: DatabasePort, identity: Identity): Promise<FamilyContext>`、`guardMutation(tx: TransactionPort, ctx: FamilyContext): Promise<void>`、`consumeRequestLimit(database: DatabasePort, input: {subject:string;operation:string;now:number;max:number}): Promise<void>`。限流固定窗口 60_000ms，bucket ID 仅 subject+operation，字段记录当前 windowStart，过窗复用同一行并重置 count，避免永久堆积每分钟记录。

此任务仅定义 FamilyApi，不把 AppClient.family 设为必需；harness 暂新增 `family(uid): FamilyApi` 让领域测试调用同一服务，Task 4 才完成两端 AppClient 扩展。不为未接线生产客户端填假 family。

- [x] **Step 1 — 写红灯测试。** 用 `createHarness` 的可信 seed、内存 DB 及同一领域工厂安排身份，不复制实现。锁定断言：

  ```ts
  expect(await h.family('alice').current()).toBeNull();
  const original = await h.family('alice').create({ requestId: 'request-00000001', name: '  我家  ' });
  expect(original).toMatchObject({ uid: 'alice', name: '我家', role: 'owner' });
  expect(await h.family('alice').create({ requestId: 'request-00000001', name: '我家' })).toEqual(original);
  await expect(h.family('alice').create({ requestId: 'request-00000001', name: '另一家' }))
    .rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
  ```

  命名场景还包括 `same_id_concurrent_requests_replay_one_result`、`different_ids_allow_one_family_only`、`same_id_different_names_conflict`、`other_uid_cannot_read_receipt`、`rollback_each_insert_stage`、`commit_unknown_recovers_valid_receipt`、`missing_receipt_keeps_result_unknown`。不同 ID 并发断言一个成功，一个 ALREADY_IN_FAMILY；同 ID 不同内容断言一个成功，一个 CONFLICT。

  权限场景覆盖无槽、缺家庭、非活跃家庭、owner 槽缺失/异家、role/ownerUid 错配、generation 改变后重放拒绝，guardMutation 的旧 generation 拒绝且新代次序号不被修改。校验场景明确 `[]/{}/null`、额外 UID/role/$ 字段、0/41 码点、40 个非 BMP 字符、控制符、requestId 长度 15/16/128/129；不同家庭允许同名。

  限流场景验证两个服务实例共享数据库：创建第 11 次、current 第 61 次、同家庭跨 UID 第 301 次分别拒绝；窗口边界 59_999/60_000ms；业务回滚后调用仍计数；一次调用内冲突重试不重复计数。达到家庭限额的测试用可信 seed 安排普通成员，不提前实现邀请。
- [x] **Step 2 — 确认红灯。** `task -d miniapp test -- tests/domain/family-current.test.ts tests/domain/family-create.test.ts tests/domain/membership.test.ts tests/domain/persistent-request-limit.test.ts`；预期缺少服务及跨实例约束。
- [x] **Step 3 — 实现关系读取和内部栅栏。** `repository/current/membership` 使用同事务快照验证 caller 槽、家庭和 owner 槽；只有无槽是 null，损坏关系返回 FAMILY_REQUIRED，不能让 create 插入第二家庭。guardMutation 校验 generation、role 和家庭后递增 mutationSeq。未知底层错误安全返回 UNAVAILABLE。
- [x] **Step 4 — 实现回执与创建。** 摘要采用 SHA-256 和固定版本数组编码 `['family-create-v1', uid, requestId]`；payloadHash 编码 `['family-create-v1', normalizedName]`，不依赖任意对象键顺序。先限流、事务预检回执/当前槽；需要新建才在事务外审核并重新身份确认；写事务再次预检，按 families→family_members→mutation_receipts 写入。家庭初始 version=1，成员 mutationSeq=0，generation/familyId 使用云端随机值并在一次逻辑尝试内固定。审核 rejected 映射 INVALID_INPUT，异常映射 UNAVAILABLE；不持久化失败为成功回执。
- [x] **Step 5 — 实现配额与不确定恢复。** 创建入口 UID=10/min；current UID=60/min，已确认家庭再额外 family=300/min，每个 bucket 在独立短事务中提交。配额消费在业务写之前，当前归属判断只允许来自可信读取。commit-unknown 后新事务查同 UID/请求回执、比摘要并验证当前关系；未确定就 UNAVAILABLE，不生成另一个 familyId 进行外部补写。重放不重新审核，但始终检查当前权限与消耗配额。不得清理成功回执。
- [x] **Step 6 — 验证绿灯。** 重跑 Step 2。新增 `membership_changes_while_content_check_waits` 与 `identity_revoked_while_content_check_waits`，分别通过 deferred ContentPort 和 revalidateIdentity 确认不会用旧状态提交。补齐失效回执、限流和错误码回归后记录差异，不提交 Git。

## Task 3：真实审核适配、家庭云对象与部署边界

**Files:** 创建官方 content-check 归档/装配脚本和生成插件、`home-family/weixin-content.ts`、`family-co`、三份相关 contract 测试；修改真实 package 依赖、cloud TS、Taskfile 的装配校验、check-boundaries 及既有边界 fixture、deploy-preview；建立 `ops/task02-capabilities.md`。

**Interfaces:** Consumes Task 1/2；Produces `createWeixinContentPort(options: {uid:string;appId:string;requestId:string;readOpenid:(uid:string)=>Promise<unknown>;loadChecker?:()=>CheckerConstructor;timeoutMs?:number}):ContentPort`。实际 SDK 适配后，readOpenid 返回该可信用户的 wx_openid 映射，由适配器按可信 appId 选择；CheckerConstructor 为代码中已定义的窄官方构造器/textSecCheck 接口，默认生产懒加载，替换仅供系统边界测试；timeoutMs 默认/上限 5000。生产公开 `current(this:FamilyCloudContext,input?:unknown):Promise<CloudSuccess<FamilyView|null>|{errCode:string}>` / `create(this:FamilyCloudContext,input:unknown):Promise<CloudSuccess<FamilyView>|{errCode:string}>`。入口文件局部声明 `FamilyCloudContext={getUniIdToken():string|undefined;getClientInfo():ClientInfo;getUniCloudRequestId():string}`，不把辅助工厂导出为新方法；三项均不从业务 input 获取。

Task 3 独立审阅实际执行锁定 SDK 的 importObject 工厂后确认：现有 transport 总传一个 input，undefined 在 SDK 参数数组中保留，JSON 后成为 null。因此 current 的空输入表示接受零参、undefined、null、空对象；拒绝数组、非空对象、primitive 和额外参数。Task 4 门面明确发送 `{}`，并保留实际传输/序列化回归，不能只测试零参直接导出调用。

- [x] **Step 1 — 写红灯测试。** `weixin-content.test.ts` 断言只使用可信 readOpenid 返回值、scene=1/version=2，pass 才 allowed，review/risky 为 rejected，非成功状态、缺字段/未知 suggest、超时或缺 openid 都 UNAVAILABLE。`family-cloud.test.ts` 使用窄平台 stub 调用真实具名导出，验证 token/平台拒绝、客户端伪造参数、JSON DTO 白名单、业务错误保真以及 newToken 只在顶层。

  `content-assembly.test.ts` 验证固定包版本/摘要、重复生成一致、依赖许可保留、输入不含真实配置、不会覆盖现有 bridge/id 模块。扩展 `boundaries.test.ts`：family-co 只有 current/create，可接受；增加 re-export/默认导出/测试入口或第四个正式对象必须拒绝；业务 Schema 任一 CRUD 打开必须拒绝，客户端运行时导入 home-family 或审核模块必须拒绝。
- [x] **Step 2 — 确认红灯。** `task -d miniapp test -- tests/contracts/weixin-content.test.ts tests/contracts/family-cloud.test.ts tests/contracts/content-assembly.test.ts tests/contracts/boundaries.test.ts`；失败原因应为缺实际适配与新的精确白名单。
- [x] **Step 3 — 锁定并装配官方审核模块。** 从官方市场 #5460 的 2.0.2 发行包取得原始 ZIP，仅本地归档和装配，记录版本、原始 URL、SHA-256、许可证与递归依赖。脚本导出 `assembleContentCheck({archivePath,lockPath,targetPath,check?})`，check=true 不写文件；参照既有装配实现路径校验和生成文件清单，不重新实现一套通用插件管理器。必要依赖映射由装配记录，不能手改生成文件或覆盖旧 uni-id/bridge 模块。Taskfile check 加入确定性装配校验。下载版本或包结构不匹配即报告，不继续猜。
- [x] **Step 4 — 实现云端审核适配。** 复核锁定官方源码的成功 errCode 形状后做精确校验，不把文档中的宽泛 String 声明当运行时保证。执行准备现已查到 2.0.2 将成功规范为数字 0，并将 review/risky 结果改为精确 `uni-sec-check-risk-content`：此已知风险状态与其对应结果应映射 rejected，不能误判为网络不可用；未知非零/畸形结果仍 UNAVAILABLE。只读取当前用户 `wx_openid['mp_' + appId]`，按 #1 上游逻辑允许 `wx_openid.mp` 回退；明确字符串类型、限定可信 AppID，值不出云端、不日志打印。使用 UniSecCheck 的 mp-weixin provider 与平台 requestId/appId，配置依赖既有 uni-open-bridge/uni-id 安全配置，不在客户端或新 env 引入 AppSecret。实际调用有小于云函数时限的超时；任何异常均不写家庭。近两小时访问条件不满足时给可恢复 UNAVAILABLE，不能降到 V1 或通过审核替身。
- [x] **Step 5 — 接线两个公开方法。** family-co 每次用 #1 requireIdentity 建立身份、真实 database 和审核依赖。审核后 revalidateIdentity 使用同一请求 token 且 `refresh:false`，响应续期仍走 #1 的统一顶层机制。绑定实例懒加载平台依赖，测试导入不发真实网络。显式 file 依赖指向实际公共模块路径，HBuilderX 运行检查前不声称 paths alias 是部署依赖。
- [x] **Step 6 — 验证绿灯和离线部署预览。** 重跑 Step 2，全量类型检查；`task -d miniapp deploy:preview` 只在离线列清单，记录新增 family-co、home-family、kernel/contracts、审核模块和四 Schema/成员索引。扩展脚本支持 `--ticket task02` 并新增 `task -d miniapp task02:preview` 写 `ops/task02-deploy-preview.json`；action=blocked-no-upload，已有同名资源未经核对仍 unknown。不读取或输出密钥，不上传、不提交。

## Task 4：客户端家庭门面、意图持久化与会话隔离

**Files:** 创建 features/family 的 api/intents/use-family/validation 和 `family-api.test.ts`、`family-controller.test.ts`；修改 contracts/identity 的 AppClient、production-client、app-client、errors、harness、uni-stubs 及所有显式 AppClient fixtures，保留 session-boundary 机制。

**Interfaces:** Consumes FamilyApi 和现有 AuthController/SessionBoundary/SessionStorage。Produces `createFamilyApi({invoke,boundary}): FamilyApi`，其中 invoke 沿用 cloud.invoke 的泛型签名；`createFamilyIntentStore(storage:SessionStorage)` 具有 `read(uid):PendingIntent|null`、`write(uid,intent):void`、`clear(uid):void`，`PendingIntent={requestId:string;name:string;uncertain:boolean}`。

`createFamilyController({api,auth,account,intents,newRequestId})` 返回只读 Vue refs `view:Readonly<Ref<FamilyView|null>>`、`phase:Readonly<Ref<'idle'|'checking'|'ready'|'submitting'|'unavailable'|'conflict'>>`、`pending:Readonly<Ref<PendingIntent|null>>` 及 `load():Promise<FamilyView|null>`、`submit(name:string):Promise<FamilyView>`、`retry():Promise<FamilyView>`、`clear():void`、`dispose():void`。输入各依赖为相应已定义接口；`newRequestId:()=>Promise<string>` 支持微信随机 API 的异步回调。`load` 先 auth.restore 再 current，不自行导航。

实际控制器消费约定：clear 只隐藏引用并失效旧代次，保留磁盘未决意图；真正退出由身份观察清除对应 UID 的意图。load 在身份未确认或操作取消时也可返回 null，因此页面必须同时检查 auth authenticated、family phase=ready，再读取 view；仅此时 view=null 表示已确认无家庭。首次输入拒绝不能凭空制造这一已确认状态，须保留此前查询确认条件。

- [x] **Step 1 — 写红灯测试。** API 断言 current/create 只调用 `family-co` 指定方法、响应白名单/type/role/id/name 校验、AUTH_REQUIRED 调用已有 boundary.close 清理；无其他业务参数透传。控制器使用现有真实 storage/SDK 顺序替身：

  ```ts
  expect(sent[1]).toEqual(sent[0]); // UNKNOWN 后 retry 的 requestId/name 必须完全相同
  expect(intents.read('bob')).toBeNull(); // alice 的未决意图不得串号
  expect(controller.view.value).toBeNull(); // 退出后，即使旧结果迟到
  expect(storage.get('uni_id_token')).toBeUndefined(); // SDK 迟到 token 写入后仍清理
  ```

  覆盖 `persist_before_first_send`、`storage_write_failure_prevents_send`、`corrupt_intent_fails_closed`、`cold_start_null_current_keeps_original_intent`、`unknown_result_blocks_new_name`、`known_validation_rejection_allows_new_intent`、`already_in_family_loads_current`、`auth_required_closes_session`、`new_account_cannot_consume_old_draft`、`double_submit_while_random_id_pending_shares_one_intent`、`logout_during_random_id_generation_prevents_persist_and_send`。现有 auth/session-boundary 回归继续运行。
- [x] **Step 2 — 确认红灯。** `task -d miniapp test -- tests/app/family-api.test.ts tests/app/family-controller.test.ts tests/app/session-boundary.test.ts`；预期缺少门面、恢复规则和家庭状态隔离。
- [x] **Step 3 — 实现 DTO 门面和 AppClient 接线。** Family API 使用 cloud.invoke，current 明确调用 `invoke('family-co','current',{})`，网络和业务错误分别保留；完成 DTO 校验后返回。AUTH_REQUIRED 在 invoke 的在途 Promise 已排空后调用 boundary.close，避免 close 等待自身死锁。production-client 返回 `{account,family}`；harness.client(uid) 也返回同一领域实现，AppClient.family 此时设为必需。旧测试 fixture 使用可信 harness family 或明确的测试 mock；不得在生产补永远 null 的实现。
- [x] **Step 4 — 实现意图存储和控制器。** 存储键为版本化 UID 编码，发送前持久化规范化 name/requestId，存储异常则不发请求。newRequestId 将 `wx.getRandomValues({length:16,success,fail})` 包装为 Promise，再转 32 位 hex；随机获取与格式转换放在 `intents.ts` 的小程序平台适配中，窄声明按当前锁定 types/微信官方签名核对，不引入浏览器 crypto 或 Node。若随机 API 不可用，显示可恢复失败，不使用固定值或 Date.now 单独作为 ID。single-flight 必须在等待随机 API 前建立，返回后重核可信 UID/代次，再持久化并发送；不能在异步生成 ID 时接受第二个意图。

  初次确定性 INVALID_INPUT 可清除意图供修改；一旦结果未知，后续 current=null、回执未见或另一次审核失败均不能证明旧调用终止，继续保留原意图，以成功重放/已存在家庭恢复为主。调用前设置 uncertain 防止进程中断丢失“可能已发送”状态，获得可信确定性拒绝后再清除。相同 in-flight 意图复用一个 Promise，不同名称在未决期间不另发请求。

  控制器以可信 UID 和会话代次隔离结果；observeAccountClosure 在清身份时同步清最后可信 UID 的 draft、家庭 view 和 pending，不仅在页面 signOut 按钮里清。查询失败 view 清空且 phase=unavailable，不能作为无家庭。dispose 释放观察；同应用只创建一份控制器，由 AppClient provider 注入，页面不重复建全局监听。
- [x] **Step 5 — 验证绿灯。** 重跑 Step 2，补跑 auth 回归；冷启动重建控制器仍复用原意图，SDK newToken 顺序、排空及新登录保持 #1 行为。读取/写入本地存储异常、DTO 错误均不触发创建或显示旧家庭。记录差异，不提交。

## Task 5：创建表单、家庭页与完整本地交付

**Files:** 修改 onboarding、route-guard、copy、pages.json、uni-stubs/Vitest 的 input 组件处理；创建 home.vue、`family-create.test.ts`、`family-home.test.ts`；补 auth 回归及实际产物边界断言。由 hide→show 旧请求重复导航回归发现，另最小修改 `src/pages/account/login.vue` 的局部 generation 保护，不改变登录/退出或云端认证逻辑。

**Interfaces:** 页面通过已有 `useAppClient()` 取得 provider 注入的同一 auth 和 FamilyController。`createRouteGuard(auth,navigate,family?:FamilyController)` 保留旧参数调用，family 只在使用新方法的页面传入；增加 `ensureFamily(destination:'onboarding'|'home'):Promise<boolean>`，缺少 family 的误用安全失败，不能默认为无家庭。由 controller.load 确认当前关系，页面传入的 navigate 闭包核对局部 generation/active 后才执行；保留 ensureAuthenticated 兼容 #1 测试。路由仅 `/pages/account/login`、`/pages/family/onboarding`、`/pages/family/home`，本票不加 tabBar。

- [x] **Step 1 — 写红灯 SFC 测试。** 用 mountPage 驱动实际 onShow/onHide/onUnload，新增 UniInput stub 的 value→detail.value 和 tap/disabled 行为，不能拿 DOM 原生 change 冒充 uni 事件。`family-create.test.ts` 覆盖创建后到 home、已有家庭直接分流、按钮防连点、中文错误、未决重试及请求时隐藏/退出后不得导航；`family-home.test.ts` 覆盖未登录→login、无家庭→onboarding、失败不显示旧名、恢复后显示正确 name/role。

  ```ts
  expect(page.wrapper.find('[data-family-form]').exists()).toBe(false); // current 失败/尚未确认
  expect(navigation.at(-1)).toBe('/pages/family/home'); // 唯一创建成功
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); // hide/logout 后
  expect(navigation).toEqual([]); // 隐藏页的迟到创建成功不导航
  ```

  新增路由循环测试：登录后无家庭恰到引导一次，已有家庭恰到 home 一次；home 的 current=null 不得反复 reLaunch。敏感状态依赖页面确认标记，不能单靠全局 view 直接显示。
- [x] **Step 2 — 确认红灯。** `task -d miniapp test -- tests/app/family-create.test.ts tests/app/family-home.test.ts tests/app/auth.test.ts`；预期缺表单、home、家庭分流。
- [x] **Step 3 — 实现页面与守卫。** `<script setup lang="ts">`，input/button/view/text 和 rpx 沿用当前风格。onShow 未确认先隐藏，使用生命周期局部 generation/active 阻止过期导航；onHide/onUnload 立即隐藏。表单按码点校验，原生 input 长度约束不能将 40 个非 BMP 码点截为 20 个；使用至少容纳 80 UTF-16 单元的 maxlength，业务校验仍严格 40 码点，并在表单测试覆盖。placeholder/标签/错误集中 copy.ts，不动旧 locale。home 只显示 name、本人 owner/member 与退出登录，不展示下一票按钮。退出统一调用已有 auth.signOut，观察链清 family/draft；退出远端失败仍本地清空。
- [x] **Step 4 — 验证页面绿灯。** 重跑 Step 2，再执行 `task -d miniapp check`；预期所有 suite、lint、三份 strict TS、微信构建、装配和源/产物门禁均 PASS。实际 app.json 恰三页，family-co/审核/测试模块不进包，公开云对象恰三个、公开业务方法总计五个。旧身份/SDK 回归不得减少断言以求通过。
- [x] **Step 5 — 准备本地证据和可审阅上传结果。** 在 `ops/task02-test-evidence.md` 记录基线与红绿场景、完整检查、工具版本和源码摘要；capabilities 明确 cloud/device 尚 pending。生成 task02 离线清单，列出更新公共模块对已部署 account-co 的影响及内容审核所需缓存 Schema/索引；出现新依赖资源时精确列入，不能默认初始化完整插件数据库。不上传、不自动提交。

## Task 6：隔离空间与微信真机验收

**Files:** 创建 `tests/cloud/task02-probes.ts`、`task02-client-checks.ts`、`ops/task02-cloud-checks.md`、`ops/task02-acceptance.json`、`tests/contracts/task02-ops.test.ts`；修改 doctor/deploy-preview/Taskfile 的 task02 入口及本票证据。保留 #1 acceptance.json 的历史含义。

**Interfaces:** `doctor({root,ticket?:'task02'})`；默认仍检查 #1，task02 模式使用本票 acceptance，只在 local/cloud/device 全部真实通过、正常工件摘要一致且无遗留测试入口时 ready。新增 `task -d miniapp task02:doctor` 与 `task02:preview` 为只读/离线检查。`task02-client-checks.ts` 定义 `SafeCheckResult={scenario:string;passed:boolean;errorCode?:string;counts?:{families:number;members:number;receipts:number}}` 和 `runTask02Checks(client:AppClient, inputs:{sameRequest:Mutation & {name:string};otherRequest:Mutation & {name:string}}):Promise<SafeCheckResult[]>`，只接收已登录真实 SDK 门面并返回去敏断言，不读取/打印 token；不同并发场景由调用者安排独立无家庭测试状态，不在函数内偷偷清理数据。

- [x] **Step 1 — 写验收门禁红灯。** `task02-ops.test.ts`：仅 #1 passed 时 task02 不 ready；缺任一场景/证据文件、源码摘要变化或遗留 probe 时不 ready；dry preview 不关联/上传/初始化空间。`task -d miniapp test -- tests/contracts/task02-ops.test.ts` 应先 FAIL。随后最小实现 ticket 模式、记录格式和明确 pending 状态，同命令 PASS；这是门禁通过，不是云端验收通过。
- [x] **Step 2 — 准备并审阅实测清单。** 在 cloud-checks.md 按下面 A～F 固定操作、数据范围、预期和脱敏记录字段。tests/cloud 的探针只使用同一已构建 kernel/home-family 工件；故障注入属于独立测试构建，不放进正式云根。若需要临时探针对象，在临时会话目录生成，单独列明对象名、源码摘要、仅隔离空间用途、允许操作和验收后确切清理目标；不得通过 production family-co 的 input 加故障开关。
- [ ] **Step 3 — 到上传边界再取得具体授权。** 本地检查通过后，只读核验 HBuilderX 实际工具/空间列表、既有资源和空间仍为隔离测试用途，更新 task02 清单中的 unknown。把 `mealie/env-00jy7289et7b`、每项新增/更新对象/Schema/索引/依赖以及测试工件和清理范围列给用户。仅在确认这些具体操作后上传；不沿用 #1 的历史上传许可，不覆盖未知同名资源、不全删集合。使用安装版本实际支持的 HBuilderX 命令/界面，不写虚构 headless uniCloud CLI。
2026-11-06：用户单独批准 13 项生产资源清单，上传、四集合与索引创建已完成并通过独立回读审阅；HBuilderX 类型库兼容修正经红绿测试和独立审阅，完整本地检查为 323 tests / 23 suites。原提案保持不可变，当前授权、修正及部署结果见 `miniapp/ops/task02-deployment.json`。两探针未部署，账号/精确记录绑定与测试清理授权仍待补齐；本步骤的完整测试授权门槛尚未解除。

- [ ] **Step 4 — 执行云端 A～E。** 记录 HBuilderX 真实 TS 编译/上传、目标运行时、模块解析和错误码样本；校准 Task 1 分类表后，只对有必要的改动重跑相关本地测试及 check。

  | 场景 | 操作与必须得到的结果 |
  | --- | --- |
  | A：真实身份/审核 | 两个专用微信账号近期登录；可信 openid 读取得到并只留云端；正常名称成功，官方审核明确 reject、审核不可用各不创建。记录真实服务结论，测试适配器模拟 reject 不算真实审核。若无法稳定取得审核拒绝样本则该项 pending，不能声称通过 |
  | B：幂等/并发 | 每个需要无家庭的场景使用新的专用账号，或在已批准范围精确清理该账号的测试 family/member/receipt 并记录一致性；同 ID 同名并发返回同结果、同 ID 不同名一成功一 CONFLICT、不同 ID 一成功一 ALREADY_IN_FAMILY；直接受控点查/计数仅一 family/owner/slot，无孤儿；跨 UID 使用同 requestId 不共享回执 |
  | C：事务/唯一性 | 实际 alipay 主键重复插入失败、原记录不变；同一逐文档事务在家庭/槽/回执各阶段失败后均零部分提交；探针隔离配置模拟“提交已完成，调用确认丢失”恢复原回执。客户端真实丢响应另测，不能把探针模拟说成真实 SDK 断网；事务和普通点读实际形状与适配契约一致 |
  | D：权限/限流 | 四集合逐项实际 clientDB read/create/update/delete 均拒绝；伪造/过期 token 拒绝，额外 uid/familyId/role 拒绝；独立云调用共享额度，UID 创建 11、current 61 命中配额；家庭桶可由已授权探针对已核验的真实测试家庭预填至 299，再用两次真实 current 验证第 300 成功、第 301 拒绝，避免为额度测试要求 6 个账号。过窗恢复；跨实例证据采用不同临时测试对象加载同一限流模块并操作同桶，或平台可核验的独立实例标记，工件均单独授权和清理；无法证明时保留 pending，不把两个客户端当成两个云实例 |
  | E：恢复/工件 | 真实 SDK 丢失创建响应后，原 requestId 重试恢复且计数不变；离线/重开后的 current 正确；probe 清理只针对授权名称和确切测试记录，保留原有身份资源；核验正常云工件与清单摘要，公开面仍只有五个方法 |

- [ ] **Step 5 — 执行真机 F。** 至少两账号分别创建并重进各自家庭；弱网复用原请求不会多建；已有家庭无创建入口；未登录直达回登录；创建期间退出/隐藏后迟到响应不恢复旧页，下一账号不见旧名称和草稿。记录真实设备与 SDK/构建摘要，不存 code、token、openid、密钥或用户原行。开发工具关闭域名校验的通过不能替代真机结果。
- [ ] **Step 6 — 汇总真实结果。** 逐条写本票 evidence 与 acceptance：`local/cloud/device` 的 status、evidenceFile、buildSha256、场景结果；未知均 pending。`task -d miniapp task02:doctor` 只有对应真实项齐全才 READY。本地全 check 已通过且无后续改动时不重复全跑；有适配/工件修正时重新验证受影响项。执行一次本票完整差异审阅，报告未完成项，不自动提交、关闭 #2、推进 #3 或发布生产。

## 2. 计划自审与交付

本计划由主代理自审，不派子代理代替 writing-plans 自审。

| 设计要求 | 实施与验证归属 |
| --- | --- |
| UID 槽、所有者一致、读快照与操作栅栏 | Task 1/2；Task 6 B/C/D |
| 家庭/成员/回执同事务、有限重试、commit 不确定恢复 | Task 1/2；Task 4 未决意图；Task 6 C/E |
| requestId 摘要、跨用户/旧 generation 不重放 | Task 2/4；Task 6 B/D |
| 名称 1～40 码点、字段白名单、真实文本审核 | Task 2/3/5；Task 6 A |
| 10/60/300 持久化限流、回滚不退还、过窗复用 | Task 2；Task 6 D |
| 真实云包、五方法白名单、四集合全拒绝及构建隔离 | Task 3/5；Task 6 D/E |
| 冷启动/弱网/迟到 SDK/页面导航/草稿账户隔离 | Task 4/5；Task 6 E/F |
| 独立验收、具体上传授权、保留 #1 证据、不自动提交 | Task 5/6 与第 0 节 |

自审同时核对了所有消费者的接口名称、测试 helper 来源与任务先后：事务接口属于 Task 1，FamilyApi/服务属于 Task 2，真实云端依赖属于 Task 3，AppClient.family 和客户端控制器在 Task 4 原子接线，页面在 Task 5 消费。没有生产假服务，也没有依赖后继邀请/成员票的夹具。

本票建议选择 **Subagent-driven**：事务、审核与会话恢复共享接口但故障边界不同，每个任务完成后由新上下文检查，更容易及时发现“重复提交成功但授权已失效”等问题。也可选择 **Native**：本会话逐任务实施，最后独立整体审阅。两种方式都执行同一测试和云端授权门槛；用户选定并审阅本计划后才开始实现。

## 3. 核对资料

- 已读本票批准设计与实际 kernel、harness、SessionBoundary、AppClient、onboarding、boundary/doctor/deploy-preview，不照抄 #1 的历史目录假设。
- Context7：uniCloud 事务 startTransaction 的逐文档限制、事务 get 返回形状，uni-sec-check V2 参数与 bridge 配置。
- [官方审核文档](https://doc.dcloud.net.cn/uniCloud/uni-sec-check.html)：V2 需要近两小时访问的 openid；模块依赖 bridge-common ≥1.1.2。家庭名按资料 scene=1，由真实返回和锁定源码确认成功状态。
- [官方插件市场 #5460](https://ext.dcloud.net.cn/plugin?id=5460)：2.0.2 为本票固定候选，尚未下载或实测，来源/归档摘要在 Task 3 记录。
- [腾讯官方随机数接口说明](https://intl.cloud.tencent.com/zh/document/product/1219/57715)：`wx.getRandomValues` 通过 success/fail 回调返回 ArrayBuffer，客户端 ID 生成端口因此采用 Promise，不能误写为同步随机函数。
- [官方数据库文档](https://doc.dcloud.net.cn/uniCloud/cf-database.html)和[索引文档](https://doc.dcloud.net.cn/uniCloud/db-index.html)：文档核对不能代替目标 alipay 事务/唯一性验收。

## 4. 用户验收与收尾 — 2026-11-06

用户明确确认“真机实测通过，关闭issues，根据文档和skills内容收尾”。该指令授权本次关闭 #2，替代上文“不自动关闭”的默认边界；不扩展为 Git 提交/推送/合并、生产发布、测试数据删除或启动 #3。按 finishing-a-development-branch 和 verification-before-completion 技能完成本地复验，保留 dev 分支和现有工作区。

最新 task -d miniapp check 为 350 tests / 23 suites 全通过；已验证 manifest 的 minified 与 lazyCodeLoading 进入产物。普通 Task 构建未注入 uniCloud 空间，实际预览使用 HBuilderX 关联已有空间后发行。真机通过按用户确认记录；未提供的 A～F 逐项证据、设备/发行包摘要和探针清理证据保持 pending，不将 Task 6 Step 3～6 全部标记完成，也不改变 doctor 的严格门槛。最终状态与摘要以 miniapp/ops/task02-acceptance.json、task02-deployment.json 和 task02-test-evidence.md 的收尾记录为准。

执行结果：[#2](https://github.com/pray4her/mealie/issues/2) 已于 2026-11-06T09:05:10Z 关闭（completed），已添加收尾评论；详细验收 pending 按上述原则保留。
