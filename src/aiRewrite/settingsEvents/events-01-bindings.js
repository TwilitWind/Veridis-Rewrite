/**
 * 负责 AI 提供方/设置以及 AI 通信监控的 UI 绑定。
 */
import { defaultAiRewriteSettings, normalizeAiSamplingSettings } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { showAlertModal, showConfirmModal, showPromptModal, showToast } from '../../ui/notifications.js';
import { openMenuPopover, closeMenuPopover } from '../../ui/popover.js';
import { injectDiffButtons } from '../../diff/view.js';

function bindAiApiPresetActionsMenu() {
    const toggle = document.getElementById('blai-ai-preset-actions-toggle');
    const menu = document.getElementById('blai-ai-preset-actions-menu');
    if (!toggle || !menu) return;

    const syncDisabledItems = () => {
        menu.querySelectorAll('.blai-preset-menu-item[data-blai-ai-preset-action]').forEach((item) => {
            const target = document.querySelector(String(item.getAttribute('data-blai-ai-preset-action') || ''));
            const disabled = !target || target.disabled === true;
            item.classList.toggle('is-disabled', disabled);
            if (disabled) item.setAttribute('aria-disabled', 'true');
            else item.removeAttribute('aria-disabled');
        });
    };

    $(document).off('click', '#blai-ai-preset-actions-toggle').on('click', '#blai-ai-preset-actions-toggle', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!menu.hasAttribute('hidden')) {
            closeMenuPopover(menu);
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
            return;
        }
        syncDisabledItems();
        menu.removeAttribute('hidden');
        toggle.setAttribute('aria-expanded', 'true');
        openMenuPopover(toggle, menu);
    });

    $(document).off('click', '.blai-ai-preset-actions-menu .blai-preset-menu-item').on('click', '.blai-ai-preset-actions-menu .blai-preset-menu-item', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const item = event.currentTarget;
        if (item.getAttribute('aria-disabled') === 'true') return;
        const target = document.querySelector(String(item.getAttribute('data-blai-ai-preset-action') || ''));
        closeMenuPopover(menu);
        menu.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
        if (target && !target.disabled) target.click();
    });
}

export function bindAiSettingHandlers(core) {
    const { saveSettingsDebounced } = getAppContext();
    const {
        settings,
        ensureAiRewriteSettings,
        normalizeAiModelOptions,
        isActiveAiApiPresetDirty,
        syncAiApiPresetSelect,
        saveCurrentAiApiPreset,
        renameActiveAiApiPreset,
        applyAiApiPreset,
        runAiModelsHealthCheck,
        syncAiRewriteSettingsUI,
        updateAiRewriteSetting,
        openAiPromptEditor,
        closeAiPromptEditor,
        closeAiGenerationEditor,
        openAiGenerationEditor,
        openAiAdditionalEditor,
        closeAiAdditionalEditor,
        applyAiPromptEditor,
        AI_REWRITE_ORDER_NOTE,
    } = core;



    $(document).off('click', '#blai-ai-connection-info').on('click', '#blai-ai-connection-info', function(event) {
        event.preventDefault();
        showAlertModal(AI_REWRITE_ORDER_NOTE, { okText: '明白了', allowHtml: true });
    });


    $(document).off('change', '#blai-ai-enabled').on('change', '#blai-ai-enabled', function() {
        const enabled = $(this).prop('checked') === true;
        const aiSettings = ensureAiRewriteSettings();
        aiSettings.enabledDefaultApplied = true;
        updateAiRewriteSetting('enabled', enabled);
    });


    $(document).off('change', '#blai-ai-auto-trigger-enabled').on('change', '#blai-ai-auto-trigger-enabled', function() {
        updateAiRewriteSetting('autoTriggerEnabled', $(this).prop('checked') === true, { markRulesDirty: false });
    });


    $(document).off('change', '#blai-ai-api-preset').on('change', '#blai-ai-api-preset', async function() {
        const aiSettings = ensureAiRewriteSettings();
        const nextName = String($(this).val() || '');
        if (!nextName || nextName === aiSettings.activeApiPreset) {
            syncAiApiPresetSelect(aiSettings);
            return;
        }
        if (isActiveAiApiPresetDirty(aiSettings)
            && !await showConfirmModal(`API 预设“${aiSettings.activeApiPreset}”有未保存修改，是否放弃并切换？`, { okText: '放弃并切换' })) {
            syncAiApiPresetSelect(aiSettings);
            return;
        }
        applyAiApiPreset(nextName);
    });


    $(document).off('click', '#blai-ai-api-preset-edit').on('click', '#blai-ai-api-preset-edit', function(e) {
        e.preventDefault();
        void renameActiveAiApiPreset();
    });


    $(document).off('click', '#blai-ai-api-preset-new').on('click', '#blai-ai-api-preset-new', function(e) {
        e.preventDefault();
        void saveCurrentAiApiPreset({ forceNew: true });
    });


    $(document).off('click', '#blai-ai-api-preset-save').on('click', '#blai-ai-api-preset-save', function(e) {
        e.preventDefault();
        void saveCurrentAiApiPreset();
    });


    $(document).off('click', '#blai-ai-api-preset-delete').on('click', '#blai-ai-api-preset-delete', async function(e) {
        e.preventDefault();
        const aiSettings = ensureAiRewriteSettings();
        const name = String(aiSettings.activeApiPreset || '');
        if (!name || !aiSettings.apiPresets?.[name]) return;
        if (!await showConfirmModal(`确定删除 API 预设“${name}”吗？当前输入的连接配置会保留。`, { danger: true, okText: '删除' })) return;
        delete aiSettings.apiPresets[name];
        aiSettings.activeApiPreset = '';
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        showToast(`已删除 API 预设：${name}`, undefined, 'success');
    });

    bindAiApiPresetActionsMenu();


    $(document).off('input change', '#blai-ai-base-url').on('input change', '#blai-ai-base-url', function() {
        updateAiRewriteSetting('baseUrl', String($(this).val() || '').trim());
    });


    $(document).off('change', '#blai-ai-protect-comments').on('change', '#blai-ai-protect-comments', function() {
        updateAiRewriteSetting('protectXmlComments', $(this).prop('checked') === true);
    });


    $(document).off('input change', '#blai-ai-api-key').on('input change', '#blai-ai-api-key', function() {
        updateAiRewriteSetting('apiKey', String($(this).val() || ''), { markRulesDirty: false });
    });


    $(document).off('change', '#blai-ai-model').on('change', '#blai-ai-model', function() {
        const value = String($(this).val() || '').trim();
        if (!value) return;
        updateAiRewriteSetting('model', value, { markRulesDirty: false });
    });


    // 手动填写：点铅笔按钮弹窗输入模型 ID，确认后加入「手动填写」分组并直接选中。
    $(document).off('click', '#blai-ai-model-manual-add').on('click', '#blai-ai-model-manual-add', async function(event) {
        event.preventDefault();
        const aiSettings = ensureAiRewriteSettings();
        const current = String(aiSettings.model || '').trim();
        const input = await showPromptModal('手动填写模型 ID', current, {
            placeholder: '例如 gpt-4o-mini',
            okText: '使用',
        });
        if (input === null || input === undefined) return;
        const value = String(input).trim();
        if (!value) return;
        const manualModels = normalizeAiModelOptions(aiSettings.manualModels);
        if (!manualModels.includes(value)) manualModels.push(value);
        aiSettings.manualModels = manualModels;
        aiSettings.model = value;
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        showToast(`已加入模型列表：${value}`, undefined, 'success');
    });


    $(document).off('input change', '#blai-ai-temperature, #blai-ai-top-p, #blai-ai-top-k, #blai-ai-frequency-penalty, #blai-ai-presence-penalty, #blai-ai-repetition-penalty, #blai-ai-max-tokens, #blai-ai-timeout, #blai-ai-max-retries, #blai-ai-max-items, #blai-ai-max-context').on('input change', '#blai-ai-temperature, #blai-ai-top-p, #blai-ai-top-k, #blai-ai-frequency-penalty, #blai-ai-presence-penalty, #blai-ai-repetition-penalty, #blai-ai-max-tokens, #blai-ai-timeout, #blai-ai-max-retries, #blai-ai-max-items, #blai-ai-max-context', function() {
        const id = String(this.id || '');
        const value = Number($(this).val());
        const keyMap = {
            'blai-ai-temperature': 'temperature',
            'blai-ai-top-p': 'topP',
            'blai-ai-top-k': 'topK',
            'blai-ai-frequency-penalty': 'frequencyPenalty',
            'blai-ai-presence-penalty': 'presencePenalty',
            'blai-ai-repetition-penalty': 'repetitionPenalty',
            'blai-ai-max-tokens': 'maxTokens',
            'blai-ai-timeout': 'timeoutMs',
            'blai-ai-max-retries': 'maxRetries',
            'blai-ai-max-items': 'maxItemsPerRequest',
            'blai-ai-max-context': 'maxContextChars',
        };
        const key = keyMap[id];
        const samplingKeys = new Set(['temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'maxTokens']);
        const normalizedValue = samplingKeys.has(key)
            ? normalizeAiSamplingSettings({ [key]: value })[key]
            : id === 'blai-ai-timeout'
            ? Math.min(Math.max(Math.round(value || 0), 1), 120) * 1000
            : value;
        updateAiRewriteSetting(key, normalizedValue, { markRulesDirty: false });
    });


    $(document).off('input change', '#blai-ai-prompt').on('input change', '#blai-ai-prompt', function() {
        updateAiRewriteSetting('promptTemplate', String($(this).val() || defaultAiRewriteSettings.promptTemplate), { markRulesDirty: false });
    });


    $(document).off('click', '#blai-ai-prompt-expand').on('click', '#blai-ai-prompt-expand', function(e) {
        e.preventDefault();
        openAiPromptEditor();
    });


    $(document).off('click', '#blai-ai-generation-open').on('click', '#blai-ai-generation-open', function(e) {
        e.preventDefault();
        openAiGenerationEditor();
    });


    $(document).off('click', '#blai-ai-generation-modal-close, #blai-ai-generation-modal-done').on('click', '#blai-ai-generation-modal-close, #blai-ai-generation-modal-done', function(e) {
        e.preventDefault();
        closeAiGenerationEditor();
        $('#blai-ai-generation-open').trigger('focus');
    });


    $(document).off('click', '#blai-ai-generation-modal').on('click', '#blai-ai-generation-modal', function(e) {
        if (e.target === this) closeAiGenerationEditor();
    });


    $(document).off('keydown.blaiAiGenerationModal').on('keydown.blaiAiGenerationModal', function(e) {
        if (e.key === 'Escape' && $('#blai-ai-generation-modal').hasClass('blai-is-open')) {
            e.preventDefault();
            closeAiGenerationEditor();
            $('#blai-ai-generation-open').trigger('focus');
        }
    });

    // ---- 附加参数：三个 YAML 文本框随输入保存，按钮状态即时反映是否填写 ----
    $(document).off('input', '#blai-ai-custom-include-body, #blai-ai-custom-exclude-body, #blai-ai-custom-include-headers').on('input', '#blai-ai-custom-include-body, #blai-ai-custom-exclude-body, #blai-ai-custom-include-headers', function() {
        const keyMap = {
            'blai-ai-custom-include-body': 'customIncludeBody',
            'blai-ai-custom-exclude-body': 'customExcludeBody',
            'blai-ai-custom-include-headers': 'customIncludeHeaders',
        };
        const key = keyMap[this.id];
        if (key) updateAiRewriteSetting(key, String($(this).val() || ''), { markRulesDirty: false });
    });

    $(document).off('click', '#blai-ai-additional-open').on('click', '#blai-ai-additional-open', function(e) {
        e.preventDefault();
        openAiAdditionalEditor();
    });

    $(document).off('click', '#blai-ai-additional-modal-close, #blai-ai-additional-modal-done').on('click', '#blai-ai-additional-modal-close, #blai-ai-additional-modal-done', function(e) {
        e.preventDefault();
        closeAiAdditionalEditor();
        $('#blai-ai-additional-open').trigger('focus');
    });

    $(document).off('click', '#blai-ai-additional-modal').on('click', '#blai-ai-additional-modal', function(e) {
        if (e.target === this) closeAiAdditionalEditor();
    });

    $(document).off('keydown.blaiAiAdditionalModal').on('keydown.blaiAiAdditionalModal', function(e) {
        if (e.key === 'Escape' && $('#blai-ai-additional-modal').hasClass('blai-is-open')) {
            e.preventDefault();
            closeAiAdditionalEditor();
            $('#blai-ai-additional-open').trigger('focus');
        }
    });


    $(document).off('click', '#blai-ai-prompt-modal-close, #blai-ai-prompt-modal-cancel').on('click', '#blai-ai-prompt-modal-close, #blai-ai-prompt-modal-cancel', function(e) {
        e.preventDefault();
        closeAiPromptEditor();
    });


    $(document).off('click', '#blai-ai-prompt-modal').on('click', '#blai-ai-prompt-modal', function(e) {
        if (e.target === this) closeAiPromptEditor();
    });


    $(document).off('click', '#blai-ai-prompt-modal-apply').on('click', '#blai-ai-prompt-modal-apply', function(e) {
        e.preventDefault();
        applyAiPromptEditor();
    });


    $(document).off('keydown', '#blai-ai-prompt-expanded').on('keydown', '#blai-ai-prompt-expanded', function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAiPromptEditor();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 's') {
            e.preventDefault();
            applyAiPromptEditor();
        }
    });


    $(document).off('click', '#blai-ai-api-key-reveal').on('click', '#blai-ai-api-key-reveal', function(e) {
        e.preventDefault();
        const $input = $('#blai-ai-api-key');
        const nextType = $input.attr('type') === 'password' ? 'text' : 'password';
        $input.attr('type', nextType);
        $(this).find('i').attr('class', nextType === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash');
    });


    $(document).off('click', '#blai-ai-api-key-clear').on('click', '#blai-ai-api-key-clear', function(e) {
        e.preventDefault();
        updateAiRewriteSetting('apiKey', '', { markRulesDirty: false });
        showToast('API Key 已清空', undefined, 'success');
    });


    $(document).off('click', '#blai-ai-model-fetch').on('click', '#blai-ai-model-fetch', function(e) {
        e.preventDefault();
        void runAiModelsHealthCheck();
    });


    if (settings.enableVisualDiff === false) {
        settings.enableVisualDiff = true;
        saveSettingsDebounced();
        injectDiffButtons();
    }
}
