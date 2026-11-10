# Issue #20 既有页面重构实施记录

源计划：本轮用户提供的续作计划。实际起点：`842a0ee114`，`miniapp-dev`，工作区干净。
设计：`docs/design/miniapp/README.md` v1；D-01/02/03/06/07/08/09；S-USER/PREVIEW/BUSINESS/CODE/WOT/UNI/A11Y。

## 范围和顺序

1. 锁定 Wot 2.4.0 / Sass 1.98.0，easycom、全局类型、统一主题；先验证真实菜谱列表。
2. 原生菜谱/家庭双 Tab；登录/创建/加入进入菜谱，邀请续接优先；回归所有导航调用方及隐藏/恢复。
3. 双列菜谱、显式搜索/精确标签/收藏/有界分页；页面内授权封面、到期刷新和迟到响应隔离。
4. 详情、编辑；保留未知值、结构化食材、冲突、幂等恢复及独立图片保存。
5. 登录和家庭五页；保留管理权限、分享和原生确认，补专用验收记录与候选包摘要。

## 预检与裁定

- 基线：`task -d miniapp test -- --maxWorkers=2` → 54 套件、676 测试通过。
- 共享接口：步骤 1 的 Wot 输入/点击事件影响步骤 2–5 的页面测试；测试注册真实 Wot，仅替换 uni 原生宿主。
- 共享接口：步骤 2 的 Tab 路由影响登录、家庭守卫、成功跳转、详情/导入返回；分别断言 switchTab / reLaunch / navigateTo。
- 共享接口：步骤 3 封面与步骤 4 图片共用 MediaApi，但封面仅存页面内存，不调用编辑草稿控制器。
- Ruling: 按用户指定起点在专用 `miniapp-dev` 分支原位实施 — 已有完整依赖且用户明确要求续作 — 改动留在该分支便于直接审阅。
- Ruling: 沿用已批准设计，不重新选型或安装缺失设计技能；不引入新云业务、部署或付费供应商调用。
- Ruling: 设备证据须以实际工具为准；缺失时保持待验收，不关闭 #20。

## 进度

- 已读取批准基线、来源、工单规则和当前页面、控制器、媒体接口及测试宿主。
- Task 1: complete — Wot / Sass 已精确锁定；真实 Wot 搜索、按钮、添加弹层事件与微信构建通过。
- Task 2: complete — 原生双 Tab、普通登录/创建/加入成功跳转菜谱、邀请续接、导入返回及失效身份重置已覆盖。
- Task 3: complete — 两列 4:3 首图、窄屏/大字号单列、真实家庭、精确搜索、收藏恢复、有界分页、封面失败降级/到期刷新/旧作用域隔离已覆盖。
- Task 4: complete — 详情图片失败仍可读正文；按批准顺序展示真实字段；编辑 Wot 控件保留 null、结构化字段、冲突、独立图片保存与原生选图恢复。
- Task 5: complete (implementation) — 登录及家庭五页重构，专用状态/待验收记录已建立；设备视觉验收尚未通过。
- Ruling: Wot 官方全量 global 声明引入未使用画布/视频/二维码的上游类型错误 — 仅注册五个实际使用组件的官方类型，不屏蔽业务诊断 — 后续增加组件时须补官方类型并再次验证。
- Ruling: 原构建边界禁止所有 Tab，与批准导航冲突 — 改为精确验证两个已实现的原生 Tab；拒绝缺失/空/额外/重复/query/custom/未来页面 — 不放宽云代码或密钥边界。
- Ruling: 本次保留分支本地交付，不推送、合并或关闭 #20 — 用户要求实施与验证，设备缺口仍存在。
- Final review: independent read-only reviewer, base 842a0ee114 → working tree. Final verdict: no remaining Critical/Important code blockers, contingent on final full check.
- Final: fixed real SessionBoundary expiry leaving the visible page stuck — adapter regression RED→GREEN, visible page reLaunch once; hidden page never redirects.
- Final: fixed Wot button style priority preventing long-text growth — actual dependency SCSS and generated wxss inspected; higher-specificity height/text/content rules applied; rendered-device evidence remains pending.
- Final: minor (device-pending): Wot native button does not forward aria-disabled/aria-busy; explicit selected text and numeric field placeholders added. Do not claim WeChat screen-reader validation.
- Final: Ruling: reviewer set aside existing editor media-init failure, whole-gallery detail fallback, and list cover rereads — baseline behavior / safe readable fallback / bounded family-scale work accepted — no new data loss or authorization boundary; device UX and large-family performance remain unproven.
- Final: Ruling: four-width screenshots, large text, keyboard and screen readers cannot be graded from jsdom — keep them pending in issue20-ui-acceptance.md — #20 remains open for acceptance.

## 验证与交付

最终运行 `task -d miniapp check -- --maxWorkers=2` 与 `git diff --check`。
最终实测：完整检查退出 0；55 套件 / 694 项通过（基线 676 项）；装配、lint、三组类型、微信构建、严格边界和密钥扫描均通过。`git diff --check` 退出 0。
实际实施本地提交：`1978ad2b532d76ec9b13266c32a2ce4aa8b2010e`。新 UI 候选单独保存在 `miniapp/ops/issue20-ui-candidate.json`；114 文件 / 453,891 字节；构建摘要 `19c95e686e38587d8a0cfc422a0b7288b46c5cc85bac491d22f4980bdc94d40c`。
九页状态矩阵、设备缺口、实际实施提交及新候选包摘要见 `miniapp/ops/issue20-ui-acceptance.md`。
不覆盖 #6–#8 历史验收；不把本地构建视为云端或真机通过。
