# 词汇映射 架构说明（开发者）

面向改代码的人：运行形态、初始化链、分层职责、关键机制、改动落点。安装与使用见 [README.md](README.md)，版本差异见 [CHANGELOG.md](CHANGELOG.md)。

## 一、运行形态

SillyTavern 扩展，无打包器、无 npm 依赖。`manifest.json` 只声明两个产物：

| 产物 | 来源 | 说明 |
| --- | --- | --- |
| `index.js` | 手写 | ESM 入口，直接 `import` `src/` 模块，源码即产物 |
| `style.css` | `build-css.mjs` 按 `styles/ORDER.json` 拼接压缩 `styles/` 分文件 | 产物勿手改，附 `style.css.map` |

写产物前做 token 级等价校验（源码与产物 token 序列逐项相同），不一致即报错、不写文件——压缩丢内容不可能悄悄发生。构建闸门与命令见 [DEVELOPMENT.md](DEVELOPMENT.md)。

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
├── test/                   构建、审计与同步脚本，入口见 DEVELOPMENT.md
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

页面内部统一三层：`model.js` 纯数据与规范化 → `view.js` 只碰 DOM → `events.js` 绑事件、调 model 与 view。运行时状态放各目录 `state.js`（`programRuntimeState`、`rulesUiState`、`aiRewriteState`、`presetsRuntimeState` 等），脏标记（`markRulesUiDirty` 等）触发重渲染。`rules/rulesUiState.editGroupBaseline` 在打开分组编辑弹窗时记录名称+规则快照（`captureEditGroupBaseline`），关闭前由 `hasUnsavedEditGroupChanges` 比对是否触发未保存提醒（忽略纯 UI 的 `isEditing`）。

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
| `ui/notifications.js` | `showToast` / `showConfirmModal` / `showAlertModal` / `showPromptModal` / `showRiskConfirmModal` / `showRiskInfoModal` / `showUnsavedChangesModal`（三选一：继续编辑 / 放弃 / 保存，返回 `cancel`/`discard`/`save`）。**全插件唯一对话框入口** |
| `ui/popover.js` | `openMenuPopover` 等：菜单挂 body，纯手动按视口定位（不用 Popper.js）；关闭时复位锚点标记与活动 id |
| `ui/theme.js` | `bindThemeEvents`：主题清单 `THEME_MODES`（ auto/light/warm/dark/dim）、顶栏图标点开下拉选择、给容器写 `data-theme`；新增主题时同步 `migration.js` 的合法值 |
| `ui/tour.js`、`ui/personaProtection.js`、`ui/html.js` | 导览定位、人设保护开关同步、`safeHtml` |

### 文本内核

| 模块 | 关键导出 |
| --- | --- |
| `rules/engine.js` | `compileProcessors`（永不含 AI 规则）、内部 `compileReplacementProcessors(rules, options, includeAi)`、`buildProcessors`、`applyCompiledReplacementsWithTrackedRanges` 变体、`applyScopedReplacements` 系列、`countProcessorMatches`、`applyStreamingProgram`、`pickReplacement`、`buildTargetLiteralPattern`、`buildSimpleTargetPattern` |
| `rules/regex.js` | `compileRegexTarget`、`validateRegexTargetInput`、`translateRegexError`（英文错误 → 中文）、`buildSimpleWildcardPattern` |
| `rules/regexHighlight.js` | `tokenizeRegexSource`、`renderRegexHighlightHtml` 行内高亮、`findBracketPairAt(source, caret)` 取光标侧括号与配对符号的两个下标；底纹只加在这两个符号字符上，不覆盖中间文本。配对高亮只由真实 `click/keyup/select` 触发（见下方「配对高亮触发时机」） |
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

**执行顺序与失败边界**：开启 AI 改写时，普通聊天、透视重新净化与深度净化「程序 + AI 改写」一律先按序发起所有 AI 改写，AI 全部完成后再按序执行程序改写。`applyAiProgramFallback` 在总开关开启时直接拒绝回退；未发送、请求失败或写回失败只给非交互提示并带原因，绝不改跑程序改写。深度净化的 AI 请求基于原文构建，成功结果先落 AI 候选，最后才把程序规则作用到该候选；AI 失败项保持原文并计入失败摘要。关闭总开关时三条链路都只跑程序改写。

**附加参数**：对齐酒馆原生 API 设置三项（主体参数 / 排除主体参数 / 包含请求标头），做成 API 连接区按钮 + 弹窗，按钮小圆点提示「未填写 / 已填写」。三个字段 `customIncludeBody` / `customExcludeBody` / `customIncludeHeaders` 是全局 AI 设置（不进 API 预设快照），存 YAML 文本。**关键在透传形态**：TavernHelper（JS-Slash-Runner）把 `custom_api` 三个字段各自 `YAML.stringify` 后交后端，故 `generation.js` 必须把用户文本解析成对象/数组再放入 `custom_api`，不能原样传字符串。`additionalParameters.js` 是零依赖 YAML 子集解析器（扁平键值、一层缩进对象、字符串数组、数字/布尔/null/引号串/行内 JSON、注释容错），非法行静默跳过。合并策略：用户 `custom_include_body` 为基础，插件必需的 `response_format:{type:'json_object'}` 与 UI 派生的 `repetition_penalty` 后置覆盖；`custom_exclude_body` / `custom_include_headers` 仅非空时加入。

### 净化、差异与深度净化

| 模块 | 关键导出 / 职责 |
| --- | --- |
| `chat/cleanse.js` | `cleanseMessageDataAtIndex`、`performIncrementalCleanse`、`performGlobalChatMaintenance`、`syncMessageDiffMetadata` |
| `chat/messageBranch.js` | `getMessageDiffBranchKey`（有 swipes 时 `swipe:<id>`，否则 `main`）、`commitCurrentMessageText`、`setCurrentSwipeText` |
| `chat/persistence.js` / `chat/display.js` | 串行保存队列、写回后刷新 DOM |
| `diff/messageMeta.js` | `{originalMes, aiMes, programMes, reverted}` 存在 `msg.__blai_diff_branch_meta[branchKey]`；`migrateChatDiffMetadata` 处理旧字段 |
| `diff/revertMerge.js` | `computeRevertedText(currentText, programText, originalText)`：撤回唯一入口 |
| `diff/pickRevert.js` | 撤回所选的 DOM 采集与计算：`assignDiffRevertItemIds` 编号相邻 del/ins，`collectPickedDiffItems` 用 `Map<itemId, 节点[]>` 索引回查勾选项（避免 O(n×m)），`computePickedRevert` 换算阶段文本 |
| `diff/preferences.js` | 透视「更多操作」菜单偏好的单一入口：`SPECS`（取值序列 + read/write）+ `cycleDiffPreference(key)` 统一切换并写 settings + `syncRelatedRuleRuntime` 打开弹窗时从 settings 恢复相关规则开关。模板按钮用 `data-blai-pref`（值必须等于 SPECS 键） |
| `diff/events.js` | 透视入口与撤回按钮、`recleanseDiffMessageAtIndex`：AI 改写关闭时以保留的 `meta.originalMes` 只跑程序改写；开启时 `requestManualAiRewriteForMessage(index, {recleanse:true, onSettled})` 在撤回保护仍未解除时按原文发起 AI 任务，AI 原子写回时清除保护并写入「原文 → AI → 程序」阶段链。发起失败只出非交互提示，不降级为程序改写。透视弹窗不再有独立「AI 改写」按钮 |
| `diff/compare.js` + `background.js` + `worker.js` | 差异计算；`compareTextPairsInBackground` / `renderDiffDocumentInBackground` 可取消后台任务 |
| `diff/tracking.js` / `retention.js` | 谁被记录、按设置裁剪历史 |
| `rules/ruleIdentity.js` | 规则稳定身份：`computeRuleFingerprint(rule, sub)` 用「分组名+模式+查找词+替换词」算指纹（备注不纳入），`findRuleByFingerprint(rules, fp)` 精确回查。不往用户数据写 id，删改规则后指纹自然失配 |
| `diff/ruleHitTrace.js` | 命中痕迹：净化时用 `collectRuleHits` 采集，存 `msg.__blai_diff_rule_trace[branchKey]`（独立于 diff 阶段元数据）；`findHitsForChange` 按删除/插入文本或原文坐标匹配，`renderHitCandidate` 渲染可点击候选。窗口外消息清理时同步清除 |
| `diff/view.js` | 尾部透视按钮投影；`syncBottomDiffButtonOffset` 按 `.swipes-counter` 实测矩形反推 `right/bottom`，与分支计数同行并留 8px，兼容 99/99 |
| `settings/defaults.js` | `diffLineHeight`（1.5 / 1.8）与 `diffParagraphGap`（4 / 8 / 12）唯一默认与归一化来源，菜单切换后写回并持久化 |
| `dom/protection.js` | `isProtectedNode`、`isAllowedChatInputElement`：哪些节点可净化 |
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

编译时每个 processor 携带 `source`（指纹+分组名+备注+模式）；文本规则被聚合成一个 processor，靠 `wordToSources[查找词]` 逐词记住来源，`getProcessorHitSources` 取回。替换回调在真实命中（非保护段）时按 `options.onRuleHit` 上报 `collectRuleHits` 收集。`collectRuleHits` 是纯采集、不消费流式随机候选，故只在 `chat/cleanse.js` 提交时写入痕迹，不接流式路径。

### 撤回净化

`computeRevertedText(currentText, programText, originalText)` 把「原文 → 程序改写」与「程序改写 → 当前文本」两组差异合并成组：组内未被用户改动的部分还原原文，改过的保留用户文本，定位不到的替换跳过。**撤回按钮可用条件只看 `meta` 是否存在**，不要求当前正文与记录一致——这是「手动编辑后仍能撤回」的关键，别退回文本相等判断。

### 深度净化范围

只允许两类资源：当前角色卡的世界书、当前角色卡的聊天记录；`contentItems.js` 里 `includeCharacterText` 与 `includeShujuku` 显式传 `false`。`is_system === true` **不是**跳过条件——`/hide` 隐藏的楼层正是这种消息，要参与处理并标 `isHidden` 供复核界面显示「已隐藏」；`apply/chat.js` 与 `contentItems.js` 两处判断必须同步。运行设置的「规则预设」取自 `settings.presets`，经 `frozenRunInput` 冻结到本次运行，结束不写回全局当前预设。

### 差异记录与分支

每个 Swipe 分支独立一套 `__blai_diff_branch_meta`，键为 `getMessageDiffBranchKey` 结果。历史窗口只裁剪插件自己的元数据；旧记录退出保留范围后不再提供阶段对比，但撤回保护与「切回 Swipe 不重复净化」仍有效。文本比较走可取消后台任务，切换复核条目或应用前等待当前比较完成。

### 页面与导航

五个 page id：`overview`、`ai`、`clean`、`tools`、`feedback`。宽屏 `.rail`、窄屏 `.bottom-nav`，**两处都要有 `[data-page-target]` 按钮**；容器 `.page-panel[data-page="<id>"]`，只有 `.active` 显示。`ui/shell.js` 的 `responsivePageMetadata` 里残留一条 `bind` 元数据（无面板、无导航按钮），新增页面别照它。

`showResponsivePage()` 同时写 `#blai-purifier-popup[data-active-page]`，供样式做整页差异：首页与反馈页的页内顶栏自带下边框，不处理会与全局顶栏夹成「双层顶栏」，故这两页去掉全局顶栏下边框（`styles/layouts/01-responsive.css`）；新增带页内顶栏的页面一并登记。

新增一页的完整落点见「六、改动的典型落点」。

### 弹窗与浮层

`window.confirm/alert/prompt` 一律禁用（渲染在窗口顶部、阻塞、脱离界面），统一走 `ui/notifications.js`：

```js
const ok = await showConfirmModal('删除这条规则？', { confirmText: '删除', danger: true });
const name = await showPromptModal('分组名', '', { placeholder: '分组名' });
```

实现为动态挂载 `.blai-modal-shell.blai-plugin-dialog` + `.blai-modal-card.blai-plugin-dialog-card`，样式在 `styles/components/02-controls.css`，居中由遮罩层 flex 保证。

**挂载位置**：所有大弹窗都必须是 `templates/purifier.html` 里 `#blai-purifier-popup` 闭合标签之后的顶层节点（运行时 `$('body').append(templateHtml)`，即成为 body 直属）。`#blai-purifier-popup` 带 `backdrop-filter`，会生成层叠上下文，内部 `position:fixed` 相对它定位，遮罩铺不满视口、弹窗还可能被主界面挡住。绑定记录、高级生成参数、附加参数三个弹窗曾嵌在里面，已移出；新增弹窗时同步补 `src/ui/shell.js` 的初始化清理清单，否则重复加载残留旧节点。

**层级阶梯**：所有 z-index 只在 `tokens/03-scale.css` 的 `--blai-z-*` 里定义，页面文件一律 `var(...)`，不写裸数字。从低到高：`--blai-z-inner`（组件内部高亮）/ `--blai-z-page`（页面浮层）/ `--blai-z-tour`（导览）/ `--blai-z-panel`（主面板）/ `--blai-z-loading`（加载遮罩）/ `--blai-z-shell`（大弹窗基底）/ `--blai-z-modal`（弹窗内再弹出的对话框，如备注、删除、重命名、风险确认）/ `--blai-z-modal-raised`（最终层）/ `--blai-z-menu`（下拉/省略号菜单）/ `--blai-z-toast`（toast，最高）。新增浮层先在这张表里选一档，不要另造数字。

**toast 必居最高层**：插件自己的 `.blai-toast` 和 `#blai-ai-toast-container` 都取 `--blai-z-toast`，所以透视弹窗（`--blai-z-shell`）不会盖住提示。**不改宿主 `#toast-container`**：它的位置、层级、配色保持酒馆原生，其他插件的 toastr 不受影响。

**toast 语义色**：`showToast(message, description, type)`，`type` 取 `success` / `error` / `warning` / `info`（默认 info），图标随类型切换（`fa-circle-check` / `fa-circle-xmark` / `fa-triangle-exclamation` / `fa-circle-info`）。四种背景是 `01-palette.css` 里写死的 `--blai-toast-*-bg`（绿/红/橙/蓝实心 + 白字），**不跟随主题背景变化**，02-themes.css 不覆盖它们。这组 token 只挂在插件自有提示（`.blai-toast`、`#blai-ai-toast-container`）上，宿主 toastr 读不到。新增调用点按内容语义显式传 type，别留默认 info 造成成功/失败一个样。插件 toast 位置固定在顶部居中留白（`top: 24px`），不是贴边也不是屏幕正中。

**AI 改写提示独立容器**：`notifyAiRewriteStatus` 不再调用宿主 `toastApi`，而是在 `#blai-ai-toast-container` 里自建 `.blai-ai-rewrite-toast`。仍保留 sticky、关闭按钮、终止按钮、进度标题/正文、自动消失与悬停暂停；`data-type` 决定语义色与 FA 字形图标。这样既能压在透视弹窗上、又能顶部居中，同时不动宿主和其他插件的 toastr。

四个大弹窗（搜索/编辑规则/编辑分组/子规则）在 `@media (min-width: 601px)` 下统一 `min(560px, 100vw - 28px)` 宽、`calc(100dvh - 28px)` 高、16px 圆角（`styles/pages/home/home-breakpoints.css`）；600px 以下整屏（`100vw/100dvh`）、去圆角、适配安全区。

**`[hidden]` 失效**：`.blai-subrule-field{display:flex!important}` 会压掉默认 `[hidden]{display:none}`，靠 `prop('hidden', …)` 切换的块都要补 `.X[hidden]{display:none!important}`（`styles/pages/home/home-overview.css` 有先例）。

**下拉菜单**一律走 `ui/popover.js` 挂 body，CSS `position:fixed` + 高 z-index，避免被父级 `overflow` 裁切；空间不足向上弹。所有下拉菜单（11 类 `-menu` 类）的首末/独行圆角统一在 `styles/components/07-menu-fill.css`：一份 `:is()` 清单配 `&:first-child/last-child/only-child` 原生嵌套，新增菜单类只补这一处清单（其余文件里的同类选择器只管各自配色/动画/定位，不重复圆角规则）。

**定位只手动计算，不用 Popper.js**：Popper 用非 `!important` 的内联 `left/top`，这里为压过主题注入必须用 `!important`，混用会「菜单停在视口右上角」（弹窗内必现，`.blai-modal-shell` 的 `backdrop-filter` 形成包含块）。打开后要重定位一次：弹窗与切页入场动画带 6px 位移，动画期间量到的锚点与稳定后差 6px，不补就「第一次点没弹出、要点第二次」。现在只在菜单自身 `animationend` 与 200ms 兜底时各定位一次，不再逐帧读矩形——手机上逐帧强制重排是展开卡顿的主要来源；`openMenus` 里必须存重定位回调引用的同一个 `entry` 对象，否则 `has(entry)` 恒 false、永不执行。

**菜单两份调用约定**：`openMenuPopover(anchor, menu)` / `closeMenuPopover(menu)` 收 DOM 节点，传 jQuery 对象会被 `if (!anchor)` 拦掉、菜单静默不开。打开时给菜单设唯一 id（子规则菜单用 `#blai-subrule-menu-active`）并给触发按钮设 `aria-expanded="true"`，关闭时清掉。

**外部点击与活动 id 不同步**：`closeAllMenuPopovers()` 只把菜单设 `hidden`、不清业务侧活动 id；子规则菜单 `closeSubruleMenu()` 若只看 `id='blai-subrule-menu-active'` 会误判仍打开、把第二次点击吞成「关闭」。关闭前先查 `menu.hasAttribute('hidden')`：已隐藏就只清 id、按未打开处理。

**首页规则集下拉**：原生 `#blai-preset-select` 留作数据锚点并视觉隐藏，可见控件 `#blai-preset-select-trigger` + `#blai-preset-menu`；菜单沿用弹窗下拉框样式，打开时宽度同步触发器。选项点击走 `presets/events.js` 的 `switchPreset()`，之后显式 `updateToolbarUI()` 刷新 trigger 文案（切换带 `skipRender` 不自动刷新）。事件集中在 `presets/presetSelectMenu.js`，避免 `events.js` 超闸门。

**子规则复制与移动**（`src/rules/view/view-03-subrule-transfer.js`）：复制是 `deepClone` 后 `splice(index + 1, 0, …)`；移动按 `预设序号::分组序号` 编码目标，跨预设用 `buildPresetEntry` 写回 `settings.presets[name]`。只改编辑中的工作副本 `rulesUiState.currentEditingSubrules`，落盘仍需点「保存合集」。

`<select>` 的 `option` 不继承 CSS 变量，必须在 `styles/tokens/02-themes.css` 按 `[data-theme]` 分段显式写死底色字色并带 `!important`（酒馆 `public/style.css` 有 `select option{background-color:var(--white50a)}`）。

**模板里的隐藏真按钮**：`templates/purifier.html` 底部 `.blai-hidden-real-controls` 藏着 `#blai-preset-rename/new/delete/import/export` 与 `#blai-default-toggle` 六个 id 锚点，靠 `styles/layouts/00-shell.css` 的 `display:none !important` 隐藏；删掉那条规则会露出灰按钮。

### 设置命名空间

`ultimate_purifier_ai_rewrite`（`settings/defaults.js` 的 `extensionName`）是数据主键，**改扩展显示名不要动它**，否则既有规则、预设、AI 配置全部读不到；迁移只处理 `..._modified` 与更早 legacy 键。加设置项的完整落点见「六、改动的典型落点」。

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

构建命令、审计入口、调试与发布流程见 [DEVELOPMENT.md](DEVELOPMENT.md)，本节不重复。

| 目录 | 职责 | 约束 |
| --- | --- | --- |
| `tokens/` | 调色板、五套主题、刻度 | 唯一来源，其他文件不许重定义 |
| `base/` | 重置与元素级默认值 | 只放元素级 |
| `components/` | 按钮、输入框、卡片、toast、统一对话框 | 新组件必须建独立文件 |
| `layouts/` | 覆盖层骨架、顶栏、侧栏、底部导航、响应式 | 不含业务页规则 |
| `pages/<page>/` | 单页排版 home/ai/clean/tools/feedback/diff/tour | 只写该页，禁止通用组件样式 |
| `pages/99-mobile.css` | 手机端跨页收尾：标题降档、提交反馈单列化 | 最后加载，压过各页桌面声明；只放 `@media (max-width: 600px)` |

三个令牌文件：`01-palette.css`（状态色、正则高亮 `--re-*`、差异来源色）、`02-themes.css`（auto/light/dark 的 `--bg-*` / `--text-*` / `--border-color` / `--accent-*`，及 `select option` 的三段 `!important`）、`03-scale.css`（`--blai-space-*` / `--blai-font-*` / `--blai-radius-*` / `--blai-border-*` / `--blai-size-*` 与语义层）。动效节奏也在 `03-scale.css`：`--blai-duration-fast` 120ms（菜单/toast 退场）、`--blai-duration-base` 160ms（切页/toast 进场）、`--blai-duration-slow` 180ms（弹卡进场）、`--blai-ease-out`（平滑减速不过冲）；改一处全站同步。交互控件的重复几何也收在同一文件：`--blai-focus-offset`（焦点描边间距）、`--blai-ring-inset`（1px 内描边环，颜色由使用处叠加）、`--blai-z-*`（层级阶梯，见「层级阶梯」段）；同类重复值先在 `03-scale.css` 找，别在各页重写字面量。可见滚动条在 `base/00-reset.css` 挂根容器统一设中性灰拇指（`--blai-scrollbar-thumb`），不用强调色；刻意隐藏的不受影响。

令牌挂在一组**容器选择器**而非 `:root`：`#blai-purifier-popup`、`.blai-modal-shell`、`#blai-scope-tag-editor-modal`、`#blai-rule-transfer-modal`、`#blai-diff-modal`、`#blai-rule-search-modal`、`#blai-preset-import-choice-modal`、`.blai-toast`、`#blai-loading-overlay`、`#blai-tour-layer`。弹层与 toast 不在主容器内——增删容器要同步令牌、`theme.js` 的 `data-theme` 列表与 `03-scale.css` 语义层。

### 界面令牌落点

通用规则以工作区 `docs/design.md` 为准，双端布局与浮层形态见 `docs/design-responsive.md`，配色基准见 `docs/extension-api.md`「配色基准」；本项目的偏好、术语与字号档位见根目录 `DESIGN.md`。本节只记插件令牌与坑。

- 颜色两层：`--bg-base`（画布）→ `--bg-surface`（卡片）。输入控件底色 `--blai-input-bg` 取 `--bg-surface`，靠 1px `--border-color` 表达可输入；跟随酒馆主题时 `--border-color` 取宿主正文色 `--SmartThemeBodyColor` 并混到 18% 不透明度（`color-mix` 混透明），不依赖宿主的 `BorderColor`，亮色与暗色主题都得到同色系低对比描边。结构分隔线另走 `--blai-border-soft`（低对比半透明），不与控件描边共用。滚动条与左侧内容之间由 `--blai-scrollbar-gutter` 预留间距，但下拉菜单 `--blai-dropdown-pad` 右侧为 0，避免面板尾部出现空白。三个大弹窗（规则编辑 / 规则分组 / 深度净化）顶栏、底栏与正文统一 `--bg-base`，靠细线分区。手机端高亮只保留聚焦/按下/选中态的强调色内描边，触摸模拟触发的 hover 不产生强调色高亮；自绘下拉触发器例外，hover 时仍保留自身的默认描边与底色，避免边框消失。滑动开关用 Font Awesome 的 `fa-toggle-off` / `fa-toggle-on` 图标本体，不自绘轨道圆点；开关按钮与同行铅笔 / 竖三点同规格（`32×32`），开启态与它们同色，间距走 `--blai-switch-gap`。三条容易踩的坑（宿主 FA 规则盖字号、checked 颜色被页面级规则压住、隐藏 checkbox 热区要与可见按钮同尺寸）与具体写法见 `components/02-controls.css`、`pages/clean/clean-main.css` 的相邻注释。盾牌图标只允许出现在酒馆页注入的人设保护按钮上，面板内的人设开关不得改写其 `<i>`。
- 焦点态用 `box-shadow: inset 0 0 0 1px var(--accent-color) !important`，不占位不抖动；hover 不加描边。禁给输入框写 `transparent`（第三方主题会注入带 `!important` 的底色，闸门会拦）。主题对裸标签有强声明时把 `--ui-color-sec` 重定向到 `--blai-input-bg`，不新增 `!important`；副作用是边框也读该变量，反馈页三个裸标签用同色 inset 补可见边框。`.pages` / `.page-panel` 保持透明让 `--bg-base` 透上来；日间用实色，不用半透明叠灰底（发脏）。
- 图标统一酒馆自带 Font Awesome 6.5.2，格式 `<i class="fas fa-*" aria-hidden="true"></i>`；禁止内联 `<svg>`、CSS 拼三角/对勾、字符箭头。伪元素勾选与下拉箭头用 FA 字形码加 FA 字体；装饰线条/圆点不算图标。类名必须在 FA 6.5.2 存在，`fa-fw` / `fa-solid` / `fa-spin` 是修饰类，不参与校验。
- 字号只用 5 档语义 token（`--blai-fs-*`），旧 `--blai-font-N` 全是别名；双端档值与禁止整体缩放见根目录 `DESIGN.md`「字号档位」。间距语义层在 `03-scale.css` 第二块：`--blai-canvas-pad`(12)、`--blai-panel-pad`、`--blai-panel-pad-tight`(10)、`--blai-panel-gap`、`--blai-column-gap`、`--blai-head-gap`(8)、`--blai-head-pad`(12)、`--blai-row-pad`(10)。弹窗/对话框里有底色的按钮左右内边距统一走 `--blai-btn-pad-x`(12)，各弹窗不再写 14/15/20/22px 的独立值。页面文件不写裸 `gap: 14px`。
- 视口高度统一走 `--blai-viewport-h`（`100vh` 回退，支持时用 `100svh`），插件外壳与大弹窗不再直接写 `100dvh`：手机软键盘弹出时布局高度不重排，内容被键盘覆盖而非被顶起。弹窗打开时输入框不自动聚焦，避免软键盘意外弹出。
- 两栏统一 `minmax(0, 5fr) minmax(0, 3fr)`（两端都要 `minmax(0, ...)`）与 `align-items: stretch`，不退回 `start`；断点、`box-shadow`、`grid-template-columns`、`transform` 保留字面量是刻意的。

### 反馈页与高亮的实现约束

反馈页桌面布局高度随内容增长（不用 `minmax(0,1fr)+height:100%` 锁死），否则「涉及区域」展开时详细说明框越过固定 footer 盖住隐私说明浅字；隐私说明设 `min-height` 避免换行跳动。查找区正则高亮态 `color: transparent` 与 token 颜色必须保留强声明（同属性在控件基线规则里仍有 `!important`，加特异性压不住）。

测试区命中高亮的固定做法：overlay 叠在 textarea 之下，命中时只把输入框自身背景 `--blai-input-bg` 置 transparent；**可见文字与光标始终由 textarea 自己渲染**，overlay 的文字（含 `<mark>`）一律 `color: transparent`、`mark` 不加水平 padding，只画匹配底色块。切勿反过来把 textarea 文字转透明、让 overlay 重画整段文字——那样 mark 的 padding 会把重画的字推离原生光标，光标就叠进字形里。overlay 与 textarea 必须有完全相同的边框和内边距（不要一边有边框一边又给 padding 补 1px），否则高亮块整体偏移。命中统计放测试框右上角。

**查找框（`#blai-modal-sub-target`）的语法高亮**与上面的测试区相反：textarea 文字转 `transparent`、**光标由 textarea 保留**（`caret-color`），彩色字由 `.blai-regex-highlight` 覆盖层逐 token 重画。两层字形度量必须逐项一致，否则光标（textarea 画）与字（覆盖层画）错位：`font-size` 同弹窗 13px、`line-height` 同 `.blai-regex-input-wrap .blai-textarea` 的 **1.55**（不是普通 textarea 的 1.5）、`font-weight` 一律 **normal**，各 token **只用颜色区分、禁止加粗**（曾给 escape/group/quantifier 等加 bold，中文全角不受影响所以看着正常，光标前一旦有 `\A`、`(?<=`、`[]`、`?` 等西文符号就叠字）；覆盖层无边框，padding 要把 input 的 1px 边框补进去（`12px+1px / 14px+1px`）。回归脚本 `test/audit/verify-regex-caret.mjs` 真浏览器量「光标 x − 前一字符右边缘 x」并注入 bold 做反证，`CDP_PORT=9224 node test/audit/verify-regex-caret.mjs`。配对符号与匹配测试区底纹都用直角（`border-radius:0`），圆角会在符号两端和跨行接缝处吃掉底色。

配对高亮的触发时机：只有 `#blai-modal-sub-target` 上真实的 `click/keyup/select` 才调用 `syncRegexBracketPairHighlight()`。打开弹窗 / 切模式 / 改高亮开关 / 输入内容一律走无参 `renderRegexHighlightPreview()`，绝不读 `selectionStart` 去配对——刚 `.val()` 进去光标停在开头符号上（或旧值末尾），会被误判为「光标贴着括号」而自动加底纹。

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
| 改撤回所选交互 / 性能 | `diff/pickRevert.js`（编号 + 采集索引）+ `diff/events/events-00-core.js`（计数缓存、apply 提交）+ `events-01-bindings.js`（勾选事件） |
| 改「更多操作」菜单偏好 | `diff/preferences.js` 的 `SPECS` 加一项（取值 + read/write）→ 模板按钮加 `data-blai-pref="<键>"`；键名必须与 SPECS 一致，否则点击无效 |
| 改移动规则弹窗步骤 | `rules/view/view-03-subrule-transfer.js`（步骤切换）+ `templates/purifier.html` 的 `#blai-subrule-transfer-*` + `styles/pages/home/home-overview.css`（`.blai-transfer-step`） |
| 改下拉滚动关闭行为 | `ui/popover.js` 的 scroll 捕获：portal 菜单内部滚动必须 return，外部才 `closeAllMenuPopovers` |
| 改差异记录 | `diff/tracking.js`（谁被记录）+ `messageMeta.js`（存取）+ `view.js` / `compare.js`（渲染） |
| 改命中规则定位 | `rules/ruleIdentity.js`（指纹）+ `rules/engine/engine-00-patterns.js`（processor 带来源）+ `engine-01-replace.js`（命中回调）+ `diff/ruleHitTrace.js`（存取回查）+ `diff/events/diffRelatedRules.js`（UI） |
| 改全文改写上色 | `styles/pages/diff/00-diff.css`（`.blai-diff-modal-content ins/del` 用 `--blai-diff-stage-*`，片段/全文共用），改后须跑 `build-css.mjs` |
| 改深度净化范围 | `inventory.js`（列什么）+ `contentItems.js`（读什么）+ `apply/`（写回什么）+ `view.js`（界面说明） |
| 改扫描结果指标文案 / 布局 | `deepClean/view/view-00-selection.js` 的 `renderDeepCleanScanResult`（指标名 + 口径说明 + 按钮文案）+ `styles/pages/clean/clean-deep-processing.css` + `clean-deep-responsive.css`；计数口径以 `deepClean/scan.js` 为准 |
| 改新手指引步骤 / 锚点 | `ui/tour/tour-01-steps.js`（文案）与 `tour-00-targets.js`（目标函数）。目标必须桌面/手机都存在且可见；手机端滚动由 `tour-02-runtime.js` 的 `phoneTourScrollOwner` 处理。改完跑 `verify-followup.mjs` 双视口断言 |
| 改对话框外观 | `ui/notifications.js` + `styles/components/02-controls.css` 的 `.blai-plugin-dialog-card` 段 |
| 改菜单定位 | `ui/popover.js` + 对应 `*-menu` 的 CSS |
| 改主题配色 | `styles/tokens/02-themes.css` 对应主题的令牌段 + 该主题的特殊分区规则；新主题还要扩展 `select option` 与 `data-theme` 容器列表 |
| 改弹窗尺寸 | `styles/pages/home/home-breakpoints.css` 的 `@media (min-width: 601px)` 段（四处同一把尺子） |
| 改手机端标题字号 / 提交反馈单列 | `styles/pages/99-mobile.css`（最后加载的跨页收尾） |
| 改 AI 连接标题行 | `styles/pages/ai/01-ai.css` 的 `@media (max-width: 600px)` 段：开关绝对定位到最右，标题在整条栏里居中 |
| 改手机端顶栏留白 | `styles/layouts/00-shell.css`、`styles/pages/home/home-topbar.css`、`styles/pages/feedback/feedback-diagnostics.css` 各自的窄屏段 |

### 样式文件职责速查

目录名只分层，不表职责；`pages/` 下用职责名，改样式前按此表定位。`styles/ORDER.json` 的 `order` 数组即层叠顺序，下表按顺序列出。

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
| `pages/clean/clean-deep-modes.css` | 深度净化：规则预设、处理模式、执行面板、处理范围信息行（原 `clean-deep-scope.css` 并入） |
| `pages/clean/clean-deep-processing.css` | 深度净化：批处理进度、扫描与完成态 |
| `pages/clean/clean-deep-results.css` | 深度净化：进度、结果、完成态 |
| `pages/clean/clean-deep-responsive.css` | 深度净化响应式：900 / 600 / 920 / 700 四档媒体查询 |
| `pages/feedback/feedback-workspace.css` | 反馈页工作区、视图标签、提交表单 |
| `pages/feedback/feedback-form.css` | 反馈页表单控件：勾选框、按钮、状态与提示 |
| `pages/feedback/feedback-diagnostics.css` | 反馈页本地诊断与预览、手机窄屏顶栏 |
