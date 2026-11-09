# SDD ledger — plan: docs/superpowers/plans/2026-11-08-wechat-unicloud-task03.md

当前状态（2026-11-09）：实现已交付，按用户明确指定的“相关验收和其他验收均已完成”前提收束并关闭 #3。最终结论见 `task03-closeout.md` 与 `task03-acceptance.json` 的 closeout；以下为历史执行账本，pending/NON-READY 描述保留当时的证据状态。

- Ruling: 在用户指定的干净miniapp-dev功能分支直接实现，不创建额外worktree或提交 — 保持改动在用户当前工作区且遵守不提交约束 — 代价：没有第二checkout隔离；只修改计划范围。
- Pre-flight: Tasks1→2共享邀请记录/回执/凭据接口；Tasks1/2→3共享FamilyApi；Tasks1/2/3→4共享公开面、Schema、路由、harness；无相互矛盾。
- 工具链：系统Node22.23.3；由其Corepack下载并调用项目固定pnpm10.20.0，未修改全局版本或engines。Task.exe已在Winget目录发现，按会话PATH使用。
- Task 1: complete — invite/list/revoke领域、严格DTO、公开云对象与安全配置惰性读取已测试。
- Task 2: complete — 并发消费、UID槽、回执、rollback/commit未知和时间边界测试通过。
- Task 3: complete — 实际SFC卡片/登录/确认/重试/互斥/隐藏及旧页面卸载测试通过。
- Task 4: local complete — task check -- --maxWorkers=2通过，392 tests / 29 suites，微信构建与扫描通过。云端/真机仍pending。
- Ruling: 撤销的持久化回执结果使用空对象，wire仍返回null映射void — 复用现有bsonType object避免引入未核验的nullable Schema形状 — 代价：云端回执验证器要按操作严格校验。
- Ruling: 保留损坏关系测试用的可信seed fixture，新增invitedFamilyFixture走真实create/invite/join — 不让正常流程掩盖旧损坏关系测试的初始条件 — 代价：两种fixture用途要区分。
- Ruling: 本地未决加入摘要采用有固定向量测试的限定ASCII SHA-256实现 — 小程序无WebCrypto且没有现成客户端SHA依赖，避免引入新依赖或落地明文token — 代价：该短算法需保留向量测试，授权签名仍只在云端验证。
- Ruling: 全量检查使用maxWorkers=2 — 默认高并发在当前Windows触发两个既有I/O测试超时，限制并发后通过 — 代价：本机测试运行稍慢；未改变超时和断言。
- Final review: 独立fresh-context只读审阅；两项Important、零Critical/Minor。没有进行第二轮审阅。
- Final: fixed 首次匿名SDK边界丢卡片续接 — real_sdk_anonymous_close_preserves_card_but_explicit_logout_erases_it RED→GREEN；显式退出使用独立代次，初次无UID校验失败与账号退出分开。
- Final: fixed 撤销意图全局锁死其他独立邀请 — used_invitation_revoke_failure_cannot_block_revoking_an_independent_invitation 与 a_revoke_committed_while_hidden_cannot_lock_other_invites_after_reopen RED→GREEN；按invitationId隔离意图，终态清理，不确定结果仍复用原请求。
- Final: Ruling: 真实事务错误码/隔离、云编译、平台日志采集、微信生命周期只作为待实测门槛 — 文档和本地替身不能证明目标空间能力 — 代价：本票仍需云端/真机验收，不能据本地通过发布。
- Final: Ruling: 既有不确定join收到失效错误仍保留原请求 — 旧请求可能仍在途，不新建相互竞争意图 — 代价：用户需用原卡片恢复，或显式退出后重新确认当前家庭。
- Final: Ruling: Task04退出/移除/转移入口不纳入本票 — 保持批准范围，文档已规定未来所有权代次轮换 — 代价：后续票必须实现并实测该约束。
- Final: Ruling: 将CLI检查包与关联空间真机发行包分开绑定摘要 — 两者的空间注入不同，不能用CLI构建代替device证据 — 代价：真机验收须保留实际发行工件；门禁回归已先失败再修复。
- Final verification: task -d miniapp check -- --maxWorkers=2完整通过，396/396 tests、29/29 suites，lint/三组TS/微信build/边界与密钥扫描通过；git diff --check通过，修改仅miniapp和本票docs。保持miniapp-dev，不提交/合并/推送。
- Delivery: task03-acceptance绑定最终源码与CLI包；真实云编译/空间配置/云端场景/真实发行包/真机均pending。task03-upload-scope列七项正常资源；独立暂存核对七项源码及三份受保护远程模块全部16文件；只初始化新family_invitations的窄数据库暂存已准备。尚未上传、未修改真实数据。
- Deployment 2026-11-09: 用户确认测试空间并批准七项清单/新集合与索引/两个环境变量。真实上传全部成功，HBuilderX类型检查编译通过，Schema回读相同；三份身份/配置/bridge模块上传前后16文件字节相同。密钥仅远程配置且回读核对，不记录值；官方下载实际正常JS工件与关联空间微信发行候选包分别保存并绑定摘要。未执行真实业务或故障注入，不提交Git、不关闭工单。
- Deployment: Ruling: 将资源部署和完整业务验收分别记录 — 上传回执、Schema/密钥回读、编译及打开开发者工具不能证明并发、日志或真机分享 — 代价：严格门禁仍NON-READY，需专用登录会话与平台日志检查。浏览器最小化且Computer Use恢复失败，本轮日志采集检查未完成。
