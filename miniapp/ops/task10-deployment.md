# Task10：AI 公开网址导入部署与验收

> **2026-11-13 当前状态：用户已确认全部检验完成并授权验收、关闭、提交及推送。最终结果见 [Task10 收尾验收](task10-closeout.md)。下文早期 needs-info、登录归因与待部署描述保留为历史过程，不代表当前状态。**

状态：2026-11-12 本地实现与自动化验证完成；**未上传、未部署、未调用付费读取或解析、未操作真机**。Issue #10 保持 `needs-info`，直至部署者在既有支付宝测试空间确认 Jina Reader 可达、配置能力开关与预算，并完成真实读取验收。本轮不自动 git 提交、不关闭既有服务、不发布微信版本。

复用 #8 已交付的文本导入纵切片：`imports-co`（submit/get/cancel）+ `import-worker`（私有 `_timing` 分钟触发）+ OpenRouter DeepSeek 纯文本解析 + 租约/配额/幂等/恢复/审核/原子保存。本票只新增「公开网址 → 托管读取正文 → 复用解析保存」与失败降级到粘贴正文；不建自建抓取器，不伪造菜谱。截图降级属 #9（未交付），不做假入口。

## 读取服务（用户已确认）

Jina Reader 托管读取 `https://r.jinaai.cn/<已校验网址>`（官方国内过渡域名，见 [jina-ai/reader#1237](https://github.com/jina-ai/reader/issues/1237)），再交现有 OpenRouter 解析。官方契约（jina-ai/reader 仓库，2026-11-12 核对）：

- 请求头 `Accept: application/json`、`X-Timeout: 20`、`X-Retain-Images: none`、`X-Max-Tokens: 8000`；有 key 才加 `Authorization: Bearer`。
- **`X-Max-Tokens` 截断长页（≥500 生效），`X-Token-Budget` 会直接拒绝超预算的可读菜谱**——故用前者，避免把可读长页误判为不可读。
- JSON 返回 `code===200`、`data.url`（重定向后最终地址）、`data.title`、`data.content`。读取证据 = reader 返回的最终 URL + 非空正文，绝非模型自称。
- 尊重登录/付费墙/反爬，不绕过访问控制；失败请求不计费。免费档：无 key 20 RPM；免费 key 500 RPM + 10M tokens。
- 空白/缺失正文 → `read:false`；网络/超时/429/5xx（除 501/505）→ 可重试 `SOURCE_UNREADABLE`；其他 4xx/畸形/超上限 → 不可重试 `SOURCE_UNREADABLE`。

OpenRouter web 插件经核实是联网**搜索**（不读取指定网页），不满足验收，未采用。

## 现在填写能力开关与 Key 的位置

登录 uniCloud Web 控制台，选择支付宝服务空间 **mealie（env-00jy7289et7b）** → **云函数/云对象**：

- **imports-co** → 环境变量：`IMPORTS_ENABLED=true`（沿用 #8）、**`IMPORTS_URL_ENABLED=true`**（本票新增，缺省 false）。imports-co 不需要任何 Key。
- **import-worker** → 环境变量：`OPENROUTER_API_KEY`（沿用 #8）、`IMPORTS_ENABLED=true`、**`IMPORTS_URL_ENABLED=true`**、**`JINA_API_KEY`（可选，仅 worker）**。免费档可先不填 JINA_API_KEY（20 RPM）；填免费 key 提升到 500 RPM。

**两处都要设 `IMPORTS_URL_ENABLED=true`**：imports-co 控制是否接受新 url 提交，import-worker 控制是否领取 url 任务。关闭后 text 路径不受影响；在途 url 任务关开关则不领取、留在队列。replay/get/cancel 不受开关影响。

也可在 HBuilderX 右击对应云函数 → **配置云函数环境变量** → 填**远程值**保存到远程。不要填到根目录 `.env`、`VITE_*`、客户端或源码，也不要把 Key 发到聊天。官方说明：`https://doc.dcloud.net.cn/uniCloud/cf-env-variables.html`。既有配额变量（`IMPORTS_USER_TASKS`/`IMPORTS_FAMILY_TASKS`/`IMPORTS_*_USD`/`IMPORTS_RESERVE_USD`）沿用 #8，不变。

## 超时与租约数学

reader 20s + provider 45s + 审核 5s ≈ 70s < 90s 租约；单轮 35s 剩余预算门 + 70s < 120s 平台超时。reader socket 超时 25s、响应上限 262144 字节。租约 90s，过期 worker 不能保存。

## SSRF 与读取边界

- 提交时同步形状门 `normalizePublicUrl`：仅 http/https、禁 userinfo、端口仅 80/443/缺省、≤2048、拒绝 localhost/特殊后缀/私网 IP 字面量（Node URL 自动归一化 2130706433/0x7f000001/127.1/八进制变体）。违规同步 `INVALID_INPUT`，无 job/配额。
- worker 领取后、任何付费调用前：`validatePublicSource` DNS 解析**所有**地址必须公网（空应答/ENOTFOUND 不可重试，其他 DNS 错误可重试）→ reader 读取 → 对 **reader 返回的最终 URL** 再跑 `validatePublicSource`（重定向到私网 → 不可重试 `SOURCE_UNREADABLE`）。
- **DNS TOCTOU 残余边界**：Jina 独立解析域名，我方前置/后置校验是策略门不是 socket pin；不自建抓取所以无云侧 socket 可 pin。如实记录，不声称已消除。
- reader 正文按 UTF-8 码点边界截断 ≤16KiB，**checkpoint 写入 `sourceText`**（租约持有事务，镜像 #8 candidate checkpoint）——provider 重试不再重复读取、不双花 reader 费用。截断与「实际读取地址与提交不同」记入 `sourceWarnings`，保存时进入 provenance。provenance URL = **任务输入的提交 URL**。
- 提示注入：网页正文进入既有 user 消息，系统提示已禁止跟随输入内指令（provider.ts），无新工具面。

## 计费与 Schema 边界

- **reader 不计入 USD 预算**：`ai_usage` 仍只记录 OpenRouter 调用；reader token 由 Jina 侧计费。不虚构 reader USD/token 字段。如实记录此边界。
- `import_jobs` 新增 `sourceKind`（enum text/url）、`sourceUrl`（≤2048）、`sourceWarnings`（array|null），**均不加入 required**，存量在途行可写；读取处 `job.sourceKind ?? 'text'` 兼容旧行。**不回填存量行**。`error.enum` 加 `SOURCE_UNREADABLE`。索引不变，clientDB 四种 CRUD 权限仍全关。
- 终态/失败/expired/cancel 清理同步清 `sourceUrl:null`、`sourceWarnings:null`（与 sourceText/candidate 并列）。

## 真实读取验收程序（部署者侧，不入库不入聊天）

用近期活跃真实账号，在小程序提交：

1. **1 个公开可读菜谱 URL**：记录域名、reader 最终 URL、read 标志、保存菜谱数（应 ≥1）、attempts、`ai_usage` 的 cost/request-id。
2. **1 个不可读 URL**（登录墙/付费/404）：记录 read:false 或失败码 `SOURCE_UNREADABLE`、保存菜谱数 **必须为 0**、降级文案引导粘贴正文。

**绝不记录 key/Authorization/原始网页全文/用户原文。** 若云端出口无法访问 Jina：如实报告替代（key 档位、`X-Engine: direct` 延迟逃生旋钮）或请求改范围，不默默后置。本地环境曾探测 `r.jina.ai` 出现 `ECONNREFUSED`（出口受限），故真实读取必须在部署者云端核实，不以本地 fixture 替代。

实际云验收还须覆盖：关闭页面后定时开始、url 幂等重放、同 requestId 换 URL → CONFLICT、取消竞争、撤销成员/旧代次隔离、reader 429/500 退避重试 attempts≤3、reader checkpoint 后 provider 重试不再读、超 16KiB 截断 warning、最终≠提交 warning、停用与清理。最后回读云入口、公共模块、Schema、索引、触发器和配置存在性，绑定实际云编译产物摘要；本地 tsc 不替代 HBuilderX 上传编译。

真机验收须覆盖：方法切换、url 粘贴/提交、弱网原请求重放、关闭重进、隐藏停止轮询、失败降级到粘贴正文、终态停止、打开和编辑已保存菜谱、账号切换及旧成员代次隔离。状态矩阵（空/非法/超长/url 关闭/queued/running/failed-SOURCE_UNREADABLE/cancelled/succeeded/pending-replay）× 320/375/390/430px × 大字号；submit/status 键盘、粘贴、44×44 触摸目标、安全区；微信开发者工具真实渲染截图。

## 本轮部署记录（2026-11-13）

**端点决定（2026-11-12 更正）**：`r.jinaai.cn` 经官方 issue 核实为 **Jina 官方国内过渡域名**——[jina-ai/reader#1237](https://github.com/jina-ai/reader/issues/1237) 中 Jina 成员 nomagick 说明 `jina.ai` 整域在国内遭 DNS 污染，官方建议以 `r.jinaai.cn`/`s.jinaai.cn` 过渡，接口/参数/认证完全一致。此前「非官方」结论仅凭被动 DNS（CNAME `r.jinaai.cn.a1.inituu.com` 为国内接入）且未查官方 issue，予以更正。`reader.ts` 端点已切换为 `https://r.jinaai.cn/`，`Authorization: Bearer <JINA_API_KEY>` 按官方契约发送至该过渡域名。

**已上传**（HBuilderX CLI，支付宝空间 mealie / env-00jy7289et7b，官方 TS 类型检查 + 编译通过）：公共模块 `home-contracts`、`home-imports`（含新 `reader.ts`/`urls.ts`，依赖云函数自动更新）；云对象 `imports-co`、`import-worker`。

**Schema 待同步**：云端 `import_jobs` 仍为 task08（缺 `SOURCE_UNREADABLE`/`sourceKind`/`sourceUrl`/`sourceWarnings`）。CLI `--upload db` 反复误判「跳过上传」（含紧凑化重写仍跳过），下载回读证实云端为旧版。**需在 HBuilderX GUI 右击 `import_jobs.schema.json` → 上传 DB Schema 手动同步**。云函数 admin 写入绕过 Schema 字段校验，故不阻塞 worker，但应同步以保持一致。

**云端出口未实证**：egress 探针（云函数与云对象两种格式、自包含 `node:https` 直连官方 `r.jina.ai`）经 CLI `unicloud cloud-function upload-and-run` 五次均瞬时 FAILED（0B 内存、空结果、日志仅 "Array"），属该空间 CLI 调用机制限制，**不是 egress 结论**。云端到 `r.jina.ai` 可达性仍未验证；本机出口此前为 `ECONNREFUSED`，不代表云端。

**残留待清理**：云端 `task10-egress-probe`（云函数 + 云对象）CLI 无删除命令，请在 uniCloud 控制台 / HBuilderX GUI 删除；本地探针文件已清理。

**未做**：付费读取/解析、真机操作、微信开发者工具 CLI 截图（本机未安装该 CLI）。真实读取验收须由近期活跃真实账号在微信开发者工具完成（见上「真实读取验收程序」）。

## 端点切换与 UI 截图重采（2026-11-12 续）

- **端点切换**：`reader.ts` 由 `https://r.jina.ai/` 改为 `https://r.jinaai.cn/`，同步 `tests/contracts/ai-url.test.ts` 三处断言与本文/sources.md/acceptance.json。来源为官方 [jina-ai/reader#1237](https://github.com/jina-ai/reader/issues/1237)（Jina 成员 nomagick：jina.ai 整域国内 DNS 污染，官方以 r.jinaai.cn/s.jinaai.cn 过渡，接口/参数/认证一致）。上文「非官方」安全决定据此更正。
- **本地验证**（等价既有门禁，node 直调）：受影响 7 套件 183 项 vitest（`--testTimeout=120000`）全过；云端 `tsc -p tsconfig.cloud.json` exit 0；ESLint `--max-warnings 0` exit 0；`check-boundaries.mjs`、`check-secrets.mjs` exit 0。
- **UI 截图重采**：`uni build -p mp-weixin --mode ui-review --outDir dist/ui-review/mp-weixin` 重建（含网址方法），经 `D:/微信web开发者工具/cli.bat` cache→close→auto（9421）后 `node review/capture-wechat.mjs --scenes=import-submit,import-submit-url,import-queued,import-running,import-succeeded,import-failed,import-field-error --width=390` 重采 7 张（含新增 `import-submit-url` 场景，点击「网址导入」tab）。`wechat-import-submit-url-390.png` 实测显示「粘贴正文/网址导入」tab 与「菜谱网址」输入框。均为微信开发者工具模拟器证据（IDE 缩放 318×688），**非真机、非真实云读取**。
- **云端重传（2026-11-12 已完成，用户授权）**：`unicloud common-module upload --force` 重传 `home-imports`（官方 TS 检查通过、编译 8 文件含 reader.ts），回执「被云端云函数依赖，正在更新相关云端云函数…更新成功」（import-worker 等依赖随之更新）。只读回读 `dist/task10-readback-cn/home-imports/reader.js:55` 确为 `https://r.jinaai.cn/`，绑定实际云编译产物；未触碰其他资源。
- **仍待部署者**：① 两处 `IMPORTS_URL_ENABLED=true` + Schema 同步 + 可选 `JINA_API_KEY`/预算；② 真实账号 1 可读 + 1 不可读 URL 真实读取验收。CLI `upload-and-run` 在本空间瞬时 FAILED，真实读取须微信开发者工具 + 真实账号完成，不以模拟器截图替代。

## 真实请求尝试（2026-11-12 续，生产构建）

- 生产构建 `dist/build/mp-weixin`（真实云客户端 `production-client.ts`，非 ui-review mock）经 devtools 自动化端口 9422 打开；ui-review（9421）已关闭释放 IDE。
- **云域名放行**：`project.private.config.json` 的 `urlCheck:true` 覆盖了 `project.config.json`，两处均改 `false`（仅开发期「不校验合法域名」，放行官方 DCloud 云域名 `api.bspapp.com`/`api.next.bspapp.com`，非代理；**生产须恢复并配置 MP 后台合法域名**）。两域名空 POST 均返回 400（到达服务器，域名已通）。
- **登录被真实后端拒绝**：`wx.login` 可用（返回 code），但云 `loginByWeixin` 失败，登录页错误态 `网络暂不可用`+`登录已失效`（AUTH_REQUIRED），`home.auth.closed=true`。devtools 模拟器账号/代码被真实微信后端拒绝——即验收文档「近期活跃真实账号」缺口。**真实读取验收须用近期活跃真实微信账号扫码登录 devtools 后重试**，本轮未伪造任何真实读取/解析证据。
- **样本已备**：可读 `https://www.bbcgoodfood.com/recipes/easy-chicken-curry`（经官方 `r.jinaai.cn` 探针 code 200、真实菜谱正文）；不可读须真实硬 404（BBC 软 404 返回 200「Crumbs」页，不算干净 SOURCE_UNREADABLE，待另选）。
- provider/cloud/device 仍 `needs-info`；真实读取/解析/真机验收未做。

## 本轮不做

截图导入/#9 入口；自建抓取器；OpenRouter web 插件；新 UI 组件库/wd-* 注册；reader USD 计量字段；`?method=` 路由参数与额外降级按钮；历史/批量导入；自动 git 提交/关闭 issue/生产发布；task10 进入 deploy-preview/doctor 允许清单（无测试强制，ponytail 不加）。