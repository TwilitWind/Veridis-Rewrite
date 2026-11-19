/**
 * matching.js 拆分产物（items）：11 个顶层声明，10679 字节 / 248 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { splitTextRangeIntoSentences as splitEditableRangeIntoSentences } from '../../text/sentences.js';
import { collectSentenceWrappers, getAiProgramFallbackReplacement, collectAiScopeSegments, collectEditableRanges, getAiScopeRequestText } from './matching-00-compile.js';

function getSentenceSpan(text, match, range, wrappers = []) {
    const sentences = splitEditableRangeIntoSentences(text, range);
    const first = sentences.find((sentence) => match.start >= sentence.start && match.start < sentence.end);
    const last = [...sentences].reverse().find((sentence) => match.end > sentence.start && match.end <= sentence.end);
    if (!first || !last) return { start: match.start, end: match.end };

    let start = first.start;
    let advanced = true;
    while (advanced) {
        const precedingClosers = wrappers.filter((wrapper) => wrapper.interiorEnd === start);
        const nextStart = precedingClosers.length > 0 ? Math.max(...precedingClosers.map((wrapper) => wrapper.end)) : start;
        advanced = nextStart > start && nextStart <= match.start;
        if (advanced) start = nextStart;
    }

    let end = last.end;
    let extended = true;
    while (extended) {
        const targetClosers = wrappers.filter((wrapper) => wrapper.start >= start
            && wrapper.start < end
            && wrapper.interiorEnd === end);
        const nextEnd = targetClosers.length > 0 ? Math.max(...targetClosers.map((wrapper) => wrapper.end)) : end;
        extended = nextEnd > end;
        if (extended) end = nextEnd;
    }
    while (start < match.start && /\s/u.test(text[start])) start += 1;
    while (end > match.end && /\s/u.test(text[end - 1])) end -= 1;
    return { start, end };
}

function getTextUnitSentences(text, range) {
    return splitEditableRangeIntoSentences(text, range)
        .filter((sentence) => text.slice(sentence.start, sentence.end)
            .replace(/[“”‘’「」『』（）()*]/gu, '')
            .trim() !== '');
}

export function getRewriteTargetRange(text, match, editableRange) {
    const wrappers = collectSentenceWrappers(text, editableRange);
    const containing = wrappers
        .filter((wrapper) => match.start >= wrapper.interiorStart && match.end <= wrapper.interiorEnd)
        .map((wrapper) => ({
            wrapper,
            interiorRange: { start: wrapper.interiorStart, end: wrapper.interiorEnd },
        }));
    const multiSentenceWrapper = containing
        .map((entry) => ({
            ...entry,
            sentenceCount: getTextUnitSentences(text, entry.interiorRange).length,
        }))
        .filter((entry) => entry.sentenceCount > 1)
        .sort((left, right) => (left.wrapper.end - left.wrapper.start) - (right.wrapper.end - right.wrapper.start))[0];
    const targetRange = { ...(multiSentenceWrapper?.interiorRange || editableRange) };
    // 相邻的包裹内散文是一个独立单元，即使没有句末终止符。
    for (const wrapper of wrappers) {
        if (wrapper.end <= match.start) targetRange.start = Math.max(targetRange.start, wrapper.end);
        if (wrapper.start >= match.end) targetRange.end = Math.min(targetRange.end, wrapper.start);
    }

    return getSentenceSpan(text, match, targetRange, wrappers);
}

function coalesceOverlappingRewriteTargets(targets) {
    const coalesced = [];
    for (const target of [...targets].sort((left, right) => left.start - right.start || left.end - right.end)) {
        const previous = coalesced.at(-1);
        if (previous && target.start < previous.end) {
            previous.end = Math.max(previous.end, target.end);
            previous.matches.push(target.match);
            continue;
        }
        coalesced.push({ start: target.start, end: target.end, matches: [target.match] });
    }
    return coalesced;
}

export function copyRawOccurrence(match, sentenceStart, sourceText, options) {
    return {
        ruleIndex: Number(match.ruleIndex),
        subRuleIndex: Number(match.subRuleIndex),
        aiPromptTemplate: String(match.aiPromptTemplate || ''),
        matchedText: String(match.matchedText || ''),
        relativeStart: match.start - sentenceStart,
        // 保留自动回退输入，但在 AI 路径上不选定候选。
        ...(options.includeProgramFallback !== false
            ? { programFallbackText: getAiProgramFallbackReplacement(match, sourceText) }
            : {
                mode: match.mode,
                replacements: [...match.replacements],
                captures: match.captures,
                groups: match.groups,
                start: match.start,
            }),
    };
}

export function buildRewriteItems(text, matches, settings, aiSettings, options = {}) {
    const source = String(text || '');
    if (!Array.isArray(matches) || matches.length === 0) return [];
    const segments = collectAiScopeSegments(source);
    const editableRanges = collectEditableRanges(source, settings, aiSettings);
    const targets = [];

    for (const match of matches) {
        const editableRange = editableRanges.find((range) => match.start >= range.start && match.end <= range.end);
        if (!editableRange) continue;
        const target = getRewriteTargetRange(source, match, editableRange);
        if (target.start > match.start || target.end < match.end || target.start >= target.end) continue;
        targets.push({ ...target, match });
    }

    return coalesceOverlappingRewriteTargets(targets)
        .map((target, index) => {
            const segment = segments.find((entry) => target.start >= entry.start && target.end <= entry.end);
            if (!segment) return null;
            return {
                id: typeof options.createId === 'function'
                    ? String(options.createId(index, target))
                    : `hit-${index + 1}`,
                segmentIndex: segment.index,
                start: target.start,
                end: target.end,
                relativeStart: target.start - segment.start,
                text: source.slice(target.start, target.end),
                matches: target.matches
                    .sort((left, right) => left.start - right.start || left.end - right.end)
                    .map((match) => copyRawOccurrence(match, target.start, source, options)),
            };
        })
        .filter(Boolean);
}

function isValidTrackedRange(range, sourceLength) {
    return Number.isInteger(range?.start)
        && Number.isInteger(range?.end)
        && range.start >= 0
        && range.end >= range.start
        && range.end <= sourceLength;
}

export function resolveRewriteTrackedRanges(sourceText, items, aiSettings) {
    const source = String(sourceText || '');
    const segments = collectAiScopeSegments(source);
    const ranges = [];

    for (const item of Array.isArray(items) ? items : []) {
        const itemId = String(item?.id || '');
        const segment = Number.isInteger(item?.segmentIndex) ? segments[item.segmentIndex] : null;
        const relativeStart = Number(item?.relativeStart);
        const itemText = String(item?.text || '');
        const start = segment && Number.isInteger(relativeStart) ? segment.start + relativeStart : -1;
        const end = start + itemText.length;
        if (!segment
            || start < segment.start
            || end > segment.end
            || source.slice(start, end) !== itemText) {
            return { valid: false, ranges: [], failedItemId: itemId };
        }

        ranges.push({
            itemId,
            rangeType: 'sentence',
            start,
            end,
        });
        for (const [occurrenceIndex, occurrence] of (item.matches || []).entries()) {
            const occurrenceStart = start + Number(occurrence?.relativeStart);
            const matchedText = String(occurrence?.matchedText || '');
            const occurrenceEnd = occurrenceStart + matchedText.length;
            if (!Number.isInteger(occurrenceStart)
                || !Number.isInteger(occurrenceEnd)
                || occurrenceStart < start
                || occurrenceEnd > end
                || occurrenceEnd <= occurrenceStart
                || source.slice(occurrenceStart, occurrenceEnd) !== matchedText) {
                return { valid: false, ranges: [], failedItemId: itemId };
            }
            ranges.push({
                itemId,
                occurrenceIndex,
                rangeType: 'occurrence',
                start: occurrenceStart,
                end: occurrenceEnd,
            });
        }
    }

    return { valid: true, ranges, failedItemId: '' };
}

export function materializeProjectedRewriteItems(programText, items, projectedRanges) {
    const source = String(programText || '');
    const ranges = Array.isArray(projectedRanges) ? projectedRanges : [];
    const materialized = [];

    for (const item of Array.isArray(items) ? items : []) {
        const itemId = String(item?.id || '');
        const sentenceRange = ranges.find((range) => range?.rangeType === 'sentence' && range.itemId === itemId);
        if (!isValidTrackedRange(sentenceRange, source.length)) {
            return { valid: false, items: [], failedItemId: itemId };
        }
        const projectedMatches = [];
        for (const [occurrenceIndex, occurrence] of (item.matches || []).entries()) {
            const occurrenceRange = ranges.find((range) => range?.rangeType === 'occurrence'
                && range.itemId === itemId
                && range.occurrenceIndex === occurrenceIndex);
            if (!isValidTrackedRange(occurrenceRange, source.length)
                || occurrenceRange.start < sentenceRange.start
                || occurrenceRange.end > sentenceRange.end) {
                return { valid: false, items: [], failedItemId: itemId };
            }
            projectedMatches.push({
                ...occurrence,
                projectedStart: occurrenceRange.start,
                projectedEnd: occurrenceRange.end,
            });
        }
        materialized.push({
            ...item,
            start: sentenceRange.start,
            end: sentenceRange.end,
            text: source.slice(sentenceRange.start, sentenceRange.end),
            matches: projectedMatches,
        });
    }

    return { valid: true, items: materialized, failedItemId: '' };
}

export function countMatchedAiRules(matches = []) {
    return new Set(matches.map(match => `${match.ruleIndex}:${match.subRuleIndex}`)).size;
}

export function extractCurrentAiRewriteScope(text, aiSettings) {
    const source = String(text || '');
    const segments = collectAiScopeSegments(source);
    if (segments.length === 0) {
        return { ok: false, text: '', tailLength: 0, reason: 'empty-message' };
    }
    const scopedText = getAiScopeRequestText(source);
    return {
        ok: true,
        text: scopedText,
        tailLength: Math.max(0, source.length - scopedText.length),
        reason: '',
    };
}

