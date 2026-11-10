# Task07 图片功能实施与验收

2026-11-09（America/Los_Angeles）收束：图片功能及原生选图恢复修复已完成；用户确认“已完成真机验证”，并授权更新验收文档、提交、推送及关闭 Issue #7。最终交付结论见 [收束记录](task07-closeout.md) 和 `task07-acceptance.json.closeout`。下文保留实施阶段的逐项证据，未独立实测的云端项目不因本次确认批量改为 passed。

本轮按用户提供的 Issue #7 方案实现，随后按用户明确要求完成支付宝测试空间云端部署，不自动提交、推送或生产发布。部署回读见 [部署记录](task07-deployment.md)。存储探针与旧计划是已有工作区文件，历史观察不替代本轮功能验收。

## 本地实现

- JPEG/PNG、单图 1,048,576 字节、每菜谱 20 张。所有图片通过登录后的 `media-co` 中转；服务器生成每次尝试独立的路径，绑定只接受 mediaId。
- `requestUpload/upload/complete/status/read`、`RecipesApi.bindImages`；clientDB 对 `media_files`、`media_audit_traces` 的全部权限关闭。绑定与文本修改共用版本；文字更新保留图片；图片保存保留页面文字草稿。
- 上传授权有效期 5 分钟。校验 Base64 上限、格式、实际长度、图片结构及 SHA-256，complete 从存储重新下载核对。未关联、失败、过期及迟到对象保留 cleanupAt/garbagePaths，由 #18 实施物理清理。
- 未绑定媒体与 import-input 仅上传者当前代次可管理，import-input 不能绑定。已绑定图片通过业务 API 向当前家庭成员提供临时 URL。退出、换号、成员代次变化和页面隐藏清空受保护内存；恢复信息仅存媒体 ID、请求元数据和原绑定请求，不存图片字节、临时路径或签名 URL。
- 默认 `MEDIA_REVIEW_ENABLED` 未设置或为 `false`，文件校验后直接 ready；测试阶段可直接使用。只有精确为 `true` 才启用 uni-sec-check V2；值应在测试空间配置，不能借此推断真实审核已通过。`mock` 仅由测试注入，并在页面明确显示。
- 审核回调独立入口 `media-review-callback`，URL 路径 `/media-review`。安全模式支持 GET 握手及 JSON/XML 加密通知，验证 SHA-1 消息签名、5 分钟时间窗、AES-256-CBC/PKCS#7、接收 AppID、事件和 traceId。首个有效通知获胜；未知 trace 返回 503 供重试，不能任意推进媒体。
- 审核启用时，云端配置 `MEDIA_REVIEW_CALLBACK_TOKEN`、`MEDIA_REVIEW_ENCODING_AES_KEY`（43 位）、`MEDIA_REVIEW_WEIXIN_APP_ID`（真实微信 AppID）；沿用现有 uni-sec-check/bridge 凭据与可信 openid。DCloud AppID 与微信 AppID用途不同。配置值不能写入客户端、源码或证据。
- 审核提交失败、60 秒校验租约或 30 分钟审核等待超时进入可显式重试的 review-error；旧 trace/失败/拒绝记录不会被迟到成功通知恢复。回调重查原会话摘要对应的账号登录态和当前成员代次。

## 可执行检查

```powershell
task -d miniapp check -- --maxWorkers=2
git diff --check
task -d miniapp task07:preview
task -d miniapp task07:doctor
```

`task07:preview` 只生成本地资源清单，不上传。`task07:doctor` 区分本地自动化与真实 cloud/device，模拟证据不能填充真实验收。缺少外部证据时 NON-READY 指真实部署验收尚未齐备，不阻塞功能实现或本地构建。

## 真实环境待验清单

- [x] 在既有支付宝测试空间编译并部署匹配的公共模块、media-co、recipes-co、审核回调及两个新 schema，更新回执 schema；官方回读核对通过，现有依赖 34 个文件保持一致，未初始化/清空已有集合。
- [ ] 上传合成 JPEG/PNG，验证实际摘要、独立保存、最多 20 张、1 MiB 边界与详情预览。
- [ ] 业务 API 的其他家庭、未绑定他人图片、import-input、离开/移除/重入及登录撤销拒绝行为。
- [ ] 存储原始 URL 的匿名访问、公开 SDK 直接换链、覆盖和删除权限，以及子目录继承。本地适配器测试不是平台 ACL 的证明。
- [ ] 记录临时 URL 中真实 expire_at，优先请求 600 秒；实际到期前/后分别发起 GET。返回实际到期时间，不用 600 秒推定平台硬性保证。
- [ ] 启用真实审核时核对 V2 凭据、微信 AppID、回调 URL、加密安全模式、通过/拒绝/异常和实际通知重试；关闭审核与模拟回调均不记为真实审核通过。
- [x] 用户确认已完成微信真机验证；未提供上述各场景的逐项原始记录和实际受测包摘要，确认来源及证据边界见 [收束记录](task07-closeout.md)。
- [ ] 核对上传包大小/30 秒云函数限额与 1 MiB Base64 传输；较大 PNG 解压上限与低内存设备兼容性。
- [ ] 删除历史已停用探针函数 `task07-storage-e50713853130` 的资源条目；业务对象物理清理归 #18。

## 存储实际限制

已有 `task07-storage-results.json` 记录原始 URL 403，但仅凭公开客户端 SDK 配置和文件标识即可换取可读签名 URL。用户已明确接受该读取能力，详见 [存储选型记录](task07-storage-gate.md)；它不再是本票的失败或迁移条件。家庭范围继续由业务接口校验，文件本身不承诺匿名/跨家庭读取隔离或成员撤权后的硬性保密期限。覆盖/删除权限及实际到期的独立证据仍未补齐，不能声称这些项目已实测通过。

实施阶段已部署云业务并通过回读及空登录态真实网络入口验证；随后开发工具中的真实上传、读取与绑定样本及原生选图修复记录见 [验证证据](task07-test-evidence.md)，最新真机结论来自用户确认。真实微信审核仍未独立验收。历史 SDK 读取观察保留，不以 Mock 改写；已签发的链接在实际有效期内仍是持有者凭据。
