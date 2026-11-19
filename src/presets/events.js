/**
 * 负责预设的切换、绑定、重命名/删除/新建，以及Toolbar事件绑定。
 * 导入/导出流程已拆到 ./importExport.js。
 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { markRulesDataDirty } from '../rules/state.js';
import { presetsRuntimeState, markPresetsUiDirty } from './state.js';
import { normalizeImportedRulesPayload } from './model.js';
import { applyPresetByName, hasActivePresetUnsavedChanges } from './application.js';
import { refreshCharacterBindingUI, renderBindingHistory, updateToolbarUI } from './view.js';
import { renderTags } from '../rules/view.js';
import { showAlertModal, showConfirmModal, showPromptModal, showToast } from '../ui/notifications.js';
import { getCurrentCharacterContext, getCurrentChatCompletionPresetName } from '../host/context.js';
import { getPresetBindingUsage } from './bindings.js';
import { bindPresetSelectMenu } from './presetSelectMenu.js';
import {
    buildCurrentPresetEntry,
    buildPresetExportPayload,
    closeImportChoiceModal,
    importPresetOnly,
    importPresetAndSwitch,
    importPresetAsTemporaryPreview,
    preparePresetImportChoice,
} from './importExport.js';

export function bindPresetEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();

    // 切换规则集的共用逻辑：原生 select 的 change 与自绘菜单的点击都走这里。
    const switchPreset = async (newPreset) => {
        const settings = extension_settings[extensionName];
        const oldPreset = settings.activePreset;

        if (oldPreset && newPreset !== oldPreset && hasActivePresetUnsavedChanges()) {
            if (await showConfirmModal(`预设 "${oldPreset}" 有未保存的规则或 AI 生成限制改动，是否在切换前保存？\n点击【确定】保存，点击【取消】放弃改动。`, { okText: '保存' })) {
                settings.presets[oldPreset] = buildCurrentPresetEntry(settings.rules);
                saveSettingsDebounced();
            }
        }

        applyPresetByName(newPreset, { skipRender: true });
        $('#blai-preset-select, #blai-tools-preset-select').val(newPreset);
        renderTags();
        refreshCharacterBindingUI();
    };

    $(document).off('change', '#blai-preset-select, #blai-tools-preset-select').on('change', '#blai-preset-select, #blai-tools-preset-select', async function() {
        await switchPreset($(this).val());
    });

    // 自绘规则集下拉：浮层开合与选项切换（切换逻辑复用上面的 switchPreset）。
    bindPresetSelectMenu(switchPreset);

    $(document).off('click', '#blai-default-toggle').on('click', '#blai-default-toggle', function() {
        const settings = extension_settings[extensionName];
        const activePreset = String(settings.activePreset || '');
        if (!activePreset) { refreshCharacterBindingUI(); return; }
        const isDefaultActive = settings.defaultPreset === activePreset;
        settings.defaultPreset = isDefaultActive ? '' : activePreset;
        saveSettingsDebounced();
        refreshCharacterBindingUI();
    });

    const togglePresetBinding = async (bindingType) => {
        const settings = extension_settings[extensionName];
        const activePreset = String(settings.activePreset || '');
        const context = getCurrentCharacterContext();
        const chatCompletionPresetName = getCurrentChatCompletionPresetName();
        const activeUsage = getPresetBindingUsage(activePreset);

        if (!activePreset) { await showAlertModal('当前为临时规则，请先新建或选择一个存档预设。'); refreshCharacterBindingUI(); return; }

        if (bindingType === 'character') {
            if (!context.key) { await showAlertModal('当前没有打开角色卡，无法绑定到角色。'); refreshCharacterBindingUI(); return; }
            if (!settings.characterBindings || typeof settings.characterBindings !== 'object') settings.characterBindings = {};
            const isBound = settings.characterBindings[context.key] === activePreset;
            if (isBound) {
                delete settings.characterBindings[context.key];
            } else {
                if (activeUsage.hasChatCompletionPresetBindings && !await showConfirmModal('同一预设不能同时绑定到角色卡与对话补全预设。是否取消原绑定并切换？', { okText: '切换' })) {
                    refreshCharacterBindingUI();
                    return;
                }
                Object.keys(settings.chatCompletionPresetBindings || {}).forEach((name) => {
                    if (settings.chatCompletionPresetBindings[name] === activePreset) delete settings.chatCompletionPresetBindings[name];
                });
                settings.characterBindings[context.key] = activePreset;
            }
            presetsRuntimeState.lastPresetBindingSignature = '';
            saveSettingsDebounced();
            refreshCharacterBindingUI();
            showToast(isBound ? '已解除角色卡绑定' : '已绑定到当前角色卡');
            return;
        }

        if (bindingType === 'chatPreset') {
            if (!chatCompletionPresetName) { await showAlertModal('当前没有选择对话补全预设，无法绑定。'); refreshCharacterBindingUI(); return; }
            if (!settings.chatCompletionPresetBindings || typeof settings.chatCompletionPresetBindings !== 'object') settings.chatCompletionPresetBindings = {};
            const isBound = settings.chatCompletionPresetBindings[chatCompletionPresetName] === activePreset;
            if (isBound) {
                delete settings.chatCompletionPresetBindings[chatCompletionPresetName];
            } else {
                if (activeUsage.hasCharacterBindings && !await showConfirmModal('同一预设不能同时绑定到角色卡与对话补全预设。是否取消原绑定并切换？', { okText: '切换' })) {
                    refreshCharacterBindingUI();
                    return;
                }
                Object.keys(settings.characterBindings || {}).forEach((key) => {
                    if (settings.characterBindings[key] === activePreset) delete settings.characterBindings[key];
                });
                settings.chatCompletionPresetBindings[chatCompletionPresetName] = activePreset;
            }
            presetsRuntimeState.lastPresetBindingSignature = '';
            saveSettingsDebounced();
            refreshCharacterBindingUI();
            showToast(isBound ? '已解除对话补全预设绑定' : '已绑定到当前对话补全预设');
        }
    };

    const CHARACTER_BIND_PROXY = '#blai-purifier-popup [data-blai-click-proxy="#blai-bind-current-character"]';
    const CHAT_BIND_PROXY = '#blai-purifier-popup [data-blai-click-proxy="#blai-bind-current-chat-preset"]';

    $(document).off('click', CHARACTER_BIND_PROXY).on('click', CHARACTER_BIND_PROXY, function(e) {
        e.preventDefault();
        if ($(this).hasClass('is-disabled')) return;
        void togglePresetBinding('character');
    });

    $(document).off('click', CHAT_BIND_PROXY).on('click', CHAT_BIND_PROXY, function(e) {
        e.preventDefault();
        if ($(this).hasClass('is-disabled')) return;
        void togglePresetBinding('chatPreset');
    });

    $(document).off('click', '#blai-tools-binding-history-open').on('click', '#blai-tools-binding-history-open', function(e) {
        e.preventDefault();
        renderBindingHistory();
        $('#blai-binding-history-modal').addClass('blai-is-open').attr('aria-hidden', 'false');
    });

    $(document).off('click', '#blai-binding-history-close, #blai-binding-history-done').on('click', '#blai-binding-history-close, #blai-binding-history-done', function(e) {
        e.preventDefault();
        $('#blai-binding-history-modal').removeClass('blai-is-open').attr('aria-hidden', 'true');
    });

    $(document).off('click', '#blai-preset-rename').on('click', '#blai-preset-rename', async function() {
        const settings = extension_settings[extensionName];
        const oldName = settings.activePreset;
        if (!oldName) { await showAlertModal('当前为临时规则，请先新建存档。'); return; }
        const newName = await showPromptModal('输入新存档名称：', oldName, { okText: '重命名' });
        if (!newName || newName === oldName) return;
        if (settings.presets[newName]) { await showAlertModal('存档名称已存在。'); return; }
        settings.presets[newName] = settings.presets[oldName];
        delete settings.presets[oldName];
        if (settings.defaultPreset === oldName) settings.defaultPreset = newName;
        Object.keys(settings.characterBindings || {}).forEach((key) => {
            if (settings.characterBindings[key] === oldName) settings.characterBindings[key] = newName;
        });
        Object.keys(settings.chatCompletionPresetBindings || {}).forEach((name) => {
            if (settings.chatCompletionPresetBindings[name] === oldName) settings.chatCompletionPresetBindings[name] = newName;
        });
        settings.activePreset = newName;
        markPresetsUiDirty(true);
        saveSettingsDebounced();
        updateToolbarUI();
        showToast(`已重命名为：${newName}`);
    });

    $(document).off('click', '#blai-preset-delete').on('click', '#blai-preset-delete', async function() {
        const settings = extension_settings[extensionName];
        const name = settings.activePreset;
        if (!name) { showToast('当前为临时规则，没有可删除的存档'); return; }
        if (await showConfirmModal(`确定删除存档 "${name}" 吗？`, { danger: true, okText: '删除' })) {
            delete settings.presets[name];
            if (settings.defaultPreset === name) settings.defaultPreset = '';
            Object.keys(settings.characterBindings || {}).forEach((key) => {
                if (settings.characterBindings[key] === name) delete settings.characterBindings[key];
            });
            Object.keys(settings.chatCompletionPresetBindings || {}).forEach((presetName) => {
                if (settings.chatCompletionPresetBindings[presetName] === name) delete settings.chatCompletionPresetBindings[presetName];
            });
            settings.activePreset = '';
            settings.rules = [];
            markRulesDataDirty({ presetsUi: true });
            saveSettingsDebounced();
            renderTags();
            updateToolbarUI();
            showToast('删除成功');
        }
    });

    $(document).off('click', '#blai-preset-new').on('click', '#blai-preset-new', async function() {
        const settings = extension_settings[extensionName];
        const name = await showPromptModal('输入新存档名称：', '', { okText: '新建' });
        if (!name) return;
        if (settings.presets[name]) { await showAlertModal('存档名称已存在。'); return; }
        settings.presets[name] = buildCurrentPresetEntry([]);
        settings.activePreset = name;
        settings.rules = [];
        markRulesDataDirty({ presetsUi: true });
        saveSettingsDebounced();
        updateToolbarUI();
        renderTags(); // 必须重新渲染以清空列表
        showToast(`已新建存档：${name}`);
    });

    $(document).off('click', '#blai-preset-export').on('click', '#blai-preset-export', function() {
        const settings = extension_settings[extensionName];
        const data = JSON.stringify(buildPresetExportPayload(settings), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (settings.activePreset || '临时规则') + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    $(document).off('click', '#blai-preset-import').on('click', '#blai-preset-import', function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.position = 'fixed';
        input.style.left = '-1000px';
        input.style.top = '0';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        document.body.appendChild(input);
        const cleanupInput = () => {
            window.setTimeout(() => {
                if (input.parentNode) input.parentNode.removeChild(input);
            }, 0);
        };
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                cleanupInput();
                return;
            }
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedPayload = JSON.parse(event.target.result);
                    const importedRules = normalizeImportedRulesPayload(importedPayload);
                    if (!Array.isArray(importedRules)) throw new Error('格式非数组');
                    const defaultName = file.name.replace(/\.json$/i, '');
                    await preparePresetImportChoice(importedPayload, importedRules, defaultName);
                } catch (err) {
                    await showAlertModal('导入失败：检查文件是否为合法规则数组。');
                } finally {
                    cleanupInput();
                }
            };
            reader.onerror = cleanupInput;
            reader.readAsText(file);
        };
        input.click();
        window.setTimeout(cleanupInput, 120000);
    });

    $(document).off('click', '#blai-import-only').on('click', '#blai-import-only', () => importPresetOnly());
    $(document).off('click', '#blai-import-switch').on('click', '#blai-import-switch', () => importPresetAndSwitch());
    $(document).off('click', '#blai-import-preview').on('click', '#blai-import-preview', () => importPresetAsTemporaryPreview());
    $(document).off('click', '#blai-import-choice-close').on('click', '#blai-import-choice-close', () => closeImportChoiceModal());
    $(document).off('click', '#blai-preset-import-choice-modal').on('click', '#blai-preset-import-choice-modal', function(e) {
        if (e.target && e.target.id === 'blai-preset-import-choice-modal') closeImportChoiceModal();
    });
    $(document).off('keydown', '#blai-import-preset-name').on('keydown', '#blai-import-preset-name', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            importPresetOnly();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeImportChoiceModal();
        }
    });
}
