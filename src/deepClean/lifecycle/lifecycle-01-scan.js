/** lifecycle 的分块：scan。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { deepCleanRuntimeState } from '../state.js';
import { logger } from '../../log.js';
import { scanDeepCleanContentItems } from '../scan.js';
import { processDeepCleanProgramCandidates } from '../programProcessing.js';
import { planDeepCleanAiRequests } from '../aiPlanning.js';
import { executeDeepCleanAiRequests } from '../aiProcessing.js';
import { getDeepCleanReviewItemIndexes, createDeepCleanReviewSession } from '../review.js';
import { createDeepCleanSafeDiagnostic, recordDeepCleanFailure, recordDeepCleanSuccess } from '../diagnostics.js';
import { persistDeepCleanProposedBatch } from '../apply/index.js';
import { assertLateV1FitsOneApplyBatch, freezeValue, freezeDeepCleanRun, markDeepCleanStopped, finalizeDeepCleanFailure, reviewBatchCharacterLimit, programDirectBatchCharacterLimit, deriveDeepCleanCompletionSummary } from './lifecycle-00-selection.js';

export async function runDeepCleanScan(options = {}) {
    let lifecycle = null;
    let scanResult = null;
    try {
        options.onProgress?.({ stage: 'prepare' });
        lifecycle = await freezeDeepCleanRun(options);
        if (!lifecycle) return null;
        const frozenRun = lifecycle.run;
        options.onProgress?.({ stage: 'analyze', current: 0, total: frozenRun.contentItems.length });
        scanResult = await scanDeepCleanContentItems(frozenRun.input, frozenRun.contentItems, {
            onProgress: ({ current, total }) => options.onProgress?.({ stage: 'analyze', current, total }),
            shouldStop: () => lifecycle.stopRequested,
        });
        if (!scanResult || lifecycle.stopRequested) {
            lifecycle.run = null;
            markDeepCleanStopped(lifecycle);
            return null;
        }
        assertLateV1FitsOneApplyBatch(frozenRun.input, frozenRun.contentItems, scanResult.affectedItemIndexes);
        options.onProgress?.({ stage: 'summarize' });
        lifecycle.run = freezeValue({
            input: frozenRun.input,
            contentItems: frozenRun.contentItems,
            scanResult,
        });
        lifecycle.affectedItemIndexes = [...scanResult.affectedItemIndexes];
        lifecycle.skippedItemIndexes = new Set();
        deepCleanRuntimeState.deepCleanPhase = 'scan-result';
        logger.info(`[Deep Clean] scan complete items=${scanResult.scannedItemCount} affected=${scanResult.affectedItemCount}`);
        return lifecycle.run;
    } catch (error) {
        lifecycle ||= deepCleanRuntimeState.deepCleanSelection;
        if (lifecycle?.stopRequested) return null;
        if (lifecycle && deepCleanRuntimeState.deepCleanSelection === lifecycle) {
            finalizeDeepCleanFailure(lifecycle, 'scan', 'scan_failed', { scanResult });
        }
        throw error;
    }
}

export function takeNextDeepCleanBatch(lifecycle) {
    const affectedItemIndexes = Array.isArray(lifecycle.affectedItemIndexes)
        ? lifecycle.affectedItemIndexes
        : lifecycle.run.scanResult.affectedItemIndexes;
    const characterLimit = lifecycle.run.input.processingMode === 'program'
        && lifecycle.run.input.programApplyPolicy === 'direct'
        ? programDirectBatchCharacterLimit
        : reviewBatchCharacterLimit;
    const itemIndexes = [];
    let sourceCharacterCount = 0;
    while (lifecycle.nextAffectedItemCursor < affectedItemIndexes.length) {
        const itemIndex = affectedItemIndexes[lifecycle.nextAffectedItemCursor];
        const itemLength = lifecycle.run.contentItems[itemIndex].originalText.length;
        if (itemIndexes.length > 0 && sourceCharacterCount + itemLength > characterLimit) break;
        itemIndexes.push(itemIndex);
        sourceCharacterCount += itemLength;
        lifecycle.nextAffectedItemCursor++;
    }
    return itemIndexes.length > 0 ? freezeValue({ itemIndexes, sourceCharacterCount }) : null;
}

function reportBatchProgress(onProgress, batch, stage, progress = {}) {
    onProgress?.({
        stage,
        itemIndexes: batch.itemIndexes,
        itemCount: batch.itemIndexes.length,
        sourceCharacterCount: batch.sourceCharacterCount,
        ...progress,
    });
}

export async function processDeepCleanBatch(lifecycle, batch, onProgress) {
    if (lifecycle.stopRequested) return null;
    const run = lifecycle.run;
    reportBatchProgress(onProgress, batch, 'program-processing');
    const programProposedResults = processDeepCleanProgramCandidates(
        run.input,
        run.contentItems,
        run.scanResult,
        batch.itemIndexes,
    );
    if (lifecycle.stopRequested) return null;

    let processedRun = {
        input: run.input,
        contentItems: run.contentItems,
        scanResult: run.scanResult,
        reviewBatch: batch,
        programProposedResults,
    };
    if (run.input.processingMode === 'program-ai') {
        reportBatchProgress(onProgress, batch, 'ai-planning');
        const aiRequestPlan = planDeepCleanAiRequests(processedRun, batch.itemIndexes);
        if (lifecycle.stopRequested) return null;
        processedRun = { ...processedRun, aiRequestPlan };
        const aiResult = await executeDeepCleanAiRequests(processedRun, {
            shouldStop: () => lifecycle.stopRequested,
            onProgress: (progress) => reportBatchProgress(onProgress, batch, 'ai-processing', progress),
            previewCache: lifecycle.previewAiCache,
        });
        if (aiResult.stopped || lifecycle.stopRequested) return null;
        processedRun = { ...processedRun, ...aiResult };
    }
    if (lifecycle.stopRequested) return null;
    processedRun = freezeValue(processedRun);
    const reviewItemIndexes = getDeepCleanReviewItemIndexes(processedRun, batch.itemIndexes);
    lifecycle.processedRuns.push(processedRun);
    reportBatchProgress(onProgress, batch, 'proposed-ready');
    return {
        batch,
        processedRun,
        reviewItemIndexes,
    };
}

async function processNextDeepCleanBatch(lifecycle, onProgress) {
    while (!lifecycle.stopRequested) {
        const batch = takeNextDeepCleanBatch(lifecycle);
        if (!batch) return null;
        const processed = await processDeepCleanBatch(lifecycle, batch, onProgress);
        if (!processed) return null;
        if (processed.reviewItemIndexes.length > 0) return processed;
        logger.info(`[Deep Clean] skipped unchanged Batch items=${batch.itemIndexes.length}`);
    }
    return null;
}

export function startDeepCleanLookahead(lifecycle, onProgress) {
    if (lifecycle.stopRequested
        || !lifecycle.currentReviewSession
        || lifecycle.lookahead
        || lifecycle.nextAffectedItemCursor >= (
            Array.isArray(lifecycle.affectedItemIndexes)
                ? lifecycle.affectedItemIndexes
                : lifecycle.run.scanResult.affectedItemIndexes
        ).length) {
        return null;
    }
    const lookahead = {
        progress: { stage: 'waiting' },
        batch: null,
        processedRun: null,
        promise: null,
    };
    lifecycle.lookahead = lookahead;
    const updateProgress = (progress) => {
        if (lifecycle.lookahead !== lookahead || lifecycle.stopRequested) return;
        lookahead.progress = progress;
        onProgress?.(progress);
    };
    lookahead.promise = processNextDeepCleanBatch(lifecycle, updateProgress)
        .then((processed) => {
            if (lifecycle.lookahead !== lookahead || lifecycle.stopRequested || !processed) {
                if (lifecycle.lookahead === lookahead) lifecycle.lookahead = null;
                return null;
            }
            lookahead.batch = processed.batch;
            lookahead.processedRun = processed.processedRun;
            lookahead.progress = {
                stage: 'prepared',
                itemIndexes: processed.batch.itemIndexes,
                itemCount: processed.batch.itemIndexes.length,
                sourceCharacterCount: processed.batch.sourceCharacterCount,
                reviewItemCount: processed.reviewItemIndexes.length,
            };
            onProgress?.(lookahead.progress);
            return lookahead;
        })
        .catch((error) => {
            if (lifecycle.lookahead === lookahead && !lifecycle.stopRequested) {
                lookahead.error = error;
                lookahead.progress = {
                    ...lookahead.progress,
                    stage: 'failed',
                    error: error instanceof Error ? error.message : String(error),
                };
                onProgress?.(lookahead.progress);
            }
            return null;
        });
    return lookahead.promise;
}

export function completeDeepCleanRun(lifecycle) {
    const summary = deriveDeepCleanCompletionSummary(lifecycle);
    if (Number.isFinite(lifecycle.diagnosticStartedAt)) {
        const failedAiRequestCount = Number(summary.failedAiRequestCount || 0);
        const successful = summary.failedItemCount === 0 && failedAiRequestCount === 0;
        const record = createDeepCleanSafeDiagnostic({
            startedAt: lifecycle.diagnosticStartedAt,
            outcome: successful ? 'success' : 'failure',
            terminalStage: 'complete',
            failureCode: successful ? undefined : 'completed_with_failures',
            input: lifecycle.run.input,
            scanResult: lifecycle.run.scanResult,
            summary,
        });
        lifecycle.diagnosticStartedAt = null;
        try {
            if (successful) recordDeepCleanSuccess(record);
            else recordDeepCleanFailure(record);
        } finally {
            if (deepCleanRuntimeState.deepCleanSelection === lifecycle) {
                deepCleanRuntimeState.deepCleanSelection = null;
            }
            deepCleanRuntimeState.deepCleanPhase = 'complete';
        }
    } else {
        if (deepCleanRuntimeState.deepCleanSelection === lifecycle) {
            deepCleanRuntimeState.deepCleanSelection = null;
        }
        deepCleanRuntimeState.deepCleanPhase = 'complete';
    }
    return summary;
}

export async function runDeepCleanProgramProcessing(options = {}) {
    if (deepCleanRuntimeState.deepCleanPhase !== 'scan-result') return null;
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    deepCleanRuntimeState.deepCleanPhase = 'batch-processing';
    try {
        if (lifecycle.run.input.processingMode === 'program'
            && lifecycle.run.input.programApplyPolicy === 'direct') {
            while (!lifecycle.stopRequested) {
                const processed = await processNextDeepCleanBatch(lifecycle, options.onProgress);
                if (lifecycle.stopRequested) break;
                if (!processed) {
                    return { complete: true, summary: completeDeepCleanRun(lifecycle) };
                }
                reportBatchProgress(options.onProgress, processed.batch, 'direct-applying', {
                    completedBatchCount: lifecycle.applyResults.length,
                });
                let result;
                try {
                    result = await persistDeepCleanProposedBatch(
                        processed.processedRun,
                        processed.batch.itemIndexes,
                        {
                            shouldStop: () => lifecycle.stopRequested,
                            onProgress: ({ completed, total, ...progress }) => {
                                if (lifecycle.stopRequested) return;
                                reportBatchProgress(options.onProgress, processed.batch, 'direct-applying', {
                                    ...progress,
                                    current: completed,
                                    total,
                                    completedBatchCount: lifecycle.applyResults.length,
                                });
                            },
                        },
                    );
                } catch (error) {
                    if (lifecycle.stopRequested) return null;
                    if (deepCleanRuntimeState.deepCleanSelection !== lifecycle) throw error;
                    finalizeDeepCleanFailure(lifecycle, 'direct-apply', 'direct_apply_failed');
                    throw error;
                }
                lifecycle.applyResults.push(result);
                const applied = result.unitResults.filter((unit) => unit.status === 'applied').length;
                const failed = result.unitResults.length - applied;
                logger.info(`[Deep Clean] direct apply complete applied=${applied} failed=${failed}`);
                if (lifecycle.stopRequested) break;
                reportBatchProgress(options.onProgress, processed.batch, 'batch-applied', {
                    completedBatchCount: lifecycle.applyResults.length,
                });
            }
            markDeepCleanStopped(lifecycle);
            return null;
        }
        const processed = await processNextDeepCleanBatch(lifecycle, options.onProgress);
        if (lifecycle.stopRequested) {
            markDeepCleanStopped(lifecycle);
            return null;
        }
        if (!processed) {
            return { complete: true, summary: completeDeepCleanRun(lifecycle) };
        }
        lifecycle.reviewController = new AbortController();
        const session = await createDeepCleanReviewSession(processed.processedRun, processed.batch.itemIndexes, {
            signal: lifecycle.reviewController.signal,
        });
        lifecycle.reviewController = null;
        if (lifecycle.stopRequested) return null;
        lifecycle.currentReviewSession = session;
        deepCleanRuntimeState.deepCleanPhase = 'review';
        logger.info(`[Deep Clean] Review Batch sourceChars=${processed.batch.sourceCharacterCount} reviewItems=${session.reviewItemIndexes.length}`);
        startDeepCleanLookahead(lifecycle, options.onLookaheadProgress);
        return session;
    } catch (error) {
        if (lifecycle?.stopRequested) return null;
        if (deepCleanRuntimeState.deepCleanSelection === lifecycle) {
            finalizeDeepCleanFailure(lifecycle, 'processing', 'processing_failed');
        }
        throw error;
    }
}

export function getDeepCleanReviewSession() {
    return deepCleanRuntimeState.deepCleanPhase === 'review'
        ? deepCleanRuntimeState.deepCleanSelection?.currentReviewSession || null
        : null;
}

export function getDeepCleanLookaheadProgress() {
    return deepCleanRuntimeState.deepCleanSelection?.lookahead?.progress || null;
}

export function requestDeepCleanStop() {
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    if (!lifecycle || deepCleanRuntimeState.deepCleanPhase === 'stopped' || deepCleanRuntimeState.deepCleanPhase === 'complete') {
        return deepCleanRuntimeState.deepCleanPhase;
    }
    lifecycle.stopRequested = true;
    markDeepCleanStopped(lifecycle);
    logger.info(`[Deep Clean] Stop requested phase=${deepCleanRuntimeState.deepCleanPhase}`);
    return deepCleanRuntimeState.deepCleanPhase;
}

