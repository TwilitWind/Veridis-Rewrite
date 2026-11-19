/**
 * 负责把选定/生效的预设应用到权威的 Veridis 设置，
 * 包括规则/AI 生成快照的应用与持久化。它不负责
 * 预设事件注册。
 */
import { defaultAiRewriteSettings, extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { markRulesDataDirty } from '../rules/state.js';
import { presetsRuntimeState } from './state.js';
import { logger } from '../log.js';
import { getCurrentCharacterContext, getCurrentChatCompletionPresetName } from '../host/context.js';
import { deepClone } from './model.js';
import { renderTags } from '../rules/view.js';
import { buildPresetEntry, getCurrentPresetAiRewriteSettings, getPresetAiRewriteSettings, getPresetRules } from './model.js';
import { showToast } from '../ui/notifications.js';
import { getPresetForCharacter } from './bindings.js';
import { refreshCharacterBindingUI, syncPresetAiRewriteGenerationSettingsUI, updateToolbarUI } from './view.js';

function normalizeRulesForPresetComparison(rules) {
    return (Array.isArray(rules) ? rules : []).map((rule) => {
        const normalized = deepClone(rule || {});
        return normalized;
    });
}

function hasPresetContentChanges(currentRules, savedPresetEntry, currentAiRewrite) {
    const rulesChanged = JSON.stringify(normalizeRulesForPresetComparison(currentRules))
        !== JSON.stringify(normalizeRulesForPresetComparison(getPresetRules(savedPresetEntry)));
    if (rulesChanged) return true;

    const savedAiRewrite = getPresetAiRewriteSettings(savedPresetEntry);
    if (!savedAiRewrite) return false;
    return JSON.stringify(getCurrentPresetAiRewriteSettings(currentAiRewrite)) !== JSON.stringify(savedAiRewrite);
}

export function hasActivePresetUnsavedChanges() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const active = settings.activePreset;
    if (!active) return false;
    return hasPresetContentChanges(settings.rules || [], settings.presets[active] || [], settings.aiRewrite);
}

function applyPresetAiRewriteSettings(settings, presetEntry) {
    const presetAiRewrite = getPresetAiRewriteSettings(presetEntry);
    if (!presetAiRewrite) return;
    settings.aiRewrite = {
        ...defaultAiRewriteSettings,
        ...(settings.aiRewrite && typeof settings.aiRewrite === 'object' ? settings.aiRewrite : {}),
        ...presetAiRewrite,
    };
    syncPresetAiRewriteGenerationSettingsUI(settings);
}

// 顶栏保存按钮已移除；关闭/切换等场景需要写回当前预设时统一走这里。
export function saveActivePresetSnapshot(options = {}) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const active = String(settings.activePreset || '');
    if (!active) {
        if (options.toast !== false) showToast('当前为临时规则，请点击“新建”保存为新存档。');
        return false;
    }
    settings.presets[active] = buildPresetEntry(settings.rules || [], getCurrentPresetAiRewriteSettings(settings.aiRewrite));
    saveSettingsDebounced();
    markRulesDataDirty({ rulesUi: false });
    if (options.toast !== false) showToast('保存成功');
    return true;
}

export function applyPresetByName(name, options = {}) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const presetName = String(name || '');
    const presetExists = !!(presetName && settings.presets?.[presetName]);
    const presetEntry = presetExists ? settings.presets[presetName] : null;
    settings.activePreset = presetExists ? presetName : '';
    settings.rules = presetExists ? deepClone(getPresetRules(presetEntry)) : [];
    if (presetExists) applyPresetAiRewriteSettings(settings, presetEntry);
    markRulesDataDirty();
    saveSettingsDebounced();
    logger.info(`切换预设: ${presetName || '(临时规则)'}, 存在=${presetExists}`);
    if (!options.skipRender) {
        updateToolbarUI();
        renderTags();
    }
}

export function applyCharacterPresetBinding(force = false) {
    const { extension_settings } = getAppContext();
    const context = getCurrentCharacterContext();
    const chatCompletionPresetName = getCurrentChatCompletionPresetName();
    const bindingSignature = `${context.key || ''}\n${chatCompletionPresetName || ''}`;
    const bindingContextChanged = bindingSignature !== presetsRuntimeState.lastPresetBindingSignature;
    if (!force && !bindingContextChanged) return;
    presetsRuntimeState.lastPresetBindingSignature = bindingSignature;

    const presetName = getPresetForCharacter(context.key, { chatCompletionPresetName });
    if (presetName && presetName !== extension_settings[extensionName].activePreset) {
        applyPresetByName(presetName, { skipRender: true });
    }
    refreshCharacterBindingUI();
}
