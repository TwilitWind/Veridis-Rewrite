/** 规则事件：subruleEditor。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { validateRegexTargetField, syncRegexHighlightScroll, renderRegexHighlightPreview, syncRegexBracketPairHighlight, runRegexTestPreview, syncRegexTestScroll } from './events-00-shared.js';
import { applySubruleModeUI, applySubruleRewriteModeUI } from './events-01-ui.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { rulesUiState } from '.././state.js';
import { showConfirmModal, showPromptModal, showToast } from '../../ui/notifications.js';
import { closeSubruleTransferModal, openSingleRuleModal, openSubruleTransferModal, runSubruleTransfer, goSubruleTransferGroupStep, backSubruleTransferPresetStep, recognizeRegexReplacementInput, removeRegexReplacementInput, renderSubrulesToModal, startEditingRegexReplacementInput } from '.././view.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';
import { deepClone } from '../../presets/model.js';

export function bindRuleSubruleEditorEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();



    $(document).off('click', '#blai-add-subrule-btn').on('click', '#blai-add-subrule-btn', () => openSingleRuleModal(-1));

    $(document).off('change', '.blai-subrule-toggle').on('change', '.blai-subrule-toggle', function() {
        const index = Number($(this).data('index'));
        if (!Number.isInteger(index) || index < 0 || index >= rulesUiState.currentEditingSubrules.length) return;
        rulesUiState.currentEditingSubrules[index].enabled = $(this).prop('checked');
        renderSubrulesToModal();
    });

    $(document).off('click', '.blai-edit-subrule-btn').on('click', '.blai-edit-subrule-btn', function() {
        openSingleRuleModal(Number($(this).attr('data-index')));
    });

    const SUBRULE_MENU_ACTIVE_ID = 'blai-subrule-menu-active';

    const closeSubruleMenu = () => {
        const menu = document.getElementById(SUBRULE_MENU_ACTIVE_ID);
        if (!menu) return null;
        // 菜单若已是 hidden，说明是被 popover 的外部点击（mousedown 捕获）关掉的，
        // 只是残留了活动 id。此时清掉 id、当作「本来就没开」返回，
        // 否则第二次点同一个 toggle 会被当成「关闭当前菜单」吞掉，要点两次才展开。
        if (menu.hasAttribute('hidden')) {
            menu.id = '';
            return null;
        }
        const rowIndex = String(menu.dataset.rowIndex || '');
        menu.id = '';
        menu.setAttribute('hidden', '');
        closeMenuPopover(menu);
        $(document).find('.blai-subrule-menu-toggle').filter(function() {
            return String($(this).attr('data-index')) === rowIndex;
        }).attr('aria-expanded', 'false');
        return { menu, rowIndex };
    };

    $(document).off('click', '.blai-subrule-menu-toggle').on('click', '.blai-subrule-menu-toggle', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $toggle = $(this);
        const $menu = $toggle.closest('.blai-subrule-menu-wrap').find('.blai-subrule-menu');
        if (!$menu.length) return;
        const rowIndex = String($toggle.attr('data-index') || '');
        const active = closeSubruleMenu();
        if (active && active.rowIndex === rowIndex) return;
        const menu = $menu.get(0);
        menu.removeAttribute('hidden');
        menu.id = SUBRULE_MENU_ACTIVE_ID;
        menu.dataset.rowIndex = rowIndex;
        $toggle.attr('aria-expanded', 'true');
        openMenuPopover($toggle.get(0), menu);
    });

    $(document).off('click', '.blai-subrule-menu-item').on('click', '.blai-subrule-menu-item', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $item = $(this);
        const action = String($item.attr('data-subrule-action') || '');
        const index = Number($item.attr('data-index'));
        const list = rulesUiState.currentEditingSubrules;
        closeSubruleMenu();
        if (!Number.isInteger(index) || index < 0 || index >= list.length) return;

        if (action === 'up' && index > 0) {
            [list[index - 1], list[index]] = [list[index], list[index - 1]];
            renderSubrulesToModal();
        } else if (action === 'down' && index < list.length - 1) {
            [list[index], list[index + 1]] = [list[index + 1], list[index]];
            renderSubrulesToModal();
        } else if (action === 'copy') {
            list.splice(index + 1, 0, deepClone(list[index]));
            renderSubrulesToModal();
            showToast('已复制该条规则');
        } else if (action === 'transfer') {
            openSubruleTransferModal(index);
        } else if (action === 'remark') {
            const sub = list[index];
            const newRemark = await showPromptModal("📝 快捷修改规则备注：\n(若不需要备注，请直接清空并点击确定)", sub.remark || '', { okText: '确定' });
            if (newRemark !== null) {
                sub.remark = newRemark.trim();
                renderSubrulesToModal();
            }
        } else if (action === 'delete') {
            if (!await showConfirmModal('确定要删除该映射规则吗？', { danger: true, okText: '删除' })) return;
            list.splice(index, 1);
            renderSubrulesToModal();
            showToast('词条删除成功');
        }
    });

    $(document).off('click', '#blai-subrule-transfer-confirm').on('click', '#blai-subrule-transfer-confirm', () => runSubruleTransfer());

    $(document).off('click', '#blai-subrule-transfer-cancel').on('click', '#blai-subrule-transfer-cancel', () => closeSubruleTransferModal());

    $(document).off('click', '#blai-subrule-transfer-next').on('click', '#blai-subrule-transfer-next', () => goSubruleTransferGroupStep());

    $(document).off('click', '#blai-subrule-transfer-back').on('click', '#blai-subrule-transfer-back', () => backSubruleTransferPresetStep());

    $(document).off('change', '#blai-modal-sub-mode').on('change', '#blai-modal-sub-mode', function(e) {
        const mode = String($(this).val() || 'simple');
        applySubruleModeUI(mode);
        // 只在用户主动切换时记忆（排除开弹窗时的程序 trigger），新建条目时沿用。
        const settings = extension_settings[extensionName];
        if (e.originalEvent && settings && settings.subruleEditorMode !== mode) {
            settings.subruleEditorMode = mode;
            saveSettingsDebounced();
        }
    });

    $(document).off('change', '#blai-modal-sub-rewrite-mode').on('change', '#blai-modal-sub-rewrite-mode', function() {
        applySubruleRewriteModeUI();
    });

    $(document).off('input', '#blai-modal-sub-target').on('input', '#blai-modal-sub-target', () => {
        validateRegexTargetField();
        renderRegexHighlightPreview();
        runRegexTestPreview();
    });

    // 点击 / 键盘移动光标到括号左侧或右侧时，整对闭合范围加底纹。
    $(document).off('click.bracketPair keyup.bracketPair select.bracketPair', '#blai-modal-sub-target')
        .on('click.bracketPair keyup.bracketPair select.bracketPair', '#blai-modal-sub-target', syncRegexBracketPairHighlight);

    $(document).off('scroll', '#blai-modal-sub-target').on('scroll', '#blai-modal-sub-target', syncRegexHighlightScroll);

    $(document).off('scroll', '#blai-regex-test-text').on('scroll', '#blai-regex-test-text', syncRegexTestScroll);

    $(document).off('change', '#blai-regex-highlight-toggle').on('change', '#blai-regex-highlight-toggle', function() {
        const { extension_settings, saveSettingsDebounced } = getAppContext();
        const settings = extension_settings[extensionName];
        if (!settings) return;
        settings.regexHighlightEnabled = $(this).prop('checked') !== false;
        saveSettingsDebounced();
        renderRegexHighlightPreview();
    });

    $(document).off('click', '#blai-regex-test-toggle').on('click', '#blai-regex-test-toggle', function() {
        const $panel = $('#blai-regex-test-panel');
        const nextOpen = $panel.prop('hidden');
        $panel.prop('hidden', !nextOpen);
        // 计数跟着测试框走：收起时一并隐藏，展开时由 runRegexTestPreview 重新显示。
        if (!nextOpen) $('#blai-regex-test-stat').prop('hidden', true);
        $(this).attr('aria-expanded', nextOpen ? 'true' : 'false');
        $(this).toggleClass('is-open', nextOpen);
        // 记忆文本测试开关状态。
        const { extension_settings, saveSettingsDebounced } = getAppContext();
        const settings = extension_settings[extensionName];
        if (settings && settings.subruleTestPanelOpen !== nextOpen) {
            settings.subruleTestPanelOpen = nextOpen;
            saveSettingsDebounced();
        }
        if (nextOpen) {
            $('#blai-regex-test-text').trigger('focus');
            runRegexTestPreview();
        }
    });

    $(document).off('input', '#blai-regex-test-text').on('input', '#blai-regex-test-text', () => {
        runRegexTestPreview();
    });

    $(document).off('click', '#blai-modal-sub-regex-recognize').on('click', '#blai-modal-sub-regex-recognize', () => {
        const result = recognizeRegexReplacementInput();
        if (!result.ok) {
            $('#blai-modal-sub-rep').trigger('focus');
            return;
        }
    });

    $(document).off('click', '.blai-regex-replacement-chip-main').on('click', '.blai-regex-replacement-chip-main', function() {
        if (startEditingRegexReplacementInput($(this).data('index'))) {
            $('#blai-modal-sub-rep').trigger('focus');
        }
    });

    $(document).off('click', '.blai-regex-replacement-chip-remove').on('click', '.blai-regex-replacement-chip-remove', function(e) {
        e.preventDefault();
        e.stopPropagation();
        removeRegexReplacementInput($(this).data('index'));
    });
}
