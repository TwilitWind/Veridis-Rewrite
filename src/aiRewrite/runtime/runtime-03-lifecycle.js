/** runtime 的分块：lifecycle。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { getAppContext } from '../../host/appContext.js';
import { aiRewriteState } from '../state.js';
import { isAssistantMessage } from '../../diff/tracking.js';
import { getMessageDiffBranchKey } from '../../chat/messageBranch.js';
import { recordAiRewriteDebug } from '../debug.js';
import { getAiRewriteMessageId, validateAiRewriteFinalization, validateAutomaticAiRewriteContent, isSameAiRewriteTask } from '../task.js';
import { generationLifecycle } from '../../host/generationLifecycle.js';
import { groupRewriteItemsByPrompt } from '../planning.js';
import { clearAiRewriteStatusToast, getAiRewriteMessageKey, applyAiProgramFallback, cancelAiRewriteTask, notifyAiRewriteStatus, notifyAiRewriteProgress } from './runtime-00-ui.js';
import { getPendingApplyCount, flushPendingApply, buildAiRewriteTaskCheck } from './runtime-01-apply.js';
import { scheduleAiRewriteForMessage, runAiRewriteForMessage } from './runtime-02-task.js';

export function markAiRewriteFinalCleanseReady(payload) {
    const { chat } = getAppContext();
    const index = getAiRewriteMessageId(payload);
    if (index < 0) {
        recordAiRewriteDebug('payload-rejected', { source: 'final', reason: 'invalid-message-id' }, 'warn');
        return false;
    }
    if (!Array.isArray(chat) || index < 0 || !isAssistantMessage(chat[index])) return false;
    const validation = validateAiRewriteFinalization(payload);
    if (!validation.ok || validation.session.messageId !== index) {
        recordAiRewriteDebug('run-skip', {
            generationId: String(payload?.generationId || ''),
            index,
            reason: validation.reason || 'generation-message-mismatch',
        }, 'warn');
        return false;
    }

    const msg = chat[index];
    const branchKey = getMessageDiffBranchKey(msg);
    const messageKey = getAiRewriteMessageKey(index, branchKey);
    const rewriteState = aiRewriteState;
    rewriteState.finalCleanseSequence = (Number(rewriteState.finalCleanseSequence) || 0) + 1;
    rewriteState.finalCleanseByMessageKey.set(messageKey, rewriteState.finalCleanseSequence);

    recordAiRewriteDebug('final-cleanse-ready', {
        index,
        branchKey,
        sequence: rewriteState.finalCleanseSequence,
        pendingApplyCount: getPendingApplyCount(messageKey),
        generationId: validation.session.generationId,
        chatId: validation.session.chatId,
    });
    const hadPendingApply = getPendingApplyCount(messageKey) > 0;
    flushPendingApply(messageKey);
    if (hadPendingApply) return true;

    if (validation.session.requestState !== 'idle') {
        if (['scheduled', 'running', 'succeeded'].includes(validation.session.requestState)) {
            recordAiRewriteDebug('final-cleanse-skip-request', {
                index,
                branchKey,
                reason: 'generation-request-already-owned',
                requestState: validation.session.requestState,
            });
            return true;
        }
        return false;
    }

    const taskCheck = buildAiRewriteTaskCheck(payload);
    if (taskCheck.fallbackTask) {
        const fallbackResult = applyAiProgramFallback(taskCheck.fallbackTask, taskCheck.fallbackCode || 'not-sent');
        if (!fallbackResult.applied) {
            notifyAiRewriteStatus('error', 'AI 改写未发送', fallbackResult.reason || taskCheck.reason || '未满足发送条件', {
                timeOut: 8000,
                extendedTimeOut: 16000,
            });
            clearAiRewriteStatusToast();
        }
        return true;
    }
    const readyTask = taskCheck.task;
    if (!readyTask) {
        recordAiRewriteDebug('final-cleanse-no-ai-task', {
            index,
            branchKey,
            reason: taskCheck.reason || 'not-ready',
        });
        return false;
    }
    return scheduleAiRewriteForMessage(payload, { delayMs: 0, preparedTask: readyTask });
}

export function validateAiRewriteMessageTarget(payload) {
    const generationId = String(payload?.generationId || '');
    const session = generationLifecycle.getSession(generationId);
    const identity = session?.contentIdentity || null;
    if (!identity) return { ok: true, changed: false, reason: '' };
    const validation = validateAutomaticAiRewriteContent({
        generationId,
        chatId: String(payload?.chatId || ''),
        index: getAiRewriteMessageId(payload),
        scheduleSource: String(payload?.source || 'final-cleanse'),
    }, { source: 'message-acknowledgement' });
    if (!validation.ok) return validation;

    const resolution = generationLifecycle.bindMessage(validation.session.messageId, {
        generationId,
        chatId: validation.session.chatId,
        chat: getAppContext().chat,
        source: 'message-content-accepted',
    });
    if (!resolution.ok) return resolution;
    recordAiRewriteDebug('message-target-confirmed', {
        generationId,
        chatId: validation.session.chatId,
        messageId: validation.session.messageId,
        messageLength: String(resolution.message?.mes || '').length,
    });
    return {
        ok: true,
        changed: false,
        reason: '',
    };
}

export function handleAiRewriteGenerationStarted(session = null) {
    const state = aiRewriteState;
    if (state?.activeController) {
        recordAiRewriteDebug('generation-started-cancelled-active', {
            previousGenerationId: state.activeTask?.generationId || '',
            reason: 'superseded-by-new-generation',
            generationId: session?.generationId || '',
        });
    }
    clearAiRewriteStatusToast(null, 'superseded-by-new-generation');
    state.statusDismissedTask = null;
    cancelAiRewriteTask('generation-started');
    state.pendingApply = null;
    state.runningTask = null;
}

export function resetAiRewriteRuntimeState(reason = 'reset') {
    cancelAiRewriteTask(reason);
    clearAiRewriteStatusToast();
    const state = aiRewriteState;
    state.statusDismissedTask = null;
    state.runningTask = null;
    state.finalCleanseSequence = 0;
    state.finalCleanseByMessageKey.clear();
    state.pendingApply = null;
    const session = generationLifecycle.getActive();
    if (session) session.contentIdentity = null;
}

/**
 * 手动触发单条消息的 AI 改写。
 * @param {object|number} payload 消息载荷或索引
 * @param {{onSettled?: Function}} [options] onSettled 在任务真正结束后调用（成功/失败/取消都会触发），
 *   供调用方串接后续动作；未真正启动任务时不触发。
 */
export function requestManualAiRewriteForMessage(payload, options = {}) {
    const taskCheck = buildAiRewriteTaskCheck(payload, {
        logTask: true,
        manual: true,
        recleanse: options.recleanse === true,
    });
    const task = taskCheck.task;
    if (!task) {
        recordAiRewriteDebug('not-sent', { reason: taskCheck.reason || '未满足发送条件', manual: true }, 'warn');
        notifyAiRewriteStatus('error', 'AI 改写未发送', taskCheck.reason || '未满足发送条件');
        clearAiRewriteStatusToast();
        return false;
    }

    const rewriteState = aiRewriteState;
    if (isSameAiRewriteTask(rewriteState.runningTask, task)) {
        if (!rewriteState.statusToast) {
            notifyAiRewriteProgress(task, 1, Math.max(1, groupRewriteItemsByPrompt(task.items, task.aiSettings).length));
        }
        return false;
    }

    if (isSameAiRewriteTask(rewriteState.pendingApply?.task, task)) rewriteState.pendingApply = null;
    recordAiRewriteDebug('manual-request', {
        index: task.index,
        sentenceTargetCount: task.items.length,
        rawAiMatchCount: task.rawAiMatchCount,
        matchedAiRuleCount: task.matchedAiRuleCount,
    });
    const onSettled = typeof options.onSettled === 'function' ? options.onSettled : null;
    const runPromise = runAiRewriteForMessage(payload, {
        waitForFinalCleanse: false,
        manual: true,
        preparedTask: task,
    });
    if (onSettled) Promise.resolve(runPromise).then(onSettled, onSettled);
    return true;
}

