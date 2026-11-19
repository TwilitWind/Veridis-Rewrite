/**
 * lifecycle.js 拆分产物（apply）：1 个顶层声明，2991 字节 / 60 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { deepCleanRuntimeState } from '../state.js';
import { logger } from '../../log.js';
import { persistDeepCleanReview } from '../apply/index.js';
import { createDeepCleanReviewSession, waitForDeepCleanReviewEdits } from '../review.js';
import { markDeepCleanStopped, finalizeDeepCleanFailure } from './lifecycle-00-selection.js';
import { startDeepCleanLookahead, getDeepCleanReviewSession, completeDeepCleanRun } from './lifecycle-01-scan.js';

export async function runDeepCleanApply(options = {}) {
    if (deepCleanRuntimeState.deepCleanPhase !== 'review') return null;
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    const reviewSession = getDeepCleanReviewSession();
    if (!reviewSession) return null;
    deepCleanRuntimeState.deepCleanPhase = 'apply';
    const lookaheadPromise = lifecycle.lookahead?.promise;
    try {
        await waitForDeepCleanReviewEdits(reviewSession);
        if (lifecycle.stopRequested) return { stopped: true, nextSession: null };
        const result = await persistDeepCleanReview(reviewSession, {
            shouldStop: () => lifecycle.stopRequested,
            onProgress: options.onProgress,
        });
        lifecycle.applyResults.push(result);
        lifecycle.currentReviewSession = null;
        const applied = result.unitResults.filter((unit) => unit.status === 'applied').length;
        const failed = result.unitResults.length - applied;
        logger.info(`[Deep Clean] apply complete applied=${applied} failed=${failed}`);
        if (lifecycle.stopRequested) {
            if (lookaheadPromise) await lookaheadPromise;
            markDeepCleanStopped(lifecycle);
            return { ...result, stopped: true, nextSession: null };
        }

        const lookahead = lifecycle.lookahead;
        if (lookahead?.promise) await lookahead.promise;
        if (lifecycle.stopRequested) {
            markDeepCleanStopped(lifecycle);
            return { ...result, stopped: true, nextSession: null };
        }
        if (lifecycle.lookahead?.error) {
            const error = lifecycle.lookahead.error;
            finalizeDeepCleanFailure(lifecycle, 'lookahead-processing', 'lookahead_processing_failed');
            throw error;
        }
        if (lifecycle.lookahead?.processedRun) {
            const prepared = lifecycle.lookahead;
            lifecycle.reviewController = new AbortController();
            const nextSession = await createDeepCleanReviewSession(prepared.processedRun, prepared.batch.itemIndexes, {
                signal: lifecycle.reviewController.signal,
            });
            lifecycle.reviewController = null;
            if (lifecycle.stopRequested) return { stopped: true, nextSession: null };
            lifecycle.lookahead = null;
            lifecycle.currentReviewSession = nextSession;
            deepCleanRuntimeState.deepCleanPhase = 'review';
            startDeepCleanLookahead(lifecycle, options.onLookaheadProgress);
            return { ...result, nextSession, complete: false };
        }
        return { ...result, nextSession: null, complete: true, summary: completeDeepCleanRun(lifecycle) };
    } catch (error) {
        if (lifecycle.stopRequested) return { stopped: true, nextSession: null };
        if (deepCleanRuntimeState.deepCleanSelection === lifecycle) {
            finalizeDeepCleanFailure(lifecycle, 'review-apply', 'review_apply_failed');
        }
        throw error;
    }
}

