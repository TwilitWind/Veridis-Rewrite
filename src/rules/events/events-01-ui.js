/** 规则事件：弹窗模式切换与转移落盘。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { subruleModeUIMap, validateRegexTargetField, syncRegexAssistUi } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '.././state.js';
import { buildPresetEntry, deepClone, getActivePresetAiSettings, getPresetAiRewriteSettings, getPresetRules } from '../../presets/model.js';
import { showToast } from '../../ui/notifications.js';
import { closeTransferModal, getSingleRuleReplacementValues, renderTags, setSingleRuleReplacementEditor } from '.././view.js';

export function applySubruleModeUI(rawMode) {
    const mode = subruleModeUIMap[rawMode] ? rawMode : 'simple';
    const config = subruleModeUIMap[mode];
    const previousMode = String($('#blai-modal-sub-mode').data('current-mode') || '');
    if (previousMode && previousMode !== mode) {
        const previousReplacements = getSingleRuleReplacementValues(previousMode);
        setSingleRuleReplacementEditor(mode, previousReplacements);
    }
    $('#blai-modal-sub-mode').data('current-mode', mode);
    $('#blai-modal-sub-target').attr('placeholder', config.targetPlaceholder);
    $('#blai-modal-sub-rep').attr('placeholder', config.replacementPlaceholder);
    if (mode === 'regex') {
        $('#blai-modal-sub-rep')
            .data('regex-default-placeholder', config.replacementPlaceholder)
            .data('regex-edit-placeholder', config.regexEditPlaceholder || config.replacementPlaceholder);
        const activeEditIndex = Number($('#blai-modal-sub-rep').data('regex-edit-index'));
        $('#blai-modal-sub-regex-recognize').text(activeEditIndex >= 0 ? '更新替换项' : '识别为替换项');
        $('#blai-modal-sub-rep').attr('placeholder', activeEditIndex >= 0
            ? (config.regexEditPlaceholder || config.replacementPlaceholder)
            : config.replacementPlaceholder);
    } else {
        $('#blai-modal-sub-rep')
            .removeData('regex-default-placeholder')
            .removeData('regex-edit-placeholder');
    }
    $('#blai-modal-sub-mode-hint').text(config.hint);
    validateRegexTargetField();
    syncRegexAssistUi();
}

export function applySubruleRewriteModeUI() {
    const rewriteMode = $('#blai-modal-sub-rewrite-mode').val() === 'ai' ? 'ai' : 'program';
    const isAiMode = rewriteMode === 'ai';
    $('#blai-modal-sub-rep-label')
        .text(isAiMode ? 'AI 参考替换（可选）' : '替换为')
        .attr('title', isAiMode ? '用于流式预览，并作为 API 改写时的参考候选。' : '');
    $('#blai-modal-sub-ai-prompt-field').prop('hidden', !isAiMode);
    $('#blai-modal-sub-ai-prompt').prop('disabled', !isAiMode);
    $('#blai-modal-sub-ai-prompt-hint').text('只写这条规则的特殊要求；整体风格仍由全局提示词决定。');

    // 分段按钮只做视觉态；真实值仍在隐藏 select 上，业务读写路径保持不变。
    // 选中底色由 .is-active 一处定义；手机端粘滞 :hover 不抹选中态的例外在 99-mobile.css。
    const segment = document.getElementById('blai-modal-sub-rewrite-mode-segment');
    // 指示块位置由单一数据源（隐藏 select）推导，视图只读这个变量做局部滑动。
    segment?.style.setProperty('--blai-segment-index', isAiMode ? '1' : '0');
    segment?.querySelectorAll('.blai-subrule-rewrite-option').forEach((button) => {
        const active = button.getAttribute('data-value') === rewriteMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

export function runRuleTransfer(isMove) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const targetPreset = String($('#blai-transfer-target').val() || '');
    const sourcePreset = String(settings.activePreset || '');
    const transferIndexes = rulesUiState.currentTransferRuleIndexes;
    const validIndexes = transferIndexes
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0);
    if (validIndexes.length === 0) return;
    if (!targetPreset) {
        showToast('请选择目标预设', undefined, 'error');
        return;
    }
    if (targetPreset === sourcePreset) {
        closeTransferModal();
        return;
    }

    const sourceRules = settings.rules || [];
    const uniqueIndexes = [...new Set(validIndexes)].sort((a, b) => a - b).filter((idx) => idx < sourceRules.length);
    if (uniqueIndexes.length === 0) {
        closeTransferModal();
        return;
    }

    const targetEntry = settings.presets[targetPreset];
    const targetRules = deepClone(getPresetRules(targetEntry));
    const movingRules = uniqueIndexes.map((idx) => sourceRules[idx]).filter(Boolean);
    movingRules.forEach((rule) => targetRules.push(deepClone(rule)));
    settings.presets[targetPreset] = buildPresetEntry(
        targetRules,
        getPresetAiRewriteSettings(targetEntry) || getActivePresetAiSettings(settings.aiRewrite)
    );
    if (isMove) {
        for (let i = uniqueIndexes.length - 1; i >= 0; i--) {
            sourceRules.splice(uniqueIndexes[i], 1);
        }
        rulesUiState.batchSelectedRuleIds = [];
        markRulesDataDirty();
    }

    closeTransferModal();
    saveSettingsDebounced();
    if (isMove) renderTags();
}

