# Task09 真实验收记录（2026-11-14，北京时间）

分支 `miniapp-dev`，基线 `eb6721cb9` + 未提交改动（回调两处修复、AppID 切换、eslint ignore `review/**`、vitest testTimeout 20s——后者经用户批准）。正式 AppID `wxdf2ca9836263776e`；支付宝测试空间 `mealie / env-00jy7289et7b`。结构化证据见 `../task09-acceptance.json`；云端回读见 `readback.json`（`readback.jql` 经 `unicloud database run-jql` 执行）。

## 环境修复

- **开发者工具黑屏**（仅菜单栏、内容全黑）：根因为 GPU 渲染失败，非登录问题（`cli islogin` = true）。按微信开放社区方案将 IDE 配置 `enableGPU` 置 false（`AppData/Local/微信开发者工具/User Data/<hash>/WeappLocalData/localstorage_b72da75d79277d2f5f9c30c9177be57e.json`），`cli quit` 后重启即恢复，自动化端口 9422 可连。
- **自动化机制**：该版本 automator 的选择器无法穿透 `virtualHost` 组件（`data-*` 钩子不渲染、`>>>`/xpath 失效）。改为调用页面编译后的事件处理器（`review/extract-handlers.cjs` 从 WXML+JS 提取 id，运行时按 `_id` 后缀解析 `eN_<id>` 方法），与 tap 走同一 guarded handler；状态经页面 data 与截图观察。仅原生选图器用 `mockWxMethod('chooseImage')` 模拟，真实样本字节先写入模拟器沙箱（模拟器 FS 不读 PC 绝对路径）。上传、微信异步审核、消息推送回调、视觉、配额、保存全真实。

## 流程与证据（截图 00–12）

1. 登录（00）→ 新建"验收家庭"（02）→ 空菜谱首页（03）→ 添加弹层（04）。
2. **超尺寸拒绝**：2.4MiB PNG 触发真实客户端校验"请选择一张不超过 1 MiB 的 JPEG 或 PNG 菜谱图片。"，提交禁用，不上传（05）。
3. **成功路径**：0.394MiB 菜谱图上传 → 微信 `media_check_async` 等待审核（06）→ 消息推送回调投递后"图片已通过审核"（07）→ 提交 → 任务队列/运行（08）→ 已保存（09）→ 详情（10）。
   - 任务 `fba67f84…` succeeded，菜谱 `8d580aeb…`"土豆炖牛腩"。17 项食材数量/单位与原图一致（牛腩 500克、土豆 2个、洋葱 0.5个…）；"盐 适量/冰糖 少许/热水 适量" quantity/unit 为 null，仅 note 保留——**不编造**；7 步骤逐字一致；未给出的 servings/时间 null；原图不作封面。
4. **非菜谱失败路径**：成品照片（无文字菜谱）真实审核通过（11）→ 视觉判 `UNRECOGNIZED` → 任务 `03e3b5e7…` failed，页面明确"导入失败：未能识别一道完整菜谱…"（12），未保存菜谱。

## 云端回读要点

- 两条 `media_files`：purpose=import-input、review=weixin、traceId 存在；任务结束后按设计释放/清理（state=failed、cleanupAt 清空）。
- `ai_usage`：成功 attempt2 cost 0.0009650715624、失败 attempt1 cost 0.0001300068，均 settled；本次视觉合计 ≈ **$0.0011**（预算 $1）。
- 成功任务 attempts=2：attempt1 的 usage `5ad5e07a…` settled:false 全 null = worker 函数被运行时强杀（正常失败分支都会 settle），租约 90s 过期后每分钟定时器重试成功。用户所见"卡住"≈ 第一次超时 + 重试间隔；状态页在模拟器后台时轮询被节流亦加重观感。

## 验证

`task -d miniapp check` **exit 0**：assemble 校验、eslint、三套类型检查、**881/881 测试（63 文件）**、build:weixin、boundaries、secrets 全过。
校准：本机全量跑时 4–6 个 I/O 密集 preview/assembly 测试撞 5s 默认超时（隔离运行均过、最慢 13s），经用户批准将 `vitest.config.ts` testTimeout 提至 20s；不削弱断言。

## 验收标准覆盖

- 真实视觉 + 不编造：**真实通过**。
- 隔离/临时链接/不暴露桶密钥：契约测试（media 8、boundaries 25）+ 代码覆盖；真实跨账号未执行（单正式账号），如实记录。
- 非菜谱/审核拒绝/过期明确失败：非菜谱与超尺寸**真实通过**；审核拒绝与过期由契约测试覆盖（安全样本无法强制真实拒绝、7 天等待不现实）。
- 幂等/配额：契约测试 + 回读覆盖；发现下述缺陷。

## 遗留（不阻塞本票验收，关单后跟进）

1. **worker 强杀已由云日志确认**：attempt 1 调用（01:06:00.230 起）在 01:06:00.773 canCall 事务提交后再无任何 SDK 请求，直至 120s 上限被强杀；存储/视觉路径标称超时（5s/45s）在该运行时未生效，catch/settle 未执行。租约 90s 过期后 01:08:00 定时器回收重试成功（兜底设计生效）。跟进：`import-worker` timeout 120→300，并排查运行时定时器行为。
2. 被强杀尝试当日 `heldUsd` $1 不释放（`quota.ts` settle 仅 cost 已知时释放）；跟进：回收过期租约时结算旧预留。影响以当日 bucket 为界。
3. 验收/演示保持开发者工具前台（后台节流）。
4. `dist/task09-callback-secrets.json` 已按用户指令删除（2026-11-14）。

未做 Git 提交（未获授权）。