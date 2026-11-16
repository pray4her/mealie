# Issue #12 隔离测试部署

日期：2026-11-16。目标：既有 alipay / mealie / env-00jy7289et7b。用户已批准实施计划中的测试部署；没有新建空间、初始化或清空数据库、发布生产或上传微信版本。

HBuilderX `D:/HBuilderX/cli.exe`，5.34.2026102909，uniCloud 插件 3.0.14-2026102820。CLI 使用 `--protocol-version 1 --json true --request-id …`，资源通过 `--path` 指定，覆盖带 `--force true`。

## 定向资源

| 类型 | 资源 | request-id |
| --- | --- | --- |
| 公共模块 | home-contracts | task12-upload-contracts |
| 公共模块 | home-kernel | task12-upload-kernel |
| 公共模块 | home-shopping | task12-upload-home-shopping |
| 云对象 | shopping-co | task12-upload-shopping-co |
| Schema | shopping_lists.schema.json | task12-upload-shopping_lists.schema.json |
| Schema | shopping_items.schema.json | task12-upload-shopping_items.schema.json |
| 索引 | shopping_lists.index.json | task12-upload-shopping_lists.index.json |
| 索引 | shopping_items.index.json | task12-upload-shopping_items.index.json |
| Schema | mutation_receipts.schema.json | task12-upload-mutation_receipts.schema.json |

九项均取得成功回执，原始 NDJSON 位于忽略目录 `dist/task12-upload.log`。公共模块更新由平台刷新既有依赖它们的云函数快照；未自行覆盖其他云函数源码。

## 保护与回读

上传前官方下载 uni-id-common、uni-config-center、uni-open-bridge-common，暂存包的依赖使用这些副本，未打印配置内容。上传后再次下载，16 个文件逐字节一致。私有配置和完整下载包仅位于忽略目录，不进入交付包或 Git。

三份 Schema 与本地 JSON 语义一致。官方下载的 shopping-co 为源码 `index.obj.ts`，与本地逐字节一致，导出严格为11个业务方法；这不是云运行时编译 JS 的独立回读。home-shopping 下载为编译 JS，源码与下载工件分别留摘要。

[回读核对](task12-readback.json)记录摘要和保护结果；[资源清单](task12-inventory.json)确认12个云函数、14个公共模块、25个Schema，分别只增加 shopping-co、home-shopping 和两个购物集合。CLI 不支持索引下载，索引存在性保留上传成功回执，不能声称已独立回读。

## 微信候选包

`publish mp-weixin --project D:/pray4her/mealie/miniapp --appid wxdf2ca9836263776e --upload false` 首次编译成功但发行服务端响应异常；第二次编译和导出成功，产物 `dist/build/mp-weixin`。日志末尾提示手动上传是工具固定提示，本次未执行上传。

`launch mp-weixin --compile true` 也编译成功，开发产物 `dist/dev/mp-weixin`。真实云业务与真机验收单独记录，部署、编译成功不等于设备验收通过。

## 运行验收

开发者工具曾复用上一版工程缓存（运行时缺 shopping，磁盘含 shopping）；通过官方 CLI 对候选工程清理编译及文件列表缓存后，实际运行本票模块。未清空身份/业务存储。

真实微信账号的8组SDK流程通过，见 [业务结果](task12-real/flow-results.json)。两个独立SDK运行时的同账号争用及原请求恢复通过，见 [双会话](task12-real/sessions.json)。未知底层冲突仍返回UNAVAILABLE；恢复后分别确认写入或明确版本冲突，没有根据猜测增加重试码。这不是双真实成员或跨家庭实测。

生成约756KB的候选包真机预览码（临时预览入口）。用户扫码报告新建、编辑、勾选、删除确认、关闭重进正常，键盘/底部安全区无操作遮挡；手机型号和微信版本未提供。未上传微信审核/生产版本。
