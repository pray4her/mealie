# Task04：本地验证与验收记录

日期：2026-11-09（Asia/Shanghai）。分支 `miniapp-dev`，基线 `171e49301`。本票四项正常资源已部署；用户随后明确确认云端业务、并发及真机验收完成，并授权关闭工单、提交推送。最终收束依据见 `task04-closeout.md`；以下保留代理当时的独立实测记录。

## 本地验证

- 基线：29 suites / 396 tests 通过。
- 云端生命周期测试先因方法缺失失败，再覆盖退出/移除/转移、双 generation 轮换、ABA、延迟首次请求、跨家庭/角色、事务竞争、各业务写点回滚和 commit-unknown 恢复。
- 客户端 API、持久意图、实际 SFC 测试先因缺失方法/按钮失败，再覆盖取消确认、单次发送、角色刷新、无槽 leave 恢复、转移后 member 身份恢复、隐藏/退出时的迟到响应。
- Task04 doctor/preview 测试先因未知 ticket/缺失模块失败，再覆盖独立证据、逐场景验证、源码及三类工件漂移。SDK 检查脚本通过真实领域 harness 自测，这仍是本地测试。
- 首次完整质量检查通过：34 suites / 441 tests；两项官方模块组装核对、零 warning eslint、客户端/云端/测试三组类型检查、微信构建、源码/产物边界与密钥扫描全部退出码 0；`git diff --check` 通过。
- 工具：Node 22.23.3、锁定依赖。当前会话缺少 Task/Corepack，逐项执行 Taskfile check 的同一 CLI 命令，Vitest 使用 `--maxWorkers=2`；没有安装依赖、修改全局工具或关闭 engines。检查日志在忽略的 `dist/task04-checks/local-check.log`。
- 一次独立 fresh-context 审阅发现两项 Important、无 Critical/Minor：隐藏后的 home/onboarding 仍可自动恢复未决操作；本地 clear 的瞬时 null 会被同步 watcher 误判为确认无家庭，令终态冲突恢复卡住。
- 四个真实 SFC 回归先分别失败（隐藏后重复发送 leave；终态恢复停在 idle），再修复：guard 在 await 前后检查调用页面 active/epoch；clear 先改变 phase 再清 view，不把本地隐藏当作云端确认。针对性 111/111 测试通过，没有增加第二轮审阅。
- 最终重新执行完整十步检查：34 suites / 445 tests 全部通过，零 warning lint、三组 TS、微信构建、边界与密钥扫描全通过；`git diff --check` 通过。最终源码及 CLI 包摘要见 `task04-acceptance.json`，与首次绿灯分开记录。

## 部署前的只读平台核对

HBuilderX `5.34.2026102909` 官方 CLI（协议 1）确认当前项目关联 alipay、mealie、`env-00jy7289et7b`。资源列表为三个云对象（account-co/family-co/uni-id-co）、九个公共模块、十五个数据库资源，四项拟更新资源均已存在。

以上名称与关联核对本身不证明远程源码一致、事务错误码/隔离语义、内容配置或日志采集安全。在该核对阶段未读取环境变量、身份原行或实际业务数据，也未上传资源、执行 JQL 或调用业务方法；后续用户授权的上传、私有依赖字节比较及环境格式核验单独记录于 `task04-deployment.md`。

## 后续验收

资源范围见 `task04-upload-scope.md`，逐场景步骤见 `task04-cloud-checks.md`。`task04-acceptance.json` 保留此前源码与工件、逐项独立证据状态；最新用户确认的业务验收单独记录于 closeout，不继承 #3 的验收结论，也不用本轮 CLI 重建替代实际受测包。
