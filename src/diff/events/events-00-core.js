/**
 * 负责按需的差异弹窗渲染、操作，以及现有 DOM 绑定。
 */
import { extensionName, minTrackedDiffMessages, maxTrackedDiffMessages, diffLineHeightOptions, diffParagraphGapOptions, normalizeDiffLineHeight, normalizeDiffParagraphGap, normalizeDiffTrackedMessageLimit } from '../../settings/defaults.js';
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
import { syncRelatedRuleRuntime } from '../preferences.js';
import { assignDiffRevertItemIds, collectPickedDiffItems, computePickedRevert } from '../pickRevert.js';
import { requestManualAiRewriteForMessage } from '../../aiRewrite/index.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';

// 差异弹窗的一次性闭包：状态与工具函数集中在此，绑定层通过返回对象读取。
export function recleanseDiffMessageAtIndex(index) {
    const { chat, extension_settings } = getAppContext();
    const msg = Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length
        ? chat[index]
        : null;
    if (!isMessageDiffReverted(msg)) return false;

    const meta = getMessageDiffMeta(msg);
    const aiEnabled = extension_settings?.[extensionName]?.aiRewrite?.enabled === true;

    if (aiEnabled) {
        // AI 改写开启时统一走「AI 全部完成 → 程序改写」的组合提交。
        // 发起失败由 AI 运行时提示原因，不再降级为程序改写。
        return requestManualAiRewriteForMessage(index, {
            recleanse: true,
            onSettled: () => {
                refreshMessageDisplay(index, { allowReloadFallback: true, emitRenderedEvent: 'auto' });
                injectDiffButtons([index]);
                queueIncrementalChatSave();
            },
        });
    }

    // AI 改写关闭：只按保留的原文执行一次程序改写，恢复阶段链并解除撤回保护。
    const sourceMes = typeof meta?.originalMes === 'string'
        ? meta.originalMes
        : (typeof msg.mes === 'string' ? msg.mes : '');
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
        // 顶栏有的功能不在 ⋮ 菜单里重复：镜像项按对应顶栏按钮的「真实可见性」决定显隐。
        // 菜单会被 popover.js portal 到 body，CSS 祖先选择器失效，故在此运行时同步；
        // 顶栏按钮的可见性同时受屏幕断点与状态（如 reverted 时隐藏全文模式）影响，
        // 直接读 computed style 才能覆盖所有情况。
        let anyMirrorVisible = false;
        $('#blai-diff-actions-menu [data-blai-header-action]').each((_, item) => {
            const actionId = item.getAttribute('data-blai-header-action');
            const headerBtn = actionId ? document.getElementById(actionId) : null;
            // offsetParent 为 null 表示该按钮被 display:none 隐藏（含断点/状态两种原因）。
            const headerVisible = !!headerBtn && headerBtn.offsetParent !== null
                && window.getComputedStyle(headerBtn).display !== 'none';
            // 显式写 flex/none：菜单镜像的 CSS 基线是 display:none（防 portal 后重复），
            // 若这里清空 style 会回退到基线而看不到，故放出时必须显式给 flex。
            item.style.display = headerVisible ? 'none' : 'flex';
            if (!headerVisible) anyMirrorVisible = true;

            // 镜像项文案跟随顶栏：撤回所选会切成「退出勾选」，全文模式会切成「切回片段」。
            const labelId = item.getAttribute('data-blai-header-label');
            const text = labelId ? document.getElementById(labelId)?.textContent : null;
            const span = item.querySelector('span');
            if (span && text) span.textContent = text;
        });
        // 分隔线只在确有镜像项露出时才显示，避免菜单顶部空出一条线。
        // 同样显式给 block（基线是 none），不能靠清空 style 回退。
        const divider = menu.querySelector('.blai-diff-menu-divider');
        if (divider) divider.style.display = anyMirrorVisible ? 'block' : 'none';

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
        $('#blai-diff-related-mode-toggle').attr('title', enabled ? '关闭相关规则模式' : '点击改写项查看命中的规则');
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
        $('#blai-diff-menu-pos-icon').attr('class', shouldExposeTopButton ? 'fa-solid fa-thumbtack' : 'fa-solid fa-ellipsis-vertical');
        $('#blai-diff-menu-pos-text').text(shouldExposeTopButton ? '顶部按钮：外显' : '顶部按钮：收纳');
        $('#blai-diff-menu-pos-toggle').attr('title', shouldExposeTopButton ? '将顶部按钮恢复为外显' : '将顶部按钮收纳进菜单');
    };


    const syncDiffBottomMenuState = (settings) => {
        const isBottomVisible = settings.showBottomDiffButton !== false;
        $('#blai-diff-menu-bottom-icon').attr('class', isBottomVisible ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
        $('#blai-diff-menu-bottom-text').text(isBottomVisible ? '尾部按钮：隐藏' : '尾部按钮：显示');
        $('#blai-diff-menu-bottom-toggle').attr('title', isBottomVisible ? '隐藏消息尾部按钮' : '显示消息尾部按钮');
    };


    const diffGapLabels = ['紧凑', '标准', '宽松'];

    const syncDiffTypographyState = () => {
        const settings = extension_settings[extensionName];
        const lineHeight = normalizeDiffLineHeight(settings.diffLineHeight);
        const gap = normalizeDiffParagraphGap(settings.diffParagraphGap);
        settings.diffLineHeight = lineHeight;
        settings.diffParagraphGap = gap;

        const modal = document.getElementById('blai-diff-modal');
        modal?.style.setProperty('--blai-diff-body-line-height', String(lineHeight));
        modal?.style.setProperty('--blai-diff-body-paragraph-gap', `${gap}px`);

        $('#blai-diff-line-height-text').text(`正文行距：${lineHeight}`);
        const gapIndex = Math.max(0, diffParagraphGapOptions.indexOf(gap));
        $('#blai-diff-paragraph-gap-text').text(`段落间距：${diffGapLabels[gapIndex]}`);
    };


    const syncDiffPreferenceMenuState = () => {
        const settings = extension_settings[extensionName];
        syncRelatedRuleRuntime();
        syncDiffLimitControlState();
        syncDiffRelatedModeState();
        syncDiffPositionMenuState(settings);
        syncDiffBottomMenuState(settings);
        syncDiffTypographyState();
    };

    syncDiffLimitControlState();
    syncDiffTypographyState();


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


    const syncDiffStats = (msg) => {
        const stats = getRewriteStats(msg);
        $('#blai-diff-stat-total').text(String(stats.total));
        $('#blai-diff-stat-program').text(String(stats.program));
        $('#blai-diff-stat-ai').text(String(stats.ai));
    };


    const syncDiffPickConfirmState = (countOverride) => {
        // 传统计全表查询在几百条差异时每次勾选都要重扫；传入增量计数走缓存分支。
        const count = Number.isInteger(countOverride)
            ? countOverride
            : $('#blai-diff-modal-content .blai-diff-change-picked').length;
        $('#blai-diff-pick-confirm').prop('disabled', count === 0);
        $('#blai-diff-pick-hint').text(count > 0
            ? `已勾选 ${count} 个改写项`
            : '点击改写项勾选要撤回的内容');
    };


    const syncDiffPickModeState = (msg) => {
        const enabled = diffRuntimeState.diffPickMode === true;
        const canPick = enabled && !!msg && typeof msg === 'object' && !isMessageDiffReverted(msg);
        $('#blai-diff-modal').toggleClass('blai-diff-pick-mode', canPick);
        $('#blai-diff-pick-bar').prop('hidden', !canPick);
        $('#blai-diff-pick-toggle').attr('title', canPick ? '退出撤回所选' : '勾选改写项后撤回所选');
        $('#blai-diff-pick-icon').attr('class', canPick ? 'fa-solid fa-list-check blai-related-active-icon' : 'fa-solid fa-list-check');
        $('#blai-diff-pick-text').text(canPick ? '退出勾选' : '撤回所选');
        if (!canPick) $('#blai-diff-modal-content .blai-diff-change-picked').removeClass('blai-diff-change-picked');
        syncDiffPickConfirmState();
    };


    const setDiffPickMode = (enabled, msg) => {
        const next = enabled === true;
        if (next && diffRuntimeState.diffRelatedRuleMode) {
            // 相关规则与撤回所选互斥；偏好已持久化，关掉时一并写回设置。
            extension_settings[extensionName].diffRelatedRuleEnabled = false;
            diffRuntimeState.diffRelatedRuleMode = false;
            saveSettingsDebounced();
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
        const empty = '<div class="blai-diff-empty">当前消息没有改写项。</div>';
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
        setDiffPickMode,
        syncDiffPickConfirmState,
        applySelectedDiffReverts,
        closeDiffModal,
        renderDiffModalContent,
        establishDiffBaselineAtIndex,
    };
}
