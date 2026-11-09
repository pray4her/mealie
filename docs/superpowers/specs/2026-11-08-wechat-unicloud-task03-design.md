# Task 03：邀请家庭成员补充设计

状态：2026-11-09 实现已交付；用户明确要求按相关及其他验收均已完成的前提收束文档并关闭 #3。收束依据与核验边界见 `miniapp/ops/task03-closeout.md`。保留当前分支，不自动提交 Git、上传测试资源或发布生产。2026-11-08 的实现批准和以下设计约束保留为历史依据。

依据：2026-11-03-wechat-unicloud-design.md、总计划 Task 03、GitHub pray4her/mealie#3。

用户选择微信原生分享卡片加手动粘贴邀请码，允许多份邀请独立有效并逐条撤销。未选择仅手动复制方案；不限制家庭人数为两人。

## 契约与行为

- 保留 FamilyApi.current/create；新增 invite(Mutation)、revokeInvite(Mutation & {invitationId})、join(Mutation & {token})、members() 与 invitations({cursor?})。
- invite 返回 invitationId/token/expiresAt，join 返回 FamilyContext，members 返回 uid/nickname/role。邀请列表每页20条，只含 invitationId/createdAt/expiresAt/status/nextCursor；仅所有者可管理或列出邀请。
- 凭据为 v1.kid.invitationId.mac；128位随机记录ID、独立256位云密钥、域分隔HMAC-SHA256。云环境变量提供版本化密钥；仅存 tokenHash。生成回执恢复时重新派生，不能延长原24小时。
- 邀请绑定家庭、创建者和 creatorGeneration。未来 Task04 转移时必须轮换角色变化者的 generation；A→B→A 不能恢复旧邀请。
- 家庭邀请集合及已有集合 clientDB 四种CRUD始终false。仅增加家庭范围分页查询与必要索引，不重置已有家庭。
- join同事务检查凭据/有效期/当前所有者任期、插入UID唯一成员槽、消费邀请、递增家庭version并写成功回执。已有家庭者拒绝。同成功请求优先校验当前关系后重放，不能复活旧授权；commit未知查询回执恢复。
- 撤销与消费竞争同一记录。已用不能撤销；已撤销可安全幂等。跨家庭目标统一不可访问，邀请不可用统一INVITATION_INVALID。
- 邀请/撤销各UID10次/分钟、家庭30次/分钟；列表各UID60次/分钟、家庭300次/分钟；join UID10次/分钟。复用持久化固定分钟桶，内部重试不重复计数。
- 成员查询投影已有昵称，缺失回退“家庭成员”；内部逐页收全。列表前后重查成员代次与家庭version，不在单条写事务中执行多记录查询。
- 分享先生成，再同步返回通用标题/静态图片/加入路径。打开卡片不自动加入。登录续接只允许固定加入目的地；原始凭据只在内存保留，不自动读剪贴板。
- 写请求发送前按UID保存requestId；join只持久化requestId和tokenHash，冷启动重开同卡片或重新粘贴恢复。创建/加入未决意图互斥。退出、账号切换、页面隐藏和迟到响应沿用代次栅栏。

## 验收边界

领域、适配、真实SFC、完整本地check必须通过。隔离空间使用owner、两名无家庭用户和另一家庭用户验证竞争、主键、回滚、身份、clientDB、限流、平台自动日志采集；微信真机验证卡片/登录续接/弱网。

本地、云端、真机证据分开并绑定工件摘要。Task02关闭不证明其所有并发场景已实测。未提供逐项实测记录时，证据矩阵保持原始状态；本票最终验收依据本次用户指定的全部验收完成前提单独记录。上传前先提供具体资源差异和保护现有身份/配置/bridge依赖的清单，获得该范围授权；不试上传、不清空集合。

不实现匿名预览、二维码、跨设备取回旧邀请凭据、清理worker、退出/移除/转移所有权，不修改旧系统。
