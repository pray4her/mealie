# Issue #12 组件与实现依据

- 基准：miniapp-dev / 3d983cc38325d455c5f9d682346ec0324679382e；本票实现尚未提交，不编造实现提交。
- 设计：P-13；D-02/03/04/06/08/10/11/12；S-PREVIEW、S-ANYLIST、S-WOT-AI、S-UNI、S-WECHAT。沿用批准预览的紧凑采购行、数量右对齐、已购分组；不带入原型分类、样例数据或仅按名称去重。
- 本机安装：Vue 3.4.21、uni-app 3.0.0-5030420261029002、@uni-helper/uni-app-types 1.4.2、@wot-ui/ui 2.4.0、Wot CLI 1.2.1。没有升级依赖；review/npm ci 仅安装既有锁文件中的 miniprogram-automator 0.13.0。
- 按 vue-best-practices、uni-app、uni-helper、wot-ui-v2、Refero 的既有参考锁及表单/排版 craft 实施。没有可用 Refero MCP，不声称新增 Refero 数据库研究。

## 查询与能力

- 本地 `llms.txt` 与 `llms-full.txt`：Checkbox（url标题约2451行）、Form、Popup、Cell；实际运行 `wot info Checkbox --version 2.4.0 --format json`、`wot token Checkbox --version 2.4.0 --format json`，并对照安装包 `wd-checkbox/types.ts`、`wd-checkbox.vue`。
- Checkbox：单个 `model-value`、`type="square"`、`readonly`、`disabled`；选中变化为 `change` 的 `value`。本票由原生命中区发绝对 checked 命令，视觉 Checkbox 只读，不发生双重翻转。
- 主题变量：`--wot-checkbox-icon-size`、`--wot-checkbox-color-checked`、`--wot-checkbox-unchecked-color`，其余沿用既有主题。
- Wot 2.4.0 Checkbox 内部是普通 view，故原生语义命中区提供 `aria-role/aria-checked/aria-disabled/aria-busy`，视觉子树隐藏，名称区域与勾选区连续，编辑独立。Form/FormItem 仍负责 schema/prop 校验；原生 input/textarea 沿用已有兼容例外。
- Popup：v-model、position=bottom、safe-area-inset-bottom、closable；Cell/CellGroup：title/value/is-link/border。表单沿用当前 FormInstance/FormSchema、字段错误定位及 leave guard。

## 官方依据

- [Wot v2 Checkbox](https://wot-ui.cn/component/checkbox.md)，Context7 `/wot-ui/wot-ui`，执行时与2.4.0源码交叉核对。
- [uni-app页面生命周期](https://uniapp.dcloud.net.cn/tutorial/page.html)，Context7 `/dcloudio/unidocs-zh`：onShow反复触发、onHide隐藏、下拉刷新结束调用stopPullDownRefresh。
- [uni-helper类型](https://github.com/uni-helper/uni-typed)：保持现有tsconfig types与模板事件类型，不为本票引入新Vite插件。
- [uniCloud事务](https://doc.dcloud.net.cn/uniCloud/cf-database.html)：事务内仅短时数据库操作，不在事务中等待内容审核；条件与成员关系仍由业务层验证。
- 微信官网框架/CLI/可访问性页面本次浏览入口不可读取，CLI参数使用本机2.02.2611092的help与实际执行结果核对；不把文档或源码标注当成真机读屏验收。
