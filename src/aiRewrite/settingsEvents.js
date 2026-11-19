/**
 * 负责 AI 提供方/设置以及 AI 通信监控的 UI 绑定。
 */
import { createAiSettingsCore } from './settingsEvents/events-00-core.js';
import { bindAiSettingHandlers } from './settingsEvents/events-01-bindings.js';

export function bindAiSettingsEvents() {
    bindAiSettingHandlers(createAiSettingsCore());
}
