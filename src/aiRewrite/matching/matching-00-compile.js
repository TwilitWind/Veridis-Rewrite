/** matching 的分块：compile。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { omitVariableUpdates, collectVariableUpdateRanges } from '../../text/variableUpdates.js';
import { logger } from '../../log.js';
import { buildSimpleTargetPattern, buildTargetLiteralPattern, pickReplacement, resolveProcessorReplacement } from '../../rules/engine.js';
import { compileRegexTarget } from '../../rules/regex.js';
import { getZhVariantCompatOptions, isZhDictionaryReady } from '../../zh/dictionary.js';
import { collectMvuStatusPlaceholderRanges } from '../../scope/model.js';
import { collectXmlCommentRanges, maskXmlCommentRanges } from '../commentProtection.js';
import { collectScopeRanges } from '../planning.js';

export function collectAiScopeSegments(text) {
    const source = String(text || '');
    return source.length > 0 ? [{
        index: 0,
        start: 0,
        end: source.length,
        outerStart: 0,
        outerEnd: source.length,
    }] : [];
}

export function getAiScopeRequestText(text) {
    return omitVariableUpdates(String(text || ''));
}

function rangeOverlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

function rangeOverlapsAny(start, end, ranges) {
    return ranges.some((range) => rangeOverlaps(start, end, range.start, range.end));
}

function intersectRanges(leftRanges, rightRanges) {
    const intersections = [];
    for (const left of leftRanges) {
        for (const right of rightRanges) {
            const start = Math.max(left.start, right.start);
            const end = Math.min(left.end, right.end);
            if (start < end) intersections.push({ start, end });
        }
    }
    return intersections.sort((left, right) => left.start - right.start || left.end - right.end);
}

function subtractRanges(sourceRanges, excludedRanges) {
    const excluded = [...excludedRanges]
        .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end) && range.start < range.end)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const remaining = [];

    for (const sourceRange of sourceRanges) {
        let cursor = sourceRange.start;
        for (const excludedRange of excluded) {
            if (excludedRange.end <= cursor) continue;
            if (excludedRange.start >= sourceRange.end) break;
            if (excludedRange.start > cursor) {
                remaining.push({ start: cursor, end: Math.min(excludedRange.start, sourceRange.end) });
            }
            cursor = Math.max(cursor, excludedRange.end);
            if (cursor >= sourceRange.end) break;
        }
        if (cursor < sourceRange.end) remaining.push({ start: cursor, end: sourceRange.end });
    }

    return remaining;
}

function collectCodeRanges(text) {
    const ranges = [];
    const fenceRegex = /```[\s\S]*?```/g;
    let fenceMatch;
    while ((fenceMatch = fenceRegex.exec(text)) !== null) {
        ranges.push({ start: fenceMatch.index, end: fenceMatch.index + fenceMatch[0].length });
        if (fenceMatch[0].length === 0) fenceRegex.lastIndex += 1;
    }

    for (let index = 0; index < text.length; index++) {
        if (text[index] !== '`' || rangeOverlapsAny(index, index + 1, ranges)) continue;
        const endIndex = text.indexOf('`', index + 1);
        if (endIndex < 0) break;
        if (!text.slice(index + 1, endIndex).includes('\n')) {
            ranges.push({ start: index, end: endIndex + 1 });
        }
        index = endIndex;
    }

    return ranges.sort((a, b) => a.start - b.start);
}

export function compileAiMatchers(settings, options = {}) {
    const hasExplicitZhCompatibility = Object.hasOwn(options, 'useZhVariantCompat');
    const useZhVariantCompat = hasExplicitZhCompatibility
        ? options.useZhVariantCompat === true
        : settings.zhVariantCompatEnabled === true && isZhDictionaryReady(settings);
    const zhVariantOptions = options.zhVariantOptions || getZhVariantCompatOptions(settings);
    const matchers = [];

    (settings.rules || []).forEach((rule, ruleIndex) => {
        if (!rule || rule.enabled === false) return;
        (rule.subRules || []).forEach((subRule, subRuleIndex) => {
            if (!subRule || subRule.enabled === false || subRule.rewriteMode !== 'ai') return;
            const mode = subRule.mode || 'text';
            const targets = Array.isArray(subRule.targets) ? subRule.targets : [];
            const replacements = Array.isArray(subRule.replacements) ? subRule.replacements : [];
            const ruleLabel = subRule.remark || rule.name || `规则分组 ${ruleIndex + 1}`;
            const base = {
                ruleIndex,
                subRuleIndex,
                ruleName: rule.name || '',
                ruleLabel,
                mode,
                replacements,
                aiPromptTemplate: String(subRule.aiPromptTemplate || ''),
            };

            targets.forEach((target) => {
                const normalizedTarget = String(target || '');
                if (!normalizedTarget) return;
                try {
                    if (mode === 'regex') {
                        const compiled = compileRegexTarget(normalizedTarget, { useZhVariantCompat, zhVariantOptions });
                        if (!compiled.ok) {
                            logger.warn(`AI 改写忽略非法正则表达式: ${normalizedTarget} (${compiled.error.message})`);
                            return;
                        }
                        const regex = new RegExp(compiled.value.regex.source, compiled.value.regex.flags);
                        if (regex.test('')) {
                            logger.warn(`AI 改写忽略空匹配正则: ${normalizedTarget}`);
                            return;
                        }
                        regex.lastIndex = 0;
                        matchers.push({ ...base, target: normalizedTarget, regex });
                        return;
                    }

                    const pattern = mode === 'simple'
                        ? buildSimpleTargetPattern(normalizedTarget, useZhVariantCompat, zhVariantOptions)
                        : buildTargetLiteralPattern(normalizedTarget, useZhVariantCompat, zhVariantOptions);
                    const regex = new RegExp(pattern, 'gmu');
                    if (regex.test('')) {
                        logger.warn(`AI 改写忽略空匹配规则: ${normalizedTarget}`);
                        return;
                    }
                    regex.lastIndex = 0;
                    matchers.push({ ...base, target: normalizedTarget, regex });
                } catch (err) {
                    logger.warn(`AI 改写规则解析失败: ${normalizedTarget}`, err);
                }
            });
        });
    });

    return matchers;
}

export function collectAiMatches(text, settings, aiSettings, options = {}) {
    const source = String(text || '');
    const segments = collectAiScopeSegments(source);
    if (segments.length === 0) return [];
    const codeRanges = collectCodeRanges(source);
    const placeholderRanges = collectMvuStatusPlaceholderRanges(source);
    const commentRanges = [
        ...collectVariableUpdateRanges(source),
        ...(aiSettings.protectXmlComments === true ? collectXmlCommentRanges(source) : []),
    ].sort((a, b) => a.start - b.start);
    const scopeScanText = commentRanges.length > 0 ? maskXmlCommentRanges(source, commentRanges) : source;
    const scopeRanges = collectScopeRanges(scopeScanText, settings);
    const scopeTagMode = settings.scopeTagMode === 'cleanse-inside' ? 'cleanse-inside' : 'protect';
    const isAllowedByScope = (start, end) => {
        if (scopeTagMode === 'cleanse-inside') {
            return scopeRanges.some((range) => start >= range.bodyStart && end <= range.bodyEnd);
        }
        return !rangeOverlapsAny(start, end, scopeRanges);
    };
    const matches = [];

    const matchers = Array.isArray(options.compiledMatchers)
        ? options.compiledMatchers
        : compileAiMatchers(settings, options);
    for (const matcher of matchers) {
        for (const segment of segments) {
            matcher.regex.lastIndex = segment.start;
            let match;
            while ((match = matcher.regex.exec(source)) !== null) {
                const matchedText = String(match[0] || '');
                const start = match.index;
                const end = start + matchedText.length;
                if (start >= segment.end) break;
                if (end > segment.end) {
                    if (matchedText.length === 0) matcher.regex.lastIndex += 1;
                    continue;
                }
                if (!matchedText || end <= start) {
                    matcher.regex.lastIndex += 1;
                    continue;
                }
                if (isAllowedByScope(start, end)
                    && !rangeOverlapsAny(start, end, placeholderRanges)
                    && !rangeOverlapsAny(start, end, codeRanges)
                    && !rangeOverlapsAny(start, end, commentRanges)) {
                    matches.push({
                        ...matcher,
                        matchedText,
                        captures: match.slice(1),
                        groups: match.groups && typeof match.groups === 'object' ? { ...match.groups } : null,
                        start,
                        end,
                    });
                }
            }
        }
    }

    return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function getAiProgramFallbackReplacement(match, sourceText = '') {
    const replacements = Array.isArray(match?.replacements) ? match.replacements : [];
    if (replacements.length === 0) return '';

    if (match.mode === 'regex') {
        const args = [
            ...(Array.isArray(match.captures) ? match.captures : []),
            Number(match.start) || 0,
            String(sourceText || ''),
        ];
        if (match.groups && typeof match.groups === 'object') args.push(match.groups);
        return resolveProcessorReplacement({ kind: 'regex', replacements }, String(match.matchedText || ''), args);
    }

    return String(pickReplacement(replacements) ?? '');
}

export function getOccurrenceProgramFallbackText(occurrence, sourceText) {
    // 自动任务只在回退时选定；即使删除也要保留，供后续终结使用。
    if (occurrence.programFallbackText === undefined) {
        occurrence.programFallbackText = getAiProgramFallbackReplacement(occurrence, sourceText);
    }
    return occurrence.programFallbackText;
}

export function applyAiProgramFallbackMatches(text, matches = []) {
    const source = String(text || '');
    if (!source || !Array.isArray(matches) || matches.length === 0) return source;

    const sorted = [...matches]
        .filter((match) => Number.isFinite(Number(match?.start)) && Number.isFinite(Number(match?.end)) && Number(match.end) > Number(match.start))
        .sort((a, b) => Number(b.start) - Number(a.start) || Number(b.end) - Number(a.end));
    const appliedRanges = [];
    let output = source;

    for (const match of sorted) {
        const start = Math.max(0, Math.min(output.length, Number(match.start)));
        const end = Math.max(start, Math.min(output.length, Number(match.end)));
        if (appliedRanges.some((range) => start < range.end && range.start < end)) continue;
        if (output.slice(start, end) !== String(match.matchedText || '')) continue;

        const replacement = getAiProgramFallbackReplacement(match, source);
        output = output.slice(0, start) + replacement + output.slice(end);
        appliedRanges.push({ start, end });
    }

    return output;
}

export function collectEditableRanges(text, settings, aiSettings) {
    const source = String(text || '');
    const xmlSegments = collectAiScopeSegments(source);
    if (xmlSegments.length === 0) return [];

    const commentRanges = [
        ...collectVariableUpdateRanges(source),
        ...(aiSettings?.protectXmlComments === true ? collectXmlCommentRanges(source) : []),
    ].sort((a, b) => a.start - b.start);
    const scopeScanText = commentRanges.length > 0 ? maskXmlCommentRanges(source, commentRanges) : source;
    const scopeRanges = collectScopeRanges(scopeScanText, settings);
    const scopeTagMode = settings?.scopeTagMode === 'cleanse-inside' ? 'cleanse-inside' : 'protect';
    const xmlBodies = xmlSegments.map((segment) => ({ start: segment.start, end: segment.end }));
    const scopeEditable = scopeTagMode === 'cleanse-inside'
        ? intersectRanges(xmlBodies, scopeRanges.map((range) => ({ start: range.bodyStart, end: range.bodyEnd })))
        : subtractRanges(xmlBodies, scopeRanges.map((range) => ({ start: range.start, end: range.end })));
    const editable = subtractRanges(scopeEditable, [
        ...collectMvuStatusPlaceholderRanges(source),
        ...collectCodeRanges(source),
        ...commentRanges,
    ]);

    return editable;
}

function addDelimitedSentenceWrappers(text, range, open, close, wrappers) {
    let cursor = range.start;
    while (cursor < range.end) {
        const openStart = text.indexOf(open, cursor);
        if (openStart < 0 || openStart >= range.end) break;
        const closeStart = text.indexOf(close, openStart + open.length);
        if (closeStart < 0 || closeStart >= range.end) break;
        wrappers.push({
            start: openStart,
            end: closeStart + close.length,
            interiorStart: openStart + open.length,
            interiorEnd: closeStart,
        });
        cursor = closeStart + close.length;
    }
}

function addAsteriskSentenceWrappers(text, range, marker, wrappers) {
    const markers = [];
    for (let cursor = range.start; cursor < range.end;) {
        const token = text.startsWith('**', cursor) ? '**' : text[cursor] === '*' ? '*' : '';
        if (!token) {
            cursor += 1;
            continue;
        }
        if (token === marker) markers.push(cursor);
        cursor += token.length;
    }
    for (let index = 0; index + 1 < markers.length; index += 2) {
        const openStart = markers[index];
        const closeStart = markers[index + 1];
        wrappers.push({
            start: openStart,
            end: closeStart + marker.length,
            interiorStart: openStart + marker.length,
            interiorEnd: closeStart,
        });
    }
}

export function collectSentenceWrappers(text, range) {
    const wrappers = [];
    addDelimitedSentenceWrappers(text, range, '“', '”', wrappers);
    addDelimitedSentenceWrappers(text, range, '‘', '’', wrappers);
    addDelimitedSentenceWrappers(text, range, '「', '」', wrappers);
    addDelimitedSentenceWrappers(text, range, '『', '』', wrappers);
    addDelimitedSentenceWrappers(text, range, '（', '）', wrappers);
    addDelimitedSentenceWrappers(text, range, '(', ')', wrappers);
    addAsteriskSentenceWrappers(text, range, '*', wrappers);
    addAsteriskSentenceWrappers(text, range, '**', wrappers);
    return wrappers;
}

