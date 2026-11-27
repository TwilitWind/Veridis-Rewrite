/** runtime 的分块：apply。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { aiRewriteState } from '../state.js';
import { generationLifecycle } from '../../host/generationLifecycle.js';
import { recordAiRewriteDebug } from '../debug.js';
import { isSameAiRewriteTask, getTaskFreshnessIssue, isTaskStillFresh, getAiSettings, getAiRewriteMessageId, getSettings, snapshotAiRewriteTaskSettings, getAiConfigIssue } from '../task.js';
import { applyAcceptedRewrites } from '../apply.js';
import { getAppContext } from '../../host/appContext.js';
import { streamingRuntimeState } from '../../host/streamingState.js';
import { isAssistantMessage } from '../../diff/tracking.js';
import { getMessageDiffMeta, isMessageDiffReverted } from '../../diff/messageMeta.js';
import { getMessageDiffBranchKey } from '../../chat/messageBranch.js';
import { getCurrentChatIdentity } from '../../host/context.js';
import { buildRewriteItems, countMatchedAiRules, collectAiMatches, collectAiScopeSegments } from '../matching.js';
import { logger } from '../../log.js';
import { notifyAiRewriteStatus, notifyStaleFailure, applyAiProgramFallback, formatAiRewriteCompletionMessage, hasFinalCleanseAfterTaskStart, getTaskMessageKey, freezeAiRewriteContentIdentity, clearAiRewriteStatusToast, cancelAiRewriteTask } from './runtime-00-ui.js';

export function finishAiRewriteApply(task, accepted, options = {}) {
    const rewriteState = aiRewriteState;
    const partial = options.partial || null;
    if (isSameAiRewriteTask(rewriteState.pendingApply?.task, task)) rewriteState.pendingApply = null;

    if (!isTaskStillFresh(task)) {
        const freshnessIssue = getTaskFreshnessIssue(task) || 'stale';
        recordAiRewriteDebug('run-stale-before-apply', {
            generationId: task.generationId || '',
            reason: freshnessIssue,
        }, 'warn');
        notifyStaleFailure('消息状态已变化，未写回');
        if (task.automatic === true) generationLifecycle.clearStreamingProgram(task.generationId);
        return { status: 'stale' };
    }

    const applyResult = applyAcceptedRewrites(task, accepted);
    const appliedCount = applyResult.appliedCount || 0;
    if (appliedCount > 0) {
        recordAiRewriteDebug(partial ? 'run-partial-success' : 'run-success', {
            generationId: task.generationId || '',
            appliedCount,
            partial: partial || null,
        });
        if (partial) {
            const remaining = Math.max(0, Number(partial.total || 0) - Number(partial.done || 0));
            notifyAiRewriteStatus(
                'warning',
                '部分改写已应用',
                formatAiRewriteCompletionMessage(task, `已应用 ${partial.done} 批，${remaining} 批未完成`),
                { timeOut: 8000, extendedTimeOut: 16000 },
            );
            return { status: 'partial-applied', applyResult, partial };
        }
        notifyAiRewriteStatus('success', 'AI 改写成功', formatAiRewriteCompletionMessage(task, `已应用 ${appliedCount} 个句子改写`), { timeOut: 5000 });
        return { status: 'applied', applyResult };
    }
    if (partial && applyResult.reason === 'no-text-change') {
        recordAiRewriteDebug('run-partial-no-change', {
            generationId: task.generationId || '',
            acceptedCount: accepted.size,
        }, 'warn');
        notifyAiRewriteStatus('info', '部分改写未写入', '已完成的批没有产生文本变化', { timeOut: 6000 });
        return { status: 'no-change', applyResult, partial };
    }
    if (applyResult.reason !== 'no-text-change') {
        recordAiRewriteDebug('run-apply-failed', {
            generationId: task.generationId || '',
            reason: applyResult.reason,
        }, 'warn');
        const fallbackResult = applyAiProgramFallback(task, applyResult.reason || 'apply-failed');
        if (fallbackResult.applied) return { status: 'fallback-applied', applyResult, fallbackResult };
        if (task.automatic === true) generationLifecycle.clearStreamingProgram(task.generationId);
        notifyAiRewriteStatus('error', 'AI 改写未写入', `改写结果未覆盖聊天数据：${applyResult.reason || fallbackResult.reason || 'apply-failed'}`, {
            timeOut: 8000,
            extendedTimeOut: 16000,
        });
        return { status: 'apply-failed', applyResult, fallbackResult };
    }

    recordAiRewriteDebug('run-no-change', {
        generationId: task.generationId || '',
        acceptedCount: accepted.size,
        reason: 'no-text-change',
    });
    notifyAiRewriteStatus('success', 'AI 改写成功', formatAiRewriteCompletionMessage(task, '没有新的文本变更需要写入'), { timeOut: 5000 });
    return { status: 'no-change', applyResult };
}

function deferAiRewriteApplyUntilFinalCleanse(task, accepted, options = {}) {
    const rewriteState = aiRewriteState;
    rewriteState.pendingApply = {
        mode: 'accepted',
        task,
        accepted: new Map(accepted),
        partial: options.partial || null,
    };
    recordAiRewriteDebug('apply-deferred', {
        generationId: task.generationId || '',
        index: task.index,
        finalCleanseSequence: task.finalCleanseSequence,
        pendingApplyCount: 1,
    });
    recordAiRewriteDebug('response-deferred', {
        generationId: task.generationId || '',
        chatId: task.chatId || '',
        messageId: task.index,
        finalCleanseSequence: task.finalCleanseSequence,
    });
    return { status: 'deferred' };
}

export function deferAiRewriteFallbackUntilFinalCleanse(task, reason) {
    aiRewriteState.pendingApply = {
        mode: 'fallback',
        task,
        reason: String(reason || ''),
    };
    recordAiRewriteDebug('apply-deferred', {
        generationId: task.generationId || '',
        index: task.index,
        finalCleanseSequence: task.finalCleanseSequence,
        mode: 'fallback',
    });
    return { status: 'deferred-fallback' };
}

export function finishOrDeferAiRewriteApply(task, accepted, options = {}) {
    if (!hasFinalCleanseAfterTaskStart(task)) {
        return deferAiRewriteApplyUntilFinalCleanse(task, accepted, options);
    }
    return finishAiRewriteApply(task, accepted, options);
}

export function getPendingApplyCount(messageKey) {
    return aiRewriteState.pendingApply
        && getTaskMessageKey(aiRewriteState.pendingApply.task) === messageKey
        ? 1
        : 0;
}

export function flushPendingApply(messageKey) {
    const rewriteState = aiRewriteState;
    const entry = rewriteState.pendingApply;
    if (!entry || getTaskMessageKey(entry.task) !== messageKey) return 0;
    rewriteState.pendingApply = null;
    const freshnessIssue = getTaskFreshnessIssue(entry.task);
    if (freshnessIssue) {
        recordAiRewriteDebug('apply-flush-skip', {
            generationId: entry.task.generationId || '',
            index: entry.task.index,
            reason: freshnessIssue,
        }, 'warn');
        return 0;
    }
    recordAiRewriteDebug('apply-flush', {
        generationId: entry.task.generationId || '',
        index: entry.task.index,
        finalCleanseSequence: rewriteState.finalCleanseSequence,
    });
    const result = entry.mode === 'fallback'
        ? applyAiProgramFallback(entry.task, entry.reason)
        : finishAiRewriteApply(entry.task, entry.accepted, { partial: entry.partial || null });
    return entry.mode === 'fallback'
        ? Number(result?.applied === true)
        : Number(['applied', 'fallback-applied', 'partial-applied'].includes(result?.status));
}

export function buildAiRewriteCandidate(payload, options = {}) {
    const settings = getSettings();
    const aiSettings = getAiSettings();
    const { chat } = getAppContext();
    const index = getAiRewriteMessageId(payload);
    if (index < 0) return { task: null, reason: '消息参数无效：invalid-message-id' };
    if (!Array.isArray(chat) || index >= chat.length) {
        return { task: null, reason: '未找到可改写的助手消息' };
    }

    const msg = chat[index];
    if (!isAssistantMessage(msg)) return { task: null, reason: '目标消息不是助手消息' };
    if (isMessageDiffReverted(msg) && options.recleanse !== true) {
        return { task: null, reason: '目标消息已撤回净化' };
    }
    const isAutomatic = payload?.automatic === true;
    if (isAutomatic) {
        // 总开关优先于自动触发：关闭 AI 改写时，
        // 只有 Program 规则可以改动消息。
        if (aiSettings.enabled !== true) return { task: null, reason: 'AI 改写未启用' };
        if (aiSettings.autoTriggerEnabled !== true) return { task: null, reason: '自动 AI 改写未启用' };
        const validation = generationLifecycle.validate(payload.generationId, {
            chatId: getCurrentChatIdentity(),
            chat,
        });
        if (!validation.ok) return { task: null, reason: `生成事务已失效：${validation.reason}` };
        if (validation.session.messageId !== index || validation.session.messageRef !== msg) {
            return { task: null, reason: '生成事务目标消息不一致' };
        }
        if (String(payload.chatId || '') !== validation.session.chatId) {
            return { task: null, reason: '生成事务聊天身份不一致' };
        }
    } else if (options.manual !== true) {
        return { task: null, reason: '自动 AI 改写缺少生成事务身份' };
    }

    const currentText = typeof msg.mes === 'string' ? msg.mes : '';
    const branchKey = getMessageDiffBranchKey(msg);
    const previous = getMessageDiffMeta(msg, branchKey);
    const frozenSnapshot = isAutomatic && payload && typeof payload === 'object' && typeof payload.snapshotText === 'string'
        ? payload.snapshotText
        : '';
    const sourceText = isAutomatic
        ? (frozenSnapshot || currentText)
        : (previous?.originalMes ?? currentText);
    if (!sourceText.trim()) return { task: null, reason: '目标消息为空' };

    const taskSettings = snapshotAiRewriteTaskSettings(settings, aiSettings);
    const segments = collectAiScopeSegments(sourceText);
    if (segments.length === 0) {
        return { task: null, reason: '目标消息为空' };
    }

    const matches = collectAiMatches(sourceText, settings, taskSettings.aiSettings);
    if (matches.length === 0) {
        return { task: null, reason: '整条消息内未命中 AI 改写规则' };
    }
    const originalItems = buildRewriteItems(
        sourceText,
        matches,
        taskSettings.settings,
        taskSettings.aiSettings,
        { includeProgramFallback: !isAutomatic },
    );
    if (originalItems.length === 0) {
        return { task: null, reason: '命中内容没有可改写句子' };
    }

    const contentIdentity = isAutomatic
        ? freezeAiRewriteContentIdentity(payload, sourceText, taskSettings.aiSettings)
        : null;
    if (isAutomatic && !contentIdentity) {
        return { task: null, reason: '无法冻结自动 AI 改写 content identity' };
    }
    if (options.logTask === true) {
        recordAiRewriteDebug('task-ready', {
            index,
            branchKey,
            scopeMode: 'whole-message',
            segmentCount: segments.length,
            rawAiMatchCount: matches.length,
            matchedAiRuleCount: countMatchedAiRules(matches),
            sentenceTargetCount: originalItems.length,
            itemLengths: originalItems.map((item) => item.text.length),
            isStreaming: streamingRuntimeState.isStreamingGeneration === true,
            source: !isAutomatic && previous ? 'retained-original' : 'host-original',
            rawSourceLength: currentText.length,
            sourceLength: sourceText.length,
            generationId: isAutomatic ? String(payload.generationId || '') : '',
            chatId: isAutomatic ? String(payload.chatId || '') : '',
        });
    }
    return {
        task: {
            settings: taskSettings.settings,
            aiSettings: taskSettings.aiSettings,
            programProcessors: taskSettings.programProcessors,
            index,
            messageRef: msg,
            branchKey,
            originalText: sourceText,
            snapshotText: sourceText,
            items: originalItems,
            rawAiMatchCount: matches.length,
            matchedAiRuleCount: countMatchedAiRules(matches),
            claimedMessageText: currentText,
            claimedMeta: previous,
            automatic: isAutomatic,
            recleanse: options.recleanse === true,
            generationId: isAutomatic ? String(payload.generationId || '') : '',
            chatId: isAutomatic ? String(payload.chatId || '') : '',
            scheduleSource: isAutomatic ? String(payload.source || '') : 'manual',
        },
        reason: '',
    };
}

export function buildAiRewriteTaskCheck(payload, options = {}) {
    const candidate = buildAiRewriteCandidate(payload, options);
    if (!candidate.task) return candidate;

    const configIssue = getAiConfigIssue(candidate.task.aiSettings);
    if (configIssue) {
        return {
            task: null,
            reason: configIssue.reason,
            fallbackTask: candidate.task,
            fallbackCode: configIssue.code,
        };
    }

    return candidate;
}

export function finishAutomaticTaskBeforeRun(payload, reason, state = 'stale') {
    const generationId = String(payload?.generationId || '');
    const session = generationLifecycle.getSession(generationId);
    if (aiRewriteState.pendingApply?.task?.generationId === generationId) aiRewriteState.pendingApply = null;
    if (aiRewriteState.runningTask?.generationId === generationId) aiRewriteState.runningTask = null;
    if (aiRewriteState.activeTask?.generationId === generationId) cancelAiRewriteTask(reason);
    generationLifecycle.markRequestTerminated(generationId, state, reason);
    if (generationLifecycle.getSession(generationId) === session && session) {
        session.contentIdentity = null;
    }
    if (!aiRewriteState.statusTask || aiRewriteState.statusTask.generationId === generationId) {
        clearAiRewriteStatusToast(null, reason);
    }
    recordAiRewriteDebug('task-cancelled', {
        generationId,
        chatId: String(payload?.chatId || session?.chatId || ''),
        messageId: Number.isInteger(session?.messageId) ? session.messageId : null,
        requestState: generationLifecycle.getSession(generationId)?.requestState || state,
        reason: String(reason || state),
        source: String(payload?.source || ''),
    }, 'warn');
}

export function notifyAiRewriteNotSent(taskCheckOrReason) {
    const taskCheck = taskCheckOrReason && typeof taskCheckOrReason === 'object'
        ? taskCheckOrReason
        : null;
    if (taskCheck?.fallbackTask) {
        const fallbackResult = applyAiProgramFallback(taskCheck.fallbackTask, taskCheck.fallbackCode || 'not-sent');
        if (fallbackResult.applied) return;
    }

    const message = String(taskCheck?.reason || taskCheckOrReason || '未满足发送条件');
    notifyAiRewriteStatus('error', 'AI 改写未发送', message, { timeOut: 8000, extendedTimeOut: 16000 });
    recordAiRewriteDebug('not-sent', { reason: message }, aiRewriteState.statusToast ? 'warn' : 'info');
    if (!aiRewriteState.statusToast) {
        logger.info(`AI 改写未发送：${message}`);
        return;
    }
    logger.warn(`AI 改写未发送：${message}`);
    clearAiRewriteStatusToast();
}

