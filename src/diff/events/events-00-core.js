/**
 * 负责按需的差异弹窗渲染、操作，以及现有 DOM 绑定。
 */
import { extensionName, minTrackedDiffMessages, maxTrackedDiffMessages, normalizeDiffTrackedMessageLimit } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { cleanseMessageDataAtIndex } from '../../chat/cleanse.js';
import { refreshMessageDisplay } from '../../chat/display.js';
import { markHostChatDirtyFromIndex } from '../../integrations/tauriTavern.js';
import { queueIncrementalChatSave } from '../../chat/persistence.js';
import { diffRuntimeState, getCurrentDiffIndex, getDiffComparisonForMessage, refreshDiffViewer } from '../state.js';
import { injectDiffButtons } from '../view.js';
import { maintainDiffRetention } from '../retention.js';
import { escapeHtml } from '../compare.js';
import { omitVariableUpdates } from '../../text/variableUpdates.js';
import { renderDiffDocumentInBackground } from '../background.js';
import { collectAiScopeSegments } from '../../aiRewrite/matching.js';
import { clearMessageDisplayText, commitCurrentMessageText, getMessageDiffBranchKey, syncCurrentSwipeExtra } from '../../chat/messageBranch.js';
import { getMessageDiffMeta, isMessageDiffReverted, setMessageDiffReverted, writeMessageDiffAiStage, writeMessageDiffProgram } from '../messageMeta.js';
import { showRelatedRulesForDiffElement } from './diffRelatedRules.js';
import { computeRevertedText } from '../revertMerge.js';
import { getRewriteStats } from '../rewriteStats.js';
import { establishDiffBaselineAtIndex } from '../baseline.js';
import { assignDiffRevertItemIds, collectPickedDiffItems, computePickedRevert } from '../pickRevert.js';
import { requestManualAiRewriteForMessage } from '../../aiRewrite/index.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';

// 差异弹窗的一次性闭包：状态与工具函数集中在此，绑定层通过返回对象读取。
export function recleanseDiffMessageAtIndex(index) {
    const { chat } = getAppContext();
    const msg = Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length
        ? chat[index]
        : null;
    if (!isMessageDiffReverted(msg)) return false;

    const sourceMes = typeof msg.mes === 'string' ? msg.mes : '';
    return cleanseMessageDataAtIndex(index, {
        diffSourceMes: sourceMes,
        explicitRecleanse: true,
    });
}


export function createDiffEventsCore() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();

    let comparisonController = null;

    const cancelComparison = () => {
        comparisonController?.abort();
        comparisonController = null;
    };

    const getDiffMessageByIndex = (index) => {
        const { chat } = getAppContext();
        return Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length ? chat[index] : null;
    };


    let diffMenuOpen = false;

    const closeDiffActionsMenu = () => {
        if (diffMenuOpen) {
            closeMenuPopover($('#blai-diff-actions-menu').get(0));
            diffMenuOpen = false;
        }
        $('#blai-diff-actions-menu').prop('hidden', true);
        $('#blai-diff-menu-toggle').attr('aria-expanded', 'false');
    };


    const openDiffActionsMenu = () => {
        const menu = $('#blai-diff-actions-menu').get(0);
        const toggle = $('#blai-diff-menu-toggle').get(0);
        if (!menu || !toggle) return;
        diffMenuOpen = true;
        openMenuPopover(toggle, menu);
        $('#blai-diff-actions-menu').prop('hidden', false);
        $('#blai-diff-menu-toggle').attr('aria-expanded', 'true');
    };


    const syncDiffLimitControlState = () => {
        const currentSettings = extension_settings[extensionName];
        const normalized = normalizeDiffTrackedMessageLimit(currentSettings.diffTrackedMessageLimit);
        currentSettings.diffTrackedMessageLimit = normalized;
        $('#blai-diff-limit-input')
            .attr('min', minTrackedDiffMessages)
            .attr('max', maxTrackedDiffMessages)
            .val(normalized);
    };


    const applyDiffLimitDraft = () => {
        const currentSettings = extension_settings[extensionName];
        const previous = normalizeDiffTrackedMessageLimit(currentSettings.diffTrackedMessageLimit);
        const next = normalizeDiffTrackedMessageLimit($('#blai-diff-limit-input').val());
        currentSettings.diffTrackedMessageLimit = next;
        syncDiffLimitControlState();
        if (next === previous) return;

        saveSettingsDebounced();
        maintainDiffRetention();
        injectDiffButtons();
        refreshDiffViewer();
    };


    const closeDiffRelatedModal = ({ clearSelection = true } = {}) => {
        $('#blai-diff-related-body').empty();
        $('#blai-diff-related-modal').hide();
        if (clearSelection) $('#blai-diff-modal-content .blai-diff-change-selected').removeClass('blai-diff-change-selected');
    };


    const syncDiffRelatedModeState = () => {
        const enabled = diffRuntimeState.diffRelatedRuleMode === true;
        $('#blai-diff-modal').toggleClass('blai-diff-related-mode', enabled);
        $('#blai-diff-related-mode-icon').attr('class', enabled ? 'fa-solid fa-crosshairs blai-related-active-icon' : 'fa-solid fa-crosshairs');
        $('#blai-diff-related-mode-text').text(enabled ? '相关规则：开启' : '相关规则：关闭');
        $('#blai-diff-related-mode-toggle').attr('title', enabled ? '关闭相关规则模式' : '点击差异文本后推测相关规则');
        if (!enabled) closeDiffRelatedModal();
    };


    const syncDiffModeToggleState = (mode) => {
        const isFullMode = mode === 'full';
        const nextText = isFullMode ? '切回片段' : '全文模式';
        const nextTitle = isFullMode ? '切回片段模式' : '切换到全文模式';
        $('#blai-diff-mode-text').text(nextText);
        $('#blai-diff-mode-icon').attr('class', isFullMode ? 'fa-solid fa-list-ul' : 'fa-solid fa-file-lines');
        $('#blai-diff-mode-toggle').attr('title', nextTitle).attr('aria-label', nextTitle);
    };


    const syncDiffPositionMenuState = (settings) => {
        const shouldExposeTopButton = settings.diffButtonInExtraMenu === true;
        $('#blai-diff-menu-pos-icon').attr('class', shouldExposeTopButton ? 'fa-solid fa-thumbtack' : 'fa-solid fa-ellipsis');
        $('#blai-diff-menu-pos-text').text(shouldExposeTopButton ? '顶部按钮：外显' : '顶部按钮：收纳');
        $('#blai-diff-menu-pos-toggle').attr('title', shouldExposeTopButton ? '将顶部按钮恢复为外显' : '将顶部按钮收纳进菜单');
    };


    const syncDiffBottomMenuState = (settings) => {
        const isBottomVisible = settings.showBottomDiffButton !== false;
        $('#blai-diff-menu-bottom-icon').attr('class', isBottomVisible ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
        $('#blai-diff-menu-bottom-text').text(isBottomVisible ? '尾部按钮：隐藏' : '尾部按钮：显示');
        $('#blai-diff-menu-bottom-toggle').attr('title', isBottomVisible ? '隐藏消息尾部按钮' : '显示消息尾部按钮');
    };


    const syncDiffPreferenceMenuState = () => {
        const settings = extension_settings[extensionName];
        syncDiffLimitControlState();
        syncDiffRelatedModeState();
        syncDiffPositionMenuState(settings);
        syncDiffBottomMenuState(settings);
    };

    syncDiffLimitControlState();


    const syncDiffRevertToggleState = (msg) => {
        const isReverted = isMessageDiffReverted(msg);
        const meta = getMessageDiffMeta(msg);
        const revertTitle = isReverted ? '重新净化文本' : '撤回净化并保护原文';
        $('#blai-diff-revert-icon').attr('class', isReverted ? 'fas fa-wand-magic-sparkles' : 'fas fa-rotate-left');
        $('#blai-diff-revert-text').text(isReverted ? '重新净化' : '撤回净化');
        // 被手动编辑过的消息仍可撤回：未改动的区间回退到
        // 记录的 Original，用户自己的措辞则保留。
        $('#blai-diff-revert-toggle').attr('title', revertTitle).prop('disabled', !isReverted && !meta);
        $('#blai-diff-mode-toggle').toggle(!isReverted);
    };


    const syncDiffAiRewriteButtonState = (msg) => {
        const isReverted = isMessageDiffReverted(msg);
        $('#blai-diff-ai-rewrite').attr('title', isReverted ? '请先重新净化文本' : '对当前消息手动执行 AI 改写');
    };


    const syncDiffStats = (msg) => {
        const stats = getRewriteStats(msg);
        $('#blai-diff-stat-total').text(String(stats.total));
        $('#blai-diff-stat-program').text(String(stats.program));
        $('#blai-diff-stat-ai').text(String(stats.ai));
    };


    const syncDiffPickConfirmState = () => {
        const count = $('#blai-diff-modal-content .blai-diff-change-picked').length;
        $('#blai-diff-pick-confirm').prop('disabled', count === 0);
        $('#blai-diff-pick-hint').text(count > 0
            ? `已勾选 ${count} 处差异`
            : '点击差异片段勾选要撤回的项');
    };


    const syncDiffPickModeState = (msg) => {
        const enabled = diffRuntimeState.diffPickMode === true;
        const canPick = enabled && !!msg && typeof msg === 'object' && !isMessageDiffReverted(msg);
        $('#blai-diff-modal').toggleClass('blai-diff-pick-mode', canPick);
        $('#blai-diff-pick-bar').prop('hidden', !canPick);
        $('#blai-diff-pick-toggle').attr('title', canPick ? '退出单条撤回模式' : '勾选差异项后逐条撤回');
        $('#blai-diff-pick-icon').attr('class', canPick ? 'fa-solid fa-list-check blai-related-active-icon' : 'fa-solid fa-list-check');
        $('#blai-diff-pick-text').text(canPick ? '退出勾选' : '单条撤回');
        if (!canPick) $('#blai-diff-modal-content .blai-diff-change-picked').removeClass('blai-diff-change-picked');
        syncDiffPickConfirmState();
    };


    const setDiffPickMode = (enabled, msg) => {
        const next = enabled === true;
        if (next && diffRuntimeState.diffRelatedRuleMode) {
            diffRuntimeState.diffRelatedRuleMode = false;
            syncDiffRelatedModeState();
        }
        diffRuntimeState.diffPickMode = next;
        syncDiffPickModeState(msg);
    };


    const applySelectedDiffReverts = () => {
        const index = getCurrentDiffIndex();
        const msg = getDiffMessageByIndex(index);
        if (!Number.isInteger(index) || index < 0 || !msg || typeof msg !== 'object') return;
        if (diffRuntimeState.diffPickMode !== true || isMessageDiffReverted(msg)) return;
        const branchKey = getMessageDiffBranchKey(msg);
        const meta = getMessageDiffMeta(msg, branchKey);
        if (!meta) return;

        const items = collectPickedDiffItems($('#blai-diff-modal-content').get(0));
        const reverted = computePickedRevert(items, meta, msg.mes);
        if (!reverted) return;

        const commitResult = commitCurrentMessageText(msg, reverted.finalText, branchKey);
        if (!commitResult.ok) return;
        clearMessageDisplayText(msg);
        syncCurrentSwipeExtra(msg);
        if (meta.aiMes === null) {
            writeMessageDiffProgram(msg, branchKey, reverted.original, reverted.programText);
        } else {
            writeMessageDiffAiStage(msg, branchKey, reverted.original, reverted.aiText, reverted.programText);
        }
        markHostChatDirtyFromIndex(index);
        setDiffPickMode(false, msg);
        refreshMessageAfterRevertToggle(index, msg);
    };


    const refreshMessageAfterRevertToggle = (index, msg) => {
        const { chat } = getAppContext();
        if (!Number.isInteger(index) || index < 0 || !Array.isArray(chat) || !msg) return;
        refreshMessageDisplay(index, { allowReloadFallback: true, emitRenderedEvent: 'auto' });
        injectDiffButtons([index]);
        renderDiffModalContent(index);
        queueIncrementalChatSave();
    };


    const toggleCurrentDiffRevert = () => {
        const index = getCurrentDiffIndex();
        const msg = getDiffMessageByIndex(index);
        if (!Number.isInteger(index) || index < 0 || !msg || typeof msg !== 'object') return;

        if (isMessageDiffReverted(msg)) {
            recleanseDiffMessageAtIndex(index);
        } else {
            const branchKey = getMessageDiffBranchKey(msg);
            const diffMeta = getMessageDiffMeta(msg, branchKey);
            if (!diffMeta) {
                return;
            }
            const revertedText = computeRevertedText(msg.mes, diffMeta.programMes, diffMeta.originalMes);
            const commitResult = commitCurrentMessageText(msg, revertedText, branchKey);
            if (!commitResult.ok) {
                return;
            }
            clearMessageDisplayText(msg);
            syncCurrentSwipeExtra(msg);
            setMessageDiffReverted(msg, true, branchKey);
            markHostChatDirtyFromIndex(index);
        }

        closeDiffActionsMenu();
        refreshMessageAfterRevertToggle(index, msg);
    };


    const triggerCurrentDiffAiRewrite = () => {
        const index = getCurrentDiffIndex();
        const msg = getDiffMessageByIndex(index);
        if (!Number.isInteger(index) || index < 0 || !msg || typeof msg !== 'object') {
            return;
        }
        if (isMessageDiffReverted(msg)) {
            return;
        }

        closeDiffActionsMenu();
        requestManualAiRewriteForMessage(index);
    };


    const closeDiffModal = () => {
        cancelComparison();
        closeDiffActionsMenu();
        closeDiffRelatedModal();
        diffRuntimeState.diffRelatedRuleMode = false;
        diffRuntimeState.diffPickMode = false;
        syncDiffRelatedModeState();
        syncDiffPickModeState(null);
        $('#blai-diff-modal').hide();
        diffRuntimeState.currentMessage = null;
    };


    async function renderDiffModalContent(index) {
        cancelComparison();
        const msg = getDiffMessageByIndex(index);
        if (!msg) { closeDiffModal(); return; }
        syncDiffStats(msg);
        const meta = getMessageDiffMeta(msg);
        const mode = extension_settings[extensionName].diffViewMode || 'snippet';
        closeDiffRelatedModal();
        syncDiffPreferenceMenuState();
        syncDiffModeToggleState(mode);
        syncDiffRevertToggleState(msg);
        syncDiffAiRewriteButtonState(msg);
        const contentEl = $('#blai-diff-modal-content');
        if (isMessageDiffReverted(msg)) {
            const current = !meta ? '历史对比文本已超出保留范围。' : msg.mes === meta.originalMes ? '当前显示为原始文本。' : '当前文本与保留原文不同。';
            contentEl.html(`<div class="blai-diff-empty"><i class="fas fa-shield-halved blai-diff-reverted-icon"></i>此消息已撤回并处于免净化保护状态，${current}点击 <i class="fas fa-wand-magic-sparkles blai-diff-inline-icon"></i> 重新净化文本。</div>`);
            syncDiffPickModeState(msg);
            return;
        }
        if (!meta) {
            contentEl.html('<div class="blai-diff-empty">当前消息尚未经过净化。若这条正文已经写好，可把它作为原文立即执行一次净化：<button id="blai-diff-baseline-btn" type="button" class="blai-icon-btn blai-diff-baseline-btn">按当前正文建立净化基线</button></div>');
            syncDiffPickModeState(msg);
            return;
        }
        const pairs = ['ai', 'program'].flatMap(section => {
            const pair = getDiffComparisonForMessage(index, section);
            if (!pair) return [];
            return [{ ...pair, section, ...(mode === 'full' ? {} : {
                oldRanges: collectAiScopeSegments(pair.oldText),
                newRanges: collectAiScopeSegments(pair.newText),
            }) }];
        });
        const controller = new AbortController();
        comparisonController = controller;
        const branchKey = getMessageDiffBranchKey(msg);
        contentEl.html('<div class="blai-diff-empty">正在比较文本…</div>');
        let rendered;
        try {
            rendered = await renderDiffDocumentInBackground(pairs, mode, { signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) return;
            contentEl.html(`<div class="blai-diff-empty">文本比较失败：${escapeHtml(error.message)}</div>`);
            return;
        } finally {
            if (comparisonController === controller) comparisonController = null;
        }
        if (controller.signal.aborted || diffRuntimeState.currentMessage !== msg
            || getDiffMessageByIndex(index) !== msg || getMessageDiffBranchKey(msg) !== branchKey) return;
        const notice = omitVariableUpdates(msg.mes) !== omitVariableUpdates(meta.programMes)
            ? '<div class="blai-diff-empty">当前消息已被手动编辑；撤回净化会保留你的改动，并把记录阶段里的改写尽量还原为原文（找不到的替换会跳过）。</div>' : '';
        const empty = '<div class="blai-diff-empty">当前消息未触发差异。</div>';
        contentEl.html(notice + (mode === 'full'
            ? `<div class="blai-diff-full-text">${rendered.join('') || empty}</div>`
            : rendered.join('<hr class="blai-diff-divider">') || empty));
        assignDiffRevertItemIds($('#blai-diff-modal-content').get(0));
        syncDiffPickModeState(msg);
    }

    return {
        isDiffMenuOpen: () => diffMenuOpen,
        getDiffMessageByIndex,
        closeDiffActionsMenu,
        openDiffActionsMenu,
        syncDiffLimitControlState,
        applyDiffLimitDraft,
        closeDiffRelatedModal,
        syncDiffRelatedModeState,
        showRelatedRulesForDiffElement,
        syncDiffPreferenceMenuState,
        toggleCurrentDiffRevert,
        triggerCurrentDiffAiRewrite,
        setDiffPickMode,
        syncDiffPickConfirmState,
        applySelectedDiffReverts,
        closeDiffModal,
        renderDiffModalContent,
        establishDiffBaselineAtIndex,
    };
}
