/**
 * 子规则（映射条目）的复制与跨分组 / 跨预设移动。
 * 移动目标用「预设 + 分组」两级下拉选择，值编码为 <预设序号>::<分组序号>。
 */
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '../state.js';
import { buildPresetEntry, deepClone, getCurrentPresetAiRewriteSettings, getPresetAiRewriteSettings, getPresetRules } from '../../presets/model.js';
import { safeHtml } from '../../ui/html.js';
import { renderSubrulesToModal } from './view-02-panels.js';
import { showToast } from '../../ui/notifications.js';

function collectTransferTargets() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const activePreset = String(settings.activePreset || '');
    const presetNames = Object.keys(settings.presets || {});
    const currentRules = settings.rules || [];
    const sourceGroupIndex = rulesUiState.currentEditingIndex;
    const targets = [];

    presetNames.forEach((presetName, presetIndex) => {
        const isActive = presetName === activePreset;
        const rules = isActive ? currentRules : getPresetRules(settings.presets[presetName]);
        rules.forEach((rule, groupIndex) => {
            if (isActive && groupIndex === sourceGroupIndex) return;
            const groupName = String(rule?.name || '').trim() || `未命名合集 ${groupIndex + 1}`;
            targets.push({
                value: `${presetIndex}::${groupIndex}`,
                presetName,
                groupIndex,
                groupName,
                isActive,
                isActivePreset: isActive,
            });
        });
    });
    return { targets, presetNames, activePreset };
}

export function openSubruleTransferModal(index) {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position >= rulesUiState.currentEditingSubrules.length) return;
    const { targets, presetNames } = collectTransferTargets();
    if (targets.length === 0) {
        showToast('没有可用的目标分组。请先新建一个分组或预设。');
        return;
    }
    rulesUiState.currentTransferSubruleIndex = position;
    const groups = presetNames.map((presetName) => {
        const entries = targets.filter((target) => target.presetName === presetName);
        if (entries.length === 0) return '';
        const options = entries
            .map((target) => `<option value="${safeHtml(target.value)}">${safeHtml(target.groupName)} ${target.isActive ? '（当前预设）' : ''}</option>`)
            .join('');
        return `<optgroup label="${safeHtml(presetName || '未命名预设')}">${options}</optgroup>`;
    }).join('');
    $('#blai-subrule-transfer-target').html(groups);
    $('#blai-subrule-transfer-modal').css('display', 'flex');
    const first = targets[0];
    if (first) $('#blai-subrule-transfer-target').val(first.value);
}

export function closeSubruleTransferModal() {
    rulesUiState.currentTransferSubruleIndex = -1;
    $('#blai-subrule-transfer-modal').hide();
}

export function runSubruleTransfer() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const sourceIndex = rulesUiState.currentTransferSubruleIndex;
    const subrule = rulesUiState.currentEditingSubrules[sourceIndex];
    if (!Number.isInteger(sourceIndex) || !subrule) {
        closeSubruleTransferModal();
        return;
    }
    const rawValue = String($('#blai-subrule-transfer-target').val() || '');
    const [presetIndexText, groupIndexText] = rawValue.split('::');
    const presetName = Object.keys(settings.presets || {})[Number(presetIndexText)];
    const groupIndex = Number(groupIndexText);
    if (!presetName || !Number.isInteger(groupIndex) || groupIndex < 0) {
        showToast('请选择目标分组。');
        return;
    }

    const isActivePreset = presetName === String(settings.activePreset || '');
    const targetRules = isActivePreset
        ? (settings.rules || [])
        : getPresetRules(settings.presets[presetName]);
    const targetRule = targetRules[groupIndex];
    if (!targetRule) {
        showToast('目标分组已不存在，请重新选择。');
        return;
    }
    const moved = deepClone(subrule);
    targetRule.subRules = Array.isArray(targetRule.subRules) ? targetRule.subRules : [];
    targetRule.subRules.push(moved);

    if (!isActivePreset) {
        const entry = settings.presets[presetName];
        settings.presets[presetName] = buildPresetEntry(
            targetRules,
            getPresetAiRewriteSettings(entry) || getCurrentPresetAiRewriteSettings(settings.aiRewrite)
        );
    }

    rulesUiState.currentEditingSubrules.splice(sourceIndex, 1);
    renderSubrulesToModal();
    markRulesDataDirty();
    saveSettingsDebounced();
    closeSubruleTransferModal();
    const groupLabel = String(targetRule.name || '').trim() || `未命名合集 ${groupIndex + 1}`;
    showToast(`已移动到「${presetName}」的「${groupLabel}」`);
}
