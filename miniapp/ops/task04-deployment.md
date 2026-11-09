# Task04：隔离空间部署记录

日期：2026-11-09（Asia/Shanghai）。用户明确回复“批准更新”，对应此前四项资源清单及 alipay 测试空间 mealie（`env-00jy7289et7b`）。此次完成正常资源更新，不代表 Issue #4 业务或真机验收完成。

收束补充：用户随后明确确认云端业务、并发及真机验收完成，并授权关闭工单、收束文档、提交推送，见 `task04-closeout.md`。下文的 pending、未提交或未执行描述保留部署阶段的观测状态，不代表最新业务验收结论。

## 上传与回读

- 上传前再次核对批准的源码、CLI 包及四项资源摘要；全部匹配。独立临时目录暂存了实际远程身份/config/bridge 模块，全部 file 依赖限制在暂存目录内，不使用本地旧身份模块覆盖远程版本。
- 只更新 home-contracts、home-family、family-co、mutation_receipts Schema；四项官方 CLI 回执全部成功。三项 TS 资源由 HBuilderX 5.34 完成真实类型检查和编译。更新公共模块时平台刷新依赖它们的云函数快照，未主动上传 account-co/uni-id-co 源码。
- Schema 上传前确认仅新增三种 operation 与 targetUid/targetGeneration；上传后下载并规范化比较相同，四项 clientDB 权限仍为 false。集合仍为十五个，云对象仍为三个；没有新建集合/索引、初始化数据库或删除数据。
- 受保护的 uni-id-common 1.0.19（2 文件）、uni-config-center 0.0.3（5 文件）、uni-open-bridge-common 云包 1.0.0/插件 1.2.1（9 文件）上传后再次官方下载，与上传前共十六文件逐字节相同；私有配置未解析、未输出、未入仓库。
- family-co 的两个既有邀请环境变量仍存在，版本对应的密钥和密钥环格式核验通过；没有写入环境变量，也没有输出/存储值。未在上传前采集其值，因此不把本次格式核验描述为环境变量值的前后字节比较。

具体回执见 `task04-upload-results.json`，暂存和字节核对元数据见 `task04-staging.json`，环境核验只记录安全元数据于 `task04-environment.json`。

## 正常云工件

官方公共模块下载直接返回已部署 JS；保留 home-contracts（3 JS）、home-family（13 JS）及只读下载的既有 home-kernel（11 JS）。未主动上传 home-kernel。

family-co 的官方下载会恢复 TS 并删除 ZIP 内的 __dist__。本次在官方完整 ZIP 的临时生命周期内保留副本，单独提取其中实际部署的 index.obj.js，下载恢复的 TS 与批准源码逐字节相同。正常工件统一保存在 `dist/task04-normal-cloud`；未用本地重编译冒充云端下载结果，未将 ZIP 内依赖或私有配置复制进正常工件。

实际 JS 的惰性导出检查确认仅有 current/create/invite/revokeInvite/join/members/invitations/leave/removeMember/transferOwner；没有 probe/run/debug 入口。此静态检查没有执行成员业务方法。

## 配套微信包

使用 HBuilderX `publish mp-weixin --appid wx68649810a6f363f3 --upload false` 生成关联空间发行候选包；核对 AppID、压缩设置，并在隔离环境中解析编译器生成的数值解码表达式，仅确认绑定 provider=alipay、spaceId=env-00jy7289et7b，不输出或存储解码后的其他配置。

该包保存在 `dist/task04-device/mp-weixin`，微信官方 CLI 已成功打开此独立目录。随后重新生成标准 CLI 检查包至 `dist/build/mp-weixin` 并通过产物边界与密钥扫描；CLI 包和关联空间包分别绑定摘要。没有上传至微信公众平台，没有实际手机验收。

## 验收边界

本轮未绑定专用 A/B/C/D 登录会话，未主动执行成员退出/移除/转移、并发、故障注入或 clientDB 拒绝场景；打开开发工具可能触发应用常规身份查询，未将其当作业务验收证据。平台日志采集脱敏和真实事务隔离/冲突码仍待实测。

CLI 报告上传工具 Node 18.20.0、云端 Node 18.18.2；真实编译通过不等于实际 SDK/事务运行验证。`task04-acceptance.json` 的 cloud/device/configuration 继续 pending，doctor 保持 NON-READY；源代码、云工件及两个小程序包分别保存摘要。不提交或推送 Git，不关闭 Issue #4，不发布生产。
