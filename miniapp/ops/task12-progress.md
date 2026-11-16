# Issue #12 实施记录

基准：miniapp-dev / 3d983cc38325d455c5f9d682346ec0324679382e。方案已由用户批准，见 [实施计划](../../docs/superpowers/plans/2026-11-16-miniapp-shopping.md)。用户于2026-11-16追加授权提交、推送与关闭工单；功能提交 [b5dc16b42](https://github.com/pray4her/mealie/commit/b5dc16b42dd372961049686fc6a23bcc5a40b04f) 已推送至 upstream/miniapp-dev，[#12](https://github.com/pray4her/mealie/issues/12) 已以 completed 关闭。未生产发布，未验项继续保留。

- 在用户指定的当前 miniapp-dev 工作区实施，保留 HBuilderX 工程关联。无新增项目依赖。
- 完成独立 shopping_lists / shopping_items、11 个云方法、多清单和条目 CRUD、勾选、父清单软删除、家庭隔离、版本 CAS、审核、回执与原请求恢复。同步生产客户端、失权清理、导航、类型、fixture 和边界检查。
- 新增37项购物测试；完整检查75套、1585项通过。三份 TS 配置、ESLint、身份/内容装配、源码与产物边界、secret scan 均通过。独立代码评审发现的迟到选择结果和跨可见周期写响应问题已补失败回归并修复；复审无遗留实质问题。
- HBuilderX 编译与 `publish mp-weixin --upload false` 成功。首次发行服务端异常后重试成功；没有执行微信上传。工具包版本与公开组件依据见 [组件记录](task12-component-evidence.md)。
- 既有支付宝测试空间九项定向资源上传成功；三份 Schema、模块和云对象回读核对，16份身份/私有配置文件未变。索引只有上传成功回执，CLI 不支持独立下载，见 [部署记录](task12-deployment.md)。
- 微信开发者工具隔离 fixture 完成64张状态截图：375/390/430px 标准字号和390px ×1.4大字号各16张，逐张记录实测视口和标题字号。320px 尝试实测375px，未计为通过，见 [截图记录](task12-local/README.md)。
- 真实微信账号 + 真实测试空间完成登录、创建、不同条目并发勾选、反向勾选后旧请求重放、过期冲突、重命名、条目编辑/删除、含条目父清单删除后拒绝读取；见 [真实流程](task12-real/flow-results.json)。开发者工具私人设置关闭域名校验，不能据此认定生产合法域名配置通过。
- 两个独立开发者工具SDK运行时以同一真实账号争用：不同条目首轮一成功一结果未知，原请求恢复后两条状态均保留；同一条目一成功一结果未知，恢复原请求明确返回CONFLICT，只增加一个版本。初始脚本错误地要求首轮直接返回CONFLICT，失败结果也保留；修正为计划规定的未知结果恢复流程后通过，见 [双会话结果](task12-real/sessions.json)。未为未知底层错误配置自动重试码。
- 用户于2026-11-16扫码反馈：新建、编辑、勾选、删除确认、关闭重进均正常，键盘和底部安全区无操作遮挡。作为用户报告的真机验收；手机型号和微信版本未提供，未冒充独立设备采证。
- 提交前再次复验75套1585项、三份TS配置、完整lint（含显式检查新review脚本）、装配、源码/产物边界、密钥扫描与暂存差异检查，全部通过。首次推送后通过 ls-remote 核对远端功能提交哈希；本次文档提交仅同步实际提交、推送和关闭状态。

## 检查命令

`task -d miniapp check` 的 PATH pnpm 包装器实际走 Node24/pnpm11，与严格引擎要求不符。因此保持 Node22.23.3、锁文件与 engine-strict，直接执行 Taskfile 对应的已安装工具，不升级依赖或放宽约束：

```powershell
node scripts/assemble-uni-id.mjs --check
node scripts/assemble-content-check.mjs --check
node node_modules/eslint/bin/eslint.js . --max-warnings 0
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.cloud.json
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.tests.json
node node_modules/vitest/vitest.mjs run
node node_modules/@dcloudio/vite-plugin-uni/bin/uni.js build -p mp-weixin
node scripts/check-boundaries.mjs --artifacts
node scripts/check-secrets.mjs
```

原始全量测试、CLI日志与含私有配置的下载包留在忽略的 `dist/`。只交付脱敏结果、摘要和业务截图；预览二维码是临时验收入口，不代表生产发布。

## 保留边界

320px 标准/大字号、真机读屏、双真实成员、跨家庭和真实移除成员仍未实测；领域与页面测试覆盖相应授权/竞争规则。单账号会话不能替代两个真实成员。未观察到可核实的支付宝事务冲突码，retry allowlist 继续为空；未猜测或扩大可重试错误。物理清理留给 #18。
