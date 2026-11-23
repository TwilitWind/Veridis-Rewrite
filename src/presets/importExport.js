/**
 * 预设的导出与导入流程：导出载荷构造、导入规则规范化、导入选择弹窗，
 * 以及「只导入 / 导入并切换 / 临时预览」三种落盘方式。
 * 从 events.js 拆出，events.js 负责切换、绑定与工具栏操作。
 */
import { defaultAiRewriteSettings, extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { markRulesDataDirty } from '../rules/state.js';
import { focusOnFinePointer } from '../ui/popover.js';
import { presetsRuntimeState, markPresetsUiDirty } from './state.js';
import { deepClone, buildPresetEntry, getCurrentPresetAiRewriteSettings, normalizePresetAiRewriteSettings } from './model.js';
import { normalizeRuleActivationSafety } from '../rules/model.js';
import { hasActivePresetUnsavedChanges } from './application.js';
import { syncPresetAiRewriteGenerationSettingsUI, updateToolbarUI } from './view.js';
import { renderTags } from '../rules/view.js';
import { showAlertModal, showConfirmModal, showToast } from '../ui/notifications.js';

export function buildCurrentPresetEntry(rules) {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    return buildPresetEntry(rules, getCurrentPresetAiRewriteSettings(settings.aiRewrite));
}

function extractPresetImportAiRewriteSettings(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const direct = normalizePresetAiRewriteSettings(payload.aiRewrite);
    if (direct) return direct;
    if ('__content__' in payload) return extractPresetImportAiRewriteSettings(payload.__content__);
    if ('content' in payload) return extractPresetImportAiRewriteSettings(payload.content);
    return null;
}

function normalizeImportedRuleList(rules) {
    return (Array.isArray(rules) ? rules : []).map((rule, idx) => {
        const next = normalizeRuleActivationSafety(deepClone(rule || {}), { resetRiskyEnabled: true });
        stripAiConnectionFields(next);
        if (!next.name) next.name = next.targets?.[0] || `未命名合集 ${idx + 1}`;
        if (next.targets) {
            next.subRules = [{
                targets: next.targets,
                replacements: next.replacements || [],
                mode: 'text',
                enabled: true,
            }];
            delete next.targets;
            delete next.replacements;
        }
        if (!Array.isArray(next.subRules)) next.subRules = [];
        next.subRules = next.subRules.map((sub) => {
            const normalizedSub = deepClone(sub || {});
            if (!normalizedSub.mode) normalizedSub.mode = 'text';
            if (!['program', 'ai'].includes(normalizedSub.rewriteMode)) normalizedSub.rewriteMode = 'program';
            if (normalizedSub.enabled === undefined) normalizedSub.enabled = true;
            if (!Array.isArray(normalizedSub.targets)) normalizedSub.targets = [];
            if (!Array.isArray(normalizedSub.replacements)) normalizedSub.replacements = [];
            normalizedSub.aiPromptTemplate = String(normalizedSub.aiPromptTemplate || '');
            return normalizedSub;
        });
        return next;
    });
}

function stripAiConnectionFields(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        value.forEach(stripAiConnectionFields);
        return value;
    }
    delete value.baseUrl;
    delete value.apiKey;
    delete value.model;
    delete value.modelOptions;
    Object.values(value).forEach(stripAiConnectionFields);
    return value;
}

function buildPresetExportRules(rules) {
    return stripAiConnectionFields(deepClone(Array.isArray(rules) ? rules : []));
}

export function buildPresetExportPayload(settings) {
    return {
        type: 'veridis-rewrite-preset',
        version: 2,
        ...buildPresetEntry(buildPresetExportRules(settings.rules), getCurrentPresetAiRewriteSettings(settings.aiRewrite)),
    };
}

function makeUniquePresetName(baseName) {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const base = String(baseName || '').trim() || '导入预设';
    if (!settings.presets?.[base]) return base;
    let counter = 2;
    while (settings.presets?.[`${base} (${counter})`]) counter++;
    return `${base} (${counter})`;
}

function getImportPresetName() {
    return String($('#blai-import-preset-name').val() || '').trim();
}

export function closeImportChoiceModal() {
    presetsRuntimeState.importPresetDraft = null;
    $('#blai-preset-import-choice-modal')
        .removeClass('blai-is-open')
        .attr('aria-hidden', 'true')
        .hide();
}

async function openImportChoiceModal(rules, defaultName, aiRewriteSettings = null) {
    const normalizedRules = normalizeImportedRuleList(rules);
    if (normalizedRules.length === 0) {
        await showAlertModal('导入失败：未发现有效规则。');
        return;
    }
    const presetName = makeUniquePresetName(defaultName);
    presetsRuntimeState.importPresetDraft = {
        rules: normalizedRules,
        defaultName: presetName,
        aiRewrite: normalizePresetAiRewriteSettings(aiRewriteSettings),
    };
    $('#blai-import-preset-name').val(presetName);
    const aiSummary = presetsRuntimeState.importPresetDraft.aiRewrite ? '，包含 AI 生成限制' : '';
    $('#blai-import-choice-summary').text(`已读取 ${normalizedRules.length} 个规则分组${aiSummary}。只导入不会修改当前规则；切换使用和临时预览会替换当前规则并重新净化。`);
    const $modal = $('#blai-preset-import-choice-modal');
    $modal.detach().appendTo(document.body);
    $modal
        .attr('aria-hidden', 'false')
        .addClass('blai-is-open')
        .css('display', 'flex');
    // iOS 浏览器有时需要在文件选择器返回后做一次布局。
    $modal[0]?.getBoundingClientRect();
    window.setTimeout(() => {
        focusOnFinePointer($('#blai-import-preset-name'));
        if (!window.matchMedia?.('(max-width: 600px), (pointer: coarse)').matches) {
            $('#blai-import-preset-name').trigger('select');
        }
    }, 50);
}

async function confirmBeforeImportChoiceIfUnsaved() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const active = settings.activePreset;
    if (!active || !hasActivePresetUnsavedChanges()) return true;
    return showConfirmModal(`当前预设 "${active}" 有未保存的改动。\n\n仅导入不会修改当前规则；导入并切换或临时预览会在执行前再次确认保存。\n\n是否继续选择导入方式？`, { okText: '继续' });
}

async function validateImportPresetName() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const name = getImportPresetName();
    if (!name) {
        await showAlertModal('请填写预设名称。');
        $('#blai-import-preset-name').trigger('focus');
        return '';
    }
    if (settings.presets?.[name]) {
        await showAlertModal('存档名称已存在，请换一个名称。');
        $('#blai-import-preset-name').trigger('focus').trigger('select');
        return '';
    }
    return name;
}

async function confirmUnsavedBeforeReplacingCurrentRules(actionLabel) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const active = settings.activePreset;
    if (!active || !hasActivePresetUnsavedChanges()) return true;
    const shouldSave = await showConfirmModal(`当前预设 "${active}" 有未保存的改动。\n\n点击“确定”先保存并继续${actionLabel}。\n点击“取消”将取消本次导入操作。`, { okText: '保存并继续' });
    if (!shouldSave) return false;
    settings.presets[active] = buildCurrentPresetEntry(settings.rules || []);
    saveSettingsDebounced();
    markPresetsUiDirty(true);
    return true;
}

function getImportDraftRules() {
    const draft = presetsRuntimeState.importPresetDraft;
    return Array.isArray(draft?.rules) ? deepClone(draft.rules) : null;
}

function getImportDraftAiRewriteSettings() {
    return normalizePresetAiRewriteSettings(presetsRuntimeState.importPresetDraft?.aiRewrite);
}

function applyImportDraftAiRewriteSettings() {
    const aiRewriteSettings = getImportDraftAiRewriteSettings();
    if (!aiRewriteSettings) return false;
    const { extension_settings } = getAppContext();
    const currentSettings = extension_settings[extensionName];
    currentSettings.aiRewrite = {
        ...defaultAiRewriteSettings,
        ...(currentSettings.aiRewrite && typeof currentSettings.aiRewrite === 'object' ? currentSettings.aiRewrite : {}),
        ...aiRewriteSettings,
    };
    syncPresetAiRewriteGenerationSettingsUI(currentSettings);
    return true;
}

export async function importPresetOnly() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const rules = getImportDraftRules();
    if (!rules) return;
    const name = await validateImportPresetName();
    if (!name) return;

    settings.presets[name] = buildPresetEntry(rules, getImportDraftAiRewriteSettings());
    markPresetsUiDirty(true);
    saveSettingsDebounced();
    updateToolbarUI();
    closeImportChoiceModal();
    showToast(`已导入预设：${name}`, 'success');
}

export async function importPresetAndSwitch() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const rules = getImportDraftRules();
    if (!rules) return;
    const name = await validateImportPresetName();
    if (!name) return;
    if (!await confirmUnsavedBeforeReplacingCurrentRules('并切换使用导入预设')) return;

    settings.presets[name] = buildPresetEntry(rules, getImportDraftAiRewriteSettings());
    settings.activePreset = name;
    settings.rules = deepClone(rules);
    applyImportDraftAiRewriteSettings();
    markRulesDataDirty({ presetsUi: true });
    saveSettingsDebounced();
    updateToolbarUI();
    renderTags();
    closeImportChoiceModal();
    showToast(`已导入并切换：${name}`, 'success');
}

export async function importPresetAsTemporaryPreview() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];
    const rules = getImportDraftRules();
    if (!rules) return;
    if (!await showConfirmModal('仅临时预览会立刻替换当前规则，但不会保存为预设。\n确定继续吗？', { okText: '继续' })) return;
    if (!await confirmUnsavedBeforeReplacingCurrentRules('并进入临时预览')) return;

    settings.rules = rules;
    settings.activePreset = '';
    applyImportDraftAiRewriteSettings();
    markRulesDataDirty();
    saveSettingsDebounced();
    updateToolbarUI();
    renderTags();
    closeImportChoiceModal();
}

export async function preparePresetImportChoice(importedPayload, importedRules, defaultName) {
    const importedAiRewriteSettings = extractPresetImportAiRewriteSettings(importedPayload);
    if (!await confirmBeforeImportChoiceIfUnsaved()) return false;
    await openImportChoiceModal(importedRules, defaultName, importedAiRewriteSettings);
    return true;
}
