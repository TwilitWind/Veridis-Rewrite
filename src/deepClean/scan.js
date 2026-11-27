import { collectAiMatches, compileAiMatchers } from '../aiRewrite/matching.js';
import { compileProcessors, countScopedProcessorMatches } from '../rules/engine.js';
import { getPresetRules } from '../presets/model.js';
import { SCOPE_TAG_MODES, normalizeScopeTagMode } from '../scope/model.js';

const affectedTypeKeys = ['Message', 'World Book'];
const scanChunkSize = 32;

function categoryForItem(item) {
    if (isWorldBookItem(item)) return 'World Book';
    if (item?.kind === 'user-message' || item?.kind === 'assistant-swipe') return 'Message';
    return 'Other';
}

/**
 * 世界书条目是配置数据，不是聊天消息里的正文/标签混合文本。
 * cleanse-inside 作用域（“只处理 <content>/<game> 等标签内文本”）只对聊天消息有意义：
 * 世界书条目没有这类包裹标签，按同一套规则处理会全文跳过，勾了世界书却一条不命中，
 * 最后还报成功——即用户看到的“假成功”。因此扫描与改写都必须让这类条目走全文。
 */
export function isWorldBookItem(item) {
    return item?.kind === 'embedded-world-book-entry' || item?.kind === 'external-world-book-entry';
}

/** 世界书条目忽略标签作用域，聊天消息继续按用户选择的模式处理。 */
export function scopeSettingsForDeepCleanItem(settings, item) {
    if (!isWorldBookItem(item)) return settings;
    return { ...settings, scopeTags: [], scopeTagBuiltinDismissed: [], scopeTagMode: SCOPE_TAG_MODES.PROTECT };
}

/** 冻结的 processingSemantics → 匹配器/提示词共用的作用域设置。 */
export function scopeSettingsFromSemantics(semantics = {}) {
    return {
        scopeTags: semantics.scopeTags || [],
        scopeTagBuiltinDismissed: semantics.scopeTagBuiltinDismissed || [],
        scopeTagMode: normalizeScopeTagMode(semantics.scopeTagMode),
    };
}

export function createDeepCleanMatcherSettings(input) {
    const semantics = input.processingSemantics || {};
    return {
        rules: getPresetRules(input.preset),
        ...scopeSettingsFromSemantics(semantics),
        zhVariantCompatEnabled: semantics.zhVariantCompatEnabled === true,
        zhVariantCompatOptions: semantics.zhVariantCompatOptions || {},
    };
}

export function getDeepCleanItemAiScopeSettings(input) {
    return {
        protectXmlComments: input.processingSemantics?.aiProtectXmlComments === true,
    };
}

export function collectDeepCleanAiMatches(input, item, compiledSemantics, settings = createDeepCleanMatcherSettings(input)) {
    const semantics = input.processingSemantics || {};
    const matcherOptions = {
        useZhVariantCompat: settings.zhVariantCompatEnabled === true
            && semantics.zhVariantDictionaryReady === true,
        zhVariantOptions: settings.zhVariantCompatOptions,
        compiledMatchers: compiledSemantics.aiMatchers,
    };
    return collectAiMatches(
        String(item?.originalText || ''),
        settings,
        getDeepCleanItemAiScopeSettings(input),
        matcherOptions,
    );
}

export async function scanDeepCleanContentItems(input, contentItems, options = {}) {
    const items = Array.isArray(contentItems) ? contentItems : [];
    const settings = createDeepCleanMatcherSettings(input);
    const matcherOptions = {
        useZhVariantCompat: settings.zhVariantCompatEnabled === true
            && input.processingSemantics?.zhVariantDictionaryReady === true,
        zhVariantOptions: settings.zhVariantCompatOptions,
    };
    const compiledSemantics = options.compiledSemantics || {
        programProcessors: compileProcessors(settings.rules, matcherOptions).dataProcessors,
        aiMatchers: compileAiMatchers(settings, matcherOptions),
    };
    const processors = compiledSemantics.programProcessors;
    const affectedByType = Object.fromEntries(affectedTypeKeys.map((key) => [key, 0]));
    const affectedItemIndexes = [];
    const affectedItemModes = {};
    let programHitCount = 0;
    let aiHitCount = 0;
    let pendingCharacterCount = 0;

    for (let chunkStart = 0; chunkStart < items.length; chunkStart += scanChunkSize) {
        if (options.shouldStop?.()) return null;
        const chunkEnd = Math.min(chunkStart + scanChunkSize, items.length);
        for (let itemIndex = chunkStart; itemIndex < chunkEnd; itemIndex++) {
            const item = items[itemIndex];
            const source = String(item?.originalText || '');
            const itemSettings = scopeSettingsForDeepCleanItem(settings, item);
            const programHits = item?.programEligible === true
                ? countScopedProcessorMatches(source, processors, itemSettings)
                : 0;
            const scanAiRules = (input.processingMode === 'program' && item?.programEligible === true)
                || (input.processingMode === 'program-ai' && item?.aiEligible === true);
            const aiHits = scanAiRules
                ? collectDeepCleanAiMatches(input, item, compiledSemantics, itemSettings).length
                : 0;
            const affected = programHits > 0 || aiHits > 0;

            programHitCount += programHits;
            aiHitCount += aiHits;
            if (affected) {
                affectedItemIndexes.push(itemIndex);
                affectedItemModes[itemIndex] = [
                    ...(programHits > 0 ? ['program'] : []),
                    ...(aiHits > 0 ? ['ai'] : []),
                ];
                affectedByType[categoryForItem(item)]++;
                pendingCharacterCount += source.length;
            }
        }
        options.onProgress?.({ current: chunkEnd, total: items.length });
        if (options.shouldStop?.()) return null;
        if (chunkEnd < items.length) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (options.shouldStop?.()) return null;
        }
    }

    return {
        scannedItemCount: items.length,
        deduplicatedEmbeddedCount: Number(items.deduplicatedEmbeddedCount) || 0,
        affectedItemCount: affectedItemIndexes.length,
        programHitCount,
        aiHitCount,
        pendingCharacterCount,
        affectedByType,
        affectedItemIndexes,
        affectedItemModes,
        compiledSemantics,
    };
}
