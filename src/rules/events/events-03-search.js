/** 规则事件：search。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { openRuleEditTarget, resetRuleSearchQueryState, commitRuleSearchKeyword, noteRuleSearchInput } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { rulesUiState } from '.././state.js';
import { showConfirmModal } from '../../ui/notifications.js';
import { clearRuleSearchHistory, pushRuleSearchHistory, removeRuleSearchHistoryItem, closeRuleSearchModal, openRuleSearchModal, renderRuleSearchModal, closeRuleSearchPopover, renderSubrulesToModal, syncRuleEditFilterUi, syncRuleSearchInputUi, toggleRuleEditFilterMenu, closeRuleEditFilterMenu } from '.././view.js';

// 搜索防抖计时器：只在搜索组内读写，单独持有以免跨模块赋值。
let ruleSearchDebounceTimer = 0;

export function bindRuleSearchEvents() {
    const { extension_settings } = getAppContext();



    $(document).off('click', '#blai-preset-search').on('click', '#blai-preset-search', () => {
        openRuleSearchModal();
    });

    $(document).off('click', '#blai-rule-search-back').on('click', '#blai-rule-search-back', () => {
        closeRuleSearchModal({ reset: true });
    });

    $(document).off('input', '#blai-rule-search-input').on('input', '#blai-rule-search-input', function() {
        noteRuleSearchInput();
        rulesUiState.ruleSearchDraftKeyword = String($(this).val() || '');
        rulesUiState.ruleSearchExpandedMenuKey = '';
        syncRuleSearchInputUi();
        if (rulesUiState.ruleSearchDraftKeyword.trim() === '') {
            rulesUiState.ruleSearchKeyword = '';
            rulesUiState.ruleSearchHasSearched = false;
            rulesUiState.ruleSearchHistorySessionOpen = false;
            rulesUiState.ruleSearchLastInputAt = 0;
        }
        if (ruleSearchDebounceTimer) window.clearTimeout(ruleSearchDebounceTimer);
        ruleSearchDebounceTimer = window.setTimeout(() => {
            ruleSearchDebounceTimer = 0;
            commitRuleSearchKeyword();
        }, 220);
    });

    $(document).off('keydown', '#blai-rule-search-input').on('keydown', '#blai-rule-search-input', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (ruleSearchDebounceTimer) {
            window.clearTimeout(ruleSearchDebounceTimer);
            ruleSearchDebounceTimer = 0;
        }
        commitRuleSearchKeyword({ endSession: true });
    });

    $(document).off('click', '#blai-rule-search-history-clear').on('click', '#blai-rule-search-history-clear', async function(e) {
        e.preventDefault();
        if (!await showConfirmModal('确定要清空全部搜索记录吗？', { danger: true, okText: '清除' })) return;
        clearRuleSearchHistory();
        renderRuleSearchModal();
    });

    $(document).off('click', '#blai-rule-search-clear').on('click', '#blai-rule-search-clear', () => {
        resetRuleSearchQueryState();
        syncRuleSearchInputUi({ syncValue: true });
        renderRuleSearchModal();
        $('#blai-rule-search-input').trigger('focus');
    });

    $(document).off('click', '.blai-rule-search-history-item').on('click', '.blai-rule-search-history-item', function(e) {
        e.preventDefault();
        const keyword = String($(this).attr('data-keyword') || '');
        rulesUiState.ruleSearchDraftKeyword = keyword;
        rulesUiState.ruleSearchKeyword = keyword;
        rulesUiState.ruleSearchHasSearched = keyword.trim().length > 0;
        rulesUiState.ruleSearchExpandedMenuKey = '';
        syncRuleSearchInputUi({ syncValue: true });
        pushRuleSearchHistory(keyword);
        rulesUiState.ruleSearchHistorySessionOpen = false;
        rulesUiState.ruleSearchLastInputAt = 0;
        renderRuleSearchModal();
    });

    $(document).off('click', '.blai-rule-search-history-remove').on('click', '.blai-rule-search-history-remove', function(e) {
        e.preventDefault();
        e.stopPropagation();
        removeRuleSearchHistoryItem($(this).attr('data-keyword'));
        renderRuleSearchModal();
    });

    $(document).off('click', '#blai-edit-filter').on('click', '#blai-edit-filter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleRuleEditFilterMenu();
    });

    $(document).off('click', '.blai-edit-filter-item').on('click', '.blai-edit-filter-item', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const nextFilter = String($(this).attr('data-filter') || 'all');
        closeRuleEditFilterMenu();
        if ((rulesUiState.currentEditingFilter || 'all') === nextFilter) return;
        rulesUiState.currentEditingFilter = nextFilter;
        syncRuleEditFilterUi();
        renderSubrulesToModal();
    });

    $(document).off('click', '#blai-rule-search-scope .blai-rule-search-scope-item').on('click', '#blai-rule-search-scope .blai-rule-search-scope-item', function(e) {
        e.preventDefault();
        const rawScope = String($(this).attr('data-scope') || 'all');
        const nextScope = rawScope === 'preset' ? 'rule' : rawScope;
        if ((rulesUiState.ruleSearchScope || 'all') === nextScope) return;
        rulesUiState.ruleSearchScope = nextScope;
        rulesUiState.ruleSearchExpandedMenuKey = '';
        renderRuleSearchModal();
    });

    $(document).off('click', '.blai-rule-search-menu-toggle').on('click', '.blai-rule-search-menu-toggle', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const nextKey = String($(this).data('key') || '');
        const alreadyOpen = rulesUiState.ruleSearchExpandedMenuKey === nextKey;
        rulesUiState.ruleSearchExpandedMenuKey = alreadyOpen ? '' : nextKey;
        renderRuleSearchModal();
    });

    // 菜单由 popover.js 挂到 body，不在搜索弹窗内；委托选择器不能带 #blai-rule-search-modal 祖先。
    $(document).off('click', '.blai-rule-search-menu-item').on('click', '.blai-rule-search-menu-item', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const action = String($(this).data('action') || '');
        const ruleIndex = Number($(this).attr('data-rule-index'));
        const subRuleIndex = Number($(this).attr('data-subrule-index'));
        const rules = extension_settings[extensionName].rules || [];
        if (!Number.isInteger(ruleIndex) || ruleIndex < 0 || ruleIndex >= rules.length) return;
        if (action === 'subrule' && (!Number.isInteger(subRuleIndex) || subRuleIndex < 0 || subRuleIndex >= (rules[ruleIndex]?.subRules || []).length)) return;

        rulesUiState.ruleSearchExpandedMenuKey = '';
        closeRuleSearchModal();

        if (action === 'group') {
            openRuleEditTarget(ruleIndex, subRuleIndex, 'group');
            return;
        }

        if (action === 'subrule') {
            openRuleEditTarget(ruleIndex, subRuleIndex, 'subrule');
        }
    });

    $(document).off('mousedown', '#blai-rule-search-modal').on('mousedown', '#blai-rule-search-modal', function(e) {
        if (!rulesUiState.ruleSearchExpandedMenuKey) return;
        if ($(e.target).closest('.blai-rule-search-menu-wrap').length > 0) return;
        rulesUiState.ruleSearchExpandedMenuKey = '';
        closeRuleSearchPopover();
        renderRuleSearchModal();
    });
}
