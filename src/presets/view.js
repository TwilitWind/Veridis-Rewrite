/**
 * 负责预设工具栏、绑定，以及预设自有的 AI 生成 DOM 投影。
 * 该模块不负责预设选择、绑定清理或设置持久化。
 */
import { defaultAiRewriteSettings, extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { presetsRuntimeState, markPresetsUiDirty } from './state.js';
import { getPresetBindingHistory, getPresetBindingResolution } from './bindings.js';
import { getCurrentCharacterContext, getCurrentChatCompletionPresetName } from '../host/context.js';
import { safeHtml } from '../ui/html.js';

function getAiTimeoutSeconds(timeoutMs) {
    const parsed = Number(timeoutMs);
    const fallback = Number(defaultAiRewriteSettings.timeoutMs) || 120000;
    const normalizedMs = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(Math.max(Math.round(normalizedMs / 1000), 1), 120);
}

export function syncPresetAiRewriteGenerationSettingsUI(settings) {
    const aiSettings = {
        ...defaultAiRewriteSettings,
        ...(settings?.aiRewrite && typeof settings.aiRewrite === 'object' ? settings.aiRewrite : {}),
    };
    const setValueIfNotFocused = (selector, value) => {
        const $field = $(selector);
        if (!$field.is(':focus')) $field.val(value);
    };
    $('#blai-ai-protect-comments').prop('checked', aiSettings.protectXmlComments === true);
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
}

export function renderBindingHistory() {
    const $list = $('#blai-binding-history-list');
    if (!$list.length) return;
    const { entries } = getPresetBindingHistory();
    $list.empty();
    const groups = [
        { type: 'character', title: '角色卡绑定', empty: '暂无角色卡绑定' },
        { type: 'chatPreset', title: '对话补全预设绑定', empty: '暂无对话补全预设绑定' },
    ];
    groups.forEach((group) => {
        const items = entries.filter((entry) => entry.type === group.type);
        const $group = $('<section>', { class: 'blai-binding-history-group' });
        $('<h4>', { class: 'blai-binding-history-group-title', text: `${group.title}（${items.length}）` }).appendTo($group);
        if (!items.length) {
            const $empty = $('<p>', { class: 'blai-binding-history-empty' });
            $('<i>', { class: 'fas fa-inbox', 'aria-hidden': 'true' }).appendTo($empty);
            $('<span>', { text: group.empty }).appendTo($empty);
            $empty.appendTo($group);
        } else {
            items.forEach((entry) => {
                const $row = $('<div>', { class: 'blai-binding-history-row' });
                $('<span>', { class: 'blai-binding-history-name', text: entry.name || '未命名' }).appendTo($row);
                $('<i>', { class: 'fas fa-arrow-right blai-binding-history-arrow', 'aria-hidden': 'true' }).appendTo($row);
                $('<span>', { class: 'blai-binding-history-preset', text: entry.presetName }).appendTo($row);
                if (!entry.valid) {
                    $('<span>', { class: 'blai-binding-history-badge', text: '预设已删除' }).appendTo($row);
                }
                $group.append($row);
            });
        }
        $list.append($group);
    });
}

function syncProxyFieldState(selector, $target) {
    const $proxy = $('#blai-purifier-popup [data-blai-click-proxy="' + selector + '"]');
    if (!$proxy.length) return;
    const active = $target.hasClass('is-active') || $target.hasClass('blai-bind-active') || $target.attr('aria-pressed') === 'true';
    const canToggleActiveBinding = active && $proxy.attr('data-blai-toggle-binding');
    const disabled = $target.prop('disabled') === true && !canToggleActiveBinding;
    $proxy
        .attr('aria-disabled', String(disabled))
        .attr('aria-pressed', String(active))
        .toggleClass('is-disabled', disabled)
        .toggleClass('is-active', active)
        .attr('title', String($target.attr('title') || ''));
}

export function refreshCharacterBindingUI() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const activePreset = String(settings.activePreset || '');
    const $defaultBtn = $('#blai-default-toggle');
    const defaultPreset = String(settings.defaultPreset || '');

    $('#blai-tools-global-preset').text(defaultPreset || '无');
    $('#blai-tools-global-preset').closest('.blai-tools-binding-item').toggleClass('is-bound', !!defaultPreset);

    if ($defaultBtn.length) {
        const isDefaultActive = !!(activePreset && defaultPreset === activePreset);
        $defaultBtn.toggleClass('blai-bind-active', isDefaultActive);
        $defaultBtn.prop('disabled', !activePreset);
        $defaultBtn.attr('aria-pressed', String(isDefaultActive));
        $defaultBtn.attr('title', activePreset
            ? (isDefaultActive ? '已设为全局默认：' + activePreset + '（点击取消）' : '将当前净化预设设为全局默认：' + activePreset)
            : '请先选择一个净化预设');
        syncProxyFieldState('#blai-default-toggle', $defaultBtn);
    }

    const context = getCurrentCharacterContext();
    const chatCompletionPresetName = getCurrentChatCompletionPresetName();
    const bindingResolution = getPresetBindingResolution(context.key, { chatCompletionPresetName });
    const currentBound = String(bindingResolution.characterPreset || '');
    const currentChatBound = String(bindingResolution.chatCompletionPreset || '');

    $('#blai-tools-character-context').text(context.key ? context.name : '无');
    $('#blai-tools-character-binding').text(currentBound || '未绑定');
    $('#blai-tools-character-binding').closest('.blai-tools-binding-item').toggleClass('is-bound', !!currentBound);

    $('#blai-tools-chat-context').text(chatCompletionPresetName || '无');
    $('#blai-tools-chat-binding').text(currentChatBound || '未绑定');
    $('#blai-tools-chat-binding').closest('.blai-tools-binding-item').toggleClass('is-bound', !!currentChatBound);

    const isCharacterBound = !!(context.key && activePreset && currentBound === activePreset);
    const isChatPresetBound = !!(chatCompletionPresetName && activePreset && currentChatBound === activePreset);

    const $characterProxy = $('#blai-purifier-popup [data-blai-click-proxy="#blai-bind-current-character"]');
    if ($characterProxy.length) {
        const blocked = !activePreset || !context.key;
        $characterProxy
            .attr('aria-pressed', String(isCharacterBound))
            .attr('aria-disabled', String(blocked))
            .toggleClass('is-disabled', blocked)
            .toggleClass('is-active', isCharacterBound)
            .attr('title', blocked
                ? '需要先选择净化预设，并打开一个角色卡'
                : (isCharacterBound ? '角色「' + context.name + '」已绑定：' + activePreset + '（点击解绑）' : '把「' + activePreset + '」绑定到角色「' + context.name + '」'));
    }

    const $chatProxy = $('#blai-purifier-popup [data-blai-click-proxy="#blai-bind-current-chat-preset"]');
    if ($chatProxy.length) {
        const blocked = !activePreset || !chatCompletionPresetName;
        $chatProxy
            .attr('aria-pressed', String(isChatPresetBound))
            .attr('aria-disabled', String(blocked))
            .toggleClass('is-disabled', blocked)
            .toggleClass('is-active', isChatPresetBound)
            .attr('title', blocked
                ? '需要先选择净化预设，并选择一个对话补全预设'
                : (isChatPresetBound ? '补全预设「' + chatCompletionPresetName + '」已绑定：' + activePreset + '（点击解绑）' : '把「' + activePreset + '」绑定到补全预设「' + chatCompletionPresetName + '」'));
    }

    if ($('#blai-binding-history-modal').hasClass('blai-is-open')) renderBindingHistory();
}

export function updateToolbarUI() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName];
    const selects = $('#blai-preset-select, #blai-tools-preset-select');
    if (!selects.length) return;

    if (presetsRuntimeState.presetsUiDirty || selects.filter((_, element) => element.children.length === 0).length > 0) {
        const presetNames = settings.presets ? Object.keys(settings.presets) : [];
        const optionsHtml = ['<option value="">-- 临时规则 (未绑定存档) --</option>']
            .concat(presetNames.map((name) => `<option value="${safeHtml(name)}">${safeHtml(name)}</option>`))
            .join('');
        selects.html(optionsHtml);
        markPresetsUiDirty(false);
    }
    selects.val(settings.activePreset || '');

    // 首页规则集下拉改成自绘浮层：同步菜单项与触发器文案（原生 select 保留为数据锚点）。
    const activeName = settings.activePreset || '';
    const $presetMenu = $('#blai-preset-menu');
    if ($presetMenu.length) {
        const optionToItem = (value, label) => `<button type="button" class="blai-preset-menu-item" role="option" data-preset="${safeHtml(value)}" aria-selected="${value === activeName}">${safeHtml(label)}</button>`;
        const items = [optionToItem('', '-- 临时规则 (未绑定存档) --')]
            .concat((settings.presets ? Object.keys(settings.presets) : []).map((name) => optionToItem(name, name)))
            .join('');
        $presetMenu.html(items);
        const $activeOption = $('#blai-preset-select').find('option:selected');
        const label = $activeOption.length ? $activeOption.text() : (activeName || '-- 临时规则 (未绑定存档) --');
        $('#blai-preset-select-label').text(label || '-- 临时规则 (未绑定存档) --');
    }
    const rules = Array.isArray(settings.rules) ? settings.rules : [];
    const aiRuleCount = rules.reduce((count, rule) => count + (Array.isArray(rule?.subRules)
        ? rule.subRules.filter((sub) => sub?.rewriteMode === 'ai').length
        : 0), 0);
    $('#blai-rule-group-count').text(String(rules.length));
    $('#blai-ai-rule-count').text(String(aiRuleCount));
    refreshCharacterBindingUI();
}
