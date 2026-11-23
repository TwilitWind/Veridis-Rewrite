/** 规则事件：modalAction。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { isSearchGroupEditFlow, isSearchDirectSubruleFlow, isRelatedDirectSubruleFlow, saveCurrentEditingRule, formatRegexTargetError, clearRegexTargetValidationState, validateRegexTargetField, clearRegexTestArea } from './events-00-shared.js';
import { runRuleTransfer } from './events-01-ui.js';
import { refreshDiffViewer } from '../../diff/state.js';
import { rulesUiState, hasUnsavedEditGroupChanges, clearEditGroupBaseline } from '.././state.js';
import { parseInputToWords } from '.././model.js';
import { showToast, showUnsavedChangesModal } from '../../ui/notifications.js';
import { clearRuleSearchEditFlow, closeTransferModal, getSingleRuleReplacementValues, hasPendingRegexReplacementInput, openRuleSearchModal, renderSubrulesToModal } from '.././view.js';

export function bindRuleModalActionEvents() {


    $(document).off('click', '#blai-modal-sub-save').on('click', '#blai-modal-sub-save', function() {
        const mode = String($('#blai-modal-sub-mode').val() || 'simple');
        const rewriteMode = $('#blai-modal-sub-rewrite-mode').val() === 'ai' ? 'ai' : 'program';
        const tStr = String($('#blai-modal-sub-target').val() || '');
        const remarkStr = String($('#blai-modal-sub-remark').val() || '').trim();
        const aiPromptTemplate = String($('#blai-modal-sub-ai-prompt').val() || '').trim();
        const isDirectSearchFlow = isSearchDirectSubruleFlow();
        const isRelatedFlow = isRelatedDirectSubruleFlow();

        if (mode === 'regex') {
            const validation = validateRegexTargetField();
            if (!validation.ok) {
                showToast(`正则规则有误：${validation.uiMessage || formatRegexTargetError(validation.error)}`, 'error');
                $('#blai-modal-sub-target').trigger('focus');
                return;
            }
        } else {
            clearRegexTargetValidationState();
        }

        if (mode === 'regex' && hasPendingRegexReplacementInput()) {
            showToast('替换框里还有未处理的内容，请先点右侧按钮。', 'error');
            $('#blai-modal-sub-rep').trigger('focus');
            return;
        }

        const targets = parseInputToWords(tStr, mode, { isTarget: true });
        const replacements = getSingleRuleReplacementValues(mode);

        if (targets.length === 0) {
            showToast("查找内容不能为空！", 'error');
            $('#blai-modal-sub-target').trigger('focus');
            return;
        }

        const previousSubRule = rulesUiState.currentSubruleEditIndex >= 0
            ? rulesUiState.currentEditingSubrules[rulesUiState.currentSubruleEditIndex]
            : null;
        const subRule = {
            targets,
            replacements,
            mode,
            rewriteMode,
            remark: remarkStr,
            aiPromptTemplate: rewriteMode === 'ai' ? aiPromptTemplate : '',
            enabled: previousSubRule?.enabled !== false,
        };

        if (rulesUiState.currentSubruleEditIndex === -1) {
            rulesUiState.currentEditingSubrules.push(subRule);
        } else {
            rulesUiState.currentEditingSubrules[rulesUiState.currentSubruleEditIndex] = subRule;
        }

        clearRegexTargetValidationState();
        clearRegexTestArea();
        if (isDirectSearchFlow || isRelatedFlow) {
            const saveResult = saveCurrentEditingRule({ toastMessage: '条目保存成功', focusLatest: false });
            if (!saveResult.ok) return;
            $('#blai-subrule-edit-modal').fadeOut(150, () => {
                $('#blai-rule-edit-modal').hide();
                clearRuleSearchEditFlow();
                if (isDirectSearchFlow) openRuleSearchModal();
                else if (isRelatedFlow) refreshDiffViewer();
            });
            return;
        }

        $('#blai-subrule-edit-modal').fadeOut(150);
        renderSubrulesToModal();

        if (rulesUiState.currentSubruleEditIndex === -1) {
            const container = $('#blai-edit-subrules-container');
            container.scrollTop(container[0].scrollHeight);
        }
    });

    $(document).off('click', '#blai-modal-sub-cancel').on('click', '#blai-modal-sub-cancel', () => {
        clearRegexTargetValidationState();
        clearRegexTestArea();
        if (isSearchDirectSubruleFlow() || isRelatedDirectSubruleFlow()) {
            const shouldReturnSearch = isSearchDirectSubruleFlow();
            $('#blai-subrule-edit-modal').fadeOut(150, () => {
                $('#blai-rule-edit-modal').hide();
                clearRuleSearchEditFlow();
                if (shouldReturnSearch) openRuleSearchModal();
            });
            return;
        }
        $('#blai-subrule-edit-modal').fadeOut(150);
    });

    const closeEditGroupModal = () => {
        $('#blai-rule-edit-modal').hide();
        clearEditGroupBaseline();
        if (isSearchGroupEditFlow()) {
            clearRuleSearchEditFlow();
            openRuleSearchModal();
        }
    };

    $(document).off('click', '#blai-edit-cancel-x').on('click', '#blai-edit-cancel-x', async () => {
        if (hasUnsavedEditGroupChanges()) {
            const choice = await showUnsavedChangesModal();
            if (choice === 'cancel') return; // 继续编辑
            if (choice === 'save') {
                const saveResult = saveCurrentEditingRule({ toastMessage: '合集保存成功', focusLatest: true });
                if (!saveResult.ok) return; // 校验未通过，留在弹窗里改
            }
            // discard：直接关闭，不写回设置
        }
        closeEditGroupModal();
    });
    $(document).off('click', '#blai-transfer-cancel').on('click', '#blai-transfer-cancel', () => closeTransferModal());
    $(document).off('click', '#blai-transfer-copy').on('click', '#blai-transfer-copy', () => runRuleTransfer(false));
    $(document).off('click', '#blai-transfer-move').on('click', '#blai-transfer-move', () => runRuleTransfer(true));
    $(document).off('click', '#blai-rule-transfer-modal').on('click', '#blai-rule-transfer-modal', function(e) {
        if (e.target && e.target.id === 'blai-rule-transfer-modal') closeTransferModal();
    });

    $(document).off('click', '#blai-edit-save').on('click', '#blai-edit-save', () => {
        const saveResult = saveCurrentEditingRule({ toastMessage: '合集保存成功', focusLatest: true });
        if (!saveResult.ok) return;
        clearEditGroupBaseline();
        $('#blai-rule-edit-modal').hide();
        if (isSearchGroupEditFlow()) {
            clearRuleSearchEditFlow();
            openRuleSearchModal();
        }
    });
}
