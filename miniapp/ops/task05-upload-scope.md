# Task05：已执行的隔离空间上传清单

目标仅为 alipay / mealie / env-00jy7289et7b。用户明确批准八项更新，现已上传并回读。机器清单和源文件摘要见 task05-upload-scope.json，详细结果见 task05-deployment.md；以下为已批准并执行的精确范围。

| 资源 | 操作 |
| --- | --- |
| home-contracts | 更新业务类型公共模块 |
| home-kernel | 更新公共模块中的菜谱集合类型声明 |
| home-family | 更新审核适配，家庭场景仍为 1，菜谱可用场景 3 |
| home-recipes | 新建菜谱领域公共模块 |
| recipes-co | 新建云对象，仅 create/get/list/update |
| mutation_receipts Schema | 扩展菜谱成功/终态拒绝操作回执 |
| recipes Schema | 新建家庭菜谱集合，clientDB CRUD 全关闭 |
| recipes 索引文件 | 新建家庭分页索引及家庭内 slug 唯一索引 |

这是八个上传资源；最后一个文件包含两个索引。已有集合不清空，不初始化整套插件数据库，不主动上传或改写身份云对象源代码。公共模块更新会影响引用它们的既有 account-co、family-co、uni-id-co 依赖快照。

执行前重新核对目标、源码和清单摘要，在隔离暂存区保留实际远程 uni-id-common、uni-config-center、uni-open-bridge-common（包括私有配置），使全部 file 依赖指向已核对副本。不得用本地旧版本覆盖、打印或提交配置。上传后逐资源下载回读，分别保存实际云端编译工件；仅在独立验收完成后更新云端与设备证据。

这份清单不授权生产发布、微信平台上传、付费资源开通、Git 提交推送或 Issue 关闭。
