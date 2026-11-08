# Task03：本地验证与剩余验收

## 本地检查 — 2026-11-08

- 开始前工作区干净，miniapp-dev，HEAD 2da953dc6。基线完整350测试/23套通过。
- 新邀请领域测试先因接口缺失失败，随后邀请、24小时、撤销、加入、幂等、并发与故障恢复通过。
- API/云对象测试先确认新增方法和INVITATION_INVALID缺失，再验证严格DTO及可信UID来源；实际云对象源码在VM中运行相同领域代码，VM不是云端实测。
- 实际SFC测试验证分享、明确确认、匿名登录续接、弱网原请求恢复、未决创建互斥和迟到响应。补充回归先复现失效邀请不能更换、隐藏页面草稿未擦除和旧页面卸载清空新成员列表，再修复通过。
- 最终常规检查命令：`task -d miniapp check -- --maxWorkers=2`，使用会话PATH中的Node22.23.3、Corepack pnpm10.20.0和已安装Task；无全局升级或关闭engines。
- 本机会话工具目录为`%TEMP%/mealie-task03-tools`（pnpm.cmd仅以`C:/nvm4w/nodejs/node.exe`调用该安装的Corepack）；Task位于`%LOCALAPPDATA%/Microsoft/WinGet/Packages/Task.Task_Microsoft.Winget.Source_8wekyb3d8bbwe`。将这两个目录及`C:/nvm4w/nodejs`按此顺序前置PATH即可复现，不使用Codex默认pnpm11/Node24包装器。
- 首次默认worker并发时，两个既有文件密集型测试unique_discoverable_identity_object与repeated_generation_is_byte_identical超过默认5秒；限制为两个worker后通过，没有修改断言或提高超时。
- 当前完整检查392测试/29套通过；lint、客户端/云端/测试TS、微信构建、源码/产物边界、密钥扫描通过。
- 审阅修复后完整检查396测试/29套通过；验收门禁另增加CLI包与关联空间真机发行包分开绑定的回归，最后的全量检查和摘要见task03-acceptance.json。
- 门禁分离修复后再次完整检查396测试/29套通过，微信构建与扫描均通过；`git diff --check`通过。检查范围内没有跳过测试。
- 静态分享图已本地目视检查，使用通用房屋图形，不包含家庭名称、成员或凭据；不使用页面默认截图。

## 只读平台检查

HBuilderX 5.34.2026102909已运行，CLI service-space inspect确认alipay、mealie、env-00jy7289et7b。资源名称列表确认当前account-co、family-co、uni-id-co。此检查不确认空间仍为隔离用途，不证明新的环境变量、事务并发、日志脱敏或真实编译已生效。

另通过只读download把uni-id-common 1.0.19、uni-config-center 0.0.3、uni-open-bridge-common云包1.0.0/插件1.2.1保存于独立临时目录。暂存中用这些远程原始文件替换旧本地依赖，全部16个文件字节相等；秘密配置不解析或输出、不进入repo。七项拟变更资源摘要与源码一致，file依赖均限制在暂存目录；细节见task03-staging.json。未上传。

## 独立审阅

独立只读审阅全部diff和新增文件，发现两项Important，未发现Critical/Minor：首次匿名SDK边界关闭会丢登录续接；单份撤销意图可能锁住其他独立邀请。已分别增加真实会话边界SFC、终态失败、隐藏期间成功和未知结果逐邀请恢复测试，先确认失败，再修复。

显式退出现在有独立代次，初次匿名校验失败保留未绑定UID的卡片意图，显式退出和已绑定账号失效仍清除。撤销意图按invitationId隔离，确定终态或读取到终态后清理相应意图，不影响其他邀请，未知请求继续复用原requestId。完整检查结果及最新工件摘要以task03-acceptance.json为准。

## 未执行

截至首次本地交付时未上传。2026-11-09 用户具体授权后，七项正常资源、邀请集合/索引和两个远程环境变量已完成部署与回读；详见 `task03-deployment.md` 和 `task03-deployment.json`。仍未做真实并发/故障/日志采集检查或微信真机邀请验收。工单1/2历史证据未改，不自动勾选或关闭工单3。逐项状态与摘要在task03-acceptance.json；严格doctor继续为NON-READY。
