# 离线微信渲染检查

这是测试专用客户端。它只存在于专用构建中，返回内存中的明确样例；不证明云业务已验收。正式构建仍使用 `src/shared/production-client.ts`。

在 `miniapp/` 执行：

```powershell
pnpm exec uni build -p mp-weixin --config tests/visual/vite.config.ts --outDir ../.superpowers/ui-visual/mp-weixin
```

在微信开发者工具导入 `.superpowers/ui-visual/mp-weixin`，用自定义编译入口选择下面的页面和参数。`--outDir` 必须显式传入；配置会拒绝输出到正式构建目录。每次改变 `fixture` 后重新编译/启动，避免把上一个样例的页面内存或恢复存储当成当前状态。需要从恢复场景重新开始时，只清除此离线项目的测试存储。

- 登录：`pages/account/login`，参数 `fixture=login`；可点击微信登录按钮走离线返回。
- 家庭引导：`pages/family/onboarding`，参数 `fixture=onboarding`。
- 家庭首页、邀请、成员：`pages/family/home`、`pages/family/invite`、`pages/family/members`，参数 `fixture=family`；普通成员用 `fixture=member`。
- 加入：`pages/family/join`，参数 `fixture=join`，邀请码使用 43 个 `A`。
- 菜谱列表：`pages/recipes/index`，参数 `fixture=family`；空列表用 `fixture=empty`。
- 菜谱详情/编辑：`pages/recipes/detail`、`pages/recipes/edit`，参数 `id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&fixture=family`。新建编辑不传 `id`。
- AI 提交：`pages/imports/submit`，参数 `fixture=family`。
- AI 状态：`pages/imports/status`，参数 `id=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&fixture=queued`；另测 `running`、`succeeded`、`failed`、`cancelled`。
- 家庭加载失败：`fixture=unavailable`；图片审核中/拒绝：`fixture=media-pending` / `fixture=media-rejected`。

在 320/375/390/430 逻辑像素及系统大字号分别检查；保存页面、状态、尺寸、工具/基础库版本、截图和与认可预览的差异。安全区、软键盘及屏幕阅读另做真机核对。图片样例复用设计预览已有的 `chicken.jpg`，只被专用构建复制。

2026-11-10 已通过 fixture 自检和专用微信编译。桌面检查因用户按 Escape 停止，尚无这次实现的实际微信截图或真机证据。
