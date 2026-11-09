# Task06：隔离云端验收

更新日期：2026-11-10（Asia/Shanghai）。六项测试空间资源已上传并回读。用户已确认完成 Issue #6 的全部真机场景，并授权工单验收收束，见 `task06-closeout.md`。本文云端专项的独立逐项证据仍为 pending；手机确认不替代并发、故障注入、跨实例限流及客户端数据库拒绝等专项回执。下文部署记录保留 2026-11-09 的实际执行边界。

## 目标与资源

目标来自 `ops/project-target.json`：alipay / `env-00jy7289et7b`。已核对当前远程清单并完成六项上传和官方回读，见 `task06-deployment.md`。未解析配置内容、查询或写入业务行。历史 Task05 部署及用户真机报告均不能作为 Task06 验收结果。

`task06-deploy-preview.json` 仍为离线预览；实际已授权范围见 `task06-upload-scope.json`。六项资源为 `home-contracts`、`home-kernel`、`home-recipes`、`recipes-co`、`mutation_receipts.schema.json`、`recipe_favorites.schema.json`。公共模块更新刷新 `account-co`、`uni-id-co`、`family-co`、`recipes-co` 的依赖快照；远程身份、配置、bridge 及相关模块共34个文件在上传前后逐字节相同。既有菜谱、索引及回执保留；未初始化插件数据库、清空集合或回填共享菜谱收藏字段。

收藏使用家庭、账号和菜谱派生的确定性 `_id`，依靠内建唯一索引。沿用菜谱的 `family_created_id` 索引；本票不增加额外索引。回执 operation 增加 `recipe-favorite-v1`。云端和客户端需要配套，旧游标从第一页重新开始。

实际官方部署工件已取得，`dist/task06-normal-cloud` 保存32个 JS，`cloudBuildSha256` 已独立绑定。`recipes-co` 的 JS 来自官方部署 ZIP，其恢复 TS 与源码逐字节一致；公共模块 JS 来自官方云端下载，未包含凭据配置或本地转译替代品。静态装载只核对方法和依赖，不代表业务方法已远程执行。

## 准备与留证

使用隔离测试账号：家庭一的所有者 A 和普通成员 B，家庭二的成员 C。通过正常登录、建家与邀请形成状态。准备至少 125 条专用菜谱，包括同名、同一 `createdAt`、中文、非 BMP 字符、ASCII 大小写、标题含 `.*`、精确标签 `Soup` 与 `soup`。批量准备如需管理工具，只使用经授权的测试数据；保留准备记录。

逐项记录实际时间、操作者代号、源码及实际云包摘要、调用方法、脱敏输入类别、原始错误码和断言。日志不包含 token、openid、邀请令牌、完整 requestId 或私人菜谱全文。fixture 结果、构建成功、资源上传成功均不能替代业务用例。

## 场景

| acceptance 场景 ID | 操作与通过条件 |
| --- | --- |
| `literal-substring-and-tags` | 标题中文子串、英文大小写及 `.*` 字面匹配；标签完整且保留大小写；query/tag/favoritesOnly 按 AND 组合，空白过滤移除。 |
| `query-validation` | query 120、tag 40 个 Unicode 码点边界；`İ × 120` 与非 BMP 文本合法且可重复规范化；超限、控制字符、孤立代理字符、错误类型、额外字段、limit 0/21/小数/null 被拒绝。 |
| `bounded-scan-empty-page` | 前 100 候选均不匹配而后续有结果：返回空 items 与 nextCursor；续查最终找全。默认/最大页长20；每请求最多读取101条候选，只检查前100条。 |
| `same-time-pagination` | 同名且时间相同的数据按 `createdAt DESC, _id DESC` 遍历；收集全部 ID，断言不丢失、不重复。页长1、2、20均验证。游标跟随最后检查项，不能跳过预取但未检查的候选。 |
| `cursor-scope` | 将 A 游标交给 B/C、改变 query/tag/favoritesOnly、成员离开重入后再用：均拒绝；相同规范化过滤可继续。损坏或超过512字符游标拒绝。 |
| `candidate-projection` | 用平台执行信息或经授权的临时观测确认候选查询只有 `_id/familyId/title/tags/createdAt`，最多101条；收藏一次批查最多100个候选确定性主键并限定 UID/家庭/代次；完整菜谱最多20条。 |
| `favorite-private` | B 收藏共享菜谱，B 的列表/详情为 true；A 同菜谱为 false、收藏列表为空。请求伪造 uid 被拒绝；所有者不能代改成员收藏。 |
| `favorite-set-state` | 用不同 requestId 连续设置 true 仍只有一条关系；设置 false 后不存在有效关系，再设置 false 仍成功。 |
| `same-request` | 并发及顺序重送同一收藏 requestId 和负载，返回成功且仅一次状态变更/回执。 |
| `conflicting-payload` | 同 requestId 改菜谱或 enabled，返回 CONFLICT，既有状态不变。 |
| `replay-after-opposite` | 请求 R 收藏、请求 S 取消后重放 R，返回历史确认但保持取消；随后 get 返回最新 false。反向序列也验证。 |
| `cross-family` | C 猜中家庭一 ID 与不存在 ID 的 get/favorite，均 NOT_FOUND；list 只能看到家庭二；归属与 UID 不能由客户端指定。 |
| `rejoin-generation` | B 收藏后离开或被移除，再加入同家庭；旧关系不显示，旧代次请求和回执不能操作；新代次可重新收藏。 |
| `stale-first-delivery` | 离开前保存但未送达的请求在重入后首次送达，也不能恢复旧收藏。 |
| `read-revocation` | list/get 查询或投影期间撤销身份或移除 B；返回前复核阻止受保护数据返回。 |
| `protected-write-race` | 收藏事务暂存后移除 B、离家或注销；成员 fence 使陈旧事务不能提交。保留实际厂商冲突码与最终集合状态。 |
| `rollback-writes` | 对成员 fence、收藏 insert/replace/remove、回执写入各点注入故障：收藏/成员/回执全部回滚，不留下部分操作。 |
| `commit-ack-lost` | 已提交但丢失确认；原请求从回执恢复，状态只改变一次。与后续反向操作组合验证旧回执不重施。 |
| `quota-cross-instance` | 新实例不能绕过每 UID/家庭的读写限流；写操作限额与窗口恢复实际可观察，回执重送也受保护。 |
| `legacy-recipe-receipt` | 既有未带 isFavorite 的菜谱、创建/更新历史回执仍可读取和重放；投影为调用者当前收藏；共享菜谱和历史快照不新增私有字段。 |
| `schema-indexes` | 回读收藏 Schema 的字段、四项 false 权限、内建 `_id` 唯一性与既有菜谱索引；回执仅新增 operation；重复主键和实际查询路径符合预期。 |
| `safe-dtos` | 列表/详情/创建/更新只返回菜谱 DTO 与调用者 isFavorite，不返回收藏关系、其他 UID、代次或回执。 |
| `platform-log-capture` | 对正常、拒绝、回执恢复及故障路径检查真实平台日志，保留脱敏原始输出；平台自动采集也不泄露上述敏感内容。 |
| `normal-artifact-and-cleanup` | 实际受测云包与验收摘要一致；如使用故障探针，移除后远程只保留正常对象和模块，再次回读核对。 |
| `clientdb-recipe_favorites-read` / `create` / `update` / `delete` | 使用真实客户端 SDK 分别直接 CRUD 收藏集合，四项均被拒绝；每项单独留证。 |

竞态和逐写点注入若需临时云探针，必须先固定作用域、授权、操作者及清理清单；不能将探针或 fixture 注入正式业务包。只采用实际厂商返回并核验的冲突码，不通过字符串猜测扩大生产重试范围。

## 证据更新

完成真实执行后，在 `task06-acceptance.json` 的对应 cloud scenario 填写本票证据文件和可定位记录，并由操作者置为 passed。配置核验另记 configuration；不能因一项成功批量改成通过。最后运行 `task -d miniapp task06:doctor`，任何缺证或源码/工件漂移都必须保留 NON-READY。
