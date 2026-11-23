/** runtime 的分块：ui。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { normalizeLimit } from '../planning.js';
import { aiRewriteState } from '../state.js';
import { logger } from '../../log.js';
import { recordAiRewriteDebug } from '../debug.js';
import { generationLifecycle } from '../../host/generationLifecycle.js';
import { isSameAiRewriteTask, getAiRewriteMessageId, validateAutomaticAiRewriteContent, getAiSettings } from '../task.js';
import { getAppContext } from '../../host/appContext.js';
import { isAssistantMessage } from '../../diff/tracking.js';
import { getMessageDiffBranchKey } from '../../chat/messageBranch.js';
import { extractCurrentAiRewriteScope } from '../matching.js';
import { isAiRewriteRequestFormatError } from '../generation.js';
import { isAiRewriteResponseFormatError } from '../response.js';
import { isMessageDiffReverted } from '../../diff/messageMeta.js';
import { applyProgramFallbackRewrites } from '../apply.js';

export function getAiRetryCount(aiSettings) {
    return normalizeLimit(aiSettings?.maxRetries, 2, 0, 5);
}

function getToastApi() {
    return globalThis?.toastr || (typeof window !== 'undefined' ? window.toastr : null);
}

function getToastElement(toast) {
    if (!toast) return null;
    if (typeof Element !== 'undefined' && toast instanceof Element) return toast;
    if (toast?.jquery) return toast[0] || null;
    if (typeof toast?.get === 'function') return toast.get(0);
    return null;
}

function removeToastElement(toastElement) {
    if (!toastElement) return;
    try {
        if (typeof toastElement.remove === 'function') {
            toastElement.remove();
            return;
        }
    } catch {
        // 继续交由父级移除处理。
    }
    if (toastElement.parentNode) {
        toastElement.parentNode.removeChild(toastElement);
    }
}

export function clearAiRewriteStatusToast(extraToastElement = null, reason = '') {
    const rewriteState = aiRewriteState;
    const clearedTask = rewriteState?.statusTask || null;
    const hadStatus = Boolean(rewriteState?.statusToast || clearedTask);
    const toastApi = getToastApi();
    const toastElement = getToastElement(rewriteState?.statusToast);
    if (rewriteState?.statusToast && toastApi && typeof toastApi.clear === 'function') {
        try {
            toastApi.clear(rewriteState.statusToast);
        } catch (err) {
            logger.warn('清理 AI 改写状态弹窗失败', err);
        }
    }
    if (rewriteState?.statusToast && toastApi && typeof toastApi.remove === 'function') {
        try {
            toastApi.remove(rewriteState.statusToast);
        } catch {
            // 继续交由 DOM 移除处理。
        }
    }
    removeToastElement(toastElement);
    if (extraToastElement && extraToastElement !== toastElement) removeToastElement(extraToastElement);
    if (rewriteState) {
        rewriteState.statusToast = null;
        rewriteState.statusTask = null;
    }
    if (hadStatus && reason) {
        recordAiRewriteDebug('popup-cleared', {
            generationId: clearedTask?.generationId || '',
            index: Number.isInteger(clearedTask?.index) ? clearedTask.index : null,
            reason: String(reason),
        });
    }
}

function dismissAiRewriteStatusToast(toastElement, task) {
    const rewriteState = aiRewriteState;
    const dismissedTask = task || rewriteState.statusTask || null;
    clearAiRewriteStatusToast(toastElement, 'user-dismissed');
    rewriteState.statusDismissedTask = dismissedTask;
    recordAiRewriteDebug('popup-dismissed', {
        generationId: dismissedTask?.generationId || '',
        index: Number.isInteger(dismissedTask?.index) ? dismissedTask.index : null,
        requestContinues: true,
    });
}

function attachAiRewriteDismissAction(toast, task) {
    const toastElement = getToastElement(toast);
    const closeButton = toastElement?.querySelector?.('.toast-close-button');
    if (!toastElement || !closeButton || closeButton.dataset?.blaiDismissBound === 'true') return;
    if (closeButton.dataset) closeButton.dataset.blaiDismissBound = 'true';
    closeButton.setAttribute('aria-label', '关闭提示');
    closeButton.setAttribute('title', '关闭提示（后台改写会继续）');
    closeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        dismissAiRewriteStatusToast(toastElement, task);
    }, { capture: true });
}

export function cancelAiRewriteTask(reason = 'cancelled') {
    const state = aiRewriteState;
    if (state?.activeController) {
        try {
            state.activeController.abort(reason);
        } catch (err) {
            logger.warn('取消 AI 改写请求失败', err);
        }
    }
    if (state) {
        state.activeController = null;
        state.activeTask = null;
    }
}

function terminateAiRewriteTask(task = null, options = {}) {
    const rewriteState = aiRewriteState;
    const targetTask = task || rewriteState.statusTask || rewriteState.activeTask || null;
    if (isSameAiRewriteTask(rewriteState.pendingApply?.task, targetTask)) rewriteState.pendingApply = null;
    if (targetTask?.automatic === true) {
        generationLifecycle.markRequestTerminated(targetTask.generationId, 'cancelled', 'user-terminated');
    }
    clearAiRewriteStatusToast(options.toastElement || null);
    recordAiRewriteDebug('terminate-requested', {
        generationId: targetTask?.generationId || '',
        index: Number.isInteger(targetTask?.index) ? targetTask.index : null,
        hasActiveController: !!rewriteState.activeController,
    }, 'warn');
    if (rewriteState.activeController && (!targetTask || isSameAiRewriteTask(rewriteState.activeTask, targetTask))) {
        cancelAiRewriteTask('user-terminated');
    }
}

function attachAiRewriteTerminateAction(toast, task) {
    if (typeof document === 'undefined') return;
    const toastElement = getToastElement(toast);
    if (!toastElement || !task || toastElement.querySelector('.blai-ai-toast-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'blai-ai-toast-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'blai-ai-toast-stop';
    button.textContent = '终止';
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        button.textContent = '终止中';
        terminateAiRewriteTask(task, { toastElement, silent: true });
    });
    actions.appendChild(button);
    toastElement.appendChild(actions);
}

export function notifyAiRewriteStatus(type, title, message, options = {}) {
    const method = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    const safeTitle = String(title || 'AI 改写');
    const safeMessage = String(message || '');
    const toastApi = getToastApi();
    if (toastApi && typeof toastApi[method] === 'function') {
        const sticky = options.sticky === true;
        const task = sticky ? options.task || null : null;
        if (sticky && task && isSameAiRewriteTask(aiRewriteState.statusDismissedTask, task)) return;
        if (options.replaceCurrent !== false) clearAiRewriteStatusToast(null, `status-${method}`);
        const toast = toastApi[method](safeMessage, safeTitle, {
            timeOut: sticky ? 0 : (options.timeOut ?? 5000),
            extendedTimeOut: sticky ? 0 : (options.extendedTimeOut ?? 10000),
            tapToDismiss: sticky ? false : (options.tapToDismiss ?? true),
            closeButton: options.closeButton ?? !sticky,
            preventDuplicates: false,
            escapeHtml: true,
        });
        const toastElement = getToastElement(toast);
        toastElement?.classList?.add('blai-ai-rewrite-toast');
        if (sticky) toastElement?.classList?.add('blai-ai-rewrite-progress-toast');
        aiRewriteState.statusToast = sticky ? toast : null;
        aiRewriteState.statusTask = task;
        if (sticky) attachAiRewriteDismissAction(toast, task);
        if (sticky && options.cancellable === true) {
            attachAiRewriteTerminateAction(toast, task);
        }
        return;
    }
}

function isLatestTrackableMessageIndex(index) {
    const { chat } = getAppContext();
    if (!Array.isArray(chat) || !Number.isInteger(index) || index < 0) return false;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!isAssistantMessage(chat[i])) continue;
        return i === index;
    }
    return false;
}

function formatAiRewriteProgress(task, current, total, attempt = 1, maxAttempts = 1) {
    const sentenceTargetCount = Math.max(0, Array.isArray(task?.items) ? task.items.length : 0);
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCurrent = Math.min(safeTotal, Math.max(1, Number(current) || 1));
    const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 1);
    const safeAttempt = Math.min(safeMaxAttempts, Math.max(1, Number(attempt) || 1));
    if (safeAttempt > 1) {
        return `句子目标 ${sentenceTargetCount} 处 · 正在重试 ${safeAttempt - 1}/${safeMaxAttempts - 1} · 处理 ${safeCurrent}/${safeTotal}…`;
    }
    return `句子目标 ${sentenceTargetCount} 处 · 正在处理 ${safeCurrent}/${safeTotal}…`;
}

export function notifyAiRewriteProgress(task, current, total, attempt = 1, maxAttempts = 1) {
    const retrying = Number(attempt) > 1;
    notifyAiRewriteStatus('info', retrying ? 'AI 改写重试中' : 'AI 改写中', formatAiRewriteProgress(task, current, total, attempt, maxAttempts), {
        sticky: true,
        closeButton: true,
        cancellable: true,
        task,
    });
}

export function getAiRewriteMessageKey(index, branchKey = 'main') {
    return `${Number(index)}:${String(branchKey || 'main')}`;
}

export function getTaskMessageKey(task) {
    return getAiRewriteMessageKey(task.index, task.branchKey);
}

export function freezeAiRewriteContentIdentity(payload, snapshotText, aiSettings) {
    const generationId = String(payload?.generationId || '');
    if (!generationId) return null;
    const session = generationLifecycle.getSession(generationId);
    if (!session || session.phase === 'cancelled') return null;
    if (session.contentIdentity) return session.contentIdentity;

    const { chat } = getAppContext();
    const messageId = getAiRewriteMessageId(payload);
    if (messageId < 0 || !Array.isArray(chat)) return null;
    const messageRef = chat[messageId];
    if (!isAssistantMessage(messageRef)
        || session.chatId !== String(payload?.chatId || '')
        || session.chatRef !== chat
        || session.messageId !== messageId
        || session.messageRef !== messageRef) {
        return null;
    }
    const scoped = extractCurrentAiRewriteScope(snapshotText, aiSettings);
    if (!scoped.ok) return null;
    const branchKey = getMessageDiffBranchKey(messageRef);
    const identity = { branchKey };
    session.contentIdentity = identity;
    recordAiRewriteDebug('content-snapshot-frozen', {
        generationId,
        chatId: session.chatId,
        messageId: session.messageId,
        scopedLength: scoped.text.length,
    });
    return identity;
}

function getLiveAiRewriteTargets() {
    const state = aiRewriteState;
    const targets = [];
    if (state.runningTask?.messageRef) targets.push(state.runningTask);
    const session = generationLifecycle.getActive();
    if (session?.contentIdentity && session.messageRef) {
        targets.push({
            index: session.messageId,
            messageRef: session.messageRef,
            branchKey: session.contentIdentity.branchKey,
        });
    }
    if (state.pendingApply?.task?.messageRef) targets.push(state.pendingApply.task);
    return targets;
}

export function getActiveAiRewriteBranchKeyForMessage(messageRef) {
    const target = getLiveAiRewriteTargets().find(entry => entry.messageRef === messageRef);
    return String(target?.branchKey || '');
}

export function isLiveAiRewriteTargetMessage(messageRef) {
    return getLiveAiRewriteTargets().some(target => target.messageRef === messageRef);
}

export function hasInvalidAiRewriteTarget(chat) {
    if (!Array.isArray(chat)) return false;
    return getLiveAiRewriteTargets().some(target => chat[Number(target.index)] !== target.messageRef);
}

export function hasFinalCleanseAfterTaskStart(task) {
    if (task.waitForFinalCleanse !== true) return true;
    const rewriteState = aiRewriteState;
    const readySequence = Number(rewriteState.finalCleanseByMessageKey.get(getTaskMessageKey(task))) || 0;
    return readySequence > (Number(task.finalCleanseSequence) || 0);
}

export function isNonRetryableAiRewriteError(error) {
    return isAiRewriteResponseFormatError(error) || isAiRewriteRequestFormatError(error);
}

export function applyAiProgramFallback(taskLike, reason = '') {
    // 开启 AI 改写时只按「AI 全部完成 → 程序改写」的顺序提交：
    // AI 未发出 / 请求失败 / 写回失败都不得改跑程序改写，由调用方提示原因。
    if (getAiSettings().enabled === true) {
        return { applied: false, reason: `AI 改写未成功，已跳过程序改写${reason ? `（${reason}）` : ''}` };
    }
    const { chat } = getAppContext();
    const index = Number(taskLike?.index);
    if (!Array.isArray(chat) || !Number.isInteger(index) || index < 0 || index >= chat.length) {
        return { applied: false, reason: 'invalid-index' };
    }
    if (!isLatestTrackableMessageIndex(index)) {
        recordAiRewriteDebug('fallback-skip', {
            reason: 'not-latest-trackable-message',
            index,
        }, 'warn');
        return { applied: false, reason: 'not-latest-trackable-message' };
    }

    const msg = chat[index];
    if (!isAssistantMessage(msg)) return { applied: false, reason: 'not-assistant-message' };
    if (isMessageDiffReverted(msg)) return { applied: false, reason: 'message-reverted' };
    if (taskLike?.messageRef && msg !== taskLike.messageRef) return { applied: false, reason: 'message-ref-changed' };
    if (taskLike?.automatic === true) {
        const validation = validateAutomaticAiRewriteContent(taskLike, { source: 'program-fallback' });
        if (!validation.ok || validation.session.messageId !== index) {
            return { applied: false, reason: validation.reason || 'generation-message-mismatch' };
        }
    }
    const applyResult = applyProgramFallbackRewrites({ ...taskLike, messageRef: msg });
    if (applyResult.committed !== true) return { applied: false, reason: applyResult.reason };

    recordAiRewriteDebug('program-commit', {
        source: 'ai-fallback',
        messageId: index,
        beforeLength: String(taskLike.snapshotText || '').length,
        afterLength: String(msg.mes || '').length,
    });

    recordAiRewriteDebug('fallback-applied', {
        index,
        branchKey: getMessageDiffBranchKey(msg),
        trigger: String(reason || ''),
        sentenceTargetCount: taskLike.items?.length || 0,
        matchedAiRuleCount: taskLike.matchedAiRuleCount || 0,
        rawAiMatchCount: taskLike.rawAiMatchCount || 0,
        beforeLength: String(taskLike.snapshotText || '').length,
        afterLength: String(msg.mes || '').length,
    }, 'warn');

    return {
        applied: true,
        reason: '',
        sentenceTargetCount: taskLike.items?.length || 0,
        matchedAiRuleCount: taskLike.matchedAiRuleCount || 0,
        rawAiMatchCount: taskLike.rawAiMatchCount || 0,
    };
}

export function formatAiRewriteCompletionMessage(task, message) {
    const elapsedSeconds = Math.max(0, Date.now() - task.startedAtMs) / 1000;
    return `${message} · 用时 ${elapsedSeconds.toFixed(1)} 秒`;
}

