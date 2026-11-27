// 负责顶层 Veridis 外壳/通用 UI 事件绑定，直接组合各功能绑定器，并保留跨功能的外壳开关/操作；规则、作用域、预设、深度净化、反馈、差异、AI 设置、主题、中文字典与宿主生命周期各自负责其功能业务实现。
import { extensionName } from './settings/defaults.js';
import { getAppContext } from './host/appContext.js';
import { clearPendingShujukuRewrite } from './shujuku/realtime.js';
import { showResponsivePage, updateLegacyPurifierWarning } from './ui/shell.js';
import { refreshCharacterBindingUI, updateToolbarUI } from './presets/view.js';
import { bindPresetEvents } from './presets/events.js';
import { bindRuleEvents } from './rules/events.js';
import { closeRuleSearchModal, renderTags } from './rules/view.js';
import { syncPersonaDescriptionProtectionControl } from './ui/personaProtection.js';
import { normalizeZhVariantSettings } from './zh/dictionary.js';
import { showConfirmModal } from './ui/notifications.js';
import { getFadeDuration } from './ui/motion.js';
import { syncToggleState } from './ui/toggle.js';
import { bindHostLifecycleEvents } from './host/lifecycleEvents.js';
import { bindAiSettingsEvents } from './aiRewrite/settingsEvents.js';
import { bindThemeEvents } from './ui/theme.js';
import { bindZhEvents } from './zh/events.js';
import { bindScopeEvents } from './scope/events.js';
import { closeScopeTagsModal, renderScopeTagsModal } from './scope/view.js';
import { bindDiffEvents } from './diff/events.js';
import { bindDeepCleanEvents } from './deepClean/events.js';
import { bindComposerButtonAiRewriteEvent, updateComposerButtonSetting } from './aiRewrite/composerButton.js';
import { bindFeedbackEvents, openFeedbackPage } from './feedback/events.js';
import { bindInfoPopoverEvents } from './ui/infoPopover.js';
import { bindTourEvents, offerMainTourFirstUse } from './ui/tour.js';

export function bindEvents() {
    const { extension_settings, saveSettingsDebounced, eventSource } = getAppContext();
    const openPurifier = () => {
        updateToolbarUI();
        updateLegacyPurifierWarning();
        showResponsivePage('overview');
        renderTags();
        renderScopeTagsModal();
        // 进场用 base 节奏（与 --blai-duration-base 一致），退场用 fast，避免整块慢淡出。
        $('#blai-purifier-popup').css('display', 'grid').hide().fadeIn(getFadeDuration('in'));
        offerMainTourFirstUse();
    };
    bindComposerButtonAiRewriteEvent(eventSource);
    bindFeedbackEvents();
    bindInfoPopoverEvents();
    bindTourEvents();

    $(document).off('click', '#blai-wand-btn, #blai-wand-btn-panel').on('click', '#blai-wand-btn, #blai-wand-btn-panel', openPurifier);

    $(document).off('click', '#blai-purifier-popup [data-page-target]').on('click', '#blai-purifier-popup [data-page-target]', function(e) {
        e.preventDefault();
        const pageId = String($(this).attr('data-page-target') || 'overview');
        showResponsivePage(pageId);
        if (pageId === 'clean') renderScopeTagsModal();
        if (pageId === 'feedback') openFeedbackPage('runtime-log');
    });

    $(document).off('click', '#blai-purifier-popup [data-blai-click-proxy]').on('click', '#blai-purifier-popup [data-blai-click-proxy]', function(e) {
        e.preventDefault();
        const selector = String($(this).attr('data-blai-click-proxy') || '');
        const target = selector ? document.querySelector(selector) : null;
        if (target && target.disabled) {
            refreshCharacterBindingUI();
            return;
        }
        if (target) target.click();
    });

    $(document).off('click', '#blai-close-legacy-plugin').on('click', '#blai-close-legacy-plugin', function(e) {
        e.preventDefault();
        updateLegacyPurifierWarning();
        const legacyEntry = document.getElementById('bl-extension-settings-entry') || document.getElementById('bl-wand-btn');
        if (legacyEntry) {
            $('#blai-purifier-popup').fadeOut(getFadeDuration('out'));
            legacyEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
            legacyEntry.classList.remove('blai-legacy-target-flash');
            void legacyEntry.offsetWidth;
            legacyEntry.classList.add('blai-legacy-target-flash');
            window.setTimeout(() => legacyEntry.classList.remove('blai-legacy-target-flash'), 1800);
        }
    });

    $(document).off('click', '#blai-close-btn').on('click', '#blai-close-btn', () => {
        // 改动已由 markRulesDataDirty 的钩子实时写回预设快照，关闭无需再弹「未保存」确认。
        closeRuleSearchModal({ reset: true });
        closeScopeTagsModal({ reset: true });
        $('#blai-purifier-popup').fadeOut(getFadeDuration('out'));
    });
    const settings = extension_settings[extensionName];
    normalizeZhVariantSettings(settings);
    const syncSkipUserToggle = () => {
        syncToggleState('#blai-skip-user-toggle', settings.skipUserMessages === true, {
            onTitle: '关闭跳过用户消息',
            offTitle: '开启跳过用户消息',
            stateSelector: '.blai-switch-state',
        });
    };
    syncSkipUserToggle();

    const syncComposerButtonToggle = () => {
        syncToggleState('#blai-composer-button-toggle', settings.showComposerAiRewriteButton === true, {
            onTitle: '关闭 AI改写快捷键',
            offTitle: '开启 AI改写快捷键',
            ariaLabel: true,
        });
    };
    syncComposerButtonToggle();

    const syncShujukuAutoRewriteToggle = () => {
        syncToggleState('#blai-shujuku-auto-rewrite-toggle', settings.shujukuAutoProgramRewriteEnabled === true, {
            onTitle: '关闭数据库自动净化',
            offTitle: '开启数据库自动净化',
            ariaLabel: true,
        });
    };
    syncShujukuAutoRewriteToggle();

    $(document).off('click', '#blai-shujuku-auto-rewrite-toggle').on('click', '#blai-shujuku-auto-rewrite-toggle', function(e) {
        e.preventDefault();
        settings.shujukuAutoProgramRewriteEnabled = settings.shujukuAutoProgramRewriteEnabled !== true;
        if (!settings.shujukuAutoProgramRewriteEnabled) clearPendingShujukuRewrite();
        saveSettingsDebounced();
        syncShujukuAutoRewriteToggle();
    });

    $(document).off('click', '#blai-composer-button-toggle').on('click', '#blai-composer-button-toggle', function(e) {
        e.preventDefault();
        const enabled = settings.showComposerAiRewriteButton !== true;
        updateComposerButtonSetting(enabled);
        syncComposerButtonToggle();
    });

    $(document).off('click', '#blai-skip-user-toggle').on('click', '#blai-skip-user-toggle', function(e) {
        e.preventDefault();
        settings.skipUserMessages = settings.skipUserMessages !== true;
        saveSettingsDebounced();
        syncSkipUserToggle();
    });

    $(document).off('click', '.blai-persona-description-protect-toggle').on('click', '.blai-persona-description-protect-toggle', function(e) {
        e.preventDefault();
        settings.protectPersonaDescription = settings.protectPersonaDescription !== true;
        saveSettingsDebounced();
        syncPersonaDescriptionProtectionControl();
    });

    bindRuleEvents();
    bindScopeEvents();
    bindDeepCleanEvents();
    bindDiffEvents();
    bindThemeEvents();
    bindZhEvents();
    bindAiSettingsEvents();
    bindPresetEvents();
    bindHostLifecycleEvents();
}
