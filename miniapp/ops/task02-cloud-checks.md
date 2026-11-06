# Task 02 隔离云端与真机验收手册

2026-11-06。用户已确认真机实测总体通过并授权关闭 #2；详见 task02-test-evidence.md 的 User acceptance and issue closeout。本文详细云端/真机场景仍保留实际证据状态，不根据总体结论自动全部勾选通过。执行结果写入本票 evidence，逐场景更新 [task02-acceptance.json](task02-acceptance.json)，不能复用 #1 的通过状态。

## 目标、上传边界及数据范围

目标为 alipay `mealie/env-00jy7289et7b`，DCloud AppID `__UNI__5FDC0D7`，微信 AppID `wx68649810a6f363f3`。执行前由用户确认仍是隔离测试用途。准确生产资源、只读现状、源码摘要和保留方案以 [task02-upload-scope.json](task02-upload-scope.json) 为准；[capabilities](task02-capabilities.md) 记录安装工具与核验依据。

仅上传已获批准的窄 staging：新增 family-co/home-family/uni-sec-check、更新 home-contracts/home-kernel，四个业务 Schema 和 family_members 普通 familyId 索引。保留 staging 中从目标只读下载的 uni-id-common、uni-config-center、uni-open-bridge-common 原字节；本机身份模块有版本差异，不能直接整树上传。非 force 上传也可能覆写传递依赖，不能把省略 force 当作保留保证。凭据配置仅留仓库外，不打开、不打印、不写入文档或摘要清单。

不上传 account-co/uni-id-co、其他插件或十个旧身份 Schema；不进行全插件数据库初始化，不删除集合，不创建付费资源。上传前再次核对同名冲突及 file 依赖闭包，发现变化即更新清单，不能覆盖未知资源。使用已安装 HBuilderX 实际支持的 CLI/界面；本工具没有上传命令。数据库 inspect-initialize-conflicts/list 和 cloud-resource list/list-dependencies/inspect-upload-conflicts 为只读核验入口，参数以安装插件的 contributes.clicommands 为准。

测试至少用两个专用真实微信账号。每个需要无家庭的并发/故障场景使用新的无家庭状态；复用账号必须先取得该场景精确记录清理许可，不能暗中清空。账号 UID 在真实 account.session 校验后只在本机私有配置中绑定；不把 code、token、openid、用户原始行或密钥粘贴到聊天、日志或 Git。

## 本地入口与门禁

从仓库根运行：

```text
task -d miniapp check
task -d miniapp task02:preview
task -d miniapp task02:doctor
```

preview 是离线清单，所有资源一直为 blocked-no-upload。doctor 默认仍是 #1；task02:doctor 只读取本票。缺任一 A～F 场景、非空证据文件、当前源码/正常工件摘要或探针清理确认均为 NON-READY。门禁测试通过仅证明拒绝不完整记录，不能证明真实云端能力。

源码摘要覆盖 src（含锁定插件，排除 uni-config-center 内 config.json）、正式云根、cloud-policies、依赖锁/编译配置及上传 scope；不读取凭据配置。微信正常产物为 dist/build/mp-weixin；真实 HBuilderX 正常云工件待取得后复制至 dist/task02-normal-cloud（保持目录结构并排除凭据配置），才有 cloudBuildSha256。摘要统一用排序后的相对路径、NUL、原始字节、NUL；不同作用域的摘要不可互相替代。task02Snapshot 可只读重算；修改源码/上传 scope/任一正常工件会使既有验收失效。

每阶段及每场景的记录需要 status、evidenceFile 和 evidenceRef。阶段另有 buildSha256；cloudArtifact 另绑定 sourceSha256。证据应记录观察时间、场景、目标、工具/云运行时、实际构建摘要、前后计数和结论。未执行/不确定均 pending。空的通过描述、仅 #1 标记或仅本地 fixture 不能作为依据；线下记录的真实性由实际执行人员负责，离线 doctor 不访问云端。

## 临时探针工件

```text
node miniapp/scripts/stage-task02-probes.mjs
```

仅在系统 TEMP/opencode 下创建随机 task02-probes-* 会话目录，生成 `uniCloud-alipay/cloudfunctions/task02-probe-a`、`task02-probe-b` 和 task02-probe-manifest.json。生成器不读取任何云配置、不关联/上传/初始化空间，不修改正式云根或客户端。每次生成打印该目录、两个对象的 sourceSha256 和公共模块源码摘要；源码摘要算法见 manifest。正式部署 preview 的三对象五方法约束保持不变。

探针的 run 只接受一个固定 operation 字段；UID、familyId、generation、requestId 都不能从请求参数指定。每次请求用真实 uni-id token、AppID/platform、账号状态校验；可信身份必须匹配服务器固定 actors allowlist，且 operation 也在服务器许可内。生成的 actors=[]，默认所有调用均拒绝；没有生产假身份、默认恒通过审核或管理后门。

两个对象加载同一实际 HBuilderX 编译的 home-kernel/home-family 公共模块；生成器只编译测试 runner，并不声称已编译正式业务。将两个对象放入单独已批准的测试 staging，保留公共模块和 protected dependencies 的既有路径；以正常 family-co 同一次构建/部署的模块 SHA 核对，不能复制修改过的业务逻辑或 memory-database 进入探针。实际 HBuilderX 编译、解析、对象上传、actor 绑定和工件摘要目前全部 pending。

绑定前在私有 probe-config.json 中填真实 UID、固定 familyIds/generationIds/requestIds、名称、allowedOperations、allowCleanup（默认 false）。故障创建用固定的首个 familyId/generation，避免未列明的随机记录；正式 family-co 的随机 familyId/generation 必须从真实成功结果核验后单独绑定。requestId 必须符合 16～128 ASCII 白名单。receiptIds 由真实 requestLimit/receipt 函数导出，quotaBucketIds 同样使用 home-kernel 的 requestLimitBucketId；绑定后更新 manifest，重算对象 SHA，列出确切记录并取得本次测试操作及清理授权。空模板不是可执行的数据许可。

操作范围：rollback-family/member/receipt 在真实事务完成该次 insert 后抛错，实际平台 rollback；commit-ack-lost 在业务事务已成功提交后抛 DatabaseFault，再由原业务恢复回执；primary-key 只在指定 familyId 写临时测试行；sdk-shapes 只读指定应为空的 familyId 并提交只读事务；counts 只点读 allowlist；consume-current 使用当前 UID 的真实 current 桶；prefill-family-current 先验证当前 owner/家庭，再仅将该测试家庭当前窗口桶置为 299；cleanup 仅删除绑定的精确记录并核对 owner/generation/receipt/subject，任一不符整笔拒绝。

**counts 仅是 allowlist 点读计数。** 它不能证明正式 family-co 随机生成的记录没有额外孤儿；B 必须另做限定 UID 的只读管理查询总计数。primary-key 临时家庭行没有成员，是该场景特意创建的测试数据，必须单独清理后才能进入其他场景。

## A：真实身份与名称审核

1. 两账号近期登录，真实 account.session 校验通过。可信 wx_openid 只在云端从该 UID 读取，V2/scene=1；记录服务可用性和运行时，不记录标识值。
2. 正常名称真实审核通过、创建成功。40 个非 BMP 字符按码点判长；空白、控制字符、41 码点和额外字段拒绝。
3. 用独立无家庭状态获得真实官方明确 reject，前后业务总计数为 0；再实测真实审核服务不可用不写入。探针模拟 reject/unavailable 或任意不合法输入均不算服务拒绝/不可用证据。不能稳定取得真实样本则对应项 pending。

## B：幂等与并发

在开发工具专用测试会话中注入**已经真实登录的 AppClient**，运行 tests/cloud/task02-client-checks.ts 导出的工具，不导入到正式 src：

- runTask02Checks(client,{sameRequest,otherRequest})：先确认无家庭，同 ID 同名两个并发、顺序重放、另一 ID 在创建后拒绝、current 一致。它不假称另一 ID 是并发测试。
- checkTask02Race(client,[first,second],'different-request')：新的无家庭状态下两个 ID 并发，一成功一 ALREADY_IN_FAMILY。
- checkTask02Race(client,[first,second],'conflicting-payload')：新的无家庭状态下同 ID 不同名并发，一成功一 CONFLICT。
- 两个 UID 用同 requestId 分别创建，结果不共享 familyId/receipt。不得把伪造 UID 当真实账号隔离测试。

每组都由受控只读管理查询 `families.where({ownerUid:verifiedUid}).count()`、`family_members.doc(verifiedUid)` 与 `mutation_receipts.where({uid:verifiedUid,operation:'family-create-v1'}).count()` 核对总数；检查槽 familyId/owner/generation、回执引用与家庭相互一致，且仅一个 family/owner/slot/receipt，无额外 orphan。只记录计数与本机请求关联摘要，不导出原行。SDK 工具输出 SafeCheckResult，不输出 UID/家庭名称/token，且不会自行清理或补造计数。

## C：真实事务、唯一性与不确定提交

1. 空记录普通 get 的 data 形状、事务 get 形状和 commit 成功形状通过 sdk-shapes 观察；该操作要求指定 familyId 当前确实为空。当前已安装的支付宝 SDK 成功 commit 返回 fulfilled undefined，探针按生产适配契约同时接受有效的对象确认，保留实际返回形状；拒绝的 Promise、畸形或失败确认仍不能通过。本机 SDK 契约测试不代表本项云端实测通过。实际不符必须保留失败并修正适配，不能把文档形状当实测。
2. primary-key 对指定 familyId 重复插入；必须失败且原字段不变。受控记录实际 provider 错误的 code/errCode 原始类型和精确值（不保存 message/原始响应），再校准 conflictCodes。当前生产默认空表，不以 fixture 码替代目标 SDK。
3. 三个独立无家庭状态运行 rollback-family/member/receipt。故障在真实插入后发生；家庭、槽、回执都为 0，已消费限流保留。不能在较早的限流事务注入后声称业务事务回滚通过。
4. commit-ack-lost：真实业务提交后测试 wrapper 故意丢弃确认，原业务读回回执返回原结果，计数为 1/1/1。它仅验证恢复算法与真实 DB 提交结合；E 仍必须另测真实 SDK 丢响应。

## D：权限与持久化额度

四集合 families/family_members/mutation_receipts/request_limits，逐个实测客户端 read/create/update/delete（共 16 项）。使用明确的专用测试文档 ID/合法结构，确认是权限拒绝，而非字段校验失败；尝试前后的受控点查证明未改变数据。若意外允许，立即停止并仅在批准的精确范围恢复，不能继续验收。

生产对象拒绝伪造 token、真实过期 token，以及额外 uid/familyId/role；真实账号 A 不能指定 B 的关系。请求输入拒绝不等于 token 验证通过，分别记录。

固定一分钟窗口内：合法创建请求（含真实审核拒绝/已有关系等）第 11 次命中 10 配额；current 第 61 次命中 UID 60 配额。不要用输入校验阶段即拒绝的请求冒充消耗创建额度。家庭桶可在已授权探针确认真实家庭后预填 299，紧接两次真实 family-co.current，300 成功/301 QUOTA_EXCEEDED；UID 额度须尚未用尽，跨窗需重做。等真实服务端跨窗后恢复成功。

跨实例采用两个独立临时对象 task02-probe-a/b（同一模块工件、同一真实 UID/current 桶）：新窗口由 a 顺序消耗 59 次，b 第 60 次成功，a 第 61 次拒绝，记录两个对象的部署摘要/调用时间及同桶窗口证据。两个 SDK 客户端、同对象两次请求或随机标签不能证明独立云实例。没有独立对象/平台实例证据则 D-cross-instance pending。两对象不复制各自内存限流状态。

## E：恢复、清理与正常工件

真实 SDK 网络层丢失创建成功响应，保持原 requestId/name，恢复网络后重试，返回原结果，受控总计数不变；另做离线、重开 current 与已有家庭恢复。C 的 wrapper 模拟不能替代本项。

只清理已批准的两个探针对象名字及该轮 manifest 精确列明的业务记录：families 的显式 ID、该真实 UID 的成员槽（限定 familyId/generation）、该 UID/operation/requestId 的成功回执 ID、对应 uid:create/uid:current/family:current 桶。先核验所有归属，再在事务中删除；不使用 where(...).remove() 或集合全删。不删除 uni-id-users、已有身份资源、十个旧 Schema 或账号凭据。

使用受控资源列表确认两个 probe 名字均不存在、无其他测试入口；确认正常云根/编译工件只有原三对象五方法，并核验正常云与微信产物摘要。填写 cleanup verified 与 remaining=[] 必须附实际资源列表及精确记录核对证据，不能仅因本地临时目录被删除而勾选。未清理或无法证明时保持 NON-READY。

## F：微信真机

至少两个专用微信账号分别创建并重进自己的家庭；已有家庭无创建入口；未登录直达保护页回登录。弱网重试复用原 requestId，不多建。创建期间退出/隐藏页面，迟到响应不复活旧页面；切换账号不见旧名称或草稿。记录真实设备/微信 SDK、时间、构建摘要和每场景结果；开发工具关闭域名校验的通过不能替代真机通过。

## 当前实测结果

- 13 项生产资源已获单独授权并完成上传、集合创建及独立回读核验；正常云编译与 E-normal-artifact 已通过。Cloud A～E 其余业务实测仍 pending，测试账号绑定、精确测试/清理范围尚待列明和授权。
- Device F：pending，尚未取得本票真实设备结果。
- provider 错误码、actor 绑定与最终探针清理证据：pending。当前真实编译工件和部署回执见 task02-deployment.json 与 task02-test-evidence.md；旧的空 actor 探针候选需按当前公共模块重新核对、绑定后才可执行。
