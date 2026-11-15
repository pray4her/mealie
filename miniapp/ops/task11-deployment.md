# Issue #11 部署记录（既有支付宝测试空间）

日期：2026-11-15。执行者：代理（HBuilderX CLI）。**未提交、未推送、未关单。**

## 目标与边界

- 空间：`mealie / env-00jy7289et7b`，provider `alipay`（既有测试空间，未新建）。
- 工具：`E:/HBuilderX/cli.exe`（v5.34.2026102909，unicloud 插件 3.0.14），全部命令带 `--protocol-version 1 --json true --request-id <uuid>`。
- 只做：公共模块/云对象上传、schema 与 index 上传、只读 list/download 回读。
- 未做：生产发布、微信版本上传、数据库初始化或清空、环境变量修改、新建空间、删除任何云资源。
- 上传使用 `--path`（manifest 实测无 `--name`）；覆盖既有资源带 `--force true`。

## 上传前只读清单

- 云函数 10 项：account-co、family-co、import-worker、imports-co、media-co、media-review-callback、recipes-co、task07-storage-e50713853130、task10-egress-probe、uni-id-co。**无 planning-co**。
- 公共模块 12 项：home-contracts、home-family、home-imports、home-kernel、home-media、home-recipes + 6 个 uni-* 模块。**无 home-planning**。
- schema 22 项：含 mutation_receipts，**无 meal_plans**。

## 上传回执（request-id）

| 资源 | 类型 | request-id | 结果 |
| --- | --- | --- | --- |
| home-contracts | common-module | bced6afc-991a-4199-b8b8-a8ac6bba0b92 | 上传完成 |
| home-kernel | common-module | 538906ea-3d41-484f-8919-eeee9c3e8968 | 上传完成 |
| home-recipes | common-module | 5c0da41c-141f-43e9-91c6-7f2f67b6f74a | 上传完成 |
| home-planning | common-module | d0279c34-7232-427e-83ae-189d78664bbf | 上传完成 |
| planning-co | cloud-function（云对象） | df3a4f82-7f27-4518-954d-bee183ff6582 | 上传完成 |
| meal_plans.schema.json | database schema | fd8699ee-6df4-40c6-9bc3-cf47274079ce | 上传完成 |
| meal_plans.index.json | database index | ecd7b672-ec37-4906-b7c6-b9e83802ddd8 | 上传完成 |
| mutation_receipts.schema.json | database schema | 6ea31271-cee1-404d-af54-97df185198b5 | 上传完成 |

原始 NDJSON：`dist/task11-upload.log`（gitignored）。

## 上传后只读清单

- 云函数 11 项（+planning-co）；公共模块 13 项（+home-planning）；schema 23 项（+meal_plans）。其余资源数量与名称不变。

## 回读与比对

下载到 `dist/task11-readback/`（gitignored），request-id 见 `dist/task11-readback.log`：
home-planning、home-contracts（common-module download）、planning-co（cloud-function download）、meal_plans.schema.json、mutation_receipts.schema.json（database download --kind schema）。

比对脚本 `dist/task11-readback-check.cjs`，结果 **READBACK SEMANTIC OK**：

- 两个 schema 与本地 **JSON deep-equal true**（云端仅压缩空白）。
- planning-co 与本地 **逐字节 identical**。
- 公共模块云端为上传时转译的 `.js`（本地为 `.ts`），故不做字节比对：值导出符号（home-planning index 1 / repository 8 / validation 9）在云端 JS 中全部存在；运行期标记（plan-add-v1、plan-update-v1、plan-remove-v1、meal_plans、mutation_receipts、titleSnapshot、sourceAvailable）本地与云端一致。
- 已知转译差异（非缺陷）：`home-contracts/planning.ts` 为纯类型模块，interface 字段（titleSnapshot、sourceAvailable）在云端 JS 中被擦除；package.json 云端为美化格式。

## 证据边界

- **index 无 CLI 回读通道**：`database download` / `database list` 的 `--kind` 仅接受 schema|schema-extension|validation-function，manifest 58 条命令中无 index 查询。meal_plans.index.json 的在云存在性仅有上传回执（ecd7b672…）为证；其效果由 Task 5 真实云读写间接覆盖，**不声称已直接回读 index**。
- 本记录是 CLI 部署证据，不是微信端验收；真实云功能验收见 `ops/task11-real-2026-11-15/`（Task 5）。
- 未触碰任何 secret 值；uni-id 配置沿用空间既有环境变量。