# 词汇映射 架构说明（开发者）

面向改代码的人：运行形态、初始化链、分层职责、关键机制、改动落点。安装与使用见 [README.md](README.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。

## 一、运行形态

SillyTavern 扩展，无打包器、无 npm 依赖。`manifest.json` 只声明两个产物：

| 产物 | 来源 | 说明 |
| --- | --- | --- |
| `index.js` | 手写 | ESM 入口，直接 `import` `src/` 模块，源码即产物 |
| `style.css` | `build-css.mjs` 按 `styles/ORDER.json` 拼接压缩 `styles/` 分文件 | 产物勿手改，附 `style.css.map` |

写产物前做 token 级等价校验（源码与产物 token 序列逐项相同），不一致即报错、不写文件——压缩丢内容不可能悄悄发生。`build-check.mjs` 是构建闸门（见第五节）。

四条硬约束：

1. `src/` `styles/` `templates/` `vendor/` 必须随扩展安装；只拷两个产物会因模块加载失败不启动。
2. 样式只改 `styles/` 分文件；改完跑 `node build-css.mjs && node build-check.mjs`。
3. 改完刷新酒馆页面：ESM 与 CSS 都走浏览器缓存。
4. 不引入打包器；校验靠 `node --check` 与真机刷新核对。

扩展位置由 `host/extensionIdentity.js` 从 `import.meta.url` 反解（锚点 `/scripts/extensions/`），安装目录可任意改名，代码不写死路径。

```
Veridis-Rewrite/
├── manifest.json           display_name「词汇映射」/ js index.js / css style.css / version 3.5 / loading_order 110
├── index.js                入口：读宿主模块 → 注入 appContext → 依次初始化
├── style.css(.map)         构建产物，勿手改
├── build-css.mjs           拼接压缩 + token 等价校验 + sourcemap
├── build-check.mjs         构建闸门
├── src/                    业务模块
├── styles/                 样式唯一真源：tokens/ base/ components/ layouts/ pages/
├── templates/purifier.html 工作台全部 DOM（五页 + 弹窗）
├── images/
└── vendor/                 pinyin-pro、sql.js（本地化）
```

## 二、初始化链

`index.js` 静态导入宿主模块：`extensions.js`、`script.js`（`eventSource`/`event_types`/`chat`/`saveSettingsDebounced`）、`personas.js`、`world-info.js`、`util/stream-fadein.js`。随后：

```
resolveExtensionIdentity(import.meta.url)   → externalId / folderName / templateDirectory
initAppContext({...})                       → 宿主能力槽位表
jQuery(() => { createDefaultSettings → 旧命名空间导入 → legacy 拷贝 → migrateOldData → ensureSettingsShape → boot() })
```

`boot()` 顺序固定，调换会出问题：

1. `waitForTauriTavernReady()`
2. 三个兼容层就绪日志（TauriTavern / 柏宝箱 / LoreFrame）
3. `setupUI(renderExtensionTemplateAsync, templateDirectory)`
4. 自定义全局提示词迁移确认（需要时 `showRiskConfirmModal`）
5. `bindEvents()` → `bindUpdateStatusEvents()`
6. `syncComposerButtonScript()` → `initRealtimeInterceptor()`
7. `updateToolbarUI()` → `applyCharacterPresetBinding(true)` → `performGlobalChatMaintenance()`
8. 异步 `captureVeridisCommit()` + `initializeUpdateStatus()`

启动时机：`event_types.APP_READY`，或 `#send_textarea` 已存在（热重载）。

`host/appContext.js` 是唯一宿主能力入口：`initAppContext` 一次性注入 `extension_settings`、`saveChat`、`chat`、`getSillyTavernContext`、`getWorldInfoNames`、`setWorldInfoCache`、`getCurrentPersonaIdentity`、`readExtensionManifest`、`getAiRewriteDiagnosticConfig`、`getInstalledEnabledExtensions` 等。`host/context.js` 在其上做**所有降级读取**（缺 `getWorldInfoNames` 退回 `world_names`、退回 `globalThis.SillyTavern.getContext()`）。新代码读宿主一律走这两层，不直接摸全局。

## 三、分层与模块索引

页面内部统一三层：`model.js` 纯数据与规范化 → `view.js` 只碰 DOM → `events.js` 绑事件、调 model 与 view。运行时状态放各目录 `state.js`（`programRuntimeState`、`rulesUiState`、`aiRewriteState`、`presetsRuntimeState` 等），脏标记（`markRulesUiDirty` 等）触发重渲染。

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 入口 | `index.js`、`src/events.js`、`src/log.js` | 宿主导入、全局初始化、顶栏与路由事件、`logger`（前缀 `[词汇映射]`） |
| 宿主适配 | `src/host/` | 能力槽位、降级读取、扩展身份、生成生命周期、流式处理 |
| 设置 | `src/settings/` | `defaults.js` 默认值全集、`migration.js` 形状补齐与旧版迁移 |
| UI 外壳 | `src/ui/` | 页面路由、主题、导览、统一对话框、浮层定位、人形保护控件 |
| 业务页 | `rules` `scope` `aiRewrite` `presets` `deepClean` `feedback` `zh` `update` | 每目录一套 model / view / events |
| 文本内核 | `rules/engine.js`、`rules/regex.js`、`text/` | 规则编译成处理器、替换、正则、句子切分、变量块剥离 |
| 净化与差异 | `chat/`、`diff/`、`dom/` | 执行净化、写回消息、记录阶段差异、渲染透视 |
| 集成 | `integrations/`、`shujuku/` | TauriTavern / 柏宝箱 / LoreFrame / MVU / TavernHelper、Shujuku 只读联动 |

### 入口与宿主

| 模块 | 关键导出 / 职责 |
| --- | --- |
| `host/context.js` | `getSillyTavernContextSnapshot`、`getWorldInfoNames`、`getCurrentCharacterContext`、`getCurrentChatIdentity`、`getCurrentChatCompletionPresetName`、`getDeepCleanHostOwnershipSnapshot` |
| `host/generationLifecycle.js` | 一次生成绑定确定的聊天 / 消息对象 / 楼层 / Swipe；结构变化即终止旧任务，不迁移写回位置 |
| `host/lifecycleEvents.js` | `initRealtimeInterceptor`：订阅酒馆事件，驱动增量净化 |
| `host/streaming.js`、`streamingState.js` | 流式 token 的视觉投影（只改显示，不改数据） |
| `host/extensionIdentity.js`、`extensionManifest.js` | 路径反解、读自身 manifest |

### UI 外壳

| 模块 | 说明 |
| --- | --- |
| `ui/shell.js` | `setupUI`：清旧容器 → 注入 `#blai-wand-btn` / `#blai-extension-settings-entry` → 载入模板 → 建路由。导出 `showResponsivePage`、`updateLegacyPurifierWarning`、`annotateTauriMobileSurfaces` |
| `ui/notifications.js` | `showToast` / `showConfirmModal` / `showAlertModal` / `showPromptModal` / `showRiskConfirmModal` / `showRiskInfoModal`。**全插件唯一对话框入口** |
| `ui/popover.js` | `openMenuPopover` 等：菜单挂 body，纯手动按视口定位（不用 Popper.js）；关闭时复位锚点标记与活动 id |
| `ui/theme.js` | `bindThemeEvents`：给容器写 `data-theme`（auto/light/dark） |
| `ui/tour.js`、`ui/personaProtection.js`、`ui/html.js` | 导览定位、人设保护开关同步、`safeHtml` |

### 文本内核

| 模块 | 关键导出 |
| --- | --- |
| `rules/engine.js` | `compileProcessors`（永不含 AI 规则）、内部 `compileReplacementProcessors(rules, options, includeAi)`、`buildProcessors`、`applyCompiledReplacements` / `WithTrackedRanges` 变体、`applyScopedReplacements` 系列、`countProcessorMatches`、`applyStreamingProgram`、`pickReplacement`、`buildTargetLiteralPattern`、`buildSimpleTargetPattern` |
| `rules/regex.js` | `compileRegexTarget`、`validateRegexTargetInput`、`translateRegexError`（英文错误 → 中文）、`buildSimpleWildcardPattern` |
| `rules/regexHighlight.js` | `tokenizeRegexSource`、`renderRegexHighlightHtml` 行内高亮 |
| `rules/view.js` | 规则卡片与顶栏、编辑弹窗（`syncRuleEditFilterUi`）、规则搜索（`buildRuleSearchResults(keyword, scope)`、`syncRuleSearchScopeUi`、历史四件套；`localStorage blai-rule-search-history` 保留 10 条）。barrel 后接 `view-00-search` / `view-01-modal` / `view-02-panels` / `view-03-subrule-transfer`（子规则跨分组、跨预设移动） |
| `text/sentences.js`、`text/variableUpdates.js` | 句子切分；`collectVariableUpdateRanges` / `omitVariableUpdates` 剥离完整变量块 |

### AI 改写

| 模块 | 关键导出 / 职责 |
| --- | --- |
| `runtime.js`（最大模块） | 自动/手动改写调度、目标校验、过期拒绝、终稿合并；总开关关闭返回空任务 |
| `task.js` / `state.js` | 任务快照与新鲜度、运行时状态 |
| `matching.js` | `collectAiScopeSegments`、`getAiScopeRequestText`、`compileAiMatchers`、`collectAiMatches`、`buildRewriteItems`、`resolveRewriteTrackedRanges`、`applyAiProgramFallbackMatches` |
| `planning.js` / `generation.js` / `response.js` | 提示词渲染与分组、`generateRaw` 封装与错误分类、返回结构校验 |
| `additionalParameters.js` | `parseYamlObject` / `parseYamlList` / `buildAdditionalApiParams` / `hasAdditionalParameters` |
| `apply.js` | `applyAcceptedRewrites`、`applyProgramFallbackRewrites` |
| `commentProtection.js` | XML 注释范围不参与匹配 |
| `debug.js` / `debugStore.js` / `debugView.js` / `communicationMonitor.js` | `debug.js` 对外入口（记录事件、导出文本）；`debugStore.js` 管常量、脱敏、localStorage 读写与事件合并（普通 100 条、关键 160 条）；`debugView.js` 中文标签表与时间线排版；`communicationMonitor.js` 通信记录（最近 10 次）。反馈页三面板数据源 |
| `composerButton.js` / `settingsEvents.js` | 输入框快捷按钮注入、AI 页事件与两开关联动 |

**附加参数**：对齐酒馆原生 API 设置三项（主体参数 / 排除主体参数 / 包含请求标头），做成 API 连接区按钮 + 弹窗，按钮小圆点提示「未填写 / 已填写」。三个字段 `customIncludeBody` / `customExcludeBody` / `customIncludeHeaders` 是全局 AI 设置（不进 API 预设快照），存 YAML 文本。**关键在透传形态**：TavernHelper（JS-Slash-Runner）把 `custom_api` 三个字段各自 `YAML.stringify` 后交后端，故 `generation.js` 必须把用户文本解析成对象/数组再放入 `custom_api`，不能原样传字符串。`additionalParameters.js` 是零依赖 YAML 子集解析器（扁平键值、一层缩进对象、字符串数组、数字/布尔/null/引号串/行内 JSON、注释容错），非法行静默跳过。合并策略：用户 `custom_include_body` 为基础，插件必需的 `response_format:{type:'json_object'}` 与 UI 派生的 `repetition_penalty` 后置覆盖；`custom_exclude_body` / `custom_include_headers` 仅非空时加入。

### 净化、差异与深度净化

| 模块 | 关键导出 / 职责 |
| --- | --- |
| `chat/cleanse.js` | `cleanseMessageDataAtIndex`、`performIncrementalCleanse`、`performGlobalChatMaintenance`、`syncMessageDiffMetadata` |
| `chat/messageBranch.js` | `getMessageDiffBranchKey`（有 swipes 时 `swipe:<id>`，否则 `main`）、`commitCurrentMessageText`、`setCurrentSwipeText` |
| `chat/persistence.js` / `chat/display.js` | 串行保存队列、写回后刷新 DOM |
| `diff/messageMeta.js` | `{originalMes, aiMes, programMes, reverted}` 存在 `msg.__blai_diff_branch_meta[branchKey]`；`migrateChatDiffMetadata` 处理旧字段 |
| `diff/revertMerge.js` | `computeRevertedText(currentText, programText, originalText)`：撤回唯一入口 |
| `diff/events.js` | 透视入口与撤回按钮、`recleanseDiffMessageAtIndex` |
| `diff/compare.js` + `background.js` + `worker.js` | 差异计算；`compareTextPairsInBackground` / `renderDiffDocumentInBackground` 可取消后台任务 |
| `diff/tracking.js` / `retention.js` / `relatedRules.js` | 谁被记录、按设置裁剪历史、反查改动来源规则 |
| `dom/protection.js` | `isProtectedNode`、`isMessageOnAllowedSurface`、`isAllowedChatInputElement`：哪些节点可净化 |
| `dom/message.js` / `observer.js` / `streaming.js` | DOM 取节点与原子换文、观察器、流式投影 |
| `deepClean/` | `inventory`、`contentItems`、`scan`、`programProcessing` / `aiProcessing`、`review`、`apply/`（chat / worldBook / character / persona / io 分批落盘）、`lifecycle`（`startDeepCleanRun` / `runDeepCleanScan` / `runDeepCleanApply`、冻结 `frozenRunInput`）、`view`、`events`、`diagnostics` |

### 其余

- `presets/`：`bindings.js`（`getPresetBindingResolution` 三层解析、`getPresetBindingHistory` 含失效项、`cleanupInvalidPresetBindings`）、`application.js`（`applyPresetByName`、`applyCharacterPresetBinding`）、`view.js`（`updateToolbarUI`、`refreshCharacterBindingUI`、`renderBindingHistory`）。
- `scope/`：`model.js` 标签/分组规范化与内置标签（CoT 跳过、MVU 占位符范围），`view.js` `renderScopeTagsModal`。
- `feedback/`：payload 组装、附件校验（最多 5 个 / 每个 10 MiB）、提交客户端、四个页内标签。
- `update/status.js`：版本检查与更新入口。`zh/`：简繁词典包安装与变体匹配，`conversion.js` 变体函数被 `engine.js` 直接消费。

## 四、关键机制

### 净化管道

`buildProcessors()` 每条规则编译成一个 processor。`compileProcessors` 调 `compileReplacementProcessors(rules, options, false)`——**永不收 AI 规则**，供最终写回；流式路径传 `settings.aiRewrite?.enabled === true` 作为 `includeAi`，只影响实时视觉投影。内层判断 `if (rewriteMode !== 'program' && !includeAi) continue;`。顺序固定：**先 AI 局部改写，再程序规则净化**；AI 结果经 `WithTrackedRanges` 变体精确写回命中范围，不重排整段文本。

### 撤回净化

`computeRevertedText(currentText, programText, originalText)` 把「原文 → 程序改写」与「程序改写 → 当前文本」两组差异合并成组：组内未被用户改动的部分还原原文，改过的保留用户文本，定位不到的替换跳过。**撤回按钮可用条件只看 `meta` 是否存在**，不要求当前正文与记录一致——这是「手动编辑后仍能撤回」的关键，别退回文本相等判断。

### 深度净化范围

只允许两类资源：当前角色卡的世界书、当前角色卡的聊天记录；`contentItems.js` 里 `includeCharacterText` 与 `includeShujuku` 显式传 `false`。`is_system === true` **不是**跳过条件——`/hide` 隐藏的楼层正是这种消息，要参与处理并标 `isHidden` 供复核界面显示「已隐藏」；`apply/chat.js` 与 `contentItems.js` 两处判断必须同步。运行设置的「规则预设」取自 `settings.presets`，经 `frozenRunInput` 冻结到本次运行，结束不写回全局当前预设。

### 差异记录与分支

每个 Swipe 分支独立一套 `__blai_diff_branch_meta`，键为 `getMessageDiffBranchKey` 结果。历史窗口只裁剪插件自己的元数据；旧记录退出保留范围后不再提供阶段对比，但撤回保护与「切回 Swipe 不重复净化」仍有效。文本比较走可取消后台任务，切换复核条目或应用前等待当前比较完成。

### 页面与导航

五个 page id：`overview`、`ai`、`clean`、`tools`、`feedback`。宽屏 `.rail`、窄屏 `.bottom-nav`，**两处都要有 `[data-page-target]` 按钮**；容器 `.page-panel[data-page="<id>"]`，只有 `.active` 显示。`ui/shell.js` 的 `responsivePageMetadata` 里残留一条 `bind` 元数据（无面板、无导航按钮），新增页面别照它。

`showResponsivePage()` 同时写 `#blai-purifier-popup[data-active-page]`，供样式做整页差异：首页与反馈页的页内顶栏自带下边框，不处理会与全局顶栏夹成「双层顶栏」，故这两页去掉全局顶栏下边框（`styles/layouts/01-responsive.css`）；新增带页内顶栏的页面一并登记。

新增一页动四处：模板 `section.page-panel` → 两处导航各加按钮 → `ui/shell.js` 元数据 → 新建 `src/<page>/{model,view,events}.js`。

### 弹窗与浮层

`window.confirm/alert/prompt` 一律禁用（渲染在窗口顶部、阻塞、脱离界面），统一走 `ui/notifications.js`：

```js
const ok = await showConfirmModal('删除这条规则？', { confirmText: '删除', danger: true });
const name = await showPromptModal('分组名', '', { placeholder: '分组名' });
```

实现为动态挂载 `.blai-modal-shell.blai-plugin-dialog` + `.blai-modal-card.blai-plugin-dialog-card`，样式在 `styles/components/02-controls.css`，居中由遮罩层 flex 保证。

**层级阶梯**：插件内弹窗占 `10000004`~`10000008`（卡片菜单/搜索/编辑规则/编辑分组/编辑子规则/移动/预设导入）；`.blai-plugin-dialog`（备注、删除、重命名等由弹窗内按钮触发者）及 `#blai-risk-confirm-modal`、`#blai-risk-info-modal` 一律 `10000020`——它们从别的弹窗里弹出，必须压在上面，否则遮罩盖住按钮像点了没反应。首页规则卡菜单 `.blai-home-card-menu` 与子规则菜单 `.blai-subrule-menu` 需 `10000060`。新增弹窗要么落在 `10000004`~`10000008` 且后弹的更高，要么沿用 `10000020`。

四个大弹窗（搜索/编辑规则/编辑分组/子规则）在 `@media (min-width: 601px)` 下统一 `min(560px, 100vw - 28px)` 宽、`calc(100dvh - 28px)` 高、16px 圆角（`styles/pages/home/04-home.css`）；600px 以下整屏（`100vw/100dvh`）、去圆角、适配安全区。

**`[hidden]` 失效**：`.blai-subrule-field{display:flex!important}` 会压掉默认 `[hidden]{display:none}`，靠 `prop('hidden', …)` 切换的块都要补 `.X[hidden]{display:none!important}`（`styles/pages/home/00-home.css` 有先例）。

**下拉菜单**一律走 `ui/popover.js` 挂 body，CSS `position:fixed` + 高 z-index，避免被父级 `overflow` 裁切；空间不足向上弹。

**定位只手动计算，不用 Popper.js**：Popper 用非 `!important` 的内联 `left/top`，这里为压过主题注入必须用 `!important`，混用会「菜单停在视口右上角」（弹窗内必现，`.blai-modal-shell` 的 `backdrop-filter` 形成包含块）。打开后要重定位一次：弹窗与切页入场动画带 6px 位移，动画期间量到的锚点与稳定后差 6px，不补就「第一次点没弹出、要点第二次」。重定位逐帧比对锚点矩形、连续两帧稳定后再定位，400ms 超时兜底；`openMenus` 里必须存重定位回调引用的同一个 `entry` 对象，否则 `has(entry)` 恒 false、永不执行。

**菜单两份调用约定**：`openMenuPopover(anchor, menu)` / `closeMenuPopover(menu)` 收 DOM 节点，传 jQuery 对象会被 `if (!anchor)` 拦掉、菜单静默不开。打开时给菜单设唯一 id（子规则菜单用 `#blai-subrule-menu-active`）并给触发按钮设 `aria-expanded="true"`，关闭时清掉。

**外部点击与活动 id 不同步**：`closeAllMenuPopovers()` 只把菜单设 `hidden`、不清业务侧活动 id；子规则菜单 `closeSubruleMenu()` 若只看 `id='blai-subrule-menu-active'` 会误判仍打开、把第二次点击吞成「关闭」。关闭前先查 `menu.hasAttribute('hidden')`：已隐藏就只清 id、按未打开处理。

**首页规则集下拉**：原生 `#blai-preset-select` 留作数据锚点并视觉隐藏，可见控件 `#blai-preset-select-trigger` + `#blai-preset-menu`；菜单沿用弹窗下拉框样式，打开时宽度同步触发器。选项点击走 `presets/events.js` 的 `switchPreset()`，之后显式 `updateToolbarUI()` 刷新 trigger 文案（切换带 `skipRender` 不自动刷新）。事件集中在 `presets/presetSelectMenu.js`，避免 `events.js` 超闸门。

**子规则复制与移动**（`src/rules/view/view-03-subrule-transfer.js`）：复制是 `deepClone` 后 `splice(index + 1, 0, …)`；移动按 `预设序号::分组序号` 编码目标，跨预设用 `buildPresetEntry` 写回 `settings.presets[name]`。只改编辑中的工作副本 `rulesUiState.currentEditingSubrules`，落盘仍需点「保存合集」。

`<select>` 的 `option` 不继承 CSS 变量，必须在 `styles/tokens/02-themes.css` 按 `[data-theme]` 分段显式写死底色字色并带 `!important`（酒馆 `public/style.css` 有 `select option{background-color:var(--white50a)}`）。

**模板里的隐藏真按钮**：`templates/purifier.html` 底部 `.blai-hidden-real-controls` 藏着 `#blai-preset-rename/new/delete/import/export` 与 `#blai-default-toggle` 六个 id 锚点，靠 `styles/layouts/00-shell.css` 的 `display:none !important` 隐藏；删掉那条规则会露出灰按钮。

### 设置命名空间

`ultimate_purifier_ai_rewrite`（`settings/defaults.js` 的 `extensionName`）是数据主键，**改扩展显示名不要动它**，否则既有规则、预设、AI 配置全部读不到；迁移只处理 `..._modified` 与更早 legacy 键。加设置项固定动作：写进 `defaultSettings` → `migration.js` 的 `ensureSettingsShape` 补规范化 → 页面 `view.js` 渲染 → `events.js` 写回并 `saveSettingsDebounced()`。

### 自持存储键

| 键 | 内容 | 位置 |
| --- | --- | --- |
| `ultimate_purifier_ai_rewrite` | 全部设置（规则、预设、绑定、AI 配置） | `extension_settings` |
| `<...>_ai_rewrite_debug_events` / `_critical_...` | 改写诊断日志 | localStorage |
| `ultimate_purifier_ai_rewrite_deep_clean_diagnostics_v1` | 深净诊断槽位 | localStorage |
| `blai-rule-search-history` | 搜索历史 10 条 | localStorage |
| `__blai_diff_branch_meta` | 每条消息每个分支的差异记录 | 消息对象上 |

## 五、样式体系

`styles/` 是唯一真源，五层。`styles/ORDER.json` 的 `order` 数组即层叠顺序：同特异性靠先后决胜，**调顺序会改视觉结果**，故顺序写在 JSON 而非脚本；新增分文件只改 ORDER.json。

| 目录 | 职责 | 约束 |
| --- | --- | --- |
| `tokens/` | 调色板、三套主题、刻度 | 唯一来源，其他文件不许重定义 |
| `base/` | 重置与元素级默认值 | 只放元素级 |
| `components/` | 按钮、输入框、卡片、toast、统一对话框 | 新组件必须建独立文件 |
| `layouts/` | 覆盖层骨架、顶栏、侧栏、底部导航、响应式 | 不含业务页规则 |
| `pages/<page>/` | 单页排版 home/ai/clean/tools/feedback/diff/tour | 只写该页，禁止通用组件样式 |
| `pages/99-mobile.css` | 手机端跨页收尾：标题降档、提交反馈单列化 | 最后加载，压过各页桌面声明；只放 `@media (max-width: 600px)` |

三个令牌文件：`01-palette.css`（状态色、正则高亮 `--re-*`、差异来源色）、`02-themes.css`（auto/light/dark 的 `--bg-*` / `--text-*` / `--border-color` / `--accent-*`，及 `select option` 的三段 `!important`）、`03-scale.css`（`--blai-space-*` / `--blai-font-*` / `--blai-radius-*` / `--blai-border-*` / `--blai-size-*` 与语义层）。动效节奏也在 `03-scale.css`：`--blai-duration-fast` 120ms（菜单/toast 退场）、`--blai-duration-base` 160ms（切页/toast 进场）、`--blai-duration-slow` 180ms（弹卡进场）、`--blai-ease-out`（平滑减速不过冲）；改一处全站同步。可见滚动条在 `base/00-reset.css` 挂根容器统一设 `scrollbar-color: var(--accent-color) transparent`（可继承，刻意隐藏的不受影响）。

令牌挂在一组**容器选择器**而非 `:root`：`#blai-purifier-popup`、`.blai-modal-shell`、`#blai-scope-tag-editor-modal`、`#blai-rule-transfer-modal`、`#blai-diff-modal`、`#blai-rule-search-modal`、`#blai-preset-import-choice-modal`、`.blai-toast`、`#blai-loading-overlay`、`#blai-tour-layer`。弹层与 toast 不在主容器内——增删容器要同步令牌、`theme.js` 的 `data-theme` 列表与 `03-scale.css` 语义层。

### 配色三层（硬要求）

1. 最外层背景灰白 `--bg-base`（日间 `#F7F7F8`，纯中性灰不做蓝偏移）。
2. 控件白底 `--bg-surface`（`#FFFFFF`）。
3. 控件内输入框 / 下拉框微灰填充、无边框：`background-color: var(--field-bg) !important`（日间 `#F1F2F4`、夜间 `#222733`；跟随主题用 `color-mix(in srgb, var(--border-color) 16%, var(--bg-surface))`）。**混入比例必须小**：`--border-color` 本身已是底色上一档，大比例混会把两档叠加、深色下发刺眼（实测 62% 时深色台阶 1.51、固定主题 1.12；16% 时三套主题约 1.11~1.14 同档）。

填充式（凸起）而非凹陷式：输入框日夜间都「比卡片更靠近正文色一档」，两主题亮度台阶对齐约 1.12（夜间填充还要收窄色相偏移，深色下发蓝会像荧光块）；台阶不一致会让同一控件日夜体积感相反。凹陷式在日间不成立（画布与白卡差太小，槽挖不出来，除非改整屏明度）。

「能输入」靠填充表达，「正在输入」靠焦点态内阴影描边：`box-shadow: inset 0 0 0 1px var(--accent-color) !important`（不占位不抖动）。不画静态边框（白卡与灰白画布上同一条边框观感差很多，同一填充值却能同时压住两种容器）。禁止对输入框写 `transparent`（第三方主题会注入带 `!important` 的底色，闸门会拦）；hover 不加描边，focus 只用内阴影，不叠 outline 或外阴影。`.pages` / `.page-panel` 必须透明让 `--bg-base` 透上来，卡片才是唯一白块。不用半透明叠色（`color-mix(..., transparent)` 叠灰底发脏），日间用实色；选中态用 `color-mix(in srgb, var(--accent-color) 8%, var(--bg-surface))`。

### 图标（统一字体图标）

界面图标一律用酒馆自带 Font Awesome 6.5.2（`public/css/fontawesome.min.css`，无额外依赖）：`<i class="fas fa-*" aria-hidden="true"></i>`。禁止内联 `<svg>`、CSS 拼三角/对勾、或 `&times;` `&#10005;` `→` 等字符代替：

| 场合 | 做法 |
| --- | --- |
| 模板与 JS 生成的按钮/标题 | `<i class="fas fa-*">`，尺寸交给容器 `> i` 规则 |
| 伪元素必须画的勾选/下拉箭头 | `content: '\f00c'` / `'\f078'` + `font-family: 'Font Awesome 6 Free'; font-weight: 900` |
| 复选框（`appearance: none` 自绘） | 同上 `\f00c` |
| 纯装饰线条/圆点（时间轴竖线、流程圆点） | 保留 CSS 绘制，不算图标 |

类名必须在 FA 6.5.2 存在；`fa-fw` / `fa-solid` / `fa-spin` 是修饰类，不参与校验。

### 间距与布局令牌

语义层在 `03-scale.css` 第二块，调疏密只改这里：`--blai-canvas-pad`（12）、`--blai-panel-pad`、`--blai-panel-pad-tight`（10）、`--blai-panel-gap`、`--blai-column-gap`、`--blai-head-gap`（8）、`--blai-head-pad`（12）、`--blai-row-pad`（10）。没有令牌先加一行再引用，页面文件里不写 `gap: 14px`。

两栏页面统一 `minmax(0, 5fr) minmax(0, 3fr)`（两端都要 `minmax(0, ...)`），一律 `align-items: stretch` 让短栏白卡拉齐长栏，不退回 `start`。断点、`box-shadow`、`grid-template-columns`、`transform` 保留字面量是刻意的。

### 构建闸门

`build-check.mjs` 的机械校验：单文件超阈值 fail/warn；**每个 `.css` 花括号必须平衡（少 `}` 会 fail——r5 曾因此把桌面外壳规则吞进手机 `@media`，token 校验发现不了）**；`styles/` 下每个 `.css` 必须登记 ORDER（孤儿 fail）；顶层只允许 tokens/base/components/layouts/pages；ORDER 层级不得倒挂（tokens→base→components→layouts→pages）；非 tokens 文件不许重定义刻度名；禁 `@import` / `@charset`；输入框不许透明底；tokens 外不许 `#hex`；`!important` 不得比 `quality-baseline.json` 的基线值上涨（只 warn）；manifest 指向的 js/css 必须存在；根 `style.css` 必须存在且非空；`src/` 下 `.js` 有体积与行数上限。具体阈值以脚本为准，不在此抄数。

输入控件背景色统一走 `02-themes.css` 的 `--blai-input-bg`（默认等于 `--field-bg`），下拉框/输入框/文本域共用一处。酒馆主题对裸标签有 `select/input/textarea{background:var(--ui-color-sec)}` 强声明，这里在控件上把 `--ui-color-sec` 重定向到 `--blai-input-bg`，让主题的强声明算出我们的颜色，不新增 `!important`；副作用是主题边框简写也读 `--ui-color-sec`，反馈页三个裸标签控件边框被染成白底同色不可见，用同色 `inset` 阴影补一圈可见边框（主题未对 `box-shadow` 下强声明）。反馈页桌面布局高度随内容增长（不用 `minmax(0,1fr)+height:100%` 锁死），否则「涉及区域」展开时详细说明框越过固定 footer 盖住隐私说明浅字；隐私说明设 `min-height` 避免换行跳动。正则高亮态 `color: transparent` 与 token 颜色必须保留强声明（同属性在控件基线规则里仍有 `!important`，加特异性压不住）。测试区命中高亮靠 overlay 叠在 textarea 之下（命中时把 `--field-bg` 置 transparent），命中统计放测试框右上角。

两个规则弹窗顶栏叉号统一 `.blai-modal-close-x`；其中 `border: 0 !important` 是主题对裸 button 强声明用特异性压不过后的例外，已登记 `quality-baseline.json`。拆分样板见 `styles/pages/` 与各 `components/` 下的 `*-topbar.css` / `*-page.css` / `*-deep.css` / `*-processing.css` / `*-form.css` / `*-regex.css`。

## 六、改动的典型落点

| 想改什么 | 改哪里 |
| --- | --- |
| 加一个页面 | 模板 `section.page-panel` → `.rail` 与 `.bottom-nav` 各加按钮 → `ui/shell.js` 元数据 → 新建 `src/<page>/` |
| 加一条设置项 | `settings/defaults.js` + `migration.js` 的 `ensureSettingsShape` + 对应页 view/events |
| 改匹配或替换行为 | `rules/regex.js`（编译）与 `rules/engine.js`（替换） |
| 改正则报错文案 | `rules/regex.js` 的 `translateRegexError` |
| 改 AI 改写调度 | `aiRewrite/runtime.js`；写回范围在 `matching.js`；终稿合并与 `chat/cleanse.js` 一起看 |
| 改撤回算法 | 只改 `diff/revertMerge.js` |
| 改差异记录 | `diff/tracking.js`（谁被记录）+ `messageMeta.js`（存取）+ `view.js` / `compare.js`（渲染） |
| 改深度净化范围 | `inventory.js`（列什么）+ `contentItems.js`（读什么）+ `apply/`（写回什么）+ `view.js`（界面说明） |
| 改对话框外观 | `ui/notifications.js` + `styles/components/02-controls.css` 的 `.blai-plugin-dialog-card` 段 |
| 改菜单定位 | `ui/popover.js` + 对应 `*-menu` 的 CSS |
| 改日间配色 | `styles/tokens/02-themes.css` 的 light 令牌 + `styles/layouts/00-shell.css` 的日间分区段 |
| 改弹窗尺寸 | `styles/pages/home/04-home.css` 的 `@media (min-width: 601px)` 段（四处同一把尺子） |
| 改手机端标题字号 / 提交反馈单列 | `styles/pages/99-mobile.css`（最后加载的跨页收尾） |
| 改 AI 连接标题行 | `styles/pages/ai/01-ai.css` 的 `@media (max-width: 600px)` 段：开关绝对定位到最右，标题在整条栏里居中 |
| 改手机端顶栏留白 | `styles/layouts/00-shell.css`、`styles/pages/home/03-home-topbar.css`、`styles/pages/feedback/01-feedback.css` 各自的窄屏段 |
