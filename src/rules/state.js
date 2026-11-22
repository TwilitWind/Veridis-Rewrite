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
    // 打开分组编辑弹窗时的原始快照（名称 + 规则），用于关闭前判断是否有未保存改动。
    editGroupBaseline: null,
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

// 分组编辑弹窗的未保存改动检测：把名称与规则列表归一化成可比较的字符串。
// isEditing 是纯 UI 标记（打开时统一置 false、保存后重建对象时可能丢失），不参与比较，
// 否则「打开→原样关闭」也会被误判为改动。
function canonicalizeGroupValue(value) {
    if (Array.isArray(value)) return value.map(canonicalizeGroupValue);
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).filter(k => k !== 'isEditing').sort().forEach((k) => {
            out[k] = canonicalizeGroupValue(value[k]);
        });
        return out;
    }
    return value;
}

function readCurrentGroupSnapshot() {
    const name = typeof $ !== 'undefined' && $('#blai-edit-name').length
        ? String($('#blai-edit-name').val() || '')
        : '';
    return JSON.stringify(canonicalizeGroupValue({ name, subrules: rulesUiState.currentEditingSubrules }));
}

/** 打开分组编辑弹窗、名称与规则都就位后调用，记录基线。 */
export function captureEditGroupBaseline() {
    rulesUiState.editGroupBaseline = readCurrentGroupSnapshot();
}

/** 关闭弹窗前判断名称或规则是否相对基线发生变化。 */
export function hasUnsavedEditGroupChanges() {
    if (rulesUiState.editGroupBaseline === null) return false;
    return rulesUiState.editGroupBaseline !== readCurrentGroupSnapshot();
}

/** 关闭弹窗后清空基线，避免影响下一次打开。 */
export function clearEditGroupBaseline() {
    rulesUiState.editGroupBaseline = null;
}
