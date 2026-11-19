/** 负责每个分支可替换的阶段记录，以及文本被清除后的无文本撤回保护。 */
import { getMessageDiffBranchKey } from '../chat/messageBranch.js';
import { extensionName } from '../settings/defaults.js';

const branchMetaKey = '__blai_diff_branch_meta';
const messageProtectionKey = 'message';

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isProtectionOnly(entry) {
    return isObject(entry) && entry.reverted === true && Object.keys(entry).length === 1;
}

function isCanonical(entry) {
    return isObject(entry)
        && typeof entry.originalMes === 'string'
        && (entry.aiMes === null || typeof entry.aiMes === 'string')
        && typeof entry.programMes === 'string'
        && typeof entry.reverted === 'boolean'
        && !Object.hasOwn(entry, 'hasAiTrace') && !Object.hasOwn(entry, 'finalSource');
}

export function getMessageDiffMeta(msg, branchKey = getMessageDiffBranchKey(msg)) {
    if (!branchKey) return null;
    const entry = msg?.[branchMetaKey]?.[branchKey];
    return isCanonical(entry) ? {
        originalMes: entry.originalMes,
        aiMes: entry.aiMes,
        programMes: entry.programMes,
        reverted: entry.reverted,
    } : null;
}

function writeBranchMeta(msg, branchKey, next) {
    if (!isObject(msg) || !branchKey) return false;
    if (!isCanonical(next)) throw new TypeError('Difference requires canonical stage texts and revert state');
    const previous = getMessageDiffMeta(msg, branchKey);
    const clearsMessageProtection = !next.reverted && isProtectionOnly(msg[branchMetaKey]?.[messageProtectionKey]);
    if (!clearsMessageProtection && previous && Object.keys(next).every(key => previous[key] === next[key])) return false;
    if (!isObject(msg[branchMetaKey])) msg[branchMetaKey] = {};
    msg[branchMetaKey][branchKey] = next;
    // 显式重新净化在提交成功后释放旧的整条消息级选择。
    if (clearsMessageProtection) delete msg[branchMetaKey][messageProtectionKey];
    return true;
}

export function writeMessageDiffProgram(msg, branchKey, originalMes, programMes) {
    return writeBranchMeta(msg, branchKey, { originalMes, aiMes: null, programMes, reverted: false });
}

export function writeMessageDiffAiStage(msg, branchKey, originalMes, aiMes, programMes) {
    return writeBranchMeta(msg, branchKey, { originalMes, aiMes, programMes, reverted: false });
}

export function setMessageDiffReverted(msg, reverted, branchKey = getMessageDiffBranchKey(msg)) {
    const entry = getMessageDiffMeta(msg, branchKey);
    return entry ? writeBranchMeta(msg, branchKey, { ...entry, reverted }) : false;
}

export function isMessageDiffReverted(msg) {
    const container = msg?.[branchMetaKey];
    return isProtectionOnly(container?.[messageProtectionKey])
        || container?.[getMessageDiffBranchKey(msg)]?.reverted === true;
}

/** 清除窗口外的阶段文本，只保留显式的撤回保护。 */
export function pruneChatDiffMetadata(chat, retainedIndices) {
    if (!Array.isArray(chat)) return -1;
    const retained = new Set(retainedIndices);
    let firstChanged = -1;
    for (let index = 0; index < chat.length; index++) {
        const msg = chat[index];
        const container = msg?.[branchMetaKey];
        if (retained.has(index) || msg?.is_user === true || !isObject(container)) continue;
        for (const [key, entry] of Object.entries(container)) {
            if (isProtectionOnly(entry)) continue;
            if (entry?.reverted === true) container[key] = { reverted: true };
            else delete container[key];
            if (firstChanged < 0) firstChanged = index;
        }
        if (Object.keys(container).length === 0) {
            delete msg[branchMetaKey];
            if (firstChanged < 0) firstChanged = index;
        }
    }
    return firstChanged;
}

export function clearMessageDiffMeta(msg, branchKey = getMessageDiffBranchKey(msg)) {
    const container = msg?.[branchMetaKey];
    if (!isObject(container) || !Object.hasOwn(container, branchKey)) return false;
    delete container[branchKey];
    if (Object.keys(container).length === 0) delete msg[branchMetaKey];
    return true;
}

// 在宿主拼接其 Swipe 数组之后，由现有的宿主删除监听器调用。
export function deleteMessageDiffSwipe(msg, deletedIndex) {
    const container = msg?.[branchMetaKey];
    if (!isObject(container) || !Number.isInteger(deletedIndex) || deletedIndex < 0) return false;
    const keys = Object.keys(container).filter(key => /^swipe:\d+$/.test(key))
        .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    let changed = false;
    for (const key of keys) {
        const index = Number(key.slice(6));
        if (index < deletedIndex) continue;
        const entry = container[key];
        delete container[key];
        if (index > deletedIndex) container[`swipe:${index - 1}`] = entry;
        changed = true;
    }
    if (Object.keys(container).length === 0) delete msg[branchMetaKey];
    return changed;
}

/** 聊天加载时的一次性破坏性转换；读取方只接受规范记录。 */
export function migrateChatDiffMetadata(chat, chatMetadata) {
    let changed = false;
    for (const msg of Array.isArray(chat) ? chat : []) {
        if (!isObject(msg)) continue;
        const container = msg[branchMetaKey];
        if (isObject(container)) {
            for (const [key, entry] of Object.entries(container)) {
                if (isCanonical(entry) || isProtectionOnly(entry)) continue;
                const hasAi = entry?.hasAiTrace === true;
                const compatible = isObject(entry)
                    && (Object.hasOwn(entry, 'hasAiTrace') || Object.hasOwn(entry, 'finalSource'))
                    && typeof entry.originalMes === 'string' && typeof entry.programMes === 'string'
                    && (!hasAi || (entry.finalSource === 'program' && typeof entry.aiMes === 'string'));
                if (compatible) {
                    container[key] = {
                        originalMes: entry.originalMes,
                        aiMes: hasAi ? entry.aiMes : null,
                        programMes: entry.programMes,
                        reverted: false,
                    };
                } else delete container[key];
                changed = true;
            }
            if (Object.keys(container).length === 0) {
                delete msg[branchMetaKey];
                changed = true;
            }
        }
        // 旧版闸门作用于整条消息（跨所有 Swipe），直到重新净化为止。
        // 转移该范围时无需要求或重建比较文本。
        if (msg.__blai_is_reverted === true) {
            if (!isObject(msg[branchMetaKey])) msg[branchMetaKey] = {};
            msg[branchMetaKey][messageProtectionKey] = { reverted: true };
            changed = true;
        }
        for (const key of [
            '__blai_is_reverted', '__blai_original_mes', '__blai_diff_source_signature',
            '__blai_diff_last_cleaned_mes', '__blai_diff_ai_program_mes', '__blai_diff_ai_final_mes',
            '__blai_diff_has_ai_trace', '__blai_diff_final_source', '__blai_diff_swipe_key',
        ]) {
            if (!Object.hasOwn(msg, key)) continue;
            delete msg[key];
            changed = true;
        }
    }
    const cacheKey = `${extensionName}_diff_state_v3`;
    if (isObject(chatMetadata) && Object.hasOwn(chatMetadata, cacheKey)) {
        delete chatMetadata[cacheKey];
        changed = true;
    }
    return changed;
}
