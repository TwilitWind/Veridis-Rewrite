/** engine 的分块：patterns。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { buildChineseVariantPattern, getChineseTextVariantLengths } from '../../zh/conversion.js';
import { buildSimpleWildcardPattern, compileRegexTarget } from '../regex.js';
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { programRuntimeState } from '../state.js';
import { computeRuleFingerprint } from '../ruleIdentity.js';
import { logger } from '../../log.js';
import { getZhVariantCompatOptions, isZhDictionaryReady } from '../../zh/dictionary.js';

function escapeRegExpLiteral(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTargetLiteralPattern(value = '', useZhVariantCompat = false, zhVariantOptions = {}) {
    return useZhVariantCompat ? buildChineseVariantPattern(value, zhVariantOptions) : escapeRegExpLiteral(value);
}

function buildLegacySimpleTargetPattern(target = '') {
    return String(target ?? '')
        .replace(/[.+^$()[\]\\]/g, '\\$&')
        .replace(/\{([^}]+)\}/g, (match, group) => {
            const alternatives = group.split(',').map((item) => item.trim()).filter(Boolean);
            return alternatives.length > 0 ? `(?:${alternatives.join('|')})` : match;
        })
        .replace(/\*/g, buildSimpleWildcardPattern());
}

export function buildSimpleTargetPattern(target = '', useZhVariantCompat = false, zhVariantOptions = {}) {
    if (!useZhVariantCompat) return buildLegacySimpleTargetPattern(target);

    const source = String(target ?? '');
    let pattern = '';

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char === '*') {
            pattern += buildSimpleWildcardPattern();
            continue;
        }

        if (char === '?') {
            pattern += '?';
            continue;
        }

        if (char === '{') {
            const closeIndex = source.indexOf('}', index + 1);
            if (closeIndex > index) {
                const alternatives = source
                    .slice(index + 1, closeIndex)
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item) => buildTargetLiteralPattern(item, useZhVariantCompat, zhVariantOptions));
                if (alternatives.length > 0) {
                    pattern += `(?:${alternatives.join('|')})`;
                    index = closeIndex;
                    continue;
                }
            }
        }

        pattern += buildTargetLiteralPattern(char, useZhVariantCompat, zhVariantOptions);
    }

    return pattern;
}

function buildTextTargetEntries(targets, replacementsMap, useZhVariantCompat = false, zhVariantOptions = {}) {
    return [...new Set(targets)]
        .sort((a, b) => b.length - a.length)
        .map((target) => {
            const pattern = buildTargetLiteralPattern(target, useZhVariantCompat, zhVariantOptions);
            const entry = {
                target,
                replacements: replacementsMap[target] || [],
                pattern,
            };
            if (useZhVariantCompat) {
                entry.matchRegex = new RegExp(`^(?:${pattern})$`, 'mu');
                entry.matchLengths = getChineseTextVariantLengths(target, zhVariantOptions);
            }
            return entry;
        });
}

function groupTextTargetEntriesByLength(entries = []) {
    const grouped = new Map();
    entries.forEach((entry) => {
        const lengths = Array.isArray(entry.matchLengths) && entry.matchLengths.length > 0
            ? entry.matchLengths
            : [entry.target.length];
        lengths.forEach((length) => {
            const key = Number(length);
            if (!Number.isFinite(key) || key < 0) return;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(entry);
        });
    });
    return grouped;
}

function findTextTargetEntryForMatch(processor, match = '') {
    const candidates = processor?.targetEntriesByLength?.get(String(match).length)
        || processor?.targetEntries
        || [];
    return candidates.find((entry) => entry.matchRegex?.test(match));
}

function createProcessorBucket() {
    return {
        textTargets: [],
        wordToReplacements: Object.create(null),
        // 文本规则会聚合成一个 processor，必须逐查找词记住来源指纹，命中时才能定位到具体规则。
        wordToSources: Object.create(null),
        processors: [],
    };
}

function addTextTargetToBucket(bucket, target, replacements, source) {
    bucket.textTargets.push(target);
    bucket.wordToReplacements[target] = replacements;
    (bucket.wordToSources[target] ||= []).push(source);
}

function addProcessorToBucket(bucket, processor) {
    bucket.processors.push(processor);
}

function finalizeProcessorBucket(bucket, useZhVariantCompat, zhVariantOptions) {
    const processors = [...bucket.processors];
    if (bucket.textTargets.length > 0) {
        const targetEntries = buildTextTargetEntries(
            bucket.textTargets,
            bucket.wordToReplacements,
            useZhVariantCompat,
            zhVariantOptions,
        );
        const textRegex = new RegExp(`(${targetEntries.map((entry) => entry.pattern).join('|')})`, 'gmu');
        processors.unshift({
            regex: textRegex,
            replacerMap: bucket.wordToReplacements,
            wordToSources: bucket.wordToSources,
            targetEntries: useZhVariantCompat ? targetEntries : undefined,
            targetEntriesByLength: useZhVariantCompat ? groupTextTargetEntriesByLength(targetEntries) : undefined,
            kind: 'text',
        });
    }
    return processors;
}

/** 命中的查找词 → 来源指纹列表；中文变体命中时用 targetEntries 找回原始查找词。 */
export function getProcessorHitSources(processor, matchedText = '') {
    if (!processor) return [];
    if (processor.kind === 'regex' || processor.kind === 'simple') {
        return processor.source ? [processor.source] : [];
    }
    const direct = processor.wordToSources?.[matchedText];
    if (direct) return direct;
    const entry = findTextTargetEntryForMatch(processor, matchedText);
    return (entry && processor.wordToSources?.[entry.target]) || [];
}

function compileReplacementProcessors(rules, options, includeAi) {
    const useZhVariantCompat = options.useZhVariantCompat === true;
    const zhVariantOptions = options.zhVariantOptions || {};
    const warn = typeof options.warn === 'function' ? options.warn : () => {};
    const dataBucket = createProcessorBucket();

    for (const rule of (Array.isArray(rules) ? rules : [])) {
        if (rule.enabled === false) continue;
        const subRulesToProcess = Array.isArray(rule.subRules) ? rule.subRules : [];

        for (const sub of subRulesToProcess) {
            if (!sub || typeof sub !== 'object' || sub.enabled === false) continue;
            const rewriteMode = sub.rewriteMode === 'ai' ? 'ai' : 'program';
            if (rewriteMode !== 'program' && !includeAi) continue;

            const mode = sub.mode || 'text';
            const targets = Array.isArray(sub.targets) ? [...sub.targets] : [];
            const replacements = Array.isArray(sub.replacements) ? [...sub.replacements] : [];
            const fingerprint = computeRuleFingerprint(rule, sub);
            const source = {
                fingerprint,
                ruleName: String(rule?.name || ''),
                remark: String(sub?.remark || ''),
                mode,
            };

            if (mode === 'text') {
                for (const t of targets) {
                    if (t) {
                        addTextTargetToBucket(dataBucket, t, replacements, source);
                    }
                }
            } else if (mode === 'regex') {
                for (const t of targets) {
                    if (t) {
                        const compiled = compileRegexTarget(t, { useZhVariantCompat, zhVariantOptions });
                        if (!compiled.ok) {
                            warn(`忽略非法正则表达式: ${t} (${compiled.error.message})`);
                            continue;
                        }
                        const processorBase = {
                            replacements,
                            kind: 'regex',
                            source,
                        };
                        addProcessorToBucket(dataBucket, {
                            ...processorBase,
                            regex: new RegExp(compiled.value.regex.source, compiled.value.regex.flags),
                        });
                    }
                }
            } else if (mode === 'simple') {
                for (const t of targets) {
                    if (t) {
                        try {
                            const pattern = buildSimpleTargetPattern(t, useZhVariantCompat, zhVariantOptions);
                            let testRegex = new RegExp(pattern, 'gmu');
                            if (testRegex.test("")) {
                                warn(`拦截到危险的简易空匹配规则，已忽略: ${t}`);
                                continue;
                            }

                            addProcessorToBucket(dataBucket, { regex: new RegExp(pattern, 'gmu'), replacements, kind: 'simple', source });
                        } catch (e) {
                            warn(`简易规则解析失败: ${t}`);
                        }
                    }
                }
            }
        }
    }

    return {
        dataProcessors: finalizeProcessorBucket(dataBucket, useZhVariantCompat, zhVariantOptions),
        textTargetCount: dataBucket.textTargets.length,
    };
}

export function compileProcessors(rules = [], options = {}) {
    return compileReplacementProcessors(rules, options, false);
}

export function buildProcessors() {
    if (!programRuntimeState.isRegexDirty) {
        return programRuntimeState.activeProcessors;
    }
    const { extension_settings } = getAppContext();
    const settings = extension_settings[extensionName] || {};
    const options = {
        useZhVariantCompat: settings.zhVariantCompatEnabled === true && isZhDictionaryReady(settings),
        zhVariantOptions: getZhVariantCompatOptions(settings),
        warn: (message) => logger.warn(message),
    };
    const compiled = compileProcessors(settings.rules || [], options);
    // AI 模式规则只在 AI 改写开启时参与流式 Program 处理；
    // 关闭总开关后，必须只剩 Program 规则生效。
    const includeAiInStreaming = settings.aiRewrite?.enabled === true;

    programRuntimeState.activeProcessors = compiled.dataProcessors;
    programRuntimeState.streamingProcessors = compileReplacementProcessors(settings.rules || [], options, includeAiInStreaming).dataProcessors;
    programRuntimeState.isRegexDirty = false;
    const regexProcessorCount = programRuntimeState.activeProcessors.filter((processor) => processor.kind === 'regex').length;
    const simpleProcessorCount = programRuntimeState.activeProcessors.filter((processor) => processor.kind === 'simple').length;
    logger.info(`规则处理器构建完成，共 ${programRuntimeState.activeProcessors.length} 个数据处理器（文本:${compiled.textTargetCount} | 正则:${regexProcessorCount} | 简易:${simpleProcessorCount}）`);
    return programRuntimeState.activeProcessors;
}

export function pickReplacement(replacements) {
    if (!Array.isArray(replacements) || replacements.length === 0) return '';
    const randIndex = Math.floor(Math.random() * replacements.length);
    return replacements[randIndex];
}

function extractRegexCaptures(args) {
    const hasNamedGroups = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
    const trailingMetaCount = hasNamedGroups ? 3 : 2;
    const captureCount = Math.max(0, args.length - trailingMetaCount);
    return args.slice(0, captureCount);
}

function renderRegexReplacementTemplate(template, captures) {
    const source = String(template ?? '');
    let output = '';

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (char === '\\') {
            const nextChar = source[index + 1];
            if (nextChar === undefined) {
                output += '\\';
                continue;
            }
            if (nextChar === 'n') output += '\n';
            else if (nextChar === 'r') output += '\r';
            else if (nextChar === 't') output += '\t';
            else if (nextChar === '\\') output += '\\';
            else if (nextChar === '$') output += '$';
            else output += `\\${nextChar}`;
            index++;
            continue;
        }

        if (char === '$') {
            const firstDigit = source[index + 1];
            if (/[1-9]/.test(firstDigit || '')) {
                let captureDigits = firstDigit;
                const secondDigit = source[index + 2];
                if (/\d/.test(secondDigit || '')) captureDigits += secondDigit;
                const captureIndex = Number(captureDigits) - 1;
                output += captures[captureIndex] ?? '';
                index += captureDigits.length;
                continue;
            }
        }

        output += char;
    }

    return output;
}

// 只有当前 Original → 临时流式阶段提供选择记忆。
// 该作用域段内的坐标属于本处理器的输入，绝不属于 AI/Diff。
function pickProgramCandidate(replacements, processor, match, options = {}) {
    if (replacements.length <= 1) return replacements[0] ?? '';
    const choices = options.streamingChoices;
    if (!choices) return pickReplacement(replacements);
    const start = options.occurrenceStart;
    const scopeStart = options.scopeStart || 0;
    const matchedText = String(match);
    const existing = choices.previous.find((choice) => choice.processor === processor
        && choice.scopeStart === scopeStart && choice.start === start
        && choice.matchedText === matchedText);
    const choice = existing || {
        processor, scopeStart, start, matchedText, candidate: pickReplacement(replacements),
    };
    choices.next.push(choice);
    return choice.candidate;
}

export function resolveProcessorReplacement(proc, match, args = [], options = {}) {
    if (proc?.kind === 'regex') {
        const reps = proc.replacements;
        if (!reps || reps.length === 0) return '';
        const rep = pickProgramCandidate(reps, proc, match, options);
        return renderRegexReplacementTemplate(rep, extractRegexCaptures(args));
    }

    if (proc?.kind === 'simple') {
        const reps = proc.replacements;
        if (!reps || reps.length === 0) return '';
        const rep = pickProgramCandidate(reps, proc, match, options);
        return String(rep ?? '');
    }

    const exactReps = proc?.replacerMap?.[match];
    const targetEntry = exactReps ? null : findTextTargetEntryForMatch(proc, match);
    const reps = exactReps || targetEntry?.replacements;
    if (!reps || reps.length === 0) return '';
    const rep = pickProgramCandidate(reps, proc, match, options);
    return rep;
}

export function projectTrackedRangesThroughReplacement(ranges, start, end, replacementLength) {
    const delta = replacementLength - (end - start);
    return ranges.map((range) => {
        if (range.end <= start) return range;
        if (range.start >= end) return { ...range, start: range.start + delta, end: range.end + delta };

        return {
            ...range,
            start: range.start < start ? range.start : start,
            end: end < range.end
                ? start + replacementLength + (range.end - end)
                : start + replacementLength,
        };
    });
}

export function getReplaceCallbackOffset(args = []) {
    const hasNamedGroups = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
    const offset = args[args.length - (hasNamedGroups ? 3 : 2)];
    return Number.isInteger(offset) ? offset : -1;
}

