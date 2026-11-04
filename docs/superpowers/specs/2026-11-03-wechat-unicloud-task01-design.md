# Task 01：微信登录与家庭引导补充设计

- 日期：2026-11-03。
- 状态：用户已于 2026-11-03 明确批准设计，随后授权按 #1 详细计划实施；已同意由本会话直接编排等价子代理实施／独立审阅流程，并允许安装必要官方 uniCloud／TS 插件。实现准备进行中，部署仍须另行确认。
- 对应工单：[pray4her/mealie#1](https://github.com/pray4her/mealie/issues/1)。
- 上位设计：`docs/superpowers/specs/2026-11-03-wechat-unicloud-design.md`；总计划：`docs/superpowers/plans/2026-11-03-wechat-unicloud.md`，本文件只细化 Task 01，不改变其余 18 票。

## 1. 意图与边界

让用户使用微信建立真实身份，进入尚未接入家庭业务的引导；退出或凭据无效后不能继续看到受保护状态。将独立工具链、云对象和测试作为这一闭环的一部分交付，而不是交付一套假登录脚手架。

所有产品代码及依赖新增在 `miniapp/`；不修改旧 `frontend/`、`mealie/`、根 Taskfile、旧依赖和生成类型。不实现创建/加入家庭、个人资料管理、账户注销或其他后续功能，不造一个恒为 null 的家庭 API。首版仅微信登录、不要求手机号、不提供密码账户或全局管理员注册入口。

## 2. 已知环境与授权

用户已确认以下测试资源存在，但尚未执行登录或云端能力验收：

| 项目 | 测试目标 |
| --- | --- |
| 微信 AppID | `wx68649810a6f363f3` |
| DCloud AppID | `__UNI__5FDC0D7` |
| HBuilderX | `D:\HBuilderX`；安装元数据 `plugins/about/package.json` 为 `5.34.2026102909` |
| uniCloud 服务空间 | 名称 `mealie`；spaceID `env-00jy7289et7b`；space appid `2021007114656325` |

这些标识不是 AppSecret。密钥由部署者在本地忽略配置或云端受控配置填写，不贴入会话、Issue、文档或构建产物；doctor 只报告缺失状态，不输出配置全文。云厂商、地域、运行时及当前空间内容在实际关联时核验，不凭 ID 格式当作已验证。

用户已选择 A：新子代理实施本票，另一新子代理独立审阅。本文批准后细化本票实施计划，再按选定方式推进；不自动推进 #2。Git 提交、生产部署、付费资源开通和旧服务停用均未获授权。实际上传测试空间前先列出目标及资源清单另行确认；不清空测试数据库、不覆盖空间已有同名资源。

## 3. 方案及选择

| 执行方式 | 取舍 | 决定 |
| --- | --- | --- |
| A：子代理实施，独立代理审阅 | 多一次独立上下文，成本略高；能较早发现身份、刷新和打包边界错误 | 用户已选择 |
| B：本会话实施，完成后独立审阅 | 上下文集中、成本较低；问题可能到最后才被发现 | 未选择 |

技术路线沿用已批准的官方 Vue 3 `vite-ts` 模板、uni-id 和薄云对象。以下细节原由实施者提出，现随本补充设计获批，不声称用户最初逐项主动提出。

平台核对发现，原样部署完整 `uni-id-co` 无法满足云端关闭非首版接口。因此，在既定技术路线内采用已随本文获批的“上游只读源 + 受控部署装配”：保留来源与摘要，只生成一个最小公开入口的部署包。相比维护上游入口的小补丁，多一个装配步骤，但能清楚区分上游文件与自有安全策略；小补丁方案更短，却会在升级时产生源码差异。不采用“只隐藏按钮”或依靠缺配置让其他接口偶然失败的方案。

## 4. 登录、会话与退出

- `AccountApi.signInWeixin()` 是客户端门面：通过 `uni.login({provider:'weixin'})` 获取短期 code，直接调用官方 `uni-id-co.loginByWeixin({code})`，随后调用 `account-co.session()`。不能让 `account-co` 转调 `uni-id-co`；官方文档明确后者目前不支持由其他云函数/云对象调用。
- `account-co.session()` 从 `this.getUniIdToken()` 与 `this.getClientInfo()` 取得平台调用信息；clientInfo 中的客户端字段仍需校验，不将它们当作身份凭证。`requireIdentity` 首先用 `checkToken(token, {autoRefresh:false})` 验证，再读取当前 `uni-id-users`：账户存在、status 为缺省或 0、请求 token 仍在其有效 token 数组内，并检查适用的 `valid_token_date` 撤销界限。仅校验 JWT 不足以保证用户尚未退出、禁用或注销。不能接受客户端传 UID 作为认证，不解析一个未验证 JWT 就建立身份。
- 完成上述检查后才允许 session 续期；正常账户检查不能被 token 内缓存的角色权限跳过。新注册时通过官方 `beforeRegister` 钩子显式写 status=0，并禁止密码及全局管理员属性；钩子是纵深校验，不能替代公开方法 allowlist。
- 对外保留总计划的 `Identity`/`AccountApi` 契约；成功会话的业务 data 只包含 UID 及契约允许的续期信息，不回传 openid、session_key、用户整行或云配置。平台 `newToken` 放在响应顶层，由统一调用适配层处理；页面不各自实现一套续期。
- 严格区分认证拒绝与暂时网络失败：无效、过期或伪造凭据清空身份并返回登录；网络失败不当作账户被注销，也不展示未经确认的受保护数据。启动与页面重新显示时重新校验，不能以本地存在 token 视为登录成功。
- `signOut()` 尝试调用受控入口中的官方退出逻辑；入口的退出鉴权不自动续期，不能直接沿用上游会先续期的退出中间件链。退出成功后，使用刚才提交的 token 调用 session 必须拒绝。无论网络结果如何都清除本机 token、身份及受保护页面状态；远端退出未确认时不宣称服务器已撤销凭据。Task 01 不新增“全设备退出/整条历史续期链撤销”功能，不能声称官方 logout 已提供它。
- SDK 会在业务 Promise 返回前自动保存 `newToken`，因此仅在 `invoke()` 返回后忽略旧结果不够。客户端统一会话边界维护持久化的退出标记、会话代次及在途请求栅栏：退出即隐藏受保护状态并停止旧代次的新调用；旧请求排空前不开始另一轮登录，对迟到的 SDK token 写回再次清除，排空后再清一次。不能仅用 Promise.race 的超时就认定底层请求已经结束，也不把刷新事件监听器当作可取消写入的官方机制。冷启动在退出标记下拒绝凭残留 token 自动恢复。测试需覆盖持久化 token 和下一次登录，而不仅是 Vue ref；真实 SDK 下仍须实测。
- 调用边界设置可配置的节流与登录防重复提交；不把按钮防连点当成服务端权限或跨实例限流。Task 02 的持久化用户/家庭限流桶不在本票提前搭建。
- Task 01 的引导不提供家庭业务数据，且不查询不存在的家庭服务。身份守卫覆盖直接打开受保护路由、返回历史页面及应用恢复，不只在登录按钮回调中导航。

## 5. 非微信入口与工程隔离

### 5.1 官方源码与最小部署面

- 官方 `uni-id-pages` 及配套资源锁定 revision/版本/摘要、保留许可；原始源码归档在 HBuilderX 不自动发现的 `miniapp/vendor/`。以可重复装配生成 `src/uni_modules/` 所需客户端与公共资源，并在物理项目云目录生成唯一的受控 `uni-id-co` 部署包。上游原始对象不能同时残留在会虚拟合并的插件云目录里。
- 装配包在包内保留上游所需目录结构，自有入口显式选择方法与生命周期，禁止展开全部上游导出。Task 01 只公开 `uni-id-co.loginByWeixin`、`uni-id-co.logout` 和 `account-co.session`；其他方法默认不可调用，包括 `registerAdmin`、密码/短信登录、`closeAccount`、通用文件访问和用户管理接口。没有单独的刷新入口：session 按上述规则返回续期结果。
- 受控入口复用官方微信登录及退出模块；自有策略补上默认拒绝、账户/token 实时检查及退出不续期。不得改写上游压缩发行库、内部 lib 或生成文件，不重新实现微信 code 交换或 JWT 签名。装配脚本、策略及生成物来源可审阅；升级后重新生成、检查导出与直调拒绝。
- `loginTypes:['weixin']`、关闭登录后设密码及不注册非首版页面只负责客户端收敛。`config/permission.js` 对未配置方法可放行，且有管理员旁路，不作为全局禁用机制；不编造 `enabledMethods` 等不存在的配置。
- 这是自有部署装配，不是声称官方有现成裁剪选项。上传前验证只存在一个可发现的 `uni-id-co`，不依赖同名目录覆盖优先级，不上传原版完整对象。若 HBuilderX 无法支持这种装配或必要官方流程需要额外公开方法，停止并报告，不能静默扩大公开面。

### 5.2 CLI 工程、云目录与检查

- HBuilderX 导入整个 `miniapp/`，不是仅导入 `src/`；插件位于 `miniapp/src/uni_modules/`，插件内部云目录仍为无厂商后缀的 `uniCloud/`。
- 总计划中的 `miniapp/uniCloud/` 修正为逻辑云根。项目物理云目录采用 HBuilderX 为目标空间实际识别的 `miniapp/uniCloud-<provider>/`；先核验现有空间厂商再固定为其中一个，不仅凭 spaceID 推断。后续本票计划和类型引用使用同一物理路径，不维护两份云源码。
- 公共模块按实际物理路径显式声明 file 依赖，并通过 HBuilderX 的依赖管理核对；虚拟合并的引用不假装是磁盘上的真实目录。TS 自有云对象用 `index.obj.ts` 具名导出，公共模块用根 `index.ts`，不额外导出辅助函数成为公共入口。
- `tsconfig.cloud.json` 只做本地 noEmit 检查；HBuilderX 使用自己的固定 TS 编译配置，不能靠本地 paths alias 替代真实依赖或把本地 tsc 当作云端编译成功。
- 官方存在 HBuilderX uniCloud CLI，可在另行确认后用于对应测试操作；不假造独立 npm/headless 部署工具，也不写成“官方没有云部署 CLI”。doctor/check 不触发资源上传、覆盖、空间关联或数据库初始化。
- 本机只读发现 `unicloud_proxy`，未据此证明完整云编译插件已就绪；缺少 HBuilderX 云插件时报告，并由用户确认安装，不把 IDE 版本号当作插件能力实测。

客户端只能 type-only 引用 `home-contracts`；不得导入 `home-kernel`、Node 实现或云端配置。每个自有云对象/公共模块保留独立 package.json，部署包不引用包外相对源码。领域和云端适配测试必须调用同一身份校验逻辑，可信 fixture 只能模拟测试身份，未知 UID（例如 `forged`）默认不可信。

## 6. 验收与停止条件

按总计划先写失败测试、确认业务红灯，再最小实现并验证：

- `tests/domain/identity.test.ts`：无 token、伪造/过期 token 拒绝；合法身份只返回约定字段；续期语义及退出后的凭据处理。
- `tests/domain/identity.test.ts` 还覆盖签名有效但已从 token 数组撤销、账户被禁用/注销及撤销时间界限；退出路径不得生成新 token，不把 JWT 验签通过误认为当前账户有效。
- `tests/app/auth.test.ts`：登录/恢复/退出/直接打开受保护页；网络故障不误判为认证成功；退出前请求及近续期阈值 logout 的迟到响应不恢复 token；下一次登录不被旧账户响应覆盖；冷启动尊重退出标记；非微信入口不展示。
- `tests/contracts/boundaries.test.ts`：客户端无运行时云模块/密钥，部署包无逃逸依赖，实际公开接口不含密码及管理员注册入口。
- `task -d miniapp check`：独立 lint、客户端/云端本地类型检查、单元/页面测试、微信客户端构建与边界/密钥扫描。
- 独立云端记录：HBuilderX 识别项目布局、TS 公共模块真实编译上传、真实微信登录/退出、无效凭据云端拒绝及非微信接口直接调用拒绝。
- 微信真机记录与云端记录分开于本地测试；任何未执行项明确为未通过。未完成真实验收时不关闭 #1，也不以 mock PASS 解锁 #2。

Vitest 独立配置只加载测试所需 Vue 编译插件，不加载小程序生产插件。领域/边界测试使用 Node，页面测试使用 DOM 与有 slot/事件语义的 uni 组件 stubs；显式驱动页面实际注册的 onShow/onHide 等回调，不用 onMounted 冒充小程序生命周期。测试依赖须匹配模板的 Vite 版本，不直接安装不兼容的最新版；本地页面测试不冒充微信页面栈、SDK 自动续期或真机导航证明。

工程初建时锁定官方模板 revision、成套 DCloud 包版本、本地受支持 Node LTS、pnpm 及测试工具版本；这些兼容性选型由实施者决定并记录，不照抄旧前端版本。本机已只读确认 Node `v22.23.3` 可运行，优先作为独立工具链的兼容性候选，不把 HBuilderX 内置 Node 当作已选云运行时。HBuilderX TS 编译失败、无法安全关闭接口或无法识别目标云目录时停止并报告，不静默换成旧后端或假成功。

## 7. 依据

- 工单 #1 的正文、评论、状态和直接阻塞已通过 GitHub CLI 读取：开放、无指派、无前置阻塞，环境确认前标签为 `needs-info`；本轮尚未修改工单。
- 2026-11-04 用户确认云端与真机验收完成。据此勾选 #1 的验收标准、移除 `needs-info` 并关闭工单。脱敏记录在 `miniapp/ops/test-evidence.md`，doctor 记录在 `miniapp/ops/acceptance.json`。不开始 #2。
- 旧代码参考：`frontend/app/composables/use-auth-backend.ts` 及其测试、`frontend/app/plugins/__tests__/axios.test.ts`；只借鉴退出必清状态和认证错误/网络错误区分，不搬入 Cookie、Axios、Nuxt 或 FastAPI。
- [官方 uni-app CLI 模板](https://uniapp.dcloud.net.cn/quickstart-cli.html)。
- [uni-id-co 登录、响应及云端调用限制](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-object.html)。
- [uni-id-common 身份校验](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-common.html)。
- [TS 公共模块](https://doc.dcloud.net.cn/uniCloud/cf-common.html#typescript)。
- [项目云目录](https://uniapp.dcloud.net.cn/tutorial/project.html)、[插件目录与云资源虚拟合并](https://uniapp.dcloud.net.cn/plugin/uni_modules.html)、[云函数固定 TS 编译配置](https://doc.dcloud.net.cn/uniCloud/cf-functions.html#typescript)。
- [HBuilderX uniCloud CLI](https://hx.dcloud.net.cn/cli/uniCloud)、[SDK token 刷新事件](https://doc.dcloud.net.cn/uniCloud/client-sdk.html#on-refresh-token)。
- 官方开源源码核对基线 `hello_uni-id-pages` revision `993791b9…`（2026-10-16，uni-id-pages 1.1.29、uni-id-common 1.0.17）；这不是已完成导入/依赖锁定或实测的声明。实施时记录完整 revision 与摘要，不用缩写代替供应链锁定。
- 根 `LICENSE` 为 AGPL-3.0；新目录不改变原项目的许可义务，导入官方插件时保留其许可及版本来源，不擅自改为一个“全新独立许可”的工程。

## 8. 独立检查与剩余决策

两位只读调研代理分别核对身份安全和目录/TS/测试机制；另一位独立实施者检查仅提出第 5 节机制尚须补齐，没有发现新增的用户产品问题。上述核对结果写入本文后，独立实施者复查结论为“nothing important left”。待实施者决定的仅有兼容依赖版本、具体装配文件拆分、配置化阈值及真实厂商适配细节，不能改变公开方法集或放宽验收。

本文及详细计划 `docs/superpowers/plans/2026-11-03-wechat-unicloud-task01.md` 均已获用户授权执行。实施开始前已读回并认领 #1（无直接阻塞），未修改其标签或关闭工单。HBuilderX 官方 uniCloud 插件安装成功后，只读列表确认目标空间厂商为 alipay，唯一云根固定为 `miniapp/uniCloud-alipay`；地域与运行时仍待核验。后续实施状态及真实测试证据以计划和 `miniapp/ops/` 中实际记录为准；Git 提交、云资源上传／覆盖和生产操作仍未获授权。2026-11-04 用户确认验收完成后，#1 已关闭；该确认不授权生产部署，也不开始 #2。
