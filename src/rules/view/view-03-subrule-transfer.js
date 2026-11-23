/**
 * 子规则（映射条目）的复制与跨分组 / 跨预设移动。
 * 目标分两步选：先选预设，确认后只列出该预设的分组。
 * 分组值编码为 <预设序号>::<分组序号>，写入逻辑保持不变。
 */
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty, rulesUiState } from '../state.js';
import { buildPresetEntry, deepClone, getCurrentPresetAiRewriteSettings, getPresetAiRewriteSettings, getPresetRules } from '../../presets/model.js';
import { safeHtml } from '../../ui/html.js';
import { renderSubrulesToModal } from './view-02-panels.js';
import { showToast } from '../../ui/notifications.js';
import { syncNativeSelect } from '../../ui/nativeSelectMenu.js';

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
                presetIndex,
                groupIndex,
                groupName,
                isActive,
            });
        });
    });
    return { targets, presetNames, activePreset };
}

/** 切换两步显隐，并同步标题、说明与按钮。 */
function showTransferStep(step) {
    const isPreset = step === 'preset';
    $('#blai-subrule-transfer-step-preset').prop('hidden', !isPreset);
    $('#blai-subrule-transfer-step-group').prop('hidden', isPreset);
    $('#blai-subrule-transfer-back').prop('hidden', isPreset);
    $('#blai-subrule-transfer-next').prop('hidden', !isPreset);
    $('#blai-subrule-transfer-confirm').prop('hidden', isPreset);
    $('#blai-subrule-transfer-title').text(isPreset
        ? '移动规则 · 第 1/2 步：选择预设'
        : '移动规则 · 第 2/2 步：选择分组');
}

export function openSubruleTransferModal(index) {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position >= rulesUiState.currentEditingSubrules.length) return;
    const { targets, presetNames, activePreset } = collectTransferTargets();
    if (targets.length === 0) {
        showToast('没有可用的目标分组。请先新建一个分组或预设。', 'error');
        return;
    }
    rulesUiState.currentTransferSubruleIndex = position;

    // 第一步只列有可用分组的预设；默认选当前预设，省去重复点击。
    const availableIndexes = [...new Set(targets.map(target => target.presetIndex))];
    const options = availableIndexes.map((presetIndex) => {
        const name = presetNames[presetIndex] || '未命名预设';
        const label = name === activePreset ? `${name}（当前预设）` : name;
        return `<option value="${presetIndex}">${safeHtml(label)}</option>`;
    }).join('');
    const $preset = $('#blai-subrule-transfer-preset');
    $preset.removeAttr('data-blai-select-two-level').html(options);
    const activeIndex = presetNames.indexOf(activePreset);
    $preset.val(String(availableIndexes.includes(activeIndex) ? activeIndex : availableIndexes[0]));
    syncNativeSelect($preset.get(0));

    $('#blai-subrule-transfer-hint').text('先选预设，下一步只列出该预设里的分组。');
    showTransferStep('preset');
    $('#blai-subrule-transfer-modal').css('display', 'flex');
}

/** 第一步确认后，只填当前预设的分组，避免一次性弹出所有预设的分组。 */
export function goSubruleTransferGroupStep() {
    const presetIndex = Number($('#blai-subrule-transfer-preset').val());
    const { targets, presetNames } = collectTransferTargets();
    const presetName = presetNames[presetIndex];
    const groups = targets.filter(target => target.presetIndex === presetIndex);
    if (!presetName || groups.length === 0) {
        showToast('该预设没有可用的目标分组，请换一个预设。', 'error');
        return;
    }
    const options = groups
        .map(target => `<option value="${safeHtml(target.value)}">${safeHtml(target.groupName)}</option>`)
        .join('');
    const $select = $('#blai-subrule-transfer-target');
    // 分组已限定在单个预设内，收起时仍显示「预设名 / 分组名」，与既有设计一致。
    $select.attr('data-blai-select-two-level', 'true')
        .html(`<optgroup label="${safeHtml(presetName)}">${options}</optgroup>`);
    $select.val(groups[0].value);
    syncNativeSelect($select.get(0));
    $('#blai-subrule-transfer-hint').text(`已选择预设「${presetName}」，选择要移动到的分组。`);
    showTransferStep('group');
}

/** 返回第一步重选预设。 */
export function backSubruleTransferPresetStep() {
    showTransferStep('preset');
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
        showToast('请选择目标分组。', 'error');
        return;
    }

    const isActivePreset = presetName === String(settings.activePreset || '');
    const targetRules = isActivePreset
        ? (settings.rules || [])
        : getPresetRules(settings.presets[presetName]);
    const targetRule = targetRules[groupIndex];
    if (!targetRule) {
        showToast('目标分组已不存在，请重新选择。', 'error');
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
    showToast(`已移动到「${presetName}」的「${groupLabel}」`, 'success');
}
