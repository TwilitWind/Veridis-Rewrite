/**
 * AI 生成字段的 DOM 投影：设置页事件（settingsEvents）与预设切换（presets/view）共用，
 * 避免同一批字段映射写在两处导致增删字段时漂移。
 * base-url / api-key / 附加参数等连接类字段由调用方各自补投影，不在此列。
 */
import { defaultAiRewriteSettings, normalizeAiNumericSetting } from '../settings/defaults.js';

export function setValueIfNotFocused(selector, value) {
    const $field = $(selector);
    if (!$field.is(':focus')) $field.val(value);
}

export function getAiTimeoutSeconds(timeoutMs) {
    return normalizeAiNumericSetting('timeoutMs', timeoutMs) / 1000;
}

// 把 aiSettings 的生成参数投影到设置页字段。
export function syncAiGenerationFieldsUI(aiSettings) {
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
