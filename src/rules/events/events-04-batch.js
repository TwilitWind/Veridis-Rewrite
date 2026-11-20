/** 规则事件：batch。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { getSelectedIndexesFromState, syncBatchSelectionStateFromDom, deleteSingleRule, deleteSelectedRules, renderTagsPreserveBatchSelection } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '.././state.js';
import { showConfirmModal } from '../../ui/notifications.js';
import { openTransferModal } from '.././view.js';

export function bindRuleBatchEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();



    $(document).off('click', '#blai-batch-toggle').on('click', '#blai-batch-toggle', function() {
        const $popup = $('#blai-purifier-popup');
        const isBatchMode = !$popup.hasClass('blai-is-batch-mode');
        $popup.toggleClass('blai-is-batch-mode', isBatchMode);
        $(this)
            .toggleClass('blai-active', isBatchMode)
            .attr('aria-expanded', String(isBatchMode));
        if (!isBatchMode) {
            $('.batch-item-checkbox').prop('checked', false);
            rulesUiState.batchSelectedRuleIds = [];
        }
    });

    $(document).off('click', '#blai-btn-select-all').on('click', '#blai-btn-select-all', () => {
        $('.batch-item-checkbox').prop('checked', true);
        syncBatchSelectionStateFromDom(extension_settings[extensionName].rules || []);
    });

    $(document).off('click', '#blai-btn-select-invert').on('click', '#blai-btn-select-invert', () => {
        $('.batch-item-checkbox').each(function() { $(this).prop('checked', !$(this).prop('checked')); });
        syncBatchSelectionStateFromDom(extension_settings[extensionName].rules || []);
    });

    $(document).off('click', '#blai-btn-batch-transfer').on('click', '#blai-btn-batch-transfer', () => {
        const selectedIndexes = getSelectedIndexesFromState(extension_settings[extensionName].rules || []);
        if (selectedIndexes.length > 0) openTransferModal(selectedIndexes);
    });

    $(document).off('click', '#blai-btn-batch-delete').on('click', '#blai-btn-batch-delete', async () => {
        const rules = extension_settings[extensionName].rules || [];
        const selectedIndexes = getSelectedIndexesFromState(rules);
        if (selectedIndexes.length <= 0 || !await showConfirmModal(`确定要删除选中的 ${selectedIndexes.length} 个规则分组吗？`, { danger: true, okText: '删除' })) return;
        if (selectedIndexes.length > 1 ? deleteSelectedRules(rules, selectedIndexes) : deleteSingleRule(rules, selectedIndexes[0])) {
            markRulesDataDirty();
            saveSettingsDebounced();
            renderTagsPreserveBatchSelection();
        }
    });

    $(document).off('change', '.batch-item-checkbox').on('change', '.batch-item-checkbox', () => syncBatchSelectionStateFromDom(extension_settings[extensionName].rules || []));
}
