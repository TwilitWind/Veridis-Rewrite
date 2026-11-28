// 深度净化的预览区交互：入口、筛选、逐条定位、差异勾选与提交。
// 从 events.js 拆出；主流程通过 startDeepCleanProcessing 回调接回执行阶段。
import { logger } from '../../log.js';
import { showAlertModal, showConfirmModal } from '../../ui/notifications.js';
import { openMenuPopover, closeMenuPopover } from '../../ui/popover.js';
import { deepCleanRuntimeState } from '../state.js';
import { applyDeepCleanPreviewSelection } from '../lifecycle.js';
import { cancelDeepCleanReviewComparisons } from '../review.js';
import { renderDeepCleanPreview, renderDeepCleanScanResult } from '../view.js';
import { openDeepCleanRevertedModal, closeDeepCleanRevertedModal } from '../view/view-04-reverted-modal.js';
import {
    createDeepCleanPreviewSession,
    ensureDeepCleanPreviewEntry,
    setDeepCleanPreviewFilter,
    setDeepCleanPreviewIncluded,
    stepDeepCleanPreview,
    cancelDeepCleanPreviewRequest,
    toggleDeepCleanPreviewBlock,
    listRevertedBlocks,
} from '../preview.js';

export function bindDeepCleanPreviewEvents({ startDeepCleanProcessing }) {
const currentPreviewSession = () => deepCleanRuntimeState.deepCleanSelection?.previewSession || null;

const loadPreviewEntry = (preview, { retry = false } = {}) => {
    if (!preview || preview.currentItemIndex === null) return;
    const key = `${preview.mode}:${preview.currentItemIndex}`;
    if (!retry && preview.diffCache.has(key)) {
        preview.loadingKey = null;
        renderDeepCleanPreview(preview);
        return;
    }
    cancelDeepCleanPreviewRequest(preview);
    preview.changeIndex = 0;
    const controller = new AbortController();
    preview.abortController = controller;
    preview.loadingKey = key;
    const token = ++preview.renderToken;
    renderDeepCleanPreview(preview);
    ensureDeepCleanPreviewEntry(preview, preview.currentItemIndex, preview.mode, {
        signal: controller.signal,
        retry,
    }).then(() => {
        if (token !== preview.renderToken) return;
        preview.loadingKey = null;
        preview.abortController = null;
        renderDeepCleanPreview(preview);
    }).catch((error) => {
        if (token !== preview.renderToken) return;
        preview.loadingKey = null;
        preview.abortController = null;
        renderDeepCleanPreview(preview);
        logger.error('[Deep Clean] preview failed', error);
    });
};

const commitPreviewAndRun = async (preview, runAll) => {
    if (!preview) return;
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    if (!lifecycle) return;
    if (runAll) {
        preview.skipped.clear();
        preview.included = new Set(preview.itemIndexes);
    }
    if (preview.included.size === 0) return;
    if (!await showConfirmModal(`本次将对 ${preview.included.size} 个内容项执行清理并写回正式数据，操作不可撤销。确定执行吗？`, { okText: '执行' })) return;
    applyDeepCleanPreviewSelection(lifecycle, preview.skipped, preview.aiCache, preview.revertedBlocks);
    // 执行前取消在途预览：否则 AI 预览回调会在处理进度页上重绘预览。
    cancelDeepCleanPreviewRequest(preview);
    lifecycle.previewSession = null;
    startDeepCleanProcessing();
};

$(document).off('click', '#blai-deep-clean-preview').on('click', '#blai-deep-clean-preview', () => {
    const lifecycle = deepCleanRuntimeState.deepCleanSelection;
    if (!lifecycle?.run?.scanResult) return;
    const itemIndexes = lifecycle.run.scanResult.affectedItemIndexes;
    if (!Array.isArray(itemIndexes) || itemIndexes.length === 0) {
        showAlertModal('本次扫描没有命中内容项，无法进入预览。请调整规则或处理范围后重新扫描。');
        return;
    }
    cancelDeepCleanReviewComparisons(lifecycle.currentReviewSession);
    const preview = createDeepCleanPreviewSession(lifecycle);
    if (!preview) return;
    preview.view = 'diff';
    lifecycle.previewSession = preview;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-filter-trigger]').on('click', '[data-deep-clean-preview-filter-trigger]', function(event) {
    event.preventDefault();
    const menu = this.parentElement?.querySelector('.blai-deep-clean-preview-filter-menu');
    if (!menu) return;
    if (!menu.hidden) {
        closeMenuPopover(menu);
        return;
    }
    openMenuPopover(this, menu);
    this.setAttribute('aria-expanded', 'true');
});

$(document).off('click', '[data-deep-clean-preview-filter]').on('click', '[data-deep-clean-preview-filter]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    const menu = $(this).closest('.blai-deep-clean-preview-filter-menu')[0];
    if (menu) closeMenuPopover(menu);
    preview.listOpen = false;
    preview.listScrollTop = 0;
    preview.changeIndex = 0;
    setDeepCleanPreviewFilter(preview, String($(this).attr('data-deep-clean-preview-filter') || 'all'));
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-list-toggle]').on('click', '[data-deep-clean-preview-list-toggle]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.listOpen = preview.listOpen !== true;
    preview.revealActiveRow = preview.listOpen;
    renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-item]').on('click', '[data-deep-clean-preview-item]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.currentItemIndex = Number($(this).attr('data-deep-clean-preview-item'));
    preview.listOpen = false;
    preview.changeIndex = 0;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-nav]').on('click', '[data-deep-clean-preview-nav]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.listOpen = false;
    stepDeepCleanPreview(preview, String($(this).attr('data-deep-clean-preview-nav')) === 'previous' ? -1 : 1);
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-mode]').on('click', '[data-deep-clean-preview-mode]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    const mode = String($(this).attr('data-deep-clean-preview-mode') || 'program');
    if (preview.mode === mode) return;
    preview.mode = mode;
    loadPreviewEntry(preview);
});

$(document).off('click', '[data-deep-clean-preview-view]').on('click', '[data-deep-clean-preview-view]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.view = String($(this).attr('data-deep-clean-preview-view') || 'diff');
    renderDeepCleanPreview(preview);
});

$(document).off('change', '[data-deep-clean-preview-include]').on('change', '[data-deep-clean-preview-include]', function() {
    const preview = currentPreviewSession();
    if (!preview || preview.currentItemIndex === null) return;
    setDeepCleanPreviewIncluded(preview, preview.currentItemIndex, this.checked === true);
    const row = document.querySelector(`[data-deep-clean-preview-item="${preview.currentItemIndex}"]`);
    if (row) {
        row.classList.toggle('is-skipped', !this.checked);
        const icon = row.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-circle-check', this.checked);
            icon.classList.toggle('fa-circle-minus', !this.checked);
        }
    }
    $('[data-deep-clean-preview-run]')
        .text(`清理所选（${preview.included.size}）`)
        .attr('aria-label', `清理所选（${preview.included.size}）`)
        .attr('title', `清理所选（${preview.included.size}）`)
        .prop('disabled', preview.included.size === 0);
    // 菜单项是 `<span>标签</span><span>数量</span>`：只改数量，不能把标签写成数字。
    const setFilterCount = (value, count) => {
        const target = document.querySelector(`.blai-deep-clean-preview-filter-option[data-deep-clean-preview-filter="${value}"] .blai-deep-clean-preview-filter-option-count`);
        if (target) target.textContent = String(count);
    };
    setFilterCount('included', preview.included.size);
    setFilterCount('excluded', preview.skipped.size);
    if (preview.filter === 'included' || preview.filter === 'excluded') renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-generate-ai]').on('click', '[data-deep-clean-preview-generate-ai]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    preview.mode = 'ai';
    loadPreviewEntry(preview, { retry: true });
});

let locatedChangeBlock = null;
let locateHighlightTimer = 0;

const locateDeepCleanPreviewChange = (preview, blockIndex) => {
    const target = document.querySelector(`[data-blai-preview-change-block="${blockIndex}"]`);
    if (!(target instanceof HTMLElement)) return;
    const documentPane = document.querySelector('.blai-deep-clean-preview-document');
    if (documentPane) {
        const offset = target.offsetTop - documentPane.offsetTop;
        documentPane.scrollTop = Math.max(0, offset - documentPane.clientHeight / 2);
        preview.documentScrollTop = documentPane.scrollTop;
    }
    // 高亮落在整段改写项上；聚焦复选框会让已勾选态看起来像被取消勾选。
    if (locatedChangeBlock && locatedChangeBlock !== target) locatedChangeBlock.classList.remove('is-located');
    const active = document.activeElement;
    if (active instanceof HTMLElement && target.contains(active)) active.blur();
    target.classList.add('is-located');
    locatedChangeBlock = target;
    window.clearTimeout(locateHighlightTimer);
    locateHighlightTimer = window.setTimeout(() => {
        target.classList.remove('is-located');
        if (locatedChangeBlock === target) locatedChangeBlock = null;
    }, 1200);
};

$(document).off('click', '[data-deep-clean-preview-change]').on('click', '[data-deep-clean-preview-change]', function() {
    const preview = currentPreviewSession();
    if (!preview) return;
    const entry = preview.diffCache.get(`${preview.mode}:${preview.currentItemIndex}`);
    const blockIndexes = (entry?.session?.reviewItems?.[0]?.blocks || [])
        .map((block, index) => (block.type === 'diff' ? index : -1))
        .filter(index => index >= 0);
    if (blockIndexes.length === 0) return;
    const direction = String($(this).attr('data-deep-clean-preview-change')) === 'previous' ? -1 : 1;
    preview.changeIndex = (preview.changeIndex + direction + blockIndexes.length) % blockIndexes.length;
    renderDeepCleanPreview(preview);
    locateDeepCleanPreviewChange(preview, blockIndexes[preview.changeIndex]);
});

$(document).off('change', '[data-deep-clean-preview-change-check]').on('change', '[data-deep-clean-preview-change-check]', function() {
    const preview = currentPreviewSession();
    if (!preview || preview.currentItemIndex === null) return;
    const blockIndex = Number($(this).attr('data-deep-clean-preview-change-check'));
    toggleDeepCleanPreviewBlock(preview, preview.currentItemIndex, blockIndex);
    renderDeepCleanPreview(preview);
});

$(document).off('click', '[data-deep-clean-preview-reverted-open]').on('click', '[data-deep-clean-preview-reverted-open]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    const entries = listRevertedBlocks(preview);
    openDeepCleanRevertedModal(entries, (entry) => {
        const active = currentPreviewSession();
        if (!active) return;
        const itemIndex = Number(entry.itemIndex);
        const blockIndex = Number(entry.blockIndex);
        if (active.currentItemIndex !== itemIndex) {
            active.currentItemIndex = itemIndex;
            active.changeIndex = 0;
            loadPreviewEntry(active);
        }
        const session = active.diffCache.get(`${active.mode}:${itemIndex}`);
        const blockIndexes = (session?.session?.reviewItems?.[0]?.blocks || [])
            .map((block, index) => (block.type === 'diff' ? index : -1))
            .filter(index => index >= 0);
        active.changeIndex = Math.max(0, blockIndexes.indexOf(blockIndex));
        renderDeepCleanPreview(active);
        requestAnimationFrame(() => locateDeepCleanPreviewChange(active, blockIndex));
    });
});

$(document).off('click', '[data-deep-clean-preview-back]').on('click', '[data-deep-clean-preview-back]', () => {
    const preview = currentPreviewSession();
    if (!preview) return;
    closeDeepCleanRevertedModal();
    cancelDeepCleanPreviewRequest(preview);
    deepCleanRuntimeState.deepCleanSelection.previewSession = null;
    renderDeepCleanScanResult(preview.run.scanResult);
});

$(document).off('click', '[data-deep-clean-preview-run]').on('click', '[data-deep-clean-preview-run]', () => {
    commitPreviewAndRun(currentPreviewSession(), false);
});

$(document).off('click', '[data-deep-clean-preview-run-all]').on('click', '[data-deep-clean-preview-run-all]', () => {
    commitPreviewAndRun(currentPreviewSession(), true);
});

}
