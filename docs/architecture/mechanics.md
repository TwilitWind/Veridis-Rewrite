# 词汇映射 · 关键机制

净化管道、撤回、深度清理范围、差异记录、页面导航、弹窗浮层、命名空间与存储键。鸟瞰与边界见根目录 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

## 四、关键机制

### 净化管道

`buildProcessors()` 每条规则编译成一个 processor。`compileProcessors` 调 `compileReplacementProcessors(rules, options, false)`——**永不收 AI 规则**，供最终写回；流式路径传 `settings.aiRewrite?.enabled === true` 作为 `includeAi`，只影响实时视觉投影。内层判断 `if (rewriteMode !== 'program' && !includeAi) continue;`。顺序固定：**先 AI 局部改写，再程序规则净化**；AI 结果经 `WithTrackedRanges` 变体精确写回命中范围，不重排整段文本。

编译时每个 processor 携带 `source`（指纹+分组名+备注+模式）；文本规则被聚合成一个 processor，靠 `wordToSources[查找词]` 逐词记住来源，`getProcessorHitSources` 取回。替换回调在真实命中（非保护段）时按 `options.onRuleHit` 上报 `collectRuleHits` 收集。`collectRuleHits` 是纯采集、不消费流式随机候选，故只在 `chat/cleanse.js` 提交时写入痕迹，不接流式路径。

### 撤回净化

`computeRevertedText(currentText, programText, originalText)` 把「原文 → 程序改写」与「程序改写 → 当前文本」两组差异合并成组：组内未被用户改动的部分还原原文，改过的保留用户文本，定位不到的替换跳过。**撤回按钮可用条件只看 `meta` 是否存在**，不要求当前正文与记录一致——这是「手动编辑后仍能撤回」的关键，别退回文本相等判断。

显式重新净化以当前 `msg.mes` 为程序规则输入，兼容撤回后保留的手动改动。没有手改时提交走 `setMessageDiffProgramMes` 只刷新 `programMes`，**不覆盖 `originalMes`**；当前正文与已存原文不同（用户手改过）时，以手改后的当前正文重建本次 `originalMes / programMes`，否则透视弹窗无法展示这次真正发生的改写。结果提示由 `diff/recleanseFeedback.js` 按正文是否真的变化给出，元数据变化不算改写成功。

透视弹窗的界面说明由 `diff/diffCopy.js` 统一定义：标题旁「改写说明」承载完整取文流程，空基线、已撤回、手改、勾选撤回四个场景只在就近位置显示一句。改文案只改这一处，不要把同一段规则散回事件函数或按钮 `title`。

手改不是只显示计数：渲染时额外加入 `manual` 对比段（`programMes → 当前正文`），用与图例一致的手改色标出真实片段。计数沿用 `diffStats.js` 的连续块口径：相邻增删算同一块，隔开的块分别计数。手改节点不带 `data-blai-revert-item`，因此可筛选、可高亮，但不会被「撤回所选」误选。

### 深度清理范围

只允许两类资源：当前角色卡的世界书、当前角色卡的聊天记录；`contentItems.js` 里 `includeCharacterText` 与 `includeShujuku` 显式传 `false`。`is_system === true` **不是**跳过条件——`/hide` 隐藏的楼层正是这种消息，要参与处理并标 `isHidden` 供复核界面显示「已隐藏」；`apply/chat.js` 与 `contentItems.js` 两处判断必须同步。运行设置的「规则预设」取自 `settings.presets`，经 `frozenRunInput` 冻结到本次运行，结束不写回全局当前预设。

**世界书不受标签作用域约束**：`cleanse-inside`（只处理 `<content>`/`<game>` 内文本）只对聊天消息有意义；世界书条目是配置数据、没有这类包裹标签，`scan.js` 的 `scopeSettingsForDeepCleanItem` 会把它的 `scopeTags` 清空并切回 `protect`。扫描（`scan.js`）、程序改写（`programProcessing.js` 的 `getProgramScopeSettings` 与 AI 改写项）三处都要调用该辅助函数，漏一处就会出现「勾选世界书却 0 命中、完成页照样报成功」的假成功。回归 `node test/audit/verify-deep-clean-worldbook.mjs`（纯 Node，含旧行为反证）。

**预览是扫描后的可选层**：`scan.js` 在扫描时顺手记录 `affectedItemModes`，`preview.js` 据此提供「全部 / 程序改写 / AI 改写 / 已取消」筛选与逐条导航。程序预览用同一套规则引擎计算；AI 预览按需请求并缓存 `aiCandidate`，`executeDeepCleanAiRequests` 用 `previewCache` 跳过已生成条目的重复请求，正式执行仍是「AI 写回后再跑程序改写」。取消项只写进 `lifecycle.skippedItemIndexes`，`takeNextDeepCleanBatch` 直接跳过，完成页计入「已跳过」而不是伪装成成功写入。预览列表只渲染当前窗口条目，切换条目会取消上一个预览请求。回归 `node test/audit/verify-deep-clean-preview.mjs`（纯 Node）与 `CDP_PORT=9224 node test/audit/verify-copy-preview.mjs`（桌面 + 手机）。

### 差异记录与分支

每个 Swipe 分支独立一套 `__blai_diff_branch_meta`，键为 `getMessageDiffBranchKey` 结果。历史窗口只裁剪插件自己的元数据；旧记录退出保留范围后不再提供阶段对比，但撤回保护与「切回 Swipe 不重复净化」仍有效。文本比较走可取消后台任务，切换复核条目或应用前等待当前比较完成。

### 页面与导航

五个 page id：`overview`、`ai`、`clean`、`tools`、`feedback`。宽屏 `.rail`、窄屏 `.bottom-nav`，**两处都要有 `[data-page-target]` 按钮**；容器 `.page-panel[data-page="<id>"]`，只有 `.active` 显示。

`showResponsivePage()` 同时写 `#blai-purifier-popup[data-active-page]`，供样式做整页差异：首页与反馈页的页内顶栏自带下边框，不处理会与全局顶栏夹成「双层顶栏」，故这两页去掉全局顶栏下边框（`styles/layouts/01-responsive.css`）；新增带页内顶栏的页面一并登记。

新增一页的完整落点见 [change-map.md](change-map.md)。

### 弹窗与浮层

`window.confirm/alert/prompt` 一律禁用（渲染在窗口顶部、阻塞、脱离界面），统一走 `ui/notifications.js`：

```js
const ok = await showConfirmModal('删除这条规则？', { confirmText: '删除', danger: true });
const name = await showPromptModal('分组名', '', { placeholder: '分组名' });
```

实现为动态挂载 `.blai-modal-shell.blai-plugin-dialog` + `.blai-modal-card.blai-plugin-dialog-card`，样式在 `styles/components/02-controls.css`，居中由遮罩层 flex 保证。

**切页是 fade through，弹窗走退场后切换**：`showResponsivePage` 在点击当帧把 `.active` 唯一地切到目标页（导览与业务代码读到的永远是目标页），旧页保留布局加 `.blai-is-leaving` 淡出 80ms，新页加 `.blai-is-entering` 等旧页退完再淡入 120ms。待办切换只存在 `pendingPageSwap` 一处，快速连点作废旧任务，最终只留最后一次目标。弹窗与反馈页标签的退场后切换由 `src/ui/motion.js` 的 `fadeOutThen` 提供。切页/弹窗只改 `opacity`，弹卡入场允许在卡片自身叠轻 scale；portal 菜单的定位元素不叠 `transform`。时长取自 `03-scale.css` 的动效令牌，JS 兜底定时器与 jQuery 淡入淡出也读同一组值，不在调用点写死。横向 push/pop 禁用，理由见 `DESIGN.md`。

**挂载位置**：所有大弹窗都必须是 `templates/purifier.html` 里 `#blai-purifier-popup` 闭合标签之后的顶层节点（运行时 `$('body').append(templateHtml)`，即成为 body 直属）。`#blai-purifier-popup` 带 `backdrop-filter`，会生成层叠上下文，内部 `position:fixed` 相对它定位，遮罩铺不满视口、弹窗还可能被主界面挡住。新增弹窗时同步补 `src/ui/shell.js` 的初始化清理清单，否则重复加载残留旧节点。

**层级阶梯**：所有 z-index 只在 `tokens/03-scale.css` 的 `--blai-z-*` 里定义，页面文件一律 `var(...)`，不写裸数字。从低到高：`--blai-z-inner`（组件内部高亮）/ `--blai-z-page`（页面浮层）/ `--blai-z-tour`（导览）/ `--blai-z-panel`（主面板）/ `--blai-z-loading`（加载遮罩）/ `--blai-z-shell`（大弹窗基底）/ `--blai-z-modal`（弹窗内再弹出的对话框，如备注、删除、重命名、风险确认）/ `--blai-z-modal-raised`（最终层）/ `--blai-z-menu`（下拉/省略号菜单）/ `--blai-z-toast`（toast，最高）。新增浮层先在这张表里选一档，不要另造数字。

**toast 必居最高层**：插件自己的 `.blai-toast` 和 `#blai-ai-toast-container` 都取 `--blai-z-toast`，所以透视弹窗（`--blai-z-shell`）不会盖住提示。**不改宿主 `#toast-container`**：它的位置、层级、配色保持酒馆原生，其他插件的 toastr 不受影响。

**toast 语义色**：`showToast(message, description, type)`，`type` 取 `success` / `error` / `warning` / `info`（默认 info），图标随类型切换（`fa-circle-check` / `fa-circle-xmark` / `fa-triangle-exclamation` / `fa-circle-info`）。四种背景是 `01-palette.css` 里写死的 `--blai-toast-*-bg`（绿/红/橙/蓝实心 + 白字），**不跟随主题背景变化**，02-themes.css 不覆盖它们。这组 token 只挂在插件自有提示（`.blai-toast`、`#blai-ai-toast-container`）上，宿主 toastr 读不到。新增调用点按内容语义显式传 type，别留默认 info 造成成功/失败一个样。插件 toast 位置固定在顶部居中留白（`top: 24px`），不是贴边也不是屏幕正中。

**AI 改写提示独立容器**：`notifyAiRewriteStatus` 在 `#blai-ai-toast-container` 里自建 `.blai-ai-rewrite-toast`，不碰宿主 `toastApi`。sticky、关闭/终止按钮、进度标题/正文、自动消失与悬停暂停齐备；`data-type` 决定语义色与 FA 字形图标。这样能压在透视弹窗上、顶部居中，且不动宿主和其他插件的 toastr。

四个大弹窗（搜索/编辑规则/编辑分组/子规则）在 `@media (min-width: 601px)` 下统一 `min(560px, 100vw - 28px)` 宽、`calc(100dvh - 28px)` 高、16px 圆角（`styles/pages/home/home-breakpoints.css`）；600px 以下整屏（`100vw/100dvh`）、去圆角、适配安全区。

**`[hidden]` 失效**：`.blai-subrule-field{display:flex!important}` 会压掉默认 `[hidden]{display:none}`，靠 `prop('hidden', …)` 切换的块都要补 `.X[hidden]{display:none!important}`（`styles/pages/home/home-overview.css` 有先例）。

**`!important` 治理**：默认禁止，准入仅三类——对抗宿主/主题的强声明、`[hidden]` 强开关、内联定位。量化基线见 `test/audit/important-audit.mjs`（计数只许降），视觉防回归见 `style-snapshot.mjs`（双视口×双主题×五页面的计算样式 digest）。减量只能删「实测移除后计算样式零变化」的声明：用 CSSOM 临时去掉 `!important` 量真实计算值，或改完跑快照比对，任一处变化就回退。已知必须保留的类别：魔法棒 `display/align-items/gap`（宿主输入栏强声明）、按钮禁用态 `opacity/filter`、全屏弹窗覆盖、输入框字号与边框色、菜单内联定位。`.blai-icon-btn` 的尺寸/阴影、输入框 `min-height/字色/阴影` 这类自有控件无对抗，已安全移除。

**下拉菜单**一律走 `ui/popover.js` 挂 body，CSS `position:fixed` + 高 z-index，避免被父级 `overflow` 裁切；空间不足向上弹。所有下拉菜单（11 类 `-menu` 类）的首末/独行圆角统一在 `styles/components/07-menu-fill.css`：一份 `:is()` 清单配 `&:first-child/last-child/only-child` 原生嵌套，新增菜单类只补这一处清单（其余文件里的同类选择器只管各自配色/动画/定位，不重复圆角规则）。

**定位只手动计算，不用 Popper.js**：Popper 用非 `!important` 的内联 `left/top`，这里为压过主题注入必须用 `!important`，混用会「菜单停在视口右上角」（弹窗内必现，`.blai-modal-shell` 的 `backdrop-filter` 形成包含块）。切页入场不动锚点，弹卡 scale 只在卡片上，portal 菜单的入场位移只加在子元素上，因此菜单打开时定位一次即可；再加 `animationend` 或 200ms 兜底重算反而会让菜单「弹出后又往上跳」。`openMenus` 里必须存 `entry` 同一个对象，否则 `has(entry)` 恒 false、永不执行。导览提示框另走 `calculateTourPopoverPlacement`：按收缩后尺寸算坐标并夹回视口，贴边目标不能再用未收缩宽度算 left。没有锚点的居中步骤（欢迎页、完成页、错误页、preview）走 `positionCenteredTour`：显式关掉 CSS `translate(-50%,-50%)`，按视口中心与最终尺寸算 `left/top`，否则手机上 `top:50%` 被压成 0 时整张卡会飞出屏幕上方。

**菜单两份调用约定**：`openMenuPopover(anchor, menu)` / `closeMenuPopover(menu)` 收 DOM 节点，传 jQuery 对象会被 `if (!anchor)` 拦掉、菜单静默不开。打开时给菜单设唯一 id（子规则菜单用 `#blai-subrule-menu-active`）并给触发按钮设 `aria-expanded="true"`，关闭时清掉。

**外部点击与活动 id 不同步**：`closeAllMenuPopovers()` 只把菜单设 `hidden`、不清业务侧活动 id；子规则菜单 `closeSubruleMenu()` 若只看 `id='blai-subrule-menu-active'` 会误判仍打开、把第二次点击吞成「关闭」。关闭前先查 `menu.hasAttribute('hidden')`：已隐藏就只清 id、按未打开处理。

**首页规则集下拉**：原生 `#blai-preset-select` 留作数据锚点并视觉隐藏，可见控件 `#blai-preset-select-trigger` + `#blai-preset-menu`；菜单沿用弹窗下拉框样式，打开时宽度同步触发器。选项点击走 `presets/events.js` 的 `switchPreset()`，之后显式 `updateToolbarUI()` 刷新 trigger 文案（切换带 `skipRender` 不自动刷新）。事件集中在 `presets/presetSelectMenu.js`，避免 `events.js` 超闸门。

**子规则复制与移动**（`src/rules/view/view-03-subrule-transfer.js`）：复制是 `deepClone` 后 `splice(index + 1, 0, …)`；移动按 `预设序号::分组序号` 编码目标，跨预设用 `buildPresetEntry` 写回 `settings.presets[name]`。只改编辑中的工作副本 `rulesUiState.currentEditingSubrules`，落盘仍需点「保存分组」。

`<select>` 的 `option` 不继承 CSS 变量，必须在 `styles/tokens/02-themes.css` 按 `[data-theme]` 分段显式写死底色字色并带 `!important`（酒馆 `public/style.css` 有 `select option{background-color:var(--white50a)}`）。

**模板里的隐藏真按钮**：`templates/purifier.html` 底部 `.blai-hidden-real-controls` 藏着 `#blai-preset-rename/new/delete/import/export` 与 `#blai-default-toggle` 六个 id 锚点，靠 `styles/layouts/00-shell.css` 的 `display:none !important` 隐藏；删掉那条规则会露出灰按钮。

### 设置命名空间

`ultimate_purifier_ai_rewrite`（`settings/defaults.js` 的 `extensionName`）是数据主键，**改扩展显示名不要动它**，否则既有规则、预设、AI 配置全部读不到；迁移只处理 `..._modified` 与更早 legacy 键。加设置项的完整落点见 [change-map.md](change-map.md)。

### 自持存储键

| 键 | 内容 | 位置 |
| --- | --- | --- |
| `ultimate_purifier_ai_rewrite` | 全部设置（规则、预设、绑定、AI 配置） | `extension_settings` |
| `<...>_ai_rewrite_debug_events` / `_critical_...` | 改写诊断日志 | localStorage |
| `ultimate_purifier_ai_rewrite_deep_clean_diagnostics_v1` | 深净诊断槽位 | localStorage |
| `blai-rule-search-history` | 搜索历史 10 条 | localStorage |
| `__blai_diff_branch_meta` | 每条消息每个分支的差异记录 | 消息对象上 |
