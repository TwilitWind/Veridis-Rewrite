/**
 * 负责按需的差异弹窗渲染、操作，以及现有 DOM 绑定。
 */
import { extensionName, minTrackedDiffMessages, maxTrackedDiffMessages, normalizeDiffTrackedMessageLimit } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { cleanseMessageDataAtIndex } from '../../chat/cleanse.js';
import { refreshMessageDisplay } from '../../chat/display.js';
import { queueIncrementalChatSave } from '../../chat/persistence.js';
import { diffRuntimeState, getDiffComparisonForMessage, refreshDiffViewer } from '../state.js';
import { injectDiffButtons } from '../view.js';
import { maintainDiffRetention } from '../retention.js';
import { escapeHtml } from '../compare.js';
import { renderDiffDocumentInBackground } from '../background.js';
import { fadeOutThen } from '../../ui/motion.js';
import { markRegexDirty } from '../../rules/state.js';
import { showRecleanseFeedback } from '../recleanseFeedback.js';
import { collectAiScopeSegments } from '../../aiRewrite/matching.js';
import { getMessageDiffBranchKey } from '../../chat/messageBranch.js';
import { getMessageDiffMeta, isMessageDiffReverted } from '../messageMeta.js';
import { hasManualEdit } from '../diffStats.js';
import { showRelatedRulesForDiffElement } from './diffRelatedRules.js';
import { establishDiffBaselineAtIndex } from '../baseline.js';
import { syncRelatedRuleRuntime } from '../preferences.js';
import { syncDiffTypographyState } from '../typography.js';
import { assignDiffRevertItemIds } from '../pickRevert.js';
import { requestManualAiRewriteForMessage } from '../../aiRewrite/index.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';
import { buildEmptyRewriteHint } from '../emptyHint.js';
import { buildBaselineEmptyHtml, buildManualEditHintHtml, buildRevertedEmptyHtml, buildRevertedHistoryLostHtml, mountDiffRewriteHelp, mountDiffSourceLegend } from '../diffCopy.js';
import { createDiffInteractions } from './events-00-interactions.js';

// 差异弹窗的一次性闭包：状态与工具函数集中在此，绑定层通过返回对象读取。
export function recleanseDiffMessageAtIndex(index) {
    const { chat, extension_settings } = getAppContext();
    const msg = Number.isInteger(index) && Array.isArray(chat) ? chat[index] : null;
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

    // AI 改写关闭：以当前正文为输入执行一次程序改写，原文基线仍由 setMessageDiffProgramMes 保留。
    const sourceMes = typeof msg.mes === 'string' ? msg.mes : '';
    // 手机端曾出现「撤回后重新净化，程序规则却没跑」：处理器缓存仍是旧规则。
    // 显式重新净化强制重建一次，确保这次一定按当前规则执行。
    const beforeMes = String(msg.mes || '');
    markRegexDirty(true);
    const changed = cleanseMessageDataAtIndex(index, {
        diffSourceMes: sourceMes,
        explicitRecleanse: true,
        // AI 改写已关闭：本轮只有程序阶段，不能沿用上次 AI 改写内容当程序输入。
        clearAiStage: true,
    });
    showRecleanseFeedback(String(msg.mes || '') !== beforeMes);
    // 与 AI 提交路径对称：用旧 DOM 快照盖住这次重绘，赢过 Tauri 手机端宿主的窗口化重绘。
    // 数据清理与标脏已在 cleanse 内完成；injectDiffButtons / 存盘由 toggleCurrentDiffRevert 收尾统一处理。
    refreshMessageDisplay(index, { atomic: true, emitRenderedEvent: 'auto' });
    return changed;
}


export function createDiffEventsCore() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    mountDiffRewriteHelp();
    mountDiffSourceLegend();

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
        $('#blai-diff-actions-menu [data-blai-header-action]').each((_, item) => {
            const actionId = item.getAttribute('data-blai-header-action');
            const headerBtn = actionId ? document.getElementById(actionId) : null;
            // offsetParent 为 null 表示该按钮被 display:none 隐藏（只可能是手机断点，撤回态改置灰不再隐藏）。
            const headerVisible = !!headerBtn && headerBtn.offsetParent !== null
                && window.getComputedStyle(headerBtn).display !== 'none';
            // 显式写 flex/none：菜单镜像的 CSS 基线是 display:none（防 portal 后重复），
            // 若这里清空 style 会回退到基线而看不到，故放出时必须显式给 flex。
            item.style.display = headerVisible ? 'none' : 'flex';

            // 镜像项文案跟随顶栏：撤回所选会切成「退出勾选」，全文模式会切成「切回片段」。
            const labelId = item.getAttribute('data-blai-header-label');
            const text = labelId ? document.getElementById(labelId)?.textContent : null;
            const span = item.querySelector('span');
            if (span && text) span.textContent = text;
        });
        // 顶栏动作镜像与下方偏好项之间不加分隔线：手机端全文模式镜像本就是顶栏功能的延续。
        const divider = menu.querySelector('.blai-diff-menu-divider');
        if (divider) divider.style.display = 'none';

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
        const scopeText = document.getElementById('blai-diff-limit-info-scope');
        if (scopeText) scopeText.textContent = `只统计最近 ${normalized} 条非用户消息，通常是 AI 回复。`;
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
        const $modal = $('#blai-diff-related-modal');
        $('#blai-diff-related-body').empty();
        fadeOutThen($modal, () => $modal.hide());
        if (clearSelection) $('#blai-diff-modal-content .blai-diff-change-selected').removeClass('blai-diff-change-selected');
    };


    const syncDiffRelatedModeState = () => {
        const enabled = diffRuntimeState.diffRelatedRuleMode === true;
        $('#blai-diff-modal').toggleClass('blai-diff-related-mode', enabled);
        $('#blai-diff-related-mode-icon').attr('class', enabled ? 'fa-solid fa-crosshairs blai-related-active-icon' : 'fa-solid fa-crosshairs');
        $('#blai-diff-related-mode-text').text(`规则定位: ${enabled ? '开启' : '关闭'}`);
        $('#blai-diff-related-mode-toggle').attr('title', enabled ? '关闭规则定位' : '点击改写项查看命中的规则');
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
        // diffButtonInExtraMenu=true：按钮被收进消息更多菜单，顶部不再显示。
        // 菜单文案写当前状态，不用「显 / 收」这种省略叫法。
        const isTopInExtra = settings.diffButtonInExtraMenu === true;
        $('#blai-diff-menu-pos-icon').attr('class', isTopInExtra ? 'fa-solid fa-ellipsis-vertical' : 'fa-solid fa-thumbtack');
        $('#blai-diff-menu-pos-text').text(`顶部按钮: ${isTopInExtra ? '隐藏' : '显示'}`);
        $('#blai-diff-menu-pos-toggle').attr('title', isTopInExtra ? '将顶部按钮恢复到消息顶部' : '将顶部按钮收纳进更多菜单');
    };


    const syncDiffBottomMenuState = (settings) => {
        const isBottomVisible = settings.showBottomDiffButton !== false;
        $('#blai-diff-menu-bottom-icon').attr('class', isBottomVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash');
        $('#blai-diff-menu-bottom-text').text(`尾部按钮: ${isBottomVisible ? '显示' : '隐藏'}`);
        $('#blai-diff-menu-bottom-toggle').attr('title', isBottomVisible ? '隐藏消息尾部按钮' : '显示消息尾部按钮');
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

    const {
        syncDiffStats,
        syncDiffNavState,
        syncDiffPickModeState,
        syncDiffFilterState,
        setDiffFilterEnabled,
        toggleDiffSourceFilter,
        navigateDiffItems,
        toggleCurrentDiffRevert,
        setDiffPickMode,
        syncDiffPickConfirmState,
        applySelectedDiffReverts,
        clearNavHighlight,
    } = createDiffInteractions({
        getDiffMessageByIndex,
        syncDiffRelatedModeState,
        closeDiffActionsMenu,
        renderDiffModalContent,
        recleanseDiffMessageAtIndex,
    });


    const syncDiffRevertToggleState = (msg) => {
        const isReverted = isMessageDiffReverted(msg);
        const meta = getMessageDiffMeta(msg);
        const revertTitle = isReverted ? '重新净化文本' : '撤回净化并保护原文';
        $('#blai-diff-revert-icon').attr('class', isReverted ? 'fas fa-wand-magic-sparkles' : 'fas fa-rotate-left');
        $('#blai-diff-revert-text').text(isReverted ? '重新净化' : '撤回净化');
        // 被手动编辑过的消息仍可撤回：未改动的区间回退到
        // 记录的 Original，用户自己的措辞则保留。
        $('#blai-diff-revert-toggle').attr('title', revertTitle).prop('disabled', !isReverted && !meta);
        // 全文/片段模式常驻顶栏：撤回态没有差异可切换，置灰表示不可用，但按钮不消失。
        $('#blai-diff-mode-toggle').prop('disabled', isReverted);
    };


    const closeDiffModal = () => {
        cancelComparison();
        closeDiffActionsMenu();
        closeDiffRelatedModal();
        diffRuntimeState.diffRelatedRuleMode = false;
        diffRuntimeState.diffPickMode = false;
        syncDiffRelatedModeState();
        syncDiffPickModeState(null);
        diffRuntimeState.diffFilterEnabled = false;
        diffRuntimeState.diffSelectedSources = [];
        syncDiffFilterState();
        const $diffModal = $('#blai-diff-modal');
        fadeOutThen($diffModal, () => $diffModal.hide());
        diffRuntimeState.currentMessage = null;
    };


    async function renderDiffModalContent(index) {
        cancelComparison();
        const msg = getDiffMessageByIndex(index);
        if (!msg) { closeDiffModal(); return; }
        const meta = getMessageDiffMeta(msg);
        const mode = extension_settings[extensionName].diffViewMode || 'snippet';
        closeDiffRelatedModal();
        syncDiffPreferenceMenuState();
        syncDiffModeToggleState(mode);
        syncDiffRevertToggleState(msg);
        const contentEl = $('#blai-diff-modal-content');
        // 每次打开/重渲染先复位定位：改写项集合即将重建，旧高亮与序号都失效。
        clearNavHighlight();
        diffRuntimeState.diffNavIndex = -1;
        if (isMessageDiffReverted(msg)) {
            contentEl.html(!meta
                ? buildRevertedHistoryLostHtml()
                : buildRevertedEmptyHtml(msg.mes === meta.originalMes ? 'original' : 'different'));
            syncDiffStats(msg);
            syncDiffNavState();
            syncDiffPickModeState(msg);
            return;
        }
        if (!meta) {
            contentEl.html(buildBaselineEmptyHtml());
            syncDiffStats(msg);
            syncDiffNavState();
            syncDiffPickModeState(msg);
            return;
        }
        const pairs = ['ai', 'program', 'manual'].flatMap(section => {
            const pair = getDiffComparisonForMessage(index, section);
            if (!pair) return [];
            return [{ ...pair, section, ...(mode === 'full' || section === 'manual' ? {} : {
                oldRanges: collectAiScopeSegments(pair.oldText),
                newRanges: collectAiScopeSegments(pair.newText),
            }) }];
        });
        const controller = new AbortController();
        comparisonController = controller;
        const branchKey = getMessageDiffBranchKey(msg);
        contentEl.html('<div class="blai-diff-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>正在比较文本…</div>');
        let rendered;
        try {
            rendered = await renderDiffDocumentInBackground(pairs, mode, { signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) return;
            contentEl.html(`<div class="blai-diff-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>文本比较失败：${escapeHtml(error.message)}</div>`);
            syncDiffStats(msg);
            syncDiffNavState();
            return;
        } finally {
            if (comparisonController === controller) comparisonController = null;
        }
        if (controller.signal.aborted || diffRuntimeState.currentMessage !== msg
            || getDiffMessageByIndex(index) !== msg || getMessageDiffBranchKey(msg) !== branchKey) return;
        // 手改提示是「手改」来源在弹窗里的可见载体，带上 data-diff-section 供筛选隐藏。
        const notice = hasManualEdit(msg, meta) ? buildManualEditHintHtml() : '';
        const empty = buildEmptyRewriteHint();
        contentEl.html(notice + (mode === 'full'
            ? `<div class="blai-diff-full-text">${rendered.join('') || empty}</div>`
            : rendered.join('<hr class="blai-diff-divider">') || empty));
        assignDiffRevertItemIds($('#blai-diff-modal-content').get(0));
        syncDiffStats(msg);
        // 渲染完按当前筛选/定位状态重建：来源筛选用属性挂在弹窗上由 CSS 隐藏块，
        // 定位高亮因 DOM 重建需清掉并复位，避免指向已不存在的节点。
        syncDiffFilterState();
        diffRuntimeState.diffNavIndex = -1;
        syncDiffNavState();
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
        syncDiffFilterState,
        setDiffFilterEnabled,
        toggleDiffSourceFilter,
        navigateDiffItems,
        toggleCurrentDiffRevert,
        setDiffPickMode,
        syncDiffPickConfirmState,
        applySelectedDiffReverts,
        closeDiffModal,
        renderDiffModalContent,
        establishDiffBaselineAtIndex,
    };
}
