/**
 * 差异弹窗的勾选、筛选、定位与撤回交互。
 * 从 events-00-core.js 拆出；弹窗自身的比较控制器与菜单开关仍留在核心。
 */
import { extensionName } from '../../settings/defaults.js';
import { getAppContext } from '../../host/appContext.js';
import { refreshMessageDisplay } from '../../chat/display.js';
import { markHostChatDirtyFromIndex } from '../../integrations/tauriTavern.js';
import { queueIncrementalChatSave } from '../../chat/persistence.js';
import { diffRuntimeState, getCurrentDiffIndex } from '../state.js';
import { injectDiffButtons } from '../view.js';
import {
    clearMessageDisplayText,
    commitCurrentMessageText,
    getMessageDiffBranchKey,
    syncCurrentSwipeExtra,
} from '../../chat/messageBranch.js';
import {
    getMessageDiffMeta,
    isMessageDiffReverted,
    setMessageDiffReverted,
    writeMessageDiffAiStage,
    writeMessageDiffProgram,
} from '../messageMeta.js';
import { collectDiffStats } from '../diffStats.js';
import { computeRevertedText } from '../revertMerge.js';
import { collectPickedDiffItems, computePickedRevert } from '../pickRevert.js';
import { DIFF_PICK_HINT } from '../diffCopy.js';

export function createDiffInteractions({
    getDiffMessageByIndex,
    syncDiffRelatedModeState,
    closeDiffActionsMenu,
    renderDiffModalContent,
    recleanseDiffMessageAtIndex,
}) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();

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
        $('#blai-diff-pick-hint').text(DIFF_PICK_HINT);
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


    return {
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
    };
}
