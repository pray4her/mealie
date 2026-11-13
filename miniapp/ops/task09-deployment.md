# Task09：图片导入云端部署与回读

日期：2026-11-13（北京时间）。分支 `miniapp-dev`，部署基线 `eb6721cb9`（feat(miniapp): 实现 AI 菜谱图片导入 (#9)）。目标：既有支付宝测试空间 `mealie / env-00jy7289et7b`。用户明确授权“部署 HEAD 代码”。工具：HBuilderX v5.34.2026102909 CLI + unicloud 插件 3.0.14-2026102820，协议版本 1。

## 已上传（均取得官方成功回执，日志在忽略目录 `dist/task09-deploy/`）

- 公共模块：`home-contracts`（TS 检查通过、编译 6 文件）、`home-imports`（8 文件）、`home-media`（9 文件）。每次上传回执均含“被云端云函数依赖，正在更新相关云端云函数…更新成功”，依赖入口（media-co、imports-co、import-worker、media-review-callback、recipes-co）随之更新。
- 云对象：`import-worker`（TS 检查通过、编译 1 文件）。
- Schema：`import_jobs.schema.json`、`media_files.schema.json` 上传成功。
- 索引：`media_files.index.json`（新增 `import_cleanup_id`：purpose/cleanupAt/_id）初始化完成。

未触碰其他资源；未清空或初始化数据库；未修改环境变量；未上传微信版本、未操作真机、未调用付费 AI。

## 只读回读验证（`dist/task09-readback/`，绑定实际云编译产物）

- `import_jobs.schema.json` 含 `sourceMediaId`、`IMAGE_UNREADABLE`、`sourceKind` 枚举 `image`。
- `media_files.schema.json` 含 `importJobId`。
- `home-media/imports.js` 含 `requireImportMedia`/`readImportImage`/`releaseImportMedia`/`cleanupImportMedia` 与 `import-input`；`review.js` 含 `imgSecCheck`、`scene: 3`、`version: 2`。
- `home-imports/provider.js` 含 `image_url`、`data:`、模型 `deepseek/deepseek-v4.1-flash-1017`；`model.js` 含 `IMPORTS_IMAGE_ENABLED`；`worker.js` 含 `readImportImage`、`IMAGE_UNREADABLE`。

## 环境变量现状（CLI get-environment 只读核对，仅记录变量名与存在性，不读取值）

- `imports-co`：IMPORTS_ENABLED、IMPORTS_URL_ENABLED、IMPORTS_IMAGE_ENABLED、MEDIA_REVIEW_ENABLED 均已设置。
- `import-worker`：上述四项 + JINA_API_KEY、OPENROUTER_API_KEY 均已设置。
- `media-co`：**无任何环境变量**。代码在 media-co 读取 `MEDIA_REVIEW_ENABLED`（media-co/index.obj.ts），当前设在 imports-co/import-worker 上的同名变量不被读取，审核实际仍为关闭模式。需在 media-co 设 `MEDIA_REVIEW_ENABLED=true`。
- `media-review-callback`：**无任何环境变量**。缺 `MEDIA_REVIEW_CALLBACK_TOKEN`、`MEDIA_REVIEW_ENCODING_AES_KEY`、`MEDIA_REVIEW_WEIXIN_APP_ID`。

## 真实验收外部前置（未满足，保持 needs-info）

- 微信公众平台后台为**小程序测试号**（AppID wx68649810a6f363f3），仅有开发者 ID 与服务器域名，无“开发管理/开发设置”菜单，因此**无消息推送配置入口**。`media_check_async` 的异步审核结果只能经消息推送（`wxa_media_check` 事件）投递，测试号无法接收，图片审核链无法完成。需注册正式小程序账号（个人主体免费）后配置消息推送。
- 同步文本审核（msg_sec_check v2）在 #10 真实验收已通过，证明测试号可调用同步内容安全接口；但异步图片审核依赖推送通道，与同步接口不同。
- 视觉模型 `deepseek/deepseek-v4.1-flash-1017` 经 OpenRouter 公开目录核实支持 image 输入；真实视觉调用验收未做。

## 边界

部署完成不等于真实验收。media-co 启用审核后，既有菜谱图片上传（#7）也会走真实审核；在推送通道就绪前会停在 pending 并于 30 分钟后转 review-error。是否暂时回退 media-co 的 MEDIA_REVIEW_ENABLED 由部署者决定。本轮未改任何环境变量值。

## 切换到正式微信 AppID（2026-11-13 续，用户授权）

用户注册正式个人小程序账号，AppID `wxdf2ca9836263776e`（替代测试号 `wx68649810a6f363f3`）。测试号无消息推送入口，异步图片审核无法投递，故必须切换。

- 客户端：`src/manifest.json` 的 `mp-weixin.appid`、`ops/project-target.json` 的 `weixinAppId` 改为新 AppID；HBuilderX `publish mp-weixin --appid wxdf2ca9836263776e --upload false` 重建成功，产物 `dist/build/mp-weixin/project.config.json` appid 已核对为新值，manifest 未回退。
- 云端微信配置：AppSecret 经 1Password CLI（op 2.42.0，用户生物识别授权）从条目 `unicloud小程序开发备注密钥` 的 concealed 字段读取，未进聊天/日志。下载云端 `uni-config-center` 取现有 `uni-id/config.json`，仅改 `mp-weixin.oauth.weixin.appid/appsecret`，保留 `tokenSecret`(64) 及其余字段，写回源码模块并上传；依赖云函数（uni-id-co、uni-open-bridge-common 等）自动更新。回读核对：云端 appid=新值、appsecret 已设(32)、tokenSecret 保留(64)、dcloudAppid 不变。
- 环境变量：`media-review-callback` 经 CLI set-environment 设 `MEDIA_REVIEW_WEIXIN_APP_ID`=新 AppID、`MEDIA_REVIEW_CALLBACK_TOKEN`、`MEDIA_REVIEW_ENCODING_AES_KEY`（后两者随机生成，存于 gitignored `dist/task09-callback-secrets.json` 供部署者填微信表单，用后删除）。修正 `media-co` 拼写错误 `MEDIA_REVIEW_ENABLE`→`MEDIA_REVIEW_ENABLED=true`。
- 含密钥文件（src 与 dist 的 config.json、callback-secrets.json）均经 git check-ignore 确认被忽略，不入库。临时 AppSecret 文件已删除。

### 切换影响与待办

- openid 按 AppID 隔离：测试空间旧微信账号/家庭失效，真实验收需重新登录建家庭。
- 待部署者在微信公众平台（正式账号）配置消息推送：URL=media-review-callback 的 URL 化地址（uniCloud 控制台云函数详情可见，路径 /media-review）、Token/EncodingAESKey 与上述变量同值、安全模式、JSON；先设好云端变量再提交（微信保存时即发 GET 握手）。
- 待配服务器域名（request 合法域名 api.bspapp.com / api.next.bspapp.com）供生产 urlCheck。
- 真实验收：近期活跃真实账号 选图→上传→审核→导入，覆盖成功/非菜谱/审核拒绝/过期样本与状态矩阵截图。

## 修复：消息推送 Token 校验失败（2026-11-13 续）

部署者在微信后台提交消息推送表单时报“Token 校验失败”。系统化调试取证：

- 用真实 Token/AESKey 构造合法安全模式握手实测，回调正确解密出 echostr，但支付宝云 URL 化把返回值包装成 `{"statusCode":200,"headers":...,"body":"<echostr>"}`（HTTP 200 + JSON 信封），而微信要求响应 body 原样等于 echostr 明文。
- 根因：支付宝云 URL 化默认 JSON 包装返回值；需在返回对象加 `mpserverlessComposedResponse: true` 才把 `{statusCode,headers,body}` 当作真实 HTTP 响应（uniCloud 官方 http 文档）。回调 `callback.ts` 的 response 缺该标志。此前仅本地 mock 测试，未对真实微信握手验收，故未暴露。
- 修复：`home-media/callback.ts` response 增加 `mpserverlessComposedResponse: true`（同时修正 GET 握手与 POST 通知响应）。TDD：先在 `tests/contracts/media.test.ts` 加回归断言该标志（红），修复后绿；media 契约 7 项 + 相关媒体/图片导入 45 项全过。
- 重新上传 home-media（media-review-callback 随之更新），实测合法握手返回 HTTP 200 且 body 原样等于 echostr，校验通过。部署者可重新提交消息推送表单。

## 修复：服务器地址验证失败（2026-11-13 续二）

提交表单仍报“服务器地址验证失败”。取证：微信官方初始接入验证协议为 GET 带 `signature=SHA1(token,timestamp,nonce)` + **明文 echostr 原样返回**（与加密消息的 `msg_signature`+密文协议不同）；回调此前只实现加密协议，对明文初始验证返回 403。实测加密握手能过而微信失败，印证微信初始验证走明文 signature 方案。

- 修复：`home-media/callback.ts` GET 增加明文初始验证分支（`signature` 存在且无 `msg_signature` 时，校验 SHA1(token,timestamp,nonce) 后原样返回 echostr），保留加密分支，两者兼容。
- TDD：`tests/contracts/media.test.ts` 增明文初始验证回归（含伪造签名 403），先红后绿；media 契约 8 项全过。
- 重新上传 home-media，用真实密钥实测明文初始验证与加密消息两种握手均 HTTP 200 且 body 原样等于 echostr。部署者可重新提交消息推送表单。