# Task07 本轮本地验证证据

最新收束：2026-11-09（America/Los_Angeles）用户确认已完成真机验证；最终本地复验、Git 交付和未独立验证项目见 [收束记录](task07-closeout.md)。本文按阶段保留历史观察，实施时的“未提交/真机待验”不代表当前交付状态。存储 SDK 换链能力已由用户接受，详见 [存储选型](task07-storage-gate.md)。

本地日期：2026-11-09（America/Los_Angeles）。这是图片功能实施阶段的验证，区别于已有存储探针阶段的 43 套件 / 574 项历史结果。

## 已通过：本地自动化及构建

在 `miniapp` 工作目录执行 `task check -- --maxWorkers=2`，等价于仓库根目录的 `task -d miniapp check -- --maxWorkers=2`，最终退出 0：

- identity/content 模块组装一致性检查通过。
- ESLint 无错误/警告；客户端、云函数和测试三组类型检查通过，含 uni-helper 真实 SFC 模板检查和 HBuilderX ES2021 兼容检查。
- **48 个测试套件 / 607 项测试全部通过**。其中本票新增 33 项功能测试；已有存储探针 9 项测试继续通过。
- 微信生产构建完成，源码/工件边界与密钥扫描通过。
- `git diff --check` 通过；未执行 Git 提交、推送或生产发布。

完整原始日志位于忽略目录 `dist/task07-implementation-check.log`。云端部署适配声明修复后已完整重跑，仍为 48 套件 / 607 项通过，最新日志为 `dist/task07-deployment-check.log`。复用已安装的本地 Node/pnpm/Task；本会话向 PATH 添加既有 `dist/task05-tools` pnpm shim 及 Task 所在目录，没有改动全局工具或依赖锁。

## 模拟通过：领域、平台适配器及页面

- 媒体领域：真实生成的 JPEG、带 CRC/IDAT 的有效 PNG、恰好 1 MiB、超限、Base64/类型/声明大小/摘要错误、文件被替换、授权过期、跨家庭、未发布图片上传者、import-input、任意文件 ID、20 张限制、重复请求、版本冲突、丢失绑定回执与事务回滚。
- 并发：上传期间移除/撤销会话/重入，审核提交期间移除，回调时账户与代次复查，拒绝后重复成功通知、超时重试和旧 trace 隔离。
- 回调：本地生成的加密 JSON/XML 安全模式通知，签名/时间窗/AES/AppID/事件/trace 校验，GET 握手、伪造、重复/迟到通知和未知 trace 的 503；不是微信真实投递验收。
- 存储适配器：受控路径、响应 DTO、上传/回读，以及请求 600 秒但返回实际 900 秒的差异样例；不是支付宝云真实 TTL 或 ACL 验收。
- 云入口：实际 TypeScript 入口在平台 harness 中认证及重查 token、五个媒体方法和第六个菜谱绑定方法、额外参数拒绝、退出后拒绝。
- 页面：选择取消、新菜谱先保存文字、独立保存保留草稿并更新版本、模拟审核等待/刷新、丢失结果后复用原 requestId、隐藏时丢弃 picker/上传响应、退出清除、重入代次清除、切换菜谱保留各自未知保存请求、详情预览。运行真实 SFC；原生选图和预览使用 Stub。
- Task07 运维：离线清单包含新模块、媒体云对象、独立 HTTP 回调及 schema；模拟证据不能填作真实 cloud/device；源码变更使证据失效。

## 未通过及待验证

已有真实探针记录显示：公开 SDK 能凭公开配置和文件标识取得图片链接。这不满足严格存储读取隔离；不能归为本轮通过，也未通过 Mock 改写。原始 URL 的历史 403、SDK 的历史成功换链和探针清理记录保留在原文件中。

本轮按后续用户授权已更新测试空间 10 项资源，官方下载回读核对 43 个实际云 JS 工件及 34 个原有依赖文件通过。真实网络空登录态调用六个业务方法均返回 AUTH_REQUIRED；未配置回调的空 POST 返回 503。详见 [部署记录](task07-deployment.md) 和 `task07-cloud-smoke.json`。

未绑定或使用专用 A/B/C 业务验收会话、已配置并核对的 V2 回调或微信真机连接。真实账号上传绑定、存储覆盖/删除拒绝、到期拒绝、撤权后的存储访问、V2 审核与真机验收继续待验证。回读和空登录态响应不替代上述业务验收。

完整待验步骤及实际限制见 [实施清单](task07-implementation.md)。未关联、失败和迟到文件留有清理信息，物理清理由 #18 负责。输入另有资源保护上限：16,777,216 像素，PNG 解压扫描行最多 134,217,728 字节；特殊 JPEG 编码及真实大图兼容性待设备验收。

`task07:doctor` 预期保持 NON-READY，表示 cloud/device 的真实业务证据与设备工件尚未齐备；本地功能实现、自动化验证及云端部署回读已完成。

实际执行 `node scripts/deploy-preview.mjs --ticket task07` 退出 0，生成 41 项离线资源清单；`node scripts/doctor.mjs --ticket task07` 按预期退出 1。部署后已更新源码和实际云工件摘要并重新生成 preview；doctor 没有本地检查、源码摘要或云工件阻断项，剩余项均是 cloud/device 业务待验及设备工件缺失。机器记录见 `task07-acceptance.json`，离线清单见 `task07-deploy-preview.json`。

## 2026-11-09：修复原生选图后没有上传请求

对照 DCloud 的[选图 API](https://uniapp.dcloud.net.cn/api/media/image.html)及[应用生命周期](https://uniapp.dcloud.net.cn/tutorial/app-lifecycle.html)文档，在当前微信开发者工具使用合成 PNG 复现。实测原生选图触发 `app-hide → app-show`；成功回调返回 1 个路径和 70 字节文件时，登录与家庭状态均为 `checking`。旧实现已经清空媒体上下文，随后静默丢弃选图结果，`requestUpload/upload/complete` 调用数均为 0。这一步没有到达云存储。

修复仅涉及客户端：`useRecipesPage.act` 提供等待本页 `onShow` 校验结束的恢复回调；媒体选择在恢复后重新取得上下文，并核对原账号、家庭、成员代次、菜谱及退出登录次数。继续上传期间仍使用原有隐藏和迟到响应保护。页面卸载或校验失败会结束等待；不跳过身份与家庭校验，不持久化图片字节或路径。云函数、公共模块与 Schema 无需为本修复重新部署。

先运行新增测试，选图回调早于页面显示、校验期间返回、校验后返回三项均重现“上传调用数为 0”；修复后通过。同时覆盖校验失败、退出后重新登录、卸载、成员退出重入，以及原有上传期间隐藏保护。完整执行 `task check -- --maxWorkers=2` 退出 0：**48 套件 / 612 项测试**、模块组装、ESLint、三组类型检查、微信生产构建、边界与密钥扫描通过。日志：`dist/task07-picker-fix-check.log`。

随后通过当前微信开发者工具的真实选图按钮选择合成 PNG，使用既有登录态及已部署支付宝测试空间，未 Mock 选图、文件系统或业务网络：

- 观察到同样的 `app-hide → app-show`，随后调用 `requestUpload → upload → complete → status → read`；媒体状态为 `ready`，本次审核模式为 `disabled`。
- 原生 `getImageInfo` 成功读取 1×1 PNG；原生 `downloadFile` 返回 HTTP 200、70 字节，SHA-256 为 `abc58d5127d7cdf313beb9ec8ee839860a9c6bfbc48c8b8eb6a3f7d8bb63de6f`，与本地合成文件逐字节一致。Node 的独立 GET 同样为 200 且内容一致。
- 点击“保存图片”后通过业务 API 回读，测试菜谱版本从 2 增至 3，关联本次媒体 `8847a30db8074188fa561ae0956677fb`。随后通过业务 API 移除此合成图片关联，恢复原有空图片列表，版本增至 4；未改动菜谱文字。存储对象保留给既有未关联文件清理流程，不执行物理删除。
- 脱敏实测记录为 `dist/task07-picker-native-evidence.json`。签名 URL、令牌、私有配置和图片字节未写入此证据。

附带诊断中，开发工具 `wx.request` 访问同一签名 URL 返回 `403 SignatureDoesNotMatch`；实际图片读取使用的 `getImageInfo`、`downloadFile` 与独立 GET 均成功。此差异尚未归因，不把它记录为所有网络 API 均已通过。

本次证明开发工具中的这一上传、图片读取和保存样本成功，补充上文历史待验记录；不代表真机、完整 A/B/C 授权场景、真实微信审核、存储 ACL 或到期测试全部完成，不据此改写 Task07 的整体验收为 READY。未提交、推送或生产发布。
