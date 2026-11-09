# Task04：拟更新资源清单

状态：2026-11-09 用户明确回复“批准更新”，已将以下四项更新到指定 alipay 测试空间 mealie（`env-00jy7289et7b`），完成上传后回读与依赖保护核对。详情见 `task04-deployment.md`；此状态不代表业务或真机验收通过。

| 拟更新资源 | 原因 |
| --- | --- |
| home-contracts 公共模块 | 新的成员代次投影与三个操作契约 |
| home-family 公共模块 | 原子成员操作、回执恢复和 generation 比较 |
| family-co 云对象 | 新增三个受身份保护的公开方法 |
| mutation_receipts.schema.json | 增加三种 operation、targetUid/targetGeneration 字段 |

四项批准源码摘要见 `task04-upload-scope.json`。`task04-deploy-preview.json` 保留纯离线预览语义，不以其 uploadAuthorized=false 覆盖本次独立授权和部署记录。授权范围仅为以上四项正常资源；测试探针不在其中。

不新增集合、索引、环境变量或密钥；不重置数据，不做整插件数据库初始化。保留所有现有成员、邀请、回执和家庭历史数据。home-kernel 无源码变更，不主动上传。

上传前须只读核对并暂存实际远程 uni-id-common、uni-config-center、uni-open-bridge-common，受保护内容不解析、不输出、不进仓库；上传后逐字节复核。公共模块更新可能刷新 account-co/uni-id-co 的依赖快照，不主动上传两者源码或改动其公开方法。

MemberView 增加 generation 后，旧小程序严格解析器会拒绝新成员 DTO；仅在隔离空间配套使用本票新云端与新设备包。不得将旧设备包的通过结果作为本票验收。正式发布不在本次范围。
