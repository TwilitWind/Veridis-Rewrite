/**
 * AI 改写诊断的对外入口：记录事件、导出日志文本。
 * 存储与常量在 debugStore.js，中文排版在 debugView.js。
 */
import { logger } from '../log.js';
import { aiRewriteState } from './state.js';
import {
    clearAiRewriteDebugEvents,
    criticalDebugStages,
    criticalDebugLogLimit,
    debugLogDomAttribute,
    debugLogLimit,
    mergeDebugEvents,
    readStoredCriticalDebugEvents,
    readStoredDebugEvents,
    sanitizeDebugValue,
    writeStoredCriticalDebugEvents,
    writeStoredDebugEvents,
    getMergedAiRewriteDebugEvents,
} from './debugStore.js';
import {
    countDebugDisplayEvents,
    formatDebugDisplayEvents,
    getDebugDisplayOrder,
    getDebugLogTimeZoneLabel,
    refreshMountedDebugDisplay,
    setDebugDisplayOrder,
} from './debugView.js';

export function recordAiRewriteDebug(stage, details = {}, level = 'info') {
    const sanitizedDetails = sanitizeDebugValue(details);
    const event = {
        time: new Date().toISOString(),
        stage: String(stage || 'unknown'),
        details: sanitizedDetails,
    };
    const stateEvents = Array.isArray(aiRewriteState.debugEvents)
        ? aiRewriteState.debugEvents
        : [];
    stateEvents.push(event);
    aiRewriteState.debugEvents = stateEvents.slice(-debugLogLimit);
    if (criticalDebugStages.has(event.stage)) {
        const criticalEvents = Array.isArray(aiRewriteState.criticalDebugEvents)
            ? aiRewriteState.criticalDebugEvents
            : [];
        criticalEvents.push(event);
        aiRewriteState.criticalDebugEvents = criticalEvents.slice(-criticalDebugLogLimit);
        const storedCritical = readStoredCriticalDebugEvents();
        storedCritical.push(event);
        writeStoredCriticalDebugEvents(storedCritical);
    }
    const exposedEvents = mergeDebugEvents(
        aiRewriteState.criticalDebugEvents || [],
        aiRewriteState.debugEvents || [],
    );
    try {
        globalThis.__veridisAiRewriteLog = exposedEvents;
    } catch {
        // 忽略全局挂载失败。
    }
    try {
        document?.documentElement?.setAttribute?.(debugLogDomAttribute, JSON.stringify(exposedEvents));
    } catch {
        // 忽略 DOM 挂载失败；存储/控制台日志仍然可用。
    }
    const stored = readStoredDebugEvents();
    stored.push(event);
    writeStoredDebugEvents(stored);
    refreshMountedDebugDisplay(aiRewriteState.debugEvents);
    let summary = '';
    try {
        summary = JSON.stringify(sanitizedDetails);
        if (summary.length > 700) summary = `${summary.slice(0, 700)}...`;
    } catch {
        summary = '';
    }
    const message = `[改写诊断] ${event.stage}${summary ? ` | ${summary}` : ''}`;
    if (level === 'warn') logger.warn(message, event.details);
    else if (level === 'error') logger.error(message, event.details);
    else logger.info(message, event.details);
    return event;
}

export function recordAiRewriteRuntimeDebug(stage, details = {}, level = 'info') {
    return recordAiRewriteDebug(stage, details, level);
}

export function getAiRewriteDebugDisplayText() {
    return formatDebugDisplayEvents(getMergedAiRewriteDebugEvents());
}

export function getAiRewriteDebugLogText() {
    return JSON.stringify(getMergedAiRewriteDebugEvents(), null, 2);
}

export function getAiRewriteRuntimeLog() {
    return getMergedAiRewriteDebugEvents();
}

export function getAiRewriteDebugEventCount() {
    return countDebugDisplayEvents(getMergedAiRewriteDebugEvents());
}

// 日期顺序偏好记在 localStorage：用户选过一次，下次打开还是那个顺序。
const debugDisplayOrderStorageKey = 'veridis_rewrite_debug_display_order';

export function readDebugDisplayOrderPreference() {
    try {
        return localStorage.getItem(debugDisplayOrderStorageKey) === 'desc' ? 'desc' : 'asc';
    } catch {
        return 'asc';
    }
}

export function applyDebugDisplayOrder(order) {
    const normalized = setDebugDisplayOrder(order);
    try {
        localStorage.setItem(debugDisplayOrderStorageKey, normalized);
    } catch {
        // 忽略存储失败；本次会话内仍然生效。
    }
    return normalized;
}

export { getDebugDisplayOrder };
export { getDebugLogTimeZoneLabel };
export { clearAiRewriteDebugEvents };
