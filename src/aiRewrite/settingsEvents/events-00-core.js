/**
 * 负责 AI 提供方/设置以及 AI 通信监控的 UI 绑定。
 */
import { defaultAiRewriteSettings, extensionName, normalizeAiSamplingSettings } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { markRulesDataDirty } from '../../rules/state.js';
import { hasAdditionalParameters } from '../additionalParameters.js';
import { logger } from '../../log.js';
import { showConfirmModal, showPromptModal, showToast } from '../../ui/notifications.js';

// AI 设置的核心闭包：状态与工具函数集中在此，绑定层通过返回对象读取。
let aiApiCheckSequence = 0;

export function createAiSettingsCore() {

    const { extension_settings, saveSettingsDebounced } = getAppContext();

    const settings = extension_settings[extensionName];

    const ensureAiRewriteSettings = () => {
        const currentAiSettings = settings.aiRewrite && typeof settings.aiRewrite === 'object'
            ? settings.aiRewrite
            : {};
        settings.aiRewrite = {
            ...defaultAiRewriteSettings,
            ...currentAiSettings,
            apiPresets: currentAiSettings.apiPresets && typeof currentAiSettings.apiPresets === 'object' && !Array.isArray(currentAiSettings.apiPresets)
                ? { ...currentAiSettings.apiPresets }
                : {},
        };
        settings.aiRewrite.activeApiPreset = String(settings.aiRewrite.activeApiPreset || '').trim();
        if (!Object.prototype.hasOwnProperty.call(settings.aiRewrite.apiPresets, settings.aiRewrite.activeApiPreset)) {
            settings.aiRewrite.activeApiPreset = '';
        }
        return settings.aiRewrite;
    };

    const getTavernHelperApi = () => {
        const direct = globalThis?.TavernHelper;
        if (direct) return direct;
        try {
            return globalThis?.parent?.TavernHelper || null;
        } catch {
            return null;
        }
    };

    const isLocalHttpUrl = (value) => {
        try {
            const parsed = new URL(String(value || '').trim());
            if (parsed.protocol !== 'http:') return true;
            return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(parsed.hostname);
        } catch {
            return true;
        }
    };

    const getAiTimeoutSeconds = (timeoutMs) => {
        const parsed = Number(timeoutMs);
        const fallback = Number(defaultAiRewriteSettings.timeoutMs) || 120000;
        const normalizedMs = Number.isFinite(parsed) ? parsed : fallback;
        return Math.min(Math.max(Math.round(normalizedMs / 1000), 1), 120);
    };

    const setAiApiCheckState = (state, title = '') => {
        const normalizedState = state || 'idle';
        const connectionLabels = {
            idle: '未拉取',
            checking: '拉取中',
            ok: '已拉取',
            failed: '拉取失败',
            missing: '配置不完整',
            disabled: '未启用',
        };
        $('#blai-ai-connection-status')
            .attr('data-state', normalizedState)
            .text(connectionLabels[normalizedState]);
        $('#blai-ai-model-fetch')
            .toggleClass('accent', normalizedState === 'ok')
            .prop('disabled', normalizedState === 'checking')
            .attr('title', title || '通过酒馆助手拉取模型列表，不发送聊天消息')
            .attr('aria-label', normalizedState === 'checking' ? '正在刷新模型列表' : '刷新模型列表');
        $('#blai-ai-model-fetch i').toggleClass('fa-spin', normalizedState === 'checking');
    };

    const resetAiApiCheckState = () => {
        aiApiCheckSequence += 1;
        if (ensureAiRewriteSettings().enabled !== true) {
            setAiApiCheckState('disabled', 'AI 改写未启用，开启后再拉取模型列表。');
            return;
        }
        const aiSettings = ensureAiRewriteSettings();
        if (!String(aiSettings.baseUrl || '').trim() || !String(aiSettings.apiKey || '')) {
            setAiApiCheckState('missing', '需要先填写 API 地址和 API Key。');
            return;
        }
        setAiApiCheckState('idle');
    };

    const normalizeAiModelOptions = (options) => {
        if (!Array.isArray(options)) return [];
        return [...new Set(options.map((value) => String(value || '').trim()).filter(Boolean))];
    };

    // 模型下拉框：自动拉取的模型与手动添加的模型分成两个 optgroup，便于分辨来源。
    const syncAiModelControl = (aiSettings) => {
        const $select = $('#blai-ai-model');
        if (!$select.length) return;
        const fetchedModels = normalizeAiModelOptions(aiSettings.modelOptions);
        const manualModels = normalizeAiModelOptions(aiSettings.manualModels);
        let selectedModel = String(aiSettings.model || '').trim();
        const allModels = [...new Set([...fetchedModels, ...manualModels])];
        if (!selectedModel && allModels.length > 0) {
            selectedModel = allModels[0];
            aiSettings.model = selectedModel;
            saveSettingsDebounced();
        }
        const fragment = document.createDocumentFragment();
        if (allModels.length === 0) {
            fragment.appendChild(new Option('尚未拉取模型，可手动填写', ''));
        } else {
            if (!allModels.includes(selectedModel)) {
                const custom = new Option(selectedModel ? `自定义：${selectedModel}` : '选择模型', selectedModel || '');
                custom.disabled = !selectedModel;
                fragment.appendChild(custom);
            }
            if (fetchedModels.length > 0) {
                const autoGroup = document.createElement('optgroup');
                autoGroup.label = '自动拉取';
                fetchedModels.forEach((modelId) => autoGroup.appendChild(new Option(modelId, modelId)));
                fragment.appendChild(autoGroup);
            }
            if (manualModels.length > 0) {
                const manualGroup = document.createElement('optgroup');
                manualGroup.label = '手动填写';
                manualModels.forEach((modelId) => manualGroup.appendChild(new Option(modelId, modelId)));
                fragment.appendChild(manualGroup);
            }
        }
        $select.empty().append(fragment).val(selectedModel);
    };

    const normalizeAiApiPresetSnapshot = (value = {}) => ({
        baseUrl: String(value.baseUrl || '').trim(),
        apiKey: String(value.apiKey || ''),
        model: String(value.model || '').trim(),
        modelOptions: normalizeAiModelOptions(value.modelOptions),
        manualModels: normalizeAiModelOptions(value.manualModels),
        ...normalizeAiSamplingSettings(value),
    });

    const getCurrentAiApiPresetSnapshot = (aiSettings = ensureAiRewriteSettings()) => normalizeAiApiPresetSnapshot(aiSettings);

    const isActiveAiApiPresetDirty = (aiSettings) => {
        const activeName = String(aiSettings.activeApiPreset || '');
        const activePreset = activeName ? aiSettings.apiPresets?.[activeName] : null;
        if (!activePreset) return false;
        return JSON.stringify(normalizeAiApiPresetSnapshot(activePreset)) !== JSON.stringify(normalizeAiApiPresetSnapshot(aiSettings));
    };

    const syncAiApiPresetSelect = (aiSettings) => {
        const $select = $('#blai-ai-api-preset');
        if (!$select.length) return;
        const activeName = String(aiSettings.activeApiPreset || '');
        const presetNames = Object.keys(aiSettings.apiPresets || {});
        const fragment = document.createDocumentFragment();
        const placeholder = new Option(presetNames.length > 0 ? '请选择 API 预设' : '暂无 API 预设', '');
        placeholder.disabled = true;
        fragment.appendChild(placeholder);
        presetNames.forEach((name) => {
            const label = name === activeName && isActiveAiApiPresetDirty(aiSettings) ? `${name}（未保存）` : name;
            fragment.appendChild(new Option(label, name));
        });
        $select.empty().append(fragment).val(activeName || '');
        $('#blai-ai-api-preset-edit, #blai-ai-api-preset-delete').prop('disabled', !activeName);
    };

    const saveCurrentAiApiPreset = async ({ forceNew = false } = {}) => {
        const aiSettings = ensureAiRewriteSettings();
        let name = forceNew ? '' : String(aiSettings.activeApiPreset || '');
        if (!name) {
            const enteredName = await showPromptModal('输入 API 预设名称：', '', { okText: '保存' });
            if (enteredName === null) return false;
            name = String(enteredName || '').trim();
            if (!name) {
                showToast('API 预设名称不能为空');
                return false;
            }
            if (Object.prototype.hasOwnProperty.call(aiSettings.apiPresets, name)
                && !await showConfirmModal(`API 预设“${name}”已存在，是否覆盖？`, { danger: true, okText: '覆盖' })) return false;
        }
        aiSettings.apiPresets[name] = getCurrentAiApiPresetSnapshot(aiSettings);
        aiSettings.activeApiPreset = name;
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        showToast(`API 预设已保存：${name}`);
        return true;
    };

    const renameActiveAiApiPreset = async () => {
        const aiSettings = ensureAiRewriteSettings();
        const activeName = String(aiSettings.activeApiPreset || '');
        if (!activeName) return false;
        const enteredName = await showPromptModal('输入新的 API 预设名称：', activeName, { okText: '重命名' });
        if (enteredName === null) return false;
        const nextName = String(enteredName || '').trim();
        if (!nextName) {
            showToast('API 预设名称不能为空');
            return false;
        }
        if (nextName === activeName) return false;
        if (Object.prototype.hasOwnProperty.call(aiSettings.apiPresets, nextName)) {
            showToast(`API 预设“${nextName}”已存在`);
            return false;
        }
        aiSettings.apiPresets[nextName] = aiSettings.apiPresets[activeName];
        delete aiSettings.apiPresets[activeName];
        aiSettings.activeApiPreset = nextName;
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        showToast(`API 预设已重命名：${nextName}`);
        return true;
    };

    const applyAiApiPreset = (name) => {
        const aiSettings = ensureAiRewriteSettings();
        const preset = aiSettings.apiPresets?.[name];
        if (!preset) return false;
        Object.assign(aiSettings, normalizeAiApiPresetSnapshot(preset), { activeApiPreset: name });
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        resetAiApiCheckState();
        return true;
    };

    const runAiModelsHealthCheck = async () => {
        const aiSettings = ensureAiRewriteSettings();
        if (aiSettings.enabled !== true) {
            setAiApiCheckState('disabled', 'AI 改写未启用，开启后再拉取模型列表。');
            return false;
        }
        const apiurl = String(aiSettings.baseUrl || '').trim();
        const key = String(aiSettings.apiKey || '');
        if (!apiurl || !key) {
            setAiApiCheckState('missing', '需要先填写 API 地址和 API Key。');
            return false;
        }
        const tavernHelper = getTavernHelperApi();
        if (typeof tavernHelper?.getModelList !== 'function') {
            setAiApiCheckState('failed', 'TavernHelper.getModelList 不可用，请更新或启用酒馆助手。');
            return false;
        }
        const requestId = ++aiApiCheckSequence;
        setAiApiCheckState('checking', `正在通过酒馆助手从 ${apiurl} 拉取模型列表；不会发送聊天消息。`);
        try {
            const modelIds = normalizeAiModelOptions(await tavernHelper.getModelList({ apiurl, key }));
            if (requestId !== aiApiCheckSequence) return false;
            aiSettings.modelOptions = modelIds;
            saveSettingsDebounced();
            syncAiRewriteSettingsUI();
            const selectedModel = String(aiSettings.model || '').trim();
            const hasSelectedModel = !selectedModel || modelIds.includes(selectedModel);
            const title = hasSelectedModel
                ? `已拉取 ${modelIds.length} 个模型。`
                : `模型列表已拉取，但其中没有当前模型 ${selectedModel}。`;
            setAiApiCheckState('ok', title);
            return true;
        } catch (error) {
            if (requestId !== aiApiCheckSequence) return false;
            const reason = error?.message || '请求失败';
            setAiApiCheckState('failed', `模型列表拉取失败：${reason}`);
            logger.warn('酒馆助手模型列表拉取失败', reason);
            return false;
        }
    };

    // 自动触发依赖「启用改写」；未启用时把开关置灰并禁用，避免用户开了一个不会生效的选项。
    const syncAiAutoTriggerAvailability = (aiSettings) => {
        const aiEnabled = aiSettings?.enabled === true;
        $('#blai-ai-auto-trigger-enabled')
            .prop('disabled', !aiEnabled)
            .attr('aria-disabled', aiEnabled ? 'false' : 'true')
            .closest('.blai-ai-switch')
            .toggleClass('is-disabled', !aiEnabled);
        $('#blai-ai-auto-trigger-enabled')
            .closest('.blai-ai-switch')
            .attr('title', aiEnabled ? '' : '先开启「启用改写」，自动触发才会生效');
    };

    const syncAiRewriteSettingsUI = () => {
        const aiSettings = ensureAiRewriteSettings();
        const setValueIfNotFocused = (selector, value) => {
            const $field = $(selector);
            if (!$field.is(':focus')) $field.val(value);
        };
        $('#blai-ai-enabled').prop('checked', aiSettings.enabled === true);
        $('#blai-ai-auto-trigger-enabled').prop('checked', aiSettings.autoTriggerEnabled === true);
        $('#blai-ai-protect-comments').prop('checked', aiSettings.protectXmlComments === true);
        setValueIfNotFocused('#blai-ai-base-url', aiSettings.baseUrl || '');
        setValueIfNotFocused('#blai-ai-api-key', aiSettings.apiKey || '');
        syncAiApiPresetSelect(aiSettings);
        syncAiModelControl(aiSettings);
        setValueIfNotFocused('#blai-ai-temperature', aiSettings.temperature);
        setValueIfNotFocused('#blai-ai-top-p', aiSettings.topP);
        setValueIfNotFocused('#blai-ai-top-k', aiSettings.topK);
        setValueIfNotFocused('#blai-ai-frequency-penalty', aiSettings.frequencyPenalty);
        setValueIfNotFocused('#blai-ai-presence-penalty', aiSettings.presencePenalty);
        setValueIfNotFocused('#blai-ai-repetition-penalty', aiSettings.repetitionPenalty);
        setValueIfNotFocused('#blai-ai-max-tokens', aiSettings.maxTokens);
        setValueIfNotFocused('#blai-ai-timeout', getAiTimeoutSeconds(aiSettings.timeoutMs));
        setValueIfNotFocused('#blai-ai-max-retries', aiSettings.maxRetries);
        setValueIfNotFocused('#blai-ai-max-items', aiSettings.maxItemsPerRequest);
        setValueIfNotFocused('#blai-ai-max-context', aiSettings.maxContextChars);
        setValueIfNotFocused('#blai-ai-prompt', aiSettings.promptTemplate || defaultAiRewriteSettings.promptTemplate);
        setValueIfNotFocused('#blai-ai-prompt-expanded', aiSettings.promptTemplate || defaultAiRewriteSettings.promptTemplate);
        // 附加参数回显与按钮填写状态。
        setValueIfNotFocused('#blai-ai-custom-include-body', aiSettings.customIncludeBody || '');
        setValueIfNotFocused('#blai-ai-custom-exclude-body', aiSettings.customExcludeBody || '');
        setValueIfNotFocused('#blai-ai-custom-include-headers', aiSettings.customIncludeHeaders || '');
        const additionalFilled = hasAdditionalParameters(aiSettings);
        $('#blai-ai-additional-state')
            .attr('data-filled', String(additionalFilled))
            .text(additionalFilled ? '已填写' : '未填写');
        const aiEnabled = aiSettings.enabled === true;
        $('#blai-ai-enabled-status')
            .html(aiEnabled ? 'AI改写 <span class="blai-ai-state-word is-on">开启</span>' : 'AI改写 <span class="blai-ai-state-word">关闭</span>');
        syncAiAutoTriggerAvailability(aiSettings);
        if (aiSettings.enabled !== true) setAiApiCheckState('disabled', 'AI 改写未启用，开启后再拉取模型列表。');
        $('#blai-ai-http-warning').prop('hidden', isLocalHttpUrl(aiSettings.baseUrl));
    };

    const updateAiRewriteSetting = (key, value, options = {}) => {
        const aiSettings = ensureAiRewriteSettings();
        aiSettings[key] = value;
        if (['baseUrl', 'apiKey'].includes(key)) aiSettings.modelOptions = [];
        if (options.markRulesDirty !== false) markRulesDataDirty({ rulesUi: false });
        saveSettingsDebounced();
        syncAiRewriteSettingsUI();
        if (['enabled', 'baseUrl', 'apiKey'].includes(key)) resetAiApiCheckState();
    };

    const openAiPromptEditor = () => {
        const aiSettings = ensureAiRewriteSettings();
        $('#blai-ai-prompt-expanded').val(aiSettings.promptTemplate || defaultAiRewriteSettings.promptTemplate);
        $('#blai-ai-prompt-modal').addClass('blai-is-open');
        window.setTimeout(() => $('#blai-ai-prompt-expanded').trigger('focus'), 0);
    };

    const closeAiPromptEditor = () => {
        $('#blai-ai-prompt-modal').removeClass('blai-is-open');
    };

    const aiMobileLayoutMedia = window.matchMedia('(max-width: 600px)');

    const closeAiGenerationEditor = () => {
        $('#blai-ai-generation-modal')
            .removeClass('blai-is-open')
            .attr('aria-hidden', 'true');
        $('#blai-ai-generation-open').attr('aria-expanded', 'false');
    };

    // 附加参数弹窗：桌面与移动端通用的独立弹窗，不参与生成参数的响应式搬运。
    const openAiAdditionalEditor = () => {
        syncAiRewriteSettingsUI();
        $('#blai-ai-additional-modal')
            .addClass('blai-is-open')
            .attr('aria-hidden', 'false');
        $('#blai-ai-additional-open').attr('aria-expanded', 'true');
        $('#blai-ai-additional-modal-close').trigger('focus');
    };

    const closeAiAdditionalEditor = () => {
        $('#blai-ai-additional-modal')
            .removeClass('blai-is-open')
            .attr('aria-hidden', 'true');
        $('#blai-ai-additional-open').attr('aria-expanded', 'false');
    };

    const syncAiResponsiveLayout = () => {
        const $generationSection = $('#blai-ai-generation-section');
        const $generationHost = $('#blai-ai-generation-host');
        if (aiMobileLayoutMedia.matches) {
            $generationSection.appendTo('#blai-ai-generation-modal-body');
            return;
        }
        closeAiGenerationEditor();
        $generationSection.appendTo($generationHost);
    };

    const openAiGenerationEditor = () => {
        if (!aiMobileLayoutMedia.matches) return;
        $('#blai-ai-generation-modal')
            .addClass('blai-is-open')
            .attr('aria-hidden', 'false');
        $('#blai-ai-generation-open').attr('aria-expanded', 'true');
        $('#blai-ai-generation-modal-close').trigger('focus');
    };

    const applyAiPromptEditor = () => {
        const value = String($('#blai-ai-prompt-expanded').val() || defaultAiRewriteSettings.promptTemplate);
        $('#blai-ai-prompt').val(value);
        updateAiRewriteSetting('promptTemplate', value, { markRulesDirty: false });
        closeAiPromptEditor();
    };

    syncAiRewriteSettingsUI();

    resetAiApiCheckState();

    syncAiResponsiveLayout();

    aiMobileLayoutMedia.addEventListener('change', syncAiResponsiveLayout);


    // 直角引号已去掉，关键词改由 <span> 承载强调色；调用处显式声明 allowHtml（文案为硬编码，非用户输入）。
    const AI_REWRITE_ORDER_NOTE = [
        '开启<span class="blai-dialog-em">启用改写</span>后，插件先按规则条目顺序从上到下执行所有<span class="blai-dialog-em">AI 改写</span>条目，再执行<span class="blai-dialog-em">程序改写</span>条目。',
        '关闭<span class="blai-dialog-em">启用改写</span>后，所有<span class="blai-dialog-em">AI 改写</span>条目会被自动过滤，只运行<span class="blai-dialog-em">程序改写</span>条目。',
        '规则条目在列表中自上而下的排列顺序，就是实际的执行顺序。',
    ].join('\n');

    return {
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
    };
}
