# Task06：微信真机验收

日期：2026-11-09（Asia/Shanghai）。状态：pending。尚未在手机执行本票用例。

## 候选与准备

HBuilderX 5.34 已通过显式指定目标 AppID、`--upload false` 构建，日志确认关联空间为 `env-00jy7289et7b`，微信开发者工具成功打开。配套候选保存在忽略目录 `dist/task06-device/mp-weixin`，67个文件逐字节核对；AppID、九条路由及包摘要已核对。打开开发者工具不代表手机验收，也未上传到微信平台。

命令为 `E:/HBuilderX/cli.exe publish mp-weixin --project E:/pray4her/mealie/miniapp --appid wx68649810a6f363f3 --upload false`。首次省略 `--appid` 时该 CLI 将 manifest 中 AppID 置为 null 并产生 touristappid 包；已恢复原值并重新构建，首次包不作为候选。使用该 CLI 时显式传入目标 AppID，并检查源码无意外变化。

配套 Task06 云资源已在隔离空间部署并回读，详见 `task06-deployment.md`。手机预览前仍需确认实际小程序包 AppID、云空间和 source/build 摘要与验收记录一致。本地标准 CLI 构建没有关联空间注入，不能混作这个候选。用户确认本轮手机验收继续待验。

记录设备型号、系统、微信/基础库版本、操作者、时间、受测包摘要和脱敏截图或日志。账号 A/B 同家庭，C 另一家庭；使用云端检查准备的专用数据。

## 场景

| acceptance 场景 ID | 操作与通过条件 |
| --- | --- |
| `explicit-search-and-tag` | 输入标题、标签时不逐字发请求；点击搜索/键盘确认后发送，标题子串、英文大小写、精确标签及二者组合正确；空白与 Unicode 边界可用，错误输入有明确提示。 |
| `all-favorites-switch` | “全部／我的收藏”保留当前过滤并清空旧游标；切换后只显示符合组合条件的菜谱。进入详情返回列表时保留过滤并重载第一页。 |
| `empty-page-continue` | 前100条无匹配、后段有结果，空段显示“继续查找”，继续后能找到结果；无续查游标才显示最终空结果。 |
| `list-detail-favorite` | 分别在列表、详情收藏/取消，服务端确认并读取最新状态后按钮更新；另一同家庭账号看不到该收藏。 |
| `favorite-remove-row` | 收藏模式取消后移除对应行，其他收藏保留；取消时同时搜索且旧列表后返回，不能恢复已取消的行。 |
| `filter-response-race` | 先搜索 A 后搜索 B，使 A 最后返回；只有 B 的列表与游标可见，快速重复搜索/加载更多也不重复插入。 |
| `duplicate-taps` | 连点收藏/取消只发送同一操作；未确认意图存在时阻止反向操作，不影响独立菜谱草稿。 |
| `weak-network-original-request` | 让收藏提交后回复丢失，显示“确认收藏结果”；恢复网络重试保持原 requestId，最新状态正确，不重施已被后续请求反转的旧操作。 |
| `pending-cold-start` | 未确认收藏时退出并冷启动，恢复原账号意图，仍使用原 requestId；原菜谱创建/编辑草稿不被覆盖。 |
| `hidden-late-response` | 查询/收藏延迟时隐藏、卸载再显示；隐藏后受保护数据清空，旧响应不能发布；旧收藏仍未返回时点击恢复会以原 requestId 建立当前页面的新请求，成功后页面仍可见。 |
| `removed-member-onboarding` | B 持有列表/待确认收藏时被移除；重新显示或重试走家庭引导，旧数据隐藏；重入后旧代次收藏和意图均失效。 |
| `logout-account-isolation` | 带未确认操作退出、同账号重登、切换 C，均无旧账号受保护数据或意图；迟到成功不能恢复旧状态。 |

只有真实手机执行的场景才能在 `task06-acceptance.json` device.scenarios 标为 passed。开发工具模拟、SFC、构建或历史 Task05 用户报告均不能替代。更换候选包后重新绑定摘要，并复核受影响场景。
