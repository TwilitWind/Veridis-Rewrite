import { buildAiRewriteGenerateRawConfig, callTavernHelperGenerateRaw } from '../aiRewrite/generation.js';
import { parseAiRewriteResponseObject, validateAiRewriteEntries } from '../aiRewrite/response.js';
import { getPresetAiRewriteSettings } from '../presets/model.js';
import { renderDeepCleanAiRequest } from './aiPlanning.js';
import { buildDeepCleanProgramText } from './programProcessing.js';

const deepCleanAiRequestTimeoutMs = 300_000;

async function callDeepCleanGenerateRaw(requestConfig) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Deep Clean AI request timed out')), deepCleanAiRequestTimeoutMs);
    });
    try {
        return await Promise.race([
            callTavernHelperGenerateRaw(requestConfig),
            timeoutPromise,
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

function getFrozenAiSettings(run) {
    const presetSettings = getPresetAiRewriteSettings(run.input?.preset);
    if (!presetSettings) throw new Error('Deep Clean frozen preset has no AI Prompt settings');
    return {
        ...presetSettings,
        baseUrl: String(run.input?.aiConnection?.baseUrl || '').trim(),
        apiKey: String(run.input?.aiConnection?.apiKey || ''),
        model: String(run.input?.aiConnection?.model || '').trim(),
    };
}

function hasCompleteConnection(aiSettings) {
    return Boolean(aiSettings.baseUrl && aiSettings.apiKey && aiSettings.model);
}

function partitionResponseEntries(parsed, requestItems) {
    const entriesByItemIndex = new Map(requestItems.map((item) => [item.itemIndex, []]));
    for (const entry of Object.entries(parsed)) {
        const id = String(entry[0] || '');
        const ownerMatch = id.match(/^item-(\d+)(?:-|$)/);
        const itemIndex = ownerMatch ? Number(ownerMatch[1]) : -1;
        const ownedEntries = entriesByItemIndex.get(itemIndex);
        if (!ownedEntries) throw new Error(`Deep Clean AI returned unowned id: ${id || '(empty)'}`);
        ownedEntries.push(entry);
    }
    return entriesByItemIndex;
}

function getRewriteRange(requestItem, rewriteItem) {
    const sourceSegment = requestItem.sourceSegments?.[rewriteItem.segmentIndex];
    if (!sourceSegment) throw new Error(`Deep Clean AI target has no source segment: ${rewriteItem.id}`);
    const start = sourceSegment.start + rewriteItem.relativeStart;
    return { start, end: start + String(rewriteItem.text || '').length };
}

function applyAcceptedItemRewrites(effectiveSource, requestItem, accepted) {
    const replacements = requestItem.rewriteItems.map((rewriteItem) => {
        const range = getRewriteRange(requestItem, rewriteItem);
        if (effectiveSource.slice(range.start, range.end) !== String(rewriteItem.text || '')) {
            throw new Error(`Deep Clean AI target no longer matches source: ${rewriteItem.id}`);
        }
        return { ...range, rewritten: accepted.get(rewriteItem.id) };
    }).sort((left, right) => right.start - left.start);

    let candidate = effectiveSource;
    for (const replacement of replacements) {
        candidate = candidate.slice(0, replacement.start)
            + replacement.rewritten
            + candidate.slice(replacement.end);
    }
    return candidate;
}

export function resolveFinalProposedText(run, itemIndex) {
    const item = run.contentItems?.[itemIndex];
    const originalText = String(item?.originalText || '');
    // AI 改写开启时，AI 发起 / 响应失败的内容一律不进程序改写，保持原文并计入失败项。
    if (run.input?.processingMode === 'program-ai'
        && Array.isArray(run.aiFailedItemIndexes)
        && run.aiFailedItemIndexes.includes(itemIndex)) {
        return originalText;
    }
    const aiResult = run.aiProposedResults?.find((entry) => entry?.itemIndex === itemIndex);
    const aiSource = aiResult ? String(aiResult.aiCandidate || '') : originalText;
    if (run.input?.processingMode === 'program-ai') {
        const compiledSemantics = run.scanResult?.compiledSemantics;
        if (!item || !compiledSemantics) return aiSource;
        try {
            // AI 全部完成后才按序执行程序改写：程序规则作用于 AI 写回的文本。
            return buildDeepCleanProgramText(run.input, item, compiledSemantics, aiSource);
        } catch {
            return aiSource;
        }
    }
    const programResult = run.programProposedResults?.find((entry) => entry?.itemIndex === itemIndex);
    if (programResult) return String(programResult.programCandidate || '');
    return originalText;
}

export async function executeDeepCleanAiRequests(run, { onProgress, shouldStop } = {}) {
    const requests = Array.isArray(run.aiRequestPlan?.requests) ? run.aiRequestPlan.requests : [];
    const aiSettings = getFrozenAiSettings(run);
    const aiProposedResults = [];
    const programProposedResults = Array.isArray(run.programProposedResults) ? [...run.programProposedResults] : [];
    const failedItemIndexes = new Set();
    const failedRequestIndexes = [];
    const failureReasons = [];
    const stoppedResult = () => ({
        aiProposedResults,
        programProposedResults,
        aiFailedItemIndexes: [...failedItemIndexes].sort((left, right) => left - right),
        aiFailedRequestIndexes: [...failedRequestIndexes],
        aiFailureReasons: failureReasons,
        stopped: true,
    });
    // 超限导致 AI 根本无法发起的条目也计入失败，不准改跑程序改写。
    for (const requestItem of run.aiRequestPlan?.oversizedRequestItems || []) {
        failedItemIndexes.add(requestItem.itemIndex);
        failureReasons.push(`第 ${requestItem.itemIndex + 1} 项内容过长，未发起 AI`);
    }
    onProgress?.({ completed: 0, planned: requests.length });

    let completed = 0;
    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
        const request = requests[requestIndex];
        if (shouldStop?.()) return stoppedResult();
        const reconstructed = renderDeepCleanAiRequest(run, request);
        if (!hasCompleteConnection(aiSettings)) {
            failedRequestIndexes.push(requestIndex);
            failureReasons.push('AI 连接配置不完整，已跳过程序改写');
            reconstructed.requestItems.forEach((requestItem) => {
                failedItemIndexes.add(requestItem.itemIndex);
            });
            completed += 1;
            onProgress?.({ completed, planned: requests.length });
            continue;
        }

        try {
            const requestConfig = buildAiRewriteGenerateRawConfig(reconstructed.prompt, aiSettings);
            const response = await callDeepCleanGenerateRaw(requestConfig);
            if (shouldStop?.()) return stoppedResult();
            const responseText = typeof response === 'string' ? response : String(response ?? '');
            if (!responseText) throw new Error('Deep Clean AI returned an empty response');
            const parsed = parseAiRewriteResponseObject(responseText);
            const entriesByItemIndex = partitionResponseEntries(parsed, reconstructed.requestItems);

            for (const requestItem of reconstructed.requestItems) {
                try {
                    const itemById = new Map(requestItem.rewriteItems.map((item) => [item.id, item]));
                    const accepted = validateAiRewriteEntries(
                        entriesByItemIndex.get(requestItem.itemIndex) || [],
                        itemById,
                    );
                    const originalSource = String(requestItem.requestSource
                        ?? run.contentItems?.[requestItem.itemIndex]?.originalText ?? '');
                    const aiCandidate = applyAcceptedItemRewrites(originalSource, requestItem, accepted);
                    if (aiCandidate !== originalSource) {
                        aiProposedResults.push({ itemIndex: requestItem.itemIndex, aiCandidate });
                    }
                } catch (error) {
                    failedItemIndexes.add(requestItem.itemIndex);
                    failureReasons.push(`第 ${requestItem.itemIndex + 1} 项 AI 结果校验失败：${error?.message || '无效回包'}`);
                }
            }
        } catch (error) {
            if (shouldStop?.()) return stoppedResult();
            failedRequestIndexes.push(requestIndex);
            failureReasons.push(`AI 请求失败：${error?.message || '请求未完成'}`);
            reconstructed.requestItems.forEach((requestItem) => {
                failedItemIndexes.add(requestItem.itemIndex);
            });
        }
        if (shouldStop?.()) return stoppedResult();
        completed += 1;
        onProgress?.({ completed, planned: requests.length });
    }

    return {
        aiProposedResults,
        programProposedResults,
        aiFailedItemIndexes: [...failedItemIndexes].sort((left, right) => left - right),
        aiFailedRequestIndexes: failedRequestIndexes,
        aiFailureReasons: failureReasons.slice(0, 5),
    };
}
