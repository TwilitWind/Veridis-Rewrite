/** 负责读取当前 SillyTavern/浏览器宿主上下文与稳定的当前角色/聊天身份。它不负责功能行为。 */
import { getAppContext, getCurrentChatMetadata } from './appContext.js';
import { logger } from '../log.js';

export function getGlobalObject() {
    return typeof globalThis !== 'undefined' ? globalThis : window;
}

export function getSillyTavernContextSnapshot() {
    const { getSillyTavernContext } = getAppContext();
    if (typeof getSillyTavernContext === 'function') {
        try {
            const context = getSillyTavernContext();
            if (context && typeof context === 'object') return context;
        } catch (error) {
            logger.warn('获取 SillyTavern 上下文失败', error);
        }
    }

    try {
        const context = getGlobalObject().SillyTavern?.getContext?.();
        if (context && typeof context === 'object') return context;
    } catch (error) {
        logger.warn('从 globalThis.SillyTavern 获取上下文失败', error);
    }

    return {};
}

export function getDeepCleanHostOwnershipSnapshot() {
    const appContext = getAppContext();
    let worldInfoState = {};
    let currentPersonaIdentity = '';

    try {
        const state = appContext.getWorldInfoState?.();
        if (state && typeof state === 'object') worldInfoState = state;
    } catch (error) {
        logger.warn('读取 SillyTavern World Info 关系状态失败', error);
    }

    try {
        currentPersonaIdentity = String(appContext.getCurrentPersonaIdentity?.() || '');
    } catch (error) {
        logger.warn('读取 SillyTavern 当前 Persona 身份失败', error);
    }

    return { worldInfoState, currentPersonaIdentity };
}

export function getWorldInfoNames() {
    const appContext = getAppContext();
    try {
        const names = appContext.getWorldInfoNames?.();
        if (Array.isArray(names)) return names;
    } catch (error) {
        logger.warn('读取世界书列表失败', error);
    }
    const hostNames = getSillyTavernContextSnapshot()?.getWorldInfoNames;
    if (typeof hostNames === 'function') {
        try {
            const names = hostNames();
            if (Array.isArray(names)) return names;
        } catch (error) {
            logger.warn('从 SillyTavern 上下文读取世界书列表失败', error);
        }
    }
    return [];
}

const fallbackChatIdentityByReference = new WeakMap();
let fallbackChatIdentitySequence = 0;

export function getCurrentChatIdentity() {
    const appContext = getAppContext();
    const hostContext = getSillyTavernContextSnapshot();
    const chatMetadata = getCurrentChatMetadata();
    let currentChatId;
    try {
        currentChatId = typeof hostContext?.getCurrentChatId === 'function'
            ? hostContext.getCurrentChatId()
            : undefined;
    } catch (error) {
        logger.warn('读取 SillyTavern 当前聊天 ID 失败，改用稳定对象身份。', error);
    }
    const hostCandidates = [
        currentChatId,
        hostContext?.chatId,
        hostContext?.chat_id,
        chatMetadata?.chatId,
        chatMetadata?.chat_id,
    ];
    for (const candidate of hostCandidates) {
        if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
            return `host:${String(candidate).trim()}`;
        }
    }

    const chat = appContext?.chat;
    if (!chat || typeof chat !== 'object') return '';
    if (!fallbackChatIdentityByReference.has(chat)) {
        fallbackChatIdentityByReference.set(chat, `chat-ref:${++fallbackChatIdentitySequence}`);
    }
    return fallbackChatIdentityByReference.get(chat);
}

export function getCurrentCharacterContext() {
    const hostContext = getSillyTavernContextSnapshot();
    const characterId = hostContext?.characterId;
    const characters = hostContext?.characters;
    if (characterId === undefined || characterId === null || String(characterId).trim() === '' || !Array.isArray(characters)) {
        return { key: '', name: '无当前角色卡' };
    }

    const character = characters[characterId];
    const name = String(character?.name || '').trim();
    if (!character || !name) {
        return { key: '', name: '无当前角色卡' };
    }
    return { key: `chid:${String(characterId).trim()}`, name };
}

export function getCurrentChatCompletionPresetName() {
    const select = document.querySelector('#settings_preset_openai');
    if (!select || !(select instanceof HTMLSelectElement)) return "";
    const option = select.options[select.selectedIndex];
    return String(option?.textContent || '').trim();
}
