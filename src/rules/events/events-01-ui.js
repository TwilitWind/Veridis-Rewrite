/** 规则事件：弹窗模式切换与转移落盘。实现从原 events.js 拆出，对外仍从 events.js 的 bindRuleEvents 进入。 */
import { subruleModeUIMap, validateRegexTargetField, syncRegexAssistUi } from './events-00-shared.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '.././state.js';
import { buildPresetEntry, deepClone, getCurrentPresetAiRewriteSettings, getPresetAiRewriteSettings, getPresetRules } from '../../presets/model.js';
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
        $('#blai-modal-sub-regex-recognize').text(activeEditIndex >= 0 ? '更新替换项' : '按行识别');
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
    $('#blai-modal-sub-rep-label').text(isAiMode ? '流式临时替换 / API 参考候选' : '替换为');
    $('#blai-modal-sub-rewrite-hint').text(isAiMode
        ? '生成中只做视觉预览，生成结束后把命中片段发给配置的 AI 接口局部改写。'
        : '沿用当前本地替换逻辑，生成结束后直接写入消息数据。');
    $('#blai-modal-sub-ai-prompt-field').prop('hidden', !isAiMode);
    $('#blai-modal-sub-ai-prompt').prop('disabled', !isAiMode);
    $('#blai-modal-sub-ai-prompt-hint').text('只填写这条规则命中时的特殊处理；通用风格仍由全局提示词控制。');
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
        showToast('请选择目标存档。', 'error');
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
        getPresetAiRewriteSettings(targetEntry) || getCurrentPresetAiRewriteSettings(settings.aiRewrite)
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

