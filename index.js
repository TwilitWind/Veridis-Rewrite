import * as extensionsModule from "../../../extensions.js";
import * as scriptModule from "../../../../script.js";
import { saveSettingsDebounced, eventSource, event_types, chat } from "../../../../script.js";
import { user_avatar } from "../../../personas.js";
import { world_info, worldInfoCache, world_names } from "../../../world-info.js";
import { applyStreamFadeIn } from "../../../util/stream-fadein.js";

import { extensionName } from './src/settings/defaults.js';
import { initAppContext } from './src/host/appContext.js';
import { logger } from './src/log.js';
import { bindEvents } from './src/events.js';
import { initRealtimeInterceptor } from './src/host/lifecycleEvents.js';
import { setupUI } from './src/ui/shell.js';
import { initViewportHeightStabilizer } from './src/ui/viewportHeight.js';
import { updateToolbarUI } from './src/presets/view.js';
import { applyCharacterPresetBinding, syncActivePresetSnapshot } from './src/presets/application.js';
import { setActivePresetSyncHook } from './src/rules/state.js';
import { showRiskConfirmModal } from './src/ui/notifications.js';
import { performGlobalChatMaintenance } from './src/chat/cleanse.js';
import { isTauriTavernHost, waitForTauriTavernReady } from './src/integrations/tauriTavern.js';
import { isBaiBaiToolkitInstalled } from './src/integrations/baiBai.js';
import { isLoreFrameInstalled } from './src/integrations/loreFrame.js';
import { createDefaultSettings, ensureSettingsShape, maybeCopyLegacySettings, maybeImportModifiedSettingsIntoSharedNamespace, migrateOldData, needsCustomGlobalPromptMigrationConfirmation, resolveCustomGlobalPromptMigration } from './src/settings/migration.js';
import { syncComposerButtonScript } from './src/aiRewrite/composerButton.js';
import { readExtensionManifest } from './src/host/extensionManifest.js';
import { resolveExtensionIdentity } from './src/host/extensionIdentity.js';
import { collectInstalledEnabledExtensions, getEnabledExtensionExternalIds } from './src/feedback/payload.js';
import { bindUpdateStatusEvents, initializeUpdateStatus } from './src/update/status.js';

const { extension_settings, getContext: getSillyTavernContext } = extensionsModule;
const { externalId: veridisExternalId, folderName: veridisExtensionFolderName, templateDirectory } = resolveExtensionIdentity(import.meta.url);
let isBooted = false;
let veridisCommit = '';

function getCoarsePlatform() {
    const platform = String(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '').toLowerCase();
    if (platform.includes('win')) return 'Windows';
    if (platform.includes('android')) return 'Android';
    if (platform.includes('iphone') || platform.includes('ipad') || platform.includes('ios')) return 'iOS';
    if (platform.includes('mac')) return 'macOS';
    if (platform.includes('linux')) return 'Linux';
    return 'Unknown';
}

async function captureVeridisCommit() {
    const context = getSillyTavernContext();
    const getRequestHeaders = context?.getRequestHeaders;
    if (typeof getRequestHeaders !== 'function') return null;

    try {
        const response = await fetch('/api/extensions/version', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                extensionName: veridisExtensionFolderName,
                global: extensionsModule.extensionTypes[veridisExternalId] === 'global',
            }),
        });
        if (!response.ok) return null;

        const versionInfo = await response.json();
        const currentCommitHash = String(versionInfo?.currentCommitHash || '').trim();
        if (currentCommitHash.length >= 7) veridisCommit = currentCommitHash.slice(0, 7);
        return versionInfo;
    } catch {
        // 反馈上报在提交不可用时不会影响正在运行的扩展。
        return null;
    }
}

const readHostExtensionManifest = (externalId) => readExtensionManifest(externalId, extensionsModule.getExtensionManifest);

initAppContext({
    extension_settings,
    saveSettingsDebounced,
    eventSource,
    event_types,
    getStreamingProcessor: () => scriptModule.streamingProcessor,
    saveChat: scriptModule.saveChat,
    chat,
    getSillyTavernContext,
    applyStreamFadeIn,
    markWindowedChatDirtyFromIndex: scriptModule.markWindowedChatDirtyFromIndex,
    getWorldInfoState: () => world_info,
    getWorldInfoNames: () => (Array.isArray(world_names) ? [...world_names] : []),
    setWorldInfoCache: (name, data) => worldInfoCache.set(name, data),
    getCurrentPersonaIdentity: () => user_avatar,
    veridisExternalId,
    veridisExtensionFolderName,
    readExtensionManifest: readHostExtensionManifest,
    getVeridisCommit: () => veridisCommit,
    getSillyTavernVersion: () => scriptModule.CLIENT_VERSION,
    getAiRewriteDiagnosticConfig: () => {
        const aiRewrite = extension_settings[extensionName].aiRewrite;
        return {
            baseUrl: aiRewrite.baseUrl,
            model: aiRewrite.model,
            temperature: aiRewrite.temperature,
            topP: aiRewrite.topP,
            topK: aiRewrite.topK,
            frequencyPenalty: aiRewrite.frequencyPenalty,
            presencePenalty: aiRewrite.presencePenalty,
            repetitionPenalty: aiRewrite.repetitionPenalty,
            maxTokens: aiRewrite.maxTokens,
            timeoutMs: aiRewrite.timeoutMs,
            maxRetries: aiRewrite.maxRetries,
            maxItemsPerRequest: aiRewrite.maxItemsPerRequest,
            maxContextChars: aiRewrite.maxContextChars,
        };
    },
    getCoarsePlatform,
    getInstalledEnabledExtensions: async () => {
        const externalIds = getEnabledExtensionExternalIds({
            extensionNames: extensionsModule.extensionNames,
            extensionTypes: extensionsModule.extensionTypes,
            disabledExtensions: extension_settings.disabledExtensions,
            veridisExternalId,
        });
        const manifestsByExternalId = Object.fromEntries(await Promise.all(externalIds.map(async (externalId) => [
            externalId,
            await readHostExtensionManifest(externalId),
        ])));
        return collectInstalledEnabledExtensions({ externalIds, manifestsByExternalId });
    },
});

// 规则/AI 改动落盘即写回当前预设快照，切换/关闭预设不再弹「未保存」确认。
setActivePresetSyncHook(syncActivePresetSnapshot);

jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || createDefaultSettings();

    maybeImportModifiedSettingsIntoSharedNamespace();
    maybeCopyLegacySettings();
    migrateOldData();
    ensureSettingsShape();

    const boot = async () => {
        if (isBooted) return;
        isBooted = true;
        await waitForTauriTavernReady();
        logger.info('[词汇映射] 启动初始化开始...');
        initViewportHeightStabilizer();
        if (isTauriTavernHost()) logger.info('[词汇映射] 已启用 TauriTavern 兼容层');
        if (isBaiBaiToolkitInstalled()) logger.info('[词汇映射] 已启用柏宝箱兼容层');
        if (isLoreFrameInstalled()) logger.info('[词汇映射] 已启用 LoreFrame 兼容层');
        await setupUI(extensionsModule.renderExtensionTemplateAsync, templateDirectory);
        const aiRewrite = extension_settings[extensionName].aiRewrite;
        if (needsCustomGlobalPromptMigrationConfirmation(aiRewrite)) {
            const accepted = await showRiskConfirmModal('【词汇映射】的全局提示词写法已经更新。检测到你当前使用的是自定义提示词，是否应用新版默认全局提示词？');
            resolveCustomGlobalPromptMigration(aiRewrite, accepted);
            saveSettingsDebounced();
        }
        bindEvents();
        bindUpdateStatusEvents();
        syncComposerButtonScript(extension_settings[extensionName].showComposerAiRewriteButton);
        initRealtimeInterceptor();
        updateToolbarUI();
        applyCharacterPresetBinding(true);
        performGlobalChatMaintenance();
        logger.info('[词汇映射] 启动初始化完成');
        void (async () => {
            const versionInfo = await captureVeridisCommit();
            await initializeUpdateStatus({
                versionInfo,
                isGlobal: extensionsModule.extensionTypes[veridisExternalId] === 'global',
            });
        })();
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            return boot();
        });
        if (document.getElementById('send_textarea')) boot();
    }
});
