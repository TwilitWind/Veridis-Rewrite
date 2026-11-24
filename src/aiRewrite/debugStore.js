/**
 * AI 改写诊断的存储层：常量、脱敏、localStorage 读写、事件合并。
 * 显示层见 debugView.js，对外入口见 debug.js。
 */
import { extensionName } from '../settings/defaults.js';
import { aiRewriteState } from './state.js';

export const debugLogStorageKey = `${extensionName}_ai_rewrite_debug_events`;
export const criticalDebugLogStorageKey = `${extensionName}_ai_rewrite_critical_debug_events`;
export const debugLogDomAttribute = 'data-veridis-ai-rewrite-debug-events';
// 只保留最近 100 条：普通与关键缓冲共用同一个上限，
// 不再让关键缓冲单独堆到 160 条——否则总量会超过用户设定的 100。
export const debugLogLimit = 100;
export const criticalDebugLogLimit = debugLogLimit;
export const criticalDebugStages = new Set([
    'streaming-xml-end-detected',
    'content-snapshot-frozen',
    'task-built',
    'popup-preparing',
    'request-claimed',
    'pre-run-validation',
    'run-start',
    'fetch-start',
    'fetch-response',
    'apply-deferred',
    'response-deferred',
    'final-cleanse-ready',
    'apply-start',
    'apply-success',
    'atomic-commit',
    'apply-skip',
    'task-cancelled',
    'popup-cleared',
]);

export function sanitizeDebugValue(value, depth = 0) {
    if (depth > 3) return '[depth-limit]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeDebugValue(item, depth + 1));
    if (typeof value === 'object') {
        const output = {};
        Object.entries(value).forEach(([key, item]) => {
            if (/^(prompt|promptTemplate|aiPromptTemplate|rewritten|originalMessage|messageText|text)$/i.test(key)
                || /api.?key|authorization/i.test(key)) {
                output[key] = '[redacted]';
                return;
            }
            output[key] = sanitizeDebugValue(item, depth + 1);
        });
        return output;
    }
    return String(value);
}

export function readStoredDebugEvents() {
    try {
        const raw = localStorage.getItem(debugLogStorageKey);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function readStoredCriticalDebugEvents() {
    try {
        const raw = localStorage.getItem(criticalDebugLogStorageKey);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function writeStoredDebugEvents(events) {
    try {
        localStorage.setItem(debugLogStorageKey, JSON.stringify(events.slice(-debugLogLimit)));
    } catch {
        // 忽略存储失败；控制台/运行时日志仍然可用。
    }
}

export function writeStoredCriticalDebugEvents(events) {
    try {
        localStorage.setItem(criticalDebugLogStorageKey, JSON.stringify(events.slice(-criticalDebugLogLimit)));
    } catch {
        // 忽略存储失败；运行时日志仍然可用。
    }
}

export function mergeDebugEvents(...groups) {
    const seen = new Set();
    return groups.flat().filter((event) => {
        const key = `${event?.time}|${event?.stage}|${JSON.stringify(event?.details || {})}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => String(a?.time || '').localeCompare(String(b?.time || '')));
}

// 清空两份缓冲：内存、localStorage、以及挂在 documentElement 上的镜像副本。
// 只清显示不动存储会让用户下次刷新看到旧日志，反过来说"清不掉"。
export function clearAiRewriteDebugEvents() {
    aiRewriteState.debugEvents = [];
    aiRewriteState.criticalDebugEvents = [];
    try {
        localStorage.removeItem(debugLogStorageKey);
        localStorage.removeItem(criticalDebugLogStorageKey);
    } catch {
        // 忽略存储清空失败。
    }
    try {
        globalThis.__veridisAiRewriteLog = [];
    } catch {
        // 忽略全局副本清理失败。
    }
    try {
        document?.documentElement?.setAttribute?.(debugLogDomAttribute, '[]');
    } catch {
        // 忽略 DOM 副本清理失败。
    }
}

export function getMergedAiRewriteDebugEvents() {
    const combined = mergeDebugEvents(
        readStoredCriticalDebugEvents(),
        aiRewriteState.criticalDebugEvents || [],
        readStoredDebugEvents(),
        aiRewriteState.debugEvents || [],
    );
    const seen = new Set();
    const deduped = combined.filter((event) => {
        const key = `${event.time}|${event.stage}|${JSON.stringify(event.details || {})}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(-debugLogLimit);
    aiRewriteState.debugEvents = deduped.slice(-debugLogLimit);
    aiRewriteState.criticalDebugEvents = deduped
        .filter(event => criticalDebugStages.has(event.stage))
        .slice(-criticalDebugLogLimit);
    writeStoredDebugEvents(aiRewriteState.debugEvents);
    writeStoredCriticalDebugEvents(aiRewriteState.criticalDebugEvents);
    return deduped;
}
