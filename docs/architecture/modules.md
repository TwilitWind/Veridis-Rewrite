# 词汇映射 · 模块索引

各目录模块的职责与关键导出。鸟瞰、边界与不变量见根目录 [ARCHITECTURE.md](../../ARCHITECTURE.md)，改动落点见 [change-map.md](change-map.md)。

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
| `ui/notifications.js` | `showToast` / `showConfirmModal` / `showAlertModal` / `showPromptModal` / `showRiskConfirmModal` / `showRiskInfoModal` / `showUnsavedChangesModal`（三选一：继续编辑 / 放弃 / 保存，返回 `cancel`/`discard`/`save`） |
| `ui/popover.js` | `openMenuPopover` 等：菜单挂 body，纯手动按视口定位（不用 Popper.js）；关闭时复位锚点标记与活动 id |
| `ui/infoPopover.js` | `bindInfoPopoverEvents`：所有 `data-blai-info-trigger` 说明按钮共用的点击展开/收起，复用 `ui/popover.js` 的 portal 定位 |
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
| `commentProtection.js` | XML 注释与 html 代码块范围不参与匹配 |
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
| `diff/preferences.js` | 透视「更多操作」菜单偏好的单一入口：`SPECS`（取值序列 + read/write）+ `cycleDiffPreference(key)` 统一切换并写 settings + `syncRelatedRuleRuntime` 打开弹窗时从 settings 恢复规则定位开关。模板按钮用 `data-blai-pref`（值必须等于 SPECS 键） |
| `diff/events.js` | 透视入口与撤回按钮、`recleanseDiffMessageAtIndex`：AI 改写关闭时以保留的 `meta.originalMes` 只跑程序改写；开启时 `requestManualAiRewriteForMessage(index, {recleanse:true, onSettled})` 在撤回保护仍未解除时按原文发起 AI 任务，AI 原子写回时清除保护并写入「原文 → AI → 程序」阶段链。发起失败只出非交互提示，不降级为程序改写 |
| `diff/compare.js` + `background.js` + `worker.js` | 差异计算；`compareTextPairsInBackground` / `renderDiffDocumentInBackground` 可取消后台任务。片段块与全文块都写 `data-diff-section`（ai/program）供来源筛选按块隐藏；`renderFullTextDiffBlocks` 第 4 参 `section` 可选，深度清理不传则不产生该属性 |
| `diff/tracking.js` / `retention.js` | 谁被记录、按设置裁剪历史 |
| `rules/ruleIdentity.js` | 规则稳定身份：`computeRuleFingerprint(rule, sub)` 用「分组名+模式+查找词+替换词」算指纹（备注不纳入），`findRuleByFingerprint(rules, fp)` 精确回查。不往用户数据写 id，删改规则后指纹自然失配 |
| `diff/ruleHitTrace.js` | 命中痕迹：净化时用 `collectRuleHits` 采集（坐标还原到原文），存 `msg.__blai_diff_rule_trace[branchKey]`（独立于 diff 阶段元数据）；`findHitsForChange` 按删除/插入文本加原文坐标匹配，并要求命中词属于该差异片段，`renderHitCandidate` 渲染可点击候选。窗口外消息清理时同步清除 |
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
