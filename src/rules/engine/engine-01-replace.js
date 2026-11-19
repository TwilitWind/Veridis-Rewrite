/**
 * engine.js 拆分产物（replace）：12 个顶层声明，11208 字节 / 277 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { mergeScopeTagsWithBuiltins, collectMvuStatusPlaceholderRanges } from '../../scope/model.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { programRuntimeState } from '../state.js';
import { resolveProcessorReplacement, projectTrackedRangesThroughReplacement, getReplaceCallbackOffset, buildProcessors } from './engine-00-patterns.js';

export function applyCompiledReplacementsWithTrackedRanges(originalText, processors = [], ranges = [], options = {}) {
    const source = String(originalText ?? '');
    if (!source) return { text: source, ranges: [...ranges], valid: true };

    let text = source;
    let trackedRanges = (Array.isArray(ranges) ? ranges : []).map((range) => ({ ...range }));
    let protectedRanges = [
        ...collectMvuStatusPlaceholderRanges(source),
        ...(options.protectedRanges || []).map((range) => ({ ...range })),
    ];
    let valid = trackedRanges.every((range) => Number.isInteger(range.start)
        && Number.isInteger(range.end)
        && range.start >= 0
        && range.end >= range.start
        && range.end <= source.length);
    if (!valid) return { text: source, ranges: trackedRanges, valid: false };

    (Array.isArray(processors) ? processors : []).forEach((proc) => {
        if (!proc?.regex) return;
        let priorReplacementDelta = 0;
        text = text.replace(proc.regex, (match, ...args) => {
            const sourceStart = getReplaceCallbackOffset(args);
            if (sourceStart < 0) {
                valid = false;
                return String(resolveProcessorReplacement(proc, match, args) ?? '');
            }
            const start = sourceStart + priorReplacementDelta;
            const end = start + String(match).length;
            if (protectedRanges.some((range) => start < range.end && range.start < end)) return match;
            const replacement = String(resolveProcessorReplacement(proc, match, args, {
                ...options,
                occurrenceStart: sourceStart,
            }) ?? '');
            protectedRanges = projectTrackedRangesThroughReplacement(protectedRanges, start, end, replacement.length);
            trackedRanges = projectTrackedRangesThroughReplacement(trackedRanges, start, end, replacement.length);
            priorReplacementDelta += replacement.length - String(match).length;
            return replacement;
        });
    });
    return { text, ranges: trackedRanges, valid };
}

function getEnabledScopeTagsForSettings(settings = {}) {
    const scopeTags = mergeScopeTagsWithBuiltins(
        settings?.scopeTags,
        settings?.scopeTagBuiltinDismissed
    );
    return scopeTags.filter((tag) => tag.enabled !== false);
}

function getScopeTagModeForSettings(settings = {}) {
    return settings?.scopeTagMode === 'cleanse-inside' ? 'cleanse-inside' : 'protect';
}

function findNextScopeTagMatch(text, fromIndex, scopeTags) {
    let nextMatch = null;
    for (const scopeTag of scopeTags) {
        const startIndex = text.indexOf(scopeTag.startTag, fromIndex);
        if (startIndex < 0) continue;
        if (!nextMatch || startIndex < nextMatch.index || (startIndex === nextMatch.index && scopeTag.startTag.length > nextMatch.scopeTag.startTag.length)) {
            nextMatch = { index: startIndex, scopeTag };
        }
    }
    return nextMatch;
}

export function applyScopedCompiledReplacementsWithTrackedRanges(originalText, processors = [], scopeSettings = {}, ranges = [], options = {}) {
    const source = String(originalText ?? '');
    let valid = Array.isArray(ranges) && ranges.every((range) => Number.isInteger(range?.start)
        && Number.isInteger(range?.end)
        && range.start >= 0
        && range.end >= range.start
        && range.end <= source.length);
    if (!source || !valid) return { text: source, ranges: [...ranges], valid };

    const scopeTags = getEnabledScopeTagsForSettings(scopeSettings);
    const shouldCleanseInside = getScopeTagModeForSettings(scopeSettings) === 'cleanse-inside';
    const transformRange = (start, end, shouldTransform) => {
        const localRanges = [];
        for (const range of ranges) {
            if (range.end <= start || range.start >= end) continue;
            if (range.start < start || range.end > end) {
                valid = false;
                continue;
            }
            localRanges.push({ ...range, start: range.start - start, end: range.end - start });
        }
        const segment = source.slice(start, end);
        // 保持普通整条消息的作用域解析；只有替换匹配被保护。
        const localOptions = options.protectedRanges ? {
            ...options,
            scopeStart: start,
            protectedRanges: options.protectedRanges
                .filter((range) => range.start < end && start < range.end)
                .map((range) => ({
                    start: Math.max(range.start, start) - start,
                    end: Math.min(range.end, end) - start,
                })),
        } : {
            ...options,
            scopeStart: start,
        };
        const result = shouldTransform
            ? applyCompiledReplacementsWithTrackedRanges(segment, processors, localRanges, localOptions)
            : { text: segment, ranges: localRanges, valid: true };
        valid = valid && result.valid;
        return result;
    };

    let output = '';
    let cursor = 0;
    let trackedRanges = [];
    const appendRange = (start, end, shouldTransform) => {
        const result = transformRange(start, end, shouldTransform);
        const outputStart = output.length;
        output += result.text;
        trackedRanges.push(...result.ranges.map((range) => ({
            ...range,
            start: range.start + outputStart,
            end: range.end + outputStart,
        })));
    };

    if (scopeTags.length === 0) {
        appendRange(0, source.length, !shouldCleanseInside);
        return { text: output, ranges: trackedRanges, valid };
    }

    while (cursor < source.length) {
        const nextMatch = findNextScopeTagMatch(source, cursor, scopeTags);
        if (!nextMatch) {
            appendRange(cursor, source.length, !shouldCleanseInside);
            break;
        }

        const { index, scopeTag } = nextMatch;
        if (index > cursor) {
            appendRange(cursor, index, !shouldCleanseInside);
        }

        const tagBodyStart = index + scopeTag.startTag.length;
        const endIndex = source.indexOf(scopeTag.endTag, tagBodyStart);
        if (endIndex < 0) {
            if (shouldCleanseInside) {
                appendRange(index, source.length, false);
                break;
            }
            appendRange(index, tagBodyStart, false);
            cursor = tagBodyStart;
            continue;
        }

        appendRange(index, tagBodyStart, false);
        appendRange(tagBodyStart, endIndex, shouldCleanseInside);
        appendRange(endIndex, endIndex + scopeTag.endTag.length, false);
        cursor = endIndex + scopeTag.endTag.length;
    }

    if (trackedRanges.length !== ranges.length) valid = false;
    return { text: output, ranges: trackedRanges, valid };
}

export function applyScopedCompiledReplacements(originalText, processors = [], scopeSettings = {}, options = {}) {
    return applyScopedCompiledReplacementsWithTrackedRanges(
        originalText,
        processors,
        scopeSettings,
        [],
        options,
    ).text;
}

export function applyStreamingProgram(originalText, choices) {
    buildProcessors();
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName] || {};
    const frameChoices = { previous: choices, next: [] };
    const programText = applyScopedCompiledReplacements(
        originalText,
        programRuntimeState.streamingProcessors,
        settings,
        { streamingChoices: frameChoices },
    );
    // 只保留最新帧中的实际出现位置，不保留历史选择。
    choices.splice(0, choices.length, ...frameChoices.next);
    return programText;
}

export function applyCompiledReplacements(originalText, processors = [], options = {}) {
    return applyCompiledReplacementsWithTrackedRanges(originalText, processors, [], options).text;
}

export function countProcessorMatches(originalText, processors = []) {
    if (typeof originalText !== 'string' || !originalText) return 0;
    let hitCount = 0;
    const protectedRanges = collectMvuStatusPlaceholderRanges(originalText);

    (Array.isArray(processors) ? processors : []).forEach((processor) => {
        if (!processor?.regex) return;
        const regex = new RegExp(processor.regex.source, processor.regex.flags);
        let match;
        while ((match = regex.exec(originalText)) !== null) {
            const matchedText = String(match[0] || '');
            if (matchedText) {
                if (!protectedRanges.some((range) => match.index < range.end && range.start < match.index + matchedText.length)) hitCount++;
            }
            else regex.lastIndex++;
        }
    });

    return hitCount;
}

export function countScopedProcessorMatches(originalText, processors = [], settings = {}) {
    if (typeof originalText !== 'string' || !originalText) return 0;

    const scopeTags = getEnabledScopeTagsForSettings(settings);
    const shouldCleanseInside = getScopeTagModeForSettings(settings) === 'cleanse-inside';
    if (scopeTags.length === 0) {
        return shouldCleanseInside ? 0 : countProcessorMatches(originalText, processors);
    }

    let hitCount = 0;
    let cursor = 0;
    const countRange = (start, end) => {
        if (end > start) hitCount += countProcessorMatches(originalText.slice(start, end), processors);
    };

    while (cursor < originalText.length) {
        const nextMatch = findNextScopeTagMatch(originalText, cursor, scopeTags);
        if (!nextMatch) {
            if (!shouldCleanseInside) countRange(cursor, originalText.length);
            break;
        }

        const { index, scopeTag } = nextMatch;
        if (!shouldCleanseInside) countRange(cursor, index);

        const tagBodyStart = index + scopeTag.startTag.length;
        const endIndex = originalText.indexOf(scopeTag.endTag, tagBodyStart);
        if (endIndex < 0) {
            if (!shouldCleanseInside) countRange(tagBodyStart, originalText.length);
            break;
        }

        if (shouldCleanseInside) countRange(tagBodyStart, endIndex);
        cursor = endIndex + scopeTag.endTag.length;
    }

    return hitCount;
}

export function applyScopedReplacementsWithTrackedRanges(originalText, ranges = [], options = {}) {
    if (typeof originalText !== 'string' || !originalText) {
        return { text: String(originalText ?? ''), ranges: [...ranges], valid: true };
    }

    const { extension_settings } = getAppContext();
    const scopeSettings = options.scopeSettings ?? (extension_settings?.[extensionName] || {});
    const scopeTags = getEnabledScopeTagsForSettings(scopeSettings);
    if (getScopeTagModeForSettings(scopeSettings) === 'cleanse-inside' && scopeTags.length === 0) {
        return { text: originalText, ranges: [...ranges], valid: true };
    }
    const processors = buildProcessors();
    return applyScopedCompiledReplacementsWithTrackedRanges(
        originalText,
        processors,
        scopeSettings,
        ranges,
        options,
    );
}

export function applyScopedReplacements(originalText, options = {}) {
    return applyScopedReplacementsWithTrackedRanges(originalText, [], options).text;
}

