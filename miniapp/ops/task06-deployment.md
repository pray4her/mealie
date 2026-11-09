# Task06：测试空间部署与回读

日期：2026-11-09（Asia/Shanghai）。用户明确授权上传云资源、验证、Git 提交并推送，并随后确认账号业务与真机验收保留待验。本轮目标仅为 alipay / mealie / `env-00jy7289et7b`。

## 上传范围与结果

`task06-upload-scope.json` 固定六项源码和摘要：更新 `home-contracts`、`home-kernel`、`home-recipes`、`recipes-co`、`mutation_receipts.schema.json`，新增 `recipe_favorites.schema.json`。六项均收到官方 HBuilderX 5.34 CLI 成功回执；原始机器回执见 `task06-upload-results.json`。

上传前重新列出远程资源：4个云对象、10个公共模块、16个 Schema。上传后为4个云对象、10个公共模块、17个 Schema，仅新增收藏集合。公共模块上传回执确认已刷新依赖它们的云函数。没有主动上传 `account-co`、`family-co`、`uni-id-co` 或 `home-family`，没有修改环境变量、上传索引、初始化插件数据库或清空集合。

三个 TypeScript 公共模块及 `recipes-co` 均由官方工具类型检查并编译后上传。工具提示本地上传运行时 Node 18.20.0、云端 Node 18.18.2；此提示保留，未修改云运行时。

## 回读核对

- 上传前在独立临时目录官方下载实际 `uni-id-common`、`uni-config-center`、`uni-open-bridge-common`、`uni-sec-check`、`uni-cloud-s2s`。34个文件原样复制到上传暂存区，全部 file 依赖限制在该暂存区；私有配置只作字节比较，不解析、不输出、不入仓库。
- 上传后再次官方下载上述依赖，34个文件与上传前逐字节一致。三个既有身份/家庭云对象的源码与 `home-family` 编译模块也与上传前逐字节一致。
- 两个上传 Schema 均回读后按 JSON 语义与源码比较一致，四项 clientDB 权限全为 false。既有 `recipes` Schema 同样一致。回执 Schema 在上传前与基线核对，唯一语义变化为增加 `recipe-favorite-v1` operation。
- `recipes-co` 官方下载恢复的 TypeScript 与批准源码逐字节一致；下载时保留官方实际部署 ZIP，仅从中提取 `__dist__/index.obj.js`，没有用本地重编译替代。

机器核对结果和四类摘要见 `task06-deployment.json`，官方下载与最终清单回执见 `task06-readback-results.json`。

## 实际部署工件

忽略目录 `dist/task06-normal-cloud` 保存32个实际部署 JS：`home-contracts` 4个、`home-kernel` 11个、`home-family` 13个、`home-recipes` 3个及 `recipes-co` 1个。静态装载实际 JS 共27个关联模块，未装载平台 SDK、未执行业务方法；对外方法恰为 `create/favorite/get/list/update`。

源码摘要为 `37ba04bea9d82edb2b3758e6bb1c9484527fb2913f12f6b83c631098d0435b14`，实际云工件摘要为 `95a93c839b9463735e9c7a166b6e2c014f7d3bde988cb16ebbac34a26e8d3693`。本轮完整检查重新生成标准 CLI 包，因工具链构建内容变化而更新其独立摘要；源码与关联空间候选包无漂移。最终远程清单没有额外测试对象，源码及工件中无探针残留，本轮未部署任何探针。

## 验证边界

本轮重新执行 `task -d miniapp check -- --maxWorkers=2`，十步退出0、41套件558项通过；上传后的字节、Schema、方法、工件和资源清单核对均通过。

用户确认将三名专用成员的云端业务用例及手机用例留待后续，未绑定其登录会话、未读写业务行、未运行故障注入或手机测试。开发者工具页面检查尝试未得到可验证的应用页面，因此没有记录页面冒烟通过。Schema 权限核对不代表实际客户端 SDK 的拒绝用例或真实查询/事务测试通过。

`task06-acceptance.json` 只将实际云工件与正常包清理场景补为通过；configuration、其余云端场景及全部设备场景继续 pending。最终直接运行 `node scripts/doctor.mjs --ticket task06` 返回1、NON-READY，42个阻断均为这些待验项目；源码、标准 CLI、云包、关联空间候选的摘要无漂移，也没有缺少云工件或探针残留阻断。未上传微信平台、未发布生产或关闭 Issue #6。
