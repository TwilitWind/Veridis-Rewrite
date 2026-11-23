/** 规则事件：card。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { getSelectedIndexesFromState, getBatchOperationContext, shouldBatchTransferRule, handleDeleteRule, renderTagsPreserveBatchSelection, batchMoveRules } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty } from '.././state.js';
import { getRuleActivationWarning, isRuleActivationWarningEnabled } from '.././model.js';
import { deepClone } from '../../presets/model.js';
import { showConfirmModal, showRiskInfoModal, showToast } from '../../ui/notifications.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';
import { openEditModal, openTransferModal } from '.././view.js';

export function bindRuleCardEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();



    $(document).off('click', '#blai-open-new-rule-btn').on('click', '#blai-open-new-rule-btn', () => openEditModal(-1));
    $(document).off('click keydown', '.blai-rule-risk-indicator').on('click keydown', '.blai-rule-risk-indicator', function(event) {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();

        const rules = extension_settings[extensionName].rules || [];
        const index = Number($(this).data('index'));
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;
        const rule = rules[index];
        const warning = getRuleActivationWarning(rule);
        if (!isRuleActivationWarningEnabled(rule) || !warning) return;
        showRiskInfoModal(warning);
    });
    $(document).off('click', '.blai-rule-edit').on('click', '.blai-rule-edit', function() { openEditModal($(this).data('index')); });
    const closeRuleCardMenu = () => {
        const menu = document.getElementById('blai-rule-card-menu-active');
        if (!menu) return;
        menu.id = '';
        menu.setAttribute('hidden', '');
        closeMenuPopover(menu);
        $('.blai-home-card-menu-toggle').attr('aria-expanded', 'false');
    };

    $(document).off('click', '.blai-home-card-menu-toggle').on('click', '.blai-home-card-menu-toggle', function(event) {
        event.preventDefault();
        event.stopPropagation();
        const $toggle = $(this);
        const $menu = $toggle.closest('.blai-home-card-menu-wrap').find('.blai-home-card-menu');
        if (!$menu.length) return;
        const menu = $menu.get(0);
        const isOpen = !menu.hasAttribute('hidden');
        closeRuleCardMenu();
        if (isOpen) return;
        menu.removeAttribute('hidden');
        menu.id = 'blai-rule-card-menu-active';
        $toggle.attr('aria-expanded', 'true');
        openMenuPopover($toggle.get(0), menu);
    });

    $(document).off('click', '.blai-rule-menu-item').on('click', '.blai-rule-menu-item', async function(event) {
        event.preventDefault();
        event.stopPropagation();
        const action = String($(this).attr('data-rule-action') || '');
        const index = Number($(this).attr('data-index'));
        const rules = extension_settings[extensionName].rules || [];
        closeRuleCardMenu();
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) return;

        if (action === 'up' || action === 'down') {
            const ctx = getBatchOperationContext(index, rules);
            if (ctx.shouldBatch) {
                if (!batchMoveRules(rules, ctx.selectedIndexes, action)) return;
            } else if (action === 'up') {
                if (index <= 0) return;
                [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
            } else {
                if (index >= rules.length - 1) return;
                [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]];
            }
            markRulesDataDirty();
            saveSettingsDebounced();
            renderTagsPreserveBatchSelection();
            return;
        }

        if (action === 'copy') {
            const ctx = getBatchOperationContext(index, rules);
            const indexes = ctx.shouldBatch ? ctx.selectedIndexes : [index];
            const copies = indexes.map((idx) => rules[idx]).filter(Boolean).map((rule) => deepClone(rule));
            if (copies.length === 0) return;
            copies.forEach((rule) => {
                if (rule && typeof rule === 'object') rule.name = `${String(rule.name || '未命名合集')} 副本`;
                rules.push(rule);
            });
            markRulesDataDirty();
            saveSettingsDebounced();
            renderTagsPreserveBatchSelection();
            showToast(copies.length > 1 ? `已复制 ${copies.length} 个合集` : '合集复制成功', 'success');
            return;
        }

        if (action === 'transfer') {
            if (shouldBatchTransferRule(index, rules)) openTransferModal(getSelectedIndexesFromState(rules));
            else openTransferModal(index);
            return;
        }

        if (action === 'delete') {
            if (!await showConfirmModal('确定要删除这个规则分组吗？删除后无法恢复。', { danger: true, okText: '删除' })) return;
            const deletingCount = shouldBatchTransferRule(index, rules) ? getSelectedIndexesFromState(rules).length : 1;
            if (handleDeleteRule(index, rules)) {
                markRulesDataDirty();
                saveSettingsDebounced();
                renderTagsPreserveBatchSelection();
                showToast(deletingCount > 1 ? `已删除 ${deletingCount} 个合集` : '合集删除成功', 'success');
            }
        }
    });

    $(document).off('mousedown', '#blai-home-rule-grid').on('mousedown', '#blai-home-rule-grid', function(event) {
        if ($(event.target).closest('.blai-home-card-menu-wrap').length > 0) return;
        closeRuleCardMenu();
    });
}
