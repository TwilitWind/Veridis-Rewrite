# 词汇映射 · 改动的典型落点

「想改什么 → 改哪里」速查表与样式文件职责速查。模块职责见 [modules.md](modules.md)，机制约束见 [mechanics.md](mechanics.md)。

## 六、改动的典型落点

| 想改什么 | 改哪里 |
| --- | --- |
| 加一个页面 | 模板 `section.page-panel` → `.rail` 与 `.bottom-nav` 各加按钮 → `ui/shell.js` 元数据 → 新建 `src/<page>/` |
| 加一条设置项 | `settings/defaults.js` + `migration.js` 的 `ensureSettingsShape` + 对应页 view/events |
| 改匹配或替换行为 | `rules/regex.js`（编译）与 `rules/engine.js`（替换） |
| 改正则报错文案 | `rules/regex.js` 的 `translateRegexError` |
| 改 AI 改写调度 | `aiRewrite/runtime.js`；写回范围在 `matching.js`；终稿合并与 `chat/cleanse.js` 一起看 |
| 改撤回算法 | 只改 `diff/revertMerge.js` |
| 改撤回所选交互 / 性能 | `diff/pickRevert.js`（编号 + 采集索引）+ `diff/events/events-00-interactions.js`（计数缓存、apply 提交）+ `events-01-bindings.js`（勾选事件） |
| 改来源筛选 / 逐条定位 | 状态在 `diff/state.js`（`diffFilterEnabled`/`diffSelectedSources`/`diffNavIndex`，会话内不持久化）；开关只控制筛选行折叠，行内程序/AI/手改可多选，空数组表示不筛选。`compare.js` 给块打 `data-diff-section`（手改提示也带该属性），`events-00-interactions.js` 的 `syncDiffFilterState` 每次重渲染按选择给未选块加 `.blai-diff-source-hidden`（`00-diff.css` 里 `display:none`，不用 `!important`）；`toggleDiffSourceFilter` 切换多选、折叠时清空。可见项收集、跳转高亮与筛选清勾选也在 `events-00-interactions.js`（`setDiffFilterEnabled`/`navigateDiffItems`），绑定在 `events-01-bindings.js`；DOM 在 `templates/purifier-diff.html` 的 `#blai-diff-filter-panel`。来源图例是 span 纯展示；筛选切走会清掉被隐藏的已勾选项，避免撤回误伤 |
| 改改写项计数 / 来源图例 / 说明文字 | 计数口径在 `diff/diffStats.js` 的 `collectDiffStats`：程序/AI 按 `data-blai-revert-item` 去重、按 `data-blai-diff-section` 分组，手改用 `getTextDiffOperations` 比较 programMes 与当前正文、连续一段算一次（撤回态记 0）；`events-00-interactions.js` 只负责回显。四项来源图例由 `diff/diffCopy.js` 的 `renderSourceLegend` 生成到模板容器 `#blai-diff-sources`，深度清理顶栏复用同一生成器；原文用正文色、其余三种共用 `--blai-diff-source-*`（定义在 `styles/tokens/01-palette.css`），与正文 del/ins 同源；控件无边框，选中态只用背景胶囊。空态/提示统一 `.blai-diff-empty`（次级文字色 + 行首图标），定位高亮用 `--blai-border-2` 单层描边、无投影。 |
| 改零命中空态文案 | `diff/emptyHint.js`（按 AI 开关与 AI 模式规则数给原因），由 `diff/events/events-00-core.js` 渲染；不要把长段说明塞回事件核心文件 |
| 改「更多操作」菜单偏好 | `diff/preferences.js` 的 `SPECS` 加一项（取值 + read/write）→ 模板按钮加 `data-blai-pref="<键>"`；键名必须与 SPECS 一致，否则点击无效 |
| 改移动规则弹窗步骤 | `rules/view/view-03-subrule-transfer.js`（步骤切换）+ `templates/purifier-modals.html` 的 `#blai-subrule-transfer-*` + `styles/pages/home/home-overview.css`（`.blai-transfer-step`） |
| 改下拉滚动关闭行为 | `ui/popover.js` 的 scroll 捕获：portal 菜单内部滚动必须 return，外部才 `closeAllMenuPopovers` |
| 改下拉外观 / 限高 | `styles/tokens/02-themes.css` 的 `--blai-dropdown-*`（pad/gap/item-radius/max-height），组件不写裸值；`ui/popover.js` 的 `positionManually` 再按锚点空间收紧。portal 到 body 的菜单必须带 `.blai-portal-menu`，否则继承不到 token |
| 改导览卡定位 | `ui/tour/tour-01-steps.js` 的 `calculateTourPopoverPlacement` / `positionTourPopover` + `styles/pages/tour/00-tour.css`。导览卡不要挂 `.blai-modal-card`：通用弹窗规则的 `width:100%!important` 会把按内容限宽的气囊撑到视口宽，手机端再被 clamp 推成负 left |
| CDP 探针不要伪造外壳 display | `#blai-purifier-popup.blai-app-shell` 自身是 grid 布局；探针里写 `shell.style.display='flex'` 会覆盖 grid，让 `.rail` 变成整行竖排、页面内容塌到下方，截图看起来像「没显示完」。需要打开界面时走真实入口，或只清掉 inline `display:none`，不要强行设 `flex` |
| 改滑动开关 | `styles/components/02-controls.css`：轨道和滑块全用 CSS 绘制，模板 / `scope/view.js` 只输出空 track；轨道 `inline-flex + align-items:center + justify-content:flex-start + padding:0 2px` 让圆点垂直居中且关闭态靠左，开启态只改 `--blai-switch-knob`（近白色，不用主题 `accent-contrast`）与 `--blai-switch-offset: calc(100% - 14px)`；页面级规则也必须写 `flex-start`，写 `center` 会把关闭态圆点推到中间 |
| 改 API 手动模型 | `aiRewrite/settingsEvents/events-00-core.js` 的 `syncAiModelControl` / `removeManualAiModel`（手动在前），`events-01-bindings.js` 的管理弹窗绑定，模板 `#blai-ai-model-manage-modal` |
| 给原生 select 选项加图标 | `ui/nativeSelectMenu.js` 读 `data-blai-icon`，自绘 trigger / menu 都渲染 `<i class="fas fa-*">`；图标类必须在 FA 6.5.2 存在 |
| 改弹窗顶栏字号 | `styles/tokens/03-scale.css` 的 `--blai-fs-control` / `--blai-fs-control-icon`（桌面 13/16、手机 14/18）；子规则「代码高亮」在 `home-breakpoints.css`，两个规则弹窗的关闭叉号在 `home-rule-edit-modal.css`，按钮盒仍 28px |
| 改处理方式分段切换 | 模板 `#blai-modal-sub-rewrite-mode-segment` 是视觉层，`#blai-modal-sub-rewrite-mode` 仍是隐藏数据锚点（带 `.blai-visually-hidden`，不被自绘 select 接管）；`rules/events/events-01-ui.js` 的 `applySubruleRewriteModeUI()` 同步选中态与 AI 输入框显隐，点击绑定在 `events-07-subrule.js` |
| 改正则语法高亮配色 | `styles/tokens/01-palette.css` 与 `02-themes.css` 的 `--re-*`：保留色相、`color-mix(..., var(--text-main))` 跟主题明度；`home-regex-highlight.css` 的覆盖层必须与 textarea 同字号/行高/字重，禁止加粗 |
| 改模型行操作 | 模板 `#blai-ai-model-actions-toggle` / `#blai-ai-model-actions-menu` 复用 `.blai-preset-menu` 与 `popover.js`；菜单项保留原 `#blai-ai-model-manual-add` / `-manage` / `-fetch` 三个 id，业务绑定与禁用态不用改；绑定入口在 `aiRewrite/settingsEvents/events-01-bindings.js` |
| 改差异记录 | `diff/tracking.js`（谁被记录）+ `messageMeta.js`（存取）+ `view.js` / `compare.js`（渲染） |
| 改命中规则定位 | `rules/ruleIdentity.js`（指纹）+ `rules/engine/engine-00-patterns.js`（processor 带来源）+ `engine-01-replace.js`（命中回调）+ `diff/ruleHitTrace.js`（存取回查）+ `diff/events/diffRelatedRules.js`（UI） |
| 改全文改写上色 | `styles/pages/diff/00-diff.css`（`.blai-diff-modal-content ins/del` 用 `--blai-diff-stage-*`，片段/全文共用） |
| 改深度净化范围 | `inventory.js`（列什么）+ `contentItems.js`（读什么）+ `apply/`（写回什么）+ `view.js`（界面说明） |
| 改深度净化预览交互 | `deepClean/events/events-01-preview.js`（入口、筛选、逐条定位、差异勾选、取消在途请求）；主流程在 `deepClean/events.js`，执行阶段由 `startDeepCleanProcessing` 回调接回 |
| 改扫描结果指标文案 / 布局 | `deepClean/view/view-00-selection.js` 的 `renderDeepCleanScanResult`（指标名 + 口径说明 + 按钮文案）+ `styles/pages/clean/clean-deep-processing.css` + `clean-deep-responsive.css`；计数口径以 `deepClean/scan.js` 为准 |
| 改新手指引步骤 / 锚点 | `ui/tour/tour-01-steps.js`（文案）与 `tour-00-targets.js`（目标函数）。目标必须桌面/手机都存在且可见；手机端滚动由 `tour-02-runtime.js` 的 `phoneTourScrollOwner` 处理。改完在桌面与手机双视口实测锚点与显隐 |
| 改对话框外观 | `ui/notifications.js` + `styles/components/02-controls.css` 的 `.blai-plugin-dialog-card` 段 |
| 改菜单定位 | `ui/popover.js` + 对应 `*-menu` 的 CSS |
| 改说明气泡 | 模板按钮加 `data-blai-info-trigger="<面板 id>"`，面板用 `.blai-info-popover`；交互在 `ui/infoPopover.js`，样式在 `styles/components/08-info-popover.css`，几何 token 在 `tokens/03-scale.css` |
| 改主题配色 | `styles/tokens/02-themes.css` 对应主题的令牌段 + 该主题的特殊分区规则；新主题还要扩展 `select option` 与 `data-theme` 容器列表 |
| 改弹窗尺寸 | `styles/pages/home/home-breakpoints.css` 的 `@media (min-width: 601px)` 段（四处同一把尺子） |
| 改手机端标题字号 / 提交反馈单列 | `styles/pages/99-mobile.css`（最后加载的跨页收尾） |
| 改 AI 连接标题行 | `styles/pages/ai/01-ai.css` 的 `@media (max-width: 600px)` 段：开关绝对定位到最右，标题在整条栏里居中 |
| 改手机端顶栏留白 | `styles/layouts/00-shell.css`、`styles/pages/home/home-topbar.css`、`styles/pages/feedback/feedback-diagnostics.css` 各自的窄屏段 |

### 样式文件职责速查

目录名只分层，不表职责；`pages/` 下用职责名，改样式前按此表定位。下表按 `styles/ORDER.json` 的加载顺序列出。

| 文件 | 管什么 |
|---|---|
| `pages/home/home-overview.css` | 首页规则卡、分组卡、批量操作、子规则字段（含 `[hidden]` 先例） |
| `pages/home/home-regex-highlight.css` | 正则语法高亮、标志提示、匹配测试区 |
| `pages/home/home-import-transfer.css` | 规则导入选择与转移弹窗 |
| `pages/home/home-rule-edit-modal.css` | 规则编辑弹窗：头部、字段、语法模式、测试区 |
| `pages/home/home-toolbar.css` | 首页页头、预设下拉、工具栏、批量面板 |
| `pages/home/home-preview-search.css` | 规则预览文本、分组详情、搜索框与最近搜索 |
| `pages/home/home-topbar.css` | 首页顶栏、卡片菜单、编辑弹窗筛选、手机窄屏 |
| `pages/home/home-breakpoints.css` | 首页宽屏断点；四个大弹窗尺寸统一在此 |
| `pages/clean/clean-main.css` | 净化页主列、模式卡、标签分组列表与分组开关 |
| `pages/clean/clean-scope-tags.css` | 标签（分组详情）编辑器弹窗 |
| `pages/clean/clean-tag-list.css` | 净化页标签列表、分组开关、下拉菜单 |
| `pages/clean/clean-deep-shell.css` | 深度净化外壳：遮罩、头部、内容区、选择与配置 |
| `pages/clean/clean-deep-modes.css` | 深度净化：规则预设、处理模式、执行面板、处理范围信息行 |
| `pages/clean/clean-deep-processing.css` | 深度净化：批处理进度、扫描与完成态 |
| `pages/clean/clean-deep-results.css` | 深度净化：进度、结果、完成态 |
| `pages/clean/clean-deep-responsive.css` | 深度净化响应式：900 / 600 / 920 / 700 四档媒体查询 |
| `pages/feedback/feedback-workspace.css` | 反馈页工作区、视图标签、提交表单 |
| `pages/feedback/feedback-form.css` | 反馈页表单控件：勾选框、按钮、状态与提示 |
| `pages/feedback/feedback-diagnostics.css` | 反馈页本地诊断与预览、手机窄屏顶栏 |
