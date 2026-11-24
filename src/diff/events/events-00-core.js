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
import { fadeOutThen } from '../../ui/motion.js';
import { markRegexDirty } from '../../rules/state.js';
import { showToast } from '../../ui/notifications.js';
import { collectAiScopeSegments } from '../../aiRewrite/matching.js';
import { clearMessageDisplayText, commitCurrentMessageText, getMessageDiffBranchKey, syncCurrentSwipeExtra } from '../../chat/messageBranch.js';
import { getMessageDiffMeta, isMessageDiffReverted, setMessageDiffReverted, writeMessageDiffAiStage, writeMessageDiffProgram } from '../messageMeta.js';
import { collectDiffStats } from '../diffStats.js';
import { showRelatedRulesForDiffElement } from './diffRelatedRules.js';
import { computeRevertedText } from '../revertMerge.js';
import { establishDiffBaselineAtIndex } from '../baseline.js';
import { syncRelatedRuleRuntime } from '../preferences.js';
import { assignDiffRevertItemIds, collectPickedDiffItems, computePickedRevert } from '../pickRevert.js';
import { requestManualAiRewriteForMessage } from '../../aiRewrite/index.js';
import { closeMenuPopover, openMenuPopover } from '../../ui/popover.js';
import { buildEmptyRewriteHint } from '../emptyHint.js';

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
    // 手机端曾出现「撤回后重新净化，程序规则却没跑」：处理器缓存仍是旧规则。
    // 显式重新净化强制重建一次，确保这次一定按当前规则执行。
    markRegexDirty(true);
    const changed = cleanseMessageDataAtIndex(index, {
        diffSourceMes: sourceMes,
        explicitRecleanse: true,
    });
    showToast(changed ? '已按当前程序规则重新净化' : '已重新净化：这条原文没有程序规则命中', undefined, changed ? 'success' : 'info');
    // 与 AI 提交路径对称：用旧 DOM 快照盖住这次重绘，赢过 Tauri 手机端宿主的窗口化重绘。
    // 数据清理与标脏已在 cleanse 内完成；injectDiffButtons / 存盘由 toggleCurrentDiffRevert 收尾统一处理。
    refreshMessageDisplay(index, { atomic: true, emitRenderedEvent: 'auto' });
    return changed;
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
        $('#blai-diff-related-mode-text').text(enabled ? '规则定位：开启' : '规则定位：关闭');
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
        // 全文/片段模式常驻顶栏：撤回态没有差异可切换，置灰表示不可用，但按钮不消失。
        $('#blai-diff-mode-toggle').prop('disabled', isReverted);
    };


    // 工具行数字走统一口径：程序/AI 看当前差异项，手改看当前正文相对插件产出的连续改动段。
    // 口径实现在 diff/diffStats.js，这里只回显。
    const syncDiffStats = (msg) => {
        const stats = collectDiffStats(msg, document.getElementById('blai-diff-modal-content'));
        $('#blai-diff-stat-program').text(String(stats.program));
        $('#blai-diff-stat-ai').text(String(stats.ai));
        $('#blai-diff-stat-manual').text(String(stats.manual));
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


    // 筛选与逐条定位：改写项已由 assignDiffRevertItemIds 按 del/ins 配对编号，
    // 这里按编号收集「当前可见」的项，供定位箭头与计数共用。隐藏项（被来源筛选掉）不参与。
    const getVisibleRevertItems = () => {
        const content = document.getElementById('blai-diff-modal-content');
        if (!content) return [];
        const grouped = new Map();
        content.querySelectorAll('[data-blai-revert-item]').forEach((node) => {
            const id = node.getAttribute('data-blai-revert-item');
            if (!id) return;
            // offsetParent 为 null：元素自身或祖先被 display:none（筛选隐藏）。
            if (node.offsetParent === null) return;
            let group = grouped.get(id);
            if (!group) { group = []; grouped.set(id, group); }
            group.push(node);
        });
        return Array.from(grouped.values()).map(nodes => ({
            id: nodes[0].getAttribute('data-blai-revert-item'),
            nodes,
        }));
    };


    const syncDiffNavState = () => {
        const items = getVisibleRevertItems();
        const total = items.length;
        const raw = diffRuntimeState.diffNavIndex;
        const index = total === 0 ? -1 : Math.min(Math.max(raw, -1), total - 1);
        diffRuntimeState.diffNavIndex = index;
        $('#blai-diff-nav-count').text(`${index < 0 ? 0 : index + 1} / ${total}`);
        $('#blai-diff-nav-prev').prop('disabled', total === 0);
        $('#blai-diff-nav-next').prop('disabled', total === 0);
        return items;
    };


    const clearNavHighlight = () => {
        $('#blai-diff-modal-content .blai-diff-nav-current').removeClass('blai-diff-nav-current');
    };


    // 筛选开关只负责展开/收起筛选行；行内三项可多选，隐藏未选中的来源块。
    // 一项都没选＝不筛选；关闭开关会清空选择。选中态只给背景胶囊，不加边框。
    const syncDiffFilterState = () => {
        const enabled = diffRuntimeState.diffFilterEnabled === true;
        const selected = diffRuntimeState.diffSelectedSources;
        const panel = document.getElementById('blai-diff-filter-panel');
        if (panel) panel.hidden = !enabled;
        document.getElementById('blai-diff-modal')?.setAttribute('data-diff-filter-enabled', String(enabled));
        $('#blai-diff-filter-toggle')
            .toggleClass('is-active', enabled)
            .attr('aria-pressed', enabled ? 'true' : 'false')
            .attr('aria-expanded', enabled ? 'true' : 'false');
        $('#blai-diff-filter-panel [data-blai-diff-filter-source]').each((_, chip) => {
            const active = selected.includes(chip.getAttribute('data-blai-diff-filter-source'));
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        // 整块重渲染后重建可见集合；未选任何来源时不加隐藏类。
        $('#blai-diff-modal-content [data-diff-section]').each((_, node) => {
            const section = node.getAttribute('data-diff-section');
            const hide = enabled && selected.length > 0 && !selected.includes(section);
            node.classList.toggle('blai-diff-source-hidden', hide);
        });
    };

    const resetDiffFilterVisibility = () => {
        clearNavHighlight();
        diffRuntimeState.diffNavIndex = -1;
        syncDiffNavState();
        // 被筛掉的项若已勾选，确认撤回会误伤隐藏内容；一并清掉并刷新确认按钮。
        $('#blai-diff-modal-content .blai-diff-change-picked').each((_, node) => {
            if (node.offsetParent === null) node.classList.remove('blai-diff-change-picked');
        });
        syncDiffPickConfirmState();
    };

    const setDiffFilterEnabled = (enabled) => {
        diffRuntimeState.diffFilterEnabled = enabled === true;
        if (!diffRuntimeState.diffFilterEnabled) diffRuntimeState.diffSelectedSources = [];
        syncDiffFilterState();
        resetDiffFilterVisibility();
    };

    const toggleDiffSourceFilter = (source) => {
        if (!diffRuntimeState.diffFilterEnabled) return;
        if (!['program', 'ai', 'manual'].includes(source)) return;
        const selected = diffRuntimeState.diffSelectedSources;
        const at = selected.indexOf(source);
        if (at >= 0) selected.splice(at, 1);
        else selected.push(source);
        syncDiffFilterState();
        resetDiffFilterVisibility();
    };


    const navigateDiffItems = (delta) => {
        const items = syncDiffNavState();
        if (!items.length) return;
        const current = diffRuntimeState.diffNavIndex;
        // 未定位时：向下取第一项、向上取最后一项；到两端后回绕，形成循环浏览。
        const next = current < 0
            ? (delta > 0 ? 0 : items.length - 1)
            : (current + delta + items.length) % items.length;
        diffRuntimeState.diffNavIndex = next;
        clearNavHighlight();
        const target = items[next];
        target.nodes.forEach(node => node.classList.add('blai-diff-nav-current'));
        target.nodes[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        syncDiffNavState();
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
            const current = !meta ? '历史对比文本已超出保留范围。' : msg.mes === meta.originalMes ? '当前显示为原始文本。' : '当前文本与保留原文不同。';
            contentEl.html(`<div class="blai-diff-empty"><i class="fas fa-shield-halved" aria-hidden="true"></i>此消息已撤回并处于免净化保护状态，${current}点击 <i class="fas fa-wand-magic-sparkles blai-diff-inline-icon"></i> 重新净化文本。</div>`);
            syncDiffStats(msg);
            syncDiffNavState();
            syncDiffPickModeState(msg);
            return;
        }
        if (!meta) {
            contentEl.html('<div class="blai-diff-empty"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>当前消息尚未经过净化。若这条正文已经写好，可把它作为原文立即执行一次净化：<button id="blai-diff-baseline-btn" type="button" class="blai-icon-btn blai-diff-baseline-btn">按当前正文建立净化基线</button></div>');
            syncDiffStats(msg);
            syncDiffNavState();
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
        const notice = omitVariableUpdates(msg.mes) !== omitVariableUpdates(meta.programMes)
            ? '<div class="blai-diff-empty" data-diff-section="manual"><i class="fa-solid fa-pen" aria-hidden="true"></i>当前消息已被手动编辑；撤回净化会保留你的改动，并把记录阶段里的改写尽量还原为原文（找不到的替换会跳过）。</div>' : '';
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
