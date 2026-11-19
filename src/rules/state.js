import { markPresetsUiDirty } from '../presets/state.js';

// 在一个失效边界下负责最终 Program 与流式处理器集合。
// 持久化的规则仍在扩展设置中。
export const programRuntimeState = {
    activeProcessors: [],
    streamingProcessors: [],
    isRegexDirty: true,
};

// 独立于 Program 缓存，负责临时的规则 UI/编辑会话。
export const rulesUiState = {
    rulesUiDirty: true,
    ruleSearchKeyword: '',
    ruleSearchDraftKeyword: '',
    ruleSearchHasSearched: false,
    ruleSearchExpandedMenuKey: '',
    ruleSearchScope: 'all',
    ruleSearchHistory: [],
    searchEditFlow: {
        active: false,
        returnMode: '',
        ruleIndex: -1,
        subRuleIndex: -1,
    },
    currentEditingIndex: -1,
    currentEditingFilter: 'all',
    currentEditingSubrules: [],
    currentSubruleEditIndex: -1,
    batchSelectedRuleIds: [],
    currentTransferRuleIndexes: [],
    currentTransferSubruleIndex: -1,
};

export function markRegexDirty(dirty = true) {
    programRuntimeState.isRegexDirty = dirty;
}

export function markRulesUiDirty(dirty = true) {
    rulesUiState.rulesUiDirty = dirty;
}

export function markRulesDataDirty(options = {}) {
    const { rulesUi = true, presetsUi = false } = options;
    markRegexDirty(true);
    if (rulesUi) markRulesUiDirty(true);
    if (presetsUi) markPresetsUiDirty(true);
}
