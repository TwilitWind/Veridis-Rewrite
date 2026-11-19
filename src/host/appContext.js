// 负责由扩展入口点一次性配置的宿主注入应用引用。
const appContext = {
    extension_settings: null,
    saveSettingsDebounced: null,
    eventSource: null,
    event_types: null,
    getStreamingProcessor: null,
    saveChat: null,
    chat: null,
    getSillyTavernContext: null,
    applyStreamFadeIn: null,
    markWindowedChatDirtyFromIndex: null,
    getWorldInfoState: null,
    getWorldInfoNames: null,
    setWorldInfoCache: null,
    getCurrentPersonaIdentity: null,
    veridisExternalId: '',
    veridisExtensionFolderName: '',
    readExtensionManifest: null,
    getVeridisCommit: null,
    getSillyTavernVersion: null,
    getAiRewriteDiagnosticConfig: null,
    getCoarsePlatform: null,
    getInstalledEnabledExtensions: null,
};

export function initAppContext(context) {
    Object.assign(appContext, context);
}

export function getAppContext() {
    return appContext;
}

export function getCurrentChatMetadata() {
    if (typeof appContext.getSillyTavernContext !== 'function') return null;
    try {
        const chatMetadata = appContext.getSillyTavernContext()?.chatMetadata;
        return chatMetadata && typeof chatMetadata === 'object' ? chatMetadata : null;
    } catch {
        return null;
    }
}
