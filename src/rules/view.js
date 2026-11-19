/**
 * 负责规则/规则搜索/编辑器的 DOM 投影，以及临时编辑器展示状态。
 * 它不持久化规则变更。
 */

// 聚合出口：实现已按依赖拓扑拆分到同目录的分块文件，对外接口保持不变。
export { clearRuleSearchEditFlow, syncRuleSearchInputUi, RULE_SEARCH_HISTORY_LIMIT, syncRuleEditFilterUi, closeRuleEditFilterMenu, toggleRuleEditFilterMenu, RULE_EDIT_FILTER_LABELS, focusLatestRuleCard, openTransferModal, closeTransferModal, closeRuleSearchPopover, resetRuleSearchState, normalizeRuleSearchHistory, hydrateRuleSearchHistory, pushRuleSearchHistory, removeRuleSearchHistoryItem, clearRuleSearchHistory } from './view/view-00-search.js';
export { renderRuleSearchModal, openRuleSearchModal, closeRuleSearchModal, removeRegexReplacementInput, startEditingRegexReplacementInput, recognizeRegexReplacementInput, hasPendingRegexReplacementInput, setSingleRuleReplacementEditor, getSingleRuleReplacementValues, renderTags } from './view/view-01-modal.js';
export { renderSubrulesToModal, openSingleRuleModal, openEditModal } from './view/view-02-panels.js';
export { openSubruleTransferModal, closeSubruleTransferModal, runSubruleTransfer } from './view/view-03-subrule-transfer.js';
