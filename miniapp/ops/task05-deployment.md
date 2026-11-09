# Task05：隔离空间部署记录

日期：2026-11-09（Asia/Shanghai）。用户明确批准 task05-upload-scope 中的八项测试空间资源更新；目标为 alipay / mealie / env-00jy7289et7b。仅执行该清单，不代表业务或真机验收完成。

## 上传前核对

- 批准的源码、标准 CLI 包、关联空间候选包及全部八项暂存资源摘要匹配。
- 当前远程 home-contracts、home-kernel、home-family 与上一票实际云工件逐字节一致；远程 mutation_receipts Schema 与已验收基线规范化比较一致。
- 在独立临时目录官方下载当前 uni-id-common、uni-config-center、uni-open-bridge-common、uni-sec-check 和 uni-cloud-s2s。私有配置仅原样保留和字节比较，不解析、不输出、不入仓库；全部 file 依赖留在暂存目录内。

## 上传及回读

- 回执 Schema、recipes Schema、recipes 索引、home-contracts、home-kernel、home-family、home-recipes、recipes-co 共八项官方 CLI 回执均成功。索引文件的两个索引收到初始化完成回执。
- 四个 TypeScript 公共模块及 recipes-co 通过官方 HBuilderX 5.34 类型检查并编译。CLI 报告上传工具 Node 18.20.0、云端 Node 18.18.2。
- 两个 Schema 上传后官方下载并规范化比较一致，clientDB CRUD 权限仍全为 false。
- 上述五个依赖模块共 34 文件在上传后再次官方下载，与上传前逐字节一致。uni-id-common 仍为 1.0.19，bridge 云包 1.0.0 / 插件 1.2.1；没有使用本地旧版本覆盖它们。
- 未主动上传 account-co、family-co 或 uni-id-co 源码；公共模块更新影响它们的依赖快照，属于已说明并批准的影响范围。没有修改环境变量、重置集合、初始化整套插件或写入验收业务数据。

## 实际云工件

四个公共模块的官方已部署 JS 分别为 4、11、13、3 个文件。recipes-co 下载恢复的 TS 与批准源码逐字节相同；在官方 ZIP 的临时生命周期内保留完整副本，仅提取其中 __dist__/index.obj.js 进入正常云工件，未复制 ZIP 内私有依赖。

正常云工件位于忽略目录 dist/task05-normal-cloud，共 32 个 JS 文件，不用本地重编译代替远程产物。静态装载实际 recipes-co JS 确认只导出 create/get/list/update，且模块导入时未加载平台 SDK；没有执行业务方法。源码、云工件、标准 CLI 包和关联空间候选包分别绑定摘要。

## 验收边界

本轮未绑定专用 A/B/C 登录会话，未执行真实新建/共同编辑、并发、故障注入、审核、限流或 clientDB 拒绝用例，未做手机验收。HBuilderX 打开开发者工具可能触发应用常规身份读取，不作为业务验收。

配置、云端场景和设备场景继续 pending，doctor 保持 NON-READY。请按 task05-cloud-checks.md 使用两个家庭、三名专用测试成员及真机验收；索引初始化回执不代替真实查询、事务隔离和冲突码测试。没有提交或推送 Git、关闭 Issue、上传微信公众平台或发布生产。
