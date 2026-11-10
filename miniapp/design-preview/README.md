# 家常 · 手机端设计预览

**2026-11-10 用户已认可本预览的视觉方向。** 正式规范、来源与决策以及后续工单要求统一维护在 [设计基线](../../docs/design/miniapp/README.md)。预览样例和模拟交互不替代生产业务契约或微信真机验收。

直接用浏览器打开 `index.html`。图片、样式和脚本均在本目录，无需安装依赖或连接云服务。手机上铺满屏幕，电脑上以手机宽度居中显示；宽屏左侧可切换 320、375、390、430px。

可审阅：菜谱列表与详情、文字层级、食材份数、周计划、购物清单、家庭列表、添加/导入弹层。搜索、收藏、评分、计划和购物等操作仅保留在内存中，刷新即恢复示例数据。AI 导入为本地延时模拟，不调用 AI，不解析真实菜谱；正式版的解析、份数快照及购物数量合并应使用现有云端业务契约。

本页用原生 HTML/CSS/JavaScript 表达建议的设计方向，没有安装或伪装成实际运行的 Wot UI 小程序。

## 视觉依据

- Kitchen Stories：真实菜图、菜谱层次和易读步骤。https://pages.kitchenstories.com/de/app
- AnyList：按行操作的购物清单。https://www.anylist.com/
- Samsung Food：菜谱、计划、购物的连续操作。https://samsungfood.com/recipe-box-app/
- 项目现有主色 `#216840`；白底、中文系统字体、8–12px 组件圆角。

## 样例图片

图片仅作为样例菜图，本地保存在 `assets/`。下载源为 Unsplash 图片服务，正式产品应使用家庭上传的菜图。

- `noodles.jpg`: https://images.unsplash.com/photo-1569718212165-3a8278d5f624
- `chicken.jpg`: https://images.unsplash.com/photo-1532550907401-a500c9a57435
- `rice.jpg`: https://images.unsplash.com/photo-1512058564366-18510be2db19
- `salad.jpg`: https://images.unsplash.com/photo-1512621776951-a57141f2eefd
- `soup.jpg`: https://images.unsplash.com/photo-1547592180-85f173990554
- `vegetables.jpg`: https://images.unsplash.com/photo-1546069901-ba9599a7e63c

## 检查

使用项目已有的 jsdom，无新增依赖：

```sh
node miniapp/design-preview/verify.cjs
```

覆盖搜索、文本安全显示、收藏、详情、份数、加入计划、清单勾选、添加条目、家庭弹层、取消导入等交互。浏览器截图与屏宽检查仍需独立执行。
