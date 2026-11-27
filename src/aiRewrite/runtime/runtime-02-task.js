/** runtime 的分块：task。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { normalizeAiNumericSetting } from '../../settings/defaults.js';
import { logger } from '../../log.js';
import { AiRewriteRequestFormatError, isBadRequestError, requestAiRewrite } from '../generation.js';
import { recordAiRewriteDebug } from '../debug.js';
import { getTaskFreshnessIssue, getAiRewriteMessageId, isSameAiRewriteTask, isTaskStillFresh, validateAutomaticAiRewriteContent } from '../task.js';
import { groupRewriteItemsByPrompt, normalizeLimit, renderPrompt } from '../planning.js';
import { isAiRewriteResponseFormatError, parseAiResponse } from '../response.js';
import { streamingRuntimeState } from '../../host/streamingState.js';
import { aiRewriteState } from '../state.js';
import { getMessageDiffBranchKey } from '../../chat/messageBranch.js';
import { generationLifecycle } from '../../host/generationLifecycle.js';
import { notifyAiRewriteProgress, getAiRetryCount, notifyAiRewriteStatus, notifyStaleFailure, hasFinalCleanseAfterTaskStart, isNonRetryableAiRewriteError, applyAiProgramFallback, cancelAiRewriteTask } from './runtime-00-ui.js';
import { deferAiRewriteFallbackUntilFinalCleanse, finishOrDeferAiRewriteApply, finishAutomaticTaskBeforeRun, buildAiRewriteTaskCheck, notifyAiRewriteNotSent } from './runtime-01-apply.js';

export async function requestAcceptedRewritesOnce(task, rewriteState, attempt, maxAttempts, accepted, completedGroupKeys) {
    const timeoutMs = normalizeAiNumericSetting('timeoutMs', task.aiSettings.timeoutMs);
    const groups = groupRewriteItemsByPrompt(task.items, task.aiSettings);
    for (const [groupOffset, group] of groups.entries()) {
        if (completedGroupKeys.has(group.key)) {
            recordAiRewriteDebug('request-group-skip', {
                generationId: task.generationId || '',
                attempt,
                group: group.key,
                reason: 'already-completed',
            });
            continue;
        }
        const freshnessIssueBeforeFetch = getTaskFreshnessIssue(task);
        if (freshnessIssueBeforeFetch) {
            recordAiRewriteDebug('request-stale-before-fetch', {
                generationId: task.generationId || '',
                reason: freshnessIssueBeforeFetch,
            }, 'warn');
            return { stale: true, accepted };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);
        rewriteState.activeController = controller;
        rewriteState.activeTask = task;
        try {
            const prompt = renderPrompt(task.snapshotText, group.items, task.settings, task.aiSettings, group.promptTemplate);
            logger.info(`发送 AI 改写请求：第 ${attempt}/${maxAttempts} 次，句子目标 ${group.items.length} 个`);
            recordAiRewriteDebug('request-group', {
                generationId: task.generationId || '',
                attempt,
                maxAttempts,
                group: group.key,
                groupItemCount: group.items.length,
                groupItemIds: group.items.map(item => item.id),
                timeoutMs,
            });
            notifyAiRewriteProgress(task, groupOffset + 1, groups.length, attempt, maxAttempts);
            const rawResponse = await requestAiRewrite(prompt, task.aiSettings, controller.signal, task);
            const freshnessIssue = getTaskFreshnessIssue(task);
            if (freshnessIssue) {
                recordAiRewriteDebug('request-stale-after-fetch', { generationId: task.generationId || '', reason: freshnessIssue }, 'warn');
                return { stale: true, accepted };
            }
            const groupAccepted = parseAiResponse(rawResponse, new Map(group.items.map((item) => [item.id, item])));
            groupAccepted.forEach((value, key) => accepted.set(key, value));
            completedGroupKeys.add(group.key);
        } catch (err) {
            const abortReason = controller.signal.aborted ? String(controller.signal.reason || 'aborted') : '';
            if (abortReason && abortReason !== 'timeout') {
                logger.info(`AI 改写请求已取消: ${abortReason}`);
                recordAiRewriteDebug('request-aborted', {
                    generationId: task.generationId || '',
                    attempt,
                    group: group.key,
                    reason: abortReason,
                }, 'warn');
                return { cancelled: true, cancelReason: abortReason, accepted };
            }
            const reason = abortReason === 'timeout' ? '请求超时' : (err?.message || '请求未完成');
            recordAiRewriteDebug('request-error', {
                generationId: task.generationId || '',
                attempt,
                group: group.key,
                groupItemCount: group.items.length,
                reason,
            }, 'warn');
            if (isAiRewriteResponseFormatError(err)) throw err;
            if (isBadRequestError(err)) throw new AiRewriteRequestFormatError(reason, err);
            const wrapped = new Error(reason);
            wrapped.cause = err;
            wrapped.attempt = attempt;
            wrapped.maxAttempts = maxAttempts;
            throw wrapped;
        } finally {
            clearTimeout(timeoutId);
            if (rewriteState.activeTask === task && rewriteState.activeController === controller) {
                rewriteState.activeController = null;
                rewriteState.activeTask = null;
            }
        }
    }
    return { stale: false, accepted };
}

export async function runAiRewriteForMessage(payload, options = {}) {
    if (payload?.automatic === true && options.claimRequest === true) {
        const claim = generationLifecycle.claimRequest(payload.generationId, payload.source || 'automatic');
        if (!claim.ok) {
            recordAiRewriteDebug('task-deduped', {
                generationId: String(payload.generationId || ''),
                chatId: String(payload.chatId || ''),
                index: getAiRewriteMessageId(payload),
                source: String(payload.source || ''),
                reason: claim.reason,
            });
            return { status: 'deduped', reason: claim.reason };
        }
    }
    const waitForFinalCleanse = typeof options.waitForFinalCleanse === 'boolean'
        ? options.waitForFinalCleanse
        : streamingRuntimeState.isStreamingGeneration === true || payload?.streamingSnapshot === true;
    if (waitForFinalCleanse === true) {
        logger.info('AI 改写在 XML 闭合后提前请求，返回后等待最终原文就绪再写回');
    }
    const taskCheck = options.preparedTask
        ? { task: options.preparedTask, reason: '' }
        : buildAiRewriteTaskCheck(payload, {
            logTask: true,
            manual: options.manual === true,
        });
    const readyTask = taskCheck.task;
    if (!readyTask) {
        if (payload?.automatic === true) generationLifecycle.markRequestFailed(payload.generationId, taskCheck.reason || 'task-not-ready');
        notifyAiRewriteNotSent(taskCheck);
        return;
    }
    const { aiSettings, index, messageRef: msg, items } = readyTask;
    const rewriteState = aiRewriteState;
    if (isSameAiRewriteTask(rewriteState.runningTask, readyTask)) {
        recordAiRewriteDebug('run-skip', {
            generationId: readyTask.generationId || '',
            reason: 'already-pending',
        });
        return;
    }

    if (readyTask.automatic === true && !generationLifecycle.markRequestRunning(readyTask.generationId)) {
        recordAiRewriteDebug('run-skip', {
            generationId: readyTask.generationId,
            index: readyTask.index,
            reason: 'generation-request-not-scheduled',
        }, 'warn');
        finishAutomaticTaskBeforeRun(payload, 'generation-request-not-scheduled', 'failed');
        return;
    }

    if (rewriteState.activeController && !isSameAiRewriteTask(rewriteState.activeTask, readyTask)) {
        cancelAiRewriteTask('superseded');
    }

    const startedAtMs = Date.now();
    const branchKey = getMessageDiffBranchKey(msg);
    rewriteState.statusDismissedTask = null;
    recordAiRewriteDebug('run-start', {
        generationId: readyTask.generationId || '',
        index,
        branchKey,
        sentenceTargetCount: items.length,
        rawAiMatchCount: readyTask.rawAiMatchCount,
        matchedAiRuleCount: readyTask.matchedAiRuleCount,
        model: aiSettings.model,
        transport: 'tavern-helper-custom-api',
        maxRetries: getAiRetryCount(aiSettings),
        isStreaming: streamingRuntimeState.isStreamingGeneration === true,
        waitForFinalCleanse,
    });

    const task = {
        ...readyTask,
        branchKey,
        startedAtMs,
        waitForFinalCleanse,
        finalCleanseSequence: options.finalCleanseSequence ?? (Number(rewriteState.finalCleanseSequence) || 0),
    };
    rewriteState.runningTask = task;

    const accepted = new Map();
    const completedGroupKeys = new Set();
    try {
        const maxAttempts = getAiRetryCount(aiSettings) + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await requestAcceptedRewritesOnce(task, rewriteState, attempt, maxAttempts, accepted, completedGroupKeys);
                if (result?.cancelled) {
                    if (task.automatic === true) generationLifecycle.markRequestFailed(task.generationId, 'request-cancelled');
                    recordAiRewriteDebug('run-cancelled', {
                        generationId: task.generationId || '',
                        reason: result.cancelReason || 'request-cancelled',
                    }, 'warn');
                    return;
                }
                if (result?.stale) {
                    const freshnessIssue = getTaskFreshnessIssue(task) || 'stale';
                    if (task.automatic === true) generationLifecycle.markRequestFailed(task.generationId, freshnessIssue);
                    recordAiRewriteDebug('run-stale', { generationId: task.generationId || '', reason: freshnessIssue }, 'warn');
                    notifyStaleFailure('消息已变化，未写回');
                    return;
                }
                break;
            } catch (err) {
                if (isNonRetryableAiRewriteError(err)) throw err;
                if (attempt >= maxAttempts || !isTaskStillFresh(task)) throw err;
                recordAiRewriteDebug('retry', {
                    generationId: task.generationId || '',
                    nextAttempt: attempt + 1,
                    maxAttempts,
                    reason: err?.message || '请求未完成',
                }, 'warn');
            }
        }

        if (task.automatic === true) generationLifecycle.markRequestSucceeded(task.generationId);
        return finishOrDeferAiRewriteApply(task, accepted);
    } catch (err) {
        if (task.automatic === true) generationLifecycle.markRequestFailed(task.generationId, err?.message || 'request-failed');
        logger.warn('AI 改写失败', err);
        recordAiRewriteDebug('run-error', { generationId: task.generationId || '', reason: err?.message || '请求未完成' }, 'warn');
        if (isTaskStillFresh(task) && accepted.size > 0) {
            const totalGroups = groupRewriteItemsByPrompt(task.items, task.aiSettings).length;
            const doneGroups = completedGroupKeys.size;
            const partial = {
                done: doneGroups,
                total: totalGroups,
                reason: err?.message || '请求未完成',
            };
            recordAiRewriteDebug('run-partial-apply', {
                generationId: task.generationId || '',
                doneGroups,
                totalGroups,
                appliedCount: accepted.size,
                reason: partial.reason,
            }, 'warn');
            const result = finishOrDeferAiRewriteApply(task, accepted, { partial });
            return { ...result, partial };
        }
        if (isTaskStillFresh(task)) {
            if (!hasFinalCleanseAfterTaskStart(task)) {
                deferAiRewriteFallbackUntilFinalCleanse(task, 'ai-failed');
                return;
            }
            const fallbackResult = applyAiProgramFallback(task, 'ai-failed');
            if (fallbackResult.applied) return { status: 'fallback-applied', fallbackResult };
        }
        notifyAiRewriteStatus('error', 'AI 改写失败', `${err?.message || '请求未完成'}（已跳过程序改写）`, { timeOut: 8000, extendedTimeOut: 16000 });
    } finally {
        if (rewriteState.runningTask === task) rewriteState.runningTask = null;
        if (isSameAiRewriteTask(rewriteState.statusDismissedTask, task)) {
            rewriteState.statusDismissedTask = null;
        }
        if (rewriteState.activeTask === task) {
            rewriteState.activeController = null;
            rewriteState.activeTask = null;
        }
    }
}

export function scheduleAiRewriteForMessage(payload, options = {}) {
    const delay = normalizeLimit(options.delayMs, 0, 0, 10000);
    const finalCleanseSequence = Number(aiRewriteState.finalCleanseSequence) || 0;
    if (payload?.automatic === true) {
        const claim = generationLifecycle.claimRequest(payload.generationId, payload.source || (payload.streamingSnapshot ? 'streaming' : 'final'));
        if (!claim.ok) {
            recordAiRewriteDebug('task-deduped', {
                generationId: String(payload.generationId || ''),
                chatId: String(payload.chatId || ''),
                index: getAiRewriteMessageId(payload),
                source: String(payload.source || ''),
                reason: claim.reason,
            });
            if (!String(claim.reason || '').startsWith('request-')) {
                finishAutomaticTaskBeforeRun(payload, `request-claim-${claim.reason}`, 'failed');
            }
            return false;
        }
        recordAiRewriteDebug('request-claimed', {
            generationId: String(payload.generationId || ''),
            chatId: String(payload.chatId || ''),
            messageId: getAiRewriteMessageId(payload),
            requestState: claim.session.requestState,
            source: String(payload.source || ''),
        });
    }
    const runScheduledTask = async () => {
        if (payload?.automatic === true) {
            const validation = validateAutomaticAiRewriteContent({
                generationId: String(payload.generationId || ''),
                chatId: String(payload.chatId || ''),
                index: getAiRewriteMessageId(payload),
                scheduleSource: String(payload.source || ''),
            }, { source: 'schedule-callback' });
            if (!validation.ok) {
                recordAiRewriteDebug('run-skip', {
                    generationId: String(payload.generationId || ''),
                    reason: validation.reason,
                }, 'warn');
                finishAutomaticTaskBeforeRun(payload, validation.reason, 'stale');
                return;
            }
        }
        return runAiRewriteForMessage(payload, { ...options, finalCleanseSequence });
    };
    setTimeout(runScheduledTask, delay);
    return true;
}

