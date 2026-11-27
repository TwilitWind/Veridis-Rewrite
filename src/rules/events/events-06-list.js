/** 规则事件：list。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { getSelectedIndexesFromState, getBatchOperationContext, shouldBatchTransferRule, deleteRulesWithConfirm, renderTagsPreserveBatchSelection, batchMoveRules } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty } from '.././state.js';
import { buildRuleActivationConfirmMessage, isRuleActivationWarningEnabled } from '.././model.js';
import { showRiskConfirmModal } from '../../ui/notifications.js';
import { openTransferModal } from '.././view.js';

export function bindRuleListEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();



    $(document).off('click', '.blai-rule-transfer').on('click', '.blai-rule-transfer', function() {
        const index = Number($(this).data('index'));
        const rules = extension_settings[extensionName].rules || [];
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        if (shouldBatchTransferRule(index, rules)) openTransferModal(getSelectedIndexesFromState(rules));
        else openTransferModal(index);
    });

    $(document).off('click', '.blai-rule-move-up').on('click', '.blai-rule-move-up', function() {
        const index = Number($(this).data('index'));
        const rules = extension_settings[extensionName].rules || [];
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        const ctx = getBatchOperationContext(index, rules);
        if (ctx.shouldBatch) { if (!batchMoveRules(rules, ctx.selectedIndexes, 'up')) return; }
        else { if (index <= 0) return; [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]]; }
        markRulesDataDirty();
        saveSettingsDebounced();
        renderTagsPreserveBatchSelection();
    });

    $(document).off('click', '.blai-rule-move-down').on('click', '.blai-rule-move-down', function() {
        const index = Number($(this).data('index'));
        const rules = extension_settings[extensionName].rules || [];
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        const ctx = getBatchOperationContext(index, rules);
        if (ctx.shouldBatch) { if (!batchMoveRules(rules, ctx.selectedIndexes, 'down')) return; }
        else { if (index >= rules.length - 1) return; [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]]; }
        markRulesDataDirty();
        saveSettingsDebounced();
        renderTagsPreserveBatchSelection();
    });

    $(document).off('change', '.blai-rule-toggle').on('change', '.blai-rule-toggle', async function() {
        const rules = extension_settings[extensionName].rules || [];
        const index = Number($(this).data('index'));
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        const targetEnabled = $(this).prop('checked');
        const ctx = getBatchOperationContext(index, rules);
        const targetIndexes = ctx.shouldBatch ? ctx.selectedIndexes : [index];
        if (targetEnabled) {
            const riskyRules = targetIndexes
                .map((ruleIndex) => rules[ruleIndex])
                .filter(isRuleActivationWarningEnabled);
            if (riskyRules.length > 0 && !await showRiskConfirmModal(buildRuleActivationConfirmMessage(riskyRules))) {
                $(this).prop('checked', false);
                renderTagsPreserveBatchSelection();
                return;
            }
        }
        targetIndexes.forEach((ruleIndex) => { rules[ruleIndex].enabled = targetEnabled; });
        markRulesDataDirty();
        saveSettingsDebounced();
        renderTagsPreserveBatchSelection();
    });

    $(document).off('click', '.blai-rule-del').on('click', '.blai-rule-del', async function() {
        const rules = extension_settings[extensionName].rules || [];
        const index = Number($(this).data('index'));
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        await deleteRulesWithConfirm(index, rules);
    });
}
