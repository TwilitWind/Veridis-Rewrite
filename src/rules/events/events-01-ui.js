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
    $('#blai-modal-sub-ai-prompt-field').prop('hidden', !isAiMode);
    $('#blai-modal-sub-ai-prompt').prop('disabled', !isAiMode);
    $('#blai-modal-sub-ai-prompt-hint').text('只填写这条规则命中时的特殊处理；通用风格仍由全局提示词控制。');

    // 分段按钮只做视觉态；真实值仍在隐藏 select 上，业务读写路径保持不变。
    const segment = document.getElementById('blai-modal-sub-rewrite-mode-segment');
    segment?.querySelectorAll('.blai-subrule-rewrite-option').forEach((button) => {
        const active = button.getAttribute('data-value') === rewriteMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        // 内联一次：手机端主题里若有更高优先级规则，样式表里的 .is-active 会被压掉，
        // 表现为「选了 AI 改写，蓝底白字却一起消失」。内联色值跟着主题令牌走，不写死颜色。
        button.style.setProperty('background-color', active ? 'var(--accent-color)' : 'transparent');
        button.style.setProperty('color', active ? 'var(--accent-contrast)' : 'var(--text-secondary)');
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

