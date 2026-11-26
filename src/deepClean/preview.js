/** 深度清理预览的数据层：按条目生成程序/AI 预览，缓存结果，并筛选可执行的命中条目。 */

import { processDeepCleanProgramCandidates } from './programProcessing.js';
import { planDeepCleanAiRequests } from './aiPlanning.js';
import { executeDeepCleanAiRequests, resolveFinalProposedText } from './aiProcessing.js';
import { createDeepCleanReviewSession, resolveReviewRunsText } from './review.js';

export function createDeepCleanPreviewSession(lifecycle) {
    const run = lifecycle?.run;
    if (!run?.scanResult) return null;
    const itemIndexes = [...run.scanResult.affectedItemIndexes];
    return {
        lifecycle,
        run,
        itemIndexes,
        filter: 'all',
        currentItemIndex: itemIndexes[0] ?? null,
        mode: run.input?.processingMode === 'program-ai' ? 'program' : 'program',
        view: 'diff',
        included: new Set(itemIndexes),
        skipped: new Set(),
        aiCache: new Map(),
        diffCache: new Map(),
        abortController: null,
        loadingKey: null,
        renderToken: 0,
        listOpen: false,
        revealActiveRow: false,
        listScrollTop: 0,
        documentScrollTop: 0,
        changeIndex: 0,
        // 改写项级撤销：itemIndex -> Set<blockIndex>；被撤销的块保留原文写入。
        revertedBlocks: new Map(),
        revertedPanelOpen: false,
    };
}

export function getRevertedBlockSet(preview, itemIndex, { create = false } = {}) {
    if (!preview || !Number.isInteger(itemIndex)) return null;
    let set = preview.revertedBlocks?.get(itemIndex);
    if (!set && create) {
        set = new Set();
        preview.revertedBlocks.set(itemIndex, set);
    }
    return set || null;
}

/** 切换某个改写项的撤销状态；返回是否处于撤销态。 */
export function toggleDeepCleanPreviewBlock(preview, itemIndex, blockIndex) {
    if (!Number.isInteger(blockIndex)) return false;
    const set = getRevertedBlockSet(preview, itemIndex, { create: true });
    if (!set) return false;
    if (set.has(blockIndex)) set.delete(blockIndex);
    else set.add(blockIndex);
    if (set.size === 0) preview.revertedBlocks.delete(itemIndex);
    return set.has(blockIndex);
}

export function revertedBlockCount(preview) {
    if (!preview?.revertedBlocks) return 0;
    let total = 0;
    for (const set of preview.revertedBlocks.values()) total += set.size;
    return total;
}

/** 列出全部撤销项，带上来源，供左下角面板展示。 */
export function listRevertedBlocks(preview) {
    if (!preview?.revertedBlocks) return [];
    const result = [];
    for (const [itemIndex, set] of preview.revertedBlocks.entries()) {
        if (!set || set.size === 0) continue;
        const item = preview.run?.contentItems?.[itemIndex];
        const entry = preview.diffCache.get(`${preview.mode}:${itemIndex}`);
        const blocks = entry?.session?.reviewItems?.[0]?.blocks || [];
        for (const blockIndex of set) {
            const block = blocks[blockIndex];
            if (!block || block.type !== 'diff') continue;
            result.push({
                itemIndex,
                blockIndex,
                source: sourceLabelForItem(item),
                preview: resolveReviewRunsText(block.newRuns),
                original: resolveReviewRunsText(block.oldRuns),
            });
        }
    }
    return result;
}

function sourceLabelForItem(item) {
    const locator = item?.locator || {};
    if (item?.kind === 'user-message') {
        return `聊天消息 ${Number.isInteger(locator.messageIndex) ? locator.messageIndex + 1 : '?'} · 用户`;
    }
    if (item?.kind === 'assistant-swipe') {
        const swipe = Number.isInteger(locator.swipeIndex) ? ` · Swipe ${locator.swipeIndex + 1}` : '';
        return `聊天消息 ${Number.isInteger(locator.messageIndex) ? locator.messageIndex + 1 : '?'}${swipe}`;
    }
    if (item?.kind === 'embedded-world-book-entry' || item?.kind === 'external-world-book-entry') {
        const world = item.kind === 'embedded-world-book-entry' ? '内嵌世界书' : '世界书';
        return `${world} · ${item.displayName || locator.worldBookKey || '条目'}`;
    }
    return item?.displayName || '内容项';
}

export function getPreviewItemModes(run, itemIndex) {
    const recorded = run?.scanResult?.affectedItemModes?.[itemIndex];
    if (Array.isArray(recorded) && recorded.length > 0) return [...recorded];
    const item = run?.contentItems?.[itemIndex];
    const modes = [];
    if (item?.programEligible === true) modes.push('program');
    if (item?.aiEligible === true) modes.push('ai');
    return modes.length > 0 ? modes : ['program'];
}

export function isProgramPreviewRelevant(run, itemIndex) {
    const modes = getPreviewItemModes(run, itemIndex);
    return modes.includes('program') || (run?.input?.processingMode === 'program' && modes.includes('ai'));
}

export function isAiPreviewRelevant(run, itemIndex) {
    return run?.input?.processingMode === 'program-ai'
        && getPreviewItemModes(run, itemIndex).includes('ai');
}

export function filterDeepCleanPreviewItems(preview) {
    if (!preview) return [];
    if (preview.filter === 'program') {
        return preview.itemIndexes.filter((itemIndex) => isProgramPreviewRelevant(preview.run, itemIndex));
    }
    if (preview.filter === 'ai') {
        return preview.itemIndexes.filter((itemIndex) => isAiPreviewRelevant(preview.run, itemIndex));
    }
    if (preview.filter === 'included') {
        return preview.itemIndexes.filter((itemIndex) => preview.included.has(itemIndex));
    }
    if (preview.filter === 'excluded' || preview.filter === 'skipped') {
        return preview.itemIndexes.filter((itemIndex) => preview.skipped.has(itemIndex));
    }
    return [...preview.itemIndexes];
}

export function setDeepCleanPreviewFilter(preview, filter) {
    if (!preview || !['all', 'program', 'ai', 'included', 'excluded', 'skipped'].includes(filter)) return preview;
    preview.filter = filter;
    const items = filterDeepCleanPreviewItems(preview);
    if (!items.includes(preview.currentItemIndex)) preview.currentItemIndex = items[0] ?? null;
    return preview;
}

export function stepDeepCleanPreview(preview, direction) {
    const items = filterDeepCleanPreviewItems(preview);
    if (items.length === 0) return preview;
    const position = items.indexOf(preview.currentItemIndex);
    const next = Math.min(Math.max((position < 0 ? 0 : position) + direction, 0), items.length - 1);
    preview.currentItemIndex = items[next];
    return preview;
}

export function setDeepCleanPreviewIncluded(preview, itemIndex, included) {
    if (!preview || !preview.itemIndexes.includes(itemIndex)) return preview;
    if (included) {
        preview.included.add(itemIndex);
        preview.skipped.delete(itemIndex);
    } else {
        preview.included.delete(itemIndex);
        preview.skipped.add(itemIndex);
    }
    return preview;
}

function buildPreviewRun(run, itemIndex) {
    const programProposedResults = processDeepCleanProgramCandidates(
        run.input,
        run.contentItems,
        run.scanResult,
        [itemIndex],
    );
    return {
        input: run.input,
        contentItems: run.contentItems,
        scanResult: run.scanResult,
        reviewBatch: { itemIndexes: [itemIndex] },
        programProposedResults,
    };
}

function cacheKey(mode, itemIndex) {
    return `${mode}:${itemIndex}`;
}

function cacheAiCandidates(preview, baseRun, plan, result) {
    const requestItems = [
        ...(plan?.requests || []).flatMap((request) => request.requestItems || []),
        ...(plan?.oversizedRequestItems || []),
    ];
    for (const aiResult of result.aiProposedResults || []) {
        const requestItem = requestItems.find((entry) => entry.itemIndex === aiResult.itemIndex);
        const sourceText = String(requestItem?.requestSource
            ?? baseRun.contentItems?.[aiResult.itemIndex]?.originalText ?? '');
        preview.aiCache.set(aiResult.itemIndex, {
            itemIndex: aiResult.itemIndex,
            sourceText,
            aiCandidate: String(aiResult.aiCandidate ?? ''),
        });
    }
}

export async function ensureDeepCleanPreviewEntry(preview, itemIndex, mode, { signal, retry = false } = {}) {
    if (!preview || itemIndex === null || !preview.itemIndexes.includes(itemIndex)) return null;
    const key = cacheKey(mode, itemIndex);
    if (retry) preview.diffCache.delete(key);
    const cachedEntry = preview.diffCache.get(key);
    if (cachedEntry) return cachedEntry;
    if (signal?.aborted) return null;

    const baseRun = buildPreviewRun(preview.run, itemIndex);
    const entry = { mode, itemIndex, text: '', status: 'ready', session: null };

    if (mode === 'program') {
        entry.text = resolveFinalProposedText(baseRun, itemIndex);
    } else {
        if (!isAiPreviewRelevant(preview.run, itemIndex)) {
            entry.status = 'unavailable';
            return entry;
        }
        const plan = planDeepCleanAiRequests(baseRun, [itemIndex]);
        if (plan.requests.length === 0 && plan.oversizedItemIndexes.includes(itemIndex)) {
            entry.status = 'oversized';
            entry.text = resolveFinalProposedText({ ...baseRun, aiFailedItemIndexes: [itemIndex] }, itemIndex);
            preview.diffCache.set(key, entry);
            return entry;
        }
        const result = await executeDeepCleanAiRequests(
            { ...baseRun, aiRequestPlan: plan },
            { shouldStop: () => signal?.aborted === true },
        );
        if (signal?.aborted) return null;
        if (result.aiFailedItemIndexes.includes(itemIndex)) {
            entry.status = 'failed';
            entry.text = resolveFinalProposedText(
                { ...baseRun, aiFailedItemIndexes: [itemIndex] },
                itemIndex,
            );
        } else {
            cacheAiCandidates(preview, baseRun, plan, result);
            const finalRun = { ...baseRun, ...result };
            entry.text = resolveFinalProposedText(finalRun, itemIndex);
        }
    }

    const finalRunForDiff = mode === 'program'
        ? baseRun
        : entry.status === 'failed' || entry.status === 'oversized'
            ? { ...baseRun, aiFailedItemIndexes: [itemIndex] }
            : { ...baseRun, aiProposedResults: [...preview.aiCache.values()]
                .filter((value) => value.aiCandidate !== value.sourceText)
                .map((value) => ({ itemIndex: value.itemIndex, aiCandidate: value.aiCandidate })) };
    const session = await createDeepCleanReviewSession(finalRunForDiff, [itemIndex], { signal });
    if (signal?.aborted) return null;
    entry.session = session;
    preview.diffCache.set(key, entry);
    return entry;
}

export function cancelDeepCleanPreviewRequest(preview) {
    if (!preview) return;
    // 作废所有在途的 then/catch：只 abort 请求还不够，已 resolve 的 Promise 仍会
    // 用旧 token 重绘预览，把刚返回的扫描结果/处理进度盖掉，按钮看起来就"点不动"。
    preview.renderToken = Number(preview.renderToken || 0) + 1;
    if (!preview.abortController) return;
    preview.abortController.abort();
    preview.abortController = null;
}
